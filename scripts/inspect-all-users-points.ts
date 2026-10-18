import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), `.env.${process.env.NODE_ENV || 'development'}`) });
dotenv.config();

async function main() {
  const { default: pool } = await import('../src/db/pool.js');

  const db = await pool.query(`SELECT current_database() AS db`);
  console.log(db.rows[0]);

  const users = await pool.query(
    `SELECT id, name FROM users
     WHERE name ILIKE '%حنين%' OR name ILIKE '%جليله%' OR name ILIKE '%ياسر%'
     LIMIT 20`,
  );
  console.log('name matches:', users.rows);

  const multi = await pool.query(
    `SELECT pt.student_id, u.name, COUNT(*)::int AS c
     FROM point_transactions pt
     JOIN users u ON u.id = pt.student_id
     WHERE pt.event_type = 'EXAM_SCORE'
     GROUP BY pt.student_id, u.name
     HAVING COUNT(*) > 1
     ORDER BY c DESC
     LIMIT 30`,
  );
  console.log('students with >1 EXAM_SCORE:', multi.rows);

  const byRef = await pool.query(
    `SELECT reference_type, event_type, COUNT(*)::int AS c
     FROM point_transactions
     GROUP BY reference_type, event_type
     ORDER BY c DESC`,
  );
  console.log('tx breakdown:', byRef.rows);

  const titles = await pool.query(
    `SELECT metadata->>'title' AS title, reference_type, COUNT(*)::int AS c
     FROM point_transactions
     WHERE event_type IN ('EXAM_START','EXAM_SCORE')
     GROUP BY 1, 2
     ORDER BY c DESC
     LIMIT 40`,
  );
  console.log('exam titles in points:', titles.rows);

  const lectureExams = await pool.query(
    `SELECT e.id, e.title, c.teacher_id, e.created_at
     FROM exams e
     LEFT JOIN lectures l ON l.id = e.lecture_id
     LEFT JOIN courses c ON c.id = l.course_id
     WHERE e.title ILIKE ANY($1::text[])
     ORDER BY e.id DESC
     LIMIT 20`,
    [['%محسنات%', '%شمسية%', '%همزه%', '%همزة%', '%ممنوع%', '%العلم بين%', '%الضمير%']],
  );
  console.log('lecture exams match:', lectureExams.rows);

  const courseExams = await pool.query(
    `SELECT e.id, e.title, COALESCE(e.teacher_id, c.teacher_id) AS teacher_id, e.course_id, e.created_at
     FROM course_level_exams e
     LEFT JOIN courses c ON c.id = e.course_id
     WHERE e.title ILIKE ANY($1::text[])
     ORDER BY e.id DESC
     LIMIT 20`,
    [['%محسنات%', '%شمسية%', '%همزه%', '%همزة%', '%ممنوع%', '%العلم بين%', '%الضمير%', '%شامل%', '%عام%']],
  );
  console.log('course exams match:', courseExams.rows);

  const totalUsers = await pool.query(`SELECT COUNT(*)::int AS c FROM users`);
  console.log('users count:', totalUsers.rows[0]);

  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  process.exit(1);
});
