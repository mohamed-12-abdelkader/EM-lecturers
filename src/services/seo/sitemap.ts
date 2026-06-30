import pool from '../../db/pool';
import { seoCacheDeletePrefix, seoCacheGet, seoCacheSet, SEO_CACHE_TTL } from './cache';
import { tenantBaseUrl, tenantBlogPath, tenantCoursePath, tenantCoursesListPath, tenantFreeLecturePath, tenantTeacherPath } from './urls';

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function toLastmod(value: Date | string | null | undefined): string {
  if (!value) return new Date().toISOString().slice(0, 10);
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10);
  return date.toISOString().slice(0, 10);
}

type SitemapEntry = {
  loc: string;
  lastmod: Date | string | null;
  changefreq: string;
  priority: string;
};

export class TenantSitemapService {
  static invalidate(tenantId: number): void {
    seoCacheDeletePrefix(`sitemap:${tenantId}:`);
    void pool.query(
      `UPDATE tenant_seo_settings SET sitemap_xml = NULL, sitemap_generated_at = NULL WHERE tenant_id = $1`,
      [tenantId],
    );
  }

  static async buildXml(tenantId: number, subdomain: string): Promise<string> {
    const cacheKey = `sitemap:${tenantId}:xml`;
    const cached = seoCacheGet<string>(cacheKey);
    if (cached) return cached;

    const stored = await pool.query<{ sitemap_xml: string | null }>(
      `SELECT sitemap_xml FROM tenant_seo_settings WHERE tenant_id = $1 LIMIT 1`,
      [tenantId],
    );
    if (stored.rows[0]?.sitemap_xml) {
      seoCacheSet(cacheKey, stored.rows[0].sitemap_xml, SEO_CACHE_TTL.sitemap);
      return stored.rows[0].sitemap_xml;
    }

    const baseUrl = tenantBaseUrl(subdomain);
    const tenantRes = await pool.query<{ owner_user_id: number | null; updated_at: string }>(
      `SELECT owner_user_id, updated_at FROM tenants WHERE id = $1 LIMIT 1`,
      [tenantId],
    );
    const ownerId = tenantRes.rows[0]?.owner_user_id;
    const entries: SitemapEntry[] = [
      { loc: baseUrl, lastmod: tenantRes.rows[0]?.updated_at, changefreq: 'daily', priority: '1.0' },
      {
        loc: `${baseUrl}${tenantTeacherPath()}`,
        lastmod: tenantRes.rows[0]?.updated_at,
        changefreq: 'weekly',
        priority: '0.9',
      },
      {
        loc: `${baseUrl}${tenantCoursesListPath()}`,
        lastmod: tenantRes.rows[0]?.updated_at,
        changefreq: 'daily',
        priority: '0.9',
      },
    ];

    if (ownerId) {
      const [coursesRes, lecturesRes, settingsRes] = await Promise.all([
        pool.query(
          `SELECT slug, updated_at, created_at FROM courses
           WHERE teacher_id = $1 AND (is_visible IS NULL OR is_visible = TRUE) AND slug IS NOT NULL
           ORDER BY updated_at DESC NULLS LAST`,
          [ownerId],
        ),
        pool.query(
          `SELECT id, updated_at, created_at FROM teacher_free_lectures
           WHERE teacher_id = $1 AND is_published = TRUE
           ORDER BY updated_at DESC`,
          [ownerId],
        ),
        pool.query<{ data: { blog?: { enabled?: boolean } } }>(
          `SELECT data FROM tenant_settings WHERE tenant_id = $1 LIMIT 1`,
          [tenantId],
        ),
      ]);

      for (const course of coursesRes.rows) {
        entries.push({
          loc: `${baseUrl}${tenantCoursePath(String(course.slug))}`,
          lastmod: course.updated_at ?? course.created_at,
          changefreq: 'weekly',
          priority: '0.8',
        });
      }

      for (const lecture of lecturesRes.rows) {
        entries.push({
          loc: `${baseUrl}${tenantFreeLecturePath(Number(lecture.id))}`,
          lastmod: lecture.updated_at ?? lecture.created_at,
          changefreq: 'monthly',
          priority: '0.6',
        });
      }

      if (settingsRes.rows[0]?.data?.blog?.enabled) {
        entries.push({
          loc: `${baseUrl}${tenantBlogPath()}`,
          lastmod: tenantRes.rows[0]?.updated_at,
          changefreq: 'weekly',
          priority: '0.5',
        });
      }
    }

    const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries
  .map(
    (entry) => `  <url>
    <loc>${escapeXml(entry.loc)}</loc>
    <lastmod>${toLastmod(entry.lastmod)}</lastmod>
    <changefreq>${entry.changefreq}</changefreq>
    <priority>${entry.priority}</priority>
  </url>`,
  )
  .join('\n')}
</urlset>`;

    await pool.query(
      `INSERT INTO tenant_seo_settings (tenant_id, sitemap_xml, sitemap_generated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (tenant_id) DO UPDATE SET
         sitemap_xml = EXCLUDED.sitemap_xml,
         sitemap_generated_at = NOW(),
         updated_at = NOW()`,
      [tenantId, body],
    );

    seoCacheSet(cacheKey, body, SEO_CACHE_TTL.sitemap);
    return body;
  }
}
