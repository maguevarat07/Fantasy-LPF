import 'dotenv/config';
import { createApp } from './app.js';
import { startIngestionScheduler } from './ingestion/jobs.js';
import type { SqliteDatabase } from './db.js';

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? '0.0.0.0';
const app = createApp();
const ingestionScheduler = startIngestionScheduler(app.locals.db as SqliteDatabase);

const server = app.listen(port, host, () => {
  console.log(`Fantasy LPF API escuchando en http://${host}:${port}`);
});

function shutdown(signal: string): void {
  console.log(`Cerrando API por ${signal}`);
  ingestionScheduler?.stop();
  server.close(() => {
    const database = app.locals.db as { close?: () => void };
    database.close?.();
    process.exit(0);
  });
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
