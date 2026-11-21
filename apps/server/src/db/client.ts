import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { drizzle as drizzlePostgres, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { PGlite } from '@electric-sql/pglite';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import { mkdirSync } from 'node:fs';
import { schema } from './schema.js';

export type Db = PostgresJsDatabase<typeof schema>;

export interface DbHandle {
  db: Db;
  close: () => Promise<void>;
}

const MIGRATION = `
CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  password_hash text NOT NULL,
  failed_logins integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS projects (
  id text PRIMARY KEY,
  owner_id text NOT NULL REFERENCES users(id),
  name text NOT NULL,
  kind text NOT NULL,
  phase text NOT NULL,
  classification text NOT NULL DEFAULT 'confidential',
  facts jsonb NOT NULL DEFAULT '{}'::jsonb,
  solution jsonb,
  requirements jsonb,
  plan jsonb,
  pending_gate text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS projects_owner_idx ON projects(owner_id);
CREATE TABLE IF NOT EXISTS messages (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  author text NOT NULL,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_project_idx ON messages(project_id, created_at);
CREATE TABLE IF NOT EXISTS agents (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  role text NOT NULL,
  status text NOT NULL,
  current_task_id text,
  seat integer NOT NULL,
  look jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  code text NOT NULL,
  title text NOT NULL,
  description text NOT NULL,
  role text NOT NULL,
  priority text NOT NULL,
  status text NOT NULL,
  depends_on jsonb NOT NULL DEFAULT '[]'::jsonb,
  assignee_id text,
  reviewer_id text,
  progress integer NOT NULL DEFAULT 0,
  output text,
  estimate_hours integer NOT NULL,
  started_at timestamptz,
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS tasks_project_idx ON tasks(project_id);
CREATE TABLE IF NOT EXISTS activities (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  agent_id text,
  kind text NOT NULL,
  text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS activities_project_idx ON activities(project_id, created_at);
CREATE TABLE IF NOT EXISTS audit_log (
  seq serial PRIMARY KEY,
  project_id text,
  actor_type text NOT NULL,
  actor_id text,
  action text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip text,
  created_at timestamptz NOT NULL DEFAULT now(),
  prev_hash text NOT NULL,
  hash text NOT NULL
);
CREATE OR REPLACE FUNCTION audit_log_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log bersifat append-only';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS audit_log_no_update ON audit_log;
CREATE TRIGGER audit_log_no_update BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();
`;

export async function openDb(opts: { databaseUrl: string | null; pgliteDir: string }): Promise<DbHandle> {
  if (opts.databaseUrl) {
    const client = postgres(opts.databaseUrl, { max: 10 });
    const db = drizzlePostgres(client, { schema });
    await db.execute(sql.raw(MIGRATION));
    return { db, close: () => client.end() };
  }
  if (!opts.pgliteDir.startsWith('memory://')) mkdirSync(opts.pgliteDir, { recursive: true });
  const client = new PGlite(opts.pgliteDir);
  await client.exec(MIGRATION);
  const db = drizzlePglite(client, { schema }) as unknown as Db;
  return { db, close: () => client.close() };
}
