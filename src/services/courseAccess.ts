import pool from '../db/pool';

/**
 * واجهة بيانات التسجيل مع معلومات التحكم في الوصول
 */
export interface EnrollmentAccess {
  id: number;
  user_id: number;
  course_id: number;
  subscription_status: 'active' | 'expired' | 'suspended';
  is_blocked_by_teacher: boolean;
  blocked_at: string | null;
  blocked_by: number | null;
  expires_at: string | null;
  enrolled_at: string;
}

/**
 * نتيجة التحقق من صلاحية الوصول
 */
export interface AccessCheckResult {
  hasAccess: boolean;
  message?: string;
  reason?: 'not_enrolled' | 'expired' | 'suspended' | 'blocked' | 'not_active';
}

/**
 * Service للتحكم في الوصول إلى محتوى المقرر الدراسي
 */
export class CourseAccessService {
  /**
   * التحقق من صلاحية الطالب للوصول إلى محتوى المقرر
   */
  static async checkStudentAccess(studentId: number, courseId: number): Promise<AccessCheckResult> {
    // جلب معلومات التسجيل
    const enrollmentResult = await pool.query<EnrollmentAccess>(
      `SELECT 
        id, user_id, course_id, subscription_status, 
        is_blocked_by_teacher, blocked_at, blocked_by, expires_at, enrolled_at
       FROM enrollments
       WHERE user_id = $1 AND course_id = $2`,
      [studentId, courseId],
    );

    // إذا لم يكن الطالب مسجل في المقرر
    if (!enrollmentResult.rowCount) {
      return {
        hasAccess: false,
        message: 'غير مسجل في هذا المقرر الدراسي',
        reason: 'not_enrolled',
      };
    }

    const enrollment = enrollmentResult.rows[0];

    // التحقق من الحظر بواسطة المعلم
    if (enrollment.is_blocked_by_teacher) {
      return {
        hasAccess: false,
        message: 'تم حجب المحتوي لحين تجديد الاشتراك',
        reason: 'blocked',
      };
    }

    // التحقق من حالة الاشتراك
    if (enrollment.subscription_status === 'expired') {
      return {
        hasAccess: false,
        message: 'تم حجب المحتوي لحين تجديد الاشتراك',
        reason: 'expired',
      };
    }

    if (enrollment.subscription_status === 'suspended') {
      return {
        hasAccess: false,
        message: 'تم حجب المحتوي لحين تجديد الاشتراك',
        reason: 'suspended',
      };
    }

    // التحقق من انتهاء الصلاحية (إذا كان expires_at موجود)
    if (enrollment.expires_at) {
      const expiresAt = new Date(enrollment.expires_at);
      const now = new Date();
      if (now > expiresAt) {
        return {
          hasAccess: false,
          message: 'تم حجب المحتوي لحين تجديد الاشتراك',
          reason: 'expired',
        };
      }
    }

    // التحقق من أن الحالة نشطة
    if (enrollment.subscription_status !== 'active') {
      return {
        hasAccess: false,
        message: 'تم حجب المحتوي لحين تجديد الاشتراك',
        reason: 'not_active',
      };
    }

    // الطالب لديه صلاحية الوصول
    return {
      hasAccess: true,
    };
  }

  /**
   * حظر محتوى المقرر لجميع الطلاب المسجلين
   */
  static async blockAllStudents(
    courseId: number,
    blockedBy: number,
  ): Promise<{ blocked_count: number }> {
    const result = await pool.query(
      `UPDATE enrollments
       SET is_blocked_by_teacher = TRUE,
           blocked_at = NOW(),
           blocked_by = $1
       WHERE course_id = $2 AND is_blocked_by_teacher = FALSE`,
      [blockedBy, courseId],
    );

    return { blocked_count: result.rowCount || 0 };
  }

  /**
   * إلغاء حظر محتوى المقرر لجميع الطلاب
   */
  static async unblockAllStudents(courseId: number): Promise<{ unblocked_count: number }> {
    const result = await pool.query(
      `UPDATE enrollments
       SET is_blocked_by_teacher = FALSE,
           blocked_at = NULL,
           blocked_by = NULL
       WHERE course_id = $1 AND is_blocked_by_teacher = TRUE`,
      [courseId],
    );

    return { unblocked_count: result.rowCount || 0 };
  }

  /**
   * حظر محتوى المقرر لطالب محدد
   */
  static async blockStudent(
    courseId: number,
    studentId: number,
    blockedBy: number,
  ): Promise<{ success: boolean; message: string }> {
    // التحقق من أن الطالب مسجل في المقرر
    const enrollmentCheck = await pool.query(
      `SELECT id FROM enrollments WHERE course_id = $1 AND user_id = $2`,
      [courseId, studentId],
    );

    if (!enrollmentCheck.rowCount) {
      return {
        success: false,
        message: 'الطالب غير مسجل في هذا المقرر',
      };
    }

    // حظر المحتوى
    await pool.query(
      `UPDATE enrollments
       SET is_blocked_by_teacher = TRUE,
           blocked_at = NOW(),
           blocked_by = $1
       WHERE course_id = $2 AND user_id = $3`,
      [blockedBy, courseId, studentId],
    );

    return {
      success: true,
      message: 'تم حظر المحتوى للطالب بنجاح',
    };
  }

