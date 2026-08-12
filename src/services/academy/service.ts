import bcrypt from 'bcrypt';
import pool from '../../db/pool';
import { HttpError } from '../../utils';
import { CourseAccessControl } from '../courseAccessControl';

type AcademyUser = {
  id: number;
  role: string;
  tenant_id?: number | null;
};

export type CreateAcademyTeacherInput = {
  name: string;
  email: string;
  password: string;
  phone?: string | null;
  subject?: string | null;
  description?: string | null;
  avatar?: string | null;
  grade_ids?: number[];
  whatsapp_number?: string | null;
  facebook_url?: string | null;
  instagram_url?: string | null;
  youtube_url?: string | null;
  tiktok_url?: string | null;
};

export class AcademyService {
  static async assertAcademyOwner(user: AcademyUser): Promise<{ tenantId: number }> {
    if (user.role !== 'academy') {
      throw new HttpError(403, 'هذه العملية لحساب الأكاديمية فقط', { code: 'ACADEMY_ONLY' });
    }
    const tenantId = user.tenant_id;
    if (!tenantId) {
      throw new HttpError(400, 'حساب الأكاديمية غير مرتبط بمنصة', { code: 'NO_TENANT' });
    }
    const t = await pool.query(
      `SELECT id, platform_type, owner_user_id, is_active
       FROM tenants WHERE id = $1`,
      [tenantId],
    );
    if (!t.rowCount) throw new HttpError(404, 'المنصة غير موجودة');
    const tenant = t.rows[0];
    if (tenant.platform_type !== 'academy') {
      throw new HttpError(400, 'هذه المنصة ليست أكاديمية', { code: 'NOT_ACADEMY_PLATFORM' });
    }
    if (tenant.owner_user_id !== user.id) {
      throw new HttpError(403, 'لست مالك هذه الأكاديمية', { code: 'NOT_ACADEMY_OWNER' });
    }
    if (!tenant.is_active) {
      throw new HttpError(403, 'منصة الأكاديمية غير مفعّلة');
    }
    return { tenantId };
  }

  static async getOverview(user: AcademyUser) {
    const { tenantId } = await this.assertAcademyOwner(user);

    const [teachers, courses, students, activeCourses, managers] = await Promise.all([
      pool.query(
        `SELECT COUNT(*)::int AS c FROM academy_teachers WHERE tenant_id = $1 AND status = 'active'`,
        [tenantId],
      ),
      pool.query(
        `SELECT COUNT(*)::int AS c FROM courses WHERE tenant_id = $1 OR teacher_id = $2`,
        [tenantId, user.id],
      ),
      pool.query(
        `SELECT COUNT(*)::int AS c FROM users WHERE tenant_id = $1 AND role = 'student'`,
        [tenantId],
      ),
      pool.query(
        `SELECT COUNT(*)::int AS c FROM courses
         WHERE (tenant_id = $1 OR teacher_id = $2)
           AND COALESCE(is_free, FALSE) IS NOT NULL`,
        [tenantId, user.id],
      ),
      pool.query(
        `SELECT COUNT(*)::int AS c FROM course_managers WHERE tenant_id = $1`,
        [tenantId],
      ),
    ]);

    return {
      tenant_id: tenantId,
      teachers_count: teachers.rows[0].c,
      courses_count: courses.rows[0].c,
      students_count: students.rows[0].c,
      active_courses_count: activeCourses.rows[0].c,
      course_assignments_count: managers.rows[0].c,
    };
  }

  static async listTeachers(user: AcademyUser) {
    const { tenantId } = await this.assertAcademyOwner(user);
    const result = await pool.query(
      `SELECT
         at.id AS academy_teacher_id,
         at.status,
         at.subject AS academy_subject,
         at.created_at,
         u.id AS user_id,
         u.name,
         u.email,
         u.phone,
         u.avatar,
         u.subject,
         u.description,
         u.account_status,
         u.whatsapp_number,
         COALESCE(
           (
             SELECT json_agg(json_build_object('id', c.id, 'title', c.title) ORDER BY c.id)
             FROM course_managers cm
             JOIN courses c ON c.id = cm.course_id
             WHERE cm.user_id = u.id AND cm.tenant_id = at.tenant_id
           ),
           '[]'::json
         ) AS assigned_courses
       FROM academy_teachers at
       JOIN users u ON u.id = at.user_id
       WHERE at.tenant_id = $1
       ORDER BY at.created_at DESC`,
      [tenantId],
    );
    return result.rows;
  }

