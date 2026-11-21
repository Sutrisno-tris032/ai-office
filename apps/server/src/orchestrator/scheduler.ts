import type { Priority, Role, TaskStatus } from '@ai-office/shared';

/**
 * Scheduler murni (tanpa I/O) yang dipakai PM agent untuk membagi pekerjaan:
 *  - task hanya boleh mulai bila semua dependensinya Done,
 *  - task yang siap dijalankan PARALEL oleh agent berbeda,
 *  - setiap agent mengerjakan maksimal `wipLimit` task sekaligus (anti-overload),
 *  - agent dipilih berdasarkan peran, lalu beban kerja terendah (merata).
 */

export interface SchedAgent {
  id: string;
  role: Role;
}

export interface SchedTask {
  id: string;
  code: string;
  role: Role;
  priority: Priority;
  status: TaskStatus;
  dependsOn: string[]; // kode task
  assigneeId: string | null;
  estimateHours: number;
}

export interface Assignment {
  taskId: string;
  agentId: string;
}

/** Peran cadangan bila tim tidak punya agent dengan peran utama. */
const FALLBACK: Record<Role, Role[]> = {
  PM: [],
  BE: ['OPS', 'FE'],
  FE: ['UI', 'BE'],
  QA: ['BE', 'FE'],
  OPS: ['BE'],
  UI: ['FE'],
};

const PRIORITY_RANK: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

export function eligibleAgents(role: Role, agents: SchedAgent[]): SchedAgent[] {
  const primary = agents.filter((a) => a.role === role);
  if (primary.length) return primary;
  for (const r of FALLBACK[role]) {
    const alt = agents.filter((a) => a.role === r);
    if (alt.length) return alt;
  }
  // Tim 1 orang: PM merangkap semuanya.
  return agents.filter((a) => a.role !== 'PM').length ? agents.filter((a) => a.role !== 'PM') : agents;
}

/** Panjang rantai task yang menunggu task ini (critical path) — makin panjang, makin didahulukan. */
export function downstreamDepth(tasks: SchedTask[]): Map<string, number> {
  const children = new Map<string, string[]>();
  for (const t of tasks) for (const d of t.dependsOn) children.set(d, [...(children.get(d) ?? []), t.code]);
  const memo = new Map<string, number>();
  const visit = (code: string, stack: Set<string>): number => {
    if (memo.has(code)) return memo.get(code)!;
    if (stack.has(code)) return 0;
    stack.add(code);
    const depth = Math.max(0, ...(children.get(code) ?? []).map((c) => 1 + visit(c, stack)));
    stack.delete(code);
    memo.set(code, depth);
    return depth;
  };
  for (const t of tasks) visit(t.code, new Set());
  return memo;
}

export function readyTasks(tasks: SchedTask[]): SchedTask[] {
  const done = new Set(tasks.filter((t) => t.status === 'done').map((t) => t.code));
  const depth = downstreamDepth(tasks);
  return tasks
    .filter((t) => t.status === 'todo' && !t.assigneeId && t.dependsOn.every((d) => done.has(d)))
    .sort(
      (a, b) =>
        PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
        (depth.get(b.code) ?? 0) - (depth.get(a.code) ?? 0) ||
        a.code.localeCompare(b.code, undefined, { numeric: true }),
    );
}

export function schedule(agents: SchedAgent[], tasks: SchedTask[], wipLimit = 1): Assignment[] {
  const active = new Map<string, number>();
  const hours = new Map<string, number>();
  for (const a of agents) {
    active.set(a.id, 0);
    hours.set(a.id, 0);
  }
  for (const t of tasks) {
    if (!t.assigneeId || !active.has(t.assigneeId)) continue;
    hours.set(t.assigneeId, hours.get(t.assigneeId)! + t.estimateHours);
    if (t.status === 'in_progress') active.set(t.assigneeId, active.get(t.assigneeId)! + 1);
  }

  const result: Assignment[] = [];
  for (const task of readyTasks(tasks)) {
    const candidates = eligibleAgents(task.role, agents).filter((a) => active.get(a.id)! < wipLimit);
    if (!candidates.length) continue;
    candidates.sort(
      (a, b) => active.get(a.id)! - active.get(b.id)! || hours.get(a.id)! - hours.get(b.id)! || a.id.localeCompare(b.id),
    );
    const pick = candidates[0]!;
    result.push({ taskId: task.id, agentId: pick.id });
    active.set(pick.id, active.get(pick.id)! + 1);
    hours.set(pick.id, hours.get(pick.id)! + task.estimateHours);
  }
  return result;
}

/** Validasi rencana: kode unik, dependensi ada, dan tidak ada siklus. */
export function validateDag(tasks: { code: string; dependsOn: string[] }[]): string | null {
  const codes = new Set<string>();
  for (const t of tasks) {
    if (codes.has(t.code)) return `Kode task ganda: ${t.code}`;
    codes.add(t.code);
  }
  for (const t of tasks) for (const d of t.dependsOn) if (!codes.has(d)) return `${t.code} bergantung pada task tak dikenal ${d}`;
  const state = new Map<string, 0 | 1 | 2>();
  const byCode = new Map(tasks.map((t) => [t.code, t]));
  const dfs = (c: string): boolean => {
    if (state.get(c) === 1) return true;
    if (state.get(c) === 2) return false;
    state.set(c, 1);
    for (const d of byCode.get(c)!.dependsOn) if (dfs(d)) return true;
    state.set(c, 2);
    return false;
  };
  for (const t of tasks) if (dfs(t.code)) return `Dependensi melingkar terdeteksi di sekitar ${t.code}`;
  return null;
}

/** Beban kerja (%) per agent: jam task yang belum selesai dibanding kapasitas sprint. */
export function workload(agents: SchedAgent[], tasks: SchedTask[], capacityHours = 40): Map<string, number> {
  const m = new Map<string, number>(agents.map((a) => [a.id, 0]));
  for (const t of tasks) {
    if (t.assigneeId && t.status !== 'done' && m.has(t.assigneeId)) m.set(t.assigneeId, m.get(t.assigneeId)! + t.estimateHours);
  }
  for (const [k, v] of m) m.set(k, Math.round((v / capacityHours) * 100));
  return m;
}
