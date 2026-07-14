import { Router, Request } from 'express';
import { authMiddleware } from '../middleware/authentication';
import { validate } from '../middleware/validateReq';
import { asyncWrapper, HttpError, upload, uploadTeacherAvatar, uploadToCloudinary } from '../utils';
import bcrypt from 'bcrypt';
import pool from '../db/pool';
import { z } from 'zod';
import { TeacherActivityService } from '../services/teacherActivities';
import { TeacherActivityLogService } from '../services/teacherActivityLog';
import { TeacherDailyCourseReportService } from '../services/teacherDailyCourseReport';
import { TeacherGradesService } from '../services/users';
import { ExamFlowService } from '../services/examFlow';
import { CourseLevelExamsService } from '../services/courseLevelExams';
import { parseNumberInput } from '../utils/requestParsers';

export const router = Router();

function resolveTeacherIdForQuery(req: Request): number {
  const user = req.user!;
  if (user.role === 'admin') {
    const fromQuery = parseNumberInput(req.query.teacher_id as string | undefined);
    if (fromQuery) return fromQuery;
  }
  return user.id;
}

// جلب كل امتحانات المحاضرات للمدرس مع اسم المحاضرة والكورس
router.get(
  '/lecture-exams',
  authMiddleware(['teacher', 'admin']),
  asyncWrapper(async (req, res) => {
    const teacherId = resolveTeacherIdForQuery(req);
    const courseId = parseNumberInput(req.query.course_id as string | undefined);
    const lectureId = parseNumberInput(req.query.lecture_id as string | undefined);
    const type = typeof req.query.type === 'string' ? req.query.type : undefined;

    const exams = await ExamFlowService.getExamsByTeacher(teacherId, {
      courseId: courseId ?? undefined,
      lectureId: lectureId ?? undefined,
      type,
    });

    res.json({
      success: true,
      total: exams.length,
      exams,
      filters: {
        teacherId,
        courseId: courseId ?? null,
        lectureId: lectureId ?? null,
        type: type ?? 'all',
      },
    });
  }),
);

// جلب كل امتحانات الكورس العامة (course_level_exams) للمدرس مع اسم الكورس
router.get(
  '/course-exams',
  authMiddleware(['teacher', 'admin']),
  asyncWrapper(async (req, res) => {
    const teacherId = resolveTeacherIdForQuery(req);
    const courseId = parseNumberInput(req.query.course_id as string | undefined);

    const exams = await CourseLevelExamsService.getExamsByTeacher(teacherId, {
      courseId: courseId ?? undefined,
    });

    res.json({
      success: true,
      total: exams.length,
      exams,
      filters: {
        teacherId,
        courseId: courseId ?? null,
      },
    });
  }),
);

// جلب كل الطلاب المسجلين في منصة المدرّس (نفس tenant)
router.get(
  '/platform-students',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const tenantId = req.tenant!.id;

    const studentsRes = await pool.query(
      `SELECT
         u.id,
         u.name,
         u.phone,
         u.email,
         u.parent_phone,
         u.avatar,
         u.created_at
       FROM users u
       WHERE u.role = 'student' AND u.tenant_id = $1
       ORDER BY u.created_at DESC`,
      [tenantId],
    );

    const studentIds = studentsRes.rows.map((r) => Number(r.id));
    let gradesByStudent: Record<number, { id: number; name: string; slug: string | null }[]> = {};

    if (studentIds.length) {
      const gradesRes = await pool.query(
        `SELECT
           ug.user_id,
           g.id,
           g.name,
           g.slug
         FROM user_grades ug
         JOIN grades g ON g.id = ug.grade_id
         WHERE ug.user_id = ANY($1::int[])
         ORDER BY g.id ASC`,
        [studentIds],
      );

      gradesByStudent = gradesRes.rows.reduce(
        (acc, row) => {
          const studentId = Number(row.user_id);
          if (!acc[studentId]) acc[studentId] = [];
          acc[studentId].push({
            id: Number(row.id),
            name: String(row.name),
            slug: row.slug ?? null,
          });
          return acc;
        },
        {} as Record<number, { id: number; name: string; slug: string | null }[]>,
      );
    }

    return res.status(200).json({
      success: true,
      data: {
        tenant_id: tenantId,
        total_students: studentsRes.rows.length,
        students: studentsRes.rows.map((s) => ({
          id: s.id,
          name: s.name,
          phone: s.phone,
          email: s.email,
          parent_phone: s.parent_phone,
          avatar: s.avatar,
          created_at: s.created_at,
          grades: gradesByStudent[Number(s.id)] || [],
        })),
      },
    });
  }),
);

