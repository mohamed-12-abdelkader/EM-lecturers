import { Pool } from 'pg';
import { config } from '../utils';

const connectionString = config.DATABASE_URL.includes('?')
  ? config.DATABASE_URL.split('?')[0]
  : config.DATABASE_URL;

const pool = new Pool({
  connectionString: connectionString,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 30000,
  idleTimeoutMillis: 30000,
  max: 20,
  query_timeout: 60000,
  statement_timeout: 60000,
});

// Handle pool errors
pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});

// Test connection on startup
pool
  .query('SELECT NOW()')
  .then(() => {
    console.log('✅ Database connection established');
  })
  .catch((err) => {
    console.error('❌ Database connection failed:', err.message);
    console.error('Database URL (masked):', config.DATABASE_URL?.replace(/:[^:@]+@/, ':****@'));
  });

export default pool;
