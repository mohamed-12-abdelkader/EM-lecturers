import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/authentication';
import { asyncWrapper, HttpError } from '../utils';
import pool from '../db/pool';
import bcrypt from 'bcrypt';
import { validate } from '../middleware/validateReq';
import { StudentChangePassword } from './auth.modules';
import { StudentPointsService } from '../services/studentPoints';
import { StudentDailyReportService } from '../services/studentDailyReport';
import { checkAnyPermission } from '../middleware/permissions';
import {
  clearAvatarForStudent,
  pickUploadedAvatar,
  publicAvatarUrl,
  saveAvatarForUser,
  uploadStudentAvatarMiddleware,
} from '../services/userAvatarUpload';
import { TeacherManagedStudentsService } from '../services/teacherManagedStudents';
import { CourseGroupAccessService } from '../services/courseGroupAccess';

export const router = Router();

const UpdateStudentMeSchema = z
  .object({
    name: z.string().min(2).max(120).optional(),
    phone: z.string().min(8).max(20).optional(),
    parent_phone: z.string().min(8).max(20).nullable().optional(),
    email: z.string().email().nullable().optional(),
    password: z.string().min(6).optional(),
    group_id: z.coerce.number().int().positive().optional(),
    course_group_id: z.coerce.number().int().positive().optional(),
  })
  .refine(
    (d) =>
      d.name !== undefined ||
      d.phone !== undefined ||
      d.parent_phone !== undefined ||
      d.email !== undefined ||
      d.password !== undefined ||
      d.group_id !== undefined ||
      d.course_group_id !== undefined,
    { message: 'أرسل حقلاً واحداً على الأقل للتعديل' },
  );

async function buildStudentProfile(studentId: number, tenantId?: number | null) {
  const userRes = await pool.query(
    `SELECT id, name, phone, email, parent_phone, avatar, role, created_at,
            student_code, account_status, must_change_password, managed_by_teacher_id, tenant_id
     FROM users
     WHERE id = $1 AND role = 'student'`,
    [studentId],
  );

  if (userRes.rowCount === 0) {
    throw new HttpError(404, 'الطالب غير موجود');
  }

  const user = userRes.rows[0];
  const effectiveTenantId = tenantId ?? user.tenant_id ?? null;

  const gradesRes = await pool.query(
    `SELECT g.id, g.name
     FROM user_grades ug
     JOIN grades g ON ug.grade_id = g.id
     WHERE ug.user_id = $1
     ORDER BY g.id`,
    [studentId],
  );

  const teacherId = await TeacherManagedStudentsService.resolveTeacherIdForStudent(
    studentId,
    effectiveTenantId,
  );

  let canChooseStudyGroup = false;
  let availableStudyGroups: Awaited<
    ReturnType<typeof TeacherManagedStudentsService.listAvailableStudyGroupsForStudent>
  > = [];

  if (teacherId) {
    let chooseAllowed = true;
    if (effectiveTenantId) {
      const settings =
        await TeacherManagedStudentsService.getRegistrationSettings(effectiveTenantId);
      chooseAllowed = settings.students_can_choose_study_group;
    } else {
      // لو مفيش tenant على الطلب: ابحث إعدادات تينانت المدرس
      const teacherTenant = await pool.query<{ id: number }>(
        `SELECT id FROM tenants WHERE owner_user_id = $1 AND is_active = TRUE ORDER BY id LIMIT 1`,
        [teacherId],
      );
      if (teacherTenant.rowCount) {
        const settings = await TeacherManagedStudentsService.getRegistrationSettings(
          teacherTenant.rows[0].id,
        );
        chooseAllowed = settings.students_can_choose_study_group;
      }
    }
    canChooseStudyGroup = chooseAllowed;
    if (canChooseStudyGroup) {
      availableStudyGroups =
        await TeacherManagedStudentsService.listAvailableStudyGroupsForStudent(
          teacherId,
          studentId,
        );
    }
  }

  const studyGroup = await TeacherManagedStudentsService.getStudentStudyGroup(studentId);

  let canChooseCourseGroup = false;
  let courseGroup: Record<string, unknown> | null = null;
  let availableCourseGroups: Awaited<
    ReturnType<typeof CourseGroupAccessService.listGroups>
  > = [];

  const courseTeacherId =
    teacherId ??
    (effectiveTenantId
      ? await CourseGroupAccessService.resolveTenantOwnerTeacherId(effectiveTenantId)
      : null);

  if (courseTeacherId) {
    const courseSettings =
      await CourseGroupAccessService.getTeacherSettings(courseTeacherId);
    canChooseCourseGroup = courseSettings.course_group_access_enabled === true;
    const membership = await CourseGroupAccessService.getStudentMembershipForTeacher(
      studentId,
      courseTeacherId,
    );
    if (membership) {
      courseGroup = {
        id: membership.group_id,
        name: membership.group_name,
        grade_id: membership.grade_id,
        grade_name: membership.grade_name,
        status: membership.group_status,
        joined_at: membership.created_at ?? membership.updated_at ?? null,
      };
    }
    if (canChooseCourseGroup) {
      const studentGradeIds = gradesRes.rows.map((g: { id: number }) => Number(g.id));
      const gradeFilter = studentGradeIds.length === 1 ? studentGradeIds[0] : undefined;
      availableCourseGroups = await CourseGroupAccessService.listGroups(courseTeacherId, {
        grade_id: gradeFilter,
      });
    }
  }

  return {
    id: user.id,
    name: user.name,
    phone: user.phone,
    email: user.email,
    parent_phone: user.parent_phone,
    avatar: publicAvatarUrl(user.avatar),
    role: user.role,
    student_code: user.student_code,
    account_status: user.account_status,
    must_change_password: user.must_change_password,
    created_at: user.created_at,
    grades: gradesRes.rows,
    study_group: studyGroup,
    can_choose_study_group: canChooseStudyGroup,
    available_study_groups: canChooseStudyGroup ? availableStudyGroups : [],
    course_group: courseGroup,
    can_choose_course_group: canChooseCourseGroup,
    available_course_groups: canChooseCourseGroup ? availableCourseGroups : [],
  };
}

