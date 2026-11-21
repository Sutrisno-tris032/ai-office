import {
  GATES,
  PHASE_LABEL,
  TERMS_VERSION,
  type Gate,
  type MessageAuthor,
  type Project,
  type ProjectKind,
} from '@ai-office/shared';
import {
  analystIntro,
  consultantGreeting,
  planSummary,
  runAnalyst,
  runConsultant,
  runPlanner,
  termsMessage,
} from '../agents/index.js';
import { buildTeam } from '../agents/team.js';
import type { LLM } from '../llm/index.js';
import type { AuditLog } from '../security/audit.js';
import type { Repo } from '../store/repo.js';
import type { EventBus } from './bus.js';
import type { Engine } from './engine.js';

export class GateError extends Error {}

/** Mengelola percakapan & perpindahan fase proyek. Setiap persetujuan tercatat di audit log. */
export class ProjectService {
  private readonly locks = new Map<string, Promise<unknown>>();
  /** Janji penyusunan rencana yang sedang berjalan (dipakai test untuk menunggu). */
  readonly planning = new Map<string, Promise<void>>();

  constructor(
    private readonly repo: Repo,
    private readonly bus: EventBus,
    private readonly llm: LLM,
    private readonly audit: AuditLog,
    private readonly engine: Engine,
  ) {}

  async create(ownerId: string, name: string, kind: ProjectKind, ip: string | null): Promise<Project> {
    const project = await this.repo.createProject({ ownerId, name, kind });
    await this.repo.addMessage(project.id, 'consultant', consultantGreeting(project));
    await this.audit.record({ projectId: project.id, actorType: 'user', actorId: ownerId, action: 'project.created', detail: { name, kind }, ip });
    return project;
  }

  /** Pesan klien diproses berurutan per proyek. */
  handleMessage(projectId: string, userId: string, content: string): Promise<void> {
    return this.withLock(projectId, () => this.processMessage(projectId, userId, content));
  }

  approve(projectId: string, userId: string, gate: Gate, ip: string | null, termsVersion?: string): Promise<Project> {
    return this.withLock(projectId, () => this.processApproval(projectId, userId, gate, ip, termsVersion));
  }

  private async processMessage(projectId: string, userId: string, content: string): Promise<void> {
    const project = (await this.repo.getProject(projectId))!;
    await this.say(projectId, 'client', content);
    await this.audit.record({ projectId, actorType: 'user', actorId: userId, action: 'message.sent', detail: { phase: project.phase, length: content.length } });
    const messages = await this.repo.listMessages(projectId);

    try {
      switch (project.phase) {
        case 'consulting':
        case 'terms': {
          await this.typing(projectId, 'consultant', true);
          const out = await runConsultant(this.llm, project, messages);
          const patch: Partial<Project> = { facts: { ...project.facts, ...out.facts } };
          if (project.phase === 'consulting' && out.proposeSolution && out.solution) {
            patch.solution = out.solution;
            patch.pendingGate = 'solution';
          }
          const updated = await this.repo.updateProject(projectId, patch);
          this.bus.publish(projectId, { type: 'project', data: updated });
          await this.say(projectId, 'consultant', out.reply);
          break;
        }
        case 'requirements': {
          await this.typing(projectId, 'analyst', true);
          const start = messages.findIndex((m) => m.author === 'analyst');
          const out = await runAnalyst(this.llm, project, messages, Math.max(0, start));
          if (out.complete && out.requirements) {
            const updated = await this.repo.updateProject(projectId, { requirements: out.requirements, pendingGate: 'requirements' });
            this.bus.publish(projectId, { type: 'project', data: updated });
          }
          await this.say(projectId, 'analyst', out.reply);
          break;
        }
        case 'planning':
          await this.say(projectId, 'system', 'Architect dan PM sedang menyusun rencana. Catatan Anda sudah kami terima dan akan dipertimbangkan.');
          break;
        case 'plan_review':
          await this.say(projectId, 'pm', 'Catatan diterima. Bila ingin mengubah rencana secara signifikan, sebutkan bagiannya; bila sudah sesuai, silakan setujui rencana untuk memulai development.');
          break;
        case 'development':
        case 'completed': {
          const tasks = await this.repo.listTasks(projectId);
          const done = tasks.filter((t) => t.status === 'done').length;
          const wip = tasks.filter((t) => t.status === 'in_progress').map((t) => t.code);
          await this.say(
            projectId,
            'pm',
            `Update dari Bayu: ${done}/${tasks.length} task selesai${wip.length ? `, sedang dikerjakan paralel: ${wip.join(', ')}` : ''}. Masukan Anda sudah saya catat untuk dibahas di sprint review.`,
          );
          break;
        }
      }
    } catch (err) {
      console.error('[agent]', projectId, err);
      await this.say(projectId, 'system', 'Maaf, agent sedang mengalami gangguan. Silakan kirim ulang pesan Anda sebentar lagi.');
    } finally {
      this.bus.publish(projectId, { type: 'typing', data: { author: 'consultant', typing: false } });
    }
  }

