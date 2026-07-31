import { execSync } from 'child_process';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Prepares the dedicated test database once per e2e run. Deliberately
 * non-destructive: `migrate deploy` only applies pending migrations (never
 * drops data) and `db seed` is upsert-based, so re-running is always safe.
 * Test specs use randomized emails/codes per run instead of relying on a
 * wiped database, which avoids ever needing a destructive reset here.
 */
export default async function globalSetup(): Promise<void> {
  const envPath = path.join(__dirname, '../.env.test');
  const parsed = dotenv.parse(fs.readFileSync(envPath));
  const env = { ...process.env, ...parsed };
  const cwd = path.join(__dirname, '..');

  execSync('npx prisma migrate deploy', { stdio: 'inherit', env, cwd });
  execSync('npx prisma db seed', { stdio: 'inherit', env, cwd });
}
