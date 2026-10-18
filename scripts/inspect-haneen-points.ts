/**
 * Inspect student points / exam titles related to the ranking log screenshot.
 */
import dotenv from 'dotenv';
import path from 'path';
import pg from 'pg';

dotenv.config({ path: path.resolve(process.cwd(), `.env.${process.env.NODE_ENV || 'development'}`) });
dotenv.config();

function cleanUrl(url: string) {
  return url.includes('?') ? url.split('?')[0] : url;
}

async function inspect(url: string, label: string) {
  const pool = new pg.Pool({
    connectionString: cleanUrl(url),
    ssl: { rejectUnauthorized: false },
  });
  console.log(`\n===== ${label} =====`);
  try {
    const db = await pool.query(`SELECT current_database() AS db, NOW() AS now`);
    console.log(db.rows[0]);

    const cols = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'users' ORDER BY ordinal_position`,
    );
    console.log(
      'users cols:',
      cols.rows.map((r) => r.column_name),
    );

    const nameCol =
      cols.rows.find((r) => r.column_name === 'full_name')?.column_name ||
      cols.rows.find((r) => r.column_name === 'name')?.column_name ||
      cols.rows.find((r) => r.column_name === 'username')?.column_name ||
      null;

    if (nameCol) {
      const users = await pool.query(
        `SELECT id, ${nameCol} AS name, phone, email
         FROM users
         WHERE ${nameCol} ILIKE $1 OR ${nameCol} ILIKE $2 OR ${nameCol} ILIKE $3
         LIMIT 30`,
        ['%حنين%', '%جليله%', '%Haneen%'],
      );
      console.log('matching users:', users.rows);

      for (const u of users.rows) {
        const txs = await pool.query(
          `SELECT id, teacher_id, event_type, points, reference_type, reference_id,
                  metadata->>'title' AS title, created_at
           FROM point_transactions
           WHERE student_id = $1
           ORDER BY created_at DESC
           LIMIT 50`,
          [u.id],
        );
        console.log(`txs for student ${u.id} (${u.name}):`, txs.rows);
      }
    }

    const lectureExams = await pool.query(
      `SELECT id, title, teacher_id, created_at
       FROM exams
       WHERE title ILIKE ANY($1::text[])
       ORDER BY id DESC
       LIMIT 40`,
      [
        [
          '%محسنات%',
          '%شمسية%',
          '%همزه%',
          '%همزة%',
          '%ممنوع من الصرف%',
          '%العلم بين%',
          '%القانون والضمير%',
        ],
      ],
    );
    console.log('matching lecture exams count:', lectureExams.rowCount);
    console.log(lectureExams.rows.slice(0, 15));

    const courseExams = await pool.query(
      `SELECT id, title, teacher_id, course_id, created_at
       FROM course_level_exams
       WHERE title ILIKE ANY($1::text[])
       ORDER BY id DESC
       LIMIT 40`,
      [
        [
          '%محسنات%',
          '%شمسية%',
          '%همزه%',
          '%همزة%',
          '%ممنوع من الصرف%',
          '%العلم بين%',
          '%القانون والضمير%',
          '%شامل%',
          '%عام%',
        ],
      ],
    );
    console.log('matching course exams:', courseExams.rows);

    const byType = await pool.query(
      `SELECT event_type, reference_type, COUNT(*)::int AS c
       FROM point_transactions
       GROUP BY event_type, reference_type
       ORDER BY c DESC`,
    );
    console.log('by type:', byType.rows);

    const lecturePts = await pool.query(
      `SELECT COUNT(*)::int AS c FROM point_transactions
       WHERE reference_type = 'lecture_exam'
          OR reference_key LIKE '%lecture_exam%'`,
    );
    console.log('lecture_exam point txs:', lecturePts.rows[0]);

    const sample = await pool.query(
      `SELECT id, teacher_id, student_id, event_type, points, reference_type, reference_id,
              metadata->>'title' AS title, created_at
       FROM point_transactions
       WHERE event_type IN ('EXAM_START','EXAM_SCORE')
       ORDER BY created_at DESC
       LIMIT 30`,
    );
    console.log('recent exam txs:', sample.rows);

    const teachers = await pool.query(
      `SELECT teacher_id, COUNT(*)::int AS c
       FROM point_transactions
       GROUP BY teacher_id
       ORDER BY c DESC
       LIMIT 20`,
    );
    console.log('teachers with points:', teachers.rows);

    // Any student with many exam score txs (like the screenshot)
    const multi = await pool.query(
      `SELECT student_id, COUNT(*)::int AS c
       FROM point_transactions
       WHERE event_type = 'EXAM_SCORE'
       GROUP BY student_id
       HAVING COUNT(*) > 2
       ORDER BY c DESC
       LIMIT 20`,
    );
    console.log('students with >2 EXAM_SCORE:', multi.rows);
    for (const row of multi.rows.slice(0, 5)) {
      const detail = await pool.query(
        `SELECT event_type, points, reference_type, reference_id,
                metadata->>'title' AS title, created_at
         FROM point_transactions
         WHERE student_id = $1 AND event_type IN ('EXAM_START','EXAM_SCORE')
         ORDER BY created_at DESC`,
        [row.student_id],
      );
      const uname = nameCol
        ? (
            await pool.query(`SELECT ${nameCol} AS name FROM users WHERE id = $1`, [
              row.student_id,
            ])
          ).rows[0]?.name
        : null;
      console.log(`detail student ${row.student_id} (${uname}):`, detail.rows);
    }
  } catch (e: any) {
    console.log('ERROR:', e.message);
  } finally {
    await pool.end();
  }
}

async function main() {
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error('DATABASE_URL missing');
  await inspect(base, 'current DATABASE_URL (lectures)');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
