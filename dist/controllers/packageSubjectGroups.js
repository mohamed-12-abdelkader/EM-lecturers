"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const authentication_1 = require("../middleware/authentication");
const utils_1 = require("../utils");
const packageSubjectGroups_1 = require("../services/packageSubjectGroups");
const packageSubjectLessons_1 = require("../services/packageSubjectLessons");
const packageActivationCodes_1 = require("../services/packageActivationCodes");
const pool_1 = __importDefault(require("../db/pool"));
const packageSubjectVideos_1 = require("../services/packageSubjectVideos");
const packageSubjectAssignments_1 = require("../services/packageSubjectAssignments");
const packageSubjectLessonFiles_1 = require("../services/packageSubjectLessonFiles");
const packageSubjectLessonExams_1 = require("../services/packageSubjectLessonExams");
exports.router = (0, express_1.Router)();
const CreateGroupSchema = zod_1.z.object({
    name: zod_1.z.string().min(1),
    teacher_id: zod_1.z.number().int().positive().optional().nullable(),
    schedule_days: zod_1.z.array(zod_1.z.string().min(1)).optional().nullable(),
    schedule_time: zod_1.z.string().min(1).optional().nullable(),
});
const AddStudentsSchema = zod_1.z.object({
    student_ids: zod_1.z.array(zod_1.z.number().int().positive()).min(1),
});
const UpdateGroupSchema = zod_1.z
    .object({
    name: zod_1.z.string().min(1).optional(),
    teacher_id: zod_1.z.number().int().positive().optional().nullable(),
    schedule_days: zod_1.z.array(zod_1.z.string().min(1)).optional().nullable(),
    schedule_time: zod_1.z.string().min(1).optional().nullable(),
})
    .refine((v) => v.name !== undefined ||
    v.teacher_id !== undefined ||
    v.schedule_days !== undefined ||
    v.schedule_time !== undefined, { message: 'يجب إرسال حقل واحد على الأقل للتعديل' });
