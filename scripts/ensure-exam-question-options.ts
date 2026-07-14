/**
 * Ensure exam_question_options exists and backfill from teacher_questions.
 * Run: npx cross-env NODE_ENV=development tsx scripts/ensure-exam-question-options.ts
 */
import pool from '../src/db/pool';

function parseChoices(raw: unknown): string[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw.map((v) => String(v ?? '').trim()).filter(Boolean);
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map((v) => String(v ?? '').trim()).filter(Boolean) : [];
    } catch {
      return [];
    }
  }
  return [];
}

async function main() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS exam_question_options (
      id SERIAL PRIMARY KEY,
      exam_question_id INTEGER NOT NULL REFERENCES exam_questions(id) ON DELETE CASCADE,
      option_index INTEGER NOT NULL CHECK (option_index >= 0 AND option_index <= 3),
      text_content TEXT,
      UNIQUE(exam_question_id, option_index)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_exam_question_options_exam_question
      ON exam_question_options(exam_question_id)
  `);

  const name = '1774500000000_ensure_exam_question_options';
  const mig = await pool.query(`SELECT 1 FROM migrations WHERE name = $1`, [name]);
  if ((mig.rowCount ?? 0) === 0) {
    await pool.query(`INSERT INTO migrations (name, run_on) VALUES ($1::text, NOW())`, [name]);
  }

  const rows = await pool.query<{
    exam_question_id: number;
    choices: unknown;
    correct_answer_index: number | null;
  }>(
    `SELECT eq.id AS exam_question_id, tq.choices, tq.correct_answer_index
     FROM exam_questions eq
     JOIN teacher_questions tq ON tq.id = eq.teacher_question_id
     WHERE eq.teacher_question_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM exam_question_options o WHERE o.exam_question_id = eq.id
       )`,
  );

  let filled = 0;
  for (const row of rows.rows) {
    const choices = parseChoices(row.choices);
    if (choices.length < 2) continue;
    const limit = Math.min(choices.length, 4);
    for (let i = 0; i < limit; i++) {
      await pool.query(
        `INSERT INTO exam_question_options (exam_question_id, option_index, text_content)
         VALUES ($1, $2, $3)
         ON CONFLICT (exam_question_id, option_index) DO UPDATE
         SET text_content = EXCLUDED.text_content`,
        [row.exam_question_id, i, choices[i]],
      );
    }
    filled += 1;
  }

  console.log(`✅ exam_question_options ready — backfilled ${filled} questions`);
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
