"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const express_1 = require("express");
const authentication_1 = require("../middleware/authentication");
const utils_1 = require("../utils");
const pool_1 = __importDefault(require("../db/pool"));
const bcrypt_1 = __importDefault(require("bcrypt"));
const validateReq_1 = require("../middleware/validateReq");
const auth_modules_1 = require("./auth.modules");
const studentPoints_1 = require("../services/studentPoints");
const studentDailyReport_1 = require("../services/studentDailyReport");
const permissions_1 = require("../middleware/permissions");
exports.router = (0, express_1.Router)();
exports.router.get('/me', (0, authentication_1.authMiddleware)(['student']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const studentId = req.user.id;
    // Fetch basic student info
    const userRes = await pool_1.default.query(`SELECT id, name, phone, email, parent_phone, avatar, role, created_at
       FROM users
       WHERE id = $1 AND role = 'student'`, [studentId]);
    if (userRes.rowCount === 0) {
        return res.status(404).json({ message: 'Student not found' });
    }
    // Fetch student's grades
    const gradesRes = await pool_1.default.query(`SELECT g.id, g.name
       FROM user_grades ug
       JOIN grades g ON ug.grade_id = g.id
       WHERE ug.user_id = $1
       ORDER BY g.id`, [studentId]);
    const user = userRes.rows[0];
    return res.status(200).json({
        id: user.id,
        name: user.name,
        phone: user.phone,
        email: user.email,
        parent_phone: user.parent_phone,
        avatar: user.avatar,
        role: user.role,
        created_at: user.created_at,
        grades: gradesRes.rows,
    });
}));
exports.router.get('/available-teachers', (0, authentication_1.authMiddleware)(['student']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const studentId = req.user.id;
    const studentGradesRes = await pool_1.default.query('SELECT grade_id FROM user_grades WHERE user_id = $1', [studentId]);
    const gradeIds = studentGradesRes.rows.map((row) => row.grade_id);
    if (gradeIds.length === 0) {
        return res.status(404).json({ message: 'Student is not assigned to any grade.' });
    }
    // Get teachers who are assigned to the same grade(s)
    const teachersRes = await pool_1.default.query(`
      SELECT DISTINCT u.id, u.name, u.avatar, u.subject, u.description, u.phone, u.email, u.facebook_url, u.youtube_url, u.tiktok_url, u.whatsapp_number
      FROM users u
      JOIN teacher_grades tg ON u.id = tg.teacher_id
      WHERE u.role = 'teacher' AND u.account_status = 'active' AND tg.grade_id = ANY($1::int[])
    `, [gradeIds]);
    // جلب الصفوف التي يدرسها كل مدرس (اختياري)
    const teacherIds = teachersRes.rows.map((t) => t.id);
    let gradesMap = {};
    if (teacherIds.length) {
        const gradesRes = await pool_1.default.query(`SELECT ug.user_id as teacher_id, g.id, g.name
         FROM user_grades ug
         JOIN grades g ON ug.grade_id = g.id
         WHERE ug.user_id = ANY($1::int[])`, [teacherIds]);
        gradesMap = gradesRes.rows.reduce((acc, row) => {
            if (!acc[row.teacher_id])
                acc[row.teacher_id] = [];
            acc[row.teacher_id].push({ id: row.id, name: row.name });
            return acc;
        }, {});
    }
    res.status(200).json({
        teachers: teachersRes.rows.map((t) => ({
            ...t,
            avatar: t.avatar,
            grades: gradesMap[t.id] || [],
        })),
    });
}));
// عرض تفاصيل المدرس والكورسات الخاصة به لصف الطالب
exports.router.get('/teacher/:teacherId/details', (0, authentication_1.authMiddleware)(['student']), (0, utils_1.asyncWrapper)(async (req, res) => {
    try {
        const teacherId = Number(req.params.teacherId);
        const studentId = req.user.id;
        // التحقق من أن المدرس موجود
        const teacherCheck = await pool_1.default.query('SELECT id, name, email, phone, avatar, created_at, description, subject, facebook_url, youtube_url, tiktok_url, whatsapp_number FROM users WHERE id = $1 AND role = $2 AND account_status = $3', [teacherId, 'teacher', 'active']);
        if (teacherCheck.rowCount === 0) {
            return res.status(404).json({ message: 'Teacher not found' });
        }
        // احصل على الصفوف الدراسية للطالب
        const studentGradesRes = await pool_1.default.query('SELECT grade_id FROM user_grades WHERE user_id = $1', [studentId]);
        const studentGradeIds = studentGradesRes.rows.map((row) => row.grade_id);
        if (studentGradeIds.length === 0) {
            return res.status(400).json({ message: 'Student is not assigned to any grade' });
        }
        // احصل على الصفوف التي يدرس فيها المدرس
        const teacherGradesRes = await pool_1.default.query('SELECT grade_id FROM teacher_grades WHERE teacher_id = $1', [teacherId]);
        const teacherGradeIds = teacherGradesRes.rows.map((row) => row.grade_id);
        // تحقق من أن المدرس يدرس في نفس صفوف الطالب
        const commonGrades = studentGradeIds.filter((gradeId) => teacherGradeIds.includes(gradeId));
        // Debug log
        console.log({ teacherId, studentId, studentGradeIds, teacherGradeIds, commonGrades });
        if (commonGrades.length === 0) {
            return res.status(403).json({
                message: 'This teacher does not teach in your grade',
            });
        }
        // احصل على أسماء الصفوف المشتركة
        const commonGradesNamesRes = await pool_1.default.query(`SELECT id, name FROM grades WHERE id = ANY($1::int[])`, [commonGrades]);
        const teacher = teacherCheck.rows[0];
        const commonGradesInfo = commonGradesNamesRes.rows;
        // جلب الكورسات الخاصة بالمدرس في صفوف الطالب
        const coursesRes = await pool_1.default.query(`SELECT c.id, c.title, c.description, c.price, c.grade_id, c.avatar,
                CASE WHEN e.user_id IS NOT NULL THEN true ELSE false END as is_enrolled
         FROM courses c
         LEFT JOIN enrollments e ON c.id = e.course_id AND e.user_id = $1
         WHERE c.teacher_id = $2 AND c.grade_id = ANY($3::int[])`, [studentId, teacherId, commonGrades]);
        res.status(200).json({
            teacher: {
                id: teacher.id,
                name: teacher.name,
                email: teacher.email,
                phone: teacher.phone,
                avatar: teacher.avatar,
                created_at: teacher.created_at,
                description: teacher.description,
                subject: teacher.subject,
                facebook_url: teacher.facebook_url,
                youtube_url: teacher.youtube_url,
                tiktok_url: teacher.tiktok_url,
                whatsapp_number: teacher.whatsapp_number,
            },
            common_grades: commonGradesInfo,
            courses: coursesRes.rows.map((course) => ({
                ...course,
                avatar: course.avatar,
            })),
        });
    }
    catch (err) {
        console.error('تفاصيل الخطأ:', err);
        const errorMessage = err instanceof Error ? err.message : String(err);
        return res.status(500).json({ message: 'Internal error', error: errorMessage });
    }
}));
// عرض المدرسين المشترك معهم الطالب مع مادته ووصفها
exports.router.get('/my-teachers', (0, authentication_1.authMiddleware)(['student']), (0, utils_1.asyncWrapper)(async (req, res) => {
    try {
        const studentId = req.user.id;
        const result = await pool_1.default.query(`SELECT DISTINCT u.id as teacher_id, u.name, u.avatar, u.phone, u.subject, u.facebook_url, u.youtube_url, u.tiktok_url, u.whatsapp_number, c.id as course_id, c.title as course_title, c.description as course_description, c.avatar as course_avatar
         FROM enrollments e
         JOIN courses c ON e.course_id = c.id
         JOIN users u ON c.teacher_id = u.id
         WHERE e.user_id = $1 AND u.role = 'teacher' AND u.account_status = 'active'`, [studentId]);
        // تجميع الكورسات لكل مدرس
        const teachersMap = new Map();
        for (const row of result.rows) {
            if (!teachersMap.has(row.teacher_id)) {
                teachersMap.set(row.teacher_id, {
                    id: row.teacher_id,
                    name: row.name,
                    avatar: row.avatar,
                    phone: row.phone,
                    subject: row.subject,
                    facebook_url: row.facebook_url,
                    youtube_url: row.youtube_url,
                    tiktok_url: row.tiktok_url,
                    whatsapp_number: row.whatsapp_number,
                    courses: [],
                });
            }
            teachersMap.get(row.teacher_id).courses.push({
                id: row.course_id,
                title: row.course_title,
                description: row.course_description,
                avatar: row.course_avatar,
            });
        }
        res.json({
            teachers: Array.from(teachersMap.values()),
        });
    }
    catch (err) {
        console.error('تفاصيل الخطأ في my-teachers:', err);
        const errorMessage = err instanceof Error ? err.message : String(err);
        return res.status(500).json({ message: 'Internal error', error: errorMessage });
    }
}));
// جلب كورسات مدرس منصة معينة عبر subdomain مع حالة الإتاحة للطالب
exports.router.get('/teacher-platform/:subdomain/courses', (0, authentication_1.authMiddleware)(['student']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const studentId = req.user.id;
    const subdomain = String(req.params.subdomain || '')
        .trim()
        .toLowerCase();
    if (!subdomain)
        return res.status(400).json({ message: 'subdomain is required' });
    const tenantRes = await pool_1.default.query(`SELECT id, subdomain, display_name, owner_user_id, is_active
       FROM tenants
       WHERE subdomain = $1
       LIMIT 1`, [subdomain]);
    if (!tenantRes.rowCount) {
        return res.status(404).json({ success: false, message: 'Teacher platform not found' });
    }
    const tenant = tenantRes.rows[0];
    if (!tenant.owner_user_id) {
        return res.status(404).json({ success: false, message: 'Teacher owner not found for platform' });
    }
    const { TeacherPlatformSubscriptionsService } = await import('../services/teacherPlatformSubscriptions.js');
    const access = await TeacherPlatformSubscriptionsService.getPlatformAccessState(tenant.owner_user_id);
    if (!access.allowed) {
        return res.status(403).json({
            success: false,
            code: 'PLATFORM_SUBSCRIPTION_SUSPENDED',
            message: 'تم إيقاف هذه المنصة لعدم تجديد اشتراك المدرس',
        });
    }
    if (!tenant.is_active) {
        return res.status(403).json({ success: false, message: 'Teacher platform is inactive' });
    }
    const teacherRes = await pool_1.default.query(`SELECT id, avatar
       FROM users
       WHERE id = $1 AND role = 'teacher'
       LIMIT 1`, [tenant.owner_user_id]);
    const teacherAvatar = teacherRes.rows[0]?.avatar ?? null;
    const studentGradesRes = await pool_1.default.query(`SELECT grade_id
       FROM user_grades
       WHERE user_id = $1`, [studentId]);
    const studentGradeIds = studentGradesRes.rows.map((r) => Number(r.grade_id)).filter(Boolean);
    if (!studentGradeIds.length) {
        return res.json({
            success: true,
            data: {
                platform: {
                    id: tenant.id,
                    subdomain: tenant.subdomain,
                    display_name: tenant.display_name,
                    teacher_id: tenant.owner_user_id,
                    teacher_avatar: teacherAvatar,
                },
                student_grade_ids: [],
                courses: [],
            },
        });
    }
    const coursesRes = await pool_1.default.query(`SELECT
         c.id,
         c.title,
         c.description,
         c.price,
         c.avatar,
         c.grade_id,
         c.created_at,
         COALESCE(c.is_free, FALSE) AS is_free,
         g.name AS grade_name,
         g.slug AS grade_slug,
         CASE WHEN e.user_id IS NOT NULL THEN true ELSE false END AS is_enrolled
       FROM courses c
       LEFT JOIN grades g ON g.id = c.grade_id
       LEFT JOIN enrollments e ON e.course_id = c.id AND e.user_id = $1
       WHERE c.teacher_id = $2
         AND (c.grade_id = ANY($3::int[]) OR c.grade_id IS NULL)
       ORDER BY c.created_at DESC`, [studentId, tenant.owner_user_id, studentGradeIds]);
    const courses = coursesRes.rows.map((course) => ({
        id: course.id,
        title: course.title,
        description: course.description,
        price: course.price,
        avatar: course.avatar,
        is_free: course.is_free === true,
        grade: course.grade_id
            ? {
                id: course.grade_id,
                name: course.grade_name,
                slug: course.grade_slug,
            }
            : null,
        is_enrolled: Boolean(course.is_enrolled),
        access_status: course.is_free || course.is_enrolled ? 'open' : 'locked',
        created_at: course.created_at,
    }));
    return res.json({
        success: true,
        data: {
            platform: {
                id: tenant.id,
                subdomain: tenant.subdomain,
                display_name: tenant.display_name,
                teacher_id: tenant.owner_user_id,
                teacher_avatar: teacherAvatar,
            },
            student_grade_ids: studentGradeIds,
            courses,
        },
    });
}));
// تغيير كلمة سر الطالب باستخدام رقم الهاتف
exports.router.post('/change-password', (0, validateReq_1.validate)(auth_modules_1.StudentChangePassword), (0, utils_1.asyncWrapper)(async (req, res) => {
    try {
        const { phone, new_password } = req.body;
        // التحقق من وجود الطالب برقم الهاتف
        const studentResult = await pool_1.default.query('SELECT id, name, phone FROM users WHERE phone = $1 AND role = $2', [phone, 'student']);
        if (!studentResult.rowCount) {
            return res.status(404).json({
                success: false,
                message: 'الطالب غير موجود برقم الهاتف المحدد',
            });
        }
        const student = studentResult.rows[0];
        // تشفير كلمة السر الجديدة
        const hashedPassword = await bcrypt_1.default.hash(new_password, 10);
        // تحديث كلمة السر
        await pool_1.default.query('UPDATE users SET password = $1 WHERE id = $2 AND role = $3', [
            hashedPassword,
            student.id,
            'student',
        ]);
        res.json({
            success: true,
            message: 'تم تغيير كلمة السر بنجاح',
            data: {
                student_id: student.id,
                student_name: student.name,
                student_phone: student.phone,
                password_changed_at: new Date().toISOString(),
            },
        });
    }
    catch (error) {
        console.error('Error changing student password:', error);
        res.status(500).json({
            success: false,
            message: 'فشل في تغيير كلمة السر',
            error: error.message,
        });
    }
}));
// عرض تفاصيل المحاضرات للطالب مع إحصائيات المشاهدة
exports.router.get('/my-lectures', (0, authentication_1.authMiddleware)(['student']), (0, utils_1.asyncWrapper)(async (req, res) => {
    try {
        const studentId = req.user.id;
        // جلب جميع الكورسات المشترك فيها الطالب
        const enrollmentsRes = await pool_1.default.query(`SELECT 
          c.id as course_id,
          c.title as course_title,
          c.description as course_description,
          c.avatar as course_avatar,
          c.teacher_id,
          u.name as teacher_name,
          u.avatar as teacher_avatar,
          e.enrolled_at
        FROM enrollments e
        JOIN courses c ON e.course_id = c.id
        JOIN users u ON c.teacher_id = u.id
        WHERE e.user_id = $1 AND c.is_visible = true
        ORDER BY e.enrolled_at DESC`, [studentId]);
        if (enrollmentsRes.rowCount === 0) {
            return res.json({
                success: true,
                lectures: [],
            });
        }
        const enrollments = enrollmentsRes.rows;
        const courseIds = enrollments.map((e) => e.course_id);
        // جلب جميع المحاضرات في الكورسات المشترك فيها
        const lecturesRes = await pool_1.default.query(`SELECT 
          l.id,
          l.title,
          l.description,
          l.position,
          l.course_id,
          l.created_at
        FROM lectures l
        WHERE l.course_id = ANY($1::int[])
        ORDER BY l.course_id, l.position, l.created_at`, [courseIds]);
        const lectures = lecturesRes.rows;
        const lectureIds = lectures.map((l) => l.id);
        // جلب جميع الفيديوهات في هذه المحاضرات
        let videos = [];
        if (lectureIds.length > 0) {
            const videosRes = await pool_1.default.query(`SELECT 
            lv.id,
            lv.lecture_id,
            lv.video_url,
            lv.title,
            lv.position
          FROM lecture_videos lv
          WHERE lv.lecture_id = ANY($1::int[])
          ORDER BY lv.lecture_id, lv.position`, [lectureIds]);
            videos = videosRes.rows;
        }
        // جلب جميع مشاهدات الفيديوهات للطالب
        let videoViews = [];
        if (lectureIds.length > 0) {
            const videoViewsRes = await pool_1.default.query(`SELECT 
            vv.video_id,
            vv.lecture_id,
            vv.is_completed,
            vv.viewed_at
          FROM video_views vv
          WHERE vv.user_id = $1 AND vv.lecture_id = ANY($2::int[])`, [studentId, lectureIds]);
            videoViews = videoViewsRes.rows;
        }
        // تجميع البيانات
        const lecturesData = lectures.map((lecture) => {
            const course = enrollments.find((e) => e.course_id === lecture.course_id);
            const lectureVideos = videos.filter((v) => v.lecture_id === lecture.id);
            const watchedVideos = videoViews.filter((vv) => vv.lecture_id === lecture.id);
            const watchedCount = watchedVideos.length;
            const totalVideos = lectureVideos.length;
            const remainingVideos = totalVideos - watchedCount;
            // حساب نسبة المشاهدة (33% = محاضرة اتشاهدت)
            const watchPercentage = totalVideos > 0 ? (watchedCount / totalVideos) * 100 : 0;
            // المحاضرة اتشاهدت إذا: شاهد 33% من الفيديوهات أو أكثر، أو إذا كان له أي سجل في video_views (يعني فتح الفيديوهات)
            const isWatched = watchPercentage >= 33.33 || watchedCount > 0;
            return {
                id: lecture.id,
                title: lecture.title,
                description: lecture.description,
                position: lecture.position,
                created_at: lecture.created_at,
                course: {
                    id: course.course_id,
                    title: course.course_title,
                    description: course.course_description,
                    avatar: course.course_avatar,
                },
                teacher: {
                    id: course.teacher_id,
                    name: course.teacher_name,
                    avatar: course.teacher_avatar,
                },
                statistics: {
                    total_videos: totalVideos,
                    watched_videos: watchedCount,
                    remaining_videos: remainingVideos,
                    watch_percentage: Math.round(watchPercentage * 100) / 100,
                    is_watched: isWatched,
                },
                videos: lectureVideos.map((video) => {
                    const videoView = videoViews.find((vv) => vv.video_id === video.id);
                    return {
                        id: video.id,
                        title: video.title,
                        video_url: video.video_url,
                        position: video.position,
                        is_watched: !!videoView,
                        is_completed: videoView?.is_completed || false,
                        viewed_at: videoView?.viewed_at || null,
                    };
                }),
            };
        });
        res.json({
            success: true,
            lectures: lecturesData,
            total_lectures: lecturesData.length,
            total_courses: enrollments.length,
        });
    }
    catch (error) {
        console.error('Error fetching student lectures:', error);
        res.status(500).json({
            success: false,
            message: 'فشل في جلب المحاضرات',
            error: error.message,
        });
    }
}));
// التقرير اليومي: المحاضرات والامتحانات المتراكمة على الطالب (للتنبيه اليومي)
exports.router.get('/daily-report', (0, authentication_1.authMiddleware)(['student']), (0, utils_1.asyncWrapper)(async (req, res) => {
    try {
        const studentId = req.user.id;
        const createNotification = req.query.create_notification === '1' || req.query.create_notification === 'true';
        const report = await studentDailyReport_1.StudentDailyReportService.getReport(studentId);
        if (createNotification && (report.summary.pending_lectures_count > 0 || report.summary.pending_exams_count > 0)) {
            const title = 'تذكير: محاضرات وامتحانات متراكمة';
            const message = report.summary.pending_lectures_count > 0 && report.summary.pending_exams_count > 0
                ? `لديك ${report.summary.pending_lectures_count} محاضرة و${report.summary.pending_exams_count} امتحان لم تكملها بعد.`
                : report.summary.pending_lectures_count > 0
                    ? `لديك ${report.summary.pending_lectures_count} محاضرة لم تشاهدها بعد.`
                    : `لديك ${report.summary.pending_exams_count} امتحان لم تحله بعد.`;
            await pool_1.default.query(`INSERT INTO notifications (user_id, title, message, type) VALUES ($1, $2, $3, 'course_update')`, [studentId, title, message]);
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            ExpoPushService.sendPushNotification(studentId, title, message, { type: 'course_update' }).catch((e) => console.error('Expo push error:', e));
        }
        res.json({
            success: true,
            report,
        });
    }
    catch (error) {
        console.error('Error fetching daily report:', error);
        res.status(500).json({
            success: false,
            message: 'فشل في جلب التقرير اليومي',
            error: error.message,
        });
    }
}));
// جلب نقاط الطالب
exports.router.get('/my-points', (0, authentication_1.authMiddleware)(['student']), (0, utils_1.asyncWrapper)(async (req, res) => {
    try {
        const studentId = req.user.id;
        const points = await studentPoints_1.StudentPointsService.getStudentPoints(studentId);
        res.json({
            success: true,
            points: {
                total_points: points?.total_points || 0,
                last_reset_at: points?.last_reset_at || null,
                created_at: points?.created_at || new Date(),
                updated_at: points?.updated_at || new Date(),
            },
        });
    }
    catch (error) {
        console.error('Error fetching student points:', error);
        res.status(500).json({
            success: false,
            message: 'فشل في جلب النقاط',
            error: error.message,
        });
    }
}));
// جلب جميع الطلاب (للأدمن)
exports.router.get('/students-data', (0, authentication_1.authMiddleware)(['admin', 'employee']), 
// ندعم أكثر من مفتاح صلاحيات حسب صيغة التخزين في DB/الواجهة
(0, permissions_1.checkAnyPermission)([
    'can_manage_students',
    'students_management',
    'manage_students',
    'student_management',
]), (0, utils_1.asyncWrapper)(async (req, res) => {
    try {
        // جلب جميع الطلاب مع معلومات الصفوف
        const result = await pool_1.default.query(`
        SELECT 
          u.id,
          u.name,
          u.phone,
          u.email,
          u.parent_phone,
          u.avatar,
          u.created_at,
          ARRAY_AGG(DISTINCT g.id) as grade_ids,
          ARRAY_AGG(DISTINCT g.name) as grade_names
        FROM users u
        LEFT JOIN user_grades ug ON u.id = ug.user_id
        LEFT JOIN grades g ON ug.grade_id = g.id
        WHERE u.role = 'student'
        GROUP BY u.id, u.name, u.phone, u.email, u.parent_phone, u.avatar, u.created_at
        ORDER BY u.created_at DESC
      `);
        // تنسيق البيانات
        const students = result.rows.map((student) => ({
            id: student.id,
            name: student.name,
            phone: student.phone,
            email: student.email,
            parent_phone: student.parent_phone,
            avatar: student.avatar,
            created_at: student.created_at,
            grades: student.grade_ids[0]
                ? student.grade_ids.map((id, index) => ({
                    id: id,
                    name: student.grade_names[index],
                }))
                : [],
        }));
        res.json({
            success: true,
            data: {
                students: students,
                total: students.length,
            },
        });
    }
    catch (err) {
        console.error('تفاصيل الخطأ في students-data:', err);
        const errorMessage = err instanceof Error ? err.message : String(err);
        return res.status(500).json({
            success: false,
            message: 'Internal error',
            error: errorMessage,
        });
    }
}));
