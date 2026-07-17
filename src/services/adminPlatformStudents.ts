import pool from '../db/pool';
import bcrypt from 'bcrypt';
import { HttpError } from '../utils';

export type AdminPlatformStudent = {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  parent_phone: string | null;
  avatar: string | null;
  student_code: string | null;
  account_status: string | null;
  created_at: Date;
  /** مشترك في كورس/باقة نشطة على المنصة */
  is_subscribed: boolean;
  subscription_label: 'مشترك' | 'غير مشترك';
  grades: Array<{ id: number; name: string; slug: string | null }>;
  enrollments_count: number;
  active_enrollments_count: number;
  package_activations_count: number;
  activation_codes: Array<{
    type: 'course_invite' | 'package' | 'general_course';
    code: string;
    used_at: Date | string | null;
    target_id: number | null;
    target_title: string | null;
  }>;
};

export class AdminPlatformStudentsService {
  static async assertTenantExists(tenantId: number): Promise<{
    id: number;
    subdomain: string;
    display_name: string;
    owner_user_id: number | null;
  }> {
    const result = await pool.query(
      `SELECT id, subdomain, display_name, owner_user_id
       FROM tenants
       WHERE id = $1`,
      [tenantId],
    );
    if (!result.rowCount) {
      throw new HttpError(404, 'المنصة غير موجودة');
    }
    return result.rows[0];
  }

