/**
 * Run Drizzle migrations against DATABASE_URL.
 * Usage: pnpm db:migrate
 */
import 'dotenv/config';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Client } from 'pg';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const MIGRATIONS_DIR = join(process.cwd(), 'src/db/migrations');

async function main() {
  const client = new Client({ connectionString: url });
  await client.connect();

  await client.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const all = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const { rows: applied } = await client.query<{ filename: string }>(
    'SELECT filename FROM _migrations',
  );
  const seen = new Set(applied.map((r) => r.filename));

  for (const file of all) {
    if (seen.has(file)) {
      console.log(`✓ ${file} (already applied)`);
      continue;
    }
    const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
    console.log(`→ applying ${file}`);
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO _migrations (filename) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`✓ ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`✗ ${file}`, err);
      process.exit(1);
    }
  }

  await client.end();
  console.log('Migrations complete.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