export const CreateTeacherSchema = z.object({
  name: z.string().min(2),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional().or(z.literal('')),
  password: z.string().min(6),
});

export const UpdateTeacherSchema = z.object({
  name: z.string().min(2).optional(),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional().or(z.literal('')),
  password: z.string().min(6).optional(),
  facebook_url: z.string().url().optional().or(z.literal('')),
  instagram_url: z.string().url().optional().or(z.literal('')),
  youtube_url: z.string().url().optional().or(z.literal('')),
  tiktok_url: z.string().url().optional().or(z.literal('')),
  whatsapp_number: z.string().optional().or(z.literal('')),
});
// إنشاء مدرس جديد (avatar و grade_ids اختياريان)
router.post(
  '/',
  authMiddleware(['admin']),
  uploadTeacherAvatar.single('avatar'),
  asyncWrapper(async (req, res) => {
    const { name, email, password, grade_ids, description, subject } = req.body;
    if (!name || !email || !password || !description || !subject) {
      return res
        .status(400)
        .json({ message: 'name, email, password, description, subject are required' });
    }
    let gradeIdsArr: number[] = [];
    if (grade_ids) {
      if (Array.isArray(grade_ids)) {
        gradeIdsArr = grade_ids.map(Number);
      } else if (typeof grade_ids === 'string') {
        gradeIdsArr = grade_ids
          .split(',')
          .map((id) => Number(id.trim()))
          .filter(Boolean);
      }
    }

    // تحقق من وجود الصفوف الدراسية قبل إنشاء المدرس
    if (gradeIdsArr.length > 0) {
      const gradesExist = await pool.query(`SELECT id FROM grades WHERE id = ANY($1::int[])`, [
        gradeIdsArr,
      ]);
      if (gradesExist.rows.length !== gradeIdsArr.length) {
        const existingIds = gradesExist.rows.map((row) => row.id);
        const missingIds = gradeIdsArr.filter((id) => !existingIds.includes(id));
        return res.status(400).json({
          message: `الصفوف الدراسية التالية غير موجودة: ${missingIds.join(', ')}`,
        });
      }
    }

    // تحقق من عدم تكرار الإيميل
    const tenantId = req.tenant!.id;
    const existing = await pool.query('SELECT id FROM users WHERE email = $1 AND tenant_id = $2', [
      email,
      tenantId,
    ]);
    if (existing.rowCount) return res.status(400).json({ message: 'Email already registered' });
    const hashed = await bcrypt.hash(password, 10);

    const file = req.file ?? null;
    const avatar = file ? (await uploadToCloudinary(file.path)).secure_url : null;

    const result = await pool.query(
      `INSERT INTO users (email, password, name, avatar, role, description, subject, tenant_id)
       VALUES ($1, $2, $3, $4, 'teacher', $5, $6, $7)
       RETURNING id, email, name, avatar, role, description, subject`,
      [email, hashed, name, avatar, description, subject, tenantId],
    );
    const teacher = result.rows[0];
    // ربط المدرس بالصفوف إذا وُجدت
    if (gradeIdsArr.length) {
      try {
        await TeacherGradesService.setTeacherGrades(teacher.id, gradeIdsArr);
      } catch (error) {
        // إذا فشل ربط الصفوف، احذف المدرس وأرجع خطأ
        await pool.query('DELETE FROM users WHERE id = $1', [teacher.id]);
        return res.status(400).json({
          message: error instanceof Error ? error.message : 'خطأ في ربط الصفوف الدراسية',
        });
      }
    }
    res.status(201).json({
      teacher,
    });
  }),
);

