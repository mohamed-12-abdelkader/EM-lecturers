"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const authentication_1 = require("../middleware/authentication");
const utils_1 = require("../utils");
const packageSubjectLessons_1 = require("../services/packageSubjectLessons");
const packageSubjectGroups_1 = require("../services/packageSubjectGroups");
// This router exists to provide a stable root-level path:
// PATCH /api/lessons/:lessonId/visibility
// (Without mounting the full packageSubjectLessons router at '/')
exports.router = (0, express_1.Router)();
exports.router.patch('/lessons/:lessonId/visibility', (0, authentication_1.authMiddleware)(['admin', 'teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const lessonId = parseInt(req.params.lessonId);
    if (isNaN(lessonId))
        return res.status(400).json({ error: 'Invalid lesson ID' });
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const existingLesson = await packageSubjectLessons_1.PackageSubjectLessonService.getLessonById(lessonId);
    if (!existingLesson)
        return res.status(404).json({ error: 'الدرس غير موجود' });
    const user = req.user;
    if (user.role === 'teacher') {
        if (!existingLesson.group_id) {
            return res
                .status(403)
                .json({ error: 'Forbidden', message: 'ليس لديك صلاحية للتحكم في إظهار هذا الدرس' });
        }
        const ok = await packageSubjectGroups_1.PackageSubjectGroupsService.teacherOwnsGroup(existingLesson.group_id, user.id);
        if (!ok) {
            return res
                .status(403)
                .json({ error: 'Forbidden', message: 'ليس لديك صلاحية للتحكم في إظهار هذا الدرس' });
        }
    }
    const parsed = zod_1.z.object({ is_visible: zod_1.z.boolean() }).safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: 'Validation failed', errors: parsed.error.errors });
    }
    const updatedLesson = await packageSubjectLessons_1.PackageSubjectLessonService.toggleLessonVisibility(lessonId, parsed.data.is_visible);
    return res.json({
        success: true,
        message: parsed.data.is_visible ? 'تم إظهار الدرس بنجاح' : 'تم إخفاء الدرس بنجاح',
        lesson: updatedLesson,
    });
}));
