import { createApp } from '../server/app.js';
import { getAdminPostgresDatabase, getPostgresDatabase } from '../server/postgres/client.js';

// Vercel keeps imported modules warm when possible, so construct the Express app once per
// function instance. The local entry point in server/index.ts remains responsible for listen().
const app = createApp({
  postgresDb: getPostgresDatabase(),
  adminPostgresDb: getAdminPostgresDatabase(),
  secureCookies: true,
});

export default app;
