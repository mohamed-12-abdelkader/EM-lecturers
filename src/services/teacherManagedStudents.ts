import bcrypt from 'bcrypt';
import type { PoolClient } from 'pg';
import pool from '../db/pool';
import { HttpError } from '../utils';
import { enforceStudentLimit } from './teacherPlanPolicy';
import { snapshotPlatformStudentBeforeDelete } from '../modules/teacherTrash';

export type RegistrationMode = 'self_registration' | 'teacher_registration';

export type ManagedStudentAccountStatus = 'active' | 'inactive' | 'suspended';

export interface RegistrationSettings {
  registration_mode: RegistrationMode;
  /** عند إنشاء الطالب بواسطة المدرس: استخدام رقم الهاتف ككلمة مرور افتراضية */
  default_password_from_phone: boolean;
  /** يسمح للطالب باختيار/تغيير مجموعته الدراسية بنفسه */
  students_can_choose_study_group: boolean;
}

export interface CreateManagedStudentInput {
  name: string;
  grade_id: number;
  phone?: string | null;
  parent_phone?: string | null;
  group_id?: number | null;
  password?: string | null;
  use_phone_as_password?: boolean;
}

export interface UpdateManagedStudentInput {
  name?: string;
  grade_id?: number;
  phone?: string | null;
  parent_phone?: string | null;
  group_id?: number | null;
  account_status?: ManagedStudentAccountStatus;
}

export interface ListManagedStudentsFilters {
  search?: string;
  grade_id?: number;
  group_id?: number;
  account_status?: ManagedStudentAccountStatus;
  page?: number;
  limit?: number;
  sort?: 'name' | 'created_at' | 'student_code';
  order?: 'asc' | 'desc';
}

export interface ImportRowResult {
  row: number;
  name: string;
  success: boolean;
  student_id?: number;
  student_code?: string;
  error?: string;
}

const DEFAULT_SETTINGS: RegistrationSettings = {
  registration_mode: 'self_registration',
  default_password_from_phone: true,
  students_can_choose_study_group: true,
};

function normalizeStudentCode(code: string): string {
  return code.replace(/\D/g, '');
}

export function normalizeStudentCodeInput(code: string): string {
  return normalizeStudentCode(code);
}

async function loadTenantSettings(tenantId: number): Promise<Record<string, unknown>> {
  const r = await pool.query<{ data: Record<string, unknown> }>(
    `SELECT data FROM tenant_settings WHERE tenant_id = $1`,
    [tenantId],
  );
  return r.rows[0]?.data ?? {};
}

