import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq } from 'drizzle-orm';
import type {
  Activity,
  Agent,
  Message,
  MessageAuthor,
  Project,
  ProjectSnapshot,
  Task,
} from '@ai-office/shared';
import type { Db } from '../db/client.js';
import * as s from '../db/schema.js';

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

const toProject = (r: typeof s.projects.$inferSelect): Project => ({
  id: r.id,
  ownerId: r.ownerId,
  name: r.name,
  kind: r.kind as Project['kind'],
  phase: r.phase as Project['phase'],
  classification: r.classification as Project['classification'],
  facts: r.facts ?? {},
  solution: r.solution ?? null,
  requirements: r.requirements ?? null,
  plan: r.plan ?? null,
  pendingGate: r.pendingGate ?? null,
  createdAt: r.createdAt.toISOString(),
});

const toMessage = (r: typeof s.messages.$inferSelect): Message => ({
  id: r.id,
  projectId: r.projectId,
  author: r.author as MessageAuthor,
  content: r.content,
  createdAt: r.createdAt.toISOString(),
});

const toAgent = (r: typeof s.agents.$inferSelect): Agent => ({
  id: r.id,
  projectId: r.projectId,
  name: r.name,
  role: r.role as Agent['role'],
  status: r.status as Agent['status'],
  currentTaskId: r.currentTaskId,
  seat: r.seat,
  look: r.look,
});

const toTask = (r: typeof s.tasks.$inferSelect): Task => ({
  id: r.id,
  projectId: r.projectId,
  code: r.code,
  title: r.title,
  description: r.description,
  role: r.role as Task['role'],
  priority: r.priority as Task['priority'],
  status: r.status as Task['status'],
  dependsOn: r.dependsOn,
  assigneeId: r.assigneeId,
  reviewerId: r.reviewerId,
  progress: r.progress,
  output: r.output,
  estimateHours: r.estimateHours,
  startedAt: iso(r.startedAt),
  completedAt: iso(r.completedAt),
});

const toActivity = (r: typeof s.activities.$inferSelect): Activity => ({
  id: r.id,
  projectId: r.projectId,
  agentId: r.agentId,
  kind: r.kind,
  text: r.text,
  createdAt: r.createdAt.toISOString(),
});

export class Repo {
  constructor(readonly db: Db) {}

  async createProject(p: Pick<Project, 'ownerId' | 'name' | 'kind'>): Promise<Project> {
    const [row] = await this.db
      .insert(s.projects)
      .values({ id: randomUUID(), ownerId: p.ownerId, name: p.name, kind: p.kind, phase: 'consulting' })
      .returning();
    return toProject(row!);
  }

  async getProject(id: string): Promise<Project | null> {
    const [row] = await this.db.select().from(s.projects).where(eq(s.projects.id, id));
    return row ? toProject(row) : null;
  }

  async listProjects(ownerId: string): Promise<Project[]> {
    const rows = await this.db.select().from(s.projects).where(eq(s.projects.ownerId, ownerId)).orderBy(desc(s.projects.createdAt));
    return rows.map(toProject);
  }

  async listProjectsInPhase(phase: Project['phase']): Promise<Project[]> {
    return (await this.db.select().from(s.projects).where(eq(s.projects.phase, phase))).map(toProject);
  }

  async updateProject(id: string, patch: Partial<Omit<Project, 'id' | 'ownerId' | 'createdAt'>>): Promise<Project> {
    const [row] = await this.db.update(s.projects).set(patch).where(eq(s.projects.id, id)).returning();
    return toProject(row!);
  }

  async addMessage(projectId: string, author: MessageAuthor, content: string): Promise<Message> {
    const [row] = await this.db.insert(s.messages).values({ id: randomUUID(), projectId, author, content }).returning();
    return toMessage(row!);
  }

  async listMessages(projectId: string): Promise<Message[]> {
    return (await this.db.select().from(s.messages).where(eq(s.messages.projectId, projectId)).orderBy(asc(s.messages.createdAt))).map(toMessage);
  }

  async insertAgents(list: Omit<Agent, 'id'>[]): Promise<Agent[]> {
    if (!list.length) return [];
    const rows = await this.db.insert(s.agents).values(list.map((a) => ({ ...a, id: randomUUID() }))).returning();
    return rows.map(toAgent).sort((a, b) => a.seat - b.seat);
  }

  async listAgents(projectId: string): Promise<Agent[]> {
    return (await this.db.select().from(s.agents).where(eq(s.agents.projectId, projectId)).orderBy(asc(s.agents.seat))).map(toAgent);
  }

  async updateAgent(id: string, patch: Partial<Pick<Agent, 'status' | 'currentTaskId'>>): Promise<Agent> {
    const [row] = await this.db.update(s.agents).set(patch).where(eq(s.agents.id, id)).returning();
    return toAgent(row!);
  }

  async insertTasks(list: Omit<Task, 'id'>[]): Promise<Task[]> {
    if (!list.length) return [];
    const rows = await this.db
      .insert(s.tasks)
      .values(list.map((t) => ({ ...t, id: randomUUID(), startedAt: null, completedAt: null })))
      .returning();
    return rows.map(toTask);
  }

  async listTasks(projectId: string): Promise<Task[]> {
    const rows = await this.db.select().from(s.tasks).where(eq(s.tasks.projectId, projectId));
    return rows.map(toTask).sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
  }

  async updateTask(
    id: string,
    patch: Partial<Pick<Task, 'status' | 'assigneeId' | 'reviewerId' | 'progress' | 'output'>> & { startedAt?: Date | null; completedAt?: Date | null },
  ): Promise<Task> {
    const [row] = await this.db.update(s.tasks).set(patch).where(eq(s.tasks.id, id)).returning();
    return toTask(row!);
  }

  async addActivity(projectId: string, agentId: string | null, kind: string, text: string): Promise<Activity> {
    const [row] = await this.db.insert(s.activities).values({ id: randomUUID(), projectId, agentId, kind, text }).returning();
    return toActivity(row!);
  }

  async listActivities(projectId: string, limit = 50): Promise<Activity[]> {
    const rows = await this.db
      .select()
      .from(s.activities)
      .where(eq(s.activities.projectId, projectId))
      .orderBy(desc(s.activities.createdAt))
      .limit(limit);
    return rows.map(toActivity);
  }

  async snapshot(projectId: string): Promise<ProjectSnapshot | null> {
    const project = await this.getProject(projectId);
    if (!project) return null;
    const [messages, agents, tasks, activities] = await Promise.all([
      this.listMessages(projectId),
      this.listAgents(projectId),
      this.listTasks(projectId),
      this.listActivities(projectId),
    ]);
    return { project, messages, agents, tasks, activities };
  }

  async isOwner(projectId: string, userId: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: s.projects.id })
      .from(s.projects)
      .where(and(eq(s.projects.id, projectId), eq(s.projects.ownerId, userId)));
    return rows.length > 0;
  }
}
