import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { openDb } from './db/client.js';

const config = loadConfig();
const handle = await openDb({ databaseUrl: config.databaseUrl, pgliteDir: config.pgliteDir });
const { app, engine, llm } = await buildApp(config, handle.db, { logger: true });

engine.start();
await app.listen({ port: config.port, host: config.host });
app.log.info(`AI Office server siap · LLM mode: ${llm.mode} · DB: ${config.databaseUrl ? 'PostgreSQL' : 'PGlite'}`);

const shutdown = async () => {
  engine.stop();
  await app.close();
  await handle.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
