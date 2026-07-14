/**
 * Ensure exam_questions.correct_answer_index_override exists.
 * Run: npx cross-env NODE_ENV=development tsx scripts/ensure-exam-question-override.ts
 */
import pool from '../src/db/pool';

async function main() {
  await pool.query(`
    ALTER TABLE exam_questions
      ADD COLUMN IF NOT EXISTS correct_answer_index_override INTEGER NULL
  `);

  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'exam_questions_correct_answer_index_override_check'
      ) THEN
        ALTER TABLE exam_questions
          ADD CONSTRAINT exam_questions_correct_answer_index_override_check
          CHECK (
            correct_answer_index_override IS NULL
            OR (correct_answer_index_override >= 0 AND correct_answer_index_override <= 3)
          );
      END IF;
    END $$;
  `);

  await pool.query(`
    COMMENT ON COLUMN exam_questions.correct_answer_index_override IS
      '0=أ, 1=ب, 2=ج, 3=د - إن وُجد يُستخدم بدل قيمة البنك في هذا الامتحان فقط'
  `);

  // Record newer migration name so future deploys stay consistent
  const name = '1774400000000_ensure_exam_question_correct_answer_override';
  const exists = await pool.query(`SELECT 1 FROM migrations WHERE name = $1`, [name]);
  if ((exists.rowCount ?? 0) === 0) {
    await pool.query(`INSERT INTO migrations (name, run_on) VALUES ($1::text, NOW())`, [name]);
  }

  const col = await pool.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_name = 'exam_questions' AND column_name = 'correct_answer_index_override'`,
  );
  console.log(col.rowCount ? '✅ Column ready' : '❌ Column still missing');
  await pool.end();
}

main().catch(async (e) => {
  console.error('❌', e.message || e);
  try {
    await pool.end();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
