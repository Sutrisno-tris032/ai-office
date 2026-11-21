import type { Agent, AgentStatus, Task } from '@ai-office/shared';
import { runReviewer, runWorker } from '../agents/index.js';
import type { LLM } from '../llm/index.js';
import type { AuditLog } from '../security/audit.js';
import type { Repo } from '../store/repo.js';
import type { EventBus } from './bus.js';
import { schedule } from './scheduler.js';

type Pending<T> = { done: false } | { done: true; value?: T; error?: unknown };

/**
 * Mesin orkestrasi kantor virtual. Setiap tick, untuk setiap proyek fase development:
 *  1. memajukan task In Progress (agent bekerja),
 *  2. mengirim task selesai ke reviewer (In Review) lalu ke Done,
 *  3. PM (scheduler) membagikan task yang siap ke agent yang bebas — paralel & merata,
 *  4. memperbarui status setiap agent dan menyiarkan perubahan secara realtime.
 */
export class Engine {
  private timer: NodeJS.Timeout | null = null;
  private readonly running = new Set<string>();
  private readonly work = new Map<string, Pending<{ summary: string; deliverable: string }>>();
  private readonly reviews = new Map<string, Pending<{ approved: boolean; notes: string }>>();
  private readonly rejections = new Map<string, number>();

