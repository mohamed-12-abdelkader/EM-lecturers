import pool from '../db/pool';
import { SubjectBookStructureService } from '../src/services/subjectBookStructure';

async function main() {
  const subjects = await pool.query<{ id: number }>(
    `SELECT DISTINCT subject_id AS id FROM subject_books ORDER BY subject_id`,
  );

  for (const row of subjects.rows) {
    await SubjectBookStructureService.syncSubjectBooksStructure(row.id);
    console.log(`Synced subject ${row.id}`);
  }

  console.log('Done.');
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
