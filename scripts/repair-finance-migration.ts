import pool from '../src/db/pool';
import { applyMigrations } from '../src/db/migrate';
import { config } from '../src/utils';

async function main() {
  const deleted = await pool.query(
    `DELETE FROM migrations WHERE name = '1772800000000_teacher_financial_system' RETURNING name`,
  );
  console.log('removed migration rows:', deleted.rows);

  await pool.end();

  await applyMigrations(config.DATABASE_URL, 'up');

  const verifyPool = (await import('../src/db/pool')).default;
  const t = await verifyPool.query(
    `SELECT to_regclass('public.teacher_platform_subscriptions') AS subscriptions`,
  );
  console.log('teacher_platform_subscriptions:', t.rows[0]?.subscriptions);
  await verifyPool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