router.put(
  '/:id',
  authMiddleware(['admin']),
  upload.single('avatar'),
  validate(UpdateTeacherSchema),
  asyncWrapper(async (req, res) => {
    const {
      name,
      email,
      phone,
      password,
      facebook_url,
      instagram_url,
      youtube_url,
      tiktok_url,
      whatsapp_number,
    } = req.body;
    const { id } = req.params;

    const file = req.file ?? null;
    const avatar = file ? (await uploadToCloudinary(file.path)).secure_url : null;

    const updates: string[] = [];
    const values: any[] = [];
    let i = 1;

    if (name) {
      updates.push(`name = $${i++}`);
      values.push(name);
    }
    if (email) {
      updates.push(`email = $${i++}`);
      values.push(email);
    }
    if (phone) {
      updates.push(`phone = $${i++}`);
      values.push(phone);
    }
    if (password) {
      const hashed = await bcrypt.hash(password, 10);
      updates.push(`password = $${i++}`);
      values.push(hashed);
    }
    if (avatar) {
      updates.push(`avatar = $${i++}`);
      values.push(avatar);
    }
    if (facebook_url !== undefined) {
      updates.push(`facebook_url = $${i++}`);
      values.push(facebook_url);
    }
    if (instagram_url !== undefined) {
      updates.push(`instagram_url = $${i++}`);
      values.push(instagram_url);
    }
    if (youtube_url !== undefined) {
      updates.push(`youtube_url = $${i++}`);
      values.push(youtube_url);
    }
    if (tiktok_url !== undefined) {
      updates.push(`tiktok_url = $${i++}`);
      values.push(tiktok_url);
    }
    if (whatsapp_number !== undefined) {
      updates.push(`whatsapp_number = $${i++}`);
      values.push(whatsapp_number);
    }

    if (updates.length) {
      values.push(id);
      const result = await pool.query(
        `UPDATE users SET ${updates.join(', ')} WHERE id = $${i} AND role = 'teacher'`,
        values,
      );

      if (result.rowCount === 0) {
        throw new HttpError(404, 'Teacher not found or invalid role');
      }
    }

    // جلب بيانات المدرس المحدثة
    const updatedTeacher = await pool.query(
      `SELECT id, email, name, avatar, role, description, subject,
              facebook_url, instagram_url, youtube_url, tiktok_url, whatsapp_number
       FROM users WHERE id = $1 AND role = 'teacher'`,
      [id],
    );

    res.status(200).json({
      message: 'Teacher updated successfully',
      teacher: {
        ...updatedTeacher.rows[0],
        avatar: updatedTeacher.rows[0]?.avatar,
      },
    });
  }),
);

// التقرير اليومي: تقرير لكل صف (آخر كورس شغال عليه المدرس في الصف) — أولى، ثانية، ثالثة... أو تقرير واحد لو كورس واحد
const dailyCourseReportHandler = asyncWrapper(async (req: any, res: any) => {
  const teacherId = req.user!.id;
  const reports = await TeacherDailyCourseReportService.getReports(teacherId);
  res.json({ reports });
});
router.get('/daily-course-report', authMiddleware(['teacher']), dailyCourseReportHandler);
router.post('/daily-course-report', authMiddleware(['teacher']), dailyCourseReportHandler);
// دعم الصيغة /:id/daily-course-report (المستخدم الخاطئ قد يرسل الـ id في المسار) — للمدرس فقط وتجاهل :id
router.get(
  '/:id/daily-course-report',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const teacherId = req.user!.id;
    const reports = await TeacherDailyCourseReportService.getReports(teacherId);
    res.json({ reports });
  }),
);

// API لجلب آخر نشاطات المدرس
router.get(
  '/activities',
  authMiddleware(['teacher', 'admin']),
  asyncWrapper(async (req, res) => {
    const teacherId = req.user!.id;
    const { limit = 20, offset = 0, type } = req.query;

    const result = await TeacherActivityService.getTeacherActivities(
      teacherId,
      parseInt(limit as string),
      parseInt(offset as string),
      type as string,
    );

    if (!result.success) {
      throw new HttpError(500, result.error || 'خطأ في جلب النشاطات');
    }

    res.status(200).json({
      success: true,
      activities: result.activities,
      pagination: {
        limit: parseInt(limit as string),
        offset: parseInt(offset as string),
      },
    });
  }),
);

// API لجلب إحصائيات نشاطات المدرس
router.get(
  '/activities/stats',
  authMiddleware(['teacher', 'admin']),
  asyncWrapper(async (req, res) => {
    const teacherId = req.user!.id;

    const result = await TeacherActivityService.getTeacherActivityStats(teacherId);

    if (!result.success) {
      throw new HttpError(500, result.error || 'خطأ في جلب الإحصائيات');
    }

    res.status(200).json({
      success: true,
      stats: result.stats,
    });
  }),
);

// API لجلب نشاطات محددة حسب النوع
router.get(
  '/activities/:type',
  authMiddleware(['teacher', 'admin']),
  asyncWrapper(async (req, res) => {
    const teacherId = req.user!.id;
    const { type } = req.params;
    const { limit = 20, offset = 0 } = req.query;

    const result = await TeacherActivityService.getTeacherActivities(
      teacherId,
      parseInt(limit as string),
      parseInt(offset as string),
      type,
    );

    if (!result.success) {
      throw new HttpError(500, result.error || 'خطأ في جلب النشاطات');
    }

    res.status(200).json({
      success: true,
      activities: result.activities,
      activityType: type,
      pagination: {
        limit: parseInt(limit as string),
        offset: parseInt(offset as string),
      },
    });
  }),
);

