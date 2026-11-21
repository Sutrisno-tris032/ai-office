import { createHash } from 'node:crypto';
import { asc, desc } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { auditLog } from '../db/schema.js';

export const GENESIS_HASH = '0'.repeat(64);

export interface AuditEntry {
  projectId?: string | null;
  actorType: 'user' | 'agent' | 'system';
  actorId?: string | null;
  action: string;
  detail?: Record<string, unknown>;
  ip?: string | null;
}

/** JSON kanonik (kunci terurut) — jsonb Postgres tidak mempertahankan urutan kunci. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v as object)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

function digest(prevHash: string, e: AuditEntry, createdAt: string): string {
  const payload = canonical([
    prevHash,
    e.projectId ?? null,
    e.actorType,
    e.actorId ?? null,
    e.action,
    e.detail ?? {},
    e.ip ?? null,
    createdAt,
  ]);
  return createHash('sha256').update(payload).digest('hex');
}

/**
 * Audit trail berantai: setiap entri menyimpan hash entri sebelumnya, sehingga
 * perubahan atau penghapusan entri lama terdeteksi oleh verifyAuditChain().
 * Tabel juga dilindungi trigger append-only di database.
 */
export class AuditLog {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly db: Db) {}

  record(entry: AuditEntry): Promise<void> {
    // Serialisasi penulisan agar rantai hash tidak bercabang.
    const run = this.queue.then(async () => {
      const last = await this.db.select({ hash: auditLog.hash }).from(auditLog).orderBy(desc(auditLog.seq)).limit(1);
      const prevHash = last[0]?.hash ?? GENESIS_HASH;
      const createdAt = new Date();
      const hash = digest(prevHash, entry, createdAt.toISOString());
      await this.db.insert(auditLog).values({
        projectId: entry.projectId ?? null,
        actorType: entry.actorType,
        actorId: entry.actorId ?? null,
        action: entry.action,
        detail: entry.detail ?? {},
        ip: entry.ip ?? null,
        createdAt,
        prevHash,
        hash,
      });
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  async verifyChain(): Promise<{ ok: boolean; brokenAt?: number }> {
    const rows = await this.db.select().from(auditLog).orderBy(asc(auditLog.seq));
    let prev = GENESIS_HASH;
    for (const r of rows) {
      const expected = digest(
        prev,
        {
          projectId: r.projectId,
          actorType: r.actorType as AuditEntry['actorType'],
          actorId: r.actorId,
          action: r.action,
          detail: r.detail,
          ip: r.ip,
        },
        r.createdAt.toISOString(),
      );
      if (r.prevHash !== prev || r.hash !== expected) return { ok: false, brokenAt: r.seq };
      prev = r.hash;
    }
    return { ok: true };
  }
}
