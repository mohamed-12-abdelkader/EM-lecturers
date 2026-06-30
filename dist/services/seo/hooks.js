"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SeoHooks = void 0;
const pool_1 = __importDefault(require("../../db/pool"));
const cache_1 = require("./cache");
const tenantSeoSettings_1 = require("./tenantSeoSettings");
const sitemap_1 = require("./sitemap");
class SeoHooks {
    static async onTenantProfileChanged(tenantId) {
        await tenantSeoSettings_1.TenantSeoSettingsService.syncFromTenantProfile(tenantId);
        sitemap_1.TenantSitemapService.invalidate(tenantId);
        (0, cache_1.seoCacheDeletePrefix)(`teacher-page:`);
        (0, cache_1.seoCacheDeletePrefix)(`metadata:`);
    }
    static async onCourseChanged(teacherId, courseId, title) {
        const res = await pool_1.default.query(`SELECT u.tenant_id, t.subdomain, u.name
       FROM users u
       JOIN tenants t ON t.id = u.tenant_id
       WHERE u.id = $1 AND u.role = 'teacher'
       LIMIT 1`, [teacherId]);
        if (!res.rowCount)
            return;
        const { tenant_id: tenantId, subdomain, name } = res.rows[0];
        if (courseId) {
            await tenantSeoSettings_1.CourseSeoService.syncCourseSeo(courseId, teacherId, name, title);
            (0, cache_1.seoCacheDeletePrefix)(`course-page:${subdomain}:`);
        }
        sitemap_1.TenantSitemapService.invalidate(tenantId);
        (0, cache_1.seoCacheDeletePrefix)('search:');
        (0, cache_1.seoCacheDeletePrefix)('popular-');
        (0, cache_1.seoCacheDeletePrefix)(`teacher-page:${subdomain}`);
    }
    static async onCourseDeleted(teacherId) {
        const res = await pool_1.default.query(`SELECT u.tenant_id, t.subdomain FROM users u JOIN tenants t ON t.id = u.tenant_id WHERE u.id = $1`, [teacherId]);
        if (!res.rowCount)
            return;
        sitemap_1.TenantSitemapService.invalidate(res.rows[0].tenant_id);
        (0, cache_1.seoCacheDeletePrefix)(`course-page:${res.rows[0].subdomain}:`);
        (0, cache_1.seoCacheDeletePrefix)('search:');
        (0, cache_1.seoCacheDeletePrefix)('popular-');
    }
}
exports.SeoHooks = SeoHooks;
