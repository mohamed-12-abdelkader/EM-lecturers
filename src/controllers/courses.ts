import { Router } from 'express';
import { authMiddleware } from '../middleware/authentication';
import { asyncWrapper, uploadToCloudinary } from '../utils';
import { pickBodyValue } from '../utils/requestParsers';
import pool from '../db/pool';
import { CourseAccessService } from '../services/courseAccess';
import { z } from 'zod';
import { NotificationService } from '../services/notifications';
import { TeacherActivityService } from '../services/teacherActivities';
import { LectureExamService } from '../services/lectureExam';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { ChatService } from '../services/chat';
import { CourseLevelExamsService } from '../services/courseLevelExams';
import { TeacherReportsService } from '../services/teacherReports';
import { ExamsService } from '../services/exams';
import * as ExpoPushService from '../services/expoPushService';
import { NotificationTriggers } from '../services/notificationTriggers';
import { VideoViewTrackingService } from '../services/videoViewTracking';
import { SeoHooks } from '../services/seo/hooks';

export const router = Router();

// إعدادات multer لرفع صور الكورسات
const courseImageStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'uploads';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'course-' + uniqueSuffix + path.extname(file.originalname));
  },
});

const uploadCourseImage = multer({
  storage: courseImageStorage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('فقط ملفات الصور مسموح بها!'));
    }
  },
});

// multer لرفع صورة سؤال امتحان الكورس
const questionImageStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'uploads';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'exam-question-' + uniqueSuffix + path.extname(file.originalname));
  },
});

const uploadQuestionImage = multer({
  storage: questionImageStorage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (mimetype && extname) {
      return cb(null, true);
    }
    cb(new Error('فقط ملفات الصور مسموح بها (jpeg, jpg, png, gif, webp)'));
  },
});

// مخطط التحقق لإنشاء وتعديل الكورس
const CourseSchema = z.object({
  title: z.string().min(2),
  price: z
    .union([z.string(), z.number()])
    .transform((val) => Number(val))
    .refine((val) => !isNaN(val) && val >= 0, {
      message: 'Price must be a valid non-negative number',
    })
    .optional(),
  is_free: z
    .union([z.string(), z.boolean(), z.number()])
    .optional()
    .transform((val) => {
      if (val === undefined || val === null || val === '') return undefined;
      if (val === true || val === 1) return true;
      if (val === false || val === 0) return false;
      if (typeof val === 'string') {
        const v = val.trim().toLowerCase();
        return v === 'true' || v === '1' || v === 'yes';
      }
      return false;
    }),
  description: z.string().optional(),
  grade_id: z
    .union([z.string(), z.number()])
    .transform((val) => Number(val))
    .refine((val) => !isNaN(val) && val > 0, {
      message: 'Grade ID must be a valid positive number',
    }),
});

function resolveCoursePricing(input: { price?: number; is_free?: boolean }) {
  const isFree = input.is_free === true;
  if (isFree) {
    return { is_free: true, price: 0 };
  }
  const price = input.price ?? 0;
  if (price <= 0) {
    throw new Error('PAID_COURSE_REQUIRES_PRICE');
  }
  return { is_free: false, price };
}

// مخطط التحقق لإنشاء كود التفعيل
const CreateActivationCodeSchema = z.object({
  course_id: z.number(),
  count: z.number().min(1).max(100).default(1), // عدد الأكواد المطلوبة
});

// مخطط التحقق لتفعيل الكورس
const ActivateCourseSchema = z.object({
  code: z.string().min(1),
  course_id: z.number(),
});

