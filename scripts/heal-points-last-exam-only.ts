/**
 * Soft heal: keep MANUAL/VIDEO, purge lecture/old exam points; keep last course exam only.
 * Usage: npx cross-env NODE_ENV=development tsx scripts/heal-points-last-exam-only.ts
 * Optional: --teacher-id=123
 */
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), `.env.${process.env.NODE_ENV || 'development'}`) });
dotenv.config();

async function main() {
  const { default: pool } = await import('../src/db/pool.js');
  const { TeacherPointsService } = await import('../src/services/teacherPoints.js');

  const argTeacher = process.argv.find((a) => a.startsWith('--teacher-id='));
  const forcedTeacherId = argTeacher ? Number(argTeacher.split('=')[1]) : null;

  let teacherIds: number[] = [];
  if (forcedTeacherId && Number.isFinite(forcedTeacherId) && forcedTeacherId > 0) {
    teacherIds = [forcedTeacherId];
  } else {
    const res = await pool.query<{ teacher_id: number }>(
      `SELECT DISTINCT teacher_id
       FROM (
         SELECT teacher_id FROM student_point_balances
         UNION
         SELECT teacher_id FROM point_transactions
         UNION
         SELECT teacher_id FROM teacher_points_settings
       ) t
       WHERE teacher_id IS NOT NULL
       ORDER BY teacher_id`,
    );
    teacherIds = res.rows.map((r) => Number(r.teacher_id));
  }

  console.log(`Healing ${teacherIds.length} teacher(s): ${teacherIds.join(', ')}`);

  for (const teacherId of teacherIds) {
    const result = await TeacherPointsService.healTeacherExamPointsToLastOnly({ teacherId });
    console.log(`teacher ${teacherId}:`, result);
  }

  await pool.end();
  console.log('Done.');
}

main().catch(async (err) => {
  console.error(err);
  try {
    const { default: pool } = await import('../src/db/pool.js');
    await pool.end();
  } catch {
    // ignore
  }
  process.exit(1);
});
