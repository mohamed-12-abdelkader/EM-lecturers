import pool from '../src/db/pool';

async function main() {
  const tables = await pool.query(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name LIKE 'tc_%'
     ORDER BY 1`,
  );
  console.log(
    'tc tables:',
    tables.rows.map((r) => r.table_name),
  );

  const wiped = await pool.query(
    `DELETE FROM migrations
     WHERE name LIKE '1774300000000_remove_teacher_center_mgmt%'
     RETURNING name`,
  );
  if ((wiped.rowCount ?? 0) > 0) {
    console.log(
      '✅ Removed wipe migration record:',
      wiped.rows.map((r) => r.name),
    );
  } else {
    console.log('ℹ️  No wipe migration record to remove');
  }

  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  await pool.end();
  process.exit(1);
});
