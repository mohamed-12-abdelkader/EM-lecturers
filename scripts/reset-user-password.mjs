import dotenv from 'dotenv';
import pg from 'pg';
import bcrypt from 'bcrypt';

dotenv.config({ path: '.env.development' });
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const email = process.argv[2];
const newPassword = process.argv[3];

if (!email || !newPassword) {
  console.error('Usage: node scripts/reset-user-password.mjs <email> <new-password>');
  process.exit(1);
}

const emailNorm = email.trim().toLowerCase();
const hashed = await bcrypt.hash(newPassword, 10);
const r = await pool.query(
  `UPDATE users SET password = $1 WHERE lower(trim(email)) = $2 RETURNING id, email, role`,
  [hashed, emailNorm],
);

if (!r.rowCount) {
  console.error('User not found:', emailNorm);
  process.exit(1);
}

console.log('Password updated for:', r.rows[0]);
await pool.end();
