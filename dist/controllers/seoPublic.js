"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const utils_1 = require("../utils");
const search_1 = require("../services/seo/search");
exports.router = (0, express_1.Router)();
const SearchQuerySchema = zod_1.z.object({
    q: zod_1.z.string().optional(),
    specialty: zod_1.z.string().optional(),
    subject: zod_1.z.string().optional(),
    grade: zod_1.z.string().optional(),
    stage: zod_1.z.string().optional(),
    keywords: zod_1.z.string().optional(),
    tenant_id: zod_1.z.coerce.number().int().positive().optional(),
    limit: zod_1.z.coerce.number().int().min(1).max(50).optional(),
    offset: zod_1.z.coerce.number().int().min(0).optional(),
});
exports.router.get('/search', (0, utils_1.asyncWrapper)(async (req, res) => {
    const parsed = SearchQuerySchema.safeParse(req.query);
    if (!parsed.success) {
        return res.status(400).json({ success: false, errors: parsed.error.errors });
    }
    const data = await search_1.SeoSearchService.search(parsed.data);
    res.json({ success: true, data });
}));
exports.router.get('/search/suggestions', (0, utils_1.asyncWrapper)(async (req, res) => {
    const q = String(req.query.q ?? '');
    const tenantId = req.query.tenant_id ? Number(req.query.tenant_id) : undefined;
    const suggestions = await search_1.SeoSearchService.suggestions(q, tenantId);
    res.json({ success: true, data: { suggestions } });
}));
exports.router.get('/search/trending', (0, utils_1.asyncWrapper)(async (req, res) => {
    const tenantId = req.query.tenant_id ? Number(req.query.tenant_id) : undefined;
    const days = req.query.days ? Number(req.query.days) : 7;
    const trending = await search_1.SeoSearchService.trending(tenantId, days);
    res.json({ success: true, data: { trending } });
}));
exports.router.get('/popular/teachers', (0, utils_1.asyncWrapper)(async (req, res) => {
    const limit = req.query.limit ? Number(req.query.limit) : 10;
    const teachers = await search_1.SeoSearchService.popularTeachers(limit);
    res.json({ success: true, data: { teachers } });
}));
exports.router.get('/popular/courses', (0, utils_1.asyncWrapper)(async (req, res) => {
    const limit = req.query.limit ? Number(req.query.limit) : 10;
    const tenantId = req.query.tenant_id ? Number(req.query.tenant_id) : undefined;
    const courses = await search_1.SeoSearchService.popularCourses(limit, tenantId);
    res.json({ success: true, data: { courses } });
}));