  static async createTeacher(user: AcademyUser, input: CreateAcademyTeacherInput) {
    const { tenantId } = await this.assertAcademyOwner(user);
    const email = input.email.trim().toLowerCase();
    const existing = await pool.query(
      `SELECT id FROM users WHERE lower(trim(email)) = $1 AND tenant_id = $2`,
      [email, tenantId],
    );
    if (existing.rowCount) {
      throw new HttpError(409, 'البريد مستخدم بالفعل في هذه المنصة', { code: 'EMAIL_TAKEN' });
    }

    const hashed = await bcrypt.hash(input.password, 10);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const u = await client.query(
        `INSERT INTO users (
           email, password, name, phone, avatar, role, description, subject, tenant_id,
           facebook_url, instagram_url, youtube_url, tiktok_url, whatsapp_number, account_status
         ) VALUES ($1,$2,$3,$4,$5,'academy_teacher',$6,$7,$8,$9,$10,$11,$12,$13,'active')
         RETURNING id, name, email, phone, avatar, role, subject, account_status, created_at`,
        [
          email,
          hashed,
          input.name.trim(),
          input.phone ?? null,
          input.avatar ?? null,
          input.description ?? '',
          input.subject ?? '',
          tenantId,
          input.facebook_url ?? null,
          input.instagram_url ?? null,
          input.youtube_url ?? null,
          input.tiktok_url ?? null,
          input.whatsapp_number ?? null,
        ],
      );
      const teacherUser = u.rows[0];

      await client.query(
        `INSERT INTO academy_teachers (tenant_id, user_id, status, subject, created_by)
         VALUES ($1, $2, 'active', $3, $4)`,
        [tenantId, teacherUser.id, input.subject ?? null, user.id],
      );

      if (input.grade_ids?.length) {
        const gradeIds = [...new Set(input.grade_ids.map(Number).filter((n) => n > 0))];
        if (gradeIds.length) {
          await client.query(
            `INSERT INTO teacher_grades (teacher_id, grade_id)
             SELECT $1, unnest($2::int[])`,
            [teacherUser.id, gradeIds],
          );
        }
      }

      await client.query('COMMIT');
      return teacherUser;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  static async updateTeacher(
    user: AcademyUser,
    teacherUserId: number,
    patch: Partial<CreateAcademyTeacherInput> & { status?: 'active' | 'inactive' | 'suspended' },
  ) {
    const { tenantId } = await this.assertAcademyOwner(user);
    const link = await pool.query(
      `SELECT id FROM academy_teachers WHERE tenant_id = $1 AND user_id = $2`,
      [tenantId, teacherUserId],
    );
    if (!link.rowCount) throw new HttpError(404, 'المدرس غير تابع لهذه الأكاديمية');

    const fields: string[] = [];
    const vals: unknown[] = [];
    let i = 1;
    const add = (col: string, v: unknown) => {
      fields.push(`${col} = $${i++}`);
      vals.push(v);
    };

    if (patch.name !== undefined) add('name', patch.name);
    if (patch.email !== undefined) add('email', patch.email.trim().toLowerCase());
    if (patch.phone !== undefined) add('phone', patch.phone);
    if (patch.avatar !== undefined) add('avatar', patch.avatar);
    if (patch.description !== undefined) add('description', patch.description ?? '');
    if (patch.subject !== undefined) add('subject', patch.subject ?? '');
    if (patch.whatsapp_number !== undefined) add('whatsapp_number', patch.whatsapp_number);
    if (patch.facebook_url !== undefined) add('facebook_url', patch.facebook_url);
    if (patch.instagram_url !== undefined) add('instagram_url', patch.instagram_url);
    if (patch.youtube_url !== undefined) add('youtube_url', patch.youtube_url);
    if (patch.tiktok_url !== undefined) add('tiktok_url', patch.tiktok_url);
    if (patch.password) {
      const hashed = await bcrypt.hash(patch.password, 10);
      add('password', hashed);
    }

    if (fields.length) {
      vals.push(teacherUserId, tenantId);
      await pool.query(
        `UPDATE users SET ${fields.join(', ')}
         WHERE id = $${i++} AND tenant_id = $${i} AND role = 'academy_teacher'`,
        vals,
      );
    }

    if (patch.status || patch.subject !== undefined) {
      await pool.query(
        `UPDATE academy_teachers SET
           status = COALESCE($3, status),
           subject = COALESCE($4, subject),
           updated_at = NOW()
         WHERE tenant_id = $1 AND user_id = $2`,
        [tenantId, teacherUserId, patch.status ?? null, patch.subject ?? null],
      );
    }

    if (patch.status === 'inactive' || patch.status === 'suspended') {
      await pool.query(
        `UPDATE users SET account_status = $2 WHERE id = $1 AND tenant_id = $3`,
        [teacherUserId, patch.status === 'suspended' ? 'suspended' : 'inactive', tenantId],
      );
    }
    if (patch.status === 'active') {
      await pool.query(
        `UPDATE users SET account_status = 'active' WHERE id = $1 AND tenant_id = $2`,
        [teacherUserId, tenantId],
      );
    }

    if (patch.grade_ids) {
      const gradeIds = [...new Set(patch.grade_ids.map(Number).filter((n) => n > 0))];
      await pool.query(`DELETE FROM teacher_grades WHERE teacher_id = $1`, [teacherUserId]);
      if (gradeIds.length) {
        await pool.query(
          `INSERT INTO teacher_grades (teacher_id, grade_id) SELECT $1, unnest($2::int[])`,
          [teacherUserId, gradeIds],
        );
      }
    }

    return this.listTeachers(user).then((rows) =>
      rows.find((r: { user_id: number | string }) => Number(r.user_id) === teacherUserId),
    );
  }

  static async deleteTeacher(user: AcademyUser, teacherUserId: number) {
    const { tenantId } = await this.assertAcademyOwner(user);
    const link = await pool.query(
      `SELECT id FROM academy_teachers WHERE tenant_id = $1 AND user_id = $2`,
      [tenantId, teacherUserId],
    );
    if (!link.rowCount) throw new HttpError(404, 'المدرس غير تابع لهذه الأكاديمية');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`DELETE FROM course_managers WHERE user_id = $1 AND tenant_id = $2`, [
        teacherUserId,
        tenantId,
      ]);
      await client.query(`DELETE FROM academy_teachers WHERE tenant_id = $1 AND user_id = $2`, [
        tenantId,
        teacherUserId,
      ]);
      await client.query(
        `UPDATE users SET account_status = 'inactive', role = 'academy_teacher'
         WHERE id = $1 AND tenant_id = $2`,
        [teacherUserId, tenantId],
      );
      // Soft-delete style: keep user row but deactivate; hard delete optional
      await client.query('COMMIT');
      return { success: true, user_id: teacherUserId };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  static async listCourses(user: AcademyUser) {
    const { tenantId } = await this.assertAcademyOwner(user);
    const result = await pool.query(
      `SELECT
         c.*,
         COALESCE(
           (
             SELECT json_agg(json_build_object(
               'user_id', u.id,
               'name', u.name,
               'email', u.email,
               'is_primary', cm.is_primary
             ) ORDER BY cm.is_primary DESC, u.name)
             FROM course_managers cm
             JOIN users u ON u.id = cm.user_id
             WHERE cm.course_id = c.id
           ),
           '[]'::json
         ) AS managers
       FROM courses c
       WHERE c.tenant_id = $1 OR c.teacher_id = $2
       ORDER BY c.created_at DESC`,
      [tenantId, user.id],
    );
    return result.rows;
  }

  static async assignTeacherToCourse(
    user: AcademyUser,
    courseId: number,
    teacherUserId: number,
    isPrimary = true,
  ) {
    const { tenantId } = await this.assertAcademyOwner(user);
    const course = await CourseAccessControl.assertCourseExists(courseId);
    if (course.tenant_id !== tenantId && course.teacher_id !== user.id) {
      throw new HttpError(403, 'الكورس لا يتبع هذه الأكاديمية');
    }

    const teacher = await pool.query(
      `SELECT at.user_id FROM academy_teachers at
       WHERE at.tenant_id = $1 AND at.user_id = $2 AND at.status = 'active'`,
      [tenantId, teacherUserId],
    );
    if (!teacher.rowCount) {
      throw new HttpError(404, 'المدرس غير موجود أو غير نشط في الأكاديمية');
    }

    // Ensure course.tenant_id is set for academy ownership
    if (!course.tenant_id) {
      await pool.query(`UPDATE courses SET tenant_id = $1 WHERE id = $2`, [tenantId, courseId]);
    }

    if (isPrimary) {
      await pool.query(
        `UPDATE course_managers SET is_primary = FALSE
         WHERE course_id = $1 AND tenant_id = $2`,
        [courseId, tenantId],
      );
    }

    const result = await pool.query(
      `INSERT INTO course_managers (course_id, user_id, tenant_id, assigned_by, is_primary)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (course_id, user_id) DO UPDATE SET
         is_primary = EXCLUDED.is_primary,
         assigned_by = EXCLUDED.assigned_by,
         updated_at = NOW()
       RETURNING *`,
      [courseId, teacherUserId, tenantId, user.id, isPrimary],
    );

    return result.rows[0];
  }

  static async unassignTeacherFromCourse(
    user: AcademyUser,
    courseId: number,
    teacherUserId: number,
  ) {
    const { tenantId } = await this.assertAcademyOwner(user);
    const result = await pool.query(
      `DELETE FROM course_managers
       WHERE course_id = $1 AND user_id = $2 AND tenant_id = $3
       RETURNING id`,
      [courseId, teacherUserId, tenantId],
    );
    if (!result.rowCount) throw new HttpError(404, 'الإسناد غير موجود');
    return { success: true };
  }

  /** كورسات المسندة لـ academy_teacher */
  static async listMyAssignedCourses(user: AcademyUser) {
    if (user.role !== 'academy_teacher') {
      throw new HttpError(403, 'هذه الواجهة لمدرس الأكاديمية فقط');
    }
    const result = await pool.query(
      `SELECT c.*, cm.is_primary, cm.created_at AS assigned_at
       FROM course_managers cm
       JOIN courses c ON c.id = cm.course_id
       WHERE cm.user_id = $1
       ORDER BY c.created_at DESC`,
      [user.id],
    );
    return result.rows;
  }

  static async getMyDashboard(user: AcademyUser) {
    if (user.role !== 'academy_teacher') {
      throw new HttpError(403, 'هذه الواجهة لمدرس الأكاديمية فقط');
    }
    const courses = await this.listMyAssignedCourses(user);
    return {
      role: 'academy_teacher',
      courses_count: courses.length,
      courses,
    };
  }
}
