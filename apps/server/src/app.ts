import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import { ZodError } from 'zod';
import {
  approveSchema,
  createProjectSchema,
  credentialsSchema,
  sendMessageSchema,
  type ServerEvent,
} from '@ai-office/shared';
import type { Config } from './config.js';
import type { Db } from './db/client.js';
import { createLLM, type LLM } from './llm/index.js';
import { EventBus } from './orchestrator/bus.js';
import { Engine } from './orchestrator/engine.js';
import { GateError, ProjectService } from './orchestrator/projectService.js';
import { AuditLog } from './security/audit.js';
import { AuthError, AuthService, type PublicUser } from './security/auth.js';
import { Repo } from './store/repo.js';

const SESSION_COOKIE = 'aio_session';

declare module 'fastify' {
  interface FastifyRequest {
    user: PublicUser | null;
  }
}

export interface AppDeps {
  app: FastifyInstance;
  repo: Repo;
  engine: Engine;
  service: ProjectService;
  audit: AuditLog;
  bus: EventBus;
  llm: LLM;
}

export async function buildApp(config: Config, db: Db, opts: { llm?: LLM; logger?: boolean } = {}): Promise<AppDeps> {
  const app = Fastify({
    logger: opts.logger ?? false,
    trustProxy: true,
    bodyLimit: 64 * 1024,
  });
  const repo = new Repo(db);
  const bus = new EventBus();
  const audit = new AuditLog(db);
  const llm = opts.llm ?? createLLM(config.anthropicApiKey, config.anthropicModel);
  const engine = new Engine(repo, bus, llm, audit, { tickMs: config.tickMs, mockProgressStep: config.mockProgressStep });
  const service = new ProjectService(repo, bus, llm, audit, engine);
  const auth = new AuthService(db, config.sessionTtlHours);

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cookie);
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });
  await app.register(websocket);

  app.decorateRequest('user', null);
  app.addHook('onRequest', async (req) => {
    req.user = await auth.resolveSession(req.cookies[SESSION_COOKIE]);
  });

  // Hanya terima JSON pada request yang mengubah data (mitigasi CSRF bersama SameSite=Strict).
  app.addHook('preValidation', async (req, reply) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && !String(req.headers['content-type'] ?? '').includes('application/json')) {
      return reply.code(415).send({ error: 'Content-Type harus application/json' });
    }
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) return reply.code(400).send({ error: 'Input tidak valid', issues: err.issues.map((i) => i.message) });
    if (err instanceof GateError) return reply.code(409).send({ error: err.message });
    if (err instanceof AuthError) {
      const code = err.code === 'EMAIL_TAKEN' ? 409 : err.code === 'LOCKED' ? 423 : 401;
      return reply.code(code).send({ error: err.message });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.code(status).send({ error: (err as Error).message });
    req.log.error(err);
    return reply.code(500).send({ error: 'Terjadi kesalahan pada server' });
  });

  const requireUser = (req: FastifyRequest, reply: FastifyReply): PublicUser | null => {
    if (!req.user) {
      void reply.code(401).send({ error: 'Silakan masuk terlebih dahulu' });
      return null;
    }
    return req.user;
  };

  /** Hanya pemilik proyek yang boleh mengakses datanya (A.5.15 / A.8.3). */
  const requireProject = async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const user = requireUser(req, reply);
    if (!user) return null;
    if (!(await repo.isOwner(req.params.id, user.id))) {
      void reply.code(404).send({ error: 'Proyek tidak ditemukan' });
      return null;
    }
    return user;
  };

  const setSession = async (reply: FastifyReply, userId: string) => {
    const s = await auth.createSession(userId);
    reply.setCookie(SESSION_COOKIE, s.token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: config.cookieSecure,
      path: '/',
      expires: s.expiresAt,
    });
  };

  app.get('/api/health', async () => ({ ok: true, llm: llm.mode }));

  /* ---------------- Auth ---------------- */
  const authLimit = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

  app.post('/api/auth/register', authLimit, async (req, reply) => {
    const body = credentialsSchema.parse(req.body);
    const user = await auth.register(body.email, body.password, body.name ?? body.email.split('@')[0]!);
    await audit.record({ actorType: 'user', actorId: user.id, action: 'auth.register', ip: req.ip });
    await setSession(reply, user.id);
    return reply.code(201).send({ user });
  });

  app.post('/api/auth/login', authLimit, async (req, reply) => {
    const body = credentialsSchema.parse(req.body);
    try {
      const user = await auth.login(body.email, body.password);
      await audit.record({ actorType: 'user', actorId: user.id, action: 'auth.login', ip: req.ip });
      await setSession(reply, user.id);
      return { user };
    } catch (err) {
      await audit.record({ actorType: 'user', action: 'auth.login_failed', detail: { email: body.email.toLowerCase() }, ip: req.ip });
      throw err;
    }
  });

  app.post('/api/auth/logout', async (req, reply) => {
    await auth.destroySession(req.cookies[SESSION_COOKIE]);
    if (req.user) await audit.record({ actorType: 'user', actorId: req.user.id, action: 'auth.logout', ip: req.ip });
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', async (req) => ({ user: req.user }));

  /* ---------------- Proyek ---------------- */
  app.get('/api/projects', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    return { projects: await repo.listProjects(user.id) };
  });

  app.post('/api/projects', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const body = createProjectSchema.parse(req.body);
    const project = await service.create(user.id, body.name, body.kind, req.ip);
    return reply.code(201).send({ project });
  });

  app.get<{ Params: { id: string } }>('/api/projects/:id', async (req, reply) => {
    if (!(await requireProject(req, reply))) return;
    return repo.snapshot(req.params.id);
  });

  app.post<{ Params: { id: string } }>('/api/projects/:id/messages', async (req, reply) => {
    const user = await requireProject(req, reply);
    if (!user) return;
    const body = sendMessageSchema.parse(req.body);
    // Diproses asinkron; balasan agent tiba lewat WebSocket.
    void service.handleMessage(req.params.id, user.id, body.content).catch((err) => req.log.error(err));
    return reply.code(202).send({ accepted: true });
  });

  app.post<{ Params: { id: string } }>('/api/projects/:id/approvals', async (req, reply) => {
    const user = await requireProject(req, reply);
    if (!user) return;
    const body = approveSchema.parse(req.body);
    const project = await service.approve(req.params.id, user.id, body.gate, req.ip, body.termsVersion);
    return { project };
  });

  /* ---------------- Realtime ---------------- */
  app.get<{ Params: { id: string } }>('/api/projects/:id/ws', { websocket: true }, async (socket, req) => {
    // Cegah Cross-Site WebSocket Hijacking: browser wajib dari origin web yang diizinkan.
    const origin = req.headers.origin;
    if (origin && origin !== config.webOrigin) {
      socket.close(4403, 'forbidden origin');
      return;
    }
    if (!req.user || !(await repo.isOwner(req.params.id, req.user.id))) {
      socket.close(4401, 'unauthorized');
      return;
    }
    const send = (e: ServerEvent) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(e));
    };
    const snapshot = await repo.snapshot(req.params.id);
    if (snapshot) send({ type: 'snapshot', data: snapshot });
    const unsubscribe = bus.subscribe(req.params.id, send);
    socket.on('close', unsubscribe);
  });

  return { app, repo, engine, service, audit, bus, llm };
}
