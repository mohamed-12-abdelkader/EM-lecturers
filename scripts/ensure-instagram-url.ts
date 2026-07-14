import pool from '../src/db/pool';

async function main() {
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS instagram_url TEXT`);
  const name = '1774600000000_add_teacher_instagram_url';
  const exists = await pool.query(`SELECT 1 FROM migrations WHERE name = $1`, [name]);
  if ((exists.rowCount ?? 0) === 0) {
    await pool.query(`INSERT INTO migrations (name, run_on) VALUES ($1::text, NOW())`, [name]);
  }
  const col = await pool.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_name = 'users' AND column_name = 'instagram_url'`,
  );
  console.log(col.rowCount ? '✅ instagram_url ready' : '❌ missing');
  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  await pool.end();
  process.exit(1);
});
