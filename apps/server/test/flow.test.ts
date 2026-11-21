import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TERMS_VERSION, type ProjectSnapshot } from '@ai-office/shared';
import { buildApp, type AppDeps } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { openDb, type DbHandle } from '../src/db/client.js';

let deps: AppDeps;
let handle: DbHandle;
let cookie = '';

const json = { 'content-type': 'application/json' };

async function call(method: 'GET' | 'POST', url: string, payload?: unknown, withCookie = true) {
  return deps.app.inject({ method, url, payload: payload as object, headers: { ...json, ...(withCookie && cookie ? { cookie } : {}) } });
}

async function snapshot(id: string): Promise<ProjectSnapshot> {
  return (await call('GET', `/api/projects/${id}`)).json();
}

async function waitFor<T>(fn: () => Promise<T>, ok: (v: T) => boolean, timeoutMs = 5000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (ok(v)) return v;
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timeout');
    await new Promise((r) => setTimeout(r, 20));
  }
}

async function say(id: string, content: string) {
  const before = (await snapshot(id)).messages.length;
  expect((await call('POST', `/api/projects/${id}/messages`, { content })).statusCode).toBe(202);
  // tunggu pesan klien + balasan agent
  await waitFor(() => snapshot(id), (s) => s.messages.length >= before + 2);
}

beforeAll(async () => {
  const config = { ...loadConfig({}), pgliteDir: 'memory://', mockProgressStep: 50 };
  handle = await openDb({ databaseUrl: null, pgliteDir: config.pgliteDir });
  deps = await buildApp(config, handle.db);
});

afterAll(async () => {
  await deps.app.close();
  await handle.close();
});

describe('alur klien end-to-end (mode mock)', () => {
  let projectId = '';

  it('menolak akses tanpa login', async () => {
    expect((await call('GET', '/api/projects', undefined, false)).statusCode).toBe(401);
  });

  it('registrasi membuat sesi httpOnly', async () => {
    const res = await call('POST', '/api/auth/register', { email: 'rina@klinik.test', password: 'kata-sandi-kuat-1', name: 'Rina' }, false);
    expect(res.statusCode).toBe(201);
    const set = String(res.headers['set-cookie']);
    expect(set).toMatch(/HttpOnly/i);
    expect(set).toMatch(/SameSite=Strict/i);
    cookie = set.split(';')[0]!;
  });

  it('menolak password lemah', async () => {
    const res = await call('POST', '/api/auth/register', { email: 'x@y.test', password: 'pendek' }, false);
    expect(res.statusCode).toBe(400);
  });

  it('membuat proyek dan konsultan menyapa', async () => {
    const res = await call('POST', '/api/projects', { name: 'Reservasi Klinik Gigi', kind: 'web' });
    expect(res.statusCode).toBe(201);
    projectId = res.json().project.id;
    const s = await snapshot(projectId);
    expect(s.project.phase).toBe('consulting');
    expect(s.messages[0]!.author).toBe('consultant');
  });

  it('pengguna lain tidak bisa melihat proyek', async () => {
    const own = cookie;
    const res = await call('POST', '/api/auth/register', { email: 'lain@test.test', password: 'kata-sandi-kuat-2' }, false);
    cookie = String(res.headers['set-cookie']).split(';')[0]!;
    expect((await call('GET', `/api/projects/${projectId}`)).statusCode).toBe(404);
    cookie = own;
  });

  it('konsultan menggali lalu mengusulkan solusi', async () => {
    await say(projectId, 'Jadwal pasien di 3 cabang sering bentrok karena dicatat manual.');
    await say(projectId, 'Admin tiap cabang dan pasien, sekitar 60 pasien per hari.');
    await say(projectId, 'Tidak ada jadwal bentrok dan no-show turun 50%.');
    const s = await snapshot(projectId);
    expect(s.project.pendingGate).toBe('solution');
    expect(s.project.solution?.modules.length).toBeGreaterThan(0);
    expect(s.project.facts['Masalah utama']).toMatch(/bentrok/);
  });

  it('persetujuan di luar urutan ditolak', async () => {
    expect((await call('POST', `/api/projects/${projectId}/approvals`, { gate: 'plan' })).statusCode).toBe(409);
  });

  it('setuju solusi → S&K (versi wajib cocok) → analisis kebutuhan', async () => {
    expect((await call('POST', `/api/projects/${projectId}/approvals`, { gate: 'solution' })).statusCode).toBe(200);
    expect((await call('POST', `/api/projects/${projectId}/approvals`, { gate: 'terms', termsVersion: '0.1' })).statusCode).toBe(409);
    const ok = await call('POST', `/api/projects/${projectId}/approvals`, { gate: 'terms', termsVersion: TERMS_VERSION });
    expect(ok.json().project.phase).toBe('requirements');
  });

  it('BA menggali kebutuhan hingga BRD siap', async () => {
    for (const a of ['Pasien booking via WA, admin catat di buku.', 'Admin, dokter, pasien, owner.', 'Pembatalan maksimal H-1.', 'QRIS dan WhatsApp.', 'Rilis 2 bulan, no-show turun 50%.']) {
      await say(projectId, a);
    }
    const s = await snapshot(projectId);
    expect(s.project.pendingGate).toBe('requirements');
    expect(s.project.requirements?.functional.length).toBeGreaterThan(0);
  });

  it('Architect + PM menyusun rencana, lalu development berjalan sampai selesai', async () => {
    await call('POST', `/api/projects/${projectId}/approvals`, { gate: 'requirements' });
    await deps.service.planning.get(projectId);
    let s = await snapshot(projectId);
    expect(s.project.phase).toBe('plan_review');
    expect(s.project.plan!.tasks.length).toBeGreaterThan(5);

    await call('POST', `/api/projects/${projectId}/approvals`, { gate: 'plan' });
    s = await snapshot(projectId);
    expect(s.agents.length).toBeGreaterThan(1);
    expect(s.agents.length).toBeLessThanOrEqual(10);
    expect(s.agents[0]!.role).toBe('PM');

    let maxParallel = 0;
    for (let i = 0; i < 200; i++) {
      await deps.engine.tickProject(projectId);
      s = await snapshot(projectId);
      const wip = s.tasks.filter((t) => t.status === 'in_progress');
      maxParallel = Math.max(maxParallel, wip.length);
      // tidak ada agent yang mengerjakan >1 task sekaligus
      const perAgent = new Map<string, number>();
      for (const t of wip) perAgent.set(t.assigneeId!, (perAgent.get(t.assigneeId!) ?? 0) + 1);
      expect(Math.max(0, ...perAgent.values())).toBeLessThanOrEqual(1);
      // dependensi dihormati
      const done = new Set(s.tasks.filter((t) => t.status === 'done').map((t) => t.code));
      for (const t of s.tasks.filter((x) => x.status !== 'todo')) expect(t.dependsOn.every((d) => done.has(d))).toBe(true);
      if (s.project.phase === 'completed') break;
    }
    expect(s.project.phase).toBe('completed');
    expect(maxParallel).toBeGreaterThan(1);
    expect(s.tasks.every((t) => t.output && t.reviewerId)).toBe(true);
  });

  it('audit trail utuh dan append-only', async () => {
    expect(await deps.audit.verifyChain()).toEqual({ ok: true });
    const err = await handle.db.execute(sql`DELETE FROM audit_log`).then(() => null, (e: { cause?: Error; message: string }) => e);
    expect(String(err?.cause?.message ?? err?.message)).toMatch(/append-only/);
  });
});