// إنشاء كورس جديد (مدرس فقط)
router.post(
  '/',
  authMiddleware(['teacher']),
  uploadCourseImage.single('avatar'),
  asyncWrapper(async (req, res) => {
    try {
      const parse = CourseSchema.safeParse(req.body);
      if (!parse.success) {
        return res.status(400).json({ message: 'Validation failed', errors: parse.error.errors });
      }

      const { title, description, grade_id, price, is_free } = parse.data;
      const teacher_id = req.user!.id;

      let pricing: { is_free: boolean; price: number };
      try {
        pricing = resolveCoursePricing({ price, is_free });
      } catch {
        return res.status(400).json({
          message: 'الكورس المدفوع يجب أن يكون له سعر أكبر من صفر، أو حدّد is_free=true',
        });
      }

      // تحقق من وجود الصف الدراسي
      const gradeCheck = await pool.query('SELECT id FROM grades WHERE id = $1', [grade_id]);
      if (!gradeCheck.rowCount) return res.status(400).json({ message: 'Invalid grade selected' });

      const file = req.file ?? null;
      const avatar = file ? (await uploadToCloudinary(file.path)).secure_url : null;

      const result = await pool.query(
        `INSERT INTO courses (title, price, description, teacher_id, grade_id, avatar, is_free)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [title, pricing.price, description, teacher_id, grade_id, avatar, pricing.is_free],
      );

      const course = result.rows[0];

      try {
        await SeoHooks.onCourseChanged(teacher_id, course.id, title);
      } catch (seoError) {
        console.error('SEO hook after course create:', seoError);
      }

      // تسجيل نشاط إنشاء الكورس
      try {
        await TeacherActivityService.logCourseCreated(teacher_id, course.id, title);
      } catch (activityError) {
        console.error('Error logging activity:', activityError);
        // لا نوقف العملية إذا فشل في تسجيل النشاط
      }

      res.status(201).json({ course });
    } catch (error: any) {
      console.error('Error creating course:', error);

      // حذف الصورة المرفوعة في حالة حدوث خطأ
      if (req.file && fs.existsSync(req.file.path)) {
        try {
          fs.unlinkSync(req.file.path);
        } catch (deleteError) {
          console.error('Error deleting uploaded file:', deleteError);
        }
      }

      // إرجاع رسالة خطأ واضحة
      res.status(500).json({
        message: 'Error creating course',
        error: error.message || 'Unknown error occurred',
      });
    }
  }),
);

// إنشاء كود تفعيل للكورس (مدرس فقط)
router.post(
  '/activation-code',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const parse = CreateActivationCodeSchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ message: 'Validation failed', errors: parse.error.errors });
    }

    const { course_id, count } = parse.data;
    const teacher_id = req.user!.id;

    // تحقق أن الكورس يخص المدرس
    const courseCheck = await pool.query(
      'SELECT id FROM courses WHERE id = $1 AND teacher_id = $2',
      [course_id, teacher_id],
    );

    if (!courseCheck.rowCount) {
      return res.status(404).json({ message: 'Course not found or not yours' });
    }

    const activationCodes: any[] = [];

    // إنشاء الأكواد المطلوبة
    function generateCode(length = 8) {
      const chars = '0123456789';
      let code = '';
      for (let i = 0; i < length; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      return code;
    }
    for (let i = 0; i < count; i++) {
      const code = generateCode(8);

      // إدخال كود التفعيل
      const result = await pool.query(
        `INSERT INTO teacher_invite_codes (code, course_id, teacher_id, max_uses, expires_at)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, code, max_uses, expires_at, created_at`,
        [code, course_id, teacher_id, 1, null], // max_uses is set to 1 for single-use codes, expires_at is null
      );

      activationCodes.push(result.rows[0]);
    }

    res.status(201).json({
      activation_codes: activationCodes.map((code) => ({
        id: code.id,
        code: code.code,
        max_uses: code.max_uses,
        expires_at: code.expires_at,
        created_at: code.created_at,
      })),
    });
  }),
);

// عرض أكواد التفعيل الخاصة بالمدرس مع QR codes
router.get(
  '/my-activation-codes',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const teacher_id = req.user!.id;
    const { course_id } = req.query;
    let query = `SELECT 
      tic.id,
      tic.code,
      tic.max_uses,
      tic.uses,
      tic.expires_at,
      tic.created_at,
      c.title as course_title,
      c.id as course_id,
      g.name as grade_name
     FROM teacher_invite_codes tic
     JOIN courses c ON tic.course_id = c.id
     JOIN grades g ON c.grade_id = g.id
     WHERE tic.teacher_id = $1`;
    const values: any[] = [teacher_id];
    if (course_id) {
      query += ' AND tic.course_id = $2';
      values.push(Number(course_id));
    }
    query += ' ORDER BY tic.created_at DESC';
    const result = await pool.query(query, values);

    // Import QRCodeService
    const { QRCodeService } = await import('../services/QRCodeService.js');

    // Generate QR codes for each activation code
    const activationCodesWithQR = await Promise.all(
      result.rows.map(async (row) => {
        try {
          const qrCodeData = {
            activation_code: row.code,
            course_id: row.course_id,
            expires_at: row.expires_at,
            created_at: row.created_at,
          };

          const qrCode = await QRCodeService.generateQRCode(qrCodeData);

          return {
            id: row.id,
            code: row.code,
            max_uses: row.max_uses,
            uses: row.uses,
            expires_at: row.expires_at,
            created_at: row.created_at,
            course_title: row.course_title,
            course_id: row.course_id,
            grade_name: row.grade_name,
            is_expired: row.expires_at ? new Date(row.expires_at) < new Date() : false,
            is_fully_used: row.uses >= row.max_uses,
            qr_code: qrCode,
          };
        } catch (error) {
          console.error('Error generating QR code for activation code:', row.code, error);
          return {
            id: row.id,
            code: row.code,
            max_uses: row.max_uses,
            uses: row.uses,
            expires_at: row.expires_at,
            created_at: row.created_at,
            course_title: row.course_title,
            course_id: row.course_id,
            grade_name: row.grade_name,
            is_expired: row.expires_at ? new Date(row.expires_at) < new Date() : false,
            is_fully_used: row.uses >= row.max_uses,
            qr_code: null,
            qr_error: 'فشل في إنشاء QR code',
          };
        }
      }),
    );

    res.json({
      activation_codes: activationCodesWithQR,
    });
  }),
);

// تفعيل كورس لطالب بالكود (أدمن فقط): يُمرَّر id الطالب والكود ويتم التفعيل فوراً
router.post(
  '/admin/activate-by-code',
  authMiddleware(['admin']),
  asyncWrapper(async (req, res) => {
    const studentId = Number(req.body.studentId ?? req.body.student_id);
    const code = String(req.body.code ?? '').trim();

    if (!studentId || Number.isNaN(studentId)) {
      return res.status(400).json({ message: 'studentId مطلوب ويجب أن يكون رقماً' });
    }
    if (!code) {
      return res.status(400).json({ message: 'كود التفعيل مطلوب' });
    }

    const codeCheck = await pool.query(
      `SELECT tic.id, tic.code, tic.course_id, tic.max_uses, tic.uses, tic.expires_at,
              c.title as course_title
       FROM teacher_invite_codes tic
       JOIN courses c ON tic.course_id = c.id
       WHERE tic.code = $1`,
      [code],
    );

    if (!codeCheck.rowCount) {
      return res.status(404).json({ message: 'الكود غير موجود' });
    }

    const row = codeCheck.rows[0];
    if (row.expires_at && new Date(row.expires_at) < new Date()) {
      return res.status(400).json({ message: 'الكود منتهي الصلاحية' });
    }
    if (Number(row.uses) >= Number(row.max_uses)) {
      return res.status(400).json({ message: 'الكود مستنفذ بالكامل' });
    }

    const studentCheck = await pool.query(
      'SELECT id, name, email FROM users WHERE id = $1 AND role = $2',
      [studentId, 'student'],
    );
    if (!studentCheck.rowCount) {
      return res.status(404).json({ message: 'الطالب غير موجود أو ليس حساب طالب' });
    }

    const usageCheck = await pool.query(
      'SELECT id FROM invite_code_usages WHERE user_id = $1 AND code_id = $2',
      [studentId, row.id],
    );
    if (usageCheck.rowCount && usageCheck.rowCount > 0) {
      return res.status(400).json({ message: 'هذا الطالب مفعّل له الكورس مسبقاً بهذا الكود' });
    }

    await pool.query('INSERT INTO invite_code_usages (user_id, code_id) VALUES ($1, $2)', [
      studentId,
      row.id,
    ]);
    await pool.query('UPDATE teacher_invite_codes SET uses = uses + 1 WHERE id = $1', [row.id]);
    await pool.query(
      'INSERT INTO enrollments (user_id, course_id) VALUES ($1, $2) ON CONFLICT (user_id, course_id) DO NOTHING',
      [studentId, row.course_id],
    );

    try {
      const gradeRes = await pool.query(
        'SELECT grade_id, teacher_id FROM courses WHERE id = $1',
        [row.course_id],
      );
      if (gradeRes.rowCount) {
        const gradeId = gradeRes.rows[0].grade_id as number;
        const teacherId = gradeRes.rows[0].teacher_id as number;
        const group = await ChatService.getOrCreateTeacherGradeGroup(gradeId, teacherId);
        await ChatService.addMember(group.id, studentId, 'student');
      }
    } catch (err) {
      console.warn('Failed to add student to chat group after admin activate-by-code:', err);
    }

    try {
      await pool.query(
        `INSERT INTO notifications (user_id, title, message, type, course_id) VALUES ($1, $2, $3, $4, $5)`,
        [studentId, 'كورس جديد متاح', `تم تفعيل كورس "${row.course_title}" لك`, 'course_opened', row.course_id],
      );
      ExpoPushService.sendPushNotification(studentId, 'كورس جديد متاح', `تم تفعيل كورس "${row.course_title}" لك`, {
        type: 'course_opened',
        course_id: row.course_id,
      }).catch((e) => console.error('Expo push error:', e));
    } catch (_) {
      console.log('Warning: Could not create notification for student');
    }

    return res.status(200).json({
      message: 'تم تفعيل الكورس للطالب بنجاح',
      course: { id: row.course_id, title: row.course_title },
      student: { id: studentId, name: studentCheck.rows[0].name, email: studentCheck.rows[0].email },
    });
  }),
);

// إدارة أكواد التفعيل (أدمن فقط): البحث بكود وإرجاع تفاصيله (كورس، مدرس، مستخدم أم لا، من استخدمه)
router.get(
  '/admin/activation-code/:code',
  authMiddleware(['admin']),
  asyncWrapper(async (req, res) => {
    const code = (req.params.code || '').trim();
    if (!code) {
      return res.status(400).json({ message: 'الكود مطلوب' });
    }

    const codeRow = await pool.query(
      `SELECT 
        tic.id,
        tic.code,
        tic.course_id,
        tic.teacher_id,
        tic.max_uses,
        tic.uses,
        tic.expires_at,
        tic.created_at,
        c.title as course_title,
        u_teacher.name as teacher_name,
        u_teacher.email as teacher_email,
        u_teacher.phone as teacher_phone
       FROM teacher_invite_codes tic
       JOIN courses c ON tic.course_id = c.id
       JOIN users u_teacher ON tic.teacher_id = u_teacher.id
       WHERE tic.code = $1`,
      [code],
    );

    if (!codeRow.rowCount) {
      return res.status(404).json({ message: 'الكود غير موجود' });
    }

    const row = codeRow.rows[0];
    const isUsed = Number(row.uses) >= Number(row.max_uses);
    const isExpired = row.expires_at && new Date(row.expires_at) < new Date();

    const usagesRes = await pool.query(
      `SELECT icu.user_id, icu.used_at, u.name as user_name, u.email as user_email, u.phone as user_phone
       FROM invite_code_usages icu
       JOIN users u ON icu.user_id = u.id
       WHERE icu.code_id = $1
       ORDER BY icu.used_at DESC`,
      [row.id],
    );

    return res.json({
      code: row.code,
      id: row.id,
      course: {
        id: row.course_id,
        title: row.course_title,
      },
      teacher: {
        id: row.teacher_id,
        name: row.teacher_name,
        email: row.teacher_email,
        phone: row.teacher_phone,
      },
      max_uses: Number(row.max_uses),
      uses: Number(row.uses),
      is_used: isUsed,
      is_expired: isExpired,
      expires_at: row.expires_at,
      created_at: row.created_at,
      used_by: usagesRes.rows.map((u) => ({
        user_id: u.user_id,
        name: u.user_name,
        email: u.user_email,
        phone: u.user_phone,
        used_at: u.used_at,
      })),
    });
  }),
);

// تفعيل الكورس للطالب باستخدام كود التفعيل
router.post(
  '/activate',
  authMiddleware(['student']),
  asyncWrapper(async (req, res) => {
    const parse = ActivateCourseSchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ message: 'Validation failed', errors: parse.error.errors });
    }

    const { code, course_id } = parse.data;
    const student_id = req.user!.id;

    const freeCourseCheck = await pool.query(
      `SELECT id, title, COALESCE(is_free, FALSE) AS is_free FROM courses WHERE id = $1`,
      [course_id],
    );
    if (freeCourseCheck.rowCount && freeCourseCheck.rows[0].is_free) {
      return res.status(400).json({
        message: 'هذا الكورس مجاني — المحتوى متاح مباشرة بدون كود تفعيل',
        course: {
          id: freeCourseCheck.rows[0].id,
          title: freeCourseCheck.rows[0].title,
          is_free: true,
        },
      });
    }

    // البحث عن كود التفعيل
    const codeCheck = await pool.query(
      `SELECT 
        tic.id,
        tic.code,
        tic.max_uses,
        tic.uses,
        tic.expires_at,
        tic.course_id,
        c.title as course_title,
        c.teacher_id
       FROM teacher_invite_codes tic
       JOIN courses c ON tic.course_id = c.id
       WHERE tic.code = $1 AND tic.course_id = $2`,
      [code, course_id],
    );

    if (!codeCheck.rowCount) {
      return res.status(404).json({ message: 'Invalid activation code or course' });
    }

    const activationCode = codeCheck.rows[0];

    // تحقق من انتهاء صلاحية الكود
    if (activationCode.expires_at && new Date(activationCode.expires_at) < new Date()) {
      return res.status(400).json({ message: 'Activation code has expired' });
    }

    // تحقق من استنفاذ عدد مرات الاستخدام
    if (activationCode.uses >= activationCode.max_uses) {
      return res.status(400).json({ message: 'Activation code has been fully used' });
    }

    // تحقق من أن الطالب لم يستخدم هذا الكود من قبل
    const usageCheck = await pool.query(
      'SELECT id FROM invite_code_usages WHERE user_id = $1 AND code_id = $2',
      [student_id, activationCode.id],
    );

    if (usageCheck.rowCount !== null && usageCheck.rowCount > 0) {
      return res.status(400).json({ message: 'You have already used this activation code' });
    }

    // تسجيل استخدام الكود
    await pool.query('INSERT INTO invite_code_usages (user_id, code_id) VALUES ($1, $2)', [
      student_id,
      activationCode.id,
    ]);

    // زيادة عدد مرات الاستخدام
    await pool.query('UPDATE teacher_invite_codes SET uses = uses + 1 WHERE id = $1', [
      activationCode.id,
    ]);

    // إضافة الطالب للكورس (enrollment)
    await pool.query(
      'INSERT INTO enrollments (user_id, course_id) VALUES ($1, $2) ON CONFLICT (user_id, course_id) DO NOTHING',
      [student_id, activationCode.course_id],
    );

    // إضافة الطالب تلقائياً لمجموعة دردشة المدرس/الصف المرتبط بالكورس
    try {
      const gradeRes = await pool.query('SELECT grade_id, teacher_id FROM courses WHERE id = $1', [
        activationCode.course_id,
      ]);
      if (gradeRes.rowCount) {
        const gradeId = gradeRes.rows[0].grade_id as number;
        const teacherId = gradeRes.rows[0].teacher_id as number;
        const group = await ChatService.getOrCreateTeacherGradeGroup(gradeId, teacherId);
        await ChatService.addMember(group.id, student_id, 'student');
      }
    } catch (err) {
      console.warn('Failed to add student to chat group after activation:', err);
    }

    NotificationTriggers.onCoursePurchase(
      student_id,
      activationCode.course_title,
      activationCode.course_id,
    ).catch((err) => console.warn('Course purchase notification failed:', err));

    res.status(200).json({
      message: 'Course activated successfully',
      course: {
        id: activationCode.course_id,
        title: activationCode.course_title,
      },
    });
  }),
);

// تفعيل الكورس المجاني للطالب (بدون كود) — عندما سعر الكورس = 0
router.post(
  '/activate-free',
  authMiddleware(['student']),
  asyncWrapper(async (req, res) => {
    const courseId = Number(pickBodyValue(req.body, 'course_id'));
    if (!courseId || Number.isNaN(courseId)) {
      return res.status(400).json({ message: 'معرف الكورس مطلوب (course_id)' });
    }

    const studentId = req.user!.id;

    const courseRow = await pool.query(
      `SELECT id, title, price, grade_id, teacher_id, COALESCE(is_free, FALSE) AS is_free
       FROM courses WHERE id = $1`,
      [courseId],
    );
    if (!courseRow.rowCount) {
      return res.status(404).json({ message: 'الكورس غير موجود' });
    }

    const course = courseRow.rows[0] as {
      id: number;
      title: string;
      price: number | string;
      grade_id: number;
      teacher_id: number;
      is_free: boolean;
    };

    if (course.is_free) {
      return res.status(400).json({
        message: 'هذا الكورس مجاني — المحتوى متاح مباشرة بدون تفعيل',
        course: { id: course.id, title: course.title, is_free: true },
      });
    }

    const price = Number(course.price);
    if (price > 0) {
      return res.status(400).json({
        message: 'هذا الكورس مدفوع. استخدم كود التفعيل لتفعيل الكورس.',
      });
    }

    const existingEnrollment = await pool.query(
      'SELECT id FROM enrollments WHERE user_id = $1 AND course_id = $2',
      [studentId, courseId],
    );
    if (existingEnrollment.rowCount && existingEnrollment.rowCount > 0) {
      return res.status(200).json({
        message: 'أنت مشترك في هذا الكورس بالفعل',
        course: { id: course.id, title: course.title },
      });
    }

    await pool.query(
      'INSERT INTO enrollments (user_id, course_id) VALUES ($1, $2) ON CONFLICT (user_id, course_id) DO NOTHING',
      [studentId, courseId],
    );

    try {
      const group = await ChatService.getOrCreateTeacherGradeGroup(course.grade_id, course.teacher_id);
      await ChatService.addMember(group.id, studentId, 'student');
    } catch (err) {
      console.warn('activate-free: chat group add failed', err);
    }

    try {
      await pool.query(
        `INSERT INTO notifications (user_id, title, message, type, course_id) VALUES ($1, $2, $3, $4, $5)`,
        [studentId, 'كورس جديد متاح', `تم تفعيل كورس "${course.title}" لك`, 'course_opened', courseId],
      );
      ExpoPushService.sendPushNotification(
        studentId,
        'كورس جديد متاح',
        `تم تفعيل كورس "${course.title}" لك`,
        { type: 'course_opened', course_id: courseId },
      ).catch((e) => console.error('Expo push error:', e));
    } catch (_) {
      // ...
    }

    res.status(200).json({
      message: 'تم تفعيل الكورس بنجاح',
      course: { id: course.id, title: course.title },
    });
  }),
);

// مسح QR code وتفعيل الكورس للطالب
router.post(
  '/scan-qr-activate',
  authMiddleware(['student']),
  asyncWrapper(async (req, res) => {
    const { qr_data } = req.body;

    if (!qr_data) {
      return res.status(400).json({
        success: false,
        message: 'QR code data is required',
      });
    }

    const student_id = req.user!.id;

    try {
      // Import QRCodeService
      const { QRCodeService } = await import('../services/QRCodeService.js');

      // Parse QR code data
      const qrCodeData = QRCodeService.parseQRCodeData(qr_data);

      if (!qrCodeData) {
        return res.status(400).json({
          success: false,
          message: 'Invalid QR code format',
        });
      }

      // Validate QR code data
      if (!QRCodeService.validateQRCodeData(qrCodeData)) {
        return res.status(400).json({
          success: false,
          message: 'QR code is expired or invalid',
        });
      }

      const { activation_code, course_id } = qrCodeData;

      // البحث عن كود التفعيل
      const codeCheck = await pool.query(
        `SELECT 
          tic.id,
          tic.code,
          tic.max_uses,
          tic.uses,
          tic.expires_at,
          tic.course_id,
          c.title as course_title,
          c.teacher_id
         FROM teacher_invite_codes tic
         JOIN courses c ON tic.course_id = c.id
         WHERE tic.code = $1 AND tic.course_id = $2`,
        [activation_code, course_id],
      );

      if (!codeCheck.rowCount) {
        return res.status(404).json({
          success: false,
          message: 'Invalid activation code or course',
        });
      }

      const activationCode = codeCheck.rows[0];

      // تحقق من انتهاء صلاحية الكود
      if (activationCode.expires_at && new Date(activationCode.expires_at) < new Date()) {
        return res.status(400).json({
          success: false,
          message: 'Activation code has expired',
        });
      }

      // تحقق من استنفاذ عدد مرات الاستخدام
      if (activationCode.uses >= activationCode.max_uses) {
        return res.status(400).json({
          success: false,
          message: 'Activation code has been fully used',
        });
      }

      // تحقق من أن الطالب لم يستخدم هذا الكود من قبل
      const usageCheck = await pool.query(
        'SELECT id FROM invite_code_usages WHERE user_id = $1 AND code_id = $2',
        [student_id, activationCode.id],
      );

      if (usageCheck.rowCount !== null && usageCheck.rowCount > 0) {
        return res.status(400).json({
          success: false,
          message: 'You have already used this activation code',
        });
      }

      // تسجيل استخدام الكود
      await pool.query(
        'INSERT INTO invite_code_usages (user_id, code_id, used_at) VALUES ($1, $2, NOW())',
        [student_id, activationCode.id],
      );

      // تحديث عدد مرات الاستخدام
      await pool.query('UPDATE teacher_invite_codes SET uses = uses + 1 WHERE id = $1', [
        activationCode.id,
      ]);

      // إضافة الطالب للكورس
      const enrollmentCheck = await pool.query(
        'SELECT id FROM enrollments WHERE user_id = $1 AND course_id = $2',
        [student_id, course_id],
      );

      if (!enrollmentCheck.rowCount) {
        await pool.query(
          'INSERT INTO enrollments (user_id, course_id, enrolled_at) VALUES ($1, $2, NOW())',
          [student_id, course_id],
        );
      }

      res.json({
        success: true,
        message: 'Course activated successfully',
        course: {
          id: course_id,
          title: activationCode.course_title,
          teacher_id: activationCode.teacher_id,
        },
      });
    } catch (error) {
      console.error('Error processing QR code activation:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
      });
    }
  }),
);

// تعديل كورس (مدرس فقط)
router.put(
  '/:id',
  authMiddleware(['teacher']),
  uploadCourseImage.single('avatar'),
  asyncWrapper(async (req, res) => {
    try {
      const courseId = req.params.id;
      const teacher_id = req.user!.id;

      // تحقق أن الكورس يخص المدرس
      const courseCheck = await pool.query(
        'SELECT * FROM courses WHERE id = $1 AND teacher_id = $2',
        [courseId, teacher_id],
      );
      if (!courseCheck.rowCount)
        return res.status(404).json({ message: 'Course not found or not yours' });

      // تحقق من البيانات
      const parse = CourseSchema.partial().safeParse(req.body);
      if (!parse.success) {
        return res.status(400).json({ message: 'Validation failed', errors: parse.error.errors });
      }

      let pricingUpdate: { is_free: boolean; price: number } | null = null;
      if (parse.data.is_free !== undefined || parse.data.price !== undefined) {
        const existing = courseCheck.rows[0];
        try {
          pricingUpdate = resolveCoursePricing({
            price: parse.data.price !== undefined ? parse.data.price : Number(existing.price),
            is_free: parse.data.is_free !== undefined ? parse.data.is_free : existing.is_free,
          });
        } catch {
          return res.status(400).json({
            message: 'الكورس المدفوع يجب أن يكون له سعر أكبر من صفر، أو حدّد is_free=true',
          });
        }
      }

      const fields = [];
      const values = [];
      let i = 1;

      for (const [key, value] of Object.entries(parse.data)) {
        if (value !== undefined && key !== 'price' && key !== 'is_free') {
          fields.push(`${key} = $${i++}`);
          values.push(value);
        }
      }

      if (pricingUpdate) {
        fields.push(`is_free = $${i++}`);
        values.push(pricingUpdate.is_free);
        fields.push(`price = $${i++}`);
        values.push(pricingUpdate.price);
      }

      const file = req.file ?? null;
      const avatar = file ? (await uploadToCloudinary(file.path)).secure_url : null;
      if (avatar) {
        fields.push(`avatar = $${i++}`);
        values.push(avatar);
      }

      if (!fields.length) return res.status(400).json({ message: 'No fields to update' });

      values.push(courseId, teacher_id);

      // محاولة التحديث مع avatar أولاً، ثم بدون avatar إذا فشل
      const result = await pool.query(
        `UPDATE courses SET ${fields.join(', ')} WHERE id = $${i++} AND teacher_id = $${i} RETURNING *`,
        values,
      );

      const course = result.rows[0];

      try {
        await SeoHooks.onCourseChanged(teacher_id, course.id, parse.data.title ?? course.title);
      } catch (seoError) {
        console.error('SEO hook after course update:', seoError);
      }

      res.json({ course });
    } catch (error: any) {
      console.error('Error updating course:', error);

      // حذف الصورة المرفوعة في حالة حدوث خطأ
      if (req.file && fs.existsSync(req.file.path)) {
        try {
          fs.unlinkSync(req.file.path);
        } catch (deleteError) {
          console.error('Error deleting uploaded file:', deleteError);
        }
      }

      // إرجاع رسالة خطأ واضحة
      res.status(500).json({
        message: 'Error updating course',
        error: error.message || 'Unknown error occurred',
      });
    }
  }),
);

// حذف كورس (مدرس فقط)
router.delete(
  '/:id',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const courseId = req.params.id;
    const teacher_id = req.user!.id;
    const result = await pool.query(
      'DELETE FROM courses WHERE id = $1 AND teacher_id = $2 RETURNING *',
      [courseId, teacher_id],
    );
    if (!result.rowCount) return res.status(404).json({ message: 'Course not found or not yours' });

    try {
      await SeoHooks.onCourseDeleted(teacher_id);
    } catch (seoError) {
      console.error('SEO hook after course delete:', seoError);
    }

    res.json({ message: 'Course deleted successfully' });
  }),
);

// عرض كورسات مدرس لطالب (حسب صف الطالب) - محدث ليعرض حالة التفعيل
// GET /api/course/teacher/students - Get all students enrolled in teacher's courses
// يجب أن يكون قبل /teacher/:teacherId لتجنب التداخل
router.get(
  '/teacher/students',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const teacherId = req.user!.id;

    try {
      const students = await TeacherReportsService.getTeacherStudents(teacherId);
      res.json({
        students,
        total: students.length,
      });
    } catch (error: any) {
      if (error.status) {
        return res.status(error.status).json({ message: error.message });
      }
      console.error('Error fetching teacher students:', error);
      res.status(500).json({ message: 'Failed to fetch students' });
    }
  }),
);

// GET /api/course/teacher/students/report-by-name?name=... - تقرير طالب بالاسم (مدرس فقط)
router.get(
  '/teacher/students/report-by-name',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const teacherId = req.user!.id;
    const name = (req.query.name as string) || '';

    if (!name.trim()) {
      return res.status(400).json({ message: 'معامل name مطلوب للبحث عن الطالب' });
    }

    try {
      const result = await TeacherReportsService.getStudentReportByName(teacherId, name.trim());
      if ('report' in result) {
        return res.json(result.report);
      }
      return res.status(200).json({
        matches: result.matches,
        message: result.message,
      });
    } catch (error: any) {
      if (error.status) {
        return res.status(error.status).json({ message: error.message });
      }
      console.error('Error fetching student report by name:', error);
      res.status(500).json({ message: 'فشل جلب التقرير' });
    }
  }),
);

// GET /api/course/teacher/students/:studentId/report - Get detailed report for a student
// يجب أن يكون قبل /teacher/:teacherId لتجنب التداخل
router.get(
  '/teacher/students/:studentId/report',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const teacherId = req.user!.id;
    const studentId = Number(req.params.studentId);

    if (Number.isNaN(studentId)) {
      return res.status(400).json({ message: 'Invalid student ID' });
    }

    try {
      const report = await TeacherReportsService.getStudentDetailedReport(teacherId, studentId);
      res.json(report);
    } catch (error: any) {
      if (error.status) {
        return res.status(error.status).json({ message: error.message });
      }
      console.error('Error fetching student report:', error);
      res.status(500).json({ message: 'Failed to fetch student report' });
    }
  }),
);

router.get(
  '/teacher/:teacherId',
  authMiddleware(['student']),
  asyncWrapper(async (req, res) => {
    const teacherId = Number(req.params.teacherId);
    const studentId = req.user!.id;

    // احصل على الصفوف الدراسية للطالب
    const gradesRes = await pool.query('SELECT grade_id FROM user_grades WHERE user_id = $1', [
      studentId,
    ]);
    const gradeIds = gradesRes.rows.map((row) => row.grade_id);

    if (!gradeIds.length) {
      return res.status(400).json({ message: 'Student has no grade' });
    }

    // جلب الكورسات المرئية للمدرس حسب صفوف الطالب مع حالة التفعيل
    const coursesRes = await pool.query(
      `SELECT 
        c.id,
        c.title,
        c.price,
        c.description,
        c.grade_id,
        c.avatar,
        c.created_at,
        COALESCE(c.is_free, FALSE) AS is_free,
        CASE WHEN e.user_id IS NOT NULL THEN true ELSE false END as is_activated
       FROM courses c
       LEFT JOIN enrollments e ON c.id = e.course_id AND e.user_id = $1
       WHERE c.teacher_id = $2 AND c.grade_id = ANY($3::int[]) AND c.is_visible = true
       ORDER BY c.created_at DESC`,
      [studentId, teacherId, gradeIds],
    );

    res.json({
      courses: coursesRes.rows.map((row) => ({
        id: row.id,
        title: row.title,
        price: row.price,
        description: row.description,
        grade_id: row.grade_id,
        avatar: row.avatar,
        created_at: row.created_at,
        is_free: row.is_free === true,
        is_activated: row.is_activated || row.is_free === true,
      })),
    });
  }),
);

// عرض كل كورسات المدرس مع إمكانية الفلترة حسب الصف (grade_id فقط)
router.get(
  '/my-courses',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const teacher_id = req.user!.id;
    const grade_id_raw = req.query.grade_id;
    let query = 'SELECT *, is_visible FROM courses WHERE teacher_id = $1';
    const values: any[] = [teacher_id];
    if (grade_id_raw !== undefined && grade_id_raw !== null && grade_id_raw !== '') {
      const grade_id = Number(grade_id_raw);
      if (isNaN(grade_id)) {
        return res.status(400).json({ message: 'grade_id must be a number' });
      }
      query += ' AND grade_id = $2';
      values.push(grade_id);
    }
    const result = await pool.query(query, values);

    // Debug: طباعة البيانات الخام
    console.log('DEBUG my-courses raw data:', result.rows);

    const courses = result.rows.map((row) => {
      console.log(`DEBUG course ${row.id} avatar:`, row.avatar);
      return {
        id: row.id,
        title: row.title,
        price: row.price,
        description: row.description,
        grade_id: row.grade_id,
        avatar: row.avatar,
        created_at: row.created_at,
        is_visible: row.is_visible,
      };
    });

    console.log('DEBUG final courses:', courses);
    res.json({ courses });
  }),
);

// عرض الكورسات المفعلة للطالب
// router.get(
//   '/my-activated-courses',
//   authMiddleware(['student']),
//   asyncWrapper(async (req, res) => {
//     const studentId = req.user!.id;
//     const result = await pool.query(
//       `SELECT c.id, c.title, c.price, c.description, c.grade_id, c.teacher_id, c.created_at
//        FROM enrollments e
//        JOIN courses c ON e.course_id = c.id
//        WHERE e.user_id = $1
//        ORDER BY c.created_at DESC`,
//       [studentId]
//     );
//     res.json({
//       courses: result.rows.map(row => ({
//         id: row.id,
//         title: row.title,
//         price: row.price,
//         description: row.description,
//         grade_id: row.grade_id,
//         teacher_id: row.teacher_id,
//         created_at: row.created_at
//       }))
//     });
//   })
// );

// عرض كل الكورسات والباقات المشترك فيها الطالب
router.get(
  '/my-enrollments',
  authMiddleware(['student']),
  asyncWrapper(async (req, res) => {
    try {
      const studentId = req.user!.id;

      // جلب الكورسات المشترك فيها الطالب
      const coursesResult = await pool.query(
        `SELECT c.id, c.title, c.price, c.description, c.teacher_id, c.avatar, c.created_at, c.grade_id
         FROM enrollments e
         JOIN courses c ON e.course_id = c.id
         WHERE e.user_id = $1 AND c.is_visible = true
         ORDER BY c.created_at DESC`,
        [studentId],
      );

      // جلب الكورسات العامة المشترك فيها الطالب
      const generalCoursesResult = await pool.query(
        `SELECT gc.id, gc.title, gc.price, gc.description, gc.image, gc.category, gc.created_at,
                gce.enrolled_at, gce.enrollment_type
         FROM general_course_enrollments gce
         JOIN general_courses gc ON gce.general_course_id = gc.id
         WHERE gce.student_id = $1
         ORDER BY gce.enrolled_at DESC`,
        [studentId],
      );

      // جلب الباقات المشترك فيها الطالب
      const packagesResult = await pool.query(
        `SELECT p.id, p.name as title, p.price, p.image as avatar, p.grade_id, p.created_at
         FROM package_activations pa
         JOIN packages p ON pa.package_id = p.id
         WHERE pa.student_id = $1 AND pa.is_active = true
         ORDER BY pa.activated_at DESC`,
        [studentId],
      );

      // دمج الكورسات والباقات والكورسات العامة
      const items = [
        ...coursesResult.rows.map((row) => ({
          id: row.id,
          title: row.title,
          price: row.price,
          description: row.description,
          teacher_id: row.teacher_id,
          avatar: row.avatar,
          grade_id: row.grade_id,
          created_at: row.created_at,
          type: 'course' as const,
        })),
        ...generalCoursesResult.rows.map((row) => ({
          id: row.id,
          title: row.title,
          price: row.price,
          description: row.description,
          teacher_id: null, // الكورسات العامة ليس لها teacher_id مباشر في هذا السياق
          avatar: row.image, // استخدام image بدلاً من avatar
          grade_id: null, // الكورسات العامة غير مرتبطة بصف
          category: row.category,
          created_at: row.created_at,
          enrolled_at: row.enrolled_at,
          enrollment_type: row.enrollment_type,
          type: 'general_course' as const,
        })),
        ...packagesResult.rows.map((row) => ({
          id: row.id,
          title: row.title,
          price: row.price,
          description: null, // الباقات لا تحتوي على description
          avatar: row.avatar,
          grade_id: row.grade_id,
          created_at: row.created_at,
          type: 'package' as const,
        })),
      ];

      // ترتيب حسب تاريخ الإنشاء (الأحدث أولاً)
      // ملاحظة: للكورسات العامة نستخدم enrolled_at كمعيار أحدث اشتراك إذا أردت، لكن هنا سنبقي created_at لتوحيد المعيار
      items.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      res.json({
        items,
        courses_count: coursesResult.rows.length,
        general_courses_count: generalCoursesResult.rows.length,
        packages_count: packagesResult.rows.length,
        total: items.length,
      });
    } catch (err) {
      console.error('تفاصيل الخطأ في my-enrollments:', err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      return res.status(500).json({ message: 'Internal error', error: errorMessage });
    }
  }),
);

// إضافة محاضرة جديدة لكورس (للأستاذ فقط)
const LectureSchema = z.object({
  title: z.string().min(2),
  description: z.string().optional(),
  position: z.number().optional(),
});

router.post(
  '/:courseId/lectures',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const courseId = Number(req.params.courseId);
    const teacherId = req.user!.id;
    const parse = LectureSchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ message: 'Validation failed', errors: parse.error.errors });
    }
    // تحقق أن الكورس يخص المدرس
    const courseCheck = await pool.query(
      'SELECT id, title FROM courses WHERE id = $1 AND teacher_id = $2',
      [courseId, teacherId],
    );
    if (!courseCheck.rowCount) {
      return res.status(404).json({ message: 'Course not found or not yours' });
    }
    const { title, description, position } = parse.data;
    // احسب position تلقائياً إذا لم يُرسل
    let pos = position;
    if (!pos) {
      const posRes = await pool.query(
        'SELECT COALESCE(MAX(position), 0) + 1 AS next_pos FROM lectures WHERE course_id = $1',
        [courseId],
      );
      pos = posRes.rows[0].next_pos;
    }
    const result = await pool.query(
      `INSERT INTO lectures (course_id, title, description, position, is_visible) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [courseId, title, description, pos, true], // Default to visible
    );

    // إرسال إشعار للطلاب المشتركين في الكورس فقط إذا كانت المحاضرة ظاهرة
    const courseTitle = courseCheck.rows[0].title;
    const lecture = result.rows[0];
    if (lecture.is_visible !== false) {
      await NotificationService.notifyLectureAdded(courseId, lecture.id, title, courseTitle);
    }

    res.status(201).json({ lecture: result.rows[0] });
  }),
);

// إضافة فيديو لمحاضرة (للأستاذ فقط)
const LectureVideoSchema = z.object({
  video_url: z.string().url(),
  title: z.string().optional(),
  position: z.number().optional(),
});

router.post(
  '/lecture/:lectureId/videos',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const lectureId = Number(req.params.lectureId);
    const teacherId = req.user!.id;
    const parse = LectureVideoSchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ message: 'Validation failed', errors: parse.error.errors });
    }
    // تحقق أن المحاضرة تخص كورس يملكه المدرس
    const lectureCheck = await pool.query(
      `SELECT l.id, l.title as lecture_title, c.id as course_id, c.title as course_title 
       FROM lectures l JOIN courses c ON l.course_id = c.id WHERE l.id = $1 AND c.teacher_id = $2`,
      [lectureId, teacherId],
    );
    if (!lectureCheck.rowCount) {
      return res.status(404).json({ message: 'Lecture not found or not yours' });
    }
    const { video_url, title, position } = parse.data;
    // احسب position تلقائياً إذا لم يُرسل
    let pos = position;
    if (!pos) {
      const posRes = await pool.query(
        'SELECT COALESCE(MAX(position), 0) + 1 AS next_pos FROM lecture_videos WHERE lecture_id = $1',
        [lectureId],
      );
      pos = posRes.rows[0].next_pos;
    }
    const result = await pool.query(
      `INSERT INTO lecture_videos (lecture_id, video_url, title, position) VALUES ($1, $2, $3, $4) RETURNING *`,
      [lectureId, video_url, title, pos],
    );

    // إرسال إشعار للطلاب المشتركين في الكورس
    const lectureData = lectureCheck.rows[0];
    const videoTitle = title || 'فيديو جديد';
    await NotificationService.notifyVideoAdded(
      lectureData.course_id,
      lectureId,
      videoTitle,
      lectureData.lecture_title,
      lectureData.course_title,
    );

    res.status(201).json({ video: result.rows[0] });
  }),
);

// تحديث فيديو محاضرة (للأستاذ فقط)
router.put(
  '/lecture-video/:videoId',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const videoId = Number(req.params.videoId);
    const teacherId = req.user!.id;
    const parse = LectureVideoSchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ message: 'Validation failed', errors: parse.error.errors });
    }

    // تحقق أن الفيديو يخص محاضرة في كورس يملكه المدرس
    const videoCheck = await pool.query(
      `SELECT lv.id, lv.title as video_title, l.id as lecture_id, l.title as lecture_title, c.id as course_id, c.title as course_title 
       FROM lecture_videos lv 
       JOIN lectures l ON lv.lecture_id = l.id 
       JOIN courses c ON l.course_id = c.id 
       WHERE lv.id = $1 AND c.teacher_id = $2`,
      [videoId, teacherId],
    );
    if (!videoCheck.rowCount) {
      return res.status(404).json({ message: 'Video not found or not yours' });
    }

    const { video_url, title, position } = parse.data;
    const updateFields = [];
    const values = [];
    let i = 1;

    if (video_url !== undefined) {
      updateFields.push(`video_url = $${i++}`);
      values.push(video_url);
    }
    if (title !== undefined) {
      updateFields.push(`title = $${i++}`);
      values.push(title);
    }
    if (position !== undefined) {
      updateFields.push(`position = $${i++}`);
      values.push(position);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({ message: 'No fields to update' });
    }

    values.push(videoId);
    const result = await pool.query(
      `UPDATE lecture_videos SET ${updateFields.join(', ')} WHERE id = $${i} RETURNING *`,
      values,
    );

    res.json({ video: result.rows[0] });
  }),
);

// حذف فيديو محاضرة (للأستاذ فقط)
router.delete(
  '/lecture-video/:videoId',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const videoId = Number(req.params.videoId);
    const teacherId = req.user!.id;

    // تحقق أن الفيديو يخص محاضرة في كورس يملكه المدرس
    const videoCheck = await pool.query(
      `SELECT lv.id, lv.title as video_title, l.id as lecture_id, l.title as lecture_title, c.id as course_id, c.title as course_title 
       FROM lecture_videos lv 
       JOIN lectures l ON lv.lecture_id = l.id 
       JOIN courses c ON l.course_id = c.id 
       WHERE lv.id = $1 AND c.teacher_id = $2`,
      [videoId, teacherId],
    );
    if (!videoCheck.rowCount) {
      return res.status(404).json({ message: 'Video not found or not yours' });
    }

    await pool.query('DELETE FROM lecture_videos WHERE id = $1', [videoId]);

    res.json({ message: 'Lecture video deleted successfully' });
  }),
);

// إضافة ملف PDF لمحاضرة (للأستاذ فقط)
const LectureFileSchema = z.object({
  file_url: z.string().url(),
  filename: z.string(),
});

router.post(
  '/lecture/:lectureId/files',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const lectureId = Number(req.params.lectureId);
    const teacherId = req.user!.id;
    const parse = LectureFileSchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ message: 'Validation failed', errors: parse.error.errors });
    }
    // تحقق أن المحاضرة تخص كورس يملكه المدرس
    const lectureCheck = await pool.query(
      `SELECT l.id, l.title as lecture_title, c.id as course_id, c.title as course_title 
       FROM lectures l JOIN courses c ON l.course_id = c.id WHERE l.id = $1 AND c.teacher_id = $2`,
      [lectureId, teacherId],
    );
    if (!lectureCheck.rowCount) {
      return res.status(404).json({ message: 'Lecture not found or not yours' });
    }
    const { file_url, filename } = parse.data;
    const result = await pool.query(
      `INSERT INTO lecture_files (lecture_id, file_url, filename) VALUES ($1, $2, $3) RETURNING *`,
      [lectureId, file_url, filename],
    );

    // إرسال إشعار للطلاب المشتركين في الكورس
    const lectureData = lectureCheck.rows[0];
    await NotificationService.notifyFileAdded(
      lectureData.course_id,
      lectureId,
      filename,
      lectureData.lecture_title,
      lectureData.course_title,
    );

    res.status(201).json({ file: result.rows[0] });
  }),
);

// تغيير حالة ظهور الكورس (إظهار/إخفاء للطلاب)
router.patch(
  '/:courseId/visibility',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const courseId = Number(req.params.courseId);
    const { is_visible } = req.body;

    if (typeof is_visible !== 'boolean') {
      return res.status(400).json({ message: 'is_visible (boolean) is required' });
    }

    // تحقق أن الكورس يخص المدرس
    const courseCheck = await pool.query(
      'SELECT id, title FROM courses WHERE id = $1 AND teacher_id = $2',
      [courseId, req.user!.id],
    );

    if (!courseCheck.rowCount) {
      return res.status(404).json({ message: 'Course not found or not yours' });
    }

    try {
      // محاولة تحديث العمود is_visible
      const result = await pool.query(
        'UPDATE courses SET is_visible = $1 WHERE id = $2 RETURNING id, title, is_visible, updated_at',
        [is_visible, courseId],
      );

      res.json({
        message: is_visible ? 'تم إظهار الكورس للطلاب' : 'تم إخفاء الكورس عن الطلاب',
        course: result.rows[0],
      });
    } catch (error: any) {
      // إذا لم يكن العمود موجود، قم بإنشائه أولاً
      if (error.message && error.message.includes('column "is_visible" does not exist')) {
        console.log('عمود is_visible غير موجود، جاري إنشاؤه...');

        try {
          // إضافة العمود
          await pool.query('ALTER TABLE courses ADD COLUMN is_visible BOOLEAN DEFAULT TRUE');

          // تحديث الكورس المحدد
          const result = await pool.query(
            'UPDATE courses SET is_visible = $1 WHERE id = $2 RETURNING id, title, is_visible, updated_at',
            [is_visible, courseId],
          );

          res.json({
            message: is_visible ? 'تم إظهار الكورس للطلاب' : 'تم إخفاء الكورس عن الطلاب',
            course: result.rows[0],
            note: 'تم إنشاء عمود is_visible تلقائياً',
          });
        } catch (createError: any) {
          console.error('خطأ في إنشاء العمود:', createError);
          res.status(500).json({
            message: 'خطأ في تحديث حالة الكورس',
            error: 'فشل في إنشاء عمود is_visible',
          });
        }
      } else {
        // خطأ آخر
        console.error('خطأ في تحديث الكورس:', error);
        res.status(500).json({
          message: 'خطأ في تحديث حالة الكورس',
          error: error.message || 'خطأ غير معروف',
        });
      }
    }
  }),
);

// تفاصيل كورس مع المحاضرات والفيديوهات والملفات (للأستاذ أو الطالب المشترك فقط)
router.get(
  '/:courseId/details',
  authMiddleware(),
  asyncWrapper(async (req, res) => {
    const courseId = Number(req.params.courseId);
    const user = req.user!;

    // استخدام helper function للتحقق من الصلاحية (يدعم جميع أنواع الكورسات)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { canAccessCourseContent } = require('../utils/courseAccess');

    // للطلاب: تحقق مفصل مع رسالة عند الحظر
    if (user.role === 'student') {
      const accessCheck = await CourseAccessService.checkStudentAccess(user.id, courseId);
      if (!accessCheck.hasAccess) {
        return res.status(403).json({
          access: false,
          message: accessCheck.message || 'تم حجب المحتوي لحين تجديد الاشتراك',
        });
      }
    } else {
      // للمعلمين والأدمن: استخدم canAccessCourseContent لضمان الصلاحيات
      const isAllowed = await canAccessCourseContent(courseId, user.id, user.role);
      if (!isAllowed) {
        return res.status(403).json({ message: 'Not allowed to view this course' });
      }
    }

    // جلب معلومات الكورس (يدعم جميع الأنواع)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { CourseContentService } = require('../services/courseContent');
    const courseInfo = await CourseContentService.getCourseInfo(courseId);

    if (!courseInfo) {
      return res.status(404).json({ message: 'Course not found' });
    }

    const course = courseInfo.course;
    // جلب المحاضرات (يدعم lectures و course_lectures)
    let lectures: any[] = [];

    if (courseInfo.type === 'regular') {
      // للكورسات العادية، استخدم جدول lectures
      const lecturesRes = await pool.query(
        `SELECT * FROM lectures WHERE course_id = $1 ORDER BY position, created_at`,
        [courseId],
      );
      lectures = lecturesRes.rows;
    } else {
      // للكورسات في المواد الدراسية، استخدم جدول course_lectures
      const lecturesRes = await pool.query(
        `SELECT * FROM course_lectures WHERE course_id = $1 ORDER BY order_index, created_at`,
        [courseId],
      );
      lectures = lecturesRes.rows;
    }
    // جلب الفيديوهات والملفات لكل محاضرة
    const lectureIds = lectures.map((l) => l.id);
    let videos = [],
      files = [];
    if (lectureIds.length) {
      const videosRes = await pool.query(
        `SELECT * FROM lecture_videos WHERE lecture_id = ANY($1::int[]) ORDER BY position, id`,
        [lectureIds],
      );
      videos = videosRes.rows;
      const filesRes = await pool.query(
        `SELECT * FROM lecture_files WHERE lecture_id = ANY($1::int[]) ORDER BY uploaded_at, id`,
        [lectureIds],
      );
      files = filesRes.rows;
    }
    // جلب الامتحانات لكل محاضرة
    let exams = [];
    if (lectureIds.length) {
      const examsRes = await pool.query(
        `SELECT * FROM exams WHERE lecture_id = ANY($1::int[]) AND type = 'exam'`,
        [lectureIds],
      );
      exams = examsRes.rows;
    }
    // ربط الفيديوهات والملفات والامتحان بكل محاضرة
    if (user.role === 'student') {
      lectures = lectures.filter((l) => l.is_visible !== false);
      lectures = lectures.sort((a, b) => a.position - b.position || a.created_at - b.created_at);

      const isFreeCourse = course.is_free === true;

      if (isFreeCourse) {
        lectures = lectures.map((lec) => {
          const exam =
            exams.find((e) => e.lecture_id === lec.id && e.is_visible === true) || null;
          return {
            ...lec,
            videos: videos.filter((v) => v.lecture_id === lec.id),
            files: files.filter((f) => f.lecture_id === lec.id),
            exam,
            locked: false,
            is_visible: lec.is_visible,
          };
        });
      } else {
      let lockAll = false;
      for (let i = 0; i < lectures.length; i++) {
        const lec = lectures[i];
        const exam =
          exams.find(
            (e) => e.lecture_id === lec.id && (user!.role === 'teacher' || e.is_visible === true),
          ) || null;
        // المحاضرة الأولى دائماً مفتوحة
        if (i === 0) {
          lectures[i] = {
            ...lec,
            videos: videos.filter((v) => v.lecture_id === lec.id),
            files: files.filter((f) => f.lecture_id === lec.id),
            exam,
            locked: false,
            is_visible: lec.is_visible,
          };
          continue;
        }
        if (lockAll) {
          lectures[i] = {
            ...lec,
            videos: videos.filter((v) => v.lecture_id === lec.id),
            files: files.filter((f) => f.lecture_id === lec.id),
            exam,
            locked: true,
            is_visible: lec.is_visible,
          };
          continue;
        }
        // استخدام المنطق الجديد للتحقق من إمكانية الوصول للمحاضرة
        try {
          const canAccess = await LectureExamService.canStudentAccessLecture(lec.id, user.id);
          if (!canAccess) {
            lockAll = true;
            lectures[i] = {
              ...lec,
              videos: videos.filter((v) => v.lecture_id === lec.id),
              files: files.filter((f) => f.lecture_id === lec.id),
              exam,
              locked: true,
              is_visible: lec.is_visible,
            };
            continue;
          }
        } catch (_err) {
          // في حالة الخطأ، نعتبر المحاضرة مفتوحة
          console.log('Error checking lecture access:', _err);
        }
        lectures[i] = {
          ...lec,
          videos: videos.filter((v) => v.lecture_id === lec.id),
          files: files.filter((f) => f.lecture_id === lec.id),
          exam,
          locked: false,
          is_visible: lec.is_visible,
        };
      }
      }
    } else {
      // المدرس يرى كل المحاضرات (لا فلترة)
      lectures = lectures.map((lec) => {
        const exam = exams.find((e) => e.lecture_id === lec.id) || null;
        return {
          ...lec,
          videos: videos.filter((v) => v.lecture_id === lec.id),
          files: files.filter((f) => f.lecture_id === lec.id),
          exam,
          locked: false,
          is_visible: lec.is_visible, // إرجاع حالة الظهور دائماً
        };
      });
    }

    if (user.role === 'student' && lectureIds.length > 0) {
      const studentId = user.id;
      const visibleExamIds = lectures
        .map((lec) => lec.exam?.id)
        .filter((id): id is number => id != null);

      const [videoViewsRes, examSubsRes] = await Promise.all([
        pool.query(
          `SELECT video_id, lecture_id, viewed_at, is_completed
           FROM video_views
           WHERE user_id = $1 AND course_id = $2`,
          [studentId, courseId],
        ),
        visibleExamIds.length
          ? pool.query(
              `SELECT exam_id, total_grade, passed, submitted_at, status
               FROM exam_submissions
               WHERE student_id = $1 AND exam_id = ANY($2::int[])`,
              [studentId, visibleExamIds],
            )
          : Promise.resolve({ rows: [] as any[] }),
      ]);

      const viewsByVideoId = new Map(
        videoViewsRes.rows.map((row) => [row.video_id, row]),
      );
      const subsByExamId = new Map(
        examSubsRes.rows.map((row) => [row.exam_id, row]),
      );

      lectures = lectures.map((lec) => {
        const lecVideos = (lec.videos || []).map((video: any) => {
          const view = viewsByVideoId.get(video.id);
          return {
            ...video,
            is_watched: !!view,
            is_completed: view?.is_completed ?? false,
            viewed_at: view?.viewed_at ?? null,
          };
        });

        let examWithProgress = lec.exam;
        if (lec.exam) {
          const submission = subsByExamId.get(lec.exam.id);
          const submissionStatus = submission?.status ?? null;
          const isSubmitted =
            !!submission &&
            (submission.submitted_at != null ||
              ['submitted', 'late', 'expired'].includes(submissionStatus ?? ''));

          examWithProgress = {
            ...lec.exam,
            is_solved: isSubmitted,
            is_started: !!submission,
            in_progress: submissionStatus === 'in_progress',
            student_submission: submission
              ? {
                  total_grade: submission.total_grade,
                  passed: submission.passed,
                  submitted_at: submission.submitted_at,
                  status: submissionStatus,
                }
              : null,
          };
        }

        const watchedCount = lecVideos.filter((v: { is_watched: boolean }) => v.is_watched).length;

        return {
          ...lec,
          videos: lecVideos,
          exam: examWithProgress,
          progress: {
            watched_videos: watchedCount,
            total_videos: lecVideos.length,
            all_videos_watched:
              lecVideos.length > 0 && watchedCount === lecVideos.length,
            exam_solved: examWithProgress?.is_solved ?? false,
          },
        };
      });
    }

    res.json({
      course: {
        id: course.id,
        title: course.title,
        description: course.description,
        price: course.price,
        is_free: course.is_free === true,
        teacher_id: course.teacher_id,
        avatar: course.avatar,
        created_at: course.created_at,
      },
      lectures,
    });
  }),
);

// جلب امتحانات الكورس (course-level exams) - للمدرس صاحب الكورس فقط
router.get(
  '/:courseId/course-exams',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const courseId = Number(req.params.courseId);
    if (Number.isNaN(courseId)) {
      return res.status(400).json({ message: 'Invalid course id' });
    }

    const exams = await CourseLevelExamsService.getExamsByCourse(courseId, req.user!);
    res.json({ exams });
  }),
);

// جلب أسئلة امتحان الكورس - للمدرس صاحب الكورس فقط
router.get(
  '/course-exam/:examId/questions',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const examId = Number(req.params.examId);
    if (Number.isNaN(examId)) {
      return res.status(400).json({ message: 'Invalid exam id' });
    }

    try {
      // Get exam with course info
      const examRes = await pool.query(
        `SELECT e.*, c.id as course_id, c.teacher_id
         FROM course_level_exams e
         JOIN courses c ON e.course_id = c.id
         WHERE e.id = $1`,
        [examId],
      );

      if (!examRes.rowCount) {
        return res.status(404).json({ message: 'Exam not found' });
      }

      const exam = examRes.rows[0];

      // Verify teacher owns the course
      if (req.user!.role === 'teacher' && exam.teacher_id !== req.user!.id) {
        return res
          .status(403)
          .json({ message: 'You are not allowed to view questions for this exam' });
      }

      // Get questions (with correct answers for teacher)
      // Use explicit integer casting to ensure type matching
      console.log(`[GET /course-exam/:examId/questions] Fetching questions for exam ${examId} (type: ${typeof examId})`);

      const questionsRes = await pool.query(
        `SELECT id, type, question_text, question_image, option_a, option_b, option_c, option_d, correct_answer, exam_id
         FROM course_level_exam_questions
         WHERE exam_id = $1::integer
         ORDER BY id ASC`,
        [examId],
      );

      console.log(`[GET /course-exam/:examId/questions] Found ${questionsRes.rowCount} questions for exam ${examId}`);

      // Debug: Check if there are questions with different exam_id
      if (questionsRes.rowCount === 0) {
        const debugRes = await pool.query(
          `SELECT COUNT(*) as count FROM course_level_exam_questions WHERE exam_id = $1`,
          [examId],
        );
        const dbCount = parseInt(debugRes.rows[0]?.count || '0', 10);
        console.log(`[GET /course-exam/:examId/questions] DB count for exam ${examId}: ${dbCount}`);

        if (dbCount > 0) {
          // Get sample to see what's wrong
          const sampleRes = await pool.query(
            `SELECT id, exam_id FROM course_level_exam_questions WHERE exam_id = $1 LIMIT 1`,
            [examId],
          );
          console.log(`[GET /course-exam/:examId/questions] Sample question:`, sampleRes.rows[0]);
        }
      }

      // Prevent caching to ensure fresh data
      res.set({
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      });

      res.json({
        exam: {
          id: exam.id,
          title: exam.title,
          durationMinutes: exam.duration_minutes,
          questionsCount: exam.questions_count,
        },
        questions: questionsRes.rows.map((q) => ({
          id: q.id,
          type: q.type,
          questionText: q.question_text,
          questionImage: q.question_image,
          optionA: q.option_a,
          optionB: q.option_b,
          optionC: q.option_c,
          optionD: q.option_d,
          correctAnswer: q.correct_answer,
          examId: q.exam_id,
          questionId: q.question_id,
          questionIdV2: q.question_id_v2,
        })),
      });
    } catch (error: any) {
      console.error('Error fetching exam questions:', error);
      res.status(500).json({ message: 'Failed to fetch exam questions' });
    }
  }),
);

// حذف سؤال من امتحان الكورس الشامل
router.delete(
  '/course-exam/question/:questionId',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const questionId = Number(req.params.questionId);
    if (Number.isNaN(questionId)) {
      return res.status(400).json({ message: 'Invalid question id' });
    }

    try {
      // التحقق من نوع السؤال - قد يكون في course_level_exam_questions أو course_exam_questions
      // أولاً: التحقق من course_level_exam_questions (بمعرّف الصف أو معرّف البنك)
      let questionCheck = await pool.query(
        `SELECT q.id as row_id, e.id as exam_id, c.teacher_id, 'course_level' as exam_type
         FROM course_level_exam_questions q
         JOIN course_level_exams e ON q.exam_id = e.id
         JOIN courses c ON e.course_id = c.id
         WHERE q.id = $1`,
        [questionId],
      );

      // إن لم يُوجَد بمعرّف الصف، جرّب معرّف البنك (سؤال مُضاف من بنك الأسئلة)
      if (!questionCheck.rowCount) {
        // التأكد من وجود أعمدة ربط البنك (إن لم تُشغّل الـ migration مسبقاً)
        try {
          await pool.query(
            `ALTER TABLE course_level_exam_questions
             ADD COLUMN IF NOT EXISTS question_id_v2 INTEGER NULL REFERENCES questions_v2(id) ON DELETE SET NULL`,
          );
          await pool.query(
            `ALTER TABLE course_level_exam_questions
             ADD COLUMN IF NOT EXISTS question_id INTEGER NULL REFERENCES questions(id) ON DELETE SET NULL`,
          );
        } catch {
          // تجاهل إن فشل (الجدول أو الـ ref قد يختلف)
        }
        const byBankId = await pool.query(
          `SELECT q.id as row_id, e.id as exam_id, c.teacher_id, 'course_level' as exam_type
           FROM course_level_exam_questions q
           JOIN course_level_exams e ON q.exam_id = e.id
           JOIN courses c ON e.course_id = c.id
           WHERE q.question_id_v2 = $1 OR q.question_id = $1`,
          [questionId],
        );
        if (byBankId.rowCount) questionCheck = byBankId;

        // إن لم يُوجَد (الأسئلة القديمة قد تكون question_id_v2 = NULL): ابحث بمطابقة المحتوى من البنك
        if (!questionCheck.rowCount) {
          let matchImage: string | null = null;
          let matchText: string | null = null;
          let fromV2 = false;
          const v2Row = await pool.query(
            `SELECT q.question_text, qm.media_url
             FROM questions_v2 q
             LEFT JOIN question_media qm ON q.id = qm.question_id
             WHERE q.id = $1`,
            [questionId],
          );
          if (v2Row.rowCount) {
            matchImage = v2Row.rows[0].media_url || null;
            matchText = v2Row.rows[0].question_text || null;
            fromV2 = true;
          } else {
            const v1Row = await pool.query(
              `SELECT text as question_text, image FROM questions WHERE id = $1`,
              [questionId],
            );
            if (v1Row.rowCount) {
              matchText = v1Row.rows[0].question_text || null;
              matchImage = v1Row.rows[0].image || null;
            }
          }
          if (matchImage != null || matchText != null) {
            const byContent = await pool.query(
              `SELECT q.id as row_id, e.id as exam_id, c.teacher_id, 'course_level' as exam_type
               FROM course_level_exam_questions q
               JOIN course_level_exams e ON q.exam_id = e.id
               JOIN courses c ON e.course_id = c.id
               WHERE c.teacher_id = $1
                 AND (q.question_id_v2 IS NULL OR q.question_id_v2 <> $2)
                 AND (q.question_id IS NULL OR q.question_id <> $2)
                 AND (
                   ($3::text IS NOT NULL AND q.question_image = $3)
                   OR ($4::text IS NOT NULL AND q.question_text = $4)
                 )`,
              [req.user!.id, questionId, matchImage, matchText],
            );
            if (byContent.rowCount === 1) {
              questionCheck = byContent;
              const rowId = byContent.rows[0].row_id;
              if (fromV2) {
                await pool.query(
                  `UPDATE course_level_exam_questions SET question_id_v2 = $1 WHERE id = $2`,
                  [questionId, rowId],
                ).catch(() => { });
              } else {
                await pool.query(
                  `UPDATE course_level_exam_questions SET question_id = $1 WHERE id = $2`,
                  [questionId, rowId],
                ).catch(() => { });
              }
            }
          }
        }
      }

      // إذا لم يوجد، جرب course_exam_questions (النظام القديم)
      if (!questionCheck.rowCount) {
        questionCheck = await pool.query(
          `SELECT ceq.id as row_id, ce.id as exam_id, c.teacher_id, 'course_exam' as exam_type
           FROM questions q
           JOIN course_exam_questions ceq ON q.id = ceq.question_id
           JOIN course_exams ce ON ceq.course_exam_id = ce.id
           JOIN courses c ON ce.course_id = c.id
           WHERE q.id = $1`,
          [questionId],
        );
      }

      // إذا لم يوجد في امتحان الكورس: احتمال أن الطلب من واجهة امتحان المحاضرة (معرّف = exam_questions.id)
      if (!questionCheck.rowCount) {
        const lectureExamCheck = await pool.query(
          `SELECT eq.id as row_id, e.id as exam_id, c.teacher_id
           FROM exam_questions eq
           JOIN exams e ON eq.exam_id = e.id
           JOIN lectures l ON e.lecture_id = l.id
           JOIN courses c ON l.course_id = c.id
           WHERE eq.id = $1 AND c.teacher_id = $2`,
          [questionId, req.user!.id],
        );
        if (lectureExamCheck.rowCount) {
          await pool.query('DELETE FROM exam_questions WHERE id = $1', [questionId]);
          return res.json({ message: 'تم حذف السؤال بنجاح' });
        }
      }

      if (!questionCheck.rowCount) {
        return res.status(404).json({ message: 'Question not found' });
      }

      const question = questionCheck.rows[0];
      const idToDelete = question.row_id;

      // التحقق من أن المدرس يملك الكورس
      if (question.teacher_id !== req.user!.id) {
        return res.status(403).json({ message: 'You are not allowed to delete this question' });
      }

      // حذف السؤال حسب نوعه
      if (question.exam_type === 'course_level') {
        // حذف من course_level_exam_questions (بمعرّف الصف الفعلي)
        await pool.query('DELETE FROM course_level_exam_questions WHERE id = $1', [idToDelete]);
        return res.json({ message: 'تم حذف السؤال بنجاح' });
      } else {
        // حذف من course_exam_questions
        const result = await ExamsService.deleteCourseExamQuestion(questionId);
        return res.json(result);
      }
    } catch (error: any) {
      console.error('Error deleting question:', error);
      if (error.message) {
        return res.status(400).json({ message: error.message });
      }
      res.status(500).json({ message: 'Failed to delete question' });
    }
  }),
);

// تعديل سؤال نصي في امتحان الكورس الشامل
router.put(
  '/course-exam/question/:questionId',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const questionId = Number(req.params.questionId);
    if (Number.isNaN(questionId)) {
      return res.status(400).json({ message: 'Invalid question id' });
    }

    try {
      // التحقق من نوع السؤال - قد يكون في course_level_exam_questions أو course_exam_questions
      // أولاً: التحقق من course_level_exam_questions
      let questionCheck = await pool.query(
        `SELECT e.id as exam_id, c.teacher_id, 'course_level' as exam_type,
                q.type, q.question_text, q.question_image
         FROM course_level_exam_questions q
         JOIN course_level_exams e ON q.exam_id = e.id
         JOIN courses c ON e.course_id = c.id
         WHERE q.id = $1`,
        [questionId],
      );

      // إذا لم يوجد، جرب course_exam_questions
      if (!questionCheck.rowCount) {
        questionCheck = await pool.query(
          `SELECT ce.id as exam_id, c.teacher_id, 'course_exam' as exam_type
           FROM questions q
           JOIN course_exam_questions ceq ON q.id = ceq.question_id
           JOIN course_exams ce ON ceq.course_exam_id = ce.id
           JOIN courses c ON ce.course_id = c.id
           WHERE q.id = $1`,
          [questionId],
        );
      }

      if (!questionCheck.rowCount) {
        return res.status(404).json({ message: 'Question not found' });
      }

      const question = questionCheck.rows[0];

      // التحقق من أن المدرس يملك الكورس
      if (question.teacher_id !== req.user!.id) {
        return res.status(403).json({ message: 'You are not allowed to edit this question' });
      }

      // استخراج البيانات من الطلب
      const {
        text,
        choices,
        image,
        questionText,
        questionImage,
        optionA,
        optionB,
        optionC,
        optionD,
        correctAnswer,
      } = req.body;

      // معالجة البيانات - دعم أسماء الحقول المختلفة
      const finalText = text || questionText;
      const finalImage = image || questionImage;

      // تحديث السؤال حسب نوعه
      if (question.exam_type === 'course_level') {
        // تحديث في course_level_exam_questions
        const updates: string[] = [];
        const values: any[] = [];
        let paramIndex = 1;

        if (finalText !== undefined) {
          updates.push(`question_text = $${paramIndex++}`);
          values.push(finalText);
        }

        if (finalImage !== undefined) {
          updates.push(`question_image = $${paramIndex++}`);
          values.push(finalImage);
        }

        if (optionA !== undefined) {
          updates.push(`option_a = $${paramIndex++}`);
          values.push(optionA);
        }
        if (optionB !== undefined) {
          updates.push(`option_b = $${paramIndex++}`);
          values.push(optionB);
        }
        if (optionC !== undefined) {
          updates.push(`option_c = $${paramIndex++}`);
          values.push(optionC);
        }
        if (optionD !== undefined) {
          updates.push(`option_d = $${paramIndex++}`);
          values.push(optionD);
        }

        if (correctAnswer !== undefined) {
          if (!['A', 'B', 'C', 'D'].includes(correctAnswer)) {
            return res.status(400).json({ message: 'correctAnswer must be one of A, B, C, or D' });
          }
          updates.push(`correct_answer = $${paramIndex++}`);
          values.push(correctAnswer);
        }

        if (updates.length === 0) {
          return res.status(400).json({ message: 'يجب إرسال بيانات للتعديل' });
        }

        updates.push(`updated_at = NOW()`);
        values.push(questionId);

        const query = `UPDATE course_level_exam_questions 
                       SET ${updates.join(', ')} 
                       WHERE id = $${paramIndex} 
                       RETURNING *`;

        const result = await pool.query(query, values);
        return res.json({ message: 'تم تحديث السؤال بنجاح', question: result.rows[0] });
      } else {
        // تحديث في course_exam_questions
        // التحقق من وجود بيانات للتعديل
        if (!finalText && !choices && !finalImage) {
          return res
            .status(400)
            .json({ message: 'يجب إرسال نص السؤال أو الاختيارات أو الصورة للتعديل' });
        }

        // معالجة الاختيارات إذا كانت موجودة
        let processedChoices = undefined;
        if (choices) {
          if (typeof choices === 'string') {
            try {
              processedChoices = JSON.parse(choices);
            } catch {
              return res
                .status(400)
                .json({ message: 'Invalid choices format. Must be a valid JSON array' });
            }
          } else if (Array.isArray(choices)) {
            processedChoices = choices;
          } else {
            return res.status(400).json({ message: 'Choices must be an array' });
          }

          // التحقق من أن هناك اختيار صحيح واحد فقط
          const correctCount = processedChoices.filter(
            (c: any) => c.is_correct === true || c.is_correct === 'true',
          ).length;
          if (correctCount !== 1) {
            return res.status(400).json({ message: 'يجب أن يكون هناك اختيار صحيح واحد فقط' });
          }
        }

        // تحديث السؤال
        const result = await ExamsService.updateCourseExamQuestion(
          questionId,
          finalText,
          undefined, // grade - سيتم تعيينه تلقائياً إلى 1
          processedChoices,
          finalImage,
        );

        return res.json(result);
      }
    } catch (error: any) {
      console.error('Error updating question:', error);
      if (error.message) {
        return res.status(400).json({ message: error.message });
      }
      res.status(500).json({ message: 'Failed to update question' });
    }
  }),
);

// إضافة/تحديث صورة لسؤال في امتحان الكورس (رفع ملف)
router.patch(
  '/course-exam/question/:questionId/image',
  authMiddleware(['teacher']),
  uploadQuestionImage.single('questionImage'),
  asyncWrapper(async (req, res) => {
    const questionId = Number(req.params.questionId);
    if (Number.isNaN(questionId)) {
      return res.status(400).json({ message: 'Invalid question id' });
    }
    if (!req.file) {
      return res.status(400).json({ message: 'يجب إرفاق صورة (الحقل: questionImage)' });
    }

    try {
      let questionCheck = await pool.query(
        `SELECT q.id as row_id, e.id as exam_id, c.teacher_id, 'course_level' as exam_type
         FROM course_level_exam_questions q
         JOIN course_level_exams e ON q.exam_id = e.id
         JOIN courses c ON e.course_id = c.id
         WHERE q.id = $1`,
        [questionId],
      );

      if (!questionCheck.rowCount) {
        questionCheck = await pool.query(
          `SELECT ceq.id as row_id, ce.id as exam_id, c.teacher_id, 'course_exam' as exam_type
           FROM questions q
           JOIN course_exam_questions ceq ON q.id = ceq.question_id
           JOIN course_exams ce ON ceq.course_exam_id = ce.id
           JOIN courses c ON ce.course_id = c.id
           WHERE q.id = $1`,
          [questionId],
        );
      }

      if (!questionCheck.rowCount) {
        return res.status(404).json({ message: 'Question not found' });
      }

      const row = questionCheck.rows[0];
      if (row.teacher_id !== req.user!.id) {
        return res.status(403).json({ message: 'You are not allowed to update this question' });
      }

      let uploadedUrl: string;
      try {
        const uploaded = await uploadToCloudinary(req.file.path);
        uploadedUrl = uploaded.secure_url;
      } catch (uploadErr: any) {
        console.error('Error uploading question image:', uploadErr);
        return res.status(500).json({ message: 'فشل رفع الصورة' });
      } finally {
        try {
          fs.unlinkSync(req.file.path);
        } catch {
          // ignore
        }
      }

      if (row.exam_type === 'course_level') {
        await pool.query(
          `UPDATE course_level_exam_questions SET question_image = $1, updated_at = NOW() WHERE id = $2`,
          [uploadedUrl, row.row_id],
        );
        const updated = await pool.query(
          `SELECT * FROM course_level_exam_questions WHERE id = $1`,
          [row.row_id],
        );
        return res.json({
          message: 'تمت إضافة صورة السؤال بنجاح',
          question: updated.rows[0],
          questionImage: uploadedUrl,
        });
      }

      // نظام course_exam القديم: تحديث جدول questions
      await pool.query(`UPDATE questions SET image = $1 WHERE id = $2`, [uploadedUrl, questionId]);
      return res.json({
        message: 'تمت إضافة صورة السؤال بنجاح',
        questionImage: uploadedUrl,
      });
    } catch (error: any) {
      console.error('Error updating question image:', error);
      return res.status(500).json({ message: error.message || 'Failed to update question image' });
    }
  }),
);

// تحديد الإجابة الصحيحة لسؤال في امتحان الكورس الشامل (يُحدَّث في صف الامتحان فقط، ولا يُغيّر بنك الأسئلة)
router.patch(
  '/course-exam/question/:questionId/correct-answer',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const questionId = Number(req.params.questionId);
    if (Number.isNaN(questionId)) {
      return res.status(400).json({ message: 'Invalid question id' });
    }

    const { correct_choice_id, correctAnswer } = req.body;

    // دعم أسماء الحقول المختلفة
    const finalCorrectAnswer = correctAnswer || (correct_choice_id ? String.fromCharCode(64 + correct_choice_id) : null);

    if (!finalCorrectAnswer) {
      return res.status(400).json({ message: 'correctAnswer or correct_choice_id is required' });
    }

    if (!['A', 'B', 'C', 'D'].includes(finalCorrectAnswer)) {
      return res.status(400).json({ message: 'correctAnswer must be one of A, B, C, or D' });
    }

    try {
      // التحقق من نوع السؤال - قد يكون في course_level_exam_questions أو course_exam_questions
      // أولاً: التحقق من course_level_exam_questions
      let questionCheck = await pool.query(
        `SELECT e.id as exam_id, c.teacher_id, 'course_level' as exam_type
         FROM course_level_exam_questions q
         JOIN course_level_exams e ON q.exam_id = e.id
         JOIN courses c ON e.course_id = c.id
         WHERE q.id = $1`,
        [questionId],
      );

      // إذا لم يوجد، جرب course_exam_questions
      if (!questionCheck.rowCount) {
        questionCheck = await pool.query(
          `SELECT ce.id as exam_id, c.teacher_id, 'course_exam' as exam_type
           FROM questions q
           JOIN course_exam_questions ceq ON q.id = ceq.question_id
           JOIN course_exams ce ON ceq.course_exam_id = ce.id
           JOIN courses c ON ce.course_id = c.id
           WHERE q.id = $1`,
          [questionId],
        );
      }

      if (!questionCheck.rowCount) {
        return res.status(404).json({ message: 'Question not found' });
      }

      const question = questionCheck.rows[0];

      // التحقق من أن المدرس يملك الكورس
      if (question.teacher_id !== req.user!.id) {
        return res.status(403).json({ message: 'You are not allowed to modify this question' });
      }

      // تحديث الإجابة الصحيحة حسب نوع السؤال
      if (question.exam_type === 'course_level') {
        // تحديث في course_level_exam_questions فقط (نسخة السؤال داخل الامتحان؛ لا يؤثر على البنك)
        const result = await pool.query(
          `UPDATE course_level_exam_questions 
           SET correct_answer = $1, updated_at = NOW()
           WHERE id = $2
           RETURNING *`,
          [finalCorrectAnswer, questionId],
        );

        if (!result.rowCount) {
          return res.status(404).json({ message: 'Question not found' });
        }

        return res.json({ message: 'تم تحديث الإجابة الصحيحة بنجاح', question: result.rows[0] });
      } else {
        // تحديث في course_exam_questions - استخدام service method
        // البحث عن الاختيارات لهذا السؤال
        const choicesRes = await pool.query(
          `SELECT id FROM question_choices WHERE question_id = $1 ORDER BY id ASC`,
          [questionId],
        );

        if (choicesRes.rowCount && choicesRes.rowCount < 4) {
          return res.status(400).json({ message: 'Question must have 4 choices' });
        }

        // تحديد الاختيار الصحيح بناءً على finalCorrectAnswer (A=0, B=1, C=2, D=3)
        const correctIndex = finalCorrectAnswer.charCodeAt(0) - 65; // A=0, B=1, C=2, D=3
        const correctChoiceId = choicesRes.rows[correctIndex]?.id;

        if (!correctChoiceId) {
          return res.status(400).json({ message: 'Invalid correct answer index' });
        }

        // استخدام service method لتحديث الإجابة الصحيحة
        const result = await ExamsService.setCourseExamQuestionCorrectAnswer(questionId, correctChoiceId);
        return res.json(result);
      }
    } catch (error: any) {
      console.error('Error setting correct answer:', error);
      if (error.message) {
        return res.status(400).json({ message: error.message });
      }
      res.status(500).json({ message: 'Failed to set correct answer' });
    }
  }),
);

// عرض الطلاب المشتركين في كورس معين مع كود التفعيل المستخدم (للأستاذ فقط)
router.get(
  '/:courseId/enrollments',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const courseId = Number(req.params.courseId);
    const teacherId = req.user!.id;
    // تحقق أن الكورس يخص المدرس
    const courseCheck = await pool.query(
      'SELECT id FROM courses WHERE id = $1 AND teacher_id = $2',
      [courseId, teacherId],
    );
    if (!courseCheck.rowCount) {
      return res.status(404).json({ message: 'Course not found or not yours' });
    }
    // جلب الطلاب المشتركين مع كود التفعيل المستخدم
    const result = await pool.query(
      `SELECT u.id as student_id, u.name, u.email, u.phone, u.avatar, e.enrolled_at, tic.code as activation_code,
              e.is_blocked_by_teacher, e.subscription_status, e.expires_at
       FROM enrollments e
       JOIN users u ON e.user_id = u.id
       LEFT JOIN invite_code_usages icu ON icu.user_id = u.id
       LEFT JOIN teacher_invite_codes tic ON icu.code_id = tic.id AND tic.course_id = $1
       WHERE e.course_id = $1
       ORDER BY e.enrolled_at DESC`,
      [courseId],
    );

    const students = result.rows.map((row: any) => {
      const now = new Date();
      const isBlockedByTeacher = !!row.is_blocked_by_teacher;
      const isSubscriptionInactive = row.subscription_status !== 'active';
      const isExpired = row.expires_at ? now > new Date(row.expires_at) : false;

      const is_content_blocked = isBlockedByTeacher || isSubscriptionInactive || isExpired;

      return {
        id: row.student_id,
        name: row.name,
        email: row.email,
        phone: row.phone,
        avatar: row.avatar,
        enrolled_at: row.enrolled_at,
        activation_code: row.activation_code,
        is_content_blocked,
      };
    });

    res.json({ students });
  }),
);

// تغيير حالة ظهور محاضرة (إظهار/إخفاء) للمدرس
router.patch(
  '/lecture/:lectureId/visibility',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const lectureId = Number(req.params.lectureId);
    const { is_visible } = req.body;
    if (typeof is_visible !== 'boolean') {
      return res.status(400).json({ message: 'is_visible (boolean) is required' });
    }
    // تحقق أن المحاضرة تخص المدرس
    const lecCheck = await pool.query(
      `SELECT l.* FROM lectures l JOIN courses c ON l.course_id = c.id WHERE l.id = $1 AND c.teacher_id = $2`,
      [lectureId, req.user!.id],
    );
    if (!lecCheck.rowCount) {
      return res.status(404).json({ message: 'Lecture not found or not yours' });
    }
    const result = await pool.query(
      `UPDATE lectures SET is_visible = $1 WHERE id = $2 RETURNING *`,
      [is_visible, lectureId],
    );

    // إرسال إشعار للطلاب عند جعل المحاضرة ظاهرة
    if (is_visible && result.rowCount && result.rowCount > 0) {
      try {
        const lecture = result.rows[0];
        const courseInfo = await pool.query(
          `SELECT id, title FROM courses WHERE id = $1`,
          [lecture.course_id],
        );

        if (courseInfo.rowCount && courseInfo.rowCount > 0) {
          await NotificationService.notifyLectureAdded(
            lecture.course_id,
            lecture.id,
            lecture.title,
            courseInfo.rows[0].title,
          );
        }
      } catch (notifError) {
        console.error('Error sending lecture visibility notification:', notifError);
        // لا نوقف العملية إذا فشل الإشعار
      }
    }

    res.json({ lecture: result.rows[0] });
  }),
);

// إنشاء امتحان محاضرة مع الإعدادات المتقدمة
router.post(
  '/lecture/:lectureId/exam',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const lectureId = Number(req.params.lectureId);
    const {
      title,
      total_grade,
      duration,
      is_visible,
      show_at,
      hide_at,
      lock_next_lectures,
      show_answers_immediately,
      show_answers_after_hours,
      type,
      exam_type,
    } = req.body;

    if (isNaN(lectureId)) {
      return res.status(400).json({ message: 'Invalid lecture ID' });
    }

    // التحقق من أن المحاضرة تخص المدرس
    const lectureCheck = await pool.query(
      `SELECT l.*, c.teacher_id FROM lectures l 
       JOIN courses c ON l.course_id = c.id 
       WHERE l.id = $1 AND c.teacher_id = $2`,
      [lectureId, req.user!.id],
    );

    if (!lectureCheck.rowCount) {
      return res.status(404).json({ message: 'Lecture not found or not yours' });
    }

    // معالجة البيانات
    const examTitle = title || 'Lecture Exam';
    const examTotalGrade = total_grade || 100;
    const examDuration = duration ? Number(duration) : null;

    // معالجة is_visible - افتراضياً true إذا لم يتم تحديده
    let visibility = true; // Default to true (visible)
    if (is_visible !== undefined && is_visible !== null) {
      if (typeof is_visible === 'string') {
        visibility = is_visible.toLowerCase() === 'true';
      } else {
        visibility = !!is_visible;
      }
    }

    // معالجة التواريخ
    const showAt = show_at ? new Date(show_at) : null;
    const hideAt = hide_at ? new Date(hide_at) : null;

    // معالجة الإعدادات المتقدمة
    const lockNextLectures = lock_next_lectures === true || lock_next_lectures === 'true';
    const showAnswersImmediately =
      show_answers_immediately !== false && show_answers_immediately !== 'false';
    const showAnswersAfterHours = show_answers_after_hours ? Number(show_answers_after_hours) : 0;
    const examTypeRaw = typeof type === 'string' ? type : typeof exam_type === 'string' ? exam_type : 'exam';
    const examType =
      examTypeRaw.trim().toLowerCase() === 'assignment' ? 'assignment' : 'exam';

    const exam = await pool.query(
      `INSERT INTO exams (
        lecture_id, type, total_grade, created_by, title, duration, is_visible,
        show_at, hide_at, lock_next_lectures, 
        show_answers_immediately, show_answers_after_hours
      ) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
      [
        lectureId,
        examType,
        examTotalGrade,
        req.user!.id,
        examTitle,
        examDuration,
        visibility,
        showAt,
        hideAt,
        lockNextLectures,
        showAnswersImmediately,
        showAnswersAfterHours,
      ],
    );

    // إرسال إشعار للطلاب المشتركين في الكورس عند إضافة الامتحان
    if (visibility) {
      try {
        const courseInfo = await pool.query(
          `SELECT c.id as course_id, c.title as course_title, l.title as lecture_title
           FROM lectures l
           JOIN courses c ON l.course_id = c.id
           WHERE l.id = $1`,
          [lectureId],
        );

        if (courseInfo.rowCount) {
          const result = await NotificationService.notifyExamAdded(
            courseInfo.rows[0].course_id,
            lectureId,
            exam.rows[0].id,
            examTitle,
            courseInfo.rows[0].lecture_title,
            courseInfo.rows[0].course_title,
          );
          console.log(`✅ [Notification] Exam notification sent for exam ${exam.rows[0].id} in course ${courseInfo.rows[0].course_id}`);
          console.log(`📊 [Notification] Notified ${result.notifiedCount || 0} students`);
        } else {
          console.log(`⚠️ [Notification] Course info not found for lecture ${lectureId}`);
        }
      } catch (notifError) {
        console.error('❌ [Notification] Error sending exam notification:', notifError);
        // لا نوقف العملية إذا فشل الإشعار
      }
    } else {
      console.log(`⚠️ [Notification] Exam ${exam.rows[0].id} is not visible, skipping notification`);
    }

    return res.status(201).json({ exam: exam.rows[0] });
  }),
);

// تغيير حالة ظهور امتحان المحاضرة (إظهار/إخفاء للطلاب)
router.patch(
  '/lecture/exam/:examId/visibility',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const examId = Number(req.params.examId);
    const { is_visible } = req.body;

    if (typeof is_visible !== 'boolean') {
      return res.status(400).json({ message: 'is_visible (boolean) is required' });
    }

    // تحقق أن الامتحان يخص المدرس
    const examCheck = await pool.query(
      `SELECT e.* FROM exams e 
       JOIN lectures l ON e.lecture_id = l.id 
       JOIN courses c ON l.course_id = c.id 
       WHERE e.id = $1 AND c.teacher_id = $2`,
      [examId, req.user!.id],
    );

    if (!examCheck.rowCount) {
      // تحقق إذا كان الامتحان موجود أصلاً
      const examExists = await pool.query('SELECT id FROM exams WHERE id = $1', [examId]);
      if (!examExists.rowCount) {
        return res.status(404).json({ message: 'Lecture exam not found' });
      }

      // تحقق من تفاصيل الامتحان للمساعدة في التصحيح
      const examDetails = await pool.query(
        `SELECT e.id, e.lecture_id, e.type, l.course_id, c.teacher_id 
         FROM exams e 
         LEFT JOIN lectures l ON e.lecture_id = l.id 
         LEFT JOIN courses c ON l.course_id = c.id 
         WHERE e.id = $1`,
        [examId],
      );

      if (examDetails.rowCount) {
        const details = examDetails.rows[0];
        return res.status(404).json({
          message: 'Lecture exam not found or not yours',
          debug: {
            examId: details.id,
            lectureId: details.lecture_id,
            courseId: details.course_id,
            examTeacherId: details.teacher_id,
            currentTeacherId: req.user!.id,
          },
        });
      }

      return res.status(404).json({ message: 'Lecture exam not found or not yours' });
    }

    const result = await pool.query(`UPDATE exams SET is_visible = $1 WHERE id = $2 RETURNING *`, [
      is_visible,
      examId,
    ]);

    // إرسال إشعار للطلاب عند جعل الامتحان ظاهر
    if (is_visible && result.rowCount && result.rowCount > 0) {
      try {
        const examInfo = await pool.query(
          `SELECT c.id as course_id, c.title as course_title, l.id as lecture_id, l.title as lecture_title, e.title as exam_title
           FROM exams e
           JOIN lectures l ON e.lecture_id = l.id
           JOIN courses c ON l.course_id = c.id
           WHERE e.id = $1`,
          [examId],
        );

        if (examInfo.rowCount) {
          const info = examInfo.rows[0];
          await NotificationService.notifyExamAdded(
            info.course_id,
            info.lecture_id,
            examId,
            info.exam_title || 'امتحان',
            info.lecture_title,
            info.course_title,
          );
          console.log(`✅ [Notification] Exam visibility notification sent for exam ${examId} in course ${info.course_id}`);
        }
      } catch (notifError) {
        console.error('❌ [Notification] Error sending exam visibility notification:', notifError);
        // لا نوقف العملية إذا فشل الإشعار
      }
    }

    res.json({
      message: is_visible ? 'تم إظهار الامتحان للطلاب' : 'تم إخفاء الامتحان عن الطلاب',
      exam: result.rows[0],
    });
  }),
);