export class TeacherManagedStudentsService {
  static async ensureSchema() {
    await pool.query(`
      CREATE SEQUENCE IF NOT EXISTS student_code_seq START WITH 10001
    `);
    await pool.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS student_code VARCHAR(20),
        ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS managed_by_teacher_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS registered_ip TEXT,
        ADD COLUMN IF NOT EXISTS ip_registered_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS ip_reset_at TIMESTAMPTZ
    `);
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_student_code_unique
        ON users (student_code) WHERE student_code IS NOT NULL
    `);
    await pool.query(`
      UPDATE users
      SET student_code = regexp_replace(student_code, '[^0-9]', '', 'g')
      WHERE student_code IS NOT NULL AND student_code ~ '[^0-9]'
    `);
  }

  static async getRegistrationSettings(tenantId: number): Promise<RegistrationSettings> {
    await this.ensureSchema();
    const data = await loadTenantSettings(tenantId);
    const mode = data.registration_mode;
    return {
      registration_mode:
        mode === 'teacher_registration' ? 'teacher_registration' : 'self_registration',
      default_password_from_phone: data.default_password_from_phone !== false,
      // افتراضيًا مسموح — يُقفل فقط إذا المدرس ضبطها صراحةً على false
      students_can_choose_study_group: data.students_can_choose_study_group !== false,
    };
  }

  static async setRegistrationSettings(
    tenantId: number,
    patch: Partial<RegistrationSettings>,
  ): Promise<RegistrationSettings> {
    await this.ensureSchema();
    const current = await this.getRegistrationSettings(tenantId);
    const next: RegistrationSettings = {
      registration_mode: patch.registration_mode ?? current.registration_mode,
      default_password_from_phone:
        patch.default_password_from_phone ?? current.default_password_from_phone,
      students_can_choose_study_group:
        patch.students_can_choose_study_group ?? current.students_can_choose_study_group,
    };

    if (
      next.registration_mode !== 'self_registration' &&
      next.registration_mode !== 'teacher_registration'
    ) {
      throw new HttpError(400, 'registration_mode غير صالح');
    }

    const data = await loadTenantSettings(tenantId);
    const merged = {
      ...data,
      registration_mode: next.registration_mode,
      default_password_from_phone: next.default_password_from_phone,
      students_can_choose_study_group: next.students_can_choose_study_group,
    };

    await pool.query(
      `INSERT INTO tenant_settings (tenant_id, data) VALUES ($1, $2::JSONB)
       ON CONFLICT (tenant_id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
      [tenantId, JSON.stringify(merged)],
    );

    return next;
  }

  static async isSelfRegistrationAllowed(tenantId: number): Promise<boolean> {
    const settings = await this.getRegistrationSettings(tenantId);
    return settings.registration_mode === 'self_registration';
  }

  static async assertTeacherOwnsTenant(teacherId: number, tenantId: number) {
    const r = await pool.query(
      `SELECT 1 FROM tenants WHERE id = $1 AND owner_user_id = $2 AND is_active = TRUE`,
      [tenantId, teacherId],
    );
    if (!r.rowCount) {
      throw new HttpError(403, 'غير مصرح — هذه المنصة لا تخصك');
    }
  }

  private static async generateStudentCode(client: PoolClient): Promise<string> {
    for (let attempt = 0; attempt < 15; attempt++) {
      const seq = await client.query<{ code: string }>(
        `SELECT LPAD(nextval('student_code_seq')::text, 5, '0') AS code`,
      );
      const code = normalizeStudentCode(seq.rows[0].code);
      const exists = await client.query(`SELECT 1 FROM users WHERE student_code = $1`, [code]);
      if (!exists.rowCount) return code;
    }
    throw new HttpError(500, 'تعذر توليد رقم الطالب');
  }

  private static async assertGradeForTeacher(gradeId: number, teacherId: number) {
    const r = await pool.query(
      `SELECT 1 FROM teacher_grades WHERE teacher_id = $1 AND grade_id = $2`,
      [teacherId, gradeId],
    );
    if (!r.rowCount) {
      throw new HttpError(400, 'الصف الدراسي غير مرتبط بهذا المدرس');
    }
  }

  private static async assertGroupForTeacher(groupId: number, teacherId: number) {
    const r = await pool.query(
      `SELECT id, name FROM study_groups WHERE id = $1 AND teacher_id = $2`,
      [groupId, teacherId],
    );
    if (!r.rowCount) {
      throw new HttpError(400, 'المجموعة غير موجودة أو لا تخصك');
    }
    return r.rows[0] as { id: number; name: string };
  }

  private static async assignStudentToGroup(
    client: PoolClient,
    groupId: number,
    studentId: number,
  ) {
    const existing = await client.query(
      `SELECT group_id FROM group_students WHERE student_id = $1`,
      [studentId],
    );
    if (existing.rowCount) {
      if (Number(existing.rows[0].group_id) === groupId) return;
      await client.query(`DELETE FROM group_students WHERE student_id = $1`, [studentId]);
    }

    const numRes = await client.query<{ next_num: number }>(
      `SELECT COALESCE(MAX(number_in_group), 0) + 1 AS next_num
       FROM group_students WHERE group_id = $1`,
      [groupId],
    );
    const numberInGroup = Number(numRes.rows[0]?.next_num ?? 1);

    await client.query(
      `INSERT INTO group_students (group_id, student_id, number_in_group)
       VALUES ($1, $2, $3)
       ON CONFLICT (group_id, student_id) DO UPDATE SET number_in_group = EXCLUDED.number_in_group`,
      [groupId, studentId, numberInGroup],
    );
  }

  private static async removeStudentFromGroups(client: PoolClient, studentId: number) {
    await client.query(`DELETE FROM group_students WHERE student_id = $1`, [studentId]);
  }

  private static mapStudentRow(row: Record<string, unknown>) {
    const registeredIp = (row.registered_ip as string | null) || (row.device_ip as string | null) || null;
    return {
      id: row.id,
      student_code: row.student_code,
      name: row.name,
      phone: row.phone,
      parent_phone: row.parent_phone,
      email: row.email,
      avatar: row.avatar,
      account_status: row.account_status,
      must_change_password: row.must_change_password,
      created_at: row.created_at,
      registered_ip: registeredIp,
      device_ip: registeredIp,
      ip_registered_at: row.ip_registered_at ?? null,
      ip_reset_at: row.ip_reset_at ?? null,
      device_bound: Boolean(registeredIp),
      grade: row.grade_id
        ? {
            id: row.grade_id,
            name: row.grade_name,
            slug: row.grade_slug,
          }
        : null,
      group: row.group_id
        ? {
            id: row.group_id,
            name: row.group_name,
          }
        : null,
    };
  }

  static async createStudent(
    teacherId: number,
    tenantId: number,
    input: CreateManagedStudentInput,
  ) {
    await this.ensureSchema();
    await this.assertTeacherOwnsTenant(teacherId, tenantId);
    await this.assertGradeForTeacher(input.grade_id, teacherId);
    await enforceStudentLimit(teacherId, tenantId);

    if (input.group_id) {
      await this.assertGroupForTeacher(input.group_id, teacherId);
    }

    const settings = await this.getRegistrationSettings(tenantId);

    if (input.phone) {
      const phoneTaken = await pool.query(
        `SELECT id FROM users WHERE phone = $1 AND tenant_id = $2`,
        [input.phone.trim(), tenantId],
      );
      if (phoneTaken.rowCount) {
        throw new HttpError(400, 'رقم الهاتف مسجّل مسبقاً على هذه المنصة');
      }
    }

    let plainPassword = input.password?.trim() || null;
    let mustChangePassword = false;

    if (!plainPassword) {
      if (
        settings.registration_mode !== 'teacher_registration' &&
        input.use_phone_as_password !== false &&
        settings.default_password_from_phone &&
        input.phone
      ) {
        plainPassword = input.phone.trim();
        mustChangePassword = true;
      } else {
        plainPassword = Math.random().toString(36).slice(-12);
        mustChangePassword = false;
      }
    }

    const hashed = await bcrypt.hash(plainPassword, 10);
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      const studentCode = await this.generateStudentCode(client);

      const insertRes = await client.query(
        `INSERT INTO users (
           name, phone, parent_phone, password, role, tenant_id,
           student_code, must_change_password, managed_by_teacher_id, account_status
         ) VALUES ($1, $2, $3, $4, 'student', $5, $6, $7, $8, 'active')
         RETURNING id, name, phone, parent_phone, student_code, must_change_password, account_status, created_at`,
        [
          input.name.trim(),
          input.phone?.trim() || null,
          input.parent_phone?.trim() || null,
          hashed,
          tenantId,
          studentCode,
          mustChangePassword,
          teacherId,
        ],
      );
      const student = insertRes.rows[0];

      await client.query(
        `INSERT INTO user_grades (user_id, grade_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [student.id, input.grade_id],
      );

      if (input.group_id) {
        await this.assignStudentToGroup(client, input.group_id, student.id);
      }

      await client.query('COMMIT');

      const full = await this.getStudentById(teacherId, tenantId, student.id);
      return {
        student: full,
        credentials: {
          student_code: studentCode,
          login_with_code_only: settings.registration_mode === 'teacher_registration',
          temporary_password:
            settings.registration_mode === 'teacher_registration'
              ? undefined
              : mustChangePassword
                ? plainPassword
                : undefined,
          must_change_password: mustChangePassword,
        },
      };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  static async listStudents(
    teacherId: number,
    tenantId: number,
    filters: ListManagedStudentsFilters = {},
  ) {
    await this.ensureSchema();
    await this.assertTeacherOwnsTenant(teacherId, tenantId);

    const page = Math.max(filters.page ?? 1, 1);
    const limit = Math.min(Math.max(filters.limit ?? 20, 1), 100);
    const offset = (page - 1) * limit;
    const sort = filters.sort ?? 'created_at';
    const order = filters.order === 'asc' ? 'ASC' : 'DESC';

    const sortColumn =
      sort === 'name' ? 'u.name' : sort === 'student_code' ? 'u.student_code' : 'u.created_at';

    // كل طلاب المنصة (تسجيل ذاتي + إنشاء المدرس)
    const conditions = [`u.role = 'student'`, `u.tenant_id = $1`];
    const values: unknown[] = [tenantId];
    let i = 2;

    if (filters.search?.trim()) {
      conditions.push(
        `(u.name ILIKE $${i} OR u.student_code ILIKE $${i} OR u.phone ILIKE $${i} OR u.parent_phone ILIKE $${i})`,
      );
      values.push(`%${filters.search.trim()}%`);
      i++;
    }
    if (filters.grade_id) {
      conditions.push(`EXISTS (
        SELECT 1 FROM user_grades ugf WHERE ugf.user_id = u.id AND ugf.grade_id = $${i++}
      )`);
      values.push(filters.grade_id);
    }
    if (filters.group_id) {
      conditions.push(`EXISTS (
        SELECT 1 FROM group_students gsf WHERE gsf.student_id = u.id AND gsf.group_id = $${i++}
      )`);
      values.push(filters.group_id);
    }
    if (filters.account_status) {
      conditions.push(`u.account_status = $${i++}`);
      values.push(filters.account_status);
    }

    const where = conditions.join(' AND ');

    const countRes = await pool.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total
       FROM users u
       WHERE ${where}`,
      values,
    );

    const listRes = await pool.query(
      `SELECT
         u.id, u.student_code, u.name, u.phone, u.parent_phone, u.email, u.avatar,
         u.account_status, u.must_change_password, u.created_at,
         u.device_ip, u.registered_ip, u.ip_registered_at, u.ip_reset_at,
         g.id AS grade_id, g.name AS grade_name, g.slug AS grade_slug,
         sg.id AS group_id, sg.name AS group_name
       FROM users u
       LEFT JOIN LATERAL (
         SELECT grade_id FROM user_grades WHERE user_id = u.id ORDER BY grade_id LIMIT 1
       ) ug ON TRUE
       LEFT JOIN grades g ON g.id = ug.grade_id
       LEFT JOIN LATERAL (
         SELECT gs.group_id FROM group_students gs WHERE gs.student_id = u.id LIMIT 1
       ) gs_ref ON TRUE
       LEFT JOIN study_groups sg ON sg.id = gs_ref.group_id
       WHERE ${where}
       ORDER BY ${sortColumn} ${order}, u.id ASC
       LIMIT $${i++} OFFSET $${i++}`,
      [...values, limit, offset],
    );

    const students = listRes.rows.map((row) => this.mapStudentRow(row));

    return {
      students,
      pagination: {
        page,
        limit,
        total: Number(countRes.rows[0]?.total ?? 0),
        total_pages: Math.ceil(Number(countRes.rows[0]?.total ?? 0) / limit),
      },
    };
  }

  static async getStudentById(teacherId: number, tenantId: number, studentId: number) {
    await this.ensureSchema();
    await this.assertTeacherOwnsTenant(teacherId, tenantId);

    const r = await pool.query(
      `SELECT
         u.id, u.student_code, u.name, u.phone, u.parent_phone, u.email, u.avatar,
         u.account_status, u.must_change_password, u.created_at,
         u.device_ip, u.registered_ip, u.ip_registered_at, u.ip_reset_at,
         g.id AS grade_id, g.name AS grade_name, g.slug AS grade_slug,
         sg.id AS group_id, sg.name AS group_name
       FROM users u
       LEFT JOIN LATERAL (
         SELECT grade_id FROM user_grades WHERE user_id = u.id ORDER BY grade_id LIMIT 1
       ) ug ON TRUE
       LEFT JOIN grades g ON g.id = ug.grade_id
       LEFT JOIN LATERAL (
         SELECT gs.group_id FROM group_students gs WHERE gs.student_id = u.id LIMIT 1
       ) gs_ref ON TRUE
       LEFT JOIN study_groups sg ON sg.id = gs_ref.group_id
       WHERE u.id = $1 AND u.role = 'student' AND u.tenant_id = $2
       LIMIT 1`,
      [studentId, tenantId],
    );
    if (!r.rowCount) throw new HttpError(404, 'الطالب غير موجود');
    return this.mapStudentRow(r.rows[0]);
  }

  /** حذف اختياري داخل معاملة — لا يُلغي الـ transaction إن فشل الجدول/العمود */
  private static async tryPurgeQuery(
    client: PoolClient,
    sql: string,
    params: unknown[],
  ) {
    await client.query('SAVEPOINT student_purge_sp');
    try {
      await client.query(sql, params);
      await client.query('RELEASE SAVEPOINT student_purge_sp');
    } catch {
      await client.query('ROLLBACK TO SAVEPOINT student_purge_sp');
    }
  }

  /**
   * يحذف السجلات المرتبطة بالطالب قبل حذف صف users
   * (خاصة الجداول بدون ON DELETE CASCADE).
   */
  private static async purgeStudentRelatedRows(
    client: PoolClient,
    studentIds: number[],
  ) {
    if (!studentIds.length) return;

    const ids = studentIds;

    // امتحانات المحاضرات (بدون CASCADE على student_id)
    await this.tryPurgeQuery(
      client,
      `DELETE FROM exam_answers
       WHERE submission_id IN (SELECT id FROM exam_submissions WHERE student_id = ANY($1::int[]))`,
      [ids],
    );
    await this.tryPurgeQuery(
      client,
      `DELETE FROM exam_submissions WHERE student_id = ANY($1::int[])`,
      [ids],
    );

    await this.tryPurgeQuery(
      client,
      `DELETE FROM course_exam_answers
       WHERE submission_id IN (
         SELECT id FROM course_exam_submissions WHERE student_id = ANY($1::int[])
       )`,
      [ids],
    );
    await this.tryPurgeQuery(
      client,
      `DELETE FROM course_exam_submissions WHERE student_id = ANY($1::int[])`,
      [ids],
    );

    await this.tryPurgeQuery(
      client,
      `DELETE FROM general_course_exam_answers
       WHERE submission_id IN (
         SELECT id FROM general_course_exam_submissions WHERE student_id = ANY($1::int[])
       )`,
      [ids],
    );
    await this.tryPurgeQuery(
      client,
      `DELETE FROM general_course_exam_submissions WHERE student_id = ANY($1::int[])`,
      [ids],
    );

    await this.tryPurgeQuery(
      client,
      `DELETE FROM competition_results WHERE student_id = ANY($1::int[])`,
      [ids],
    );
    await this.tryPurgeQuery(
      client,
      `DELETE FROM competition_students WHERE student_id = ANY($1::int[])`,
      [ids],
    );
    await this.tryPurgeQuery(
      client,
      `DELETE FROM password_resets WHERE user_id = ANY($1::int[])`,
      [ids],
    );

    await client.query(`DELETE FROM group_students WHERE student_id = ANY($1::int[])`, [ids]);
    await client.query(`DELETE FROM user_grades WHERE user_id = ANY($1::int[])`, [ids]);
    await client.query(`DELETE FROM enrollments WHERE user_id = ANY($1::int[])`, [ids]);
  }

  static async updateStudent(
    teacherId: number,
    tenantId: number,
    studentId: number,
    input: UpdateManagedStudentInput,
  ) {
    await this.getStudentById(teacherId, tenantId, studentId);

    if (input.grade_id != null) {
      await this.assertGradeForTeacher(input.grade_id, teacherId);
    }
    if (input.group_id != null && input.group_id > 0) {
      await this.assertGroupForTeacher(input.group_id, teacherId);
    }

    if (input.phone) {
      const phoneTaken = await pool.query(
        `SELECT id FROM users WHERE phone = $1 AND tenant_id = $2 AND id <> $3`,
        [input.phone.trim(), tenantId, studentId],
      );
      if (phoneTaken.rowCount) {
        throw new HttpError(400, 'رقم الهاتف مسجّل مسبقاً على هذه المنصة');
      }
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const fields: string[] = [];
      const vals: unknown[] = [];
      let p = 1;

      if (input.name !== undefined) {
        fields.push(`name = $${p++}`);
        vals.push(input.name.trim());
      }
      if (input.phone !== undefined) {
        fields.push(`phone = $${p++}`);
        vals.push(input.phone?.trim() || null);
      }
      if (input.parent_phone !== undefined) {
        fields.push(`parent_phone = $${p++}`);
        vals.push(input.parent_phone?.trim() || null);
      }
      if (input.account_status !== undefined) {
        fields.push(`account_status = $${p++}`);
        vals.push(input.account_status);
      }

      if (fields.length) {
        vals.push(studentId);
        await client.query(`UPDATE users SET ${fields.join(', ')} WHERE id = $${p}`, vals);
      }

      if (input.grade_id != null) {
        await client.query(`DELETE FROM user_grades WHERE user_id = $1`, [studentId]);
        await client.query(`INSERT INTO user_grades (user_id, grade_id) VALUES ($1, $2)`, [
          studentId,
          input.grade_id,
        ]);
      }

      if (input.group_id !== undefined) {
        await this.removeStudentFromGroups(client, studentId);
        if (input.group_id) {
          await this.assignStudentToGroup(client, input.group_id, studentId);
        }
      }

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    return this.getStudentById(teacherId, tenantId, studentId);
  }

  static async resetPassword(
    teacherId: number,
    tenantId: number,
    studentId: number,
    options: { new_password?: string; use_phone_as_password?: boolean } = {},
  ) {
    const student = await this.getStudentById(teacherId, tenantId, studentId);
    let plain = options.new_password?.trim() || null;
    const teacherSetPassword = !!plain;
    let mustChange = false;

    if (!plain) {
      if (options.use_phone_as_password !== false && student.phone) {
        plain = String(student.phone);
        mustChange = true;
      } else {
        plain = Math.random().toString(36).slice(-8);
        mustChange = true;
      }
    }

    const hashed = await bcrypt.hash(plain, 10);
    await pool.query(
      `UPDATE users SET password = $1, must_change_password = $2 WHERE id = $3`,
      [hashed, mustChange, studentId],
    );

    return {
      student_id: studentId,
      student_code: student.student_code,
      /** كلمة السر اللي عيّنها المدرس (أو المؤقتة عند التوليد التلقائي) */
      password: plain,
      temporary_password: mustChange ? plain : undefined,
      must_change_password: mustChange,
      set_by_teacher: teacherSetPassword,
    };
  }

  static async setAccountStatus(
    teacherId: number,
    tenantId: number,
    studentId: number,
    accountStatus: ManagedStudentAccountStatus,
  ) {
    await this.getStudentById(teacherId, tenantId, studentId);
    await pool.query(`UPDATE users SET account_status = $1 WHERE id = $2`, [
      accountStatus,
      studentId,
    ]);
    return this.getStudentById(teacherId, tenantId, studentId);
  }

  static async deleteStudent(teacherId: number, tenantId: number, studentId: number) {
    const student = await this.getStudentById(teacherId, tenantId, studentId);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await this.purgeStudentRelatedRows(client, [studentId]);
      const del = await client.query(
        `DELETE FROM users
         WHERE id = $1 AND role = 'student' AND tenant_id = $2
         RETURNING id`,
        [studentId, tenantId],
      );
      if (!del.rowCount) {
        throw new HttpError(409, 'تعذر حذف الطالب — قد يكون مرتبطاً ببيانات أخرى');
      }
      await client.query('COMMIT');

      await snapshotPlatformStudentBeforeDelete(
        student as Record<string, unknown> & { id: number; name?: string; email?: string },
        teacherId,
        tenantId,
        teacherId,
      );

      return { deleted: true, student_id: studentId };
    } catch (e: unknown) {
      await client.query('ROLLBACK');
      if ((e as { code?: string }).code === '23503') {
        throw new HttpError(
          409,
          'لا يمكن حذف الطالب لوجود سجلات مرتبطة. يمكنك إيقاف الحساب بدلاً من ذلك.',
        );
      }
      throw e;
    } finally {
      client.release();
    }
  }

  /**
   * حذف كل حسابات الطلاب على منصة المدرس.
   * يتطلب confirm = "DELETE_ALL_STUDENTS".
   */
  static async deleteAllStudents(
    teacherId: number,
    tenantId: number,
    confirm: string,
  ) {
    await this.ensureSchema();
    await this.assertTeacherOwnsTenant(teacherId, tenantId);

    if (confirm !== 'DELETE_ALL_STUDENTS') {
      throw new HttpError(
        400,
        'للتأكيد أرسل confirm: "DELETE_ALL_STUDENTS"',
      );
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const idsRes = await client.query<{ id: number }>(
        `SELECT id FROM users
         WHERE role = 'student' AND tenant_id = $1
         ORDER BY id
         FOR UPDATE`,
        [tenantId],
      );
      const ids = idsRes.rows.map((r) => Number(r.id));

      if (!ids.length) {
        await client.query('COMMIT');
        return { deleted: true, deleted_count: 0 };
      }

      await this.purgeStudentRelatedRows(client, ids);

      const del = await client.query(
        `DELETE FROM users
         WHERE role = 'student' AND tenant_id = $1`,
        [tenantId],
      );

      await client.query('COMMIT');
      return {
        deleted: true,
        deleted_count: del.rowCount ?? 0,
      };
    } catch (e: unknown) {
      await client.query('ROLLBACK');
      if ((e as { code?: string }).code === '23503') {
        throw new HttpError(
          409,
          'تعذر حذف بعض الحسابات لوجود سجلات مرتبطة. جرّب حذف الطلاب فردياً أو أوقف الحسابات.',
        );
      }
      throw e;
    } finally {
      client.release();
    }
  }

  static async findStudentByCode(studentCode: string, tenantId: number) {
    await this.ensureSchema();
    const normalized = normalizeStudentCode(studentCode);
    if (!normalized) return null;
    const r = await pool.query(
      `SELECT * FROM users
       WHERE tenant_id = $2 AND role = 'student'
         AND regexp_replace(COALESCE(student_code, ''), '[^0-9]', '', 'g') = $1
       LIMIT 1`,
      [normalized, tenantId],
    );
    return r.rows[0] ?? null;
  }

  static async resolveGradeId(
    teacherId: number,
    gradeRef: string,
  ): Promise<number | null> {
    const trimmed = gradeRef.trim();
    if (!trimmed) return null;
    if (/^\d+$/.test(trimmed)) {
      const id = Number(trimmed);
      await this.assertGradeForTeacher(id, teacherId);
      return id;
    }
    const r = await pool.query(
      `SELECT g.id
       FROM teacher_grades tg
       JOIN grades g ON g.id = tg.grade_id
       WHERE tg.teacher_id = $1 AND (g.name ILIKE $2 OR g.slug ILIKE $2)
       LIMIT 1`,
      [teacherId, trimmed],
    );
    if (!r.rowCount) throw new HttpError(400, `الصف غير موجود: ${trimmed}`);
    return Number(r.rows[0].id);
  }

  static async resolveGroupId(
    teacherId: number,
    groupRef: string,
  ): Promise<number | null> {
    const trimmed = groupRef.trim();
    if (!trimmed) return null;
    if (/^\d+$/.test(trimmed)) {
      await this.assertGroupForTeacher(Number(trimmed), teacherId);
      return Number(trimmed);
    }
    const r = await pool.query(
      `SELECT id FROM study_groups WHERE teacher_id = $1 AND name ILIKE $2 LIMIT 1`,
      [teacherId, trimmed],
    );
    if (!r.rowCount) throw new HttpError(400, `المجموعة غير موجودة: ${trimmed}`);
    return Number(r.rows[0].id);
  }

  static parseCsv(text: string): Array<Record<string, string>> {
    const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) return [];

    const splitLine = (line: string): string[] => {
      const out: string[] = [];
      let cur = '';
      let inQuotes = false;
      for (let c = 0; c < line.length; c++) {
        const ch = line[c];
        if (ch === '"') {
          inQuotes = !inQuotes;
          continue;
        }
        if (ch === ',' && !inQuotes) {
          out.push(cur.trim());
          cur = '';
          continue;
        }
        cur += ch;
      }
      out.push(cur.trim());
      return out;
    };

    const headers = splitLine(lines[0]).map((h) => h.toLowerCase().replace(/\s+/g, '_'));
    const rows: Array<Record<string, string>> = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = splitLine(lines[i]);
      if (!cols.some((c) => c)) continue;
      const row: Record<string, string> = {};
      headers.forEach((h, idx) => {
        row[h] = cols[idx]?.trim() ?? '';
      });
      rows.push(row);
    }
    return rows;
  }

  static async importStudents(
    teacherId: number,
    tenantId: number,
    csvText: string,
  ) {
    await this.ensureSchema();
    await this.assertTeacherOwnsTenant(teacherId, tenantId);

    const rows = this.parseCsv(csvText);
    const results: ImportRowResult[] = [];
    let created = 0;
    let failed = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const name =
        row.name ||
        row['الاسم'] ||
        row['الاسم_الثلاثي'] ||
        row.student_name ||
        '';
      const gradeRef =
        row.grade ||
        row.grade_id ||
        row['الصف'] ||
        row['الصف_الدراسي'] ||
        '';
      const phone = row.phone || row['رقم_الهاتف'] || row['هاتف_الطالب'] || '';
      const parentPhone =
        row.parent_phone || row['ولي_الامر'] || row['رقم_ولي_الامر'] || '';
      const groupRef = row.group || row.group_id || row['المجموعة'] || '';

      if (!name.trim()) {
        failed++;
        results.push({ row: i + 2, name: '', success: false, error: 'الاسم مطلوب' });
        continue;
      }
      if (!gradeRef.trim()) {
        failed++;
        results.push({
          row: i + 2,
          name: name.trim(),
          success: false,
          error: 'الصف الدراسي مطلوب',
        });
        continue;
      }

      try {
        const gradeId = await this.resolveGradeId(teacherId, gradeRef);
        if (!gradeId) throw new HttpError(400, 'الصف الدراسي غير صالح');

        let groupId: number | null = null;
        if (groupRef.trim()) {
          groupId = await this.resolveGroupId(teacherId, groupRef);
        }

        const createdStudent = await this.createStudent(teacherId, tenantId, {
          name: name.trim(),
          grade_id: gradeId,
          phone: phone.trim() || null,
          parent_phone: parentPhone.trim() || null,
          group_id: groupId,
        });

        created++;
        results.push({
          row: i + 2,
          name: name.trim(),
          success: true,
          student_id: Number(createdStudent.student.id),
          student_code: createdStudent.credentials.student_code,
        });
      } catch (e: unknown) {
        failed++;
        results.push({
          row: i + 2,
          name: name.trim(),
          success: false,
          error: e instanceof HttpError ? e.message : 'فشل إنشاء الطالب',
        });
      }
    }

    return {
      total_rows: rows.length,
      created_count: created,
      failed_count: failed,
      results,
    };
  }

  /** يحدد مدرس المنصة المرتبط بالطالب (إدارة / ملكية التينانت / المجموعة الحالية) */
  static async resolveTeacherIdForStudent(
    studentId: number,
    tenantId?: number | null,
  ): Promise<number | null> {
    await this.ensureSchema();
    const userRes = await pool.query<{
      managed_by_teacher_id: number | null;
      tenant_id: number | null;
    }>(
      `SELECT managed_by_teacher_id, tenant_id FROM users WHERE id = $1 AND role = 'student'`,
      [studentId],
    );
    if (!userRes.rowCount) return null;

    if (userRes.rows[0].managed_by_teacher_id) {
      return Number(userRes.rows[0].managed_by_teacher_id);
    }

    const effectiveTenantId = tenantId ?? userRes.rows[0].tenant_id;
    if (effectiveTenantId) {
      const owner = await pool.query<{ owner_user_id: number | null }>(
        `SELECT owner_user_id FROM tenants WHERE id = $1 AND is_active = TRUE`,
        [effectiveTenantId],
      );
      if (owner.rows[0]?.owner_user_id) return Number(owner.rows[0].owner_user_id);
    }

    const fromGroup = await pool.query<{ teacher_id: number }>(
      `SELECT sg.teacher_id
       FROM group_students gs
       JOIN study_groups sg ON sg.id = gs.group_id
       WHERE gs.student_id = $1
       LIMIT 1`,
      [studentId],
    );
    return fromGroup.rows[0]?.teacher_id ? Number(fromGroup.rows[0].teacher_id) : null;
  }

  static async getStudentStudyGroup(studentId: number) {
    const r = await pool.query<{
      id: number;
      name: string;
      teacher_id: number;
      start_time: string | null;
      end_time: string | null;
      days: string | null;
      grade_id: number | null;
      grade_name: string | null;
      number_in_group: number | null;
      joined_at: Date | null;
    }>(
      `SELECT sg.id, sg.name, sg.teacher_id, sg.start_time, sg.end_time, sg.days,
              sg.grade_id, g.name AS grade_name,
              gs.number_in_group, gs.joined_at
       FROM group_students gs
       JOIN study_groups sg ON sg.id = gs.group_id
       LEFT JOIN grades g ON g.id = sg.grade_id
       WHERE gs.student_id = $1
       ORDER BY gs.joined_at DESC NULLS LAST
       LIMIT 1`,
      [studentId],
    );
    if (!r.rowCount) return null;
    const row = r.rows[0];
    return {
      id: row.id,
      name: row.name,
      teacher_id: row.teacher_id,
      start_time: row.start_time,
      end_time: row.end_time,
      days: row.days,
      grade_id: row.grade_id,
      grade_name: row.grade_name,
      number_in_group: row.number_in_group,
      joined_at: row.joined_at,
    };
  }

  static async listAvailableStudyGroupsForStudent(teacherId: number, studentId: number) {
    const grades = await pool.query<{ grade_id: number }>(
      `SELECT grade_id FROM user_grades WHERE user_id = $1`,
      [studentId],
    );
    const gradeIds = grades.rows.map((g) => Number(g.grade_id));

    const r = await pool.query<{
      id: number;
      name: string;
      start_time: string | null;
      end_time: string | null;
      days: string | null;
      grade_id: number | null;
      grade_name: string | null;
      students_count: number;
    }>(
      `SELECT sg.id, sg.name, sg.start_time, sg.end_time, sg.days, sg.grade_id,
              g.name AS grade_name,
              (SELECT COUNT(*)::int FROM group_students gs WHERE gs.group_id = sg.id) AS students_count
       FROM study_groups sg
       LEFT JOIN grades g ON g.id = sg.grade_id
       WHERE sg.teacher_id = $1
         AND (
           sg.grade_id IS NULL
           OR cardinality($2::int[]) = 0
           OR sg.grade_id = ANY($2::int[])
         )
       ORDER BY sg.name`,
      [teacherId, gradeIds],
    );

    return r.rows.map((row) => ({
      id: row.id,
      name: row.name,
      start_time: row.start_time,
      end_time: row.end_time,
      days: row.days,
      grade_id: row.grade_id,
      grade_name: row.grade_name,
      students_count: row.students_count,
    }));
  }

  static async studentChooseStudyGroup(
    studentId: number,
    groupId: number,
    tenantId?: number | null,
  ) {
    await this.ensureSchema();

    const teacherId = await this.resolveTeacherIdForStudent(studentId, tenantId);
    if (!teacherId) {
      throw new HttpError(400, 'تعذر تحديد المدرس المرتبط بالطالب');
    }

    let effectiveTenantId =
      tenantId ??
      (
        await pool.query<{ tenant_id: number | null }>(
          `SELECT tenant_id FROM users WHERE id = $1`,
          [studentId],
        )
      ).rows[0]?.tenant_id;

    if (!effectiveTenantId) {
      const teacherTenant = await pool.query<{ id: number }>(
        `SELECT id FROM tenants WHERE owner_user_id = $1 AND is_active = TRUE ORDER BY id LIMIT 1`,
        [teacherId],
      );
      effectiveTenantId = teacherTenant.rows[0]?.id ?? null;
    }

    if (effectiveTenantId) {
      const settings = await this.getRegistrationSettings(effectiveTenantId);
      if (!settings.students_can_choose_study_group) {
        throw new HttpError(403, 'غير مسموح للطالب باختيار المجموعة الدراسية على هذه المنصة');
      }
    }

    await this.assertGroupForTeacher(groupId, teacherId);

    const groupGrade = await pool.query<{ grade_id: number | null }>(
      `SELECT grade_id FROM study_groups WHERE id = $1`,
      [groupId],
    );
    const groupGradeId = groupGrade.rows[0]?.grade_id;
    if (groupGradeId) {
      const match = await pool.query(
        `SELECT 1 FROM user_grades WHERE user_id = $1 AND grade_id = $2 LIMIT 1`,
        [studentId, groupGradeId],
      );
      if (!match.rowCount) {
        throw new HttpError(400, 'المجموعة لا تناسب صفك الدراسي');
      }
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await this.assignStudentToGroup(client, groupId, studentId);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    return this.getStudentStudyGroup(studentId);
  }
}
