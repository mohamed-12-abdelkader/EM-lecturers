"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TenantSitemapService = void 0;
const pool_1 = __importDefault(require("../../db/pool"));
const cache_1 = require("./cache");
const urls_1 = require("./urls");
function escapeXml(value) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}
function toLastmod(value) {
    if (!value)
        return new Date().toISOString().slice(0, 10);
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime()))
        return new Date().toISOString().slice(0, 10);
    return date.toISOString().slice(0, 10);
}
class TenantSitemapService {
    static invalidate(tenantId) {
        (0, cache_1.seoCacheDeletePrefix)(`sitemap:${tenantId}:`);
        void pool_1.default.query(`UPDATE tenant_seo_settings SET sitemap_xml = NULL, sitemap_generated_at = NULL WHERE tenant_id = $1`, [tenantId]);
    }
    static async buildXml(tenantId, subdomain) {
        const cacheKey = `sitemap:${tenantId}:xml`;
        const cached = (0, cache_1.seoCacheGet)(cacheKey);
        if (cached)
            return cached;
        const stored = await pool_1.default.query(`SELECT sitemap_xml FROM tenant_seo_settings WHERE tenant_id = $1 LIMIT 1`, [tenantId]);
        if (stored.rows[0]?.sitemap_xml) {
            (0, cache_1.seoCacheSet)(cacheKey, stored.rows[0].sitemap_xml, cache_1.SEO_CACHE_TTL.sitemap);
            return stored.rows[0].sitemap_xml;
        }
        const baseUrl = (0, urls_1.tenantBaseUrl)(subdomain);
        const tenantRes = await pool_1.default.query(`SELECT owner_user_id, updated_at FROM tenants WHERE id = $1 LIMIT 1`, [tenantId]);
        const ownerId = tenantRes.rows[0]?.owner_user_id;
        const entries = [
            { loc: baseUrl, lastmod: tenantRes.rows[0]?.updated_at, changefreq: 'daily', priority: '1.0' },
            {
                loc: `${baseUrl}${(0, urls_1.tenantTeacherPath)()}`,
                lastmod: tenantRes.rows[0]?.updated_at,
                changefreq: 'weekly',
                priority: '0.9',
            },
            {
                loc: `${baseUrl}${(0, urls_1.tenantCoursesListPath)()}`,
                lastmod: tenantRes.rows[0]?.updated_at,
                changefreq: 'daily',
                priority: '0.9',
            },
        ];
        if (ownerId) {
            const [coursesRes, lecturesRes, settingsRes] = await Promise.all([
                pool_1.default.query(`SELECT slug, updated_at, created_at FROM courses
           WHERE teacher_id = $1 AND (is_visible IS NULL OR is_visible = TRUE) AND slug IS NOT NULL
           ORDER BY updated_at DESC NULLS LAST`, [ownerId]),
                pool_1.default.query(`SELECT id, updated_at, created_at FROM teacher_free_lectures
           WHERE teacher_id = $1 AND is_published = TRUE
           ORDER BY updated_at DESC`, [ownerId]),
                pool_1.default.query(`SELECT data FROM tenant_settings WHERE tenant_id = $1 LIMIT 1`, [tenantId]),
            ]);
            for (const course of coursesRes.rows) {
                entries.push({
                    loc: `${baseUrl}${(0, urls_1.tenantCoursePath)(String(course.slug))}`,
                    lastmod: course.updated_at ?? course.created_at,
                    changefreq: 'weekly',
                    priority: '0.8',
                });
            }
            for (const lecture of lecturesRes.rows) {
                entries.push({
                    loc: `${baseUrl}${(0, urls_1.tenantFreeLecturePath)(Number(lecture.id))}`,
                    lastmod: lecture.updated_at ?? lecture.created_at,
                    changefreq: 'monthly',
                    priority: '0.6',
                });
            }
            if (settingsRes.rows[0]?.data?.blog?.enabled) {
                entries.push({
                    loc: `${baseUrl}${(0, urls_1.tenantBlogPath)()}`,
                    lastmod: tenantRes.rows[0]?.updated_at,
                    changefreq: 'weekly',
                    priority: '0.5',
                });
            }
        }
        const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries
            .map((entry) => `  <url>
    <loc>${escapeXml(entry.loc)}</loc>
    <lastmod>${toLastmod(entry.lastmod)}</lastmod>
    <changefreq>${entry.changefreq}</changefreq>
    <priority>${entry.priority}</priority>
  </url>`)
            .join('\n')}
</urlset>`;
        await pool_1.default.query(`INSERT INTO tenant_seo_settings (tenant_id, sitemap_xml, sitemap_generated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (tenant_id) DO UPDATE SET
         sitemap_xml = EXCLUDED.sitemap_xml,
         sitemap_generated_at = NOW(),
         updated_at = NOW()`, [tenantId, body]);
        (0, cache_1.seoCacheSet)(cacheKey, body, cache_1.SEO_CACHE_TTL.sitemap);
        return body;
    }
}
exports.TenantSitemapService = TenantSitemapService;