// جلب امتحان محاضرة (مع مراعاة حالة is_visible)
router.get(
  '/lecture/:lectureId/exam',
  authMiddleware(['teacher', 'student']),
  asyncWrapper(async (req, res) => {
    const lectureId = Number(req.params.lectureId);
    const user = req.user!;

    if (isNaN(lectureId)) {
      return res.status(400).json({ message: 'Invalid lecture ID' });
    }

    // تحقق من الصلاحية
    let isAllowed = false;
    if (user.role === 'teacher') {
      const lectureCheck = await pool.query(
        `SELECT l.* FROM lectures l 
         JOIN courses c ON l.course_id = c.id 
         WHERE l.id = $1 AND c.teacher_id = $2`,
        [lectureId, user.id],
      );
      if (lectureCheck.rowCount) isAllowed = true;
    } else if (user.role === 'student') {
      const enrollCheck = await pool.query(
        `SELECT 1 FROM enrollments e 
         JOIN lectures l ON e.course_id = l.course_id 
         WHERE l.id = $1 AND e.user_id = $2`,
        [lectureId, user.id],
      );
      if (enrollCheck.rowCount) isAllowed = true;
    }

    if (!isAllowed) {
      return res.status(403).json({ message: 'Not allowed to view this exam' });
    }

    // جلب الامتحان مع مراعاة حالة is_visible والإعدادات المتقدمة
    let examQuery = '';
    let examParams = [];

    if (user.role === 'teacher') {
      // المدرس يرى الامتحان حتى لو كان مخفي
      examQuery = `SELECT * FROM exams WHERE lecture_id = $1 AND type = 'exam'`;
      examParams = [lectureId];
    } else {
      // الطالب يرى الامتحان فقط إذا كان ظاهر وفي الوقت المحدد
      const now = new Date();
      examQuery = `SELECT * FROM exams 
                   WHERE lecture_id = $1 AND type = 'exam' AND is_visible = true
                   AND (show_at IS NULL OR show_at <= $2)
                   AND (hide_at IS NULL OR hide_at >= $2)`;
      examParams = [lectureId, now];
    }

    const examRes = await pool.query(examQuery, examParams);

    if (!examRes.rowCount) {
      return res.status(404).json({ message: 'Exam not found or not visible' });
    }

    res.json({ exam: examRes.rows[0] });
  }),
);

