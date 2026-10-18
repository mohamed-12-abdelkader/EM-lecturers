import pool from '../src/db/pool';

async function main() {
  const teacherId = Number(process.argv[2] || 27);
  const tx = await pool.query(
    `SELECT id, event_type, reference_type, reference_id, points, student_id, grade_id
     FROM point_transactions WHERE teacher_id = $1 ORDER BY id`,
    [teacherId],
  );
  const bal = await pool.query(
    `SELECT student_id, grade_id, total_points
     FROM student_point_balances WHERE teacher_id = $1 ORDER BY total_points DESC`,
    [teacherId],
  );
  console.log('transactions:', JSON.stringify(tx.rows, null, 2));
  console.log('balances:', JSON.stringify(bal.rows, null, 2));
  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  process.exit(1);
});
