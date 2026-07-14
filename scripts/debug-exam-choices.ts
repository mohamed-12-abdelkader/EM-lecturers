import pool from '../src/db/pool';

async function main() {
  const tables = await pool.query(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'exam_question_options'
    ORDER BY ordinal_position
  `);
  console.log('exam_question_options columns:', tables.rows);

  const exists = await pool.query(`
    SELECT to_regclass('public.exam_question_options') AS t
  `);
  console.log('table:', exists.rows[0]);

  const sample = await pool.query(`
    SELECT eq.id, eq.teacher_question_id, eq.question_id, eq.question_id_v2,
           (SELECT COUNT(*)::int FROM exam_question_options o WHERE o.exam_question_id = eq.id) AS opt_count
    FROM exam_questions eq
    WHERE eq.exam_id = 13
    ORDER BY eq.id
    LIMIT 20
  `);
  console.log('exam 13 questions sample:', sample.rows);

  const tq = await pool.query(`
    SELECT id, choices, correct_answer_index, question_type
    FROM teacher_questions
    WHERE id IN (
      SELECT teacher_question_id FROM exam_questions
      WHERE exam_id = 13 AND teacher_question_id IS NOT NULL
      LIMIT 3
    )
  `);
  console.log('teacher_questions sample:', tq.rows);

  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  await pool.end();
  process.exit(1);
});
