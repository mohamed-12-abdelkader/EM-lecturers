import { Router } from 'express';
import { asyncWrapper, config } from '../utils';
import { buildTenantPublicUrl, getProductionUrl } from '../config/appUrls';
import { TenantService } from '../services/tenants';
import {
  getPublicCoursesBySubdomain,
  getPublicFreeLecturesBySubdomain,
} from '../services/publicTeacherPlatform';
import { TeacherManagedStudentsService } from '../services/teacherManagedStudents';
import { SeoMetadataService } from '../services/seo/metadata';
import { PublicPagesService } from '../services/seo/publicPages';
import { TenantRobotsService } from '../services/seo/robots';
import { SeoSearchService } from '../services/seo/search';
import { TenantSitemapService } from '../services/seo/sitemap';
import { TenantSeoSettingsService } from '../services/seo/tenantSeoSettings';

export const router = Router();

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function toSitemapLastmod(value: Date | string | null | undefined): string {
  if (!value) return new Date().toISOString().slice(0, 10);
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10);
  return date.toISOString().slice(0, 10);
}

/** XML sitemap of all active teacher platforms for Google Search Console. */
router.get(
  '/sitemap.xml',
  asyncWrapper(async (_req, res) => {
    const tenants = await TenantService.listActivePublicTenants();
    const mainUrl = getProductionUrl();
    const entries = [
      { loc: `${mainUrl}/`, lastmod: new Date() },
      ...tenants.map((tenant) => ({
        loc: buildTenantPublicUrl(tenant.subdomain),
        lastmod: tenant.updated_at,
      })),
    ];

    const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries
  .map(
    (entry) => `  <url>
    <loc>${escapeXml(entry.loc)}</loc>
    <lastmod>${toSitemapLastmod(entry.lastmod)}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>${entry.loc === `${mainUrl}/` ? '1.0' : '0.8'}</priority>
  </url>`,
  )
  .join('\n')}
</urlset>`;

    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    if (!config.TENANT_ROOT_DOMAIN?.trim()) {
      res.setHeader('X-Tenant-Seo-Warning', 'TENANT_ROOT_DOMAIN is not configured');
    }
    res.send(body);
  }),
);

/** Per-tenant XML sitemap (home, courses, teacher, free lectures, blog). */
router.get(
  '/:subdomain/sitemap.xml',
  asyncWrapper(async (req, res) => {
    const subdomain = String(req.params.subdomain || '')
      .trim()
      .toLowerCase();
    if (!subdomain) return res.status(400).json({ message: 'subdomain required' });

    const tenant = await TenantService.getBySubdomain(subdomain);
    if (!tenant || !tenant.is_active) {
      return res.status(404).json({ success: false, code: 'TENANT_NOT_FOUND' });
    }

    const xml = await TenantSitemapService.buildXml(Number(tenant.id), subdomain);
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(xml);
  }),
);

/** Per-tenant robots.txt allowing indexing when configured. */
router.get(
  '/:subdomain/robots.txt',
  asyncWrapper(async (req, res) => {
    const subdomain = String(req.params.subdomain || '')
      .trim()
      .toLowerCase();
    if (!subdomain) return res.status(400).json({ message: 'subdomain required' });

    const seo = await TenantSeoSettingsService.getBySubdomain(subdomain);
    if (!seo) return res.status(404).json({ success: false, code: 'TENANT_NOT_FOUND' });

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(TenantRobotsService.buildTxt(seo));
  }),
);

/** Full SEO bundle for frontend SSR/SSG (meta tags + JSON-LD). */
router.get(
  '/:subdomain/seo',
  asyncWrapper(async (req, res) => {
    const subdomain = String(req.params.subdomain || '')
      .trim()
      .toLowerCase();
    if (!subdomain) return res.status(400).json({ message: 'subdomain required' });

    const bundle = await SeoMetadataService.getFullSeoBundle(subdomain);
    if (!bundle) return res.status(404).json({ success: false, code: 'TENANT_NOT_FOUND' });
    res.json({ success: true, data: bundle });
  }),
);

/** Dynamic page metadata (?page=home|teacher|course|courses&slug=). */
router.get(
  '/:subdomain/seo/metadata',
  asyncWrapper(async (req, res) => {
    const subdomain = String(req.params.subdomain || '')
      .trim()
      .toLowerCase();
    const page = String(req.query.page ?? 'home') as
      | 'home'
      | 'teacher'
      | 'course'
      | 'courses'
      | 'free-lecture'
      | 'blog';
    const slug = req.query.slug ? String(req.query.slug) : undefined;

    const metadata = await SeoMetadataService.getPageMetadata(subdomain, page, { slug });
    if (!metadata) return res.status(404).json({ success: false, code: 'TENANT_NOT_FOUND' });
    res.json({ success: true, data: metadata });
  }),
);

/** Public teacher profile page data (indexable landing). */
router.get(
  '/:subdomain/teacher',
  asyncWrapper(async (req, res) => {
    const subdomain = String(req.params.subdomain || '')
      .trim()
      .toLowerCase();
    const page = await PublicPagesService.getTeacherPage(subdomain);
    if (!page) return res.status(404).json({ success: false, code: 'TENANT_NOT_FOUND' });

    const metadata = await SeoMetadataService.getPageMetadata(subdomain, 'teacher');
    res.json({ success: true, data: { page, metadata } });
  }),
);

/** Public course page by SEO slug (/course/mathematics-2026). */
router.get(
  '/:subdomain/course/:slug',
  asyncWrapper(async (req, res) => {
    const subdomain = String(req.params.subdomain || '')
      .trim()
      .toLowerCase();
    const slug = String(req.params.slug || '').trim();
    if (!slug) return res.status(400).json({ message: 'slug required' });

    const page = await PublicPagesService.getCoursePage(subdomain, slug);
    if (!page) return res.status(404).json({ success: false, code: 'COURSE_NOT_FOUND' });

    const metadata = await SeoMetadataService.getPageMetadata(subdomain, 'course', { slug });
    res.json({ success: true, data: { page, metadata } });
  }),
);

/** Tenant-scoped full-text search. */
router.get(
  '/:subdomain/search',
  asyncWrapper(async (req, res) => {
    const subdomain = String(req.params.subdomain || '')
      .trim()
      .toLowerCase();
    const tenant = await TenantService.getBySubdomain(subdomain);
    if (!tenant || !tenant.is_active) {
      return res.status(404).json({ success: false, code: 'TENANT_NOT_FOUND' });
    }

    const data = await SeoSearchService.search({
      q: req.query.q ? String(req.query.q) : undefined,
      specialty: req.query.specialty ? String(req.query.specialty) : undefined,
      subject: req.query.subject ? String(req.query.subject) : undefined,
      grade: req.query.grade ? String(req.query.grade) : undefined,
      stage: req.query.stage ? String(req.query.stage) : undefined,
      keywords: req.query.keywords ? String(req.query.keywords) : undefined,
      tenant_id: Number(tenant.id),
      limit: req.query.limit ? Number(req.query.limit) : 20,
      offset: req.query.offset ? Number(req.query.offset) : 0,
    });

    res.json({ success: true, data });
  }),
);

/** Public free lectures for a teacher platform by subdomain (no auth). */
router.get(
  '/:subdomain/free-lectures',
  asyncWrapper(async (req, res) => {
    const subdomain = String(req.params.subdomain || '')
      .trim()
      .toLowerCase();
    if (!subdomain) return res.status(400).json({ message: 'subdomain required' });

    const data = await getPublicFreeLecturesBySubdomain(subdomain);
    if (data === null) return res.status(404).json({ success: false, code: 'TENANT_NOT_FOUND' });

    res.json({ success: true, data });
  }),
);

/** Public courses for a teacher platform by subdomain (no auth). */
router.get(
  '/:subdomain/courses',
  asyncWrapper(async (req, res) => {
    const subdomain = String(req.params.subdomain || '')
      .trim()
      .toLowerCase();
    if (!subdomain) return res.status(400).json({ message: 'subdomain required' });

    const gradeId = req.query.grade_id ? Number(req.query.grade_id) : null;
    const data = await getPublicCoursesBySubdomain(subdomain, gradeId);
    if (data === null) return res.status(404).json({ success: false, code: 'TENANT_NOT_FOUND' });
    res.json({ success: true, data });
  }),
);

/** Public grades list for a teacher platform by subdomain (no auth). */
router.get(
  '/:subdomain/grades',
  asyncWrapper(async (req, res) => {
    const subdomain = String(req.params.subdomain || '')
      .trim()
      .toLowerCase();
    if (!subdomain) return res.status(400).json({ message: 'subdomain required' });

    const grades = await TenantService.getPublicTeacherGradesBySubdomain(subdomain);
    if (grades === null) return res.status(404).json({ success: false, code: 'TENANT_NOT_FOUND' });

    res.json({ success: true, data: { subdomain, grades } });
  }),
);

/** Public registration mode for student signup/login UI (no auth). */
router.get(
  '/:subdomain/registration-settings',
  asyncWrapper(async (req, res) => {
    const subdomain = String(req.params.subdomain || '')
      .trim()
      .toLowerCase();
    if (!subdomain) return res.status(400).json({ message: 'subdomain required' });

    const tenant = await TenantService.getBySubdomain(subdomain);
    if (!tenant || !tenant.is_active) {
      return res.status(404).json({ success: false, code: 'TENANT_NOT_FOUND' });
    }

    const data = await TeacherManagedStudentsService.getRegistrationSettings(tenant.id);
    res.json({
      success: true,
      data: {
        registration_mode: data.registration_mode,
        self_registration_enabled: data.registration_mode === 'self_registration',
        login_with_student_code: data.registration_mode === 'teacher_registration',
        login_with_code_only: data.registration_mode === 'teacher_registration',
        student_code_digits_only: true,
        message:
          data.registration_mode === 'teacher_registration'
            ? 'يتم إنشاء الحسابات بواسطة المدرس. سجّل الدخول برقم الطالب و subdomain المنصة فقط.'
            : null,
      },
    });
  }),
);

/** Public read-model for Next.js / marketing (no auth). */
router.get(
  '/:subdomain',
  asyncWrapper(async (req, res) => {
    const subdomain = String(req.params.subdomain || '')
      .trim()
      .toLowerCase();
    if (!subdomain) return res.status(400).json({ message: 'subdomain required' });

    const bundle = await TenantService.getPublicBundle(subdomain);
    if (!bundle) return res.status(404).json({ success: false, code: 'TENANT_NOT_FOUND' });

    res.json({ success: true, data: bundle });
  }),
);