// API خاص للمدرس لعرض آخر نشاطاته
router.get(
  '/my-activities',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const teacherId = req.user!.id;
    const { limit = 10, offset = 0 } = req.query;

    // جلب النشاطات
    const activitiesResult = await TeacherActivityService.getTeacherActivities(
      teacherId,
      parseInt(limit as string),
      parseInt(offset as string),
    );

    if (!activitiesResult.success) {
      throw new HttpError(500, activitiesResult.error || 'خطأ في جلب النشاطات');
    }

    // جلب الإحصائيات
    const statsResult = await TeacherActivityService.getTeacherActivityStats(teacherId);

    if (!statsResult.success) {
      throw new HttpError(500, statsResult.error || 'خطأ في جلب الإحصائيات');
    }

    res.status(200).json({
      success: true,
      data: {
        activities: activitiesResult.activities,
        stats: statsResult.stats,
        pagination: {
          limit: parseInt(limit as string),
          offset: parseInt(offset as string),
        },
      },
    });
  }),
);

// API لجلب تفاصيل نشاط محدد
router.get(
  '/activities/detail/:activityId',
  authMiddleware(['teacher', 'admin']),
  asyncWrapper(async (req, res) => {
    const teacherId = req.user!.id;
    const { activityId } = req.params;

    const result = await pool.query(
      `SELECT 
        ta.id,
        ta.activity_type,
        ta.title,
        ta.description,
        ta.course_id,
        ta.lecture_id,
        ta.quiz_id,
        ta.metadata,
        ta.created_at,
        c.title as course_title,
        c.description as course_description,
        l.title as lecture_title,
        l.description as lecture_description,
        q.title as quiz_title
      FROM teacher_activities ta
      LEFT JOIN courses c ON ta.course_id = c.id
      LEFT JOIN lectures l ON ta.lecture_id = l.id
      LEFT JOIN quizzes q ON ta.quiz_id = q.id
      WHERE ta.id = $1 AND ta.teacher_id = $2`,
      [activityId, teacherId],
    );

    if (result.rowCount === 0) {
      throw new HttpError(404, 'النشاط غير موجود أو لا يمكن الوصول إليه');
    }

    const activity = result.rows[0];

    res.status(200).json({
      success: true,
      activity: {
        id: activity.id,
        activity_type: activity.activity_type,
        title: activity.title,
        description: activity.description,
        course_id: activity.course_id,
        lecture_id: activity.lecture_id,
        quiz_id: activity.quiz_id,
        metadata: activity.metadata,
        created_at: activity.created_at,
        course_title: activity.course_title,
        course_description: activity.course_description,
        lecture_title: activity.lecture_title,
        lecture_description: activity.lecture_description,
        quiz_title: activity.quiz_title,
      },
    });
  }),
);

// جلب آخر أنشطة المدرس
router.get(
  '/activity-log',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const teacher_id = req.user!.id;
    const { limit = 20, offset = 0 } = req.query;
    const activities = await TeacherActivityLogService.getTeacherLog(
      teacher_id,
      parseInt(limit as string),
      parseInt(offset as string),
    );
    res.json({ activities });
  }),
);

