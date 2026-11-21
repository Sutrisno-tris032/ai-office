import type { Gate, Project, ProjectKind, ProjectSnapshot } from "@ai-office/shared";

export interface User {
  id: string;
  email: string;
  name: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Permintaan gagal (${res.status})`);
  return data as T;
}

export const api = {
  me: () => request<{ user: User | null }>("GET", "/api/auth/me"),
  register: (email: string, password: string, name: string) =>
    request<{ user: User }>("POST", "/api/auth/register", { email, password, name }),
  login: (email: string, password: string) => request<{ user: User }>("POST", "/api/auth/login", { email, password }),
  logout: () => request<{ ok: true }>("POST", "/api/auth/logout", {}),
  projects: () => request<{ projects: Project[] }>("GET", "/api/projects"),
  createProject: (name: string, kind: ProjectKind) => request<{ project: Project }>("POST", "/api/projects", { name, kind }),
  snapshot: (id: string) => request<ProjectSnapshot>("GET", `/api/projects/${id}`),
  send: (id: string, content: string) => request<{ accepted: true }>("POST", `/api/projects/${id}/messages`, { content }),
  approve: (id: string, gate: Gate, termsVersion?: string) =>
    request<{ project: Project }>("POST", `/api/projects/${id}/approvals`, { gate, termsVersion }),
};

/** WebSocket langsung ke server API (Next rewrites tidak meneruskan upgrade WebSocket). */
export function wsUrl(projectId: string): string {
  const base = process.env.NEXT_PUBLIC_WS_BASE;
  if (base) return `${base}/api/projects/${projectId}/ws`;
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  const host = window.location.port === "3000" ? `${window.location.hostname}:4000` : window.location.host;
  return `${proto}://${host}/api/projects/${projectId}/ws`;
}
