import pool from '../../db/pool';
import { seoCacheDeletePrefix } from './cache';
import { CourseSeoService, TenantSeoSettingsService } from './tenantSeoSettings';
import { TenantSitemapService } from './sitemap';

export class SeoHooks {
  static async onTenantProfileChanged(tenantId: number): Promise<void> {
    await TenantSeoSettingsService.syncFromTenantProfile(tenantId);
    TenantSitemapService.invalidate(tenantId);
    seoCacheDeletePrefix(`teacher-page:`);
    seoCacheDeletePrefix(`metadata:`);
  }

  static async onCourseChanged(teacherId: number, courseId?: number, title?: string): Promise<void> {
    const res = await pool.query<{ tenant_id: number; subdomain: string; name: string }>(
      `SELECT u.tenant_id, t.subdomain, u.name
       FROM users u
       JOIN tenants t ON t.id = u.tenant_id
       WHERE u.id = $1 AND u.role = 'teacher'
       LIMIT 1`,
      [teacherId],
    );
    if (!res.rowCount) return;
    const { tenant_id: tenantId, subdomain, name } = res.rows[0];

    if (courseId) {
      await CourseSeoService.syncCourseSeo(courseId, teacherId, name, title);
      seoCacheDeletePrefix(`course-page:${subdomain}:`);
    }

    TenantSitemapService.invalidate(tenantId);
    seoCacheDeletePrefix('search:');
    seoCacheDeletePrefix('popular-');
    seoCacheDeletePrefix(`teacher-page:${subdomain}`);
  }

  static async onCourseDeleted(teacherId: number): Promise<void> {
    const res = await pool.query<{ tenant_id: number; subdomain: string }>(
      `SELECT u.tenant_id, t.subdomain FROM users u JOIN tenants t ON t.id = u.tenant_id WHERE u.id = $1`,
      [teacherId],
    );
    if (!res.rowCount) return;
    TenantSitemapService.invalidate(res.rows[0].tenant_id);
    seoCacheDeletePrefix(`course-page:${res.rows[0].subdomain}:`);
    seoCacheDeletePrefix('search:');
    seoCacheDeletePrefix('popular-');
  }
}