router.get(
  '/me',
  authMiddleware(['student']),
  asyncWrapper(async (req, res) => {
    const tenantId = (req as any).tenant?.id ?? null;
    const profile = await buildStudentProfile(req.user!.id, tenantId);
    return res.status(200).json({
      success: true,
      ...profile,
    });
  }),
);

router.put(
  '/me',
  authMiddleware(['student']),
  asyncWrapper(async (req, res) => {
    const parsed = UpdateStudentMeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: 'بيانات غير صالحة',
        errors: parsed.error.errors,
      });
    }

    const studentId = req.user!.id;
    const tenantId = (req as any).tenant?.id ?? null;
    const data = parsed.data;

    const updates: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (data.name !== undefined) {
      updates.push(`name = $${i++}`);
      values.push(data.name);
    }
    if (data.phone !== undefined) {
      updates.push(`phone = $${i++}`);
      values.push(data.phone);
    }
    if (data.parent_phone !== undefined) {
      updates.push(`parent_phone = $${i++}`);
      values.push(data.parent_phone);
    }
    if (data.email !== undefined) {
      updates.push(`email = $${i++}`);
      values.push(data.email);
    }
    if (data.password !== undefined) {
      const hashed = await bcrypt.hash(data.password, 10);
      updates.push(`password = $${i++}`);
      values.push(hashed);
      updates.push(`must_change_password = FALSE`);
    }

    if (updates.length > 0) {
      values.push(studentId);
      const result = await pool.query(
        `UPDATE users SET ${updates.join(', ')}
         WHERE id = $${i} AND role = 'student'
         RETURNING id`,
        values,
      );
      if (!result.rowCount) {
        return res.status(404).json({ success: false, message: 'الطالب غير موجود' });
      }
    }

    if (data.group_id !== undefined) {
      await TeacherManagedStudentsService.studentChooseStudyGroup(
        studentId,
        data.group_id,
        tenantId,
      );
    }

    if (data.course_group_id !== undefined) {
      const teacherId =
        (await TeacherManagedStudentsService.resolveTeacherIdForStudent(studentId, tenantId)) ??
        (tenantId
          ? await CourseGroupAccessService.resolveTenantOwnerTeacherId(tenantId)
          : null);
      if (!teacherId) {
        throw new HttpError(400, 'تعذر تحديد المدرس لهذه المنصة');
      }
      const settings = await CourseGroupAccessService.getTeacherSettings(teacherId);
      if (!settings.course_group_access_enabled) {
        throw new HttpError(403, 'نظام مجموعات الكورسات غير مفعّل على هذه المنصة');
      }
      await CourseGroupAccessService.assignStudentToGroup(
        studentId,
        data.course_group_id,
        teacherId,
      );
    }

    const profile = await buildStudentProfile(studentId, tenantId);
    return res.json({
      success: true,
      message: 'تم تحديث البيانات بنجاح',
      ...profile,
    });
  }),
);

