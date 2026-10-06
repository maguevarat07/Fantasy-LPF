/** Keep integration fixtures out of the live Fantasy LPF database. */
export function isolatedPostgresTestUrl(): string | undefined {
  const value = process.env.POSTGRES_TEST_URL;
  if (!value) return undefined;
  if (process.env.POSTGRES_TEST_ISOLATED !== 'true') {
    throw new Error('POSTGRES_TEST_ISOLATED=true is required for PostgreSQL fixture tests.');
  }
  const target = new URL(value);
  const project = (url: URL) => url.username.match(/^postgres\.(.+)$/)?.[1]
    ?? url.hostname.match(/^db\.([^.]+)\.supabase\.co$/)?.[1];
  for (const candidate of [process.env.DATABASE_URL, process.env.DIRECT_URL]) {
    if (!candidate) continue;
    const live = new URL(candidate);
    const sameProject = project(target) && project(target) === project(live);
    const sameDatabase = target.hostname === live.hostname
      && target.username === live.username && target.pathname === live.pathname;
    if (sameProject || sameDatabase) {
      throw new Error('POSTGRES_TEST_URL targets the configured production database.');
    }
  }
  return value;
}
