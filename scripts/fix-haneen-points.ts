import pool from '../src/db/pool';

async function main() {
  const users = await pool.query(
    `SELECT id, name, role, managed_by_teacher_id, tenant_id
     FROM users
     WHERE name ILIKE '%حنين%' OR name ILIKE '%جليله%' OR name ILIKE '%ياسر%'
     ORDER BY id`,
  );
  console.log('users', users.rows);

  for (const u of users.rows) {
    const tx = await pool.query(
      `SELECT id, teacher_id, event_type, reference_type, reference_id, points, grade_id,
              metadata->>'title' AS title, created_at
       FROM point_transactions
       WHERE student_id = $1
       ORDER BY created_at DESC, id DESC`,
      [u.id],
    );
    console.log(`\n=== student ${u.id} ${u.name} tx=${tx.rowCount} ===`);
    console.log(JSON.stringify(tx.rows, null, 2));

    const bal = await pool.query(
      `SELECT * FROM student_point_balances WHERE student_id = $1`,
      [u.id],
    );
    console.log('balances', bal.rows);

    const enroll = await pool.query(
      `SELECT e.course_id, c.title, c.teacher_id, c.grade_id
       FROM enrollments e
       JOIN courses c ON c.id = e.course_id
       WHERE e.user_id = $1`,
      [u.id],
    );
    console.log('enrollments', enroll.rows);
  }

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
