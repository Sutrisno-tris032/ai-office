import { createHash, randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { and, eq, gt } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { sessions, users } from '../db/schema.js';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, keylen: number, opts: object) => Promise<Buffer>;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64, SCRYPT);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, saltB64, keyB64] = stored.split('$');
  if (algo !== 'scrypt' || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, 'base64');
  const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, SCRYPT);
  return timingSafeEqual(expected, actual);
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export interface PublicUser {
  id: string;
  email: string;
  name: string;
}

export class AuthService {
  constructor(
    private readonly db: Db,
    private readonly ttlHours: number,
  ) {}

  async register(email: string, password: string, name: string): Promise<PublicUser> {
    const normalized = email.trim().toLowerCase();
    const existing = await this.db.select({ id: users.id }).from(users).where(eq(users.email, normalized));
    if (existing.length) throw new AuthError('EMAIL_TAKEN', 'Email sudah terdaftar');
    const user = { id: randomUUID(), email: normalized, name, passwordHash: await hashPassword(password) };
    await this.db.insert(users).values(user);
    return { id: user.id, email: user.email, name: user.name };
  }

  /** Login dengan penguncian akun setelah 5 kali gagal (A.8.5). */
  async login(email: string, password: string): Promise<PublicUser> {
    const normalized = email.trim().toLowerCase();
    const [u] = await this.db.select().from(users).where(eq(users.email, normalized));
    if (!u) {
      await hashPassword(password); // samakan waktu respons
      throw new AuthError('INVALID', 'Email atau kata sandi salah');
    }
    if (u.lockedUntil && u.lockedUntil > new Date()) {
      throw new AuthError('LOCKED', 'Akun dikunci sementara karena terlalu banyak percobaan gagal');
    }
    if (!(await verifyPassword(password, u.passwordHash))) {
      const failed = u.failedLogins + 1;
      await this.db
        .update(users)
        .set({
          failedLogins: failed >= MAX_FAILED ? 0 : failed,
          lockedUntil: failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null,
        })
        .where(eq(users.id, u.id));
      throw new AuthError('INVALID', 'Email atau kata sandi salah');
    }
    await this.db.update(users).set({ failedLogins: 0, lockedUntil: null }).where(eq(users.id, u.id));
    return { id: u.id, email: u.email, name: u.name };
  }

  async createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + this.ttlHours * 3_600_000);
    await this.db.insert(sessions).values({ tokenHash: sha256(token), userId, expiresAt });
    return { token, expiresAt };
  }

  async resolveSession(token: string | undefined): Promise<PublicUser | null> {
    if (!token) return null;
    const rows = await this.db
      .select({ id: users.id, email: users.email, name: users.name })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, new Date())));
    return rows[0] ?? null;
  }

  async destroySession(token: string | undefined): Promise<void> {
    if (token) await this.db.delete(sessions).where(eq(sessions.tokenHash, sha256(token)));
  }
}

export class AuthError extends Error {
  constructor(
    readonly code: 'EMAIL_TAKEN' | 'INVALID' | 'LOCKED',
    message: string,
  ) {
    super(message);
  }
}
