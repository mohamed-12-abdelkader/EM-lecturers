/**
 * Migrate Cloudinary / external CDN image URLs stored in Postgres to local /uploads.
 *
 * Usage:
 *   npx tsx scripts/migrate-cloudinary-images-to-local.ts --dry-run
 *   npx tsx scripts/migrate-cloudinary-images-to-local.ts
 *
 * Requires DATABASE_URL in env (.env.development / .env).
 * Does NOT delete remote Cloudinary assets (safe).
 */
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import {
  ensureUploadsDir,
  buildUniqueFilename,
  toPublicUploadPath,
} from '../src/services/localImageStorage';

const projectRoot = path.resolve(__dirname, '..');
const envFile =
  process.env.NODE_ENV === 'production' ? '.env' : '.env.development';
dotenv.config({ path: path.join(projectRoot, envFile) });
dotenv.config({ path: path.join(projectRoot, '.env') });

const dryRun = process.argv.includes('--dry-run');

type Target = { table: string; column: string; idColumn?: string; category: string };

/** Tables/columns that commonly store image URLs in this project */
const TARGETS: Target[] = [
  { table: 'users', column: 'avatar', category: 'avatars' },
  { table: 'courses', column: 'avatar', category: 'courses' },
  { table: 'courses', column: 'image', category: 'courses' },
  { table: 'subjects', column: 'image_url', category: 'general' },
  { table: 'subjects', column: 'image', category: 'general' },
  { table: 'chapters', column: 'image_url', category: 'lessons' },
  { table: 'lessons', column: 'image_url', category: 'lessons' },
  { table: 'books', column: 'image_url', category: 'general' },
  { table: 'packages', column: 'image', category: 'packages' },
  { table: 'package_subject_items', column: 'image', category: 'packages' },
  { table: 'questions', column: 'image', category: 'questions' },
  { table: 'exam_questions', column: 'image', category: 'questions' },
  { table: 'course_level_exam_questions', column: 'question_image', category: 'questions' },
  { table: 'teacher_questions', column: 'image_url', category: 'questions' },
  { table: 'questions_v2', column: 'image_url', category: 'questions' },
  { table: 'question_media', column: 'media_url', category: 'questions' },
  { table: 'question_options', column: 'image_url', category: 'questions' },
  { table: 'leagues', column: 'image', category: 'leagues' },
  { table: 'leagues', column: 'cover_image', category: 'leagues' },
  { table: 'social_stories', column: 'media_url', category: 'social' },
  { table: 'tenants', column: 'logo_url', category: 'academy' },
  { table: 'tenants', column: 'favicon_url', category: 'academy' },
  { table: 'tenants', column: 'og_image_url', category: 'academy' },
  { table: 'tenants', column: 'hero_image_url', category: 'academy' },
];

function isExternalImageUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  const u = url.trim();
  if (u.startsWith('/uploads/')) return false;
  if (!/^https?:\/\//i.test(u)) return false;
  return (
    /cloudinary\.com/i.test(u) ||
    /res\.cloudinary\.com/i.test(u) ||
    /b-cdn\.net/i.test(u) ||
    /bunnycdn/i.test(u) ||
    /amazonaws\.com/i.test(u)
  );
}

async function downloadToLocal(url: string, category: string): Promise<string> {
  const response = await axios.get<ArrayBuffer>(url, {
    responseType: 'arraybuffer',
    timeout: 60_000,
    maxContentLength: 25 * 1024 * 1024,
    validateStatus: (s) => s >= 200 && s < 300,
  });
  const contentType = String(response.headers['content-type'] || '');
  let ext = path.extname(new URL(url).pathname).toLowerCase();
  if (!ext || ext.length > 5) {
    if (contentType.includes('png')) ext = '.png';
    else if (contentType.includes('webp')) ext = '.webp';
    else if (contentType.includes('gif')) ext = '.gif';
    else ext = '.jpg';
  }
  const dir = ensureUploadsDir(category);
  const filename = buildUniqueFilename(`migrated${ext}`);
  const dest = path.join(dir, filename);
  fs.writeFileSync(dest, Buffer.from(response.data));
  return toPublicUploadPath(category, filename);
}

async function columnExists(pool: Pool, table: string, column: string): Promise<boolean> {
  const res = await pool.query(
    `SELECT 1
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
     LIMIT 1`,
    [table, column],
  );
  return Boolean(res.rowCount);
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  });

  let migrated = 0;
  let skipped = 0;
  let failed = 0;

  console.log(dryRun ? 'DRY RUN — no DB writes' : 'LIVE — will update DB paths');

  for (const target of TARGETS) {
    const exists = await columnExists(pool, target.table, target.column);
    if (!exists) {
      console.log(`skip missing ${target.table}.${target.column}`);
      continue;
    }
    const idCol = target.idColumn || 'id';
    const rows = await pool.query(
      `SELECT ${idCol} AS id, ${target.column} AS url
       FROM ${target.table}
       WHERE ${target.column} IS NOT NULL
         AND ${target.column}::text <> ''
         AND (
           ${target.column}::text ILIKE '%cloudinary%'
           OR ${target.column}::text ILIKE '%b-cdn.net%'
           OR ${target.column}::text ILIKE '%bunny%'
           OR ${target.column}::text ILIKE '%amazonaws.com%'
         )`,
    );

    console.log(`${target.table}.${target.column}: ${rows.rowCount} candidate(s)`);

    for (const row of rows.rows) {
      const url = String(row.url || '');
      if (!isExternalImageUrl(url)) {
        skipped++;
        continue;
      }
      try {
        if (dryRun) {
          console.log(`  would migrate ${target.table}#${row.id}`);
          migrated++;
          continue;
        }
        const localPath = await downloadToLocal(url, target.category);
        await pool.query(
          `UPDATE ${target.table} SET ${target.column} = $1 WHERE ${idCol} = $2`,
          [localPath, row.id],
        );
        console.log(`  migrated ${target.table}#${row.id} -> ${localPath}`);
        migrated++;
      } catch (err: any) {
        failed++;
        console.error(`  FAIL ${target.table}#${row.id}:`, err?.message || err);
      }
    }
  }

  await pool.end();
  console.log({ migrated, skipped, failed, dryRun });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
