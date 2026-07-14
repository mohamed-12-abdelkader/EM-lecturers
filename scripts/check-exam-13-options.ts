import pool from '../src/db/pool';

async function main() {
  const r = await pool.query(`
    SELECT eq.id, LEFT(eq.question_text, 40) AS text,
           COUNT(o.id)::int AS options_count,
           ARRAY_AGG(o.text_content ORDER BY o.option_index) AS options
    FROM exam_questions eq
    LEFT JOIN exam_question_options o ON o.exam_question_id = eq.id
    WHERE eq.exam_id = 13 AND eq.id BETWEEN 57 AND 60
    GROUP BY eq.id
    ORDER BY eq.id
  `);
  console.log(JSON.stringify(r.rows, null, 2));
  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  await pool.end();
  process.exit(1);
});
