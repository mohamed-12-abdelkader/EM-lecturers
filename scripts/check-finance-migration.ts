import pool from '../src/db/pool';

async function main() {
  const m = await pool.query(
    `SELECT name, run_on FROM migrations
     WHERE name LIKE '%177280%' OR name LIKE '%financial%'
     ORDER BY run_on DESC`,
  );
  console.log('migrations:', m.rows);

  const t = await pool.query(
    `SELECT
       to_regclass('public.teacher_platform_subscriptions') AS subscriptions,
       to_regclass('public.teacher_subscription_plans') AS plans`,
  );
  console.log('tables:', t.rows[0]);

  const last = await pool.query(`SELECT name FROM migrations ORDER BY run_on DESC LIMIT 8`);
  console.log('last migrations:', last.rows);

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