// تحديث امتحان محاضرة
router.patch(
  '/lecture/exam/:examId',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const examId = Number(req.params.examId);
    const { title, total_grade, duration, is_visible } = req.body;

    if (isNaN(examId)) {
      return res.status(400).json({ message: 'Invalid exam ID' });
    }

    // تحقق من أن الامتحان يخص محاضرة في كورس يملكه المدرس
    const examCheck = await pool.query(
      `SELECT e.*, l.title as lecture_title, c.id as course_id, c.title as course_title 
       FROM exams e 
       JOIN lectures l ON e.lecture_id = l.id 
       JOIN courses c ON l.course_id = c.id 
       WHERE e.id = $1 AND c.teacher_id = $2`,
      [examId, req.user!.id],
    );

    if (!examCheck.rowCount) {
      return res.status(404).json({ message: 'Lecture exam not found or not yours' });
    }

    // بناء query التحديث
    const updateFields = [];
    const values = [];
    let i = 1;

    if (title !== undefined) {
      updateFields.push(`title = $${i++}`);
      values.push(title);
    }
    if (total_grade !== undefined) {
      updateFields.push(`total_grade = $${i++}`);
      values.push(total_grade);
    }
    if (duration !== undefined) {
      updateFields.push(`duration = $${i++}`);
      values.push(duration);
    }
    if (is_visible !== undefined) {
      updateFields.push(`is_visible = $${i++}`);
      values.push(is_visible);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({ message: 'No fields to update' });
    }

    values.push(examId);
    const result = await pool.query(
      `UPDATE exams SET ${updateFields.join(', ')} WHERE id = $${i} RETURNING *`,
      values,
    );

    res.json({ exam: result.rows[0] });
  }),
);

