"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const authentication_1 = require("../middleware/authentication");
const utils_1 = require("../utils");
const packageSubjectLessons_1 = require("../services/packageSubjectLessons");
const packageSubjectGroups_1 = require("../services/packageSubjectGroups");
const packageSubjectLessonExams_1 = require("../services/packageSubjectLessonExams");
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
async function checkLessonPermission(lessonId, userId, userRole) {
    if (userRole === 'admin')
        return true;
    if (userRole !== 'teacher')
        return false;
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const lesson = await packageSubjectLessons_1.PackageSubjectLessonService.getLessonById(lessonId);
    if (!lesson?.group_id)
        return false;
    return await packageSubjectGroups_1.PackageSubjectGroupsService.teacherOwnsGroup(lesson.group_id, userId);
}
// POST /api/lessons/:lessonId/exams
exports.router.post('/lessons/:lessonId/exams', (0, authentication_1.authMiddleware)(['admin', 'teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const lessonId = parseInt(req.params.lessonId);
    if (isNaN(lessonId))
        return res.status(400).json({ error: 'Invalid lesson ID' });
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const lesson = await packageSubjectLessons_1.PackageSubjectLessonService.getLessonById(lessonId);
    if (!lesson)
        return res.status(404).json({ error: 'الدرس غير موجود' });
    const user = req.user;
    const ok = await checkLessonPermission(lessonId, user.id, user.role);
    if (!ok)
        return res.status(403).json({ error: 'Forbidden' });
    const parsed = CreateExamSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: 'Validation failed', errors: parsed.error.errors });
    const exam = await packageSubjectLessonExams_1.PackageSubjectLessonExamsService.createExam(lessonId, parsed.data);
    return res.status(201).json({ success: true, exam });
}));
// PUT /api/exams/:examId
exports.router.put('/exams/:examId', (0, authentication_1.authMiddleware)(['admin', 'teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const examId = parseInt(req.params.examId);
    if (isNaN(examId))
        return res.status(400).json({ error: 'Invalid exam ID' });
    const existing = await packageSubjectLessonExams_1.PackageSubjectLessonExamsService.getExamById(examId);
    if (!existing)
        return res.status(404).json({ error: 'الامتحان غير موجود' });
    const user = req.user;
    const ok = await checkLessonPermission(existing.lesson_id, user.id, user.role);
    if (!ok)
        return res.status(403).json({ error: 'Forbidden' });
    const parsed = UpdateExamSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: 'Validation failed', errors: parsed.error.errors });
    const updated = await packageSubjectLessonExams_1.PackageSubjectLessonExamsService.updateExam(examId, parsed.data);
    return res.json({ success: true, exam: updated });
}));
// PATCH /api/exams/:examId/visibility
exports.router.patch('/exams/:examId/visibility', (0, authentication_1.authMiddleware)(['admin', 'teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const examId = parseInt(req.params.examId);
    if (isNaN(examId))
        return res.status(400).json({ error: 'Invalid exam ID' });
    const existing = await packageSubjectLessonExams_1.PackageSubjectLessonExamsService.getExamById(examId);
    if (!existing)
        return res.status(404).json({ error: 'الامتحان غير موجود' });
    const parsed = zod_1.z.object({ is_visible: zod_1.z.boolean() }).safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: 'Validation failed', errors: parsed.error.errors });
    const user = req.user;
    const ok = await checkLessonPermission(existing.lesson_id, user.id, user.role);
    if (!ok)
        return res.status(403).json({ error: 'Forbidden' });
    const updated = await packageSubjectLessonExams_1.PackageSubjectLessonExamsService.toggleExamVisibility(examId, parsed.data.is_visible);
    return res.json({ success: true, exam: updated });
}));
// DELETE /api/exams/:examId
exports.router.delete('/exams/:examId', (0, authentication_1.authMiddleware)(['admin', 'teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const examId = parseInt(req.params.examId);
    if (isNaN(examId))
        return res.status(400).json({ error: 'Invalid exam ID' });
    const existing = await packageSubjectLessonExams_1.PackageSubjectLessonExamsService.getExamById(examId);
    if (!existing)
        return res.status(404).json({ error: 'الامتحان غير موجود' });
    const user = req.user;
    const ok = await checkLessonPermission(existing.lesson_id, user.id, user.role);
    if (!ok)
        return res.status(403).json({ error: 'Forbidden' });
    await packageSubjectLessonExams_1.PackageSubjectLessonExamsService.deleteExam(examId);
    return res.json({ success: true, message: 'تم حذف الامتحان بنجاح' });
}));
