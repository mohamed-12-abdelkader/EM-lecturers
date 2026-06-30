"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const express_1 = require("express");
const authentication_1 = require("../middleware/authentication");
const tenantContext_1 = require("../middleware/tenantContext");
const validateReq_1 = require("../middleware/validateReq");
const utils_1 = require("../utils");
const tenants_1 = require("../services/tenants");
const tenantSeoSettings_1 = require("../services/seo/tenantSeoSettings");
const sitemap_1 = require("../services/seo/sitemap");
const cache_1 = require("../services/seo/cache");
const zod_1 = require("zod");
const tenantFormPayload_1 = require("../utils/tenantFormPayload");
exports.router = (0, express_1.Router)();
exports.router.use((0, tenantContext_1.requireDefaultTenantMiddleware)());
exports.router.use((0, authentication_1.authMiddleware)(['admin']));
function parseBooleanQuery(value) {
    if (value === undefined || value === null || value === '')
        return null;
    if (value === true || value === 'true' || value === '1')
        return true;
    if (value === false || value === 'false' || value === '0')
        return false;
    return null;
}
function parseTenantId(raw) {
    const id = Number(raw);
    if (!id || Number.isNaN(id))
        throw new utils_1.HttpError(400, 'معرف المنصة غير صحيح');
    return id;
}
exports.router.get('/', (0, utils_1.asyncWrapper)(async (req, res) => {
    const limit = Number(req.query.limit ?? 50);
    const offset = Number(req.query.offset ?? 0);
    const includeDefault = req.query.include_default === 'true' || req.query.include_default === '1';
    const isActive = parseBooleanQuery(req.query.is_active);
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    const { tenants, total } = await tenants_1.TenantService.listTeacherTenantsForAdmin({
        limit: Number.isFinite(limit) ? limit : 50,
        offset: Number.isFinite(offset) ? offset : 0,
        includeDefault,
        isActive,
        search,
    });
    res.json({
        success: true,
        data: {
            tenants,
            total,
            limit: Math.min(Math.max(Number.isFinite(limit) ? limit : 50, 1), 200),
            offset: Math.max(Number.isFinite(offset) ? offset : 0, 0),
        },
    });
}));
exports.router.get('/:id', (0, utils_1.asyncWrapper)(async (req, res) => {
    const tenant = await tenants_1.TenantService.getTenantForAdmin(parseTenantId(req.params.id));
    if (!tenant)
        throw new utils_1.HttpError(404, 'المنصة غير موجودة');
    res.json({ success: true, data: tenant });
}));
exports.router.patch('/:id', (req, res, next) => {
    if ((0, tenantFormPayload_1.isMultipartRequest)(req)) {
        return (0, tenantFormPayload_1.uploadTenantFiles)(req, res, next);
    }
    next();
}, (req, res, next) => {
    if (!(0, tenantFormPayload_1.isMultipartRequest)(req)) {
        return (0, validateReq_1.validate)(tenantFormPayload_1.PatchTenantBodySchema)(req, res, next);
    }
    next();
}, (0, utils_1.asyncWrapper)(async (req, res) => {
    const id = parseTenantId(req.params.id);
    let payload;
    if ((0, tenantFormPayload_1.isMultipartRequest)(req)) {
        const built = await (0, tenantFormPayload_1.buildPatchTenantFromMultipart)(req);
        if ('error' in built) {
            return res.status(400).json({ success: false, message: built.error });
        }
        payload = built.data;
    }
    else {
        payload = tenantFormPayload_1.PatchTenantBodySchema.parse(req.body);
    }
    try {
        const tenant = await tenants_1.TenantService.patchTenant(id, payload);
        res.json({
            success: true,
            message: 'تم تحديث بيانات المنصة',
            data: tenant,
        });
    }
    catch (e) {
        const err = e;
        if (err.code === '23505') {
            return res.status(409).json({ success: false, message: 'Subdomain already taken' });
        }
        if (err.message === 'Tenant not found') {
            throw new utils_1.HttpError(404, 'المنصة غير موجودة');
        }
        throw e;
    }
}));
const PatchTenantSeoSchema = zod_1.z.object({
    seo_title: zod_1.z.string().max(200).optional(),
    seo_meta_description: zod_1.z.string().max(500).optional(),
    seo_keywords: zod_1.z.array(zod_1.z.string()).optional(),
    canonical_url: zod_1.z.string().url().optional(),
    og_title: zod_1.z.string().max(200).optional(),
    og_description: zod_1.z.string().max(500).optional(),
    og_image: zod_1.z.string().optional(),
    twitter_title: zod_1.z.string().max(200).optional(),
    twitter_description: zod_1.z.string().max(300).optional(),
    twitter_image: zod_1.z.string().optional(),
    favicon_url: zod_1.z.string().optional(),
    robots_index: zod_1.z.boolean().optional(),
    robots_follow: zod_1.z.boolean().optional(),
    auto_generate: zod_1.z.boolean().optional(),
});
exports.router.patch('/:id/seo', (0, utils_1.asyncWrapper)(async (req, res) => {
    const id = parseTenantId(req.params.id);
    const parsed = PatchTenantSeoSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ success: false, errors: parsed.error.errors });
    }
    const patch = { ...parsed.data };
    if (patch.auto_generate === undefined && Object.keys(patch).length > 0) {
        patch.auto_generate = false;
    }
    const seo = await tenantSeoSettings_1.TenantSeoSettingsService.patchSettings(id, patch);
    if (!seo)
        throw new utils_1.HttpError(404, 'المنصة غير موجودة');
    sitemap_1.TenantSitemapService.invalidate(id);
    (0, cache_1.seoCacheDeletePrefix)('teacher-page:');
    (0, cache_1.seoCacheDeletePrefix)('metadata:');
    res.json({
        success: true,
        message: 'تم تحديث إعدادات SEO',
        data: seo,
    });
}));
