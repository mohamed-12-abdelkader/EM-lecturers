"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CourseSeoService = exports.TenantSeoSettingsService = void 0;
const pool_1 = __importDefault(require("../../db/pool"));
const appUrls_1 = require("../../config/appUrls");
const slug_1 = require("./slug");
const urls_1 = require("./urls");
const DEFAULT_KEYWORDS = ['منصة تعليمية', 'مدرس', 'كورسات', 'EM Lectures'];
class TenantSeoSettingsService {
    static async getByTenantId(tenantId) {
        const res = await pool_1.default.query(`SELECT
         t.id AS tenant_id,
         t.subdomain,
         t.display_name,
         t.specialty,
         t.bio,
         t.avatar_url,
         t.seo_title,
         t.seo_meta_description,
         t.favicon_url,
         t.og_image_url,
         COALESCE(s.seo_keywords, '{}') AS seo_keywords,
         s.canonical_url,
         s.og_title,
         s.og_description,
         s.og_image,
         s.twitter_title,
         s.twitter_description,
         s.twitter_image,
         COALESCE(s.robots_index, TRUE) AS robots_index,
         COALESCE(s.robots_follow, TRUE) AS robots_follow,
         COALESCE(s.auto_generate, TRUE) AS auto_generate
       FROM tenants t
       LEFT JOIN tenant_seo_settings s ON s.tenant_id = t.id
       WHERE t.id = $1
       LIMIT 1`, [tenantId]);
        if (!res.rowCount)
            return null;
        const row = res.rows[0];
        return {
            tenant_id: row.tenant_id,
            subdomain: row.subdomain,
            display_name: row.display_name,
            specialty: row.specialty,
            bio: row.bio,
            avatar_url: row.avatar_url,
            seo_title: row.seo_title,
            seo_meta_description: row.seo_meta_description,
            favicon_url: row.favicon_url,
            og_image_url: row.og_image_url,
            seo_keywords: Array.isArray(row.seo_keywords) ? row.seo_keywords : [],
            canonical_url: row.canonical_url,
            og_title: row.og_title,
            og_description: row.og_description,
            og_image: row.og_image,
            twitter_title: row.twitter_title,
            twitter_description: row.twitter_description,
            twitter_image: row.twitter_image,
            robots_index: row.robots_index !== false,
            robots_follow: row.robots_follow !== false,
            auto_generate: row.auto_generate !== false,
        };
    }
    static async getBySubdomain(subdomain) {
        const res = await pool_1.default.query(`SELECT id FROM tenants WHERE subdomain = $1 AND is_active = TRUE LIMIT 1`, [subdomain.trim().toLowerCase()]);
        if (!res.rowCount)
            return null;
        return this.getByTenantId(res.rows[0].id);
    }
    static async ensureSettingsRow(tenantId) {
        await pool_1.default.query(`INSERT INTO tenant_seo_settings (tenant_id)
       VALUES ($1)
       ON CONFLICT (tenant_id) DO NOTHING`, [tenantId]);
    }
    static buildAutoSeo(tenant, teacher) {
        const teacherName = teacher?.name ?? tenant.display_name;
        const specialty = tenant.specialty ?? teacher?.subject ?? 'منصة تعليمية';
        const description = tenant.bio?.trim() ||
            teacher?.description?.trim() ||
            `منصة ${teacherName} التعليمية — ${specialty}. كورسات ومحاضرات أونلاين.`;
        const title = `${teacherName} | ${specialty} | EM Lectures`;
        const keywords = [
            teacherName,
            specialty,
            teacher?.subject,
            tenant.subdomain,
            ...DEFAULT_KEYWORDS,
        ].filter(Boolean);
        const image = (0, appUrls_1.buildFileUrl)(tenant.og_image_url ?? tenant.avatar_url);
        const canonicalUrl = (0, urls_1.buildCanonicalUrl)(tenant.subdomain, '/');
        return {
            seo_title: title,
            seo_meta_description: description.slice(0, 320),
            seo_keywords: [...new Set(keywords)],
            canonical_url: canonicalUrl,
            og_title: title,
            og_description: description.slice(0, 320),
            og_image: image,
            twitter_title: title,
            twitter_description: description.slice(0, 200),
            twitter_image: image,
            favicon_url: (0, appUrls_1.buildFileUrl)(tenant.favicon_url ?? tenant.avatar_url),
        };
    }
    static async syncFromTenantProfile(tenantId) {
        const tenantRes = await pool_1.default.query(`SELECT t.*, u.name AS owner_name, u.subject AS owner_subject, u.description AS owner_description
       FROM tenants t
       LEFT JOIN users u ON u.id = t.owner_user_id
       WHERE t.id = $1
       LIMIT 1`, [tenantId]);
        if (!tenantRes.rowCount)
            return;
        const row = tenantRes.rows[0];
        await this.ensureSettingsRow(tenantId);
        const settingsRes = await pool_1.default.query(`SELECT auto_generate FROM tenant_seo_settings WHERE tenant_id = $1`, [tenantId]);
        if (settingsRes.rows[0]?.auto_generate === false)
            return;
        const auto = this.buildAutoSeo({
            display_name: row.display_name,
            specialty: row.specialty,
            bio: row.bio,
            subdomain: row.subdomain,
            avatar_url: row.avatar_url,
            og_image_url: row.og_image_url,
            favicon_url: row.favicon_url,
        }, {
            name: row.owner_name,
            subject: row.owner_subject,
            description: row.owner_description,
        });
        await pool_1.default.query(`UPDATE tenants SET seo_title = $2, seo_meta_description = $3, updated_at = NOW() WHERE id = $1`, [tenantId, auto.seo_title, auto.seo_meta_description]);
        await pool_1.default.query(`UPDATE tenant_seo_settings SET
         seo_keywords = $2,
         canonical_url = $3,
         og_title = $4,
         og_description = $5,
         og_image = $6,
         twitter_title = $7,
         twitter_description = $8,
         twitter_image = $9,
         sitemap_xml = NULL,
         sitemap_generated_at = NULL,
         updated_at = NOW()
       WHERE tenant_id = $1`, [
            tenantId,
            auto.seo_keywords,
            auto.canonical_url,
            auto.og_title,
            auto.og_description,
            auto.og_image,
            auto.twitter_title,
            auto.twitter_description,
            auto.twitter_image,
        ]);
    }
    static async patchSettings(tenantId, patch) {
        await this.ensureSettingsRow(tenantId);
        if (patch.seo_title !== undefined ||
            patch.seo_meta_description !== undefined ||
            patch.favicon_url !== undefined) {
            const fields = [];
            const vals = [];
            let i = 1;
            if (patch.seo_title !== undefined) {
                fields.push(`seo_title = $${i++}`);
                vals.push(patch.seo_title);
            }
            if (patch.seo_meta_description !== undefined) {
                fields.push(`seo_meta_description = $${i++}`);
                vals.push(patch.seo_meta_description);
            }
            if (patch.favicon_url !== undefined) {
                fields.push(`favicon_url = $${i++}`);
                vals.push(patch.favicon_url);
            }
            if (fields.length) {
                vals.push(tenantId);
                await pool_1.default.query(`UPDATE tenants SET ${fields.join(', ')}, updated_at = NOW() WHERE id = $${i}`, vals);
            }
        }
        const sFields = [];
        const sVals = [];
        let si = 1;
        const add = (col, val) => {
            sFields.push(`${col} = $${si++}`);
            sVals.push(val);
        };
        if (patch.seo_keywords !== undefined)
            add('seo_keywords', patch.seo_keywords);
        if (patch.canonical_url !== undefined)
            add('canonical_url', patch.canonical_url);
        if (patch.og_title !== undefined)
            add('og_title', patch.og_title);
        if (patch.og_description !== undefined)
            add('og_description', patch.og_description);
        if (patch.og_image !== undefined)
            add('og_image', patch.og_image);
        if (patch.twitter_title !== undefined)
            add('twitter_title', patch.twitter_title);
        if (patch.twitter_description !== undefined)
            add('twitter_description', patch.twitter_description);
        if (patch.twitter_image !== undefined)
            add('twitter_image', patch.twitter_image);
        if (patch.robots_index !== undefined)
            add('robots_index', patch.robots_index);
        if (patch.robots_follow !== undefined)
            add('robots_follow', patch.robots_follow);
        if (patch.auto_generate !== undefined)
            add('auto_generate', patch.auto_generate);
        if (sFields.length) {
            sFields.push('sitemap_xml = NULL', 'sitemap_generated_at = NULL', 'updated_at = NOW()');
            sVals.push(tenantId);
            await pool_1.default.query(`UPDATE tenant_seo_settings SET ${sFields.join(', ')} WHERE tenant_id = $${si}`, sVals);
        }
        return this.getByTenantId(tenantId);
    }
}
exports.TenantSeoSettingsService = TenantSeoSettingsService;
class CourseSeoService {
    static async ensureUniqueSlug(teacherId, title, courseId, preferredSlug) {
        const base = (preferredSlug && (0, slug_1.slugifyTitle)(preferredSlug)) ||
            (0, slug_1.slugifyTitle)(title) ||
            (courseId ? (0, slug_1.fallbackSlug)('course', courseId) : (0, slug_1.fallbackSlug)('course', Date.now()));
        let slug = base;
        let suffix = 2;
        for (;;) {
            const existing = await pool_1.default.query(`SELECT id FROM courses
         WHERE teacher_id = $1 AND slug = $2 AND ($3::int IS NULL OR id <> $3)
         LIMIT 1`, [teacherId, slug, courseId ?? null]);
            if (!existing.rowCount)
                return slug;
            slug = `${base}-${suffix++}`;
        }
    }
    static async assignSlugForCourse(courseId, teacherId, title) {
        const slug = await this.ensureUniqueSlug(teacherId, title, courseId);
        await pool_1.default.query(`UPDATE courses SET slug = $2 WHERE id = $1`, [courseId, slug]);
        await pool_1.default.query(`INSERT INTO course_seo_stats (course_id) VALUES ($1) ON CONFLICT (course_id) DO NOTHING`, [courseId]);
        return slug;
    }
    static async syncCourseSeo(courseId, teacherId, teacherName, title) {
        const res = await pool_1.default.query(`SELECT id, title, description, slug FROM courses WHERE id = $1 AND teacher_id = $2 LIMIT 1`, [courseId, teacherId]);
        if (!res.rowCount)
            return;
        const course = res.rows[0];
        const courseTitle = title ?? course.title;
        const seoTitle = `${courseTitle} | ${teacherName}`;
        const seoDescription = (course.description ?? `${courseTitle} — كورس مع ${teacherName}`).slice(0, 320);
        let slug = course.slug;
        if (!slug || String(slug).startsWith('course-')) {
            slug = await this.ensureUniqueSlug(teacherId, courseTitle, courseId);
        }
        await pool_1.default.query(`UPDATE courses SET slug = $2, seo_title = $3, seo_description = $4 WHERE id = $1`, [courseId, slug, seoTitle, seoDescription]);
        await pool_1.default.query(`INSERT INTO course_seo_stats (course_id) VALUES ($1) ON CONFLICT (course_id) DO NOTHING`, [courseId]);
    }
}
exports.CourseSeoService = CourseSeoService;