  private async processApproval(projectId: string, userId: string, gate: Gate, ip: string | null, termsVersion?: string): Promise<Project> {
    const project = (await this.repo.getProject(projectId))!;
    const rule = GATES[gate];
    if (project.phase !== rule.from || project.pendingGate !== gate) {
      throw new GateError(`Persetujuan "${gate}" tidak berlaku pada fase ${PHASE_LABEL[project.phase]}`);
    }
    if (gate === 'terms' && termsVersion !== TERMS_VERSION) {
      throw new GateError(`Versi Syarat & Ketentuan harus ${TERMS_VERSION}`);
    }
    await this.audit.record({
      projectId,
      actorType: 'user',
      actorId: userId,
      action: `approval.${gate}`,
      detail: { from: rule.from, to: rule.to, termsVersion: termsVersion ?? null },
      ip,
    });

    let updated = await this.repo.updateProject(projectId, { phase: rule.to, pendingGate: gate === 'solution' ? 'terms' : null });
    this.bus.publish(projectId, { type: 'project', data: updated });

    if (gate === 'solution') await this.say(projectId, 'consultant', termsMessage());
    if (gate === 'terms') await this.say(projectId, 'analyst', analystIntro());
    if (gate === 'requirements') {
      await this.say(projectId, 'system', 'Kebutuhan disetujui. Solution Architect dan PM mulai menyusun tech stack, tim, dan rencana kerja…');
      const job = this.buildPlan(projectId, userId);
      this.planning.set(projectId, job);
      void job.finally(() => this.planning.delete(projectId));
    }
    if (gate === 'plan') {
      updated = await this.startDevelopment(updated, userId);
    }
    return updated;
  }

  private async buildPlan(projectId: string, userId: string): Promise<void> {
    try {
      await this.typing(projectId, 'architect', true);
      const project = (await this.repo.getProject(projectId))!;
      const plan = await runPlanner(this.llm, project);
      const updated = await this.repo.updateProject(projectId, { plan, phase: 'plan_review', pendingGate: 'plan' });
      this.bus.publish(projectId, { type: 'project', data: updated });
      const summary = planSummary(plan);
      await this.say(projectId, 'architect', summary.architect);
      await this.say(projectId, 'pm', summary.pm);
      await this.audit.record({ projectId, actorType: 'agent', actorId: 'architect', action: 'plan.proposed', detail: { tasks: plan.tasks.length } });
    } catch (err) {
      console.error('[planner]', projectId, err);
      const updated = await this.repo.updateProject(projectId, { phase: 'requirements', pendingGate: 'requirements' });
      this.bus.publish(projectId, { type: 'project', data: updated });
      await this.say(projectId, 'system', 'Penyusunan rencana gagal. Silakan setujui ulang kebutuhan untuk mencoba lagi.');
      await this.audit.record({ projectId, actorType: 'system', action: 'plan.failed', detail: { userId } });
    } finally {
      this.bus.publish(projectId, { type: 'typing', data: { author: 'architect', typing: false } });
    }
  }

  private async startDevelopment(project: Project, userId: string): Promise<Project> {
    const plan = project.plan!;
    const agents = await this.repo.insertAgents(buildTeam(project.id, plan.team));
    for (const a of agents) this.bus.publish(project.id, { type: 'agent', data: a });
    const tasks = await this.repo.insertTasks(
      plan.tasks.map((t) => ({
        projectId: project.id,
        code: t.code,
        title: t.title,
        description: t.description,
        role: t.role,
        priority: t.priority,
        status: 'todo' as const,
        dependsOn: t.dependsOn,
        assigneeId: null,
        reviewerId: null,
        progress: 0,
        output: null,
        estimateHours: Math.round(t.estimateHours),
        startedAt: null,
        completedAt: null,
      })),
    );
    for (const t of tasks) this.bus.publish(project.id, { type: 'task', data: t });
    const pm = agents[0]!;
    const act = await this.repo.addActivity(project.id, pm.id, 'kickoff', `${pm.name} membuka kickoff bersama ${agents.length - 1} agent. Sprint dimulai!`);
    this.bus.publish(project.id, { type: 'activity', data: act });
    await this.say(project.id, 'pm', `Rencana disetujui. Tim sudah masuk kantor dan mulai bekerja. Silakan pantau progresnya di Virtual Office.`);
    await this.audit.record({ projectId: project.id, actorType: 'user', actorId: userId, action: 'development.started', detail: { agents: agents.length, tasks: tasks.length } });
    void this.engine.tickProject(project.id);
    return project;
  }

  private async say(projectId: string, author: MessageAuthor, content: string): Promise<void> {
    const m = await this.repo.addMessage(projectId, author, content);
    this.bus.publish(projectId, { type: 'message', data: m });
  }

  private async typing(projectId: string, author: MessageAuthor, typing: boolean): Promise<void> {
    this.bus.publish(projectId, { type: 'typing', data: { author, typing } });
  }

  private withLock<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(projectId) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.locks.set(projectId, next.catch(() => undefined));
    return next;
  }
}