// حذف امتحان محاضرة
router.delete(
  '/lecture/exam/:examId',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const examId = Number(req.params.examId);

    if (isNaN(examId)) {
      return res.status(400).json({ message: 'Invalid exam ID' });
    }

    const examCheck = await pool.query(
      `SELECT e.* FROM exams e 
       JOIN lectures l ON e.lecture_id = l.id 
       JOIN courses c ON l.course_id = c.id 
       WHERE e.id = $1 AND c.teacher_id = $2`,
      [examId, req.user!.id],
    );

    if (!examCheck.rowCount) {
      return res.status(404).json({ message: 'Lecture exam not found or not yours' });
    }

    await pool.query('DELETE FROM exams WHERE id = $1', [examId]);
    res.json({ message: 'Lecture exam deleted successfully' });
  }),
);

// Debug endpoint لفحص حالة الامتحانات المانعة للوصول
router.get(
  '/lecture/:lectureId/debug-access',
  authMiddleware(['student', 'teacher', 'admin']),
  asyncWrapper(async (req, res) => {
    const lectureId = Number(req.params.lectureId);
    const userId = req.user!.id;

    if (isNaN(lectureId)) {
      return res.status(400).json({ message: 'Invalid lecture ID' });
    }

    // التحقق من أن المستخدم مسجل في الكورس
    const enrollmentCheck = await pool.query(
      `SELECT 1 FROM enrollments e 
       JOIN lectures l ON e.course_id = l.course_id 
       WHERE l.id = $1 AND e.user_id = $2`,
      [lectureId, userId],
    );

    if (!enrollmentCheck.rowCount) {
      return res.status(403).json({ message: 'Not enrolled in this course' });
    }

    const debugInfo = await LectureExamService.debugBlockingExams(lectureId, userId);

    res.json(debugInfo);
  }),
);

// التحقق من إمكانية الوصول لمحاضرة معينة للطالب
router.get(
  '/lecture/:lectureId/access-check',
  authMiddleware(['student']),
  asyncWrapper(async (req, res) => {
    const lectureId = Number(req.params.lectureId);
    const studentId = req.user!.id;

    if (isNaN(lectureId)) {
      return res.status(400).json({ message: 'Invalid lecture ID' });
    }

    // جلب معلومات المحاضرة والكورس
    let courseId: number | null = null;

    // التحقق من course_lectures أولاً
    const courseLectureResult = await pool.query(
      'SELECT course_id FROM course_lectures WHERE id = $1',
      [lectureId],
    );

    if (courseLectureResult.rowCount) {
      courseId = courseLectureResult.rows[0].course_id;
    } else {
      // التحقق من lectures
      const lectureResult = await pool.query('SELECT course_id FROM lectures WHERE id = $1', [
        lectureId,
      ]);
      if (lectureResult.rowCount) {
        courseId = lectureResult.rows[0].course_id;
      }
    }

    if (!courseId) {
      return res.status(404).json({ message: 'المحاضرة غير موجودة' });
    }

    // التحقق من صلاحية الوصول للكورس (يدعم الكورسات العادية والكورسات في المواد الدراسية)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { canAccessCourseContent } = require('../utils/courseAccess');
    const hasAccess = await canAccessCourseContent(courseId, studentId, 'student');

    if (!hasAccess) {
      return res.status(403).json({
        message: 'ليس لديك صلاحية للوصول إلى هذا الكورس. يجب أن تكون مشترك في الكورس أو مفعل للباقة التي تحتوي على هذه المادة'
      });
    }

    // التحقق من إمكانية الوصول للمحاضرة بناءً على الامتحانات (للكورسات العادية فقط)
    let canAccess = true;
    let blockingExams: any[] = [];

    // فقط للكورسات العادية (lectures)، نتحقق من الامتحانات
    const lectureCheck = await pool.query('SELECT id FROM lectures WHERE id = $1', [lectureId]);

    if (lectureCheck.rowCount) {
      canAccess = await LectureExamService.canStudentAccessLecture(lectureId, studentId);
      blockingExams = await LectureExamService.getBlockingExamsForLecture(lectureId, studentId);
    }

    res.json({
      can_access: canAccess,
      blocking_exams: blockingExams,
      message: canAccess
        ? 'يمكن الوصول للمحاضرة'
        : 'لا يمكن الوصول للمحاضرة - يجب النجاح في الامتحانات المطلوبة أولاً'
    });
  }),
);

// تحديث الإعدادات المتقدمة لامتحان المحاضرة
router.patch(
  '/lecture/exam/:examId/advanced-settings',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const examId = Number(req.params.examId);
    const {
      show_at,
      hide_at,
      lock_next_lectures,
      show_answers_immediately,
      show_answers_after_hours,
    } = req.body;

    if (isNaN(examId)) {
      return res.status(400).json({ message: 'Invalid exam ID' });
    }

    // تحقق من أن الامتحان يخص محاضرة في كورس يملكه المدرس
    const examCheck = await pool.query(
      `SELECT e.* FROM exams e 
       JOIN lectures l ON e.lecture_id = l.id 
       JOIN courses c ON l.course_id = c.id 
       WHERE e.id = $1 AND c.teacher_id = $2`,
      [examId, req.user!.id],
    );

    if (!examCheck.rowCount) {
      return res.status(404).json({ message: 'Lecture exam not found or not yours' });
    }

    // بناء query التحديث
    const updateFields = [];
    const values = [];
    let i = 1;

    if (show_at !== undefined) {
      updateFields.push(`show_at = $${i++}`);
      values.push(show_at ? new Date(show_at) : null);
    }
    if (hide_at !== undefined) {
      updateFields.push(`hide_at = $${i++}`);
      values.push(hide_at ? new Date(hide_at) : null);
    }
    if (lock_next_lectures !== undefined) {
      updateFields.push(`lock_next_lectures = $${i++}`);
      values.push(lock_next_lectures === true || lock_next_lectures === 'true');
    }
    if (show_answers_immediately !== undefined) {
      updateFields.push(`show_answers_immediately = $${i++}`);
      values.push(show_answers_immediately !== false && show_answers_immediately !== 'false');
    }
    if (show_answers_after_hours !== undefined) {
      updateFields.push(`show_answers_after_hours = $${i++}`);
      values.push(Number(show_answers_after_hours) || 0);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({ message: 'No advanced settings to update' });
    }

    values.push(examId);
    const result = await pool.query(
      `UPDATE exams SET ${updateFields.join(', ')} WHERE id = $${i} RETURNING *`,
      values,
    );

    res.json({
      message: 'Advanced settings updated successfully',
      exam: result.rows[0]
    });
  }),
);

