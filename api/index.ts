import { createApp } from '../server/app.js';
import { getPostgresDatabase } from '../server/postgres/client.js';

// Vercel keeps imported modules warm when possible, so construct the Express app once per
// function instance. The local entry point in server/index.ts remains responsible for listen().
const app = createApp({
  postgresDb: getPostgresDatabase(),
  secureCookies: true,
});

export default app;
