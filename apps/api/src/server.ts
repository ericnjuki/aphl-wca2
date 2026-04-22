import app from './app';
import env from './config/env';
import { getDb, persistDb } from './db/database';
import { runMigrations } from './db/migrations';
import { runSeed } from './db/seed';
import { backfillResponses } from './scripts/backfill-responses';

async function start(): Promise<void> {
  // Initialise database and run any pending migrations.
  const db = await getDb();
  await runMigrations(db);
  await runSeed(db);
  backfillResponses();
  persistDb();

  const server = app.listen(env.port, () => {
    console.log(`[server] running on http://localhost:${env.port} (${env.nodeEnv})`);
  });

  // Graceful shutdown: persist DB and close the HTTP server.
  const shutdown = (signal: string) => {
    console.log(`\n[server] received ${signal}, shutting down…`);
    persistDb();
    server.close(() => {
      console.log('[server] closed');
      process.exit(0);
    });

    // Force-exit if graceful shutdown takes too long.
    setTimeout(() => process.exit(1), 5000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start().catch((err) => {
  console.error('[server] startup failed:', err);
  process.exit(1);
});