// تفعيل الطالب في كورس (مدرس أو أدمن) - Body: { courseId, studentId } أو { course_id, student_id }
router.post(
  '/activate-student',
  authMiddleware(['teacher', 'admin']),
  asyncWrapper(async (req, res) => {
    const courseId = Number(req.body.courseId ?? req.body.course_id);
    const studentId = Number(req.body.studentId ?? req.body.student_id);
    const isAdmin = req.user!.role === 'admin';
    const teacherId = req.user!.id;

    if (!courseId || !studentId || Number.isNaN(courseId) || Number.isNaN(studentId)) {
      return res.status(400).json({
        message: 'courseId and studentId are required (in request body)',
      });
    }

    const courseCheck = await pool.query(
      isAdmin
        ? 'SELECT id, title, teacher_id FROM courses WHERE id = $1'
        : 'SELECT id, title, teacher_id FROM courses WHERE id = $1 AND teacher_id = $2',
      isAdmin ? [courseId] : [courseId, teacherId],
    );

    if (!courseCheck.rowCount) {
      return res.status(404).json({
        message: 'Course not found or not yours',
        details: { course_id: courseId },
      });
    }

    const studentCheck = await pool.query(
      'SELECT id, name, email FROM users WHERE id = $1 AND role = $2',
      [studentId, 'student'],
    );

    if (!studentCheck.rowCount) {
      return res.status(404).json({
        message: 'Student not found',
        details: { student_id: studentId },
      });
    }

    const enrollmentCheck = await pool.query(
      'SELECT id FROM enrollments WHERE course_id = $1 AND user_id = $2',
      [courseId, studentId],
    );

    if (enrollmentCheck.rowCount && enrollmentCheck.rowCount > 0) {
      return res.status(400).json({
        message: 'Student is already enrolled in this course',
        details: {
          course_id: courseId,
          student_id: studentId,
          student_name: studentCheck.rows[0].name,
        },
      });
    }

    try {
      await pool.query('INSERT INTO enrollments (user_id, course_id) VALUES ($1, $2)', [
        studentId,
        courseId,
      ]);

      try {
        const gradeRes = await pool.query(
          'SELECT grade_id, teacher_id FROM courses WHERE id = $1',
          [courseId],
        );
        if (gradeRes.rowCount) {
          const gradeId = gradeRes.rows[0].grade_id as number;
          const courseTeacherId = gradeRes.rows[0].teacher_id as number;
          const group = await ChatService.getOrCreateTeacherGradeGroup(gradeId, courseTeacherId);
          await ChatService.addMember(group.id, studentId, 'student');
        }
      } catch (err) {
        console.warn('Failed to add student to chat group after activate-student:', err);
      }

      try {
        await pool.query(
          `INSERT INTO notifications (user_id, title, message, type, course_id) 
           VALUES ($1, $2, $3, $4, $5)`,
          [
            studentId,
            'كورس جديد متاح',
            `تم فتح كورس "${courseCheck.rows[0].title}" لك`,
            'course_opened',
            courseId,
          ],
        );
        ExpoPushService.sendPushNotification(studentId, 'كورس جديد متاح', `تم فتح كورس "${courseCheck.rows[0].title}" لك`, {
          type: 'course_opened',
          course_id: courseId,
        }).catch((e) => console.error('Expo push error:', e));
      } catch (_error) {
        console.log('Warning: Could not create notification for student');
      }

      const courseData = courseCheck.rows[0];
      const studentData = studentCheck.rows[0];

      res.status(201).json({
        message: 'Course opened for student successfully',
        details: {
          course_id: courseId,
          course_title: courseData.title,
          student_id: studentId,
          student_name: studentData.name,
          student_email: studentData.email,
          enrolled_at: new Date().toISOString(),
        },
      });
    } catch (error) {
      console.error('Error activating student in course:', error);
      res.status(500).json({
        message: 'Error occurred while activating student',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }),
);

// حذف طالب من كورس (للأستاذ فقط)
router.delete(
  '/:courseId/student/:studentId',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const courseId = Number(req.params.courseId);
    const studentId = Number(req.params.studentId);
    const teacherId = req.user!.id;

    if (isNaN(courseId) || isNaN(studentId)) {
      return res.status(400).json({ message: 'Invalid course ID or student ID' });
    }

    // تحقق من أن الكورس يخص المدرس
    const courseCheck = await pool.query(
      'SELECT id, title FROM courses WHERE id = $1 AND teacher_id = $2',
      [courseId, teacherId],
    );

    if (!courseCheck.rowCount) {
      return res.status(404).json({
        message: 'Course not found or not yours',
        details: {
          course_id: courseId,
          teacher_id: teacherId,
        },
      });
    }

    // تحقق من أن الطالب مشترك في الكورس
    const enrollmentCheck = await pool.query(
      'SELECT e.*, u.name as student_name FROM enrollments e JOIN users u ON e.user_id = u.id WHERE e.course_id = $1 AND e.user_id = $2',
      [courseId, studentId],
    );

    if (!enrollmentCheck.rowCount) {
      return res.status(404).json({
        message: 'Student is not enrolled in this course',
        details: {
          course_id: courseId,
          student_id: studentId,
        },
      });
    }

    try {
      // حذف الطالب من الكورس
      await pool.query('DELETE FROM enrollments WHERE course_id = $1 AND user_id = $2', [
        courseId,
        studentId,
      ]);

      // حذف إجابات الطالب في امتحانات المحاضرات (إذا كان الجدول موجود)
      try {
        await pool.query(
          'DELETE FROM exam_submissions WHERE exam_id IN (SELECT id FROM exams WHERE lecture_id IN (SELECT id FROM lectures WHERE course_id = $1)) AND student_id = $2',
          [courseId, studentId],
        );
      } catch (_error) {
        console.log('Warning: exam_submissions table might not exist or have different structure');
      }

      // حذف مشاهدات المحاضرات للطالب (إذا كان الجدول موجود)
      try {
        await pool.query(
          'DELETE FROM lecture_views WHERE lecture_id IN (SELECT id FROM lectures WHERE course_id = $1) AND student_id = $2',
          [courseId, studentId],
        );
      } catch (_error) {
        console.log('Warning: lecture_views table might not exist or have different structure');
      }

      // حذف الحضور للطالب (إذا كان الجدول موجود)
      try {
        await pool.query(
          'DELETE FROM attendance WHERE study_group_id IN (SELECT id FROM study_groups WHERE course_id = $1) AND student_id = $2',
          [courseId, studentId],
        );
      } catch (_error) {
        console.log('Warning: attendance table might not exist or have different structure');
      }

      const courseData = courseCheck.rows[0];
      const studentData = enrollmentCheck.rows[0];

      res.json({
        message: 'Student removed from course successfully',
        details: {
          course_id: courseId,
          course_title: courseData.title,
          student_id: studentId,
          student_name: studentData.student_name,
        },
      });
    } catch (error) {
      console.error('Error during student removal:', error);
      res.status(500).json({
        message: 'Error occurred while removing student',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }),
);

// فتح كورس لطالب معين (للأستاذ فقط)
router.post(
  '/:courseId/open-for-student/:studentId',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const courseId = Number(req.params.courseId);
    const studentId = Number(req.params.studentId);
    const teacherId = req.user!.id;

    if (isNaN(courseId) || isNaN(studentId)) {
      return res.status(400).json({ message: 'Invalid course ID or student ID' });
    }

    // تحقق من أن الكورس يخص المدرس
    const courseCheck = await pool.query(
      'SELECT id, title FROM courses WHERE id = $1 AND teacher_id = $2',
      [courseId, teacherId],
    );

    if (!courseCheck.rowCount) {
      return res.status(404).json({
        message: 'Course not found or not yours',
        details: {
          course_id: courseId,
          teacher_id: teacherId,
        },
      });
    }

    // تحقق من وجود الطالب
    const studentCheck = await pool.query(
      'SELECT id, name, email FROM users WHERE id = $1 AND role = $2',
      [studentId, 'student'],
    );

    if (!studentCheck.rowCount) {
      return res.status(404).json({
        message: 'Student not found',
        details: {
          student_id: studentId,
        },
      });
    }

    // تحقق من أن الطالب ليس مشترك بالفعل في الكورس
    const enrollmentCheck = await pool.query(
      'SELECT id FROM enrollments WHERE course_id = $1 AND user_id = $2',
      [courseId, studentId],
    );

    if (enrollmentCheck.rowCount && enrollmentCheck.rowCount > 0) {
      return res.status(400).json({
        message: 'Student is already enrolled in this course',
        details: {
          course_id: courseId,
          student_id: studentId,
          student_name: studentCheck.rows[0].name,
        },
      });
    }

    try {
      // إضافة الطالب للكورس
      await pool.query('INSERT INTO enrollments (user_id, course_id) VALUES ($1, $2)', [
        studentId,
        courseId,
      ]);

      // إضافة الطالب تلقائياً لمجموعة دردشة المدرس/الصف المرتبط بالكورس
      try {
        const gradeRes = await pool.query(
          'SELECT grade_id, teacher_id FROM courses WHERE id = $1',
          [courseId],
        );
        if (gradeRes.rowCount) {
          const gradeId = gradeRes.rows[0].grade_id as number;
          const teacherId = gradeRes.rows[0].teacher_id as number;
          const group = await ChatService.getOrCreateTeacherGradeGroup(gradeId, teacherId);
          await ChatService.addMember(group.id, studentId, 'student');
        }
      } catch (err) {
        console.warn('Failed to add student to chat group after open-for-student:', err);
      }

      // إنشاء إشعار للطالب
      try {
        await pool.query(
          `INSERT INTO notifications (user_id, title, message, type, course_id) 
           VALUES ($1, $2, $3, $4, $5)`,
          [
            studentId,
            'كورس جديد متاح',
            `تم فتح كورس "${courseCheck.rows[0].title}" لك من قبل المدرس`,
            'course_opened',
            courseId,
          ],
        );
        ExpoPushService.sendPushNotification(studentId, 'كورس جديد متاح', `تم فتح كورس "${courseCheck.rows[0].title}" لك من قبل المدرس`, {
          type: 'course_opened',
          course_id: courseId,
        }).catch((e) => console.error('Expo push error:', e));
      } catch (_error) {
        console.log('Warning: Could not create notification for student');
      }

      const courseData = courseCheck.rows[0];
      const studentData = studentCheck.rows[0];

      res.status(201).json({
        message: 'Course opened for student successfully',
        details: {
          course_id: courseId,
          course_title: courseData.title,
          student_id: studentId,
          student_name: studentData.name,
          student_email: studentData.email,
          enrolled_at: new Date().toISOString(),
        },
      });
    } catch (error) {
      console.error('Error opening course for student:', error);
      res.status(500).json({
        message: 'Error occurred while opening course for student',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }),
);

// عرض قائمة الطلاب المشتركين في كورس (للأستاذ فقط)
router.get(
  '/:courseId/students',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const courseId = Number(req.params.courseId);
    const teacherId = req.user!.id;

    if (isNaN(courseId)) {
      return res.status(400).json({ message: 'Invalid course ID' });
    }

    // تحقق من أن الكورس يخص المدرس
    const courseCheck = await pool.query(
      'SELECT id, title FROM courses WHERE id = $1 AND teacher_id = $2',
      [courseId, teacherId],
    );

    if (!courseCheck.rowCount) {
      return res.status(404).json({
        message: 'Course not found or not yours',
        details: {
          course_id: courseId,
          teacher_id: teacherId,
        },
      });
    }

    // جلب قائمة الطلاب المشتركين
    const studentsResult = await pool.query(
      `SELECT 
        u.id,
        u.name,
        u.email,
        u.phone,
        u.avatar,
        e.enrolled_at,
        tic.code as activation_code
       FROM enrollments e
       JOIN users u ON e.user_id = u.id
       LEFT JOIN invite_code_usages icu ON u.id = icu.user_id
       LEFT JOIN teacher_invite_codes tic ON icu.code_id = tic.id AND tic.course_id = e.course_id
       WHERE e.course_id = $1
       ORDER BY e.enrolled_at DESC`,
      [courseId],
    );

    const students = studentsResult.rows.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      phone: row.phone,
      avatar: row.avatar,
      enrolled_at: row.enrolled_at,
      activation_code: row.activation_code,
    }));

    res.json({
      course_id: courseId,
      course_title: courseCheck.rows[0].title,
      students_count: students.length,
      students: students,
    });
  }),
);

// جلب درجات الطالب في كل الامتحانات (شامل ومحاضرات)
router.get(
  '/my-exam-grades',
  authMiddleware(['student']),
  asyncWrapper(async (req, res) => {
    const studentId = req.user!.id;
    // جلب كل الكورسات المشترك فيها الطالب
    const coursesRes = await pool.query(
      `SELECT c.id, c.title FROM enrollments e JOIN courses c ON e.course_id = c.id WHERE e.user_id = $1`,
      [studentId],
    );
    const courses = coursesRes.rows;
    const allExams: any[] = [];
    for (const course of courses) {
      // 1. امتحانات المحاضرات (Lecture Exams)
      const lecturesRes = await pool.query(`SELECT l.id FROM lectures l WHERE l.course_id = $1`, [
        course.id,
      ]);
      const lectureIds = lecturesRes.rows.map((l: any) => l.id);
      if (lectureIds.length) {
        const lectureExamsRes = await pool.query(
          `SELECT e.id, e.title, e.total_grade, e.lecture_id, e.created_at 
           FROM exams e 
           WHERE e.lecture_id = ANY($1::int[]) AND e.type = 'exam'`,
          [lectureIds],
        );
        for (const exam of lectureExamsRes.rows) {
          const subRes = await pool.query(
            `SELECT total_grade, passed, submitted_at FROM exam_submissions WHERE exam_id = $1 AND student_id = $2`,
            [exam.id, studentId],
          );
          allExams.push({
            course_id: course.id,
            course_title: course.title,
            exam_id: exam.id,
            exam_type: 'lecture',
            exam_title: exam.title,
            total_grade: exam.total_grade,
            submitted_at: subRes.rowCount ? subRes.rows[0].submitted_at : null,
            student_grade: subRes.rowCount ? subRes.rows[0].total_grade : null,
            passed: subRes.rowCount ? subRes.rows[0].passed : null,
            status: subRes.rowCount ? 'submitted' : 'not_submitted',
            lecture_id: exam.lecture_id,
          });
        }
      }

      // 2. الامتحانات الشاملة (Comprehensive Exams - course_level_exams)
      const comprehensiveExamsRes = await pool.query(
        `SELECT e.id, e.title, e.questions_count as total_grade, e.created_at, e.is_active, e.is_visible_to_students
         FROM course_level_exams e
         WHERE e.course_id = $1 AND e.is_active = true AND e.is_visible_to_students = true`,
        [course.id]
      );

      for (const exam of comprehensiveExamsRes.rows) {
        // التحقق من وجود محاولة ناجحة أو درجات
        const subRes = await pool.query(
          `SELECT total_grade, obtained_grade, submitted_at, status 
           FROM course_level_exam_attempts 
           WHERE exam_id = $1 AND student_id = $2 AND status = 'submitted'
           ORDER BY submitted_at DESC LIMIT 1`,
          [exam.id, studentId]
        );

        // حساب النجاح (50% من الدرجة)
        const passed = subRes.rowCount ? (subRes.rows[0].obtained_grade >= (subRes.rows[0].total_grade / 2)) : null;

        allExams.push({
          course_id: course.id,
          course_title: course.title,
          exam_id: exam.id,
          exam_type: 'comprehensive', // course_level_exams
          exam_title: exam.title,
          total_grade: subRes.rowCount ? subRes.rows[0].total_grade : exam.total_grade, // Use attempt total if available, else exam total questions
          submitted_at: subRes.rowCount ? subRes.rows[0].submitted_at : null,
          student_grade: subRes.rowCount ? subRes.rows[0].obtained_grade : null,
          passed: passed,
          status: subRes.rowCount ? 'submitted' : 'not_submitted',
        });
      }

      // 3. امتحانات الكورس (Course Exams - course_exams)
      const courseExamsRes = await pool.query(
        `SELECT e.id, e.title, e.total_grade, e.created_at, e.is_visible
         FROM course_exams e
         WHERE e.course_id = $1 AND e.is_visible = true`,
        [course.id]
      );

      for (const exam of courseExamsRes.rows) {
        const subRes = await pool.query(
          `SELECT total_grade, passed, submitted_at, attempts_count 
           FROM course_exam_submissions 
           WHERE exam_id = $1 AND student_id = $2`,
          [exam.id, studentId]
        );

        allExams.push({
          course_id: course.id,
          course_title: course.title,
          exam_id: exam.id,
          exam_type: 'course_exam', // course_exams
          exam_title: exam.title,
          total_grade: exam.total_grade,
          submitted_at: subRes.rowCount ? subRes.rows[0].submitted_at : null,
          student_grade: subRes.rowCount ? subRes.rows[0].total_grade : null,
          passed: subRes.rowCount ? !!subRes.rows[0].passed : null,
          status: subRes.rowCount ? 'submitted' : 'not_submitted',
        });
      }
    }

    // ترتيب الامتحانات حسب تاريخ التقديم (الأحدث) ثم تاريخ الإنشاء
    allExams.sort((a, b) => {
      const dateA = a.submitted_at ? new Date(a.submitted_at).getTime() : 0;
      const dateB = b.submitted_at ? new Date(b.submitted_at).getTime() : 0;
      return dateB - dateA;
    });

    res.json({ exams: allExams });
  }),
);

