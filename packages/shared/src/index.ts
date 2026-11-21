import { z } from 'zod';

/* ------------------------------------------------------------------ */
/* Fase proyek & gerbang persetujuan                                   */
/* ------------------------------------------------------------------ */

export const PHASES = [
  'consulting', // Konsultan AI menggali masalah & mengusulkan arah solusi
  'terms', // Klien menyetujui Syarat & Ketentuan
  'requirements', // Business Analyst menggali kebutuhan secara mendalam
  'planning', // Architect + PM menyusun tech stack, tim, dan task (otomatis)
  'plan_review', // Klien meninjau & menyetujui rencana
  'development', // Tim agent bekerja, dipantau realtime
  'completed',
] as const;
export type Phase = (typeof PHASES)[number];

export const PHASE_LABEL: Record<Phase, string> = {
  consulting: 'Konsultasi bisnis',
  terms: 'Syarat & Ketentuan',
  requirements: 'Analisis kebutuhan',
  planning: 'Penyusunan rencana',
  plan_review: 'Persetujuan rencana',
  development: 'Development',
  completed: 'Selesai',
};

/** Gerbang persetujuan: fase asal → fase tujuan. */
export const GATES = {
  solution: { from: 'consulting', to: 'terms' },
  terms: { from: 'terms', to: 'requirements' },
  requirements: { from: 'requirements', to: 'planning' },
  plan: { from: 'plan_review', to: 'development' },
} as const satisfies Record<string, { from: Phase; to: Phase }>;
export type Gate = keyof typeof GATES;

export const PROJECT_KINDS = ['web', 'mobile', 'saas', 'erp', 'integration', 'idea'] as const;
export type ProjectKind = (typeof PROJECT_KINDS)[number];

export const PROJECT_KIND_LABEL: Record<ProjectKind, string> = {
  web: 'Aplikasi Web',
  mobile: 'Aplikasi Mobile',
  saas: 'Produk Digital / SaaS',
  erp: 'Sistem Internal & ERP',
  integration: 'Integrasi & Otomasi',
  idea: 'Belum yakin',
};

/* ------------------------------------------------------------------ */
/* Agent & task                                                        */
/* ------------------------------------------------------------------ */

export const ROLES = ['PM', 'BE', 'FE', 'QA', 'OPS', 'UI'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  PM: 'Project Manager',
  BE: 'Backend Engineer',
  FE: 'Frontend Engineer',
  QA: 'QA Engineer',
  OPS: 'DevOps Engineer',
  UI: 'UI/UX Designer',
};

export type AgentStatus = 'working' | 'reviewing' | 'idle' | 'meeting';
export type TaskStatus = 'todo' | 'in_progress' | 'in_review' | 'done';
export type Priority = 'high' | 'medium' | 'low';

export interface Agent {
  id: string;
  projectId: string;
  name: string;
  role: Role;
  status: AgentStatus;
  currentTaskId: string | null;
  /** Indeks kursi di kantor virtual (0 = PM). */
  seat: number;
  /** Penampilan avatar, dipakai renderer kantor. */
  look: AgentLook;
}

export interface AgentLook {
  skin: string;
  hair: string;
  shirt: string;
  hairStyle: 'short' | 'long' | 'bun' | 'curly' | 'hijab';
}

export interface Task {
  id: string;
  projectId: string;
  code: string; // T-01
  title: string;
  description: string;
  role: Role;
  priority: Priority;
  status: TaskStatus;
  dependsOn: string[]; // kode task
  assigneeId: string | null;
  reviewerId: string | null;
  progress: number; // 0..100
  output: string | null; // hasil kerja agent (markdown)
  estimateHours: number;
  startedAt: string | null;
  completedAt: string | null;
}

/* ------------------------------------------------------------------ */
/* Hasil kerja agent fase awal                                         */
/* ------------------------------------------------------------------ */

