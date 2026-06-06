"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const express_1 = require("express");
const utils_1 = require("../utils");
const tenants_1 = require("../services/tenants");
exports.router = (0, express_1.Router)();
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