const setStudentAvatar = asyncWrapper(async (req, res) => {
  const file = pickUploadedAvatar(req);
  if (!file) {
    return res.status(400).json({
      success: false,
      message: 'أرسل الصورة في الحقل avatar (JPG / PNG / WEBP / GIF، حد أقصى 5MB)',
      code: 'AVATAR_REQUIRED',
    });
  }

  const data = await saveAvatarForUser(req.user!.id, file);
  if (!data) {
    return res.status(404).json({ success: false, message: 'الطالب غير موجود' });
  }

  res.json({
    success: true,
    message: 'تم تحديث صورة البروفايل بنجاح',
    data,
  });
});

router.post('/me/avatar', authMiddleware(['student']), uploadStudentAvatarMiddleware, setStudentAvatar);
router.put('/me/avatar', authMiddleware(['student']), uploadStudentAvatarMiddleware, setStudentAvatar);
router.delete(
  '/me/avatar',
  authMiddleware(['student']),
  asyncWrapper(async (req, res) => {
    const data = await clearAvatarForStudent(req.user!.id);
    if (!data) {
      return res.status(404).json({ success: false, message: 'الطالب غير موجود' });
    }
    res.json({
      success: true,
      message: 'تم حذف صورة البروفايل',
      data,
    });
  }),
);

