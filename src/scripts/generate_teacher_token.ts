import crypto from 'node:crypto';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import { Pool } from 'pg';

type Args = {
  teacherId?: number;
  email?: string;
  phone?: string;
  tenantSubdomain?: string;
  raw: boolean;
};

function loadEnv() {
  const envFile = process.env.NODE_ENV === 'production' ? '.env' : '.env.development';
  dotenv.config({ path: envFile });
  dotenv.config({ path: '.env' });
}

function parseArgs(argv: string[]): Args {
  const args: Args = { raw: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--teacher-id' && next) {
      args.teacherId = Number(next);
      i++;
    } else if (arg === '--email' && next) {
      args.email = next.trim().toLowerCase();
      i++;
    } else if (arg === '--phone' && next) {
      args.phone = next.trim();
      i++;
    } else if (arg === '--tenant' && next) {
      args.tenantSubdomain = next.trim().toLowerCase();
      i++;
    } else if (arg === '--raw') {
      args.raw = true;
    }
  }
  return args;
}

function usage(): string {
  return `Generate a local teacher JWT for API testing.

Usage:
  pnpm teacher:token -- --raw
  pnpm teacher:token -- --email teacher@example.com
  pnpm teacher:token -- --teacher-id 123
  pnpm teacher:token -- --phone 01000000000 --tenant default
  pnpm teacher:token -- --email teacher@example.com --raw

Options:
  --teacher-id <id>       Select teacher by user id
  --email <email>         Select teacher by email
  --phone <phone>         Select teacher by phone
  --tenant <subdomain>    Optional tenant subdomain filter
  --raw                   Print only the JWT

If no teacher selector is provided, a random teacher is selected.
`;
}

function shouldUseSsl(databaseUrl: string): boolean {
  if (process.env.DATABASE_SSL === 'true') return true;
  if (process.env.DATABASE_SSL === 'false') return false;

  try {
    const host = new URL(databaseUrl).hostname;
    return !['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(host);
  } catch {
    return true;
  }
}

async function main() {
  loadEnv();
  const args = parseArgs(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL;
  const secretKey = process.env.SECRET_KEY;

  if (!databaseUrl || !secretKey) {
    throw new Error('DATABASE_URL and SECRET_KEY must be set in .env.development or .env');
  }

  const pool = new Pool({
    connectionString: databaseUrl.includes('?') ? databaseUrl.split('?')[0] : databaseUrl,
    ssl: shouldUseSsl(databaseUrl) ? { rejectUnauthorized: false } : undefined,
  });

  try {
    const filters = ['u.role = $1'];
    const values: Array<string | number> = ['teacher'];
    let index = values.length + 1;

    if (args.teacherId) {
      filters.push(`u.id = $${index++}`);
      values.push(args.teacherId);
    }
    if (args.email) {
      filters.push(`lower(trim(u.email)) = $${index++}`);
      values.push(args.email);
    }
    if (args.phone) {
      filters.push(`u.phone = $${index++}`);
      values.push(args.phone);
    }
    if (args.tenantSubdomain) {
      filters.push(`t.subdomain = $${index++}`);
      values.push(args.tenantSubdomain);
    }

    const hasTeacherSelector = Boolean(args.teacherId || args.email || args.phone);
    const orderBy = hasTeacherSelector ? 'u.id ASC' : 'RANDOM()';

    const result = await pool.query(
      `SELECT
         u.id,
         u.email,
         u.phone,
         u.name,
         u.role,
         u.tenant_id,
         t.subdomain AS tenant_subdomain
       FROM users u
       LEFT JOIN tenants t ON t.id = u.tenant_id
       WHERE ${filters.join(' AND ')}
       ORDER BY ${orderBy}
       LIMIT 1`,
      values,
    );

    const teacher = result.rows[0];
    if (!teacher) {
      throw new Error(`No teacher found.\n\n${usage()}`);
    }
    if (!teacher.tenant_id) {
      throw new Error(
        `Teacher ${teacher.id} has no tenant_id. Set users.tenant_id first, or use a tenant-linked teacher.`,
      );
    }

    const jti = crypto.randomUUID();
    await pool.query('UPDATE users SET jti = $1 WHERE id = $2', [jti, teacher.id]);

    const token = jwt.sign(
      {
        id: teacher.id,
        email: teacher.email,
        role: 'teacher',
        jti,
        tid: Number(teacher.tenant_id),
      },
      secretKey,
      { expiresIn: '365d' },
    );

    if (args.raw) {
      console.log(token);
      return;
    }

    console.log('Teacher token generated successfully.');
    console.log(`teacher_id: ${teacher.id}`);
    console.log(`teacher_name: ${teacher.name}`);
    console.log(`tenant_id: ${teacher.tenant_id}`);
    console.log(`tenant_subdomain: ${teacher.tenant_subdomain || 'unknown'}`);
    console.log('');
    console.log(token);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
