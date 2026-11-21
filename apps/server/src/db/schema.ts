import { integer, jsonb, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';
import type {
  AgentLook,
  Gate,
  Plan,
  Requirements,
  Solution,
} from '@ai-office/shared';

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  failedLogins: integer('failed_logins').notNull().default(0),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable('sessions', {
  /** SHA-256 dari token; token mentah hanya ada di cookie klien. */
  tokenHash: text('token_hash').primaryKey(),
  userId: text('user_id').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const projects = pgTable('projects', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id').notNull(),
  name: text('name').notNull(),
  kind: text('kind').notNull(),
  phase: text('phase').notNull(),
  classification: text('classification').notNull().default('confidential'),
  facts: jsonb('facts').$type<Record<string, string>>().notNull().default({}),
  solution: jsonb('solution').$type<Solution | null>(),
  requirements: jsonb('requirements').$type<Requirements | null>(),
  plan: jsonb('plan').$type<Plan | null>(),
  pendingGate: text('pending_gate').$type<Gate | null>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const messages = pgTable('messages', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  author: text('author').notNull(),
  content: text('content').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const agents = pgTable('agents', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  name: text('name').notNull(),
  role: text('role').notNull(),
  status: text('status').notNull(),
  currentTaskId: text('current_task_id'),
  seat: integer('seat').notNull(),
  look: jsonb('look').$type<AgentLook>().notNull(),
});

export const tasks = pgTable('tasks', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  code: text('code').notNull(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  role: text('role').notNull(),
  priority: text('priority').notNull(),
  status: text('status').notNull(),
  dependsOn: jsonb('depends_on').$type<string[]>().notNull().default([]),
  assigneeId: text('assignee_id'),
  reviewerId: text('reviewer_id'),
  progress: integer('progress').notNull().default(0),
  output: text('output'),
  estimateHours: integer('estimate_hours').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});

export const activities = pgTable('activities', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  agentId: text('agent_id'),
  kind: text('kind').notNull(),
  text: text('text').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Audit trail append-only dengan hash berantai (ISO 27001 A.8.15). */
export const auditLog = pgTable('audit_log', {
  seq: serial('seq').primaryKey(),
  projectId: text('project_id'),
  actorType: text('actor_type').notNull(), // user | agent | system
  actorId: text('actor_id'),
  action: text('action').notNull(),
  detail: jsonb('detail').$type<Record<string, unknown>>().notNull().default({}),
  ip: text('ip'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  prevHash: text('prev_hash').notNull(),
  hash: text('hash').notNull(),
});

export const schema = { users, sessions, projects, messages, agents, tasks, activities, auditLog };