  constructor(
    private readonly repo: Repo,
    private readonly bus: EventBus,
    private readonly llm: LLM,
    private readonly audit: AuditLog,
    private readonly opts: { tickMs: number; mockProgressStep: number },
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tickAll(), this.opts.tickMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tickAll(): Promise<void> {
    const projects = await this.repo.listProjectsInPhase('development');
    await Promise.all(projects.map((p) => this.tickProject(p.id).catch((err) => console.error('[engine]', p.id, err))));
  }

  async tickProject(projectId: string): Promise<void> {
    if (this.running.has(projectId)) return;
    this.running.add(projectId);
    try {
      await this.step(projectId);
    } finally {
      this.running.delete(projectId);
    }
  }

  private async step(projectId: string): Promise<void> {
    const project = await this.repo.getProject(projectId);
    if (!project || project.phase !== 'development') return;
    const agents = await this.repo.listAgents(projectId);
    let tasks = await this.repo.listTasks(projectId);
    const byId = new Map(agents.map((a) => [a.id, a]));
    const pm = agents.find((a) => a.role === 'PM') ?? agents[0]!;

    // 1) Task In Progress
    for (const task of tasks.filter((t) => t.status === 'in_progress')) {
      const agent = byId.get(task.assigneeId ?? '');
      if (!agent) continue;
      let finished: { summary: string; deliverable: string } | null = null;
      if (this.llm.mode === 'mock') {
        const progress = Math.min(100, task.progress + this.opts.mockProgressStep);
        if (progress >= 100) finished = await runWorker(this.llm, project, agent, task);
        else await this.saveTask(task.id, { progress });
      } else {
        const p = this.ensure(this.work, task.id, () => runWorker(this.llm, project, agent, task));
        if (p.done && p.value) finished = p.value;
        else if (p.done) {
          this.work.delete(task.id); // gagal: coba lagi di tick berikutnya
          await this.activity(projectId, agent.id, 'error', `${agent.name} mengulang ${task.code} setelah gangguan`);
        } else await this.saveTask(task.id, { progress: Math.min(90, task.progress + Math.ceil(this.opts.mockProgressStep / 2)) });
      }
      if (finished) {
        this.work.delete(task.id);
        const reviewer = this.pickReviewer(agents, tasks, agent, pm);
        await this.saveTask(task.id, { status: 'in_review', progress: 100, output: finished.deliverable, reviewerId: reviewer.id });
        await this.activity(projectId, agent.id, 'review_requested', `${agent.name} menyelesaikan ${task.code} dan mengajukan review ke ${reviewer.name}`);
      }
    }

    // 2) Task In Review
    tasks = await this.repo.listTasks(projectId);
    for (const task of tasks.filter((t) => t.status === 'in_review')) {
      const reviewer = byId.get(task.reviewerId ?? '') ?? pm;
      const p = this.ensure(this.reviews, task.id, () => runReviewer(this.llm, reviewer, task));
      if (!p.done) continue;
      this.reviews.delete(task.id);
      const rejectedBefore = this.rejections.get(task.id) ?? 0;
      const approved = !p.value || p.value.approved || rejectedBefore >= 1;
      if (approved) {
        await this.saveTask(task.id, { status: 'done', completedAt: new Date() });
        await this.activity(projectId, reviewer.id, 'task_done', `${reviewer.name} menyetujui ${task.code} · ${task.title}`);
        await this.audit.record({ projectId, actorType: 'agent', actorId: reviewer.id, action: 'task.approved', detail: { task: task.code } });
      } else {
        this.rejections.set(task.id, rejectedBefore + 1);
        await this.saveTask(task.id, { status: 'todo', assigneeId: null, reviewerId: null, progress: 0, startedAt: null });
        await this.activity(projectId, reviewer.id, 'task_rejected', `${reviewer.name} meminta revisi ${task.code}: ${p.value!.notes}`);
      }
    }

    // 3) PM membagikan task yang siap
    tasks = await this.repo.listTasks(projectId);
    const assignments = schedule(
      agents.map((a) => ({ id: a.id, role: a.role })),
      tasks,
    );
    for (const a of assignments) {
      const task = tasks.find((t) => t.id === a.taskId)!;
      const agent = byId.get(a.agentId)!;
      await this.saveTask(task.id, { status: 'in_progress', assigneeId: agent.id, progress: 5, startedAt: new Date() });
      const parallel = assignments.length > 1 ? ' (paralel)' : '';
      await this.activity(projectId, pm.id, 'task_assigned', `${pm.name} menugaskan ${task.code} · ${task.title} ke ${agent.name}${parallel}`);
    }

    // 4) Status agent
    tasks = await this.repo.listTasks(projectId);
    for (const agent of agents) {
      const current = tasks.find((t) => t.assigneeId === agent.id && t.status === 'in_progress') ?? null;
      const reviewing = tasks.some((t) => t.reviewerId === agent.id && t.status === 'in_review');
      let status: AgentStatus = current ? 'working' : reviewing ? 'reviewing' : 'idle';
      if (agent.role === 'PM' && !current && !reviewing) status = 'meeting';
      if (status !== agent.status || (current?.id ?? null) !== agent.currentTaskId) {
        const updated = await this.repo.updateAgent(agent.id, { status, currentTaskId: current?.id ?? null });
        this.bus.publish(projectId, { type: 'agent', data: updated });
      }
    }

    // 5) Selesai?
    if (tasks.length && tasks.every((t) => t.status === 'done')) {
      const updated = await this.repo.updateProject(projectId, { phase: 'completed' });
      this.bus.publish(projectId, { type: 'project', data: updated });
      const msg = await this.repo.addMessage(
        projectId,
        'pm',
        `Semua ${tasks.length} task telah selesai dan lolos review. Build siap untuk demo dan User Acceptance Test. Terima kasih atas kepercayaan Anda!`,
      );
      this.bus.publish(projectId, { type: 'message', data: msg });
      await this.activity(projectId, pm.id, 'project_completed', `${pm.name} menutup sprint: semua task selesai`);
      await this.audit.record({ projectId, actorType: 'agent', actorId: pm.id, action: 'project.completed' });
      for (const a of agents) {
        const u = await this.repo.updateAgent(a.id, { status: 'idle', currentTaskId: null });
        this.bus.publish(projectId, { type: 'agent', data: u });
      }
    }
  }

  /** Reviewer: QA dengan antrean review paling sedikit, selain pelaksana; jika tidak ada, PM. */
  private pickReviewer(agents: Agent[], tasks: Task[], assignee: Agent, pm: Agent): Agent {
    const load = (a: Agent) => tasks.filter((t) => t.reviewerId === a.id && t.status === 'in_review').length;
    const qa = agents.filter((a) => a.role === 'QA' && a.id !== assignee.id).sort((a, b) => load(a) - load(b));
    if (qa[0]) return qa[0];
    const peers = agents.filter((a) => a.role === assignee.role && a.id !== assignee.id).sort((a, b) => load(a) - load(b));
    if (peers[0]) return peers[0];
    return pm;
  }

  private ensure<T>(map: Map<string, Pending<T>>, key: string, run: () => Promise<T>): Pending<T> {
    let p = map.get(key);
    if (!p) {
      const entry: Pending<T> = { done: false };
      map.set(key, entry);
      p = entry;
      run().then(
        (value) => map.set(key, { done: true, value }),
        (error) => map.set(key, { done: true, error }),
      );
      return map.get(key)!;
    }
    return p;
  }

  private async saveTask(id: string, patch: Parameters<Repo['updateTask']>[1]): Promise<void> {
    const t = await this.repo.updateTask(id, patch);
    this.bus.publish(t.projectId, { type: 'task', data: t });
  }

  private async activity(projectId: string, agentId: string | null, kind: string, text: string): Promise<void> {
    const a = await this.repo.addActivity(projectId, agentId, kind, text);
    this.bus.publish(projectId, { type: 'activity', data: a });
  }
}
