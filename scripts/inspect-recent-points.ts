import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), `.env.${process.env.NODE_ENV || 'development'}`) });
dotenv.config();

async function main() {
  const { default: pool } = await import('../src/db/pool.js');

  const live = await pool.query(
    `SELECT pt.id, pt.teacher_id, pt.student_id, u.name, pt.event_type, pt.points,
            pt.reference_type, pt.reference_id, pt.metadata->>'title' AS title, pt.created_at
     FROM point_transactions pt
     JOIN users u ON u.id = pt.student_id
     ORDER BY pt.created_at DESC LIMIT 20`,
  );
  console.log('live txs:', live.rows);

  const arch = await pool.query(
    `SELECT a.id, a.teacher_id, a.student_id, u.name, a.event_type, a.points,
            a.reference_type, a.reference_id, a.metadata->>'title' AS title, a.created_at
     FROM point_transaction_archives a
     LEFT JOIN users u ON u.id = a.student_id
     WHERE a.metadata->>'title' ILIKE ANY($1::text[])
        OR u.name ILIKE '%حنين%' OR u.name ILIKE '%جليله%'
     ORDER BY a.created_at DESC
     LIMIT 40`,
    [['%محسنات%', '%شمسية%', '%همزه%', '%همزة%', '%ممنوع%', '%العلم بين%', '%الضمير%']],
  );
  console.log('archive matches:', arch.rows);

  const archCount = await pool.query(
    `SELECT COUNT(*)::int AS c FROM point_transaction_archives`,
  );
  console.log('archive total:', archCount.rows[0]);

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
