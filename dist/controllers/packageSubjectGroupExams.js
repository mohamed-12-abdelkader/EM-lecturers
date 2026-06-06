"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const authentication_1 = require("../middleware/authentication");
const utils_1 = require("../utils");
const packageSubjectGroups_1 = require("../services/packageSubjectGroups");
const packageSubjectGroupExams_1 = require("../services/packageSubjectGroupExams");
exports.router = (0, express_1.Router)();
const CreateExamSchema = zod_1.z.object({
    title: zod_1.z.string().min(1),
    duration: zod_1.z.number().int().min(0),
    total_marks: zod_1.z.number().int().min(0),
});
const UpdateExamSchema = zod_1.z.object({
    title: zod_1.z.string().min(1).optional(),
    duration: zod_1.z.number().int().min(0).optional(),
    total_marks: zod_1.z.number().int().min(0).optional(),
    is_visible: zod_1.z.boolean().optional(),
});
async function checkGroupPermission(groupId, userId, userRole) {
    if (userRole === 'admin')
        return true;
    if (userRole !== 'teacher')
        return false;
    return await packageSubjectGroups_1.PackageSubjectGroupsService.teacherOwnsGroup(groupId, userId);
}
// POST /api/subjects/:subjectId/groups/:groupId/package-group-exams
exports.router.post('/subjects/:subjectId(\\d+)/groups/:groupId(\\d+)/package-group-exams', (0, authentication_1.authMiddleware)(['admin', 'teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const subjectId = parseInt(req.params.subjectId);
    const groupId = parseInt(req.params.groupId);
    if (isNaN(subjectId) || isNaN(groupId))
        return res.status(400).json({ error: 'Invalid IDs' });
    const group = await packageSubjectGroups_1.PackageSubjectGroupsService.getGroupById(groupId);
    if (!group || group.package_subject_item_id !== subjectId) {
        return res.status(404).json({ error: 'المجموعة غير موجودة' });
    }
    const user = req.user;
    const ok = await checkGroupPermission(groupId, user.id, user.role);
    if (!ok)
        return res.status(403).json({ error: 'Forbidden' });
    const parsed = CreateExamSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: 'Validation failed', errors: parsed.error.errors });
    const exam = await packageSubjectGroupExams_1.PackageSubjectGroupExamsService.createExam(groupId, parsed.data);
    return res.status(201).json({ success: true, exam });
}));
// GET /api/subjects/:subjectId/groups/:groupId/package-group-exams
exports.router.get('/subjects/:subjectId(\\d+)/groups/:groupId(\\d+)/package-group-exams', (0, authentication_1.authMiddleware)(['admin', 'teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const subjectId = parseInt(req.params.subjectId);
    const groupId = parseInt(req.params.groupId);
    if (isNaN(subjectId) || isNaN(groupId))
        return res.status(400).json({ error: 'Invalid IDs' });
    const group = await packageSubjectGroups_1.PackageSubjectGroupsService.getGroupById(groupId);
    if (!group || group.package_subject_item_id !== subjectId) {
        return res.status(404).json({ error: 'المجموعة غير موجودة' });
    }
    const user = req.user;
    const ok = await checkGroupPermission(groupId, user.id, user.role);
    if (!ok)
        return res.status(403).json({ error: 'Forbidden' });
    const exams = await packageSubjectGroupExams_1.PackageSubjectGroupExamsService.getExamsByGroup(groupId, false);
    return res.json({ success: true, group_id: groupId, exams, total: exams.length });
}));
// PUT /api/package-group-exams/:examId
exports.router.put('/package-group-exams/:examId', (0, authentication_1.authMiddleware)(['admin', 'teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const examId = parseInt(req.params.examId);
    if (isNaN(examId))
        return res.status(400).json({ error: 'Invalid exam ID' });
    const existing = await packageSubjectGroupExams_1.PackageSubjectGroupExamsService.getExamById(examId);
    if (!existing)
        return res.status(404).json({ error: 'الامتحان غير موجود' });
    const group = await packageSubjectGroups_1.PackageSubjectGroupsService.getGroupById(existing.group_id);
    if (!group)
        return res.status(404).json({ error: 'المجموعة غير موجودة' });
    const user = req.user;
    const ok = await checkGroupPermission(existing.group_id, user.id, user.role);
    if (!ok)
        return res.status(403).json({ error: 'Forbidden' });
    const parsed = UpdateExamSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: 'Validation failed', errors: parsed.error.errors });
    const updated = await packageSubjectGroupExams_1.PackageSubjectGroupExamsService.updateExam(examId, parsed.data);
    return res.json({ success: true, exam: updated });
}));
// PATCH /api/package-group-exams/:examId/visibility
exports.router.patch('/package-group-exams/:examId/visibility', (0, authentication_1.authMiddleware)(['admin', 'teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const examId = parseInt(req.params.examId);
    if (isNaN(examId))
        return res.status(400).json({ error: 'Invalid exam ID' });
    const existing = await packageSubjectGroupExams_1.PackageSubjectGroupExamsService.getExamById(examId);
    if (!existing)
        return res.status(404).json({ error: 'الامتحان غير موجود' });
    const parsed = zod_1.z.object({ is_visible: zod_1.z.boolean() }).safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: 'Validation failed', errors: parsed.error.errors });
    const group = await packageSubjectGroups_1.PackageSubjectGroupsService.getGroupById(existing.group_id);
    if (!group)
        return res.status(404).json({ error: 'المجموعة غير موجودة' });
    const user = req.user;
    const ok = await checkGroupPermission(existing.group_id, user.id, user.role);
    if (!ok)
        return res.status(403).json({ error: 'Forbidden' });
    const updated = await packageSubjectGroupExams_1.PackageSubjectGroupExamsService.toggleExamVisibility(examId, parsed.data.is_visible);
    return res.json({ success: true, exam: updated });
}));
// DELETE /api/package-group-exams/:examId
exports.router.delete('/package-group-exams/:examId', (0, authentication_1.authMiddleware)(['admin', 'teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const examId = parseInt(req.params.examId);
    if (isNaN(examId))
        return res.status(400).json({ error: 'Invalid exam ID' });
    const existing = await packageSubjectGroupExams_1.PackageSubjectGroupExamsService.getExamById(examId);
    if (!existing)
        return res.status(404).json({ error: 'الامتحان غير موجود' });
    const group = await packageSubjectGroups_1.PackageSubjectGroupsService.getGroupById(existing.group_id);
    if (!group)
        return res.status(404).json({ error: 'المجموعة غير موجودة' });
    const user = req.user;
    const ok = await checkGroupPermission(existing.group_id, user.id, user.role);
    if (!ok)
        return res.status(403).json({ error: 'Forbidden' });
    await packageSubjectGroupExams_1.PackageSubjectGroupExamsService.deleteExam(examId);
    return res.json({ success: true, message: 'تم حذف الامتحان بنجاح' });
}));
