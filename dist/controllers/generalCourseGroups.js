"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const express_1 = require("express");
const authentication_1 = require("../middleware/authentication");
const permissions_1 = require("../middleware/permissions");
const utils_1 = require("../utils");
const pool_1 = __importDefault(require("../db/pool"));
const zod_1 = require("zod");
exports.router = (0, express_1.Router)();
const GENERAL_COURSE_PERMISSIONS = [
    'general_courses_management',
    'can_manage_general_courses',
    'manage_general_courses',
    'can_manage_courses',
    'can_manage_course',
    'can_manage_general_course',
];
const adminOrGeneralCourseManager = [
    (0, authentication_1.authMiddleware)(['admin', 'employee']),
    (0, permissions_1.checkAnyPermission)(GENERAL_COURSE_PERMISSIONS),
];
// Validation Schemas
const CreateGroupSchema = zod_1.z.object({
    name: zod_1.z.string().min(1, 'اسم المجموعة مطلوب'),
    max_students: zod_1.z.number().int().min(0).optional().default(0),
    teacher_id: zod_1.z.number().int().optional(),
});
const UpdateGroupSchema = zod_1.z.object({
    name: zod_1.z.string().min(1).optional(),
    max_students: zod_1.z.number().int().min(0).optional(),
    teacher_id: zod_1.z.number().int().optional().nullable(),
});
const AssignStudentsSchema = zod_1.z.object({
    studentIds: zod_1.z.array(zod_1.z.number().int()),
});
const ScheduleSchema = zod_1.z.object({
    day_of_week: zod_1.z.number().int().min(0).max(6), // 0-6 (Sun-Sat)
    start_time: zod_1.z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'صيغة الوقت غير صحيحة (HH:MM)'),
    duration_minutes: zod_1.z.number().int().min(15).default(60),
});
const AddScheduleSchema = zod_1.z.object({
    schedules: zod_1.z.array(ScheduleSchema),
});
// 0. جلب المجموعات التي للمدرس صلاحية عليها في الكورسات العامة
exports.router.get('/my-groups', (0, authentication_1.authMiddleware)(['teacher', 'admin']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const user = req.user;
    const teacherId = user.id;
    const result = await pool_1.default.query(`SELECT 
         g.id as group_id,
         g.general_course_id,
         g.name as group_name,
         g.max_students,
         g.created_at as group_created_at,
         gc.title as course_title,
         gc.description as course_description,
         gc.image as course_image,
         (SELECT COUNT(*) FROM general_course_enrollments e WHERE e.group_id = g.id) as student_count,
         (
           SELECT COALESCE(json_agg(
             json_build_object(
               'id', s.id,
               'day_of_week', s.day_of_week,
               'start_time', s.start_time,
               'duration_minutes', s.duration_minutes
             ) ORDER BY s.day_of_week, s.start_time
           ), '[]'::json)
           FROM general_course_group_schedules s
           WHERE s.group_id = g.id
         ) as schedules
       FROM general_course_groups g
       JOIN general_courses gc ON gc.id = g.general_course_id
       WHERE g.teacher_id = $1
       ORDER BY gc.title ASC, g.name ASC`, [teacherId]);
    const groups = result.rows.map((row) => ({
        group_id: row.group_id,
        general_course_id: row.general_course_id,
        group_name: row.group_name,
        max_students: row.max_students,
        student_count: parseInt(row.student_count, 10),
        group_created_at: row.group_created_at,
        course: {
            id: row.general_course_id,
            title: row.course_title,
            description: row.course_description,
            image: row.course_image,
        },
        schedules: row.schedules || [],
    }));
    res.json({
        success: true,
        groups,
        total: groups.length,
    });
}));
// 1. إنشاء مجموعة جديدة لكورس
exports.router.post('/:courseId/groups', ...adminOrGeneralCourseManager, (0, utils_1.asyncWrapper)(async (req, res) => {
    const courseId = Number(req.params.courseId);
    if (isNaN(courseId)) {
        return res.status(400).json({ success: false, message: 'معرف الكورس غير صحيح' });
    }
    const parse = CreateGroupSchema.safeParse(req.body);
    if (!parse.success) {
        return res.status(400).json({
            success: false,
            message: 'بيانات غير صحيحة',
            errors: parse.error.errors,
        });
    }
    const { name, max_students, teacher_id } = parse.data;
    // التحقق من وجود الكورس
    const courseCheck = await pool_1.default.query('SELECT id FROM general_courses WHERE id = $1', [courseId]);
    if (!courseCheck.rowCount) {
        return res.status(404).json({ success: false, message: 'الكورس غير موجود' });
    }
    // التحقق من وجود المدرس (إذا تم إرساله)
    if (teacher_id) {
        const teacherCheck = await pool_1.default.query("SELECT id FROM users WHERE id = $1 AND role = 'teacher'", [teacher_id]);
        if (!teacherCheck.rowCount) {
            return res.status(400).json({ success: false, message: 'المدرس غير موجود' });
        }
    }
    const result = await pool_1.default.query(`INSERT INTO general_course_groups (general_course_id, name, max_students, teacher_id)
       VALUES ($1, $2, $3, $4)
       RETURNING *`, [courseId, name, max_students, teacher_id || null]);
    res.status(201).json({
        success: true,
        message: 'تم إنشاء المجموعة بنجاح',
        group: result.rows[0],
    });
}));
// 2. جلب جميع مجموعات الكورس مع إحصائيات الطلاب
exports.router.get('/:courseId/groups', ...adminOrGeneralCourseManager, (0, utils_1.asyncWrapper)(async (req, res) => {
    const courseId = Number(req.params.courseId);
    if (isNaN(courseId)) {
        return res.status(400).json({ success: false, message: 'معرف الكورس غير صحيح' });
    }
    const result = await pool_1.default.query(`SELECT 
         g.*,
         u_teacher.name as teacher_name,
         (SELECT COUNT(*) FROM general_course_enrollments e WHERE e.group_id = g.id) as student_count
       FROM general_course_groups g
       LEFT JOIN users u_teacher ON g.teacher_id = u_teacher.id
       WHERE g.general_course_id = $1
       ORDER BY g.created_at ASC`, [courseId]);
    res.json({
        success: true,
        groups: result.rows.map((row) => ({
            ...row,
            student_count: parseInt(row.student_count),
        })),
    });
}));
// 3. تعديل مجموعة
exports.router.put('/groups/:groupId', ...adminOrGeneralCourseManager, (0, utils_1.asyncWrapper)(async (req, res) => {
    const groupId = Number(req.params.groupId);
    if (isNaN(groupId)) {
        return res.status(400).json({ success: false, message: 'معرف المجموعة غير صحيح' });
    }
    const parse = UpdateGroupSchema.safeParse(req.body);
    if (!parse.success) {
        return res.status(400).json({
            success: false,
            message: 'بيانات غير صحيحة',
            errors: parse.error.errors,
        });
    }
    const { name, max_students, teacher_id } = parse.data;
    const updates = [];
    const values = [];
    let idx = 1;
    if (name !== undefined) {
        updates.push(`name = $${idx++}`);
        values.push(name);
    }
    if (max_students !== undefined) {
        updates.push(`max_students = $${idx++}`);
        values.push(max_students);
    }
    if (teacher_id !== undefined) {
        if (teacher_id !== null) {
            const teacherCheck = await pool_1.default.query("SELECT id FROM users WHERE id = $1 AND role = 'teacher'", [teacher_id]);
            if (!teacherCheck.rowCount) {
                return res.status(400).json({ success: false, message: 'المدرس غير موجود' });
            }
        }
        updates.push(`teacher_id = $${idx++}`);
        values.push(teacher_id);
    }
    if (updates.length === 0) {
        return res.json({ success: true, message: 'لا توجد تغييرات' });
    }
    values.push(groupId);
    const result = await pool_1.default.query(`UPDATE general_course_groups 
       SET ${updates.join(', ')}, updated_at = NOW() 
       WHERE id = $${idx} 
       RETURNING *`, values);
    if (!result.rowCount) {
        return res.status(404).json({ success: false, message: 'المجموعة غير موجودة' });
    }
    res.json({
        success: true,
        message: 'تم تحديث المجموعة بنجاح',
        group: result.rows[0],
    });
}));
// 4. حذف مجموعة (سيعود الطلاب تلقائياً لقائمة الانتظار بسبب ON DELETE SET NULL)
exports.router.delete('/groups/:groupId', ...adminOrGeneralCourseManager, (0, utils_1.asyncWrapper)(async (req, res) => {
    const groupId = Number(req.params.groupId);
    if (isNaN(groupId)) {
        return res.status(400).json({ success: false, message: 'معرف المجموعة غير صحيح' });
    }
    const result = await pool_1.default.query('DELETE FROM general_course_groups WHERE id = $1 RETURNING id', [groupId]);
    if (!result.rowCount) {
        return res.status(404).json({ success: false, message: 'المجموعة غير موجودة' });
    }
    res.json({
        success: true,
        message: 'تم حذف المجموعة وعاد الطلاب لقائمة الانتظار',
    });
}));
// 5. عرض قائمة الانتظار (الطلاب المشتركين وغير معينين لمجموعة)
exports.router.get('/:courseId/waitlist', ...adminOrGeneralCourseManager, (0, utils_1.asyncWrapper)(async (req, res) => {
    const courseId = Number(req.params.courseId);
    if (isNaN(courseId)) {
        return res.status(400).json({ success: false, message: 'معرف الكورس غير صحيح' });
    }
    const result = await pool_1.default.query(`SELECT 
         u.id,
         u.name,
         u.email,
         u.phone,
         gce.enrolled_at,
         gce.enrollment_type
       FROM general_course_enrollments gce
       JOIN users u ON gce.student_id = u.id
       WHERE gce.general_course_id = $1 AND gce.group_id IS NULL
       ORDER BY gce.enrolled_at ASC`, [courseId]);
    res.json({
        success: true,
        students: result.rows,
        total: result.rowCount,
    });
}));
// 6. تعيين طلاب لمجموعة (نقل من الانتظار أو من مجموعة أخرى)
exports.router.post('/groups/:groupId/assign', ...adminOrGeneralCourseManager, (0, utils_1.asyncWrapper)(async (req, res) => {
    const groupId = Number(req.params.groupId);
    if (isNaN(groupId)) {
        return res.status(400).json({ success: false, message: 'معرف المجموعة غير صحيح' });
    }
    const parse = AssignStudentsSchema.safeParse(req.body);
    if (!parse.success) {
        return res.status(400).json({
            success: false,
            message: 'بيانات غير صحيحة',
            errors: parse.error.errors,
        });
    }
    const { studentIds } = parse.data;
    if (studentIds.length === 0) {
        return res.status(400).json({ success: false, message: 'يجب اختيار طالب واحد على الأقل' });
    }
    // التحقق من وجود المجموعة ومعرفة الكورس التابعة له
    const groupCheck = await pool_1.default.query('SELECT id, general_course_id FROM general_course_groups WHERE id = $1', [groupId]);
    if (!groupCheck.rowCount) {
        return res.status(404).json({ success: false, message: 'المجموعة غير موجودة' });
    }
    const courseId = groupCheck.rows[0].general_course_id;
    // تحديث اشتراكات الطلاب لتعيينهم للمجموعة
    // الشرط: يجب أن يكون الطالب مشتركاً في نفس الكورس
    const result = await pool_1.default.query(`UPDATE general_course_enrollments
       SET group_id = $1
       WHERE student_id = ANY($2) AND general_course_id = $3
       RETURNING student_id`, [groupId, studentIds, courseId]);
    const assignedCount = result.rowCount;
    if (assignedCount === 0) {
        return res.status(400).json({
            success: false,
            message: 'لم يتم تعيين أي طالب. تأكد من أن الطلاب مشتركين في الكورس.',
        });
    }
    res.json({
        success: true,
        message: `تم تعيين ${assignedCount} طالب للمجموعة بنجاح`,
        assigned_students: result.rows.map((r) => r.student_id),
    });
}));
// 7. إزالة طلاب من المجموعة (إعادتهم لقائمة الانتظار)
exports.router.post('/groups/:groupId/remove', ...adminOrGeneralCourseManager, (0, utils_1.asyncWrapper)(async (req, res) => {
    const groupId = Number(req.params.groupId);
    if (isNaN(groupId)) {
        return res.status(400).json({ success: false, message: 'معرف المجموعة غير صحيح' });
    }
    const parse = AssignStudentsSchema.safeParse(req.body);
    if (!parse.success) {
        return res.status(400).json({
            success: false,
            message: 'بيانات غير صحيحة',
            errors: parse.error.errors,
        });
    }
    const { studentIds } = parse.data;
    const result = await pool_1.default.query(`UPDATE general_course_enrollments
       SET group_id = NULL
       WHERE student_id = ANY($1) AND group_id = $2
       RETURNING student_id`, [studentIds, groupId]);
    res.json({
        success: true,
        message: `تم إزالة ${result.rowCount} طالب من المجموعة وإعادتهم لقائمة الانتظار`,
        removed_students: result.rows.map((r) => r.student_id),
    });
}));
// 8. عرض طلاب مجموعة محددة (تم التحديث ليشمل تفاصيل المجموعة والمدرس والجدول)
exports.router.get('/groups/:groupId', (0, authentication_1.authMiddleware)(['admin', 'teacher']), // السماح للمدرس برؤية مجموعته
(0, utils_1.asyncWrapper)(async (req, res) => {
    const groupId = Number(req.params.groupId);
    if (isNaN(groupId)) {
        return res.status(400).json({ success: false, message: 'معرف المجموعة غير صحيح' });
    }
    // التحقق من الصلاحية للمدرس (يجب أن يكون مدرس المجموعة)
    if (req.user?.role === 'teacher') {
        const groupCheck = await pool_1.default.query('SELECT id FROM general_course_groups WHERE id = $1 AND teacher_id = $2', [groupId, req.user.id]);
        if (!groupCheck.rowCount) {
            return res.status(403).json({ success: false, message: 'غير مصرح لك بالوصول لهذه المجموعة' });
        }
    }
    const groupResult = await pool_1.default.query(`SELECT 
         g.*,
         u_teacher.name as teacher_name,
         (
           SELECT COALESCE(json_agg(
             json_build_object(
               'id', s.id,
               'day_of_week', s.day_of_week,
               'start_time', s.start_time,
               'duration_minutes', s.duration_minutes
             ) ORDER BY s.day_of_week, s.start_time
           ), '[]'::json)
           FROM general_course_group_schedules s
           WHERE s.group_id = g.id
         ) as schedules,
         (SELECT COUNT(*) FROM general_course_enrollments e WHERE e.group_id = g.id) as student_count
       FROM general_course_groups g
       LEFT JOIN users u_teacher ON g.teacher_id = u_teacher.id
       WHERE g.id = $1`, [groupId]);
    if (!groupResult.rowCount) {
        return res.status(404).json({ success: false, message: 'المجموعة غير موجودة' });
    }
    res.json({
        success: true,
        group: groupResult.rows[0],
    });
}));
// 9. إضافة مواعيد (جدول) للمجموعة
exports.router.post('/groups/:groupId/schedules', ...adminOrGeneralCourseManager, (0, utils_1.asyncWrapper)(async (req, res) => {
    const groupId = Number(req.params.groupId);
    if (isNaN(groupId)) {
        return res.status(400).json({ success: false, message: 'معرف المجموعة غير صحيح' });
    }
    const parse = AddScheduleSchema.safeParse(req.body);
    if (!parse.success) {
        return res.status(400).json({
            success: false,
            message: 'بيانات غير صحيحة',
            errors: parse.error.errors,
        });
    }
    const { schedules } = parse.data;
    // التحقق من المجموعة
    const groupCheck = await pool_1.default.query('SELECT id FROM general_course_groups WHERE id = $1', [
        groupId,
    ]);
    if (!groupCheck.rowCount) {
        return res.status(404).json({ success: false, message: 'المجموعة غير موجودة' });
    }
    const values = [];
    const placeHolders = [];
    let idx = 1;
    schedules.forEach((sch) => {
        values.push(groupId, sch.day_of_week, sch.start_time, sch.duration_minutes);
        placeHolders.push(`($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3})`);
        idx += 4;
    });
    await pool_1.default.query(`INSERT INTO general_course_group_schedules (group_id, day_of_week, start_time, duration_minutes)
       VALUES ${placeHolders.join(', ')}`, values);
    res.status(201).json({
        success: true,
        message: 'تم إضافة المواعيد بنجاح',
    });
}));
// 10. حذف موعد من الجدول
exports.router.delete('/schedules/:scheduleId', ...adminOrGeneralCourseManager, (0, utils_1.asyncWrapper)(async (req, res) => {
    const scheduleId = Number(req.params.scheduleId);
    if (isNaN(scheduleId)) {
        return res.status(400).json({ success: false, message: 'معرف الموعد غير صحيح' });
    }
    const result = await pool_1.default.query('DELETE FROM general_course_group_schedules WHERE id = $1 RETURNING id', [scheduleId]);
    if (!result.rowCount) {
        return res.status(404).json({ success: false, message: 'الموعد غير موجود' });
    }
    res.json({
        success: true,
        message: 'تم حذف الموعد بنجاح',
    });
}));
// 11. عرض طلاب مجموعة محددة (للمدرس والأدمن)
exports.router.get('/groups/:groupId/students', (0, authentication_1.authMiddleware)(['admin', 'teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const groupId = Number(req.params.groupId);
    if (isNaN(groupId)) {
        return res.status(400).json({ success: false, message: 'معرف المجموعة غير صحيح' });
    }
    // التحقق من الصلاحية للمدرس
    if (req.user?.role === 'teacher') {
        const groupCheck = await pool_1.default.query('SELECT 1 FROM general_course_groups WHERE id = $1 AND teacher_id = $2', [groupId, req.user.id]);
        if (!groupCheck.rowCount) {
            return res.status(403).json({ success: false, message: 'غير مصرح لك بالوصول لهذه المجموعة' });
        }
    }
    const result = await pool_1.default.query(`SELECT 
         u.id,
         u.name,
         u.email,
         u.phone,
         gce.enrolled_at
       FROM general_course_enrollments gce
       JOIN users u ON gce.student_id = u.id
       WHERE gce.group_id = $1
       ORDER BY u.name ASC`, [groupId]);
    res.json({
        success: true,
        students: result.rows,
        total: result.rowCount,
    });
}));
// ——— اختبارات المجموعة (كل مجموعة لها قائمة اختبارات مستقلة) ———
async function canManageGroup(groupId, userId, role) {
    if (role === 'admin')
        return true;
    if (role !== 'teacher')
        return false;
    const r = await pool_1.default.query('SELECT 1 FROM general_course_groups WHERE id = $1 AND teacher_id = $2', [groupId, userId]);
    return (r.rowCount ?? 0) > 0;
}
const CreateExamSchema = zod_1.z.object({
    title: zod_1.z.string().min(1, 'عنوان الامتحان مطلوب'),
    total_grade: zod_1.z.number().int().min(1).optional().default(100),
    duration_minutes: zod_1.z.number().int().min(0).optional().nullable(),
});
const UpdateExamSchema = CreateExamSchema.partial();
// إنشاء امتحان لمجموعة — للمدرس صاحب المجموعة أو الأدمن
exports.router.post('/groups/:groupId/exams', (0, authentication_1.authMiddleware)(['admin', 'teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const groupId = Number(req.params.groupId);
    if (isNaN(groupId)) {
        return res.status(400).json({ success: false, message: 'معرف المجموعة غير صحيح' });
    }
    const user = req.user;
    const allowed = await canManageGroup(groupId, user.id, user.role);
    if (!allowed) {
        return res.status(403).json({ success: false, message: 'ليس لديك صلاحية إدارة هذه المجموعة' });
    }
    const parse = CreateExamSchema.safeParse(req.body);
    if (!parse.success) {
        return res.status(400).json({ success: false, message: 'بيانات غير صحيحة', errors: parse.error.errors });
    }
    const { title, total_grade, duration_minutes } = parse.data;
    const groupCheck = await pool_1.default.query('SELECT id FROM general_course_groups WHERE id = $1', [groupId]);
    if (!groupCheck.rowCount) {
        return res.status(404).json({ success: false, message: 'المجموعة غير موجودة' });
    }
    const result = await pool_1.default.query(`INSERT INTO general_course_exams (group_id, title, total_grade, duration_minutes, created_by)
             VALUES ($1, $2, $3, $4, $5) RETURNING *`, [groupId, title, total_grade, duration_minutes ?? null, user.id]);
    res.status(201).json({ success: true, message: 'تم إنشاء الامتحان بنجاح', exam: result.rows[0] });
}));
// جلب اختبارات مجموعة — للمدرس صاحب المجموعة أو الأدمن
exports.router.get('/groups/:groupId/exams', (0, authentication_1.authMiddleware)(['admin', 'teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const groupId = Number(req.params.groupId);
    if (isNaN(groupId)) {
        return res.status(400).json({ success: false, message: 'معرف المجموعة غير صحيح' });
    }
    const user = req.user;
    const allowed = await canManageGroup(groupId, user.id, user.role);
    if (!allowed) {
        return res.status(403).json({ success: false, message: 'ليس لديك صلاحية عرض اختبارات هذه المجموعة' });
    }
    const result = await pool_1.default.query(`SELECT e.*, (SELECT COUNT(*) FROM general_course_exam_questions q WHERE q.exam_id = e.id) as questions_count
             FROM general_course_exams e
             WHERE e.group_id = $1
             ORDER BY e.created_at ASC`, [groupId]);
    res.json({
        success: true,
        exams: result.rows.map((r) => ({
            ...r,
            questions_count: parseInt(r.questions_count, 10),
        })),
    });
}));
// تحديث امتحان — للمدرس صاحب مجموعة الامتحان أو الأدمن
exports.router.put('/exams/:examId', (0, authentication_1.authMiddleware)(['admin', 'teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const examId = Number(req.params.examId);
    if (isNaN(examId)) {
        return res.status(400).json({ success: false, message: 'معرف الامتحان غير صحيح' });
    }
    const user = req.user;
    const examCheck = await pool_1.default.query('SELECT id, group_id FROM general_course_exams WHERE id = $1', [examId]);
    if (!examCheck.rowCount) {
        return res.status(404).json({ success: false, message: 'الامتحان غير موجود' });
    }
    const groupId = examCheck.rows[0].group_id;
    const allowed = await canManageGroup(groupId, user.id, user.role);
    if (!allowed) {
        return res.status(403).json({ success: false, message: 'ليس لديك صلاحية تعديل هذا الامتحان' });
    }
    const parse = UpdateExamSchema.safeParse(req.body);
    if (!parse.success) {
        return res.status(400).json({ success: false, message: 'بيانات غير صحيحة', errors: parse.error.errors });
    }
    const { title, total_grade, duration_minutes } = parse.data;
    const updates = [];
    const values = [];
    let i = 1;
    if (title !== undefined) {
        updates.push(`title = $${i++}`);
        values.push(title);
    }
    if (total_grade !== undefined) {
        updates.push(`total_grade = $${i++}`);
        values.push(total_grade);
    }
    if (duration_minutes !== undefined) {
        updates.push(`duration_minutes = $${i++}`);
        values.push(duration_minutes);
    }
    if (updates.length === 0) {
        return res.json({ success: true, exam: examCheck.rows[0] });
    }
    updates.push('updated_at = NOW()');
    values.push(examId);
    const result = await pool_1.default.query(`UPDATE general_course_exams SET ${updates.join(', ')} WHERE id = $${i} RETURNING *`, values);
    res.json({ success: true, message: 'تم تحديث الامتحان', exam: result.rows[0] });
}));
// حذف امتحان — للمدرس صاحب مجموعة الامتحان أو الأدمن
exports.router.delete('/exams/:examId', (0, authentication_1.authMiddleware)(['admin', 'teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const examId = Number(req.params.examId);
    if (isNaN(examId)) {
        return res.status(400).json({ success: false, message: 'معرف الامتحان غير صحيح' });
    }
    const user = req.user;
    const examCheck = await pool_1.default.query('SELECT id, group_id FROM general_course_exams WHERE id = $1', [examId]);
    if (!examCheck.rowCount) {
        return res.status(404).json({ success: false, message: 'الامتحان غير موجود' });
    }
    const allowed = await canManageGroup(examCheck.rows[0].group_id, user.id, user.role);
    if (!allowed) {
        return res.status(403).json({ success: false, message: 'ليس لديك صلاحية حذف هذا الامتحان' });
    }
    await pool_1.default.query('DELETE FROM general_course_exams WHERE id = $1', [examId]);
    res.json({ success: true, message: 'تم حذف الامتحان' });
}));
