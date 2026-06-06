"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const express_1 = require("express");
const authentication_1 = require("../middleware/authentication");
const utils_1 = require("../utils");
const packageSubjectAssignments_1 = require("../services/packageSubjectAssignments");
const packageSubjectLessons_1 = require("../services/packageSubjectLessons");
const packageSubjectGroups_1 = require("../services/packageSubjectGroups");
const packageActivationCodes_1 = require("../services/packageActivationCodes");
const assignmentQuestions_1 = require("../services/assignmentQuestions");
const zod_1 = require("zod");
const pool_1 = __importDefault(require("../db/pool"));
const router = (0, express_1.Router)();
exports.router = router;
// Schema للتحقق من البيانات
const CreateAssignmentSchema = zod_1.z.object({
    name: zod_1.z.string().min(1, 'اسم الواجب مطلوب'),
    questions_count: zod_1.z.number().int().min(0).optional(),
    duration_minutes: zod_1.z.number().int().min(0).optional(),
});
const UpdateAssignmentSchema = zod_1.z.object({
    name: zod_1.z.string().min(1).optional(),
    questions_count: zod_1.z.number().int().min(0).optional(),
    duration_minutes: zod_1.z.number().int().min(0).optional(),
    is_visible: zod_1.z.boolean().optional(),
});
// Helper function للتحقق من صلاحية المدرس على الدرس
async function checkLessonPermission(lessonId, userId, userRole) {
    if (userRole === 'admin') {
        return true;
    }
    if (userRole === 'teacher') {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        const lesson = await packageSubjectLessons_1.PackageSubjectLessonService.getLessonById(lessonId);
        if (!lesson?.group_id)
            return false;
        return await packageSubjectGroups_1.PackageSubjectGroupsService.teacherOwnsGroup(lesson.group_id, userId);
    }
    return false;
}
async function checkStudentLessonAccess(lessonId, studentId) {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const subjectId = await packageSubjectLessons_1.PackageSubjectLessonService.getSubjectIdByLessonId(lessonId);
    if (!subjectId)
        return false;
    const subjectResult = await pool_1.default.query('SELECT package_id FROM package_subject_items WHERE id = $1', [subjectId]);
    if (!subjectResult.rowCount)
        return false;
    const packageId = subjectResult.rows[0].package_id;
    const activated = await packageActivationCodes_1.PackageActivationCodeService.isActivated(packageId, studentId);
    if (!activated)
        return false;
    // enforce group isolation: student must be in a group, and lesson must belong to that group
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const lesson = await packageSubjectLessons_1.PackageSubjectLessonService.getLessonById(lessonId);
    if (!lesson?.group_id)
        return false;
    const studentGroupId = await packageSubjectGroups_1.PackageSubjectGroupsService.getStudentGroupForSubject(subjectId, studentId);
    if (!studentGroupId)
        return false;
    return lesson.group_id === studentGroupId;
}
// 1. إضافة واجب للدرس
router.post('/lessons/:lessonId/assignments', (0, authentication_1.authMiddleware)(['admin', 'teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    try {
        const lessonId = parseInt(req.params.lessonId);
        if (isNaN(lessonId)) {
            return res.status(400).json({ error: 'Invalid lesson ID' });
        }
        // التحقق من وجود الدرس
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        const lesson = await packageSubjectLessons_1.PackageSubjectLessonService.getLessonById(lessonId);
        if (!lesson) {
            return res.status(404).json({ error: 'الدرس غير موجود' });
        }
        const user = req.user;
        // التحقق من الصلاحيات
        const hasPermission = await checkLessonPermission(lessonId, user.id, user.role);
        if (!hasPermission) {
            return res.status(403).json({
                error: 'Forbidden',
                message: 'ليس لديك صلاحية لإضافة واجب لهذا الدرس',
            });
        }
        // التحقق من صحة البيانات
        const parse = CreateAssignmentSchema.safeParse(req.body);
        if (!parse.success) {
            return res.status(400).json({
                error: 'Validation failed',
                errors: parse.error.errors,
            });
        }
        const assignment = await packageSubjectAssignments_1.PackageSubjectAssignmentsService.createAssignment(lessonId, parse.data);
        res.status(201).json({
            success: true,
            message: 'تم إضافة الواجب بنجاح',
            assignment,
        });
    }
    catch (error) {
        console.error('Error creating assignment:', error);
        res.status(500).json({ error: 'خطأ في إضافة الواجب', message: error.message });
    }
}));
// 1.1 عرض واجبات الدرس + أسئلتها
router.get('/lessons/:lessonId/assignments/questions', (0, authentication_1.authMiddleware)(['admin', 'teacher', 'student']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const lessonId = parseInt(req.params.lessonId);
    if (isNaN(lessonId)) {
        return res.status(400).json({ error: 'Invalid lesson ID' });
    }
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const lesson = await packageSubjectLessons_1.PackageSubjectLessonService.getLessonById(lessonId);
    if (!lesson) {
        return res.status(404).json({ error: 'الدرس غير موجود' });
    }
    const user = req.user;
    // صلاحيات الوصول
    if (user.role === 'teacher') {
        const ok = await checkLessonPermission(lessonId, user.id, user.role);
        if (!ok) {
            return res.status(403).json({
                error: 'Forbidden',
                message: 'ليس لديك صلاحية لعرض واجبات هذا الدرس',
            });
        }
    }
    else if (user.role === 'student') {
        const ok = await checkStudentLessonAccess(lessonId, user.id);
        if (!ok) {
            return res.status(403).json({
                error: 'Forbidden',
                message: 'يجب تفعيل الباقة أولاً للوصول إلى واجبات هذا الدرس',
            });
        }
    }
    const forStudent = user.role === 'student';
    const assignments = await packageSubjectAssignments_1.PackageSubjectAssignmentsService.getAssignmentsByLesson(lessonId, forStudent);
    const assignmentsWithQuestions = await Promise.all(assignments.map(async (a) => {
        const questions = await assignmentQuestions_1.AssignmentQuestionsService.getQuestionsByAssignment(a.id);
        if (!forStudent) {
            return { ...a, questions };
        }
        // للطالب: إزالة الإجابات الصحيحة وإرجاع الخيارات بشكل آمن
        const questionsForStudent = questions.map((q) => {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { correct_answer, correct_option_id, ...rest } = q;
            if (rest.options) {
                rest.options = rest.options.map((opt) => ({
                    id: opt.id,
                    option_text: opt.option_text,
                    option_letter: opt.option_letter,
                    order_index: opt.order_index,
                }));
            }
            return rest;
        });
        return { ...a, questions: questionsForStudent };
    }));
    return res.json({
        success: true,
        lesson_id: lessonId,
        assignments: assignmentsWithQuestions,
        total: assignmentsWithQuestions.length,
    });
}));
// 2. تحديث واجب
router.put('/assignments/:assignmentId', (0, authentication_1.authMiddleware)(['admin', 'teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    try {
        const assignmentId = parseInt(req.params.assignmentId);
        if (isNaN(assignmentId)) {
            return res.status(400).json({ error: 'Invalid assignment ID' });
        }
        // التحقق من وجود الواجب
        const existingAssignment = await packageSubjectAssignments_1.PackageSubjectAssignmentsService.getAssignmentById(assignmentId);
        if (!existingAssignment) {
            return res.status(404).json({ error: 'الواجب غير موجود' });
        }
        const user = req.user;
        // التحقق من الصلاحيات
        const hasPermission = await checkLessonPermission(existingAssignment.lesson_id, user.id, user.role);
        if (!hasPermission) {
            return res.status(403).json({
                error: 'Forbidden',
                message: 'ليس لديك صلاحية لتعديل هذا الواجب',
            });
        }
        // التحقق من صحة البيانات
        const parse = UpdateAssignmentSchema.safeParse(req.body);
        if (!parse.success) {
            return res.status(400).json({
                error: 'Validation failed',
                errors: parse.error.errors,
            });
        }
        const updatedAssignment = await packageSubjectAssignments_1.PackageSubjectAssignmentsService.updateAssignment(assignmentId, parse.data);
        res.json({
            success: true,
            message: 'تم تحديث الواجب بنجاح',
            assignment: updatedAssignment,
        });
    }
    catch (error) {
        console.error('Error updating assignment:', error);
        res.status(500).json({ error: 'خطأ في تحديث الواجب', message: error.message });
    }
}));
// 3. حذف واجب
router.delete('/assignments/:assignmentId', (0, authentication_1.authMiddleware)(['admin', 'teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    try {
        const assignmentId = parseInt(req.params.assignmentId);
        if (isNaN(assignmentId)) {
            return res.status(400).json({ error: 'Invalid assignment ID' });
        }
        // التحقق من وجود الواجب
        const existingAssignment = await packageSubjectAssignments_1.PackageSubjectAssignmentsService.getAssignmentById(assignmentId);
        if (!existingAssignment) {
            return res.status(404).json({ error: 'الواجب غير موجود' });
        }
        const user = req.user;
        // التحقق من الصلاحيات
        const hasPermission = await checkLessonPermission(existingAssignment.lesson_id, user.id, user.role);
        if (!hasPermission) {
            return res.status(403).json({
                error: 'Forbidden',
                message: 'ليس لديك صلاحية لحذف هذا الواجب',
            });
        }
        await packageSubjectAssignments_1.PackageSubjectAssignmentsService.deleteAssignment(assignmentId);
        res.json({
            success: true,
            message: 'تم حذف الواجب بنجاح',
        });
    }
    catch (error) {
        console.error('Error deleting assignment:', error);
        res.status(500).json({ error: 'خطأ في حذف الواجب', message: error.message });
    }
}));
// 4. التحكم في إظهار/إخفاء الواجب
router.patch('/assignments/:assignmentId/visibility', (0, authentication_1.authMiddleware)(['admin', 'teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    try {
        const assignmentId = parseInt(req.params.assignmentId);
        if (isNaN(assignmentId)) {
            return res.status(400).json({ error: 'Invalid assignment ID' });
        }
        // التحقق من وجود الواجب
        const existingAssignment = await packageSubjectAssignments_1.PackageSubjectAssignmentsService.getAssignmentById(assignmentId);
        if (!existingAssignment) {
            return res.status(404).json({ error: 'الواجب غير موجود' });
        }
        const user = req.user;
        // التحقق من الصلاحيات
        const hasPermission = await checkLessonPermission(existingAssignment.lesson_id, user.id, user.role);
        if (!hasPermission) {
            return res.status(403).json({
                error: 'Forbidden',
                message: 'ليس لديك صلاحية للتحكم في إظهار هذا الواجب',
            });
        }
        // التحقق من صحة البيانات
        const parse = zod_1.z
            .object({
            is_visible: zod_1.z.boolean(),
        })
            .safeParse(req.body);
        if (!parse.success) {
            return res.status(400).json({
                error: 'Validation failed',
                errors: parse.error.errors,
            });
        }
        const updatedAssignment = await packageSubjectAssignments_1.PackageSubjectAssignmentsService.toggleAssignmentVisibility(assignmentId, parse.data.is_visible);
        res.json({
            success: true,
            message: parse.data.is_visible ? 'تم إظهار الواجب بنجاح' : 'تم إخفاء الواجب بنجاح',
            assignment: updatedAssignment,
        });
    }
    catch (error) {
        console.error('Error toggling assignment visibility:', error);
        res.status(500).json({ error: 'خطأ في التحكم في إظهار الواجب', message: error.message });
    }
}));