// إحصائيات وتفاصيل الطلاب في الكورس للمدرس
router.get(
  '/:courseId/students-progress',
  authMiddleware(['teacher', 'admin']),
  asyncWrapper(async (req, res) => {
    try {
      const courseId = Number(req.params.courseId);
      if (isNaN(courseId)) {
        return res.status(400).json({ message: 'Invalid courseId' });
      }

      // تحقق من دور المستخدم
      if (!['teacher', 'admin'].includes(req.user!.role)) {
        return res.status(403).json({
          message: 'غير مصرح - مطلوب دور teacher أو admin',
          details: {
            user_id: req.user!.id,
            user_role: req.user!.role,
            required_roles: ['teacher', 'admin'],
          },
        });
      }
      // تحقق أن المدرس يملك الكورس أو admin
      if (req.user!.role === 'teacher') {
        const courseCheck = await pool.query('SELECT id, teacher_id FROM courses WHERE id = $1', [
          courseId,
        ]);
        if (!courseCheck.rowCount) {
          return res.status(404).json({
            message: 'الكورس غير موجود',
            details: {
              user_id: req.user!.id,
              user_role: req.user!.role,
              course_id: courseId,
            },
          });
        }

        if (courseCheck.rows[0].teacher_id !== req.user!.id) {
          return res.status(403).json({
            message: 'غير مصرح - الكورس لا يخصك',
            details: {
              user_id: req.user!.id,
              user_role: req.user!.role,
              course_id: courseId,
              course_owner: courseCheck.rows[0].teacher_id,
              required_role: 'teacher أو admin',
            },
          });
        }
      }
      // استعلام واحد شامل لجلب جميع البيانات المطلوبة
      const comprehensiveDataRes = await pool.query(
        `
        WITH course_data AS (
          -- جلب بيانات الكورس الأساسية
          SELECT 
            c.id as course_id,
            c.title as course_title,
            COUNT(DISTINCT l.id) as total_lectures,
            COUNT(DISTINCT lv.id) as total_videos,
            COUNT(DISTINCT le.id) as total_lecture_exams
          FROM courses c
          LEFT JOIN lectures l ON c.id = l.course_id
          LEFT JOIN lecture_videos lv ON l.id = lv.lecture_id
          LEFT JOIN exams le ON l.id = le.lecture_id AND le.type = 'exam'
          WHERE c.id = $1
          GROUP BY c.id, c.title
        ),
        students_data AS (
          -- جلب بيانات الطلاب مع إحصائياتهم
          SELECT 
            u.id as student_id,
            u.name as student_name,
            u.email as student_email,
            u.phone as student_phone,
            u.parent_phone as student_parent_phone,
            e.enrolled_at,
            -- إحصائيات المحاضرات
            COUNT(DISTINCT lv_views.lecture_id) as watched_lectures_count,
            -- إحصائيات الفيديوهات
            COUNT(DISTINCT vv.video_id) as watched_videos_count,
            COUNT(DISTINCT CASE WHEN vv.is_completed THEN vv.video_id END) as completed_videos_count,
            -- إحصائيات امتحانات المحاضرات
            COUNT(DISTINCT les.exam_id) as solved_lecture_exams_count
          FROM enrollments e
          JOIN users u ON e.user_id = u.id
          LEFT JOIN lecture_views lv_views ON u.id = lv_views.user_id AND lv_views.lecture_id IN (
            SELECT id FROM lectures WHERE course_id = $1
          )
          LEFT JOIN video_views vv ON u.id = vv.user_id AND vv.course_id = $1
          LEFT JOIN exam_submissions les ON u.id = les.student_id AND les.exam_id IN (
            SELECT id FROM exams WHERE lecture_id IN (SELECT id FROM lectures WHERE course_id = $1) AND type = 'exam'
          )
          WHERE e.course_id = $1
          GROUP BY u.id, u.name, u.email, u.phone, u.parent_phone, e.enrolled_at
        )
        SELECT 
          cd.*,
          sd.student_id,
          sd.student_name,
          sd.student_email,
          sd.student_phone,
          sd.student_parent_phone,
          sd.enrolled_at,
          sd.watched_lectures_count,
          sd.watched_videos_count,
          sd.completed_videos_count,
          sd.solved_lecture_exams_count
        FROM course_data cd
        CROSS JOIN students_data sd
        ORDER BY sd.student_name
      `,
        [courseId],
      );

      if (!comprehensiveDataRes.rowCount) {
        return res.status(404).json({ message: 'لا توجد بيانات للكورس المحدد' });
      }

      // تجميع البيانات
      const courseData = comprehensiveDataRes.rows[0];
      const students = comprehensiveDataRes.rows.map((row) => ({
        id: row.student_id,
        name: row.student_name,
        email: row.student_email,
        phone: row.student_phone ?? null,
        parent_phone: row.student_parent_phone ?? null,
        enrolled_at: row.enrolled_at,
        watched_lectures_count: parseInt(row.watched_lectures_count) || 0,
        watched_videos_count: parseInt(row.watched_videos_count) || 0,
        completed_videos_count: parseInt(row.completed_videos_count) || 0,
        solved_lecture_exams_count: parseInt(row.solved_lecture_exams_count) || 0,
      }));

      // جلب تفاصيل المحاضرات والفيديوهات والامتحانات (استعلامات منفصلة سريعة)
      const [lecturesRes, videosRes, lectureExamsRes] = await Promise.all([
        pool.query('SELECT id, title FROM lectures WHERE course_id = $1 ORDER BY position', [
          courseId,
        ]),
        pool.query(
          `
          SELECT lv.id, lv.title, lv.position, lv.lecture_id, l.title as lecture_title
          FROM lecture_videos lv
          JOIN lectures l ON lv.lecture_id = l.id
          WHERE l.course_id = $1
          ORDER BY l.position, lv.position
        `,
          [courseId],
        ),
        pool.query(
          `
          SELECT e.id, e.title, e.lecture_id
          FROM exams e
          JOIN lectures l ON e.lecture_id = l.id
          WHERE l.course_id = $1 AND e.type = 'exam'
        `,
          [courseId],
        ),
      ]);

      const lectures = lecturesRes.rows;
      const videos = videosRes.rows;
      const lectureExams = lectureExamsRes.rows;
      // جلب تفاصيل الفيديوهات والامتحانات لكل طالب
      const [videoViewsRes, lectureExamResultsRes] = await Promise.all([
        pool.query(
          `
          SELECT 
            vv.user_id,
            vv.video_id,
            vv.lecture_id,
            vv.watch_duration,
            vv.completion_percentage,
            vv.is_completed,
            vv.viewed_at,
            lv.title as video_title,
            lv.position as video_position,
            l.title as lecture_title,
            -- حساب أن الطالب شاهد الفيديو إذا كان له أي سجل في video_views
            CASE WHEN vv.user_id IS NOT NULL THEN true ELSE false END as has_watched
          FROM video_views vv
          JOIN lecture_videos lv ON vv.video_id = lv.id
          JOIN lectures l ON lv.lecture_id = l.id
          WHERE vv.course_id = $1
        `,
          [courseId],
        ),
        pool.query(
          `
          SELECT 
            es.student_id,
            es.exam_id,
            es.total_grade as obtained_grade,
            es.total_grade,
            es.submitted_at,
            es.passed,
            e.title as exam_title,
            e.lecture_id,
            l.title as lecture_title
          FROM exam_submissions es
          JOIN exams e ON es.exam_id = e.id
          JOIN lectures l ON e.lecture_id = l.id
          WHERE l.course_id = $1 AND e.type = 'exam'
        `,
          [courseId],
        ),
      ]);

      // تجهيز النتائج مع التفاصيل المطلوبة
      const studentsDetails = students.map((student) => {
        const totalLectures = parseInt(courseData.total_lectures) || 0;
        const totalVideos = parseInt(courseData.total_videos) || 0;
        const totalLectureExams = parseInt(courseData.total_lecture_exams) || 0;

        // الفيديوهات التي شاهدها الطالب (إذا كان له أي سجل في video_views)
        const watchedVideos = videoViewsRes.rows
          .filter((v) => v.user_id === student.id)
          .map((v) => ({
            id: v.video_id,
            title: v.video_title,
            lecture_id: v.lecture_id,
            lecture_title: v.lecture_title,
            position: v.video_position,
            watch_duration: v.watch_duration,
            completion_percentage: v.completion_percentage,
            is_completed: v.is_completed,
            viewed_at: v.viewed_at,
            has_watched: true, // تأكيد أن الطالب شاهد الفيديو
          }));

        // الفيديوهات التي لم يشاهدها الطالب (ليس له أي سجل في video_views)
        const notWatchedVideos = videos
          .filter(
            (v) =>
              !videoViewsRes.rows.some((vv) => vv.user_id === student.id && vv.video_id === v.id),
          )
          .map((v) => ({
            id: v.id,
            title: v.title,
            lecture_id: v.lecture_id,
            lecture_title: v.lecture_title,
            position: v.position,
            has_watched: false, // تأكيد أن الطالب لم يشاهد الفيديو
          }));

        // حساب المحاضرات المشاهدة وغير المشاهدة بناءً على video_views (33% من الفيديوهات)
        const watchedLectures: any[] = [];
        const notWatchedLectures: any[] = [];

        lectures.forEach((lecture) => {
          const lectureVideos = videos.filter((v) => v.lecture_id === lecture.id);
          const studentWatchedVideos = watchedVideos.filter((v) => v.lecture_id === lecture.id);
          const totalLectureVideos = lectureVideos.length;
          const watchedCount = studentWatchedVideos.length;

          // حساب نسبة المشاهدة (33% = محاضرة اتشاهدت)
          const watchPercentage =
            totalLectureVideos > 0 ? (watchedCount / totalLectureVideos) * 100 : 0;
          // المحاضرة اتشاهدت إذا: شاهد 33% من الفيديوهات أو أكثر، أو إذا كان له أي سجل في video_views
          const isWatched = watchPercentage >= 33.33 || watchedCount > 0;

          const lectureData = {
            id: lecture.id,
            title: lecture.title,
            position: lecture.position || 0,
            total_videos: totalLectureVideos,
            watched_videos: watchedCount,
            remaining_videos: totalLectureVideos - watchedCount,
            watch_percentage: Math.round(watchPercentage * 100) / 100,
            is_watched: isWatched,
          };

          if (isWatched) {
            watchedLectures.push(lectureData);
          } else {
            notWatchedLectures.push(lectureData);
          }
        });

        // امتحانات المحاضرات التي حلها الطالب مع الدرجات
        const solvedLectureExams = lectureExamResultsRes.rows
          .filter((e) => e.student_id === student.id)
          .map((e) => ({
            id: e.exam_id,
            title: e.exam_title,
            lecture_id: e.lecture_id,
            lecture_title: e.lecture_title,
            grade: e.obtained_grade || e.total_grade, // الدرجة المحققة
            total_grade: e.total_grade,
            passed: e.passed,
            submitted_at: e.submitted_at,
          }));

        // امتحانات المحاضرات التي لم يحلها الطالب
        const notSolvedLectureExams = lectureExams
          .filter((e) => !solvedLectureExams.some((se) => se.id === e.id))
          .map((e) => ({
            id: e.id,
            title: e.title,
            lecture_id: e.lecture_id,
            lecture_title: lectures.find((l) => l.id === e.lecture_id)?.title || '',
          }));

        return {
          id: student.id,
          name: student.name,
          email: student.email,
          phone: student.phone,
          parent_phone: student.parent_phone,
          enrolled_at: student.enrolled_at,
          // إحصائيات المحاضرات
          watched_lectures_count: watchedLectures.length,
          total_lectures: totalLectures,
          lectures_completion_percentage: totalLectures > 0 ?
            Math.round((watchedLectures.length / totalLectures) * 100 * 100) / 100 : 0,
          // تفاصيل المحاضرات (المشاهدة وغير المشاهدة)
          watched_lectures: watchedLectures,
          not_watched_lectures: notWatchedLectures,
          // إحصائيات الفيديوهات (بناءً على وجود سجل في video_views)
          watched_videos_count: watchedVideos.length,
          completed_videos_count: watchedVideos.filter((v) => v.is_completed).length,
          total_videos: totalVideos,
          videos_completion_percentage: totalVideos > 0 ?
            Math.round((watchedVideos.length / totalVideos) * 100 * 100) / 100 : 0,
          // تفاصيل الفيديوهات
          watched_videos: watchedVideos,
          not_watched_videos: notWatchedVideos,
          // إحصائيات امتحانات المحاضرات
          solved_lecture_exams_count: student.solved_lecture_exams_count,
          total_lecture_exams: totalLectureExams,
          lecture_exams_completion_percentage: totalLectureExams > 0 ?
            Math.round((student.solved_lecture_exams_count / totalLectureExams) * 100 * 100) / 100 : 0,
          // تفاصيل امتحانات المحاضرات
          solved_lecture_exams: solvedLectureExams,
          not_solved_lecture_exams: notSolvedLectureExams,
        };
      });
      // الطلاب الذين أكملوا الكورس (شاهد كل المحاضرات)
      const completedStudents = studentsDetails
        .filter((s) => s.watched_lectures_count === s.total_lectures)
        .map((s) => s.id);

      // إحصائيات الكورس
      const course_stats = {
        total_lectures: parseInt(courseData.total_lectures) || 0,
        total_videos: parseInt(courseData.total_videos) || 0,
        total_lecture_exams: parseInt(courseData.total_lecture_exams) || 0,
        total_students: students.length,
      };

      res.json({
        total_students: students.length,
        completed_students: completedStudents.length,
        course_stats,
        students_details: studentsDetails,
      });
    } catch (err) {
      console.error('students-progress error:', err);
      res.status(500).json({ message: 'Internal error', error: String(err) });
    }
  }),
);

// جلب تفاصيل الطلاب الذين حلوا امتحان محاضرة معينة (للأستاذ فقط)
router.get(
  '/lecture-exam/:examId/submissions',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const examId = Number(req.params.examId);
    if (isNaN(examId)) {
      return res.status(400).json({ message: 'Invalid examId' });
    }
    // تحقق أن الامتحان يخص المدرس
    const examRes = await pool.query(
      `SELECT e.*, l.course_id FROM exams e JOIN lectures l ON e.lecture_id = l.id WHERE e.id = $1`,
      [examId],
    );
    if (!examRes.rowCount) {
      return res.status(404).json({ message: 'Lecture exam not found' });
    }
    const courseId = examRes.rows[0].course_id;
    const courseCheck = await pool.query(
      'SELECT id FROM courses WHERE id = $1 AND teacher_id = $2',
      [courseId, req.user!.id],
    );
    if (!courseCheck.rowCount) {
      return res.status(403).json({ message: 'Not allowed' });
    }
    // جلب تفاصيل الطلاب الذين حلوا الامتحان
    const subsRes = await pool.query(
      `SELECT s.id as submission_id, s.student_id, s.total_grade, s.submitted_at, s.passed, u.name, u.email, u.phone
       FROM exam_submissions s
       JOIN users u ON s.student_id = u.id
       WHERE s.exam_id = $1
       ORDER BY s.submitted_at DESC`,
      [examId],
    );
    res.json({ submissions: subsRes.rows });
  }),
);

// تسليم امتحان الكورس — للطالب فقط (نفس منطق POST /api/exams/:examId/submit)
router.post(
  '/course-exam/:examId/submit',
  authMiddleware(['student']),
  asyncWrapper(async (req, res) => {
    const examId = Number(req.params.examId);
    if (Number.isNaN(examId)) {
      return res.status(400).json({ message: 'Invalid exam id' });
    }
    let attemptId = req.body.attemptId ?? req.body.attempt_id;
    let answers: Array<{ questionId?: number; question_id?: number; selectedAnswer?: string; selected_answer?: string; answer?: string; choice?: string; option?: string; selectedOption?: string; response?: string; value?: string | number }> = [];
    if (Array.isArray(req.body.answers) && req.body.answers.length > 0) {
      answers = req.body.answers.filter((a: any) => a != null);
    } else if (
      Array.isArray(req.body.questionIds) &&
      Array.isArray(req.body.selectedAnswers) &&
      req.body.questionIds.length === req.body.selectedAnswers.length
    ) {
      answers = req.body.questionIds.map((qId: number, i: number) => ({
        questionId: qId,
        selectedAnswer: req.body.selectedAnswers[i],
      }));
    } else if (req.body.answers && typeof req.body.answers === 'object' && !Array.isArray(req.body.answers)) {
      answers = Object.entries(req.body.answers).map(([qId, choice]) => ({
        questionId: Number(qId),
        selectedAnswer: choice as string,
      }));
    }
    if (answers.length === 0) {
      return res.status(400).json({
        message:
          'answers required: send answers as array of { questionId, selectedAnswer }, or questionIds + selectedAnswers arrays, or answers as { "questionId": "A", ... }',
      });
    }
    if (!attemptId) {
      const activeRes = await pool.query(
        `SELECT id FROM course_level_exam_attempts
         WHERE exam_id = $1 AND student_id = $2 AND status = 'in_progress'
         ORDER BY started_at DESC LIMIT 1`,
        [examId, req.user!.id],
      );
      if (!activeRes.rowCount) {
        return res.status(400).json({
          message: 'attemptId is required, or start the exam first (POST /api/exams/:examId/start)',
        });
      }
      attemptId = activeRes.rows[0].id;
    }
    const validatedAnswers: { questionId: number; selectedAnswer: 'A' | 'B' | 'C' | 'D' }[] = [];
    const validAnswers = ['A', 'B', 'C', 'D'];
    for (const answer of answers) {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-expect-error
      const questionId = Number(answer.questionId ?? answer.question_id ?? answer.id);
      let selectedAnswer: string | number | undefined =
        answer.selectedAnswer ??
        answer.selected_answer ??
        answer.answer ??
        answer.choice ??
        answer.option ??
        answer.selectedOption ??
        answer.response ??
        answer.value ??
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error
        answer.selected ??
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error
        answer.selectedIndex ?? answer.index;
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-expect-error
      if (selectedAnswer === undefined && (answer.optionA || answer.optionB || answer.optionC || answer.optionD)) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error
        if (answer.optionA) selectedAnswer = 'A';
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error
        else if (answer.optionB) selectedAnswer = 'B';
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error
        else if (answer.optionC) selectedAnswer = 'C';
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error
        else if (answer.optionD) selectedAnswer = 'D';
      }
      if (typeof selectedAnswer === 'string') {
        selectedAnswer = selectedAnswer.trim().toUpperCase();
        if (selectedAnswer.startsWith('OPTION')) {
          const letter = selectedAnswer.slice(-1);
          if (['A', 'B', 'C', 'D'].includes(letter)) selectedAnswer = letter;
        }
      } else if (typeof selectedAnswer === 'number' && selectedAnswer >= 0 && selectedAnswer <= 3) {
        selectedAnswer = validAnswers[selectedAnswer];
      }
      if (Number.isNaN(questionId) || questionId <= 0) {
        return res.status(400).json({ message: 'Invalid questionId in answers' });
      }
      if (selectedAnswer === undefined || selectedAnswer === '' || !validAnswers.includes(selectedAnswer as string)) {
        return res.status(400).json({
          message:
            'Each answer must include the selected option: use selectedAnswer (or selected_answer, answer, choice, option) with value A/B/C/D or a/b/c/d or 0/1/2/3. Received for questionId ' +
            questionId +
            ': ' +
            JSON.stringify(answer),
        });
      }
      validatedAnswers.push({ questionId, selectedAnswer: (selectedAnswer as string) as 'A' | 'B' | 'C' | 'D' });
    }
    try {
      const result = await CourseLevelExamsService.submitExamAttempt(
        examId,
        req.user!.id,
        Number(attemptId),
        validatedAnswers,
      );
      return res.json(result);
    } catch (error: any) {
      if (error.status) {
        return res.status(error.status).json({ message: error.message });
      }
      console.error('Error submitting course exam:', error);
      return res.status(500).json({ message: 'Failed to submit exam attempt' });
    }
  }),
);

// جلب تفاصيل الطلاب الذين حلوا امتحان الكورس الشامل (للأستاذ فقط)
router.get(
  '/course-exam/:examId/submissions',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const examId = Number(req.params.examId);
    if (isNaN(examId)) {
      return res.status(400).json({ message: 'Invalid examId' });
    }
    // تحقق أن الامتحان يخص المدرس
    const examRes = await pool.query(
      `SELECT e.*, c.id as course_id, c.teacher_id
       FROM course_level_exams e
       JOIN courses c ON e.course_id = c.id
       WHERE e.id = $1`,
      [examId],
    );
    if (!examRes.rowCount) {
      return res.status(404).json({ message: 'Course exam not found' });
    }
    const exam = examRes.rows[0];
    // تحقق أن المدرس يملك الكورس
    if (exam.teacher_id !== req.user!.id) {
      return res.status(403).json({ message: 'Not allowed' });
    }
    // جلب تفاصيل الطلاب الذين حلوا الامتحان
    const subsRes = await pool.query(
      `SELECT 
         a.id as submission_id,
         a.student_id,
         a.attempt_number,
         a.total_grade,
         a.obtained_grade,
         a.submitted_at,
         CASE WHEN a.obtained_grade >= (a.total_grade * 0.5) THEN true ELSE false END as passed,
         u.name,
         u.email,
         u.phone
       FROM course_level_exam_attempts a
       JOIN users u ON a.student_id = u.id
       WHERE a.exam_id = $1 AND a.status = 'submitted'
       ORDER BY a.submitted_at DESC`,
      [examId],
    );
    res.json({ submissions: subsRes.rows });
  }),
);

// جلب تقرير تفصيلي عن امتحان الكورس الشامل (للأستاذ فقط)
router.get(
  '/course-exam/:examId/report',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const examId = Number(req.params.examId);
    if (isNaN(examId)) {
      return res.status(400).json({ message: 'Invalid examId' });
    }

    try {
      const result = await CourseLevelExamsService.getExamReport(examId, req.user!);
      res.json(result);
    } catch (error: any) {
      if (error.status) {
        return res.status(error.status).json({ message: error.message });
      }
      console.error('Error fetching exam report:', error);
      res.status(500).json({ message: 'Failed to fetch exam report' });
    }
  }),
);

