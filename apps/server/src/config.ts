/**
 * Konfigurasi dari environment. Rahasia (API key, DATABASE_URL) tidak pernah
 * di-hardcode atau dicatat ke log (ISO 27001 A.8.24 / A.5.33).
 */
export interface Config {
  port: number;
  host: string;
  /** postgres://... untuk produksi; kosong = PGlite (Postgres in-process) untuk dev/test. */
  databaseUrl: string | null;
  /** Folder data PGlite; 'memory://' untuk test. */
  pgliteDir: string;
  anthropicApiKey: string | null;
  anthropicModel: string;
  /** Interval tick orkestrator (ms). */
  tickMs: number;
  /** Progres per tick saat mode mock (persen). */
  mockProgressStep: number;
  webOrigin: string;
  cookieSecure: boolean;
  sessionTtlHours: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: Number(env.PORT ?? 4000),
    host: env.HOST ?? '0.0.0.0',
    databaseUrl: env.DATABASE_URL || null,
    pgliteDir: env.PGLITE_DIR ?? './.data/pglite',
    anthropicApiKey: env.ANTHROPIC_API_KEY || null,
    anthropicModel: env.ANTHROPIC_MODEL ?? 'claude-sonnet-5-5',
    tickMs: Number(env.TICK_MS ?? 1500),
    mockProgressStep: Number(env.MOCK_PROGRESS_STEP ?? 12),
    webOrigin: env.WEB_ORIGIN ?? 'http://localhost:3000',
    cookieSecure: env.NODE_ENV === 'production',
    sessionTtlHours: Number(env.SESSION_TTL_HOURS ?? 12),
  };
}
