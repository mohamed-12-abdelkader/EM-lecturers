"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const express_1 = require("express");
const utils_1 = require("../utils");
const appUrls_1 = require("../config/appUrls");
const tenants_1 = require("../services/tenants");
const publicTeacherPlatform_1 = require("../services/publicTeacherPlatform");
const teacherManagedStudents_1 = require("../services/teacherManagedStudents");
const metadata_1 = require("../services/seo/metadata");
const publicPages_1 = require("../services/seo/publicPages");
const robots_1 = require("../services/seo/robots");
const search_1 = require("../services/seo/search");
const sitemap_1 = require("../services/seo/sitemap");
const tenantSeoSettings_1 = require("../services/seo/tenantSeoSettings");
exports.router = (0, express_1.Router)();
function escapeXml(value) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}
function toSitemapLastmod(value) {
    if (!value)
        return new Date().toISOString().slice(0, 10);
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime()))
        return new Date().toISOString().slice(0, 10);
    return date.toISOString().slice(0, 10);
}
/** XML sitemap of all active teacher platforms for Google Search Console. */
exports.router.get('/sitemap.xml', (0, utils_1.asyncWrapper)(async (_req, res) => {
    const tenants = await tenants_1.TenantService.listActivePublicTenants();
    const mainUrl = (0, appUrls_1.getProductionUrl)();
    const entries = [
        { loc: `${mainUrl}/`, lastmod: new Date() },
        ...tenants.map((tenant) => ({
            loc: (0, appUrls_1.buildTenantPublicUrl)(tenant.subdomain),
            lastmod: tenant.updated_at,
        })),
    ];
    const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries
        .map((entry) => `  <url>
    <loc>${escapeXml(entry.loc)}</loc>
    <lastmod>${toSitemapLastmod(entry.lastmod)}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>${entry.loc === `${mainUrl}/` ? '1.0' : '0.8'}</priority>
  </url>`)
        .join('\n')}
</urlset>`;
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    if (!utils_1.config.TENANT_ROOT_DOMAIN?.trim()) {
        res.setHeader('X-Tenant-Seo-Warning', 'TENANT_ROOT_DOMAIN is not configured');
    }
    res.send(body);
}));
/** Per-tenant XML sitemap (home, courses, teacher, free lectures, blog). */
exports.router.get('/:subdomain/sitemap.xml', (0, utils_1.asyncWrapper)(async (req, res) => {
    const subdomain = String(req.params.subdomain || '')
        .trim()
        .toLowerCase();
    if (!subdomain)
        return res.status(400).json({ message: 'subdomain required' });
    const tenant = await tenants_1.TenantService.getBySubdomain(subdomain);
    if (!tenant || !tenant.is_active) {
        return res.status(404).json({ success: false, code: 'TENANT_NOT_FOUND' });
    }
    const xml = await sitemap_1.TenantSitemapService.buildXml(Number(tenant.id), subdomain);
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(xml);
}));
/** Per-tenant robots.txt allowing indexing when configured. */
exports.router.get('/:subdomain/robots.txt', (0, utils_1.asyncWrapper)(async (req, res) => {
    const subdomain = String(req.params.subdomain || '')
        .trim()
        .toLowerCase();
    if (!subdomain)
        return res.status(400).json({ message: 'subdomain required' });
    const seo = await tenantSeoSettings_1.TenantSeoSettingsService.getBySubdomain(subdomain);
    if (!seo)
        return res.status(404).json({ success: false, code: 'TENANT_NOT_FOUND' });
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(robots_1.TenantRobotsService.buildTxt(seo));
}));
/** Full SEO bundle for frontend SSR/SSG (meta tags + JSON-LD). */
exports.router.get('/:subdomain/seo', (0, utils_1.asyncWrapper)(async (req, res) => {
    const subdomain = String(req.params.subdomain || '')
        .trim()
        .toLowerCase();
    if (!subdomain)
        return res.status(400).json({ message: 'subdomain required' });
    const bundle = await metadata_1.SeoMetadataService.getFullSeoBundle(subdomain);
    if (!bundle)
        return res.status(404).json({ success: false, code: 'TENANT_NOT_FOUND' });
    res.json({ success: true, data: bundle });
}));
/** Dynamic page metadata (?page=home|teacher|course|courses&slug=). */
exports.router.get('/:subdomain/seo/metadata', (0, utils_1.asyncWrapper)(async (req, res) => {
    const subdomain = String(req.params.subdomain || '')
        .trim()
        .toLowerCase();
    const page = String(req.query.page ?? 'home');
    const slug = req.query.slug ? String(req.query.slug) : undefined;
    const metadata = await metadata_1.SeoMetadataService.getPageMetadata(subdomain, page, { slug });
    if (!metadata)
        return res.status(404).json({ success: false, code: 'TENANT_NOT_FOUND' });
    res.json({ success: true, data: metadata });
}));
/** Public teacher profile page data (indexable landing). */
exports.router.get('/:subdomain/teacher', (0, utils_1.asyncWrapper)(async (req, res) => {
    const subdomain = String(req.params.subdomain || '')
        .trim()
        .toLowerCase();
    const page = await publicPages_1.PublicPagesService.getTeacherPage(subdomain);
    if (!page)
        return res.status(404).json({ success: false, code: 'TENANT_NOT_FOUND' });
    const metadata = await metadata_1.SeoMetadataService.getPageMetadata(subdomain, 'teacher');
    res.json({ success: true, data: { page, metadata } });
}));
/** Public course page by SEO slug (/course/mathematics-2026). */
exports.router.get('/:subdomain/course/:slug', (0, utils_1.asyncWrapper)(async (req, res) => {
    const subdomain = String(req.params.subdomain || '')
        .trim()
        .toLowerCase();
    const slug = String(req.params.slug || '').trim();
    if (!slug)
        return res.status(400).json({ message: 'slug required' });
    const page = await publicPages_1.PublicPagesService.getCoursePage(subdomain, slug);
    if (!page)
        return res.status(404).json({ success: false, code: 'COURSE_NOT_FOUND' });
    const metadata = await metadata_1.SeoMetadataService.getPageMetadata(subdomain, 'course', { slug });
    res.json({ success: true, data: { page, metadata } });
}));
/** Tenant-scoped full-text search. */
exports.router.get('/:subdomain/search', (0, utils_1.asyncWrapper)(async (req, res) => {
    const subdomain = String(req.params.subdomain || '')
        .trim()
        .toLowerCase();
    const tenant = await tenants_1.TenantService.getBySubdomain(subdomain);
    if (!tenant || !tenant.is_active) {
        return res.status(404).json({ success: false, code: 'TENANT_NOT_FOUND' });
    }
    const data = await search_1.SeoSearchService.search({
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
}));
/** Public free lectures for a teacher platform by subdomain (no auth). */
exports.router.get('/:subdomain/free-lectures', (0, utils_1.asyncWrapper)(async (req, res) => {
    const subdomain = String(req.params.subdomain || '')
        .trim()
        .toLowerCase();
    if (!subdomain)
        return res.status(400).json({ message: 'subdomain required' });
    const data = await (0, publicTeacherPlatform_1.getPublicFreeLecturesBySubdomain)(subdomain);
    if (data === null)
        return res.status(404).json({ success: false, code: 'TENANT_NOT_FOUND' });
    res.json({ success: true, data });
}));
/** Public courses for a teacher platform by subdomain (no auth). */
exports.router.get('/:subdomain/courses', (0, utils_1.asyncWrapper)(async (req, res) => {
    const subdomain = String(req.params.subdomain || '')
        .trim()
        .toLowerCase();
    if (!subdomain)
        return res.status(400).json({ message: 'subdomain required' });
    const gradeId = req.query.grade_id ? Number(req.query.grade_id) : null;
    const data = await (0, publicTeacherPlatform_1.getPublicCoursesBySubdomain)(subdomain, gradeId);
    if (data === null)
        return res.status(404).json({ success: false, code: 'TENANT_NOT_FOUND' });
    res.json({ success: true, data });
}));
/** Public grades list for a teacher platform by subdomain (no auth). */
exports.router.get('/:subdomain/grades', (0, utils_1.asyncWrapper)(async (req, res) => {
    const subdomain = String(req.params.subdomain || '')
        .trim()
        .toLowerCase();
    if (!subdomain)
        return res.status(400).json({ message: 'subdomain required' });
    const grades = await tenants_1.TenantService.getPublicTeacherGradesBySubdomain(subdomain);
    if (grades === null)
        return res.status(404).json({ success: false, code: 'TENANT_NOT_FOUND' });
    res.json({ success: true, data: { subdomain, grades } });
}));
/** Public registration mode for student signup/login UI (no auth). */
exports.router.get('/:subdomain/registration-settings', (0, utils_1.asyncWrapper)(async (req, res) => {
    const subdomain = String(req.params.subdomain || '')
        .trim()
        .toLowerCase();
    if (!subdomain)
        return res.status(400).json({ message: 'subdomain required' });
    const tenant = await tenants_1.TenantService.getBySubdomain(subdomain);
    if (!tenant || !tenant.is_active) {
        return res.status(404).json({ success: false, code: 'TENANT_NOT_FOUND' });
    }
    const data = await teacherManagedStudents_1.TeacherManagedStudentsService.getRegistrationSettings(tenant.id);
    res.json({
        success: true,
        data: {
            registration_mode: data.registration_mode,
            self_registration_enabled: data.registration_mode === 'self_registration',
            login_with_student_code: data.registration_mode === 'teacher_registration',
            login_with_code_only: data.registration_mode === 'teacher_registration',
            student_code_digits_only: true,
            message: data.registration_mode === 'teacher_registration'
                ? 'يتم إنشاء الحسابات بواسطة المدرس. سجّل الدخول برقم الطالب و subdomain المنصة فقط.'
                : null,
        },
    });
}));
/** Public read-model for Next.js / marketing (no auth). */
exports.router.get('/:subdomain', (0, utils_1.asyncWrapper)(async (req, res) => {
    const subdomain = String(req.params.subdomain || '')
        .trim()
        .toLowerCase();
    if (!subdomain)
        return res.status(400).json({ message: 'subdomain required' });
    const bundle = await tenants_1.TenantService.getPublicBundle(subdomain);
    if (!bundle)
        return res.status(404).json({ success: false, code: 'TENANT_NOT_FOUND' });
    res.json({ success: true, data: bundle });
}));
