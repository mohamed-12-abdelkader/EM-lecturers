import pool from '../db/pool';
import { HttpError } from '../utils';

export type ContentManagerRole = 'teacher' | 'academy' | 'academy_teacher' | 'admin' | 'employee';

type RequestUser = {
  id: number;
  role: string;
  tenant_id?: number | null;
};

/**
 * صلاحية إدارة كورس:
 * - admin: دائماً
 * - teacher: courses.teacher_id = user
 * - academy: مالك المنصة أو teacher_id = academy user أو course.tenant_id = academy tenant
 * - academy_teacher: مسند في course_managers فقط
 */
export class CourseAccessControl {
  static async canManageCourse(user: RequestUser, courseId: number): Promise<boolean> {
    if (!user?.id || !courseId) return false;
    if (user.role === 'admin') return true;

    const courseRes = await pool.query<{
      teacher_id: number;
      tenant_id: number | null;
    }>(`SELECT teacher_id, tenant_id FROM courses WHERE id = $1`, [courseId]);
    if (!courseRes.rowCount) return false;

    const course = courseRes.rows[0];

    if (user.role === 'teacher') {
      return course.teacher_id === user.id;
    }

    if (user.role === 'academy') {
      if (course.teacher_id === user.id) return true;
      if (user.tenant_id && course.tenant_id === user.tenant_id) return true;
      // مالك المنصة حتى لو teacher_id لمدرس آخر ضمن الأكاديمية
      if (user.tenant_id) {
        const owner = await pool.query(
          `SELECT 1 FROM tenants WHERE id = $1 AND owner_user_id = $2 AND platform_type = 'academy'`,
          [user.tenant_id, user.id],
        );
        if (owner.rowCount && course.tenant_id === user.tenant_id) return true;
      }
      return false;
    }

    if (user.role === 'academy_teacher') {
      const assigned = await pool.query(
        `SELECT 1 FROM course_managers
         WHERE course_id = $1 AND user_id = $2
         LIMIT 1`,
        [courseId, user.id],
      );
      return Boolean(assigned.rowCount);
    }

    return false;
  }

  static async assertCanManageCourse(user: RequestUser, courseId: number): Promise<void> {
    const ok = await this.canManageCourse(user, courseId);
    if (!ok) {
      throw new HttpError(403, 'ليس لديك صلاحية إدارة هذا الكورس', {
        code: 'COURSE_FORBIDDEN',
      });
    }
  }

  static async assertCourseExists(courseId: number) {
    const r = await pool.query(`SELECT id, teacher_id, tenant_id, title FROM courses WHERE id = $1`, [
      courseId,
    ]);
    if (!r.rowCount) throw new HttpError(404, 'الكورس غير موجود');
    return r.rows[0] as {
      id: number;
      teacher_id: number;
      tenant_id: number | null;
      title: string;
    };
  }

  /** كورسات يمكن للمستخدم إدارتها */
  static async listManagedCourseIds(user: RequestUser): Promise<number[]> {
    if (user.role === 'admin') {
      const r = await pool.query(`SELECT id FROM courses ORDER BY id`);
      return r.rows.map((x) => x.id as number);
    }

    if (user.role === 'teacher') {
      const r = await pool.query(`SELECT id FROM courses WHERE teacher_id = $1`, [user.id]);
      return r.rows.map((x) => x.id as number);
    }

    if (user.role === 'academy') {
      const r = await pool.query(
        `SELECT id FROM courses
         WHERE teacher_id = $1
            OR ($2::int IS NOT NULL AND tenant_id = $2)
         ORDER BY id DESC`,
        [user.id, user.tenant_id ?? null],
      );
      return r.rows.map((x) => x.id as number);
    }

    if (user.role === 'academy_teacher') {
      const r = await pool.query(
        `SELECT course_id AS id FROM course_managers WHERE user_id = $1 ORDER BY course_id`,
        [user.id],
      );
      return r.rows.map((x) => x.id as number);
    }

    return [];
  }

  static isPlatformOwnerRole(role: string): boolean {
    return role === 'teacher' || role === 'academy';
  }

  static canCreateCourses(role: string): boolean {
    return role === 'teacher' || role === 'academy' || role === 'admin';
  }

  /** حذف الكورس لمالك المنصة فقط — ليس لـ academy_teacher */
  static canDeleteCourses(role: string): boolean {
    return role === 'teacher' || role === 'academy' || role === 'admin';
  }

  /**
   * شرط SQL لملكية/إدارة كورس (alias مثل c).
   * userParam مثال: `$2` ويجب أن يكون user.id
   */
  static manageSql(alias: string, userParam: string): string {
    return `(
      ${alias}.teacher_id = ${userParam}
      OR EXISTS (
        SELECT 1 FROM course_managers __cm
        WHERE __cm.course_id = ${alias}.id AND __cm.user_id = ${userParam}
      )
      OR EXISTS (
        SELECT 1 FROM tenants __t
        WHERE __t.id = ${alias}.tenant_id
          AND __t.owner_user_id = ${userParam}
          AND __t.platform_type = 'academy'
      )
    )`;
  }

  /** شرط على جدول courses بدون alias — عمود id/teacher_id/tenant_id */
  static manageSqlCoursesTable(userParam: string): string {
    return `(
      teacher_id = ${userParam}
      OR EXISTS (
        SELECT 1 FROM course_managers __cm
        WHERE __cm.course_id = courses.id AND __cm.user_id = ${userParam}
      )
      OR EXISTS (
        SELECT 1 FROM tenants __t
        WHERE __t.id = courses.tenant_id
          AND __t.owner_user_id = ${userParam}
          AND __t.platform_type = 'academy'
      )
    )`;
  }

  /** للصفوف التي تجلب c.teacher_id فقط — نتحقق عبر course_id أو exam_id إن وُجد */
  static async assertOwnsJoinedCourse(
    user: RequestUser,
    opts: {
      courseId?: number | null;
      courseTeacherId?: number | null;
      examId?: number | null;
    },
  ): Promise<void> {
    if (user.role === 'admin') return;
    if (opts.courseId) {
      await this.assertCanManageCourse(user, Number(opts.courseId));
      return;
    }
    if (opts.examId) {
      const r = await pool.query<{ course_id: number }>(
        `SELECT course_id FROM course_level_exams WHERE id = $1
         UNION ALL
         SELECT course_id FROM course_exams WHERE id = $1
         LIMIT 1`,
        [opts.examId],
      );
      if (r.rowCount) {
        await this.assertCanManageCourse(user, Number(r.rows[0].course_id));
        return;
      }
    }
    if (opts.courseTeacherId != null && Number(opts.courseTeacherId) === user.id) return;
    throw new HttpError(403, 'ليس لديك صلاحية إدارة هذا الكورس', { code: 'COURSE_FORBIDDEN' });
  }
}

/** أدوار يُسمح لها بإدارة محتوى الكورس (مع فحص الملكية/الإسناد) */
export const COURSE_CONTENT_ROLES: Array<'teacher' | 'academy' | 'academy_teacher' | 'admin'> = [
  'teacher',
  'academy',
  'academy_teacher',
  'admin',
];

/** من يمكنه إنشاء كورس جديد */
export const COURSE_CREATE_ROLES: Array<'teacher' | 'academy' | 'admin'> = [
  'teacher',
  'academy',
  'admin',
];