  /**
   * طلاب منصة معينة مع حالة الاشتراك وأكواد التفعيل المستخدمة.
   */
  static async listStudentsByTenant(
    tenantId: number,
    opts: {
      limit?: number;
      offset?: number;
      search?: string;
      is_subscribed?: boolean | null;
      account_status?: string;
    } = {},
  ): Promise<{
    tenant: { id: number; subdomain: string; display_name: string; owner_user_id: number | null };
    students: AdminPlatformStudent[];
    total: number;
    limit: number;
    offset: number;
    summary: { total: number; subscribed: number; not_subscribed: number };
  }> {
    const tenant = await this.assertTenantExists(tenantId);

    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const offset = Math.max(opts.offset ?? 0, 0);

    const params: unknown[] = [tenantId];
    const where = [`u.role = 'student'`, `u.tenant_id = $1`];

    if (opts.account_status?.trim()) {
      params.push(opts.account_status.trim());
      where.push(`u.account_status = $${params.length}`);
    }

    if (opts.search?.trim()) {
      params.push(`%${opts.search.trim()}%`);
      where.push(
        `(u.name ILIKE $${params.length} OR u.email ILIKE $${params.length} OR u.phone ILIKE $${params.length} OR COALESCE(u.student_code, '') ILIKE $${params.length})`,
      );
    }

    // اشتراك = enrollment نشط غير محظور، أو تفعيل باقة نشط، أو اشتراك كورس عام
    const subscribedExpr = `(
      EXISTS (
        SELECT 1 FROM enrollments e
        WHERE e.user_id = u.id
          AND COALESCE(e.subscription_status, 'active') = 'active'
          AND COALESCE(e.is_blocked_by_teacher, FALSE) = FALSE
      )
      OR EXISTS (
        SELECT 1 FROM package_activations pa
        WHERE pa.student_id = u.id AND COALESCE(pa.is_active, TRUE) = TRUE
      )
      OR EXISTS (
        SELECT 1 FROM general_course_enrollments gce
        WHERE gce.student_id = u.id
      )
    )`;

    if (opts.is_subscribed === true) {
      where.push(subscribedExpr);
    } else if (opts.is_subscribed === false) {
      where.push(`NOT ${subscribedExpr}`);
    }

    const whereSql = where.join(' AND ');

    const countRes = await pool.query<{ count: string; subscribed: string }>(
      `SELECT
         COUNT(*)::text AS count,
         COUNT(*) FILTER (WHERE ${subscribedExpr})::text AS subscribed
       FROM users u
       WHERE ${whereSql}`,
      params,
    );
    const total = parseInt(countRes.rows[0]?.count ?? '0', 10);
    // For filtered lists, recompute platform-wide summary separately
    const summaryRes = await pool.query<{ total: string; subscribed: string }>(
      `SELECT
         COUNT(*)::text AS total,
         COUNT(*) FILTER (WHERE ${subscribedExpr})::text AS subscribed
       FROM users u
       WHERE u.role = 'student' AND u.tenant_id = $1`,
      [tenantId],
    );
    const summaryTotal = parseInt(summaryRes.rows[0]?.total ?? '0', 10);
    const summarySubscribed = parseInt(summaryRes.rows[0]?.subscribed ?? '0', 10);

    const listParams = [...params, limit, offset];
    const listRes = await pool.query(
      `SELECT
         u.id,
         u.name,
         u.email,
         u.phone,
         u.parent_phone,
         u.avatar,
         u.student_code,
         u.account_status,
         u.created_at,
         ${subscribedExpr} AS is_subscribed,
         (
           SELECT COUNT(*)::int FROM enrollments e WHERE e.user_id = u.id
         ) AS enrollments_count,
         (
           SELECT COUNT(*)::int FROM enrollments e
           WHERE e.user_id = u.id
             AND COALESCE(e.subscription_status, 'active') = 'active'
             AND COALESCE(e.is_blocked_by_teacher, FALSE) = FALSE
         ) AS active_enrollments_count,
         (
           SELECT COUNT(*)::int FROM package_activations pa
           WHERE pa.student_id = u.id AND COALESCE(pa.is_active, TRUE) = TRUE
         ) AS package_activations_count
       FROM users u
       WHERE ${whereSql}
       ORDER BY u.created_at DESC
       LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
      listParams,
    );

    const studentIds = listRes.rows.map((r) => Number(r.id));
    const gradesByStudent = await this.loadGrades(studentIds);
    const codesByStudent = await this.loadActivationCodes(studentIds);

    const students: AdminPlatformStudent[] = listRes.rows.map((row) => {
      const isSubscribed = row.is_subscribed === true;
      return {
        id: Number(row.id),
        name: row.name,
        email: row.email ?? null,
        phone: row.phone ?? null,
        parent_phone: row.parent_phone ?? null,
        avatar: row.avatar ?? null,
        student_code: row.student_code ?? null,
        account_status: row.account_status ?? null,
        created_at: row.created_at,
        is_subscribed: isSubscribed,
        subscription_label: isSubscribed ? 'مشترك' : 'غير مشترك',
        grades: gradesByStudent[Number(row.id)] ?? [],
        enrollments_count: Number(row.enrollments_count ?? 0),
        active_enrollments_count: Number(row.active_enrollments_count ?? 0),
        package_activations_count: Number(row.package_activations_count ?? 0),
        activation_codes: codesByStudent[Number(row.id)] ?? [],
      };
    });

    return {
      tenant,
      students,
      total,
      limit,
      offset,
      summary: {
        total: summaryTotal,
        subscribed: summarySubscribed,
        not_subscribed: Math.max(0, summaryTotal - summarySubscribed),
      },
    };
  }

  private static async loadGrades(
    studentIds: number[],
  ): Promise<Record<number, Array<{ id: number; name: string; slug: string | null }>>> {
    if (!studentIds.length) return {};
    const gradesRes = await pool.query(
      `SELECT ug.user_id, g.id, g.name, g.slug
       FROM user_grades ug
       JOIN grades g ON g.id = ug.grade_id
       WHERE ug.user_id = ANY($1::int[])
       ORDER BY g.id ASC`,
      [studentIds],
    );
    return gradesRes.rows.reduce(
      (acc, row) => {
        const sid = Number(row.user_id);
        if (!acc[sid]) acc[sid] = [];
        acc[sid].push({
          id: Number(row.id),
          name: String(row.name),
          slug: row.slug ?? null,
        });
        return acc;
      },
      {} as Record<number, Array<{ id: number; name: string; slug: string | null }>>,
    );
  }

  private static async loadActivationCodes(
    studentIds: number[],
  ): Promise<Record<number, AdminPlatformStudent['activation_codes']>> {
    if (!studentIds.length) return {};

    const byStudent: Record<number, AdminPlatformStudent['activation_codes']> = {};
    const push = (
      studentId: number,
      item: AdminPlatformStudent['activation_codes'][number],
    ) => {
      if (!byStudent[studentId]) byStudent[studentId] = [];
      byStudent[studentId].push(item);
    };

    // أكواد دعوة الكورسات
    const inviteRes = await pool.query(
      `SELECT
         icu.user_id AS student_id,
         tic.code,
         icu.used_at,
         c.id AS target_id,
         c.title AS target_title
       FROM invite_code_usages icu
       JOIN teacher_invite_codes tic ON tic.id = icu.code_id
       LEFT JOIN courses c ON c.id = tic.course_id
       WHERE icu.user_id = ANY($1::int[])
       ORDER BY icu.used_at DESC NULLS LAST`,
      [studentIds],
    );
    for (const row of inviteRes.rows) {
      push(Number(row.student_id), {
        type: 'course_invite',
        code: String(row.code),
        used_at: row.used_at ?? null,
        target_id: row.target_id != null ? Number(row.target_id) : null,
        target_title: row.target_title ?? null,
      });
    }

    // أكواد تفعيل الباقات
    const packageRes = await pool.query(
      `SELECT
         pa.student_id,
         pac.code,
         pa.activated_at AS used_at,
         p.id AS target_id,
         p.name AS target_title
       FROM package_activations pa
       LEFT JOIN package_activation_codes pac ON pac.id = pa.activation_code_id
       LEFT JOIN packages p ON p.id = pa.package_id
       WHERE pa.student_id = ANY($1::int[])
         AND pac.code IS NOT NULL
       ORDER BY pa.activated_at DESC NULLS LAST`,
      [studentIds],
    );
    for (const row of packageRes.rows) {
      push(Number(row.student_id), {
        type: 'package',
        code: String(row.code),
        used_at: row.used_at ?? null,
        target_id: row.target_id != null ? Number(row.target_id) : null,
        target_title: row.target_title ?? null,
      });
    }

    // أكواد الكورسات العامة
    try {
      const generalRes = await pool.query(
        `SELECT
           gac.used_by AS student_id,
           gac.code,
           gac.used_at,
           gc.id AS target_id,
           gc.title AS target_title
         FROM general_course_activation_codes gac
         LEFT JOIN general_courses gc ON gc.id = gac.general_course_id
         WHERE gac.used_by = ANY($1::int[])
         ORDER BY gac.used_at DESC NULLS LAST`,
        [studentIds],
      );
      for (const row of generalRes.rows) {
        if (row.student_id == null) continue;
        push(Number(row.student_id), {
          type: 'general_course',
          code: String(row.code),
          used_at: row.used_at ?? null,
          target_id: row.target_id != null ? Number(row.target_id) : null,
          target_title: row.target_title ?? null,
        });
      }
    } catch {
      // جدول الكورسات العامة قد لا يكون موجوداً في بعض البيئات
    }

    return byStudent;
  }

  /**
   * تغيير كلمة سر طالب داخل منصة محددة (tenant_id + student_id).
   */
  static async changeStudentPassword(
    tenantId: number,
    studentId: number,
    input: {
      new_password: string;
      /** إن true يُطلب من الطالب تغيير كلمة السر عند أول دخول */
      must_change_password?: boolean;
    },
  ): Promise<{
    student_id: number;
    name: string;
    email: string | null;
    phone: string | null;
    tenant_id: number;
    must_change_password: boolean;
    password_changed_at: string;
  }> {
    await this.assertTenantExists(tenantId);

    const password = input.new_password?.trim() ?? '';
    if (password.length < 6) {
      throw new HttpError(400, 'كلمة السر الجديدة مطلوبة ويجب أن تكون 6 أحرف على الأقل');
    }

    const studentRes = await pool.query(
      `SELECT id, name, email, phone, tenant_id, role
       FROM users
       WHERE id = $1 AND role = 'student' AND tenant_id = $2`,
      [studentId, tenantId],
    );
    if (!studentRes.rowCount) {
      throw new HttpError(404, 'الطالب غير موجود على هذه المنصة');
    }

    const student = studentRes.rows[0];
    const hashed = await bcrypt.hash(password, 10);
    const mustChange = input.must_change_password === true;

    try {
      await pool.query(
        `UPDATE users
         SET password = $1,
             must_change_password = $2,
             updated_at = NOW()
         WHERE id = $3 AND tenant_id = $4 AND role = 'student'`,
        [hashed, mustChange, studentId, tenantId],
      );
    } catch (err: any) {
      // بعض قواعد البيانات قد لا تحتوي must_change_password أو updated_at
      if (err?.code === '42703') {
        await pool.query(
          `UPDATE users SET password = $1 WHERE id = $2 AND tenant_id = $3 AND role = 'student'`,
          [hashed, studentId, tenantId],
        );
      } else {
        throw err;
      }
    }

    return {
      student_id: Number(student.id),
      name: student.name,
      email: student.email ?? null,
      phone: student.phone ?? null,
      tenant_id: tenantId,
      must_change_password: mustChange,
      password_changed_at: new Date().toISOString(),
    };
  }
}
