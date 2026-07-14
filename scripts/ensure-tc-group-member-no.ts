/**
 * Ensures tc_student_groups.member_no + tc_group_member_seq exist.
 * Run: npx cross-env NODE_ENV=development tsx scripts/ensure-tc-group-member-no.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import pool from '../src/db/pool';

async function main() {
  const sqlPath = path.resolve(
    process.cwd(),
    'migrations/1774800000000_tc_group_member_no.sql',
  );
  const sql = fs.readFileSync(sqlPath, 'utf8');
  await pool.query(sql);

  try {
    await pool.query(
      `INSERT INTO migrations (name, run_on)
       SELECT $1, NOW()
       WHERE NOT EXISTS (SELECT 1 FROM migrations WHERE name = $1)`,
      ['1774800000000_tc_group_member_no'],
    );
  } catch (err: any) {
    console.warn('⚠️  Could not record migration row:', err.message);
  }

  const col = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_name = 'tc_student_groups' AND column_name = 'member_no'
     ) AS exists`,
  );
  if (!col.rows[0]?.exists) throw new Error('member_no column missing');

  console.log('✅ tc group member_no ready (per-group ids start at 1)');
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
