import 'dotenv/config';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPostgresDatabase } from '../server/postgres/client.js';
import { createHttpPostgresDatabase, runHttpTransaction } from './httpPostgresClient.js';

async function main() {
  const directory = resolve(process.cwd(), 'supabase', 'migrations');
  const files = (await readdir(directory)).filter(file => file.endsWith('.sql')).sort();
  const useHttp = Boolean(process.env.MIGRATION_HTTP_URL);
  const db = useHttp
    ? createHttpPostgresDatabase()
    : createPostgresDatabase({ url: process.env.DIRECT_URL ?? process.env.DATABASE_URL });
  try {
    await db.execute(`create table if not exists app_schema_migrations(
      version text primary key, checksum text not null, applied_at timestamptz not null default now()
    )`);
    for (const file of files) {
      const sql = await readFile(resolve(directory, file), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const applied = await db.maybeOne<{ checksum: string }>(
        'select checksum from app_schema_migrations where version=$1', [file]);
      if (applied) {
        if (applied.checksum !== checksum) throw new Error(`La migración aplicada ${file} cambió de contenido.`);
        process.stdout.write(`SKIP ${file}\n`);
        continue;
      }
      if (useHttp) {
        await runHttpTransaction([
          { text: sql },
          { text: 'insert into app_schema_migrations(version,checksum) values($1,$2)', parameters: [file, checksum] },
        ]);
      } else {
        await db.transaction(async tx => {
          await tx.execute(sql);
          await tx.execute('insert into app_schema_migrations(version,checksum) values($1,$2)', [file, checksum]);
        });
      }
      process.stdout.write(`APPLIED ${file}\n`);
    }
  } finally {
    await db.close();
  }
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
