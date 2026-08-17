import pool from '../db/pool';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import { validate } from '../middleware/validateReq';
import { authMiddleware } from '../middleware/authentication';
import { Router } from 'express';
import { ChangePassword, RegisterStudent } from './auth.modules';
import { asyncWrapper, generateToken } from '../utils';
import { AuthSessionsService, setRefreshCookie } from '../services/authSessions';
import { StudentPointsService } from '../services/studentPoints';
import { TeacherManagedStudentsService } from '../services/teacherManagedStudents';
import { StudentDeviceRestrictionService } from '../services/studentDeviceRestriction';
import { CourseGroupAccessService } from '../services/courseGroupAccess';
import {
  persistAvatarFile,
  pickUploadedAvatar,
  publicAvatarUrl,
  saveAvatarForUser,
  clearAvatarForStudent,
  uploadMeAvatarMiddleware,
  uploadStudentAvatarMiddleware,
} from '../services/userAvatarUpload';
import { checkAnyPermission } from '../middleware/permissions';
const UpdateMe = z.object({
  email: z.string().email().optional(),
  password: z.string().min(6).optional(),
  name: z.string().optional(),
  phone: z.string().optional(),
  parent_phone: z.string().optional(),
});

export const router = Router();

router.post(
  '/register',
  validate(RegisterStudent),
  asyncWrapper(async (req, res) => {
    const {
      phone,
      password,
      name,
      parent_phone,
      grade_id,
      course_category,
      subdomain: bodySubdomain,
      tenant_subdomain: bodyTenantSubdomain,
      course_group_id,
    } = req.body;

    // منصة مختلفة = مستخدم مختلف: التحقق من التكرار فقط داخل نفس tenant_id.
    // عند Host الافتراضي، يُحدد المستأجر من subdomain في الجسم (يتوافق مع tenantContext + إعادة التأكد هنا).
    let tenantId = req.tenant!.id;
    const explicitSlug = bodySubdomain ?? bodyTenantSubdomain;
    if (req.tenant!.subdomain === 'default' && explicitSlug) {
      const tRes = await pool.query<{ id: number }>(
        `SELECT id FROM tenants WHERE subdomain = $1 AND is_active = TRUE LIMIT 1`,
        [explicitSlug],
      );
      if (!tRes.rowCount) {
        return res.status(400).json({
          message: 'المنصة غير موجودة أو غير مفعّلة لهذا الـ subdomain',
          code: 'TENANT_NOT_FOUND',
        });
      }
      tenantId = tRes.rows[0].id;
    }

    const selfRegistrationAllowed =
      await TeacherManagedStudentsService.isSelfRegistrationAllowed(tenantId);
    if (!selfRegistrationAllowed) {
      return res.status(403).json({
        success: false,
        code: 'SELF_REGISTRATION_DISABLED',
        message:
          'يتم إنشاء الحسابات بواسطة المدرس. يرجى التواصل مع مدرسك للحصول على بيانات تسجيل الدخول.',
      });
    }

    const existing = await pool.query('SELECT id FROM users WHERE phone = $1 AND tenant_id = $2', [
      phone,
      tenantId,
    ]);
    if (existing.rowCount)
      return res.status(400).json({
        message: 'رقم الهاتف مسجّل مسبقاً على هذه المنصة',
        code: 'PHONE_REGISTERED_ON_TENANT',
      });

    const hashed = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (phone, password, name, parent_phone, role, device_ip, course_category, tenant_id)
       VALUES ($1, $2, $3, $4, 'student', NULL, $5, $6)
       RETURNING id, phone, name, parent_phone, role, avatar, device_ip, course_category`,
      [phone, hashed, name, parent_phone, course_category || null, tenantId],
    );

    const user = result.rows[0];
    const ipBind = await StudentDeviceRestrictionService.bindOnRegister({
      studentId: user.id,
      tenantId,
      req,
      body: req.body,
    });
    if (ipBind.bound) {
      user.device_ip = ipBind.ip;
      user.registered_ip = ipBind.ip;
    }

    // إضافة صف الطالب إذا تم إرساله
    if (grade_id && grade_id > 0) {
      try {
        await pool.query(
          'INSERT INTO user_grades (user_id, grade_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [user.id, grade_id],
        );
      } catch (error) {
        console.error('خطأ في إضافة الصف للطالب:', error);
        // لا نوقف العملية إذا فشل إضافة الصف
      }
    }

    // ربط الطالب بمجموعة الكورسات (نظام مستقل عن السنتر)
    if (course_group_id && course_group_id > 0) {
      try {
        const teacherId = await CourseGroupAccessService.resolveTenantOwnerTeacherId(tenantId);
        if (teacherId) {
          const settings = await CourseGroupAccessService.getTeacherSettings(teacherId);
          if (settings.course_group_access_enabled) {
            await CourseGroupAccessService.assignStudentToGroup(
              user.id,
              course_group_id,
              teacherId,
              { skipGradeCheck: !grade_id },
            );
          }
        }
      } catch (error) {
        console.error('خطأ في ربط الطالب بمجموعة الكورس:', error);
        return res.status(400).json({
          message:
            error instanceof Error ? error.message : 'تعذر ربط الطالب بالمجموعة المختارة',
          code: 'COURSE_GROUP_ASSIGN_FAILED',
        });
      }
    }

    const token = await generateToken(user, pool, { sessionTenantId: tenantId });

    // Device Session + Refresh Cookie للطالب الجديد (نفس نظام /login)
    const session = await AuthSessionsService.createDeviceSession({
      userId: user.id,
      tenantId,
      rememberMe: false,
      req,
    });
    setRefreshCookie(req, res, session.refreshToken, false);
    AuthSessionsService.logLogin(user.id, 'student', 'register', req);

    res.status(201).json({
      success: true,
      ip_registered: ipBind.bound,
      user: {
        ...user,
        avatar: user.avatar,
      },
      token,
    });
  }),
);

router.post(
  '/change-password',
  authMiddleware(['admin']),
  validate(ChangePassword),
  asyncWrapper(async (req, res) => {
    const { email, phone, new_password } = req.body;

    // Identify the user
    const query = email ? { field: 'email', value: email } : { field: 'phone', value: phone };

    const userResult = await pool.query(`SELECT id FROM users WHERE ${query.field} = $1`, [
      query.value,
    ]);

    if (!userResult.rowCount) {
      return res.status(404).json({ message: 'User not found' });
    }

    const userId = userResult.rows[0].id;
    const hashedPassword = await bcrypt.hash(new_password, 10);

    await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hashedPassword, userId]);

    res.status(200).json({ message: 'Password updated successfully' });
  }),
);

router.get('/me', authMiddleware(), async (req, res) => {
  const userId = (req as any).user.id;

  const result = await pool.query(
    'SELECT id, phone, name, email, parent_phone, role, avatar FROM users WHERE id = $1',
    [userId],
  );

  if (result.rowCount === 0) {
    return res.status(404).json({ message: 'User not found' });
  }

  const user = result.rows[0];
  res.json({
    user: {
      ...user,
      avatar: publicAvatarUrl(user.avatar),
    },
  });
});

const setMyAvatar = asyncWrapper(async (req, res) => {
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
    return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
  }

  res.json({
    success: true,
    message: 'تم تحديث صورة البروفايل بنجاح',
    data,
  });
});

router.post(
  '/me/avatar',
  authMiddleware(['student']),
  uploadStudentAvatarMiddleware,
  setMyAvatar,
);
router.put(
  '/me/avatar',
  authMiddleware(['student']),
  uploadStudentAvatarMiddleware,
  setMyAvatar,
);
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

// تحديث بيانات المستخدم (يدعم رفع صورة البروفايل)
// للطلاب والمدرسين والادمن
router.put(
  '/me',
  authMiddleware(), // السماح لأي مستخدم مسجل الدخول
  uploadMeAvatarMiddleware,
  asyncWrapper(async (req, res) => {
    const userId = (req as any).user.id;
    const { email, password, name, phone, parent_phone } = req.body;
    const file = pickUploadedAvatar(req);

    // التحقق من صحة البيانات
    const parse = UpdateMe.safeParse({ email, password, name, phone, parent_phone });
    if (!parse.success && Object.keys(req.body).length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: parse.error.errors,
      });
    }

    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    // تحديث البيانات النصية
    if (email) {
      updates.push(`email = $${paramIndex++}`);
      values.push(email);
    }
    if (name) {
      updates.push(`name = $${paramIndex++}`);
      values.push(name);
    }
    if (phone) {
      updates.push(`phone = $${paramIndex++}`);
      values.push(phone);
    }
    if (parent_phone !== undefined) {
      updates.push(`parent_phone = $${paramIndex++}`);
      values.push(parent_phone || null);
    }
    if (password) {
      const hashed = await bcrypt.hash(password, 10);
      updates.push(`password = $${paramIndex++}`);
      values.push(hashed);
      updates.push(`must_change_password = FALSE`);
    }

    // رفع صورة البروفايل إذا تم إرسالها
    if (file) {
      try {
        const stored = await persistAvatarFile(file);
        updates.push(`avatar = $${paramIndex++}`);
        values.push(stored);
      } catch (error) {
        console.error('Error uploading avatar:', error);
        return res.status(500).json({
          success: false,
          message: 'فشل في رفع صورة البروفايل',
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    // تحديث البيانات في قاعدة البيانات
    if (updates.length > 0) {
      values.push(userId);
      await pool.query(`UPDATE users SET ${updates.join(', ')} WHERE id = $${paramIndex}`, values);
    }

    // جلب البيانات المحدثة
    const updated = await pool.query(
      'SELECT id, email, phone, name, parent_phone, role, avatar, created_at FROM users WHERE id = $1',
      [userId],
    );

    if (!updated.rowCount) {
      return res.status(404).json({
        success: false,
        message: 'المستخدم غير موجود',
      });
    }

    const user = updated.rows[0];
    res.json({
      success: true,
      message: 'تم تحديث البيانات بنجاح',
      user: {
        ...user,
        avatar: publicAvatarUrl(user.avatar),
      },
    });
  }),
);

/**
 * @example
 * - Get first 10 teachers: GET /admin/users?role=teacher&limit=10&skip=0
 * - Get students in grade 5: GET /admin/users?role=student&grade_ids=5
 * - Get all users in grade 3 or 7: GET /admin/users?grade_ids=3,7
 */
router.get(
  '/',
  authMiddleware(['admin']),
  asyncWrapper(async (req, res) => {
    const {
      limit = 10,
      skip = 0,
      role,
      grade_ids,
    } = req.query as {
      limit?: string;
      skip?: string;
      role?: string;
      grade_ids?: string;
    };

    const values: any[] = [];
    let whereClause = '';
    let joinClause = '';
    let counter = 1;

    // Filter by role
    if (role) {
      whereClause += `users.role = $${counter}`;
      values.push(role);
      counter++;
    }

    // Filter by grades (join user_grades)
    if (grade_ids) {
      const ids = grade_ids
        .split(',')
        .map((id) => parseInt(id.trim()))
        .filter(Boolean);
      if (ids.length > 0) {
        if (whereClause) whereClause += ' AND ';
        joinClause = `
          JOIN user_grades ug ON users.id = ug.user_id
        `;
        whereClause += `ug.grade_id = ANY($${counter})`;
        values.push(ids);
        counter++;
      }
    }

    const whereSQL = whereClause ? `WHERE ${whereClause}` : '';
    const limitSQL = `LIMIT $${counter}`;
    const offsetSQL = `OFFSET $${counter + 1}`;
    values.push(Number(limit));
    values.push(Number(skip));

    const query = `
      SELECT DISTINCT users.id, users.name, users.email, users.phone, users.role, users.avatar, users.created_at
      FROM users
      ${joinClause}
      ${whereSQL}
      ORDER BY users.created_at DESC
      ${limitSQL}
      ${offsetSQL}
    `;

    const result = await pool.query(query, values);
    res.json({
      users: result.rows.map((user) => ({
        ...user,
        avatar: user.avatar,
      })),
    });
  }),
);

// جلب كل الصفوف الدراسية (grades) لأي مستخدم
router.get(
  '/grades',
  asyncWrapper(async (req, res) => {
    const result = await pool.query('SELECT id, name FROM grades ORDER BY id');
    res.json({ grades: result.rows });
  }),
);

// جلب جميع المدرسين للادمن
router.get(
  '/teachers',
  authMiddleware(['admin']),
  asyncWrapper(async (req, res) => {
    const {
      limit,
      skip = 0,
      grade_ids,
    } = req.query as {
      limit?: string;
      skip?: string;
      grade_ids?: string;
    };

    const values: any[] = [];
    let joinClause = '';
    let whereClause = 'users.role = $1';
    let counter = 2;
    values.push('teacher');

    // Filter by grades (join teacher_grades)
    if (grade_ids) {
      const ids = grade_ids
        .split(',')
        .map((id) => parseInt(id.trim()))
        .filter(Boolean);
      if (ids.length > 0) {
        joinClause = `
          LEFT JOIN teacher_grades tg ON users.id = tg.teacher_id
        `;
        whereClause += ` AND tg.grade_id = ANY($${counter})`;
        values.push(ids);
        counter++;
      }
    }

    // إضافة LIMIT و OFFSET فقط إذا تم تحديدهما
    let limitSQL = '';
    let offsetSQL = '';
    if (limit) {
      limitSQL = `LIMIT $${counter}`;
      offsetSQL = `OFFSET $${counter + 1}`;
      values.push(Number(limit));
      values.push(Number(skip));
      counter += 2;
    }

    const query = `
      SELECT DISTINCT 
        users.id, 
        users.name, 
        users.email, 
        users.phone, 
        users.avatar, 
        users.description,
        users.subject,
        users.facebook_url,
        users.instagram_url,
        users.youtube_url,
        users.tiktok_url,
        users.whatsapp_number,
        users.created_at,
        t.subdomain,
        COUNT(DISTINCT c.id) as courses_count,
        COUNT(DISTINCT e.user_id) as students_count
      FROM users
      ${joinClause}
      LEFT JOIN tenants t ON t.id = users.tenant_id
      LEFT JOIN courses c ON users.id = c.teacher_id
      LEFT JOIN enrollments e ON c.id = e.course_id
      WHERE ${whereClause}
      GROUP BY users.id, users.name, users.email, users.phone, users.avatar, users.description, users.subject, users.facebook_url, users.instagram_url, users.youtube_url, users.tiktok_url, users.whatsapp_number, users.created_at, t.subdomain
      ORDER BY users.created_at DESC
      ${limitSQL}
      ${offsetSQL}
    `;

    const result = await pool.query(query, values);

    // إضافة Base URL لصور المدرسين
    const teachersWithBaseUrl = result.rows.map((teacher) => ({
      ...teacher,
      avatar: teacher.avatar,
    }));

    // جلب الصفوف الدراسية لكل مدرس
    const teacherIds = teachersWithBaseUrl.map((t) => t.id);
    let gradesMap: { [teacherId: number]: { id: number; name: string }[] } = {};

    if (teacherIds.length > 0) {
      const gradesRes = await pool.query(
        `SELECT tg.teacher_id, g.id, g.name
         FROM teacher_grades tg
         JOIN grades g ON tg.grade_id = g.id
         WHERE tg.teacher_id = ANY($1::int[])`,
        [teacherIds],
      );

      gradesMap = gradesRes.rows.reduce((acc, row) => {
        if (!acc[row.teacher_id]) acc[row.teacher_id] = [];
        acc[row.teacher_id].push({ id: row.id, name: row.name });
        return acc;
      }, {});
    }

    res.json({
      teachers: teachersWithBaseUrl.map((teacher) => ({
        ...teacher,
        grades: gradesMap[teacher.id] || [],
      })),
      total: teachersWithBaseUrl.length,
      message: limit ? `تم جلب ${teachersWithBaseUrl.length} مدرس` : 'تم جلب جميع المدرسين',
    });
  }),
);

// تعديل مدرس (للادمن)
router.put(
  '/teachers/:id',
  authMiddleware(['admin']),
  asyncWrapper(async (req, res) => {
    const { id } = req.params;
    const {
      name,
      email,
      phone,
      password,
      description,
      subject,
      grade_ids,
      facebook_url,
      instagram_url,
      youtube_url,
      tiktok_url,
      whatsapp_number,
    } = req.body;

    // التحقق من وجود المدرس
    const teacherCheck = await pool.query('SELECT id FROM users WHERE id = $1 AND role = $2', [
      id,
      'teacher',
    ]);

    if (!teacherCheck.rowCount) {
      return res.status(404).json({ message: 'المدرس غير موجود' });
    }

    const updates: string[] = [];
    const values: any[] = [];
    let counter = 1;

    if (name !== undefined) {
      updates.push(`name = $${counter++}`);
      values.push(name);
    }
    if (email !== undefined) {
      updates.push(`email = $${counter++}`);
      values.push(email);
    }
    if (phone !== undefined) {
      updates.push(`phone = $${counter++}`);
      values.push(phone);
    }
    if (password !== undefined) {
      const hashed = await bcrypt.hash(password, 10);
      updates.push(`password = $${counter++}`);
      values.push(hashed);
    }
    if (description !== undefined) {
      updates.push(`description = $${counter++}`);
      values.push(description);
    }
    if (subject !== undefined) {
      updates.push(`subject = $${counter++}`);
      values.push(subject);
    }
    if (facebook_url !== undefined) {
      updates.push(`facebook_url = $${counter++}`);
      values.push(facebook_url);
    }
    if (instagram_url !== undefined) {
      updates.push(`instagram_url = $${counter++}`);
      values.push(instagram_url);
    }
    if (youtube_url !== undefined) {
      updates.push(`youtube_url = $${counter++}`);
      values.push(youtube_url);
    }
    if (tiktok_url !== undefined) {
      updates.push(`tiktok_url = $${counter++}`);
      values.push(tiktok_url);
    }
    if (whatsapp_number !== undefined) {
      updates.push(`whatsapp_number = $${counter++}`);
      values.push(whatsapp_number);
    }

    // تحديث بيانات المدرس (إذا كان هناك تحديثات)
    let result;
    if (updates.length > 0) {
      values.push(id);
      result = await pool.query(
        `UPDATE users 
       SET ${updates.join(', ')} 
       WHERE id = $${counter++} AND role = 'teacher' 
       RETURNING id, name, email, phone, avatar, description, subject, facebook_url, instagram_url, youtube_url, tiktok_url, whatsapp_number, created_at`,
        values,
      );
    } else {
      // إذا لم يكن هناك تحديثات في جدول users، جلب البيانات الحالية
      result = await pool.query(
        `SELECT id, name, email, phone, avatar, description, subject, facebook_url, instagram_url, youtube_url, tiktok_url, whatsapp_number, created_at
         FROM users 
         WHERE id = $1 AND role = 'teacher'`,
        [id],
      );
    }

    // التحقق من وجود المدرس
    if (!result.rowCount) {
      return res.status(404).json({ message: 'المدرس غير موجود' });
    }

    // تحديث الصفوف الدراسية إذا تم إرسالها
    let updatedGrades: { id: number; name: string }[] = [];
    if (grade_ids !== undefined) {
      const gradeIdsArr = Array.isArray(grade_ids)
        ? grade_ids.map(Number)
        : grade_ids
          .split(',')
          .map((id: any) => Number(id.trim()))
          .filter(Boolean);

      // التحقق من وجود الصفوف الدراسية
      if (gradeIdsArr.length > 0) {
        const gradeCheck = await pool.query('SELECT id FROM grades WHERE id = ANY($1::int[])', [
          gradeIdsArr,
        ]);

        if (gradeCheck.rowCount !== gradeIdsArr.length) {
          return res.status(400).json({
            message: 'بعض الصفوف الدراسية غير موجودة',
            invalid_grade_ids: gradeIdsArr.filter(
              (id: any) => !gradeCheck.rows.some((r: any) => r.id === id),
            ),
          });
        }
      }

      // حذف الصفوف الحالية
      await pool.query('DELETE FROM teacher_grades WHERE teacher_id = $1', [id]);

      // إضافة الصفوف الجديدة
      if (gradeIdsArr.length > 0) {
        const gradeValues = gradeIdsArr.map((gradeId: any) => [id, gradeId]);
        await pool.query(
          'INSERT INTO teacher_grades (teacher_id, grade_id) VALUES ' +
          gradeValues.map((_: any, i: any) => `($${i * 2 + 1}, $${i * 2 + 2})`).join(', ') +
          ' ON CONFLICT (teacher_id, grade_id) DO NOTHING',
          gradeValues.flat(),
        );
      }

      // جلب الصفوف المحدثة
      const gradesRes = await pool.query(
        `SELECT g.id, g.name 
         FROM teacher_grades tg 
         JOIN grades g ON tg.grade_id = g.id 
         WHERE tg.teacher_id = $1 
         ORDER BY g.id`,
        [id],
      );
      updatedGrades = gradesRes.rows;
    } else {
      // إذا لم يتم إرسال grade_ids، جلب الصفوف الحالية
      const gradesRes = await pool.query(
        `SELECT g.id, g.name 
         FROM teacher_grades tg 
         JOIN grades g ON tg.grade_id = g.id 
         WHERE tg.teacher_id = $1 
         ORDER BY g.id`,
        [id],
      );
      updatedGrades = gradesRes.rows;
    }

    res.json({
      message: 'تم تحديث بيانات المدرس بنجاح',
      teacher: {
        ...result.rows[0],
        grades: updatedGrades,
      },
    });
  }),
);

// حذف مدرس (للادمن)
router.delete(
  '/teachers/:id',
  authMiddleware(['admin']),
  asyncWrapper(async (req, res) => {
    const { id } = req.params;

    // التحقق من وجود المدرس
    const teacherCheck = await pool.query(
      'SELECT id, name FROM users WHERE id = $1 AND role = $2',
      [id, 'teacher'],
    );

    if (!teacherCheck.rowCount) {
      return res.status(404).json({ message: 'المدرس غير موجود' });
    }

    const teacher = teacherCheck.rows[0];

    // حذف المدرس (سيتم حذف كل البيانات المرتبطة به تلقائياً بسبب CASCADE)
    await pool.query('DELETE FROM users WHERE id = $1 AND role = $2', [id, 'teacher']);

    res.json({
      message: 'تم حذف المدرس بنجاح',
      teacher: {
        id: teacher.id,
        name: teacher.name,
      },
    });
  }),
);

// تغيير كلمة سر الطالب (للأدمن)
router.patch(
  '/students/:id/password',
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
      const { id } = req.params;
      const { new_password } = req.body;

      // التحقق من وجود كلمة السر الجديدة
      if (!new_password || new_password.length < 6) {
        return res.status(400).json({
          success: false,
          message: 'كلمة السر الجديدة مطلوبة ويجب أن تكون 6 أحرف على الأقل',
        });
      }

      // التحقق من وجود الطالب
      const studentCheck = await pool.query(
        'SELECT id, name, phone FROM users WHERE id = $1 AND role = $2',
        [id, 'student'],
      );

      if (!studentCheck.rowCount) {
        return res.status(404).json({
          success: false,
          message: 'الطالب غير موجود',
        });
      }

      const student = studentCheck.rows[0];

      // تشفير كلمة السر الجديدة
      const hashedPassword = await bcrypt.hash(new_password, 10);

      // تحديث كلمة السر
      await pool.query('UPDATE users SET password = $1 WHERE id = $2 AND role = $3', [
        hashedPassword,
        id,
        'student',
      ]);

      res.json({
        success: true,
        message: 'تم تغيير كلمة سر الطالب بنجاح',
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
        message: 'فشل في تغيير كلمة سر الطالب',
        error: error.message,
      });
    }
  }),
);

// إعادة نقاط الطالب لصفر (للأدمن)
router.post(
  '/students/:id/reset-points',
  authMiddleware(['admin']),
  asyncWrapper(async (req, res) => {
    try {
      const { id } = req.params;
      const adminId = req.user!.id;
      const studentId = parseInt(id);

      if (isNaN(studentId)) {
        return res.status(400).json({
          success: false,
          message: 'معرف الطالب غير صحيح',
        });
      }

      // التحقق من وجود الطالب
      const studentCheck = await pool.query(
        'SELECT id, name, phone FROM users WHERE id = $1 AND role = $2',
        [studentId, 'student'],
      );

      if (!studentCheck.rowCount) {
        return res.status(404).json({
          success: false,
          message: 'الطالب غير موجود',
        });
      }

      const student = studentCheck.rows[0];

      // جلب النقاط الحالية
      const currentPoints = await StudentPointsService.getStudentPoints(studentId);

      // إعادة النقاط لصفر
      await StudentPointsService.resetPoints(studentId, adminId);

      res.json({
        success: true,
        message: 'تم إعادة النقاط لصفر بنجاح',
        data: {
          student_id: student.id,
          student_name: student.name,
          student_phone: student.phone,
          previous_points: currentPoints?.total_points || 0,
          current_points: 0,
          reset_at: new Date().toISOString(),
          reset_by: adminId,
        },
      });
    } catch (error: any) {
      console.error('Error resetting student points:', error);
      res.status(500).json({
        success: false,
        message: 'فشل في إعادة النقاط لصفر',
        error: error.message,
      });
    }
  }),
);

// السماح للطالب باستخدام جهاز آخر — مدرس / أكاديمية / أدمن
// الفرونت يستدعي POST /api/users/students/allow-device
const allowStudentNewDevice = asyncWrapper(async (req, res) => {
  await StudentDeviceRestrictionService.ensureSchema();

  const body = req.body ?? {};
  const phoneRaw = body.phone ?? body.student_phone ?? body.studentPhone;
  const phone = typeof phoneRaw === 'string' ? phoneRaw.trim() : '';
  const studentIdRaw = body.student_id ?? body.studentId ?? body.id;
  const studentId = Number(studentIdRaw);
  const hasStudentId = Number.isInteger(studentId) && studentId > 0;

  if (!phone && !hasStudentId) {
    return res.status(400).json({
      success: false,
      message: 'أرسل student_id أو رقم الهاتف',
      code: 'STUDENT_IDENTIFIER_REQUIRED',
    });
  }

  const role = req.user!.role;
  const tenantId = req.tenant?.id ?? req.user!.tenant_id ?? null;
  const isPlatformStaff =
    role === 'teacher' || role === 'academy' || role === 'academy_teacher';

  if (isPlatformStaff && !tenantId) {
    return res.status(400).json({
      success: false,
      message: 'تعذر تحديد المنصة',
      code: 'TENANT_REQUIRED',
    });
  }

  let studentQuery;
  if (hasStudentId) {
    studentQuery = isPlatformStaff && tenantId
      ? await pool.query(
          `SELECT id, name, phone, device_ip, registered_ip, tenant_id
           FROM users WHERE id = $1 AND role = 'student' AND tenant_id = $2`,
          [studentId, tenantId],
        )
      : await pool.query(
          `SELECT id, name, phone, device_ip, registered_ip, tenant_id
           FROM users WHERE id = $1 AND role = 'student'`,
          [studentId],
        );
  } else {
    studentQuery = isPlatformStaff && tenantId
      ? await pool.query(
          `SELECT id, name, phone, device_ip, registered_ip, tenant_id
           FROM users WHERE phone = $1 AND role = 'student' AND tenant_id = $2`,
          [phone, tenantId],
        )
      : await pool.query(
          `SELECT id, name, phone, device_ip, registered_ip, tenant_id
           FROM users WHERE phone = $1 AND role = 'student'`,
          [phone],
        );
  }

  if (!studentQuery.rowCount) {
    return res.status(404).json({
      success: false,
      message: 'الطالب غير موجود',
      code: 'STUDENT_NOT_FOUND',
    });
  }

  const student = studentQuery.rows[0];
  const data = await StudentDeviceRestrictionService.resetStudentIp({
    studentId: student.id,
    tenantId: student.tenant_id || tenantId || 0,
    performedBy: req.user!.id,
    requireTenantOwner: false,
  });

  res.json({
    success: true,
    message: 'تم السماح للطالب باستخدام جهاز آخر بنجاح',
    data: {
      student_id: data.student_id,
      student_name: data.student_name,
      student_phone: data.student_phone,
      old_device_ip: data.old_ip,
      old_ip: data.old_ip,
      new_device_ip: null,
      registered_ip: null,
      note: 'يمكن للطالب الآن تسجيل الدخول من الجهاز الجديد. سيتم حفظ IP الجهاز الجديد تلقائياً عند أول تسجيل دخول.',
      updated_at: data.ip_reset_at,
    },
  });
});

router.post(
  '/students/allow-device',
  authMiddleware(['teacher', 'academy', 'academy_teacher', 'admin', 'employee']),
  allowStudentNewDevice,
);
router.patch(
  '/students/allow-device',
  authMiddleware(['teacher', 'academy', 'academy_teacher', 'admin', 'employee']),
  allowStudentNewDevice,
);
