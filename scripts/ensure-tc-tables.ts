/**
 * Ensures Teacher Center (tc_*) tables exist.
 * Uses the app pool (ssl rejectUnauthorized: false).
 *
 * Run: npx cross-env NODE_ENV=development tsx scripts/ensure-tc-tables.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import pool from '../src/db/pool';

async function main() {
  const check = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'tc_groups'
     ) AS exists`,
  );

  if (check.rows[0]?.exists) {
    console.log('✅ tc_groups already exists — nothing to do');
    await pool.end();
    return;
  }

  console.log('⏳ tc_* tables missing — applying migration SQL...');

  const sqlPath = path.resolve(
    process.cwd(),
    'migrations/1774200000000_teacher_center_mgmt.sql',
  );
  const raw = fs.readFileSync(sqlPath, 'utf8');
  const upSql = raw.split(/--\s*Down Migration/i)[0].replace(/^--\s*Up Migration/i, '');

  await pool.query(upSql);

  // Mark migration as applied if migrations table exists and row missing
  try {
    await pool.query(
      `INSERT INTO migrations (name, run_on)
       SELECT $1, NOW()
       WHERE NOT EXISTS (SELECT 1 FROM migrations WHERE name = $1)`,
      ['1774200000000_teacher_center_mgmt'],
    );
  } catch (err: any) {
    console.warn('⚠️  Could not record migration row:', err.message);
  }

  const verify = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'tc_groups'
     ) AS exists`,
  );

  if (!verify.rows[0]?.exists) {
    throw new Error('tc_groups still missing after applying SQL');
  }

  console.log('✅ Teacher Center tables created successfully');
  await pool.end();
}

main().catch(async (err) => {
  console.error('❌ Failed:', err.message || err);
  try {
    await pool.end();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