  /**
   * إلغاء حظر محتوى المقرر لطالب محدد
   */
  static async unblockStudent(
    courseId: number,
    studentId: number,
  ): Promise<{ success: boolean; message: string }> {
    // التحقق من أن الطالب مسجل في المقرر
    const enrollmentCheck = await pool.query(
      `SELECT id FROM enrollments WHERE course_id = $1 AND user_id = $2`,
      [courseId, studentId],
    );

    if (!enrollmentCheck.rowCount) {
      return {
        success: false,
        message: 'الطالب غير مسجل في هذا المقرر',
      };
    }

    // إلغاء حظر المحتوى
    await pool.query(
      `UPDATE enrollments
       SET is_blocked_by_teacher = FALSE,
           blocked_at = NULL,
           blocked_by = NULL
       WHERE course_id = $1 AND user_id = $2`,
      [courseId, studentId],
    );

    return {
      success: true,
      message: 'تم إلغاء حظر المحتوى للطالب بنجاح',
    };
  }

  /**
   * حظر محتوى المقرر لمجموعة من الطلاب
   */
  static async blockStudents(
    courseId: number,
    studentIds: number[],
    blockedBy: number,
  ): Promise<{ blocked_count: number; failed_count: number }> {
    if (studentIds.length === 0) {
      return { blocked_count: 0, failed_count: 0 };
    }

    // التحقق من أن جميع الطلاب مسجلين في المقرر
    const enrolledCheck = await pool.query(
      `SELECT user_id FROM enrollments 
       WHERE course_id = $1 AND user_id = ANY($2::int[])`,
      [courseId, studentIds],
    );

    const enrolledIds = enrolledCheck.rows.map((row) => row.user_id);
    const failedCount = studentIds.length - enrolledIds.length;

    if (enrolledIds.length === 0) {
      return { blocked_count: 0, failed_count: failedCount };
    }

    // حظر المحتوى للطلاب المسجلين
    const result = await pool.query(
      `UPDATE enrollments
       SET is_blocked_by_teacher = TRUE,
           blocked_at = NOW(),
           blocked_by = $1
       WHERE course_id = $2 AND user_id = ANY($3::int[]) AND is_blocked_by_teacher = FALSE`,
      [blockedBy, courseId, enrolledIds],
    );

    return {
      blocked_count: result.rowCount || 0,
      failed_count: failedCount,
    };
  }

  /**
   * إلغاء حظر محتوى المقرر لمجموعة من الطلاب
   */
  static async unblockStudents(
    courseId: number,
    studentIds: number[],
  ): Promise<{ unblocked_count: number; failed_count: number }> {
    if (studentIds.length === 0) {
      return { unblocked_count: 0, failed_count: 0 };
    }

    // التحقق من أن جميع الطلاب مسجلين في المقرر
    const enrolledCheck = await pool.query(
      `SELECT user_id FROM enrollments 
       WHERE course_id = $1 AND user_id = ANY($2::int[])`,
      [courseId, studentIds],
    );

    const enrolledIds = enrolledCheck.rows.map((row) => row.user_id);
    const failedCount = studentIds.length - enrolledIds.length;

    if (enrolledIds.length === 0) {
      return { unblocked_count: 0, failed_count: failedCount };
    }

    // إلغاء حظر المحتوى للطلاب المسجلين
    const result = await pool.query(
      `UPDATE enrollments
       SET is_blocked_by_teacher = FALSE,
           blocked_at = NULL,
           blocked_by = NULL
       WHERE course_id = $1 AND user_id = ANY($2::int[]) AND is_blocked_by_teacher = TRUE`,
      [courseId, enrolledIds],
    );

    return {
      unblocked_count: result.rowCount || 0,
      failed_count: failedCount,
    };
  }

  /**
   * تحديث حالة الاشتراك عند تجديد الاشتراك
   */
  static async renewSubscription(
    courseId: number,
    studentId: number,
    expiresAt?: Date,
  ): Promise<{ success: boolean; message: string }> {
    // التحقق من أن الطالب مسجل في المقرر
    const enrollmentCheck = await pool.query(
      `SELECT id FROM enrollments WHERE course_id = $1 AND user_id = $2`,
      [courseId, studentId],
    );

    if (!enrollmentCheck.rowCount) {
      return {
        success: false,
        message: 'الطالب غير مسجل في هذا المقرر',
      };
    }

    // تحديث حالة الاشتراك وإلغاء الحظر
    await pool.query(
      `UPDATE enrollments
       SET subscription_status = 'active',
           is_blocked_by_teacher = FALSE,
           blocked_at = NULL,
           blocked_by = NULL,
           expires_at = $1
       WHERE course_id = $2 AND user_id = $3`,
      [expiresAt || null, courseId, studentId],
    );

    return {
      success: true,
      message: 'تم تجديد الاشتراك وإعادة تفعيل المحتوى بنجاح',
    };
  }

  /**
   * جلب قائمة الطلاب المحظورين في المقرر
   */
  static async getBlockedStudents(courseId: number): Promise<
    Array<{
      student_id: number;
      student_name: string;
      student_email: string;
      blocked_at: string;
      blocked_by: number | null;
      blocked_by_name: string | null;
    }>
  > {
    const result = await pool.query(
      `SELECT 
        e.user_id as student_id,
        u.name as student_name,
        u.email as student_email,
        e.blocked_at,
        e.blocked_by,
        blocker.name as blocked_by_name
       FROM enrollments e
       JOIN users u ON e.user_id = u.id
       LEFT JOIN users blocker ON e.blocked_by = blocker.id
       WHERE e.course_id = $1 AND e.is_blocked_by_teacher = TRUE
       ORDER BY e.blocked_at DESC`,
      [courseId],
    );

    return result.rows;
  }
}
