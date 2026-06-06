import { runner } from 'node-pg-migrate';
import path from 'path';
import { config } from '../utils';
import pool from './pool';
import bcrypt from 'bcrypt';

export async function applyMigrations(databaseUrl: string, direction: 'up' | 'down') {
  try {
    await runner({
      count: Number.POSITIVE_INFINITY,
      databaseUrl: databaseUrl,
      dir: path.resolve(__dirname, '../../migrations'),
      direction,
      migrationsTable: 'migrations',
      verbose: false,
    });
  } catch (error: any) {
    console.error('Migration error:', error.message);
    if (error.message?.includes('ETIMEDOUT') || error.message?.includes('connect')) {
      console.error('❌ Cannot connect to database. Please check:');
      console.error('  1. Database server is running');
      console.error('  2. DATABASE_URL in .env file is correct');
      console.error('  3. Network connection is available');
      console.error('  4. Firewall allows connection to database port');
      const maskedUrl = databaseUrl?.replace(/:[^:@]+@/, ':****@');
      console.error(`  5. Current DATABASE_URL: ${maskedUrl}`);
    }
    throw error;
  }

  if (direction !== 'up') return;

  const { FIRST_SUPERUSER, FIRST_SUPERUSER_PASSWORD } = config;

  if (!FIRST_SUPERUSER || !FIRST_SUPERUSER_PASSWORD) return;

  const exists = await pool.query(
    `SELECT u.id FROM users u
     JOIN tenants t ON t.id = u.tenant_id AND t.subdomain = 'default'
     WHERE u.email = $1 OR u.phone = $1`,
    [FIRST_SUPERUSER],
  );

  if (exists.rowCount === 0) {
    const hashed = await bcrypt.hash(FIRST_SUPERUSER_PASSWORD, 10);
    await pool.query(
      `INSERT INTO users (email, phone, password, name, role, tenant_id)
       SELECT
         $1,
         CASE WHEN POSITION('@' IN $1) = 0 THEN $1 ELSE NULL END,
         $2,
         $1,
         'admin',
         t.id
       FROM tenants t WHERE t.subdomain = 'default' LIMIT 1`,
      [FIRST_SUPERUSER, hashed],
    );
    console.log('✅ First superuser created.');
  } else {
    console.log('ℹ️  First superuser already exists.');
  }
}