export const solutionSchema = z.object({
  summary: z.string().min(1),
  modules: z.array(z.object({ title: z.string(), description: z.string() })).min(1).max(8),
});
export type Solution = z.infer<typeof solutionSchema>;

export const requirementsSchema = z.object({
  summary: z.string().min(1),
  userRoles: z.array(z.string()).min(1),
  functional: z.array(z.string()).min(1),
  nonFunctional: z.array(z.string()),
  businessRules: z.array(z.string()),
  successCriteria: z.array(z.string()),
});
export type Requirements = z.infer<typeof requirementsSchema>;

export const planTaskSchema = z.object({
  code: z.string().regex(/^T-\d{2,3}$/),
  title: z.string().min(1),
  description: z.string(),
  role: z.enum(ROLES),
  priority: z.enum(['high', 'medium', 'low']),
  dependsOn: z.array(z.string()),
  estimateHours: z.number().positive().max(80),
});

export const planSchema = z.object({
  techStack: z.array(z.object({ layer: z.string(), choice: z.string(), reason: z.string() })).min(1),
  architecture: z.string(),
  team: z
    .array(z.object({ role: z.enum(ROLES), count: z.number().int().min(1).max(6) }))
    .min(1),
  tasks: z.array(planTaskSchema).min(1).max(60),
  milestones: z.array(z.object({ name: z.string(), deliverables: z.array(z.string()) })),
});
export type Plan = z.infer<typeof planSchema>;
export type PlanTask = z.infer<typeof planTaskSchema>;

export const MAX_TEAM_SIZE = 10;

/* ------------------------------------------------------------------ */
/* Proyek, pesan, aktivitas                                            */
/* ------------------------------------------------------------------ */

export type Classification = 'public' | 'internal' | 'confidential';

export interface Project {
  id: string;
  ownerId: string;
  name: string;
  kind: ProjectKind;
  phase: Phase;
  classification: Classification;
  facts: Record<string, string>;
  solution: Solution | null;
  requirements: Requirements | null;
  plan: Plan | null;
  /** Gerbang yang sedang menunggu persetujuan klien, bila ada. */
  pendingGate: Gate | null;
  createdAt: string;
}

export type MessageAuthor = 'client' | 'consultant' | 'analyst' | 'architect' | 'pm' | 'system';

export interface Message {
  id: string;
  projectId: string;
  author: MessageAuthor;
  content: string;
  createdAt: string;
}

export interface Activity {
  id: string;
  projectId: string;
  agentId: string | null;
  kind: string;
  text: string;
  createdAt: string;
}

export interface ProjectSnapshot {
  project: Project;
  messages: Message[];
  agents: Agent[];
  tasks: Task[];
  activities: Activity[];
}

/* ------------------------------------------------------------------ */
/* Event realtime (server → klien via WebSocket)                       */
/* ------------------------------------------------------------------ */

export type ServerEvent =
  | { type: 'snapshot'; data: ProjectSnapshot }
  | { type: 'project'; data: Project }
  | { type: 'message'; data: Message }
  | { type: 'agent'; data: Agent }
  | { type: 'task'; data: Task }
  | { type: 'activity'; data: Activity }
  | { type: 'typing'; data: { author: MessageAuthor; typing: boolean } };

/* ------------------------------------------------------------------ */
/* Payload API                                                         */
/* ------------------------------------------------------------------ */

export const credentialsSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(10).max(200),
  name: z.string().min(1).max(100).optional(),
});

export const createProjectSchema = z.object({
  name: z.string().min(3).max(120),
  kind: z.enum(PROJECT_KINDS),
});

export const sendMessageSchema = z.object({
  content: z.string().min(1).max(4000),
});

export const approveSchema = z.object({
  gate: z.enum(['solution', 'terms', 'requirements', 'plan']),
  /** Versi dokumen S&K yang disetujui (wajib untuk gerbang terms). */
  termsVersion: z.string().optional(),
});

export const TERMS_VERSION = '2.3';
