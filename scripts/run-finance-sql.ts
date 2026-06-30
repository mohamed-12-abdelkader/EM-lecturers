import fs from 'node:fs';
import path from 'node:path';
import pool from '../src/db/pool';

async function main() {
  const file = path.join(
    process.cwd(),
    'migrations/1772800000000_teacher_financial_system.sql',
  );
  const raw = fs.readFileSync(file, 'utf8');
  const up = raw.split('-- Down Migration')[0].trim();

  console.log('Running UP SQL length:', up.length);
  try {
    await pool.query(up);
    console.log('SQL executed OK');
  } catch (e: any) {
    console.error('SQL error:', e.message);
    console.error('detail:', e.detail);
    console.error('position:', e.position);
  }

  const t = await pool.query(
    `SELECT to_regclass('public.teacher_subscription_plans') AS plans`,
  );
  console.log('plans table:', t.rows[0]);

  await pool.end();
}

main();
