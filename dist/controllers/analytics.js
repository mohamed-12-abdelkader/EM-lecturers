"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const express_1 = require("express");
const authentication_1 = require("../middleware/authentication");
const utils_1 = require("../utils");
const analyticsIntelligence_1 = require("../services/analyticsIntelligence");
exports.router = (0, express_1.Router)();
function tenantIdOrDefault(reqTenantId) {
    return reqTenantId ?? 1;
}
function parseId(value, fieldName) {
    const id = Number(value);
    if (!Number.isInteger(id) || id <= 0)
        throw new utils_1.HttpError(400, `Invalid ${fieldName}`);
    return id;
}
exports.router.get('/course/:courseId', (0, authentication_1.authMiddleware)(['admin', 'teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const courseId = parseId(req.params.courseId, 'course id');
    const data = await analyticsIntelligence_1.AnalyticsIntelligenceService.getCourseAnalytics({ tenantId: tenantIdOrDefault(req.tenant?.id) }, courseId, { from: req.query.from, to: req.query.to });
    res.json({ success: true, data });
}));
exports.router.get('/lecture/:lectureId', (0, authentication_1.authMiddleware)(['admin', 'teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const lectureId = parseId(req.params.lectureId, 'lecture id');
    const data = await analyticsIntelligence_1.AnalyticsIntelligenceService.getLectureAnalytics({ tenantId: tenantIdOrDefault(req.tenant?.id) }, lectureId, { from: req.query.from, to: req.query.to });
    res.json({ success: true, data });
}));
exports.router.get('/student/:studentId', (0, authentication_1.authMiddleware)(['admin', 'teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const studentId = parseId(req.params.studentId, 'student id');
    const data = await analyticsIntelligence_1.AnalyticsIntelligenceService.getStudentAnalytics({ tenantId: tenantIdOrDefault(req.tenant?.id) }, studentId, { from: req.query.from, to: req.query.to });
    res.json({ success: true, data });
}));
exports.router.get('/exam/:examId', (0, authentication_1.authMiddleware)(['admin', 'teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const examId = parseId(req.params.examId, 'exam id');
    const data = await analyticsIntelligence_1.AnalyticsIntelligenceService.getExamAnalytics({ tenantId: tenantIdOrDefault(req.tenant?.id) }, examId, { from: req.query.from, to: req.query.to });
    res.json({ success: true, data });
}));
exports.router.get('/questions/difficult', (0, authentication_1.authMiddleware)(['admin', 'teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const limit = req.query.limit ? Number(req.query.limit) : 20;
    const data = await analyticsIntelligence_1.AnalyticsIntelligenceService.getDifficultQuestions({ tenantId: tenantIdOrDefault(req.tenant?.id) }, Number.isFinite(limit) && limit > 0 ? limit : 20);
    res.json({ success: true, data });
}));
exports.router.get('/students/top', (0, authentication_1.authMiddleware)(['admin', 'teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const limit = req.query.limit ? Number(req.query.limit) : 20;
    const data = await analyticsIntelligence_1.AnalyticsIntelligenceService.getTopStudents({ tenantId: tenantIdOrDefault(req.tenant?.id) }, Number.isFinite(limit) && limit > 0 ? limit : 20);
    res.json({ success: true, data });
}));
exports.router.get('/students/at-risk', (0, authentication_1.authMiddleware)(['admin', 'teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const limit = req.query.limit ? Number(req.query.limit) : 20;
    const data = await analyticsIntelligence_1.AnalyticsIntelligenceService.getAtRiskStudents({ tenantId: tenantIdOrDefault(req.tenant?.id) }, Number.isFinite(limit) && limit > 0 ? limit : 20);
    res.json({ success: true, data });
}));
exports.router.get('/performance-summary', (0, authentication_1.authMiddleware)(['admin', 'teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const data = await analyticsIntelligence_1.AnalyticsIntelligenceService.getPerformanceSummary({
        tenantId: tenantIdOrDefault(req.tenant?.id),
    });
    res.json({ success: true, data });
}));
