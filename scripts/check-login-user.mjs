import dotenv from 'dotenv';
import pg from 'pg';
import bcrypt from 'bcrypt';

dotenv.config({ path: '.env.development' });
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const email = process.argv[2] || 'omar1@gmail.com';
const password = process.argv[3] || 'omar1';

const r = await pool.query(
  `SELECT u.id, u.email, u.role, u.tenant_id, u.account_status, u.password,
          t.subdomain, t.is_active AS tenant_active
   FROM users u
   LEFT JOIN tenants t ON t.id = u.tenant_id
   WHERE lower(trim(u.email)) = $1`,
  [email.trim().toLowerCase()],
);
console.log('matches:', r.rowCount);
for (const row of r.rows) {
  const ok = await bcrypt.compare(password, row.password);
  console.log({
    id: row.id,
    email: row.email,
    role: row.role,
    tenant_id: row.tenant_id,
    subdomain: row.subdomain,
    tenant_active: row.tenant_active,
    account_status: row.account_status,
    password_match: ok,
  });
}
await pool.end();