// جلب رابط الفيديو فقط (للطلاب المشتركين في الكورس أو المدرس صاحب الكورس)
router.get(
  '/video/:videoId',
  authMiddleware(),
  asyncWrapper(async (req, res) => {
    const videoId = Number(req.params.videoId);
    const userId = req.user!.id;
    const userRole = req.user!.role;

    // جلب معلومات الفيديو والمحاضرة والكورس (يدعم lectures و course_lectures)
    let videoInfo: any = null;
    let courseId: number | null = null;

    // التحقق من lecture_videos أولاً (للكورسات العادية)
    const videoResult = await pool.query(
      `SELECT 
        lv.id,
        lv.video_url,
        lv.title as video_title,
        lv.position,
        l.id as lecture_id,
        l.title as lecture_title,
        c.id as course_id,
        c.title as course_title,
        c.teacher_id
      FROM lecture_videos lv
      JOIN lectures l ON lv.lecture_id = l.id
      JOIN courses c ON l.course_id = c.id
      WHERE lv.id = $1`,
      [videoId],
    );

    if (videoResult.rowCount) {
      videoInfo = videoResult.rows[0];
      courseId = videoInfo.course_id;
    } else {
      // التحقق من course_lectures (للكورسات في المواد الدراسية)
      // ملاحظة: course_lectures تستخدم video_url مباشرة في الجدول، لا يوجد جدول منفصل للفيديوهات
      // لكن يمكن إضافة دعم لاحقاً إذا لزم الأمر
      return res.status(404).json({ message: 'Video not found' });
    }

    if (!videoInfo || !courseId) {
      return res.status(404).json({ message: 'Video not found' });
    }

    // التحقق من صلاحية الوصول للكورس (يدعم جميع أنواع الكورسات)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { canAccessCourseContent } = require('../utils/courseAccess');
    const hasAccess = await canAccessCourseContent(courseId, userId, userRole);

    if (!hasAccess) {
      return res.status(403).json({ message: 'ليس لديك صلاحية لمشاهدة هذا الفيديو' });
    }

    // للطالب: التحقق من أن المحاضرة غير مقفلة (امتحان سابق بـ "قفل المحاضرات التالية" لم يُنجَح فيه بعد)
    if (userRole === 'student') {
      const canAccessLecture = await LectureExamService.canStudentAccessLecture(
        videoInfo.lecture_id,
        userId,
      );
      if (!canAccessLecture) {
        return res.status(403).json({
          message: 'المحاضرة مقفولة حتى تنجح في الامتحان السابق',
        });
      }
    }

    const video = videoInfo;

    let viewTracking: {
      view_tracked: boolean;
      lecture_view_tracked: boolean;
      is_first_video_view?: boolean;
      lecture_points_awarded?: boolean;
      lecture_watch_percentage?: number;
    } | null = null;

    // تسجيل المشاهدة تلقائياً للطالب عند جلب رابط الفيديو
    if (userRole === 'student') {
      try {
        const tracking = await VideoViewTrackingService.trackStudentVideoView({
          userId,
          videoId,
          lectureId: video.lecture_id,
          courseId: video.course_id,
          lectureTitle: video.lecture_title,
        });
        viewTracking = {
          view_tracked: tracking.viewTracked,
          lecture_view_tracked: tracking.lectureViewTracked,
          is_first_video_view: tracking.isFirstVideoView,
          lecture_points_awarded: tracking.lecturePointsAwarded,
          lecture_watch_percentage: tracking.lectureWatchPercentage,
        };
      } catch (error) {
        console.error('Error auto-tracking video view:', error);
        viewTracking = {
          view_tracked: false,
          lecture_view_tracked: false,
        };
      }
    }

    res.json({
      video_url: video.video_url,
      message: 'تم جلب رابط الفيديو بنجاح',
      ...(viewTracking ?? {}),
    });
  }),
);

// تسجيل مشاهدة فيديو (للطلاب المشتركين في الكورس)
router.post(
  '/video/:videoId/track-view',
  authMiddleware(['student']),
  asyncWrapper(async (req, res) => {
    const videoId = Number(req.params.videoId);
    const userId = req.user!.id;
    const { watch_duration, completion_percentage, is_completed } = req.body;

    if (isNaN(videoId)) {
      return res.status(400).json({ message: 'Invalid video ID' });
    }

    // جلب معلومات الفيديو والمحاضرة والكورس
    const videoResult = await pool.query(
      `SELECT 
        lv.id,
        lv.lecture_id,
        l.course_id
      FROM lecture_videos lv
      JOIN lectures l ON lv.lecture_id = l.id
      WHERE lv.id = $1`,
      [videoId],
    );

    if (!videoResult.rowCount) {
      return res.status(404).json({ message: 'الفيديو غير موجود' });
    }

    const video = videoResult.rows[0];

    // تحقق أن الطالب مشترك في الكورس
    const enrollmentCheck = await pool.query(
      'SELECT id FROM enrollments WHERE user_id = $1 AND course_id = $2',
      [userId, video.course_id],
    );

    if (!enrollmentCheck.rowCount) {
      return res.status(403).json({ message: 'ليس لديك صلاحية لمشاهدة هذا الفيديو' });
    }

    try {
      const tracking = await VideoViewTrackingService.trackStudentVideoView({
        userId,
        videoId,
        lectureId: video.lecture_id,
        courseId: video.course_id,
        watchDuration: watch_duration || 0,
        completionPercentage: completion_percentage || 0,
        isCompleted: is_completed || false,
        updateProgress: true,
      });

      const viewResult = await pool.query(
        'SELECT * FROM video_views WHERE user_id = $1 AND video_id = $2',
        [userId, videoId],
      );

      res.json({
        message: 'تم تسجيل المشاهدة بنجاح',
        view: viewResult.rows[0],
        view_tracked: tracking.viewTracked,
        lecture_view_tracked: tracking.lectureViewTracked,
        is_first_video_view: tracking.isFirstVideoView,
        lecture_points_awarded: tracking.lecturePointsAwarded,
      });
    } catch (error) {
      console.error('Error tracking video view:', error);
      res.status(500).json({ message: 'خطأ في تسجيل المشاهدة' });
    }
  }),
);

// إحصائيات سريعة للكورس (للمدرس أو الأدمن) - نسخة محسنة للأداء
router.get(
  '/:courseId/students-progress-summary',
  authMiddleware(['teacher', 'admin']),
  asyncWrapper(async (req, res) => {
    try {
      const courseId = Number(req.params.courseId);
      if (isNaN(courseId)) {
        return res.status(400).json({ message: 'Invalid courseId' });
      }

      // تحقق من الصلاحيات
      if (req.user!.role === 'teacher') {
        const courseCheck = await pool.query('SELECT id, teacher_id FROM courses WHERE id = $1', [
          courseId,
        ]);
        if (!courseCheck.rowCount || courseCheck.rows[0].teacher_id !== req.user!.id) {
          return res.status(403).json({ message: 'ليس لديك صلاحية للوصول لهذا الكورس' });
        }
      }

      // استعلام واحد سريع للحصول على الإحصائيات الأساسية فقط
      const summaryRes = await pool.query(
        `
        SELECT 
          -- إحصائيات الكورس
          COUNT(DISTINCT l.id) as total_lectures,
          COUNT(DISTINCT lv.id) as total_videos,
          COUNT(DISTINCT le.id) as total_lecture_exams,
          COUNT(DISTINCT e.user_id) as total_students,
          
          -- إحصائيات التقدم
          COUNT(DISTINCT CASE WHEN lv_views.user_id IS NOT NULL THEN e.user_id END) as students_with_lecture_views,
          COUNT(DISTINCT CASE WHEN vv.user_id IS NOT NULL THEN e.user_id END) as students_with_video_views,
          COUNT(DISTINCT CASE WHEN les.student_id IS NOT NULL THEN e.user_id END) as students_with_lecture_exam_submissions,
          
          -- متوسطات التقدم
          ROUND(AVG(lecture_progress.lecture_completion_percentage), 2) as avg_lecture_completion,
          ROUND(AVG(video_progress.video_completion_percentage), 2) as avg_video_completion,
          ROUND(AVG(exam_progress.exam_completion_percentage), 2) as avg_exam_completion
        FROM courses c
        LEFT JOIN lectures l ON c.id = l.course_id
        LEFT JOIN lecture_videos lv ON l.id = lv.lecture_id
        LEFT JOIN exams le ON l.id = le.lecture_id AND le.type = 'exam'
        LEFT JOIN enrollments e ON c.id = e.course_id
        LEFT JOIN lecture_views lv_views ON e.user_id = lv_views.user_id AND lv_views.lecture_id = l.id
        LEFT JOIN video_views vv ON e.user_id = vv.user_id AND vv.course_id = c.id
        LEFT JOIN exam_submissions les ON e.user_id = les.student_id AND les.exam_id = le.id
        LEFT JOIN LATERAL (
          SELECT 
            CASE 
              WHEN COUNT(DISTINCT l2.id) > 0 
              THEN (COUNT(DISTINCT lv_views2.lecture_id)::float / COUNT(DISTINCT l2.id)) * 100 
              ELSE 0 
            END as lecture_completion_percentage
          FROM lectures l2
          LEFT JOIN lecture_views lv_views2 ON e.user_id = lv_views2.user_id AND lv_views2.lecture_id = l2.id
          WHERE l2.course_id = c.id
        ) lecture_progress ON true
        LEFT JOIN LATERAL (
          SELECT 
            CASE 
              WHEN COUNT(DISTINCT lv2.id) > 0 
              THEN (COUNT(DISTINCT vv2.video_id)::float / COUNT(DISTINCT lv2.id)) * 100 
              ELSE 0 
            END as video_completion_percentage
          FROM lecture_videos lv2
          JOIN lectures l3 ON lv2.lecture_id = l3.id
          LEFT JOIN video_views vv2 ON e.user_id = vv2.user_id AND vv2.video_id = lv2.id
          WHERE l3.course_id = c.id
        ) video_progress ON true
        LEFT JOIN LATERAL (
          SELECT 
            CASE 
              WHEN COUNT(DISTINCT le2.id) > 0 
              THEN (COUNT(DISTINCT les2.exam_id)::float / COUNT(DISTINCT le2.id)) * 100 
              ELSE 0 
            END as exam_completion_percentage
          FROM exams le2
          JOIN lectures l4 ON le2.lecture_id = l4.id
          LEFT JOIN exam_submissions les2 ON e.user_id = les2.student_id AND les2.exam_id = le2.id
          WHERE l4.course_id = c.id AND le2.type = 'exam'
        ) exam_progress ON true
        WHERE c.id = $1
        GROUP BY c.id
      `,
        [courseId],
      );

      if (!summaryRes.rowCount) {
        return res.status(404).json({ message: 'الكورس غير موجود' });
      }

      const summary = summaryRes.rows[0];

      res.json({
        course_id: courseId,
        total_lectures: parseInt(summary.total_lectures) || 0,
        total_videos: parseInt(summary.total_videos) || 0,
        total_lecture_exams: parseInt(summary.total_lecture_exams) || 0,
        total_students: parseInt(summary.total_students) || 0,
        students_with_lecture_views: parseInt(summary.students_with_lecture_views) || 0,
        students_with_video_views: parseInt(summary.students_with_video_views) || 0,
        students_with_lecture_exam_submissions:
          parseInt(summary.students_with_lecture_exam_submissions) || 0,
        avg_lecture_completion: parseFloat(summary.avg_lecture_completion) || 0,
        avg_video_completion: parseFloat(summary.avg_video_completion) || 0,
        avg_exam_completion: parseFloat(summary.avg_exam_completion) || 0,
      });
    } catch (err) {
      console.error('students-progress-summary error:', err);
      res.status(500).json({ message: 'Internal error', error: String(err) });
    }
  }),
);

// تقرير مفصل لطالب معين في الكورس (للمدرس أو الأدمن)
router.get(
  '/:courseId/student/:studentId/detailed-report',
  authMiddleware(['teacher', 'admin']),
  asyncWrapper(async (req, res) => {
    try {
      const courseId = Number(req.params.courseId);
      const studentId = Number(req.params.studentId);
      const userId = req.user!.id;
      const userRole = req.user!.role;

      if (isNaN(courseId) || isNaN(studentId)) {
        return res.status(400).json({ message: 'Invalid course ID or student ID' });
      }

      // تحقق من الصلاحيات
      if (userRole === 'teacher') {
        const courseCheck = await pool.query(
          'SELECT id, title, teacher_id FROM courses WHERE id = $1',
          [courseId],
        );
        if (!courseCheck.rowCount || courseCheck.rows[0].teacher_id !== userId) {
          return res.status(403).json({ message: 'ليس لديك صلاحية للوصول لهذا الكورس' });
        }
      }

      // جلب معلومات الطالب
      const studentRes = await pool.query(
        'SELECT id, name, email, phone FROM users WHERE id = $1 AND role = $2',
        [studentId, 'student'],
      );

      if (!studentRes.rowCount) {
        return res.status(404).json({ message: 'الطالب غير موجود' });
      }

      const student = studentRes.rows[0];

      // جلب معلومات الكورس
      const courseRes = await pool.query(
        'SELECT id, title, description, teacher_id FROM courses WHERE id = $1',
        [courseId],
      );

      if (!courseRes.rowCount) {
        return res.status(404).json({ message: 'الكورس غير موجود' });
      }

      const course = courseRes.rows[0];

      // تحقق أن الطالب مشترك في الكورس
      const enrollmentCheck = await pool.query(
        'SELECT enrolled_at FROM enrollments WHERE user_id = $1 AND course_id = $2',
        [studentId, courseId],
      );

      if (!enrollmentCheck.rowCount) {
        return res.status(404).json({ message: 'الطالب غير مشترك في هذا الكورس' });
      }

      // جلب المحاضرات
      const lecturesRes = await pool.query(
        'SELECT id, title, description, position FROM lectures WHERE course_id = $1 ORDER BY position',
        [courseId],
      );
      const lectures = lecturesRes.rows;

      // جلب الفيديوهات
      const videosRes = await pool.query(
        `SELECT lv.id, lv.title, lv.position, lv.video_url, l.id as lecture_id, l.title as lecture_title
         FROM lecture_videos lv
         JOIN lectures l ON lv.lecture_id = l.id
         WHERE l.course_id = $1
         ORDER BY l.position, lv.position`,
        [courseId],
      );
      const videos = videosRes.rows;

      // جلب مشاهدات المحاضرات
      const lectureViewsRes = await pool.query(
        'SELECT lecture_id, viewed_at FROM lecture_views WHERE user_id = $1 AND lecture_id = ANY($2::int[])',
        [studentId, lectures.map((l) => l.id)],
      );

      // جلب مشاهدات الفيديوهات
      const videoViewsRes = await pool.query(
        `SELECT 
          vv.video_id, 
          vv.lecture_id, 
          vv.watch_duration, 
          vv.completion_percentage, 
          vv.is_completed,
          vv.viewed_at,
          lv.title as video_title,
          lv.position as video_position,
          -- حساب أن الطالب شاهد الفيديو إذا كان له أي سجل
          CASE WHEN vv.user_id IS NOT NULL THEN true ELSE false END as has_watched
        FROM video_views vv
        JOIN lecture_videos lv ON vv.video_id = lv.id
        WHERE vv.user_id = $1 AND vv.course_id = $2`,
        [studentId, courseId],
      );

      // جلب امتحانات المحاضرات
      const lectureExamsRes = await pool.query(
        "SELECT id, title, lecture_id FROM exams WHERE lecture_id = ANY($1::int[]) AND type = 'exam'",
        [lectures.map((l) => l.id)],
      );
      const lectureExams = lectureExamsRes.rows;

      // جلب نتائج امتحانات المحاضرات
      const lectureExamResultsRes = await pool.query(
        'SELECT exam_id, total_grade, submitted_at FROM exam_submissions WHERE student_id = $1 AND exam_id = ANY($2::int[])',
        [studentId, lectureExams.map((e) => e.id)],
      );

      // التحقق من قفل كل محاضرة (امتحان بـ "قفل المحاضرات التالية" - لا تُفتح حتى النجاح)
      const lectureAccessChecks = await Promise.all(
        lectures.map((lecture) =>
          LectureExamService.canStudentAccessLecture(lecture.id, studentId),
        ),
      );
      const lectureCanAccessMap = new Map(
        lectures.map((l, i) => [l.id, lectureAccessChecks[i]]),
      );

      // تجهيز بيانات المحاضرات
      const lecturesData = lectures.map((lecture) => {
        const isWatched = lectureViewsRes.rows.some((v) => v.lecture_id === lecture.id);
        const watchedAt = isWatched ? lectureViewsRes.rows.find((v) => v.lecture_id === lecture.id)?.viewed_at : null;
        const isLocked = !(lectureCanAccessMap.get(lecture.id) ?? true);

        const lectureVideos = videos.filter((v) => v.lecture_id === lecture.id);
        const watchedVideos = videoViewsRes.rows.filter((v) => v.lecture_id === lecture.id);

        const lectureExamsForLecture = lectureExams.filter((e) => e.lecture_id === lecture.id);
        const examResults = lectureExamResultsRes.rows.filter((r) =>
          lectureExamsForLecture.some((e) => e.id === r.exam_id)
        );

        return {
          id: lecture.id,
          title: lecture.title,
          description: lecture.description,
          position: lecture.position,
          is_locked: isLocked,
          is_watched: isWatched,
          watched_at: watchedAt,
          videos: lectureVideos.map((video) => {
            const videoView = watchedVideos.find((v) => v.video_id === video.id);
            // الطالب شاهد الفيديو إذا كان له أي سجل في video_views
            const hasWatched = !!videoView;
            return {
              id: video.id,
              title: video.title,
              position: video.position,
              video_url: video.video_url,
              is_watched: hasWatched,
              has_watched: hasWatched, // تأكيد إضافي
              watch_duration: videoView?.watch_duration || 0,
              completion_percentage: videoView?.completion_percentage || 0,
              is_completed: videoView?.is_completed || false,
              viewed_at: videoView?.viewed_at || null,
            };
          }),
          exams: lectureExamsForLecture.map((exam) => {
            const result = examResults.find((r) => r.exam_id === exam.id);
            return {
              id: exam.id,
              title: exam.title,
              is_solved: !!result,
              grade: result?.total_grade || 0,
              submitted_at: result?.submitted_at || null,
            };
          }),
        };
      });

      // // حساب الإحصائيات
      // const totalLectures = lectures.length;
      // const watchedLectures = lecturesData.filter((l) => l.is_watched).length;
      // const totalVideos = videos.length;
      // const watchedVideos = videoViewsRes.rows.length;
      // const completedVideos = videoViewsRes.rows.filter((v) => v.is_completed).length;
      // const totalLectureExams = lectureExams.length;
      // const solvedLectureExams = lectureExamResultsRes.rows.length;

      // حساب متوسط الدرجات
      const lectureExamGrades = lectureExamResultsRes.rows.map((r) => r.total_grade);
      const averageLectureExamGrade = lectureExamGrades.length > 0
        ? lectureExamGrades.reduce((a, b) => a + b, 0) / lectureExamGrades.length
        : 0;

      res.json({
        student: {
          id: student.id,
          name: student.name,
          email: student.email,
          phone: student.phone,
        },
        course: {
          id: course.id,
          title: course.title,
          description: course.description,
        },
        enrollment_date: enrollmentCheck.rows[0].enrolled_at,
        progress_summary: {
          total_lectures: lectures.length,
          watched_lectures: lecturesData.filter((l) => l.is_watched).length,
          lectures_completion_percentage:
            lectures.length > 0
              ? (lecturesData.filter((l) => l.is_watched).length / lectures.length) * 100
              : 0,
          total_videos: videos.length,
          watched_videos: videoViewsRes.rows.length, // عدد الفيديوهات التي شاهدها الطالب (أي سجل في video_views)
          completed_videos: videoViewsRes.rows.filter((v) => v.is_completed).length,
          videos_completion_percentage:
            videos.length > 0 ? (videoViewsRes.rows.length / videos.length) * 100 : 0,
          total_lecture_exams: lectureExams.length,
          solved_lecture_exams: lectureExamResultsRes.rows.length,
          lecture_exams_completion_percentage:
            lectureExams.length > 0
              ? (lectureExamResultsRes.rows.length / lectureExams.length) * 100
              : 0,
          average_lecture_exam_grade: Math.round(averageLectureExamGrade * 100) / 100,
        },
        lectures: lecturesData,
      });
    } catch (error) {
      console.error('Detailed report error:', error);
      res.status(500).json({ message: 'خطأ في جلب التقرير المفصل' });
    }
  }),
);
