import pool from '../src/db/pool';
import fs from 'node:fs';
import path from 'node:path';

async function main() {
  const sqlPath = path.resolve('migrations/1774700000000_course_grades_many.sql');
  const raw = fs.readFileSync(sqlPath, 'utf8');
  const up = raw.split(/--\s*Down Migration/i)[0].replace(/^--\s*Up Migration/i, '');
  await pool.query(up);

  const name = '1774700000000_course_grades_many';
  const exists = await pool.query(`SELECT 1 FROM migrations WHERE name = $1`, [name]);
  if ((exists.rowCount ?? 0) === 0) {
    await pool.query(`INSERT INTO migrations (name, run_on) VALUES ($1::text, NOW())`, [name]);
  }

  const count = await pool.query(`SELECT COUNT(*)::int AS c FROM course_grades`);
  console.log(`✅ course_grades ready — rows: ${count.rows[0].c}`);
  await pool.end();
}

main().catch(async (e) => {
  console.error('❌', e.message || e);
  await pool.end();
  process.exit(1);
});
