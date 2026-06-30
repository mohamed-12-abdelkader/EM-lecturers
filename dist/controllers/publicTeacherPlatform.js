"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const express_1 = require("express");
const utils_1 = require("../utils");
const publicTeacherPlatform_1 = require("../services/publicTeacherPlatform");
exports.router = (0, express_1.Router)();
function normalizeSubdomainParam(raw) {
    const subdomain = String(raw || '').trim().toLowerCase();
    if (!subdomain)
        throw new utils_1.HttpError(400, 'subdomain مطلوب');
    return subdomain;
}
exports.router.get('/:subdomain/free-lectures', (0, utils_1.asyncWrapper)(async (req, res) => {
    const subdomain = normalizeSubdomainParam(req.params.subdomain);
    const data = await (0, publicTeacherPlatform_1.getPublicFreeLecturesBySubdomain)(subdomain);
    if (!data) {
        return res.status(404).json({
            success: false,
            code: 'TENANT_NOT_FOUND',
            message: 'منصة المدرّس غير موجودة أو غير نشطة',
        });
    }
    res.json({ success: true, data });
}));
exports.router.get('/:subdomain/courses', (0, utils_1.asyncWrapper)(async (req, res) => {
    const subdomain = normalizeSubdomainParam(req.params.subdomain);
    const gradeId = req.query.grade_id ? Number(req.query.grade_id) : null;
    const data = await (0, publicTeacherPlatform_1.getPublicCoursesBySubdomain)(subdomain, gradeId);
    if (!data) {
        return res.status(404).json({
            success: false,
            code: 'TENANT_NOT_FOUND',
            message: 'منصة المدرّس غير موجودة أو غير نشطة',
        });
    }
    res.json({ success: true, data });
}));