// إحصائيات شاملة للمدرس
router.get(
  '/stats',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const teacher_id = req.user!.id;

    try {
      // عدد الكورسات
      const coursesRes = await pool.query(
        'SELECT COUNT(*) as count FROM courses WHERE teacher_id = $1',
        [teacher_id],
      );
      const coursesCount = parseInt(coursesRes.rows[0].count);

      // عدد الطلاب المشتركين في كورسات المدرس
      const studentsRes = await pool.query(
        `SELECT COUNT(DISTINCT e.user_id) as count 
          FROM enrollments e
          JOIN courses c ON e.course_id = c.id 
          WHERE c.teacher_id = $1`,
        [teacher_id],
      );
      const studentsCount = parseInt(studentsRes.rows[0].count);

      // عدد الأسئلة في مكتبة الأسئلة
      const questionsRes = await pool.query(
        `SELECT COUNT(*) as count
         FROM teacher_questions q
         JOIN teacher_question_lessons l ON q.lesson_id = l.id
         WHERE l.teacher_id = $1`,
        [teacher_id],
      );
      const questionsCount = parseInt(questionsRes.rows[0].count);

      // إحصائيات إضافية - عدد الكورسات التي لها طلاب مشتركين
      const coursesWithStudentsRes = await pool.query(
        `SELECT COUNT(DISTINCT c.id) as count 
          FROM courses c
          JOIN enrollments e ON c.id = e.course_id
          WHERE c.teacher_id = $1`,
        [teacher_id],
      );
      const coursesWithStudentsCount = parseInt(coursesWithStudentsRes.rows[0].count);

      // عدد المحاضرات
      const lecturesRes = await pool.query(
        `SELECT COUNT(*) as count 
          FROM lectures l
          JOIN courses c ON l.course_id = c.id
          WHERE c.teacher_id = $1`,
        [teacher_id],
      );
      const lecturesCount = parseInt(lecturesRes.rows[0].count);

      // عدد الامتحانات
      const examsRes = await pool.query(
        `SELECT COUNT(*) as count 
          FROM exams e
          JOIN lectures l ON e.lecture_id = l.id
          JOIN courses c ON l.course_id = c.id
          WHERE c.teacher_id = $1`,
        [teacher_id],
      );
      const examsCount = parseInt(examsRes.rows[0].count);

      res.json({
        success: true,
        stats: {
          total_courses: coursesCount,
          courses_with_students: coursesWithStudentsCount,
          total_students: studentsCount,
          total_questions: questionsCount,
          total_lectures: lecturesCount,
          total_exams: examsCount,
        },
      });
    } catch (error) {
      console.error('خطأ في جلب إحصائيات المدرس:', error);
      res.status(500).json({
        success: false,
        message: 'خطأ في جلب الإحصائيات',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }),
);

// جلب صفوف المدرس الحالي فقط
// جلب الصفوف الدراسية للمدرس الحالي
router.get(
  '/grades',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const teacherId = req.user!.id;
    const grades = await TeacherGradesService.getTeacherGrades(teacherId);
    res.json({ grades });
  }),
);

// جلب جميع الصفوف الدراسية المتاحة
router.get(
  '/available-grades',
  asyncWrapper(async (req, res) => {
    const result = await pool.query(
      `SELECT id, name, slug, stage, status
       FROM grades
       WHERE status = 'active'
       ORDER BY id`,
    );
    res.json({ grades: result.rows });
  }),
);

// جلب جميع المدرسين (للأدمن فقط)
router.get(
  '/teachers',
  authMiddleware(['admin']),
  asyncWrapper(async (req, res) => {
    const tenantId = req.tenant!.id;
    // جلب جميع المدرسين مع معلومات إضافية
    const result = await pool.query(
      `SELECT 
        u.id, 
        u.name, 
        u.email, 
        u.avatar, 
        u.description, 
        u.subject, 
        u.phone,
        u.facebook_url,
        u.instagram_url,
        u.youtube_url,
        u.tiktok_url,
        u.whatsapp_number,
        u.account_status,
        u.created_at,
        COUNT(DISTINCT c.id) as courses_count,
        COUNT(DISTINCT e.user_id) as students_count
      FROM users u
      LEFT JOIN courses c ON u.id = c.teacher_id
      LEFT JOIN enrollments e ON c.id = e.course_id
      WHERE u.role = 'teacher' AND u.tenant_id = $1
      GROUP BY u.id, u.name, u.email, u.avatar, u.description, u.subject, u.phone, u.facebook_url, u.instagram_url, u.youtube_url, u.tiktok_url, u.whatsapp_number, u.account_status, u.created_at
      ORDER BY u.created_at DESC`,
      [tenantId],
    );

    // جلب الصفوف الدراسية لكل مدرس
    const teacherIds = result.rows.map((t: any) => t.id);
    let gradesMap: { [teacherId: number]: { id: number; name: string }[] } = {};

    if (teacherIds.length > 0) {
      const gradesRes = await pool.query(
        `SELECT tg.teacher_id, g.id, g.name
         FROM teacher_grades tg
         JOIN grades g ON tg.grade_id = g.id
         WHERE tg.teacher_id = ANY($1::int[])`,
        [teacherIds],
      );

      gradesMap = gradesRes.rows.reduce((acc: any, row: any) => {
        if (!acc[row.teacher_id]) acc[row.teacher_id] = [];
        acc[row.teacher_id].push({ id: row.id, name: row.name });
        return acc;
      }, {});
    }

    res.json({
      teachers: result.rows.map((teacher: any) => ({
        ...teacher,
        grades: gradesMap[teacher.id] || [],
      })),
      total: result.rows.length,
      message: 'تم جلب جميع المدرسين',
    });
  }),
);

// تم حذف أي تحقق أو منطق أو استجابة تخص الصفوف الدراسية أو grade_ids
