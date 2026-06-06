import pool from '../db/pool';
import * as ExpoPushService from './expoPushService';

export interface ActivationCodeDetails {
  code: string;
  id: number;
  course: { id: number; title: string };
  teacher: { id: number; name: string; email: string | null; phone: string | null };
  max_uses: number;
  uses: number;
  is_used: boolean;
  is_expired: boolean;
  expires_at: string | null;
  created_at: string | null;
  used_by: Array<{
    user_id: number;
    name: string;
    email: string | null;
    phone: string | null;
    used_at: string | null;
  }>;
}

/**
 * البحث عن كود التفعيل بالكود (للاستخدام من البوت أو الأدمن)
 * نفس منطق GET /api/course/admin/activation-code/:code
 */
export async function getActivationCodeDetails(code: string): Promise<ActivationCodeDetails | null> {
  const trimmed = (code || '').trim();
  if (!trimmed) return null;

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
    [trimmed],
  );

  if (!codeRow.rowCount) return null;

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

  return {
    code: row.code,
    id: row.id,
    course: { id: row.course_id, title: row.course_title },
    teacher: {
      id: row.teacher_id,
      name: row.teacher_name,
      email: row.teacher_email ?? null,
      phone: row.teacher_phone ?? null,
    },
    max_uses: Number(row.max_uses),
    uses: Number(row.uses),
    is_used: isUsed,
    is_expired: !!isExpired,
    expires_at: row.expires_at ?? null,
    created_at: row.created_at ?? null,
    used_by: usagesRes.rows.map((u: any) => ({
      user_id: u.user_id,
      name: u.user_name,
      email: u.user_email ?? null,
      phone: u.user_phone ?? null,
      used_at: u.used_at ?? null,
    })),
  };
}

export interface ActivateByCodeResult {
  success: boolean;
  message: string;
  course?: { id: number; title: string };
}

/**
 * تفعيل الكورس لطالب باستخدام كود التفعيل (للاستخدام من البوت أو الأدمن)
 */
export async function activateCourseByCodeForStudent(
  studentId: number,
  code: string,
): Promise<ActivateByCodeResult> {
  const trimmed = (code || '').trim();
  if (!trimmed) return { success: false, message: 'كود التفعيل مطلوب' };

  const details = await getActivationCodeDetails(trimmed);
  if (!details) return { success: false, message: 'الكود غير موجود' };
  if (details.is_expired) return { success: false, message: 'الكود منتهي الصلاحية' };
  if (details.is_used) return { success: false, message: 'الكود مستنفذ بالكامل' };

  const studentCheck = await pool.query(
    'SELECT id FROM users WHERE id = $1 AND role = $2',
    [studentId, 'student'],
  );
  if (!studentCheck.rowCount) return { success: false, message: 'الطالب غير موجود أو ليس حساب طالب' };

  const usageCheck = await pool.query(
    'SELECT id FROM invite_code_usages WHERE user_id = $1 AND code_id = $2',
    [studentId, details.id],
  );
  if (usageCheck.rowCount && usageCheck.rowCount > 0) {
    return { success: false, message: 'هذا الطالب مفعّل له الكورس مسبقاً بهذا الكود' };
  }

  await pool.query('INSERT INTO invite_code_usages (user_id, code_id) VALUES ($1, $2)', [
    studentId,
    details.id,
  ]);
  await pool.query('UPDATE teacher_invite_codes SET uses = uses + 1 WHERE id = $1', [details.id]);
  await pool.query(
    'INSERT INTO enrollments (user_id, course_id) VALUES ($1, $2) ON CONFLICT (user_id, course_id) DO NOTHING',
    [studentId, details.course.id],
  );

  try {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-expect-error
    const { ChatService } = await import('./chat');
    const gradeRes = await pool.query(
      'SELECT grade_id, teacher_id FROM courses WHERE id = $1',
      [details.course.id],
    );
    if (gradeRes.rowCount) {
      const gradeId = gradeRes.rows[0].grade_id as number;
      const teacherId = gradeRes.rows[0].teacher_id as number;
      const group = await ChatService.getOrCreateTeacherGradeGroup(gradeId, teacherId);
      await ChatService.addMember(group.id, studentId, 'student');
    }
  } catch (err) {
    console.warn('activateCourseByCodeForStudent: chat group add failed', err);
  }

  try {
    await pool.query(
      `INSERT INTO notifications (user_id, title, message, type, course_id) VALUES ($1, $2, $3, $4, $5)`,
      [
        studentId,
        'كورس جديد متاح',
        `تم تفعيل كورس "${details.course.title}" لك`,
        'course_opened',
        details.course.id,
      ],
    );
    ExpoPushService.sendPushNotification(
      studentId,
      'كورس جديد متاح',
      `تم تفعيل كورس "${details.course.title}" لك`,
      { type: 'course_opened', course_id: details.course.id },
    ).catch((e) => console.error('Expo push error:', e));
    
  } catch (_) {
    // ...
  }

  return {
    success: true,
    message: 'تم تفعيل الكورس بنجاح',
    course: { id: details.course.id, title: details.course.title },
  };
}
