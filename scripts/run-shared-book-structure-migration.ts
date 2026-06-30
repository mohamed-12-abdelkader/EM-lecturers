import fs from 'node:fs';
import path from 'node:path';
import pool from '../src/db/pool';
import { SubjectBookStructureService } from '../src/services/subjectBookStructure';

async function main() {
  const file = path.join(
    process.cwd(),
    'migrations/1773000000000_question_bank_shared_book_structure.sql',
  );
  const raw = fs.readFileSync(file, 'utf8');
  const up = raw.split('-- Down Migration')[0].trim();
  await pool.query(up);
  console.log('mirror_key migration OK');

  const subjects = await pool.query<{ id: number }>(
    `SELECT DISTINCT subject_id AS id FROM subject_books ORDER BY subject_id`,
  );
  for (const row of subjects.rows) {
    await SubjectBookStructureService.syncSubjectBooksStructure(row.id);
    console.log(`Synced subject ${row.id}`);
  }

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
