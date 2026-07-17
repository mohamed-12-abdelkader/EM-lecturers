/**
 * Allow question_options.option_index 0–4 (3 or 5 MCQ choices).
 * Run: npx cross-env NODE_ENV=development tsx scripts/ensure-question-options-five.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import pool from '../src/db/pool';

async function main() {
  const sqlPath = path.resolve(
    process.cwd(),
    'migrations/1774900000000_question_options_five_choices.sql',
  );
  const sql = fs.readFileSync(sqlPath, 'utf8');
  await pool.query(sql);

  try {
    await pool.query(
      `INSERT INTO migrations (name, run_on)
       SELECT $1::text, NOW()
       WHERE NOT EXISTS (SELECT 1 FROM migrations WHERE name = $1::text)`,
      ['1774900000000_question_options_five_choices'],
    );
  } catch (err: any) {
    console.warn('⚠️  Could not record migration row:', err.message);
  }

  console.log('✅ question_options supports indices 0–4 (up to 5 choices)');
  await pool.end();
}

main().catch(async (err) => {
  console.error('❌ Failed:', err.message || err);
  try {
    await pool.end();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
