import { describe, expect, it } from 'vitest';
import { readyTasks, schedule, validateDag, workload, type SchedAgent, type SchedTask } from '../src/orchestrator/scheduler.js';

const t = (code: string, role: SchedTask['role'], dependsOn: string[] = [], extra: Partial<SchedTask> = {}): SchedTask => ({
  id: code,
  code,
  role,
  priority: 'medium',
  status: 'todo',
  dependsOn,
  assigneeId: null,
  estimateHours: 8,
  ...extra,
});

const team: SchedAgent[] = [
  { id: 'pm', role: 'PM' },
  { id: 'be1', role: 'BE' },
  { id: 'be2', role: 'BE' },
  { id: 'fe1', role: 'FE' },
  { id: 'qa1', role: 'QA' },
];

describe('scheduler', () => {
  it('menjalankan task independen secara paralel ke agent berbeda', () => {
    const tasks = [t('T-01', 'BE'), t('T-02', 'BE'), t('T-03', 'FE')];
    const out = schedule(team, tasks);
    expect(out).toHaveLength(3);
    expect(new Set(out.map((a) => a.agentId)).size).toBe(3);
  });

  it('tidak memulai task yang dependensinya belum Done', () => {
    const tasks = [t('T-01', 'BE'), t('T-02', 'FE', ['T-01'])];
    expect(schedule(team, tasks).map((a) => a.taskId)).toEqual(['T-01']);
    tasks[0]!.status = 'done';
    expect(schedule(team, tasks).map((a) => a.taskId)).toEqual(['T-02']);
  });

  it('menghormati WIP limit sehingga agent tidak overload', () => {
    const tasks = [t('T-01', 'QA'), t('T-02', 'QA'), t('T-03', 'QA')];
    const out = schedule(team, tasks, 1);
    expect(out).toHaveLength(1);
    expect(out[0]!.agentId).toBe('qa1');
  });

  it('memilih agent dengan beban jam terendah', () => {
    const tasks = [t('T-01', 'BE', [], { status: 'done', assigneeId: 'be1', estimateHours: 30 }), t('T-02', 'BE')];
    expect(schedule(team, tasks)[0]!.agentId).toBe('be2');
  });

  it('memakai peran cadangan bila peran utama tidak ada di tim', () => {
    const out = schedule(team, [t('T-01', 'OPS')]);
    expect(['be1', 'be2']).toContain(out[0]!.agentId);
  });

  it('tim satu orang: PM merangkap semua peran', () => {
    const out = schedule([{ id: 'pm', role: 'PM' }], [t('T-01', 'BE')]);
    expect(out[0]!.agentId).toBe('pm');
  });

  it('mendahulukan prioritas tinggi lalu critical path terpanjang', () => {
    const tasks = [t('T-01', 'BE'), t('T-02', 'BE', [], { priority: 'high' }), t('T-03', 'BE'), t('T-04', 'FE', ['T-03']), t('T-05', 'FE', ['T-04'])];
    expect(readyTasks(tasks).map((x) => x.code)).toEqual(['T-02', 'T-03', 'T-01']);
  });

  it('validateDag mendeteksi siklus dan dependensi tak dikenal', () => {
    expect(validateDag([{ code: 'T-01', dependsOn: ['T-02'] }, { code: 'T-02', dependsOn: ['T-01'] }])).toMatch(/melingkar/);
    expect(validateDag([{ code: 'T-01', dependsOn: ['T-09'] }])).toMatch(/tak dikenal/);
    expect(validateDag([{ code: 'T-01', dependsOn: [] }, { code: 'T-02', dependsOn: ['T-01'] }])).toBeNull();
  });

  it('workload menghitung jam task belum selesai', () => {
    const tasks = [t('T-01', 'BE', [], { assigneeId: 'be1', estimateHours: 20 }), t('T-02', 'BE', [], { assigneeId: 'be1', status: 'done', estimateHours: 20 })];
    expect(workload(team, tasks).get('be1')).toBe(50);
  });
});