// Admin: create group inside subject
exports.router.post('/:subjectId(\\d+)/groups', (0, authentication_1.authMiddleware)(['admin']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const subjectId = parseInt(req.params.subjectId);
    if (isNaN(subjectId))
        return res.status(400).json({ error: 'Invalid subject ID' });
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const subjectExists = await packageSubjectLessons_1.PackageSubjectLessonService.subjectExists(subjectId);
    if (!subjectExists)
        return res.status(404).json({ error: 'المادة غير موجودة' });
    const parse = CreateGroupSchema.safeParse(req.body);
    if (!parse.success) {
        return res.status(400).json({ error: 'Validation failed', errors: parse.error.errors });
    }
    const user = req.user;
    const group = await packageSubjectGroups_1.PackageSubjectGroupsService.createGroup(subjectId, parse.data, user.id);
    return res.status(201).json({ success: true, group });
}));
// Admin: update group (name/teacher/schedule)
exports.router.put('/:subjectId(\\d+)/groups/:groupId(\\d+)', (0, authentication_1.authMiddleware)(['admin']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const subjectId = parseInt(req.params.subjectId);
    const groupId = parseInt(req.params.groupId);
    if (isNaN(subjectId) || isNaN(groupId))
        return res.status(400).json({ error: 'Invalid IDs' });
    const group = await packageSubjectGroups_1.PackageSubjectGroupsService.getGroupById(groupId);
    if (!group || group.package_subject_item_id !== subjectId) {
        return res.status(404).json({ error: 'المجموعة غير موجودة' });
    }
    const parse = UpdateGroupSchema.safeParse(req.body);
    if (!parse.success) {
        return res.status(400).json({ error: 'Validation failed', errors: parse.error.errors });
    }
    const updated = await packageSubjectGroups_1.PackageSubjectGroupsService.updateGroup(groupId, parse.data);
    return res.json({ success: true, group: updated });
}));
// Admin: delete group
exports.router.delete('/:subjectId(\\d+)/groups/:groupId(\\d+)', (0, authentication_1.authMiddleware)(['admin']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const subjectId = parseInt(req.params.subjectId);
    const groupId = parseInt(req.params.groupId);
    if (isNaN(subjectId) || isNaN(groupId))
        return res.status(400).json({ error: 'Invalid IDs' });
    const group = await packageSubjectGroups_1.PackageSubjectGroupsService.getGroupById(groupId);
    if (!group || group.package_subject_item_id !== subjectId) {
        return res.status(404).json({ error: 'المجموعة غير موجودة' });
    }
    const ok = await packageSubjectGroups_1.PackageSubjectGroupsService.deleteGroup(groupId);
    return res.json({ success: true, deleted: ok });
}));
// Admin/Teacher(owner): group details + stats
exports.router.get('/:subjectId(\\d+)/groups/:groupId(\\d+)', (0, authentication_1.authMiddleware)(['admin', 'teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const subjectId = parseInt(req.params.subjectId);
    const groupId = parseInt(req.params.groupId);
    if (isNaN(subjectId) || isNaN(groupId))
        return res.status(400).json({ error: 'Invalid IDs' });
    const group = await packageSubjectGroups_1.PackageSubjectGroupsService.getGroupById(groupId);
    if (!group || group.package_subject_item_id !== subjectId) {
        return res.status(404).json({ error: 'المجموعة غير موجودة' });
    }
    const user = req.user;
    if (user.role === 'teacher') {
        const ok = await packageSubjectGroups_1.PackageSubjectGroupsService.teacherOwnsGroup(groupId, user.id);
        if (!ok)
            return res.status(403).json({ error: 'Forbidden' });
    }
    const statsRes = await pool_1.default.query(`SELECT
         (SELECT COUNT(*)::int FROM package_subject_item_group_students WHERE group_id = $1) AS students,
         (SELECT COUNT(*)::int FROM package_subject_item_lessons WHERE group_id = $1) AS lessons`, [groupId]);
    return res.json({
        success: true,
        group: {
            id: group.id,
            name: group.name,
            teacher_id: group.teacher_id,
            schedule_days: group.schedule_days ?? null,
            schedule_time: group.schedule_time ?? null,
        },
        stats: statsRes.rows[0] ?? { students: 0, lessons: 0 },
    });
}));
// Admin/Teacher(owner): create lesson inside a group
exports.router.post('/:subjectId(\\d+)/groups/:groupId(\\d+)/lessons', (0, authentication_1.authMiddleware)(['admin', 'teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const subjectId = parseInt(req.params.subjectId);
    const groupId = parseInt(req.params.groupId);
    if (isNaN(subjectId) || isNaN(groupId))
        return res.status(400).json({ error: 'Invalid IDs' });
    const group = await packageSubjectGroups_1.PackageSubjectGroupsService.getGroupById(groupId);
    if (!group || group.package_subject_item_id !== subjectId) {
        return res.status(404).json({ error: 'المجموعة غير موجودة' });
    }
    const user = req.user;
    if (user.role === 'teacher') {
        const ok = await packageSubjectGroups_1.PackageSubjectGroupsService.teacherOwnsGroup(groupId, user.id);
        if (!ok)
            return res.status(403).json({ error: 'Forbidden' });
    }
    const parsed = zod_1.z
        .object({
        title: zod_1.z.string().min(1),
        description: zod_1.z.string().optional(),
    })
        .safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: 'Validation failed', errors: parsed.error.errors });
    const lesson = await packageSubjectLessons_1.PackageSubjectLessonService.createLesson(subjectId, { ...parsed.data, group_id: groupId }, 
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    user.id);
    return res.status(201).json({ success: true, lesson });
}));
// Admin/Teacher(owner): get full group content (lessons + videos + files + exams + assignments)
exports.router.get('/:subjectId(\\d+)/groups/:groupId(\\d+)/content', (0, authentication_1.authMiddleware)(['admin', 'teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const subjectId = parseInt(req.params.subjectId);
    const groupId = parseInt(req.params.groupId);
    if (isNaN(subjectId) || isNaN(groupId))
        return res.status(400).json({ error: 'Invalid IDs' });
    const group = await packageSubjectGroups_1.PackageSubjectGroupsService.getGroupById(groupId);
    if (!group || group.package_subject_item_id !== subjectId) {
        return res.status(404).json({ error: 'المجموعة غير موجودة' });
    }
    const user = req.user;
    if (user.role === 'teacher') {
        const ok = await packageSubjectGroups_1.PackageSubjectGroupsService.teacherOwnsGroup(groupId, user.id);
        if (!ok)
            return res.status(403).json({ error: 'Forbidden' });
    }
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const lessons = await packageSubjectLessons_1.PackageSubjectLessonService.getLessonsBySubject(subjectId, false, groupId);
    const lessonsWithContent = await Promise.all(lessons.map(async (lesson) => {
        const videos = await packageSubjectVideos_1.PackageSubjectVideosService.getVideosByLesson(lesson.id);
        const files = await packageSubjectLessonFiles_1.PackageSubjectLessonFilesService.getFilesByLesson(lesson.id);
        const exams = await packageSubjectLessonExams_1.PackageSubjectLessonExamsService.getExamsByLesson(lesson.id, false);
        const assignments = await packageSubjectAssignments_1.PackageSubjectAssignmentsService.getAssignmentsByLesson(lesson.id, false);
        return { ...lesson, videos, files, exams, assignments };
    }));
    return res.json({
        success: true,
        group: {
            id: group.id,
            name: group.name,
            teacher_id: group.teacher_id,
            schedule_days: group.schedule_days ?? null,
            schedule_time: group.schedule_time ?? null,
        },
        lessons: lessonsWithContent,
        total: lessonsWithContent.length,
    });
}));
// Admin: list all groups for subject
exports.router.get('/:subjectId(\\d+)/groups', (0, authentication_1.authMiddleware)(['admin']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const subjectId = parseInt(req.params.subjectId);
    if (isNaN(subjectId))
        return res.status(400).json({ error: 'Invalid subject ID' });
    const groups = await packageSubjectGroups_1.PackageSubjectGroupsService.listGroupsForSubject(subjectId);
    return res.json({ success: true, subject_id: subjectId, groups, total: groups.length });
}));
// Teacher: list my groups inside a subject
exports.router.get('/:subjectId(\\d+)/groups/mine', (0, authentication_1.authMiddleware)(['teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const subjectId = parseInt(req.params.subjectId);
    if (isNaN(subjectId))
        return res.status(400).json({ error: 'Invalid subject ID' });
    const groups = await packageSubjectGroups_1.PackageSubjectGroupsService.listTeacherGroupsForSubject(subjectId, req.user.id);
    return res.json({ success: true, subject_id: subjectId, groups, total: groups.length });
}));
// Admin: list "waiting list" students for subject (activated package but not assigned to any group in this subject)
exports.router.get('/:subjectId(\\d+)/waiting-students', (0, authentication_1.authMiddleware)(['admin']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const subjectId = parseInt(req.params.subjectId);
    if (isNaN(subjectId))
        return res.status(400).json({ error: 'Invalid subject ID' });
    const subjectRes = await pool_1.default.query('SELECT package_id FROM package_subject_items WHERE id = $1', [subjectId]);
    if (!subjectRes.rowCount)
        return res.status(404).json({ error: 'المادة غير موجودة' });
    const packageId = subjectRes.rows[0].package_id;
    const waitingRes = await pool_1.default.query(`SELECT u.id, u.name, u.email, u.phone, u.avatar, pa.activated_at
       FROM package_activations pa
       JOIN users u ON u.id = pa.student_id
       WHERE pa.package_id = $1
         AND pa.is_active = TRUE
         AND pa.activation_code_id IS NOT NULL
         AND u.role = 'student'
         AND NOT EXISTS (
           SELECT 1
           FROM package_subject_item_group_students gs
           WHERE gs.package_subject_item_id = $2
             AND gs.student_id = pa.student_id
         )
       ORDER BY pa.activated_at DESC`, [packageId, subjectId]);
    return res.json({
        success: true,
        subject_id: subjectId,
        package_id: packageId,
        students: waitingRes.rows,
        total: waitingRes.rows.length,
    });
}));
// Admin: add students to group
exports.router.post('/:subjectId(\\d+)/groups/:groupId(\\d+)/students', (0, authentication_1.authMiddleware)(['admin']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const subjectId = parseInt(req.params.subjectId);
    const groupId = parseInt(req.params.groupId);
    if (isNaN(subjectId) || isNaN(groupId))
        return res.status(400).json({ error: 'Invalid IDs' });
    const group = await packageSubjectGroups_1.PackageSubjectGroupsService.getGroupById(groupId);
    if (!group || group.package_subject_item_id !== subjectId) {
        return res.status(404).json({ error: 'المجموعة غير موجودة' });
    }
    const parse = AddStudentsSchema.safeParse(req.body);
    if (!parse.success) {
        return res.status(400).json({ error: 'Validation failed', errors: parse.error.errors });
    }
    const requestedStudentIds = parse.data.student_ids;
    // hard validation: all provided student_ids must exist and be role=student
    const existingStudentsRes = await pool_1.default.query(`SELECT id
       FROM users
       WHERE id = ANY($1::int[])
         AND role = 'student'`, [requestedStudentIds]);
    const existingStudentIds = new Set(existingStudentsRes.rows.map((r) => r.id));
    const missing_student_ids = requestedStudentIds.filter((sid) => !existingStudentIds.has(sid));
    if (missing_student_ids.length > 0) {
        return res.status(404).json({
            success: false,
            message: 'لا يمكن إضافة بعض الطلاب لأنهم غير موجودين',
            missing_student_ids,
        });
    }
    // enforce: student must be subscribed/activated to the package (code-based) before being added to any group
    const subjectRes = await pool_1.default.query('SELECT package_id FROM package_subject_items WHERE id = $1', [subjectId]);
    if (!subjectRes.rowCount)
        return res.status(404).json({ error: 'المادة غير موجودة' });
    const packageId = subjectRes.rows[0].package_id;
    const activatedRes = await pool_1.default.query(`SELECT student_id
       FROM package_activations
       WHERE package_id = $1
         AND student_id = ANY($2::int[])
         AND is_active = TRUE
         AND activation_code_id IS NOT NULL`, [packageId, requestedStudentIds]);
    const activatedSet = new Set(activatedRes.rows.map((r) => r.student_id));
    const not_subscribed_student_ids = requestedStudentIds.filter((sid) => !activatedSet.has(sid));
    const eligibleStudentIds = requestedStudentIds.filter((sid) => activatedSet.has(sid));
    const result = await packageSubjectGroups_1.PackageSubjectGroupsService.addStudentsToGroup(groupId, eligibleStudentIds, req.user.id);
    return res.json({
        success: true,
        group_id: groupId,
        not_subscribed_student_ids,
        ...result,
        message: (not_subscribed_student_ids.length > 0 ? 'تم تخطي طلاب غير مشتركين في الباقة. ' : '') +
            (result.skipped_already_in_other_group && result.skipped_already_in_other_group > 0
                ? 'تم تخطي من هم موجودون بالفعل في مجموعة أخرى لنفس المادة. '
                : '') +
            'تمت العملية بنجاح',
    });
}));
// Admin/Teacher (own): list students in group
exports.router.get('/:subjectId(\\d+)/groups/:groupId(\\d+)/students', (0, authentication_1.authMiddleware)(['admin', 'teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const subjectId = parseInt(req.params.subjectId);
    const groupId = parseInt(req.params.groupId);
    if (isNaN(subjectId) || isNaN(groupId))
        return res.status(400).json({ error: 'Invalid IDs' });
    const group = await packageSubjectGroups_1.PackageSubjectGroupsService.getGroupById(groupId);
    if (!group || group.package_subject_item_id !== subjectId) {
        return res.status(404).json({ error: 'المجموعة غير موجودة' });
    }
    if (req.user.role === 'teacher') {
        const ok = await packageSubjectGroups_1.PackageSubjectGroupsService.teacherOwnsGroup(groupId, req.user.id);
        if (!ok)
            return res.status(403).json({ error: 'Forbidden', message: 'ليس لديك صلاحية' });
    }
    const students = await packageSubjectGroups_1.PackageSubjectGroupsService.listGroupStudents(groupId);
    return res.json({ success: true, group_id: groupId, students, total: students.length });
}));
// Admin: unassign (remove) teacher from group
exports.router.delete('/:subjectId(\\d+)/groups/:groupId(\\d+)/teacher', (0, authentication_1.authMiddleware)(['admin']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const subjectId = parseInt(req.params.subjectId);
    const groupId = parseInt(req.params.groupId);
    if (isNaN(subjectId) || isNaN(groupId))
        return res.status(400).json({ error: 'Invalid IDs' });
    const group = await packageSubjectGroups_1.PackageSubjectGroupsService.getGroupById(groupId);
    if (!group || group.package_subject_item_id !== subjectId) {
        return res.status(404).json({ error: 'المجموعة غير موجودة' });
    }
    const updated = await packageSubjectGroups_1.PackageSubjectGroupsService.unassignTeacherFromGroup(groupId);
    return res.json({
        success: true,
        message: 'تم إلغاء تعيين المدرس من المجموعة بنجاح',
        group: updated,
    });
}));
// Admin: remove student from group
exports.router.delete('/:subjectId(\\d+)/groups/:groupId(\\d+)/students/:studentId(\\d+)', (0, authentication_1.authMiddleware)(['admin']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const subjectId = parseInt(req.params.subjectId);
    const groupId = parseInt(req.params.groupId);
    const studentId = parseInt(req.params.studentId);
    if (isNaN(subjectId) || isNaN(groupId) || isNaN(studentId)) {
        return res.status(400).json({ error: 'Invalid IDs' });
    }
    const group = await packageSubjectGroups_1.PackageSubjectGroupsService.getGroupById(groupId);
    if (!group || group.package_subject_item_id !== subjectId) {
        return res.status(404).json({ error: 'المجموعة غير موجودة' });
    }
    const ok = await packageSubjectGroups_1.PackageSubjectGroupsService.removeStudentFromGroup(groupId, studentId);
    if (!ok) {
        return res.status(404).json({ error: 'الطالب غير موجود في هذه المجموعة' });
    }
    return res.json({
        success: true,
        message: 'تم حذف الطالب من المجموعة بنجاح',
        group_id: groupId,
        student_id: studentId,
    });
}));
// Student: get my group schedule inside a subject (seamless)
exports.router.get('/:subjectId(\\d+)/my-group', (0, authentication_1.authMiddleware)(['student']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const subjectId = parseInt(req.params.subjectId);
    if (isNaN(subjectId))
        return res.status(400).json({ error: 'Invalid subject ID' });
    // verify package activation first (code-based)
    const subjectResult = await pool_1.default.query('SELECT package_id FROM package_subject_items WHERE id = $1', [subjectId]);
    if (!subjectResult.rowCount)
        return res.status(404).json({ error: 'المادة غير موجودة' });
    const packageId = subjectResult.rows[0].package_id;
    const activated = await packageActivationCodes_1.PackageActivationCodeService.isActivated(packageId, req.user.id);
    if (!activated) {
        return res.status(403).json({ success: false, message: 'غير مسموح الوصول، فعل الباقة أولاً' });
    }
    const groupId = await packageSubjectGroups_1.PackageSubjectGroupsService.getStudentGroupForSubject(subjectId, req.user.id);
    if (!groupId) {
        return res.status(403).json({ success: false, message: 'لم يتم إضافتك إلى مجموعة داخل هذه المادة بعد' });
    }
    const group = await packageSubjectGroups_1.PackageSubjectGroupsService.getGroupById(groupId);
    return res.json({
        success: true,
        group,
        schedule: {
            days: group?.schedule_days ?? null,
            time: group?.schedule_time ?? null,
        },
    });
}));