router.get(
  '/available-teachers',
  authMiddleware(['student']),
  asyncWrapper(async (req, res) => {
    const studentId = req.user!.id;

    const studentGradesRes = await pool.query(
      'SELECT grade_id FROM user_grades WHERE user_id = $1',
      [studentId],
    );
    const gradeIds = studentGradesRes.rows.map((row) => row.grade_id);

    if (gradeIds.length === 0) {
      return res.status(404).json({ message: 'Student is not assigned to any grade.' });
    }

    // Get teachers who are assigned to the same grade(s)
    const teachersRes = await pool.query(
      `
      SELECT DISTINCT u.id, u.name, u.avatar, u.subject, u.description, u.phone, u.email, u.facebook_url, u.instagram_url, u.youtube_url, u.tiktok_url, u.whatsapp_number
      FROM users u
      JOIN teacher_grades tg ON u.id = tg.teacher_id
      WHERE u.role = 'teacher' AND u.account_status = 'active' AND tg.grade_id = ANY($1::int[])
    `,
      [gradeIds],
    );

    // جلب الصفوف التي يدرسها كل مدرس (اختياري)
    const teacherIds = teachersRes.rows.map((t) => t.id);
    let gradesMap: { [teacherId: number]: { id: number; name: string }[] } = {};
    if (teacherIds.length) {
      const gradesRes = await pool.query(
        `SELECT ug.user_id as teacher_id, g.id, g.name
         FROM user_grades ug
         JOIN grades g ON ug.grade_id = g.id
         WHERE ug.user_id = ANY($1::int[])`,
        [teacherIds],
      );
      gradesMap = gradesRes.rows.reduce((acc, row) => {
        if (!acc[row.teacher_id]) acc[row.teacher_id] = [];
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
  }),
);

// عرض تفاصيل المدرس والكورسات الخاصة به لصف الطالب
router.get(
  '/teacher/:teacherId/details',
  authMiddleware(['student']),
  asyncWrapper(async (req, res) => {
    try {
      const teacherId = Number(req.params.teacherId);
      const studentId = req.user!.id;

      // التحقق من أن المدرس موجود
      const teacherCheck = await pool.query(
        'SELECT id, name, email, phone, avatar, created_at, description, subject, facebook_url, instagram_url, youtube_url, tiktok_url, whatsapp_number FROM users WHERE id = $1 AND role = $2 AND account_status = $3',
        [teacherId, 'teacher', 'active'],
      );

      if (teacherCheck.rowCount === 0) {
        return res.status(404).json({ message: 'Teacher not found' });
      }

      // احصل على الصفوف الدراسية للطالب
      const studentGradesRes = await pool.query(
        'SELECT grade_id FROM user_grades WHERE user_id = $1',
        [studentId],
      );
      const studentGradeIds = studentGradesRes.rows.map((row) => row.grade_id);

      if (studentGradeIds.length === 0) {
        return res.status(400).json({ message: 'Student is not assigned to any grade' });
      }

      // احصل على الصفوف التي يدرس فيها المدرس
      const teacherGradesRes = await pool.query(
        'SELECT grade_id FROM teacher_grades WHERE teacher_id = $1',
        [teacherId],
      );
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
      const commonGradesNamesRes = await pool.query(
        `SELECT id, name FROM grades WHERE id = ANY($1::int[])`,
        [commonGrades],
      );

      const teacher = teacherCheck.rows[0];
      const commonGradesInfo = commonGradesNamesRes.rows;

      // جلب الكورسات الخاصة بالمدرس في صفوف الطالب
      const coursesRes = await pool.query(
        `SELECT c.id, c.title, c.description, c.price, c.grade_id, c.avatar,
                CASE WHEN e.user_id IS NOT NULL THEN true ELSE false END as is_enrolled
         FROM courses c
         LEFT JOIN enrollments e ON c.id = e.course_id AND e.user_id = $1
         WHERE c.teacher_id = $2
           AND (
             EXISTS (
               SELECT 1 FROM course_grades cg
               WHERE cg.course_id = c.id AND cg.grade_id = ANY($3::int[])
             )
             OR (c.grade_id = ANY($3::int[]) AND NOT EXISTS (
               SELECT 1 FROM course_grades cg2 WHERE cg2.course_id = c.id
             ))
           )`,
        [studentId, teacherId, commonGrades],
      );

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
          instagram_url: teacher.instagram_url,
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
    } catch (err) {
      console.error('تفاصيل الخطأ:', err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      return res.status(500).json({ message: 'Internal error', error: errorMessage });
    }
  }),
);

// عرض المدرسين المشترك معهم الطالب مع مادته ووصفها
router.get(
  '/my-teachers',
  authMiddleware(['student']),
  asyncWrapper(async (req, res) => {
    try {
      const studentId = req.user!.id;
      const result = await pool.query(
        `SELECT DISTINCT u.id as teacher_id, u.name, u.avatar, u.phone, u.subject, u.facebook_url, u.instagram_url, u.youtube_url, u.tiktok_url, u.whatsapp_number, c.id as course_id, c.title as course_title, c.description as course_description, c.avatar as course_avatar
         FROM enrollments e
         JOIN courses c ON e.course_id = c.id
         JOIN users u ON c.teacher_id = u.id
         WHERE e.user_id = $1 AND u.role = 'teacher' AND u.account_status = 'active'`,
        [studentId],
      );
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
            instagram_url: row.instagram_url,
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
    } catch (err) {
      console.error('تفاصيل الخطأ في my-teachers:', err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      return res.status(500).json({ message: 'Internal error', error: errorMessage });
    }
  }),
);

// جلب كورسات مدرس منصة معينة عبر subdomain مع حالة الإتاحة للطالب
router.get(
  '/teacher-platform/:subdomain/courses',
  authMiddleware(['student']),
  asyncWrapper(async (req, res) => {
    const studentId = req.user!.id;
    const subdomain = String(req.params.subdomain || '')
      .trim()
      .toLowerCase();
    if (!subdomain) return res.status(400).json({ message: 'subdomain is required' });

    const tenantRes = await pool.query(
      `SELECT id, subdomain, display_name, owner_user_id, is_active
       FROM tenants
       WHERE subdomain = $1
       LIMIT 1`,
      [subdomain],
    );
    if (!tenantRes.rowCount) {
      return res.status(404).json({ success: false, message: 'Teacher platform not found' });
    }
    const tenant = tenantRes.rows[0];
    if (!tenant.owner_user_id) {
      return res.status(404).json({ success: false, message: 'Teacher owner not found for platform' });
    }

    const { TeacherPlatformSubscriptionsService } = await import(
      '../services/teacherPlatformSubscriptions.js'
    );
    const access = await TeacherPlatformSubscriptionsService.getPlatformAccessState(
      tenant.owner_user_id,
    );
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
    const teacherRes = await pool.query<{ id: number; avatar: string | null }>(
      `SELECT id, avatar
       FROM users
       WHERE id = $1 AND role = 'teacher'
       LIMIT 1`,
      [tenant.owner_user_id],
    );
    const teacherAvatar = teacherRes.rows[0]?.avatar ?? null;

    const studentGradesRes = await pool.query(
      `SELECT grade_id
       FROM user_grades
       WHERE user_id = $1`,
      [studentId],
    );
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

    const coursesRes = await pool.query(
      `SELECT
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
         AND (
           EXISTS (
             SELECT 1 FROM course_grades cg
             WHERE cg.course_id = c.id AND cg.grade_id = ANY($3::int[])
           )
           OR (c.grade_id = ANY($3::int[]) AND NOT EXISTS (
             SELECT 1 FROM course_grades cg2 WHERE cg2.course_id = c.id
           ))
           OR c.grade_id IS NULL
         )
       ORDER BY c.created_at DESC`,
      [studentId, tenant.owner_user_id, studentGradeIds],
    );

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
  }),
);

// تغيير كلمة سر الطالب باستخدام رقم الهاتف
router.post(
  '/change-password',
  validate(StudentChangePassword),
  asyncWrapper(async (req, res) => {
    try {
      const { phone, new_password } = req.body;

      // التحقق من وجود الطالب برقم الهاتف
      const studentResult = await pool.query(
        'SELECT id, name, phone FROM users WHERE phone = $1 AND role = $2',
        [phone, 'student'],
      );

      if (!studentResult.rowCount) {
        return res.status(404).json({
          success: false,
          message: 'الطالب غير موجود برقم الهاتف المحدد',
        });
      }

      const student = studentResult.rows[0];

      // تشفير كلمة السر الجديدة
      const hashedPassword = await bcrypt.hash(new_password, 10);

      // تحديث كلمة السر
      await pool.query('UPDATE users SET password = $1 WHERE id = $2 AND role = $3', [
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
    } catch (error: any) {
      console.error('Error changing student password:', error);
      res.status(500).json({
        success: false,
        message: 'فشل في تغيير كلمة السر',
        error: error.message,
      });
    }
  }),
);

// عرض تفاصيل المحاضرات للطالب مع إحصائيات المشاهدة
router.get(
  '/my-lectures',
  authMiddleware(['student']),
  asyncWrapper(async (req, res) => {
    try {
      const studentId = req.user!.id;

      // جلب جميع الكورسات المشترك فيها الطالب
      const enrollmentsRes = await pool.query(
        `SELECT 
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
        ORDER BY e.enrolled_at DESC`,
        [studentId],
      );

      if (enrollmentsRes.rowCount === 0) {
        return res.json({
          success: true,
          lectures: [],
        });
      }

      const enrollments = enrollmentsRes.rows;
      const courseIds = enrollments.map((e) => e.course_id);

      // جلب جميع المحاضرات في الكورسات المشترك فيها
      const lecturesRes = await pool.query(
        `SELECT 
          l.id,
          l.title,
          l.description,
          l.position,
          l.course_id,
          l.created_at
        FROM lectures l
        WHERE l.course_id = ANY($1::int[])
        ORDER BY l.course_id, l.position, l.created_at`,
        [courseIds],
      );

      const lectures = lecturesRes.rows;
      const lectureIds = lectures.map((l) => l.id);

      // جلب جميع الفيديوهات في هذه المحاضرات
      let videos = [];
      if (lectureIds.length > 0) {
        const videosRes = await pool.query(
          `SELECT 
            lv.id,
            lv.lecture_id,
            lv.video_url,
            lv.title,
            lv.position
          FROM lecture_videos lv
          WHERE lv.lecture_id = ANY($1::int[])
          ORDER BY lv.lecture_id, lv.position`,
          [lectureIds],
        );
        videos = videosRes.rows;
      }

      // جلب جميع مشاهدات الفيديوهات للطالب
      let videoViews = [];
      if (lectureIds.length > 0) {
        const videoViewsRes = await pool.query(
          `SELECT 
            vv.video_id,
            vv.lecture_id,
            vv.is_completed,
            vv.viewed_at
          FROM video_views vv
          WHERE vv.user_id = $1 AND vv.lecture_id = ANY($2::int[])`,
          [studentId, lectureIds],
        );
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
    } catch (error: any) {
      console.error('Error fetching student lectures:', error);
      res.status(500).json({
        success: false,
        message: 'فشل في جلب المحاضرات',
        error: error.message,
      });
    }
  }),
);

// التقرير اليومي: المحاضرات والامتحانات المتراكمة على الطالب (للتنبيه اليومي)
router.get(
  '/daily-report',
  authMiddleware(['student']),
  asyncWrapper(async (req, res) => {
    try {
      const studentId = req.user!.id;
      const createNotification = req.query.create_notification === '1' || req.query.create_notification === 'true';
      const report = await StudentDailyReportService.getReport(studentId);

      if (createNotification && (report.summary.pending_lectures_count > 0 || report.summary.pending_exams_count > 0)) {
        const title = 'تذكير: محاضرات وامتحانات متراكمة';
        const message =
          report.summary.pending_lectures_count > 0 && report.summary.pending_exams_count > 0
            ? `لديك ${report.summary.pending_lectures_count} محاضرة و${report.summary.pending_exams_count} امتحان لم تكملها بعد.`
            : report.summary.pending_lectures_count > 0
              ? `لديك ${report.summary.pending_lectures_count} محاضرة لم تشاهدها بعد.`
              : `لديك ${report.summary.pending_exams_count} امتحان لم تحله بعد.`;
        await pool.query(
          `INSERT INTO notifications (user_id, title, message, type) VALUES ($1, $2, $3, 'course_update')`,
          [studentId, title, message],
        );
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        ExpoPushService.sendPushNotification(studentId, title, message, { type: 'course_update' }).catch((e) =>
          console.error('Expo push error:', e),
        );
      }

      res.json({
        success: true,
        report,
      });
    } catch (error: any) {
      console.error('Error fetching daily report:', error);
      res.status(500).json({
        success: false,
        message: 'فشل في جلب التقرير اليومي',
        error: error.message,
      });
    }
  }),
);

// جلب نقاط الطالب
router.get(
  '/my-points',
  authMiddleware(['student']),
  asyncWrapper(async (req, res) => {
    try {
      const studentId = req.user!.id;
      const points = await StudentPointsService.getStudentPoints(studentId);

      res.json({
        success: true,
        points: {
          total_points: points?.total_points || 0,
          last_reset_at: points?.last_reset_at || null,
          created_at: points?.created_at || new Date(),
          updated_at: points?.updated_at || new Date(),
        },
      });
    } catch (error: any) {
      console.error('Error fetching student points:', error);
      res.status(500).json({
        success: false,
        message: 'فشل في جلب النقاط',
        error: error.message,
      });
    }
  }),
);

// جلب جميع الطلاب (للأدمن)
router.get(
  '/students-data',
  authMiddleware(['admin', 'employee']),
  // ندعم أكثر من مفتاح صلاحيات حسب صيغة التخزين في DB/الواجهة
  checkAnyPermission([
    'can_manage_students',
    'students_management',
    'manage_students',
    'student_management',
  ]),
  asyncWrapper(async (req, res) => {
    try {
      // جلب جميع الطلاب مع معلومات الصفوف
      const result = await pool.query(`
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
          ? student.grade_ids.map((id: number, index: number) => ({
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
    } catch (err) {
      console.error('تفاصيل الخطأ في students-data:', err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      return res.status(500).json({
        success: false,
        message: 'Internal error',
        error: errorMessage,
      });
    }
  }),
);
