import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), `.env.${process.env.NODE_ENV || 'development'}`) });
dotenv.config();

async function main() {
  const { default: pool } = await import('../src/db/pool.js');

  const q = process.argv[2] || 'حنين';
  const users = await pool.query(
    `SELECT id, name, email, phone, deleted_at
     FROM users
     WHERE name ILIKE $1 OR email ILIKE $1 OR COALESCE(phone,'') ILIKE $1
     ORDER BY id DESC
     LIMIT 50`,
    [`%${q}%`],
  );
  console.log('users:', users.rows);

  const archived = await pool.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema='public' AND table_name ILIKE '%point%'`
  );
  console.log('point tables:', archived.rows);

  // sample of all student names that have points history in seasons
  try {
    const seasonStudents = await pool.query(
      `SELECT DISTINCT b.student_id, u.name
       FROM point_season_balances b
       JOIN users u ON u.id = b.student_id
       WHERE u.name ILIKE $1
       LIMIT 20`,
      [`%${q}%`],
    );
    console.log('season balances match:', seasonStudents.rows);
  } catch (e: any) {
    console.log('season search skip:', e.message);
  }

  const allTeachers = await pool.query(
    `SELECT id, name, role FROM users WHERE role IN ('teacher','academy') ORDER BY id`,
  );
  console.log('teachers:', allTeachers.rows);

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
