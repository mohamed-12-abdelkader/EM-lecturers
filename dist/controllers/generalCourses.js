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
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const zod_1 = require("zod");
exports.router = (0, express_1.Router)();
const GENERAL_COURSE_PERMISSIONS = [
    'general_courses_management',
    'can_manage_general_courses',
    'manage_general_courses',
    'can_manage_courses',
    'can_manage_course',
    'can_manage_general_course',
    'general_courses_access',
    'can_access_general_courses',
    'access_general_courses',
];
const adminOrGeneralCourseManager = [
    (0, authentication_1.authMiddleware)(['admin', 'employee']),
    (0, permissions_1.checkAnyPermission)(GENERAL_COURSE_PERMISSIONS),
];
async function hasGeneralCoursePermission(userId) {
    return (0, permissions_1.employeeHasAnyPermission)(userId, GENERAL_COURSE_PERMISSIONS);
}
// إعدادات multer لرفع صور الكورسات العامة
const courseImageStorage = multer_1.default.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = 'uploads';
        if (!fs_1.default.existsSync(uploadDir)) {
            fs_1.default.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        cb(null, 'general-course-' + uniqueSuffix + path_1.default.extname(file.originalname));
    },
});
const uploadCourseImage = (0, multer_1.default)({
    storage: courseImageStorage,
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB limit
    },
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif|webp/;
        const extname = allowedTypes.test(path_1.default.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        if (mimetype && extname) {
            return cb(null, true);
        }
        else {
            cb(new Error('فقط ملفات الصور مسموح بها!'));
        }
    },
});
// مخطط التحقق لإنشاء وتعديل الكورس العام
const GeneralCourseSchema = zod_1.z.object({
    title: zod_1.z.string().min(2, 'العنوان يجب أن يكون على الأقل حرفين'),
    description: zod_1.z.string().optional(),
    price: zod_1.z
        .union([zod_1.z.string(), zod_1.z.number()])
        .transform((val) => Number(val))
        .refine((val) => !isNaN(val) && val >= 0, {
        message: 'السعر يجب أن يكون رقم صحيح أكبر من أو يساوي صفر',
    }),
    category: zod_1.z.enum(['برمجة', 'لغات', 'إدارة وتسويق', 'بيزنس', 'مهارات متنوعة'], {
        errorMap: () => ({ message: 'نوع الكورس غير صحيح' }),
    }),
});
// إنشاء كورس عام جديد (للأدمن فقط)
const GenerateCodesSchema = zod_1.z.object({
    count: zod_1.z.number().int().min(1).max(1000).default(1),
});
const ActivateCourseSchema = zod_1.z.object({
    courseId: zod_1.z.number().int(),
    code: zod_1.z.string().length(8, 'الكود يجب أن يتكون من 8 أرقام'),
});
exports.router.post('/', ...adminOrGeneralCourseManager, uploadCourseImage.single('image'), (0, utils_1.asyncWrapper)(async (req, res) => {
    try {
        const parse = GeneralCourseSchema.safeParse(req.body);
        if (!parse.success) {
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors: parse.error.errors,
            });
        }
        const { title, description, price, category } = parse.data;
        const adminId = req.user.id;
        // رفع الصورة إذا تم إرسالها
        let imageUrl = null;
        if (req.file) {
            try {
                const uploaded = await (0, utils_1.uploadToCloudinary)(req.file.path);
                imageUrl = uploaded.secure_url;
            }
            catch (uploadError) {
                console.error('Error uploading image:', uploadError);
                return res.status(500).json({
                    success: false,
                    message: 'فشل في رفع الصورة',
                });
            }
        }
        // إنشاء الكورس
        const result = await pool_1.default.query(`INSERT INTO general_courses (title, description, price, image, category, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`, [title, description || null, price, imageUrl, category, adminId]);
        const course = result.rows[0];
        res.status(201).json({
            success: true,
            message: 'تم إنشاء الكورس العام بنجاح',
            course: {
                id: course.id,
                title: course.title,
                description: course.description,
                price: parseFloat(course.price),
                image: course.image,
                category: course.category,
                created_by: course.created_by,
                created_at: course.created_at,
                updated_at: course.updated_at,
            },
        });
    }
    catch (error) {
        console.error('Error creating general course:', error);
        res.status(500).json({
            success: false,
            message: 'فشل في إنشاء الكورس العام',
            error: error.message,
        });
    }
}));
// جلب جميع الكورسات العامة (للأدمن فقط)
exports.router.get('/', ...adminOrGeneralCourseManager, (0, utils_1.asyncWrapper)(async (req, res) => {
    try {
        const result = await pool_1.default.query(`SELECT 
           gc.*,
           u.name as created_by_name
         FROM general_courses gc
         LEFT JOIN users u ON gc.created_by = u.id
         ORDER BY gc.created_at DESC`);
        res.json({
            success: true,
            courses: result.rows.map((course) => ({
                id: course.id,
                title: course.title,
                description: course.description,
                price: parseFloat(course.price),
                image: course.image,
                category: course.category,
                created_by: course.created_by,
                created_by_name: course.created_by_name,
                created_at: course.created_at,
                updated_at: course.updated_at,
            })),
            total: result.rows.length,
        });
    }
    catch (error) {
        console.error('Error fetching general courses:', error);
        res.status(500).json({
            success: false,
            message: 'فشل في جلب الكورسات العامة',
            error: error.message,
        });
    }
}));
// جلب الكورسات العامة المتاحة للطالب (للطلاب فقط)
// ⚠️ يجب أن يكون قبل route /:id لتجنب مطابقة "available" كـ id
exports.router.get('/available', (0, authentication_1.authMiddleware)(['student', 'admin', 'employee']), (0, utils_1.asyncWrapper)(async (req, res) => {
    try {
        const userRole = req.user.role;
        if (userRole === 'admin' || userRole === 'employee') {
            // الموظف بصلاحية إدارة الكورسات العامة يرى نفس عرض الأدمن
            if (userRole === 'employee') {
                const hasPermission = await hasGeneralCoursePermission(req.user.id);
                if (!hasPermission) {
                    return res.status(403).json({
                        success: false,
                        message: 'لا تملك صلاحية إدارة الكورسات العامة',
                    });
                }
            }
            const result = await pool_1.default.query(`SELECT 
             gc.*,
             u.name as created_by_name
           FROM general_courses gc
           LEFT JOIN users u ON gc.created_by = u.id
           ORDER BY gc.created_at DESC`);
            return res.json({
                success: true,
                courses: result.rows.map((course) => ({
                    id: course.id,
                    title: course.title,
                    description: course.description,
                    price: parseFloat(course.price),
                    image: course.image,
                    category: course.category,
                    created_by: course.created_by,
                    created_by_name: course.created_by_name,
                    created_at: course.created_at,
                    updated_at: course.updated_at,
                })),
                total: result.rows.length,
            });
        }
        const userId = req.user.id;
        // جلب معلومات الطالب (grade_id و course_category)
        const userResult = await pool_1.default.query(`SELECT 
           u.id,
           u.course_category,
           (SELECT COUNT(*) FROM user_grades WHERE user_id = u.id) as has_grade
         FROM users u
         WHERE u.id = $1 AND u.role = 'student'`, [userId]);
        if (!userResult.rowCount) {
            return res.status(404).json({
                success: false,
                message: 'الطالب غير موجود',
            });
        }
        const user = userResult.rows[0];
        const hasGrade = parseInt(user.has_grade) > 0;
        const courseCategory = user.course_category;
        let coursesQuery;
        let queryParams;
        // إذا كان الطالب في صف دراسي: يرجع كل الكورسات العامة
        // إذا كان اختار تخصص: يرجع فقط كورسات هذا التخصص
        if (hasGrade) {
            // طالب في صف دراسي: كل الكورسات
            coursesQuery = `
          SELECT 
            gc.*,
            u.name as created_by_name,
            EXISTS(SELECT 1 FROM general_course_enrollments gce WHERE gce.general_course_id = gc.id AND gce.student_id = $1) as is_enrolled
          FROM general_courses gc
          LEFT JOIN users u ON gc.created_by = u.id
          ORDER BY gc.created_at DESC
        `;
            queryParams = [userId];
        }
        else if (courseCategory) {
            // طالب اختار تخصص: فقط كورسات هذا التخصص
            coursesQuery = `
          SELECT 
            gc.*,
            u.name as created_by_name,
            EXISTS(SELECT 1 FROM general_course_enrollments gce WHERE gce.general_course_id = gc.id AND gce.student_id = $1) as is_enrolled
          FROM general_courses gc
          LEFT JOIN users u ON gc.created_by = u.id
          WHERE gc.category = $2
          ORDER BY gc.created_at DESC
        `;
            queryParams = [userId, courseCategory];
        }
        else {
            // طالب بدون صف وبدون تخصص: لا كورسات متاحة
            return res.json({
                success: true,
                courses: [],
                total: 0,
                message: 'لا توجد كورسات متاحة. يرجى اختيار صف دراسي أو تخصص',
            });
        }
        const result = await pool_1.default.query(coursesQuery, queryParams);
        res.json({
            success: true,
            courses: result.rows.map((course) => ({
                id: course.id,
                title: course.title,
                description: course.description,
                price: parseFloat(course.price),
                image: course.image,
                category: course.category,
                created_by: course.created_by,
                created_by_name: course.created_by_name,
                created_at: course.created_at,
                updated_at: course.updated_at,
                is_enrolled: course.is_enrolled,
                status: course.is_enrolled ? 'enrolled' : 'locked',
            })),
            total: result.rows.length,
            filter: hasGrade ? 'all' : courseCategory,
        });
    }
    catch (error) {
        console.error('Error fetching available general courses:', error);
        res.status(500).json({
            success: false,
            message: 'فشل في جلب الكورسات المتاحة',
            error: error.message,
        });
    }
}));
// توليد أكواد تفعيل لكورس عام (للأدمن فقط)
exports.router.post('/:id/codes', ...adminOrGeneralCourseManager, (0, utils_1.asyncWrapper)(async (req, res) => {
    try {
        const courseId = Number(req.params.id);
        if (isNaN(courseId)) {
            return res.status(400).json({
                success: false,
                message: 'معرف الكورس غير صحيح',
            });
        }
        const parse = GenerateCodesSchema.safeParse(req.body);
        if (!parse.success) {
            return res.status(400).json({
                success: false,
                message: 'بيانات غير صحيحة',
                errors: parse.error.errors,
            });
        }
        const { count } = parse.data;
        // التأكد من وجود الكورس
        const courseCheck = await pool_1.default.query('SELECT id, title FROM general_courses WHERE id = $1', [
            courseId,
        ]);
        if (!courseCheck.rowCount) {
            return res.status(404).json({
                success: false,
                message: 'الكورس غير موجود',
            });
        }
        // توليد الأكواد
        const codes = [];
        const values = [];
        const placeHolders = [];
        let paramIndex = 1;
        // نولد أكواد فريدة
        const generatedSet = new Set();
        while (generatedSet.size < count) {
            const code = Math.floor(10000000 + Math.random() * 90000000).toString();
            generatedSet.add(code);
        }
        generatedSet.forEach((code) => {
            codes.push(code);
            values.push(courseId.toString(), code);
            placeHolders.push(`($${paramIndex}, $${paramIndex + 1})`);
            paramIndex += 2;
        });
        // إدخال الأكواد في قاعدة البيانات
        const query = `
        INSERT INTO general_course_activation_codes (general_course_id, code)
        VALUES ${placeHolders.join(', ')}
        ON CONFLICT (code) DO NOTHING
        RETURNING code
      `;
        // قد يحدث تضارب بسيط، لذا نرجع الأكواد التي تم إدخالها فعلياً
        const result = await pool_1.default.query(query, values);
        const insertedCodes = result.rows.map((r) => r.code);
        res.status(201).json({
            success: true,
            message: `تم إنشاء ${insertedCodes.length} كود بنجاح`,
            codes: insertedCodes,
            requested_count: count,
        });
    }
    catch (error) {
        console.error('Error generating codes:', error);
        res.status(500).json({
            success: false,
            message: 'فشل في إنشاء الأكواد',
            error: error.message,
        });
    }
}));
// جلب أكواد التفعيل لكورس عام (للأدمن فقط)
exports.router.get('/:id/codes', ...adminOrGeneralCourseManager, (0, utils_1.asyncWrapper)(async (req, res) => {
    try {
        const courseId = Number(req.params.id);
        if (isNaN(courseId)) {
            return res.status(400).json({
                success: false,
                message: 'معرف الكورس غير صحيح',
            });
        }
        const result = await pool_1.default.query(`SELECT 
           c.id,
           c.code,
           c.is_used,
           c.created_at,
           c.used_at,
           u.name as used_by_name,
           u.phone as used_by_phone
         FROM general_course_activation_codes c
         LEFT JOIN users u ON c.used_by = u.id
         WHERE c.general_course_id = $1
         ORDER BY c.created_at DESC, c.id DESC`, [courseId]);
        res.json({
            success: true,
            codes: result.rows.map((row) => ({
                id: row.id,
                code: row.code,
                is_used: row.is_used,
                created_at: row.created_at,
                used_at: row.used_at,
                used_by_name: row.used_by_name,
                used_by_phone: row.used_by_phone,
            })),
            total: result.rowCount,
        });
    }
    catch (error) {
        console.error('Error fetching course codes:', error);
        res.status(500).json({
            success: false,
            message: 'فشل في جلب أكواد الكورس',
            error: error.message,
        });
    }
}));
// جلب الطلاب المشتركين في كورس عام (للأدمن فقط)
exports.router.get('/:id/students', ...adminOrGeneralCourseManager, (0, utils_1.asyncWrapper)(async (req, res) => {
    try {
        const courseId = Number(req.params.id);
        if (isNaN(courseId)) {
            return res.status(400).json({
                success: false,
                message: 'معرف الكورس غير صحيح',
            });
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
         WHERE gce.general_course_id = $1
         ORDER BY gce.enrolled_at DESC`, [courseId]);
        res.json({
            success: true,
            students: result.rows,
            total: result.rowCount,
        });
    }
    catch (error) {
        console.error('Error fetching course students:', error);
        res.status(500).json({
            success: false,
            message: 'فشل في جلب المشتركين في الكورس',
            error: error.message,
        });
    }
}));
// تفعيل كورس عام باستخدام كود (للطالب)
exports.router.post('/activate', (0, authentication_1.authMiddleware)(['student']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const client = await pool_1.default.connect();
    try {
        const parse = ActivateCourseSchema.safeParse(req.body);
        if (!parse.success) {
            return res.status(400).json({
                success: false,
                message: 'بيانات غير صحيحة',
                errors: parse.error.errors,
            });
        }
        const { courseId, code } = parse.data;
        const studentId = req.user.id;
        await client.query('BEGIN');
        // 1. التحقق من أن الطالب غير مشترك بالفعل
        const enrollmentCheck = await client.query('SELECT id FROM general_course_enrollments WHERE student_id = $1 AND general_course_id = $2', [studentId, courseId]);
        if (enrollmentCheck.rowCount) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                success: false,
                message: 'أنت مشترك بالفعل في هذا الكورس',
            });
        }
        // 2. التحقق من صحة الكود وصلاحيته للكورس
        const codeCheck = await client.query(`SELECT id, is_used 
         FROM general_course_activation_codes 
         WHERE code = $1 AND general_course_id = $2
         FOR UPDATE`, // قفل الصف لمنع تداخل العمليات
        [code, courseId]);
        if (!codeCheck.rowCount) {
            await client.query('ROLLBACK');
            return res.status(404).json({
                success: false,
                message: 'كود التفعيل غير صحيح لهذا الكورس',
            });
        }
        if (codeCheck.rows[0].is_used) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                success: false,
                message: 'هذا الكود مستخدم من قبل',
            });
        }
        // 3. تفعيل الكود
        await client.query(`UPDATE general_course_activation_codes 
         SET is_used = TRUE, used_at = NOW(), used_by = $1
         WHERE id = $2`, [studentId, codeCheck.rows[0].id]);
        // 4. تسجيل الاشتراك
        await client.query(`INSERT INTO general_course_enrollments (student_id, general_course_id, enrollment_type)
         VALUES ($1, $2, 'code')`, [studentId, courseId]);
        await client.query('COMMIT');
        res.json({
            success: true,
            message: 'تم تفعيل الكورس بنجاح',
        });
    }
    catch (error) {
        await client.query('ROLLBACK');
        console.error('Error activating course:', error);
        res.status(500).json({
            success: false,
            message: 'فشل في تفعيل الكورس',
            error: error.message,
        });
    }
    finally {
        client.release();
    }
}));
// جلب كورس عام محدد (للأدمن فقط، أو للطالب المشترك فيه)
exports.router.get('/:id', (0, authentication_1.authMiddleware)(['admin', 'student', 'employee']), (0, utils_1.asyncWrapper)(async (req, res) => {
    try {
        const courseId = Number(req.params.id);
        if (isNaN(courseId)) {
            return res.status(400).json({
                success: false,
                message: 'معرف الكورس غير صحيح',
            });
        }
        const userRole = req.user.role;
        const userId = req.user.id;
        if (userRole === 'employee') {
            const hasPermission = await hasGeneralCoursePermission(userId);
            if (!hasPermission) {
                return res.status(403).json({
                    success: false,
                    message: 'لا تملك صلاحية إدارة الكورسات العامة',
                });
            }
        }
        let studentGroupId = null;
        if (userRole === 'student') {
            const enrollmentCheck = await pool_1.default.query('SELECT group_id FROM general_course_enrollments WHERE student_id = $1 AND general_course_id = $2', [userId, courseId]);
            if (!enrollmentCheck.rowCount) {
                return res.status(403).json({
                    success: false,
                    message: 'عذراً، يجب عليك الاشتراك في الكورس أولاً لعرض محتوياته',
                });
            }
            studentGroupId = enrollmentCheck.rows[0].group_id ?? null;
        }
        const result = await pool_1.default.query(`SELECT 
           gc.*,
           u.name as created_by_name
         FROM general_courses gc
         LEFT JOIN users u ON gc.created_by = u.id
         WHERE gc.id = $1`, [courseId]);
        if (!result.rowCount) {
            return res.status(404).json({
                success: false,
                message: 'الكورس العام غير موجود',
            });
        }
        const course = result.rows[0];
        let lectures = [];
        let exams = [];
        let live_sessions = [];
        let waitlist = false;
        let waitlist_message = null;
        if (userRole === 'student') {
            if (studentGroupId == null) {
                // طالب في قائمة الانتظار (لم يُضمّ لمجموعة بعد)
                waitlist = true;
                waitlist_message = 'أنت في قائمة الانتظار، سيتم إضافتك لمجموعة قريباً';
            }
            else {
                // طالب منضم لمجموعة: جلب المحاضرات والامتحانات والحصص المباشرة الخاصة بمجموعته
                const lecturesResult = await pool_1.default.query(`SELECT 
               l.id,
               l.title,
               l.description,
               l.created_at,
               l.updated_at,
               l.group_id,
               (
                 SELECT COALESCE(json_agg(
                   json_build_object(
                     'id', v.id,
                     'name', v.name,
                     'url', v.url,
                     'created_at', v.created_at
                   ) ORDER BY v.created_at ASC
                 ), '[]'::json)
                 FROM general_course_videos v
                 WHERE v.lecture_id = l.id
               ) as videos
             FROM general_course_lectures l
             WHERE l.general_course_id = $1 AND l.group_id = $2
             ORDER BY l.created_at ASC`, [courseId, studentGroupId]);
                lectures = lecturesResult.rows.map((r) => ({
                    id: r.id,
                    title: r.title,
                    description: r.description,
                    created_at: r.created_at,
                    updated_at: r.updated_at,
                    group_id: r.group_id,
                    videos: r.videos || [],
                }));
                const examsResult = await pool_1.default.query(`SELECT id, group_id, title, total_grade, duration_minutes, created_at
             FROM general_course_exams
             WHERE group_id = $1
             ORDER BY created_at ASC`, [studentGroupId]);
                exams = examsResult.rows;
                const meetingsResult = await pool_1.default.query(`SELECT m.id, m.group_id, m.title, m.status, m.allow_chat, m.egress_url, m.created_at, m.updated_at, u.name AS creator_name
             FROM general_course_group_meeting m
             LEFT JOIN users u ON u.id = m.created_by
             WHERE m.group_id = $1
             ORDER BY m.created_at DESC`, [studentGroupId]);
                live_sessions = meetingsResult.rows;
            }
        }
        else {
            // أدمن: كل المحاضرات (بدون تصفية مجموعة)
            const lecturesResult = await pool_1.default.query(`SELECT 
             l.id,
             l.title,
             l.description,
             l.created_at,
             l.updated_at,
             l.group_id,
             (
               SELECT COALESCE(json_agg(
                 json_build_object(
                   'id', v.id,
                   'name', v.name,
                   'url', v.url,
                   'created_at', v.created_at
                 ) ORDER BY v.created_at ASC
               ), '[]'::json)
               FROM general_course_videos v
               WHERE v.lecture_id = l.id
             ) as videos
           FROM general_course_lectures l
           WHERE l.general_course_id = $1
           ORDER BY l.created_at ASC`, [courseId]);
            lectures = lecturesResult.rows.map((r) => ({
                id: r.id,
                title: r.title,
                description: r.description,
                created_at: r.created_at,
                updated_at: r.updated_at,
                group_id: r.group_id,
                videos: r.videos || [],
            }));
        }
        res.json({
            success: true,
            course: {
                id: course.id,
                title: course.title,
                description: course.description,
                price: parseFloat(course.price),
                image: course.image,
                category: course.category,
                created_by: course.created_by,
                created_by_name: course.created_by_name,
                created_at: course.created_at,
                updated_at: course.updated_at,
                lectures,
                exams,
                live_sessions: userRole === 'student' ? live_sessions : undefined,
                is_enrolled: userRole === 'student',
                group_id: userRole === 'student' ? studentGroupId ?? undefined : undefined,
                waitlist: userRole === 'student' ? waitlist : undefined,
                waitlist_message: userRole === 'student' ? waitlist_message : undefined,
            },
        });
    }
    catch (error) {
        console.error('Error fetching general course:', error);
        res.status(500).json({
            success: false,
            message: 'فشل في جلب الكورس العام',
            error: error.message,
        });
    }
}));
// تحديث كورس عام (للأدمن فقط)
exports.router.put('/:id', ...adminOrGeneralCourseManager, uploadCourseImage.single('image'), (0, utils_1.asyncWrapper)(async (req, res) => {
    try {
        const courseId = Number(req.params.id);
        if (isNaN(courseId)) {
            return res.status(400).json({
                success: false,
                message: 'معرف الكورس غير صحيح',
            });
        }
        // التحقق من وجود الكورس
        const courseCheck = await pool_1.default.query('SELECT * FROM general_courses WHERE id = $1', [
            courseId,
        ]);
        if (!courseCheck.rowCount) {
            return res.status(404).json({
                success: false,
                message: 'الكورس العام غير موجود',
            });
        }
        const parse = GeneralCourseSchema.partial().safeParse(req.body);
        if (!parse.success) {
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors: parse.error.errors,
            });
        }
        const { title, description, price, category } = parse.data;
        const existingCourse = courseCheck.rows[0];
        // تحديث الصورة إذا تم إرسال صورة جديدة
        let imageUrl = existingCourse.image;
        if (req.file) {
            try {
                const uploaded = await (0, utils_1.uploadToCloudinary)(req.file.path);
                imageUrl = uploaded.secure_url;
            }
            catch (uploadError) {
                console.error('Error uploading image:', uploadError);
                return res.status(500).json({
                    success: false,
                    message: 'فشل في رفع الصورة',
                });
            }
        }
        // بناء استعلام التحديث
        const updates = [];
        const values = [];
        let paramIndex = 1;
        if (title !== undefined) {
            updates.push(`title = $${paramIndex++}`);
            values.push(title);
        }
        if (description !== undefined) {
            updates.push(`description = $${paramIndex++}`);
            values.push(description || null);
        }
        if (price !== undefined) {
            updates.push(`price = $${paramIndex++}`);
            values.push(price);
        }
        if (category !== undefined) {
            updates.push(`category = $${paramIndex++}`);
            values.push(category);
        }
        if (req.file) {
            updates.push(`image = $${paramIndex++}`);
            values.push(imageUrl);
        }
        // تحديث updated_at
        updates.push(`updated_at = NOW()`);
        values.push(courseId);
        if (updates.length === 1) {
            // فقط updated_at تم تحديثه، لا توجد تغييرات
            return res.json({
                success: true,
                message: 'لا توجد تغييرات',
                course: {
                    id: existingCourse.id,
                    title: existingCourse.title,
                    description: existingCourse.description,
                    price: parseFloat(existingCourse.price),
                    image: existingCourse.image,
                    category: existingCourse.category,
                    created_by: existingCourse.created_by,
                    created_at: existingCourse.created_at,
                    updated_at: existingCourse.updated_at,
                },
            });
        }
        const query = `UPDATE general_courses 
                     SET ${updates.join(', ')} 
                     WHERE id = $${paramIndex} 
                     RETURNING *`;
        const result = await pool_1.default.query(query, values);
        res.json({
            success: true,
            message: 'تم تحديث الكورس العام بنجاح',
            course: {
                id: result.rows[0].id,
                title: result.rows[0].title,
                description: result.rows[0].description,
                price: parseFloat(result.rows[0].price),
                image: result.rows[0].image,
                category: result.rows[0].category,
                created_by: result.rows[0].created_by,
                created_at: result.rows[0].created_at,
                updated_at: result.rows[0].updated_at,
            },
        });
    }
    catch (error) {
        console.error('Error updating general course:', error);
        res.status(500).json({
            success: false,
            message: 'فشل في تحديث الكورس العام',
            error: error.message,
        });
    }
}));
// حذف كورس عام (للأدمن فقط)
exports.router.delete('/:id', ...adminOrGeneralCourseManager, (0, utils_1.asyncWrapper)(async (req, res) => {
    try {
        const courseId = Number(req.params.id);
        if (isNaN(courseId)) {
            return res.status(400).json({
                success: false,
                message: 'معرف الكورس غير صحيح',
            });
        }
        // التحقق من وجود الكورس
        const courseCheck = await pool_1.default.query('SELECT id, title FROM general_courses WHERE id = $1', [
            courseId,
        ]);
        if (!courseCheck.rowCount) {
            return res.status(404).json({
                success: false,
                message: 'الكورس العام غير موجود',
            });
        }
        const course = courseCheck.rows[0];
        // حذف الكورس
        await pool_1.default.query('DELETE FROM general_courses WHERE id = $1', [courseId]);
        res.json({
            success: true,
            message: 'تم حذف الكورس العام بنجاح',
            course: {
                id: course.id,
                title: course.title,
            },
        });
    }
    catch (error) {
        console.error('Error deleting general course:', error);
        res.status(500).json({
            success: false,
            message: 'فشل في حذف الكورس العام',
            error: error.message,
        });
    }
}));
