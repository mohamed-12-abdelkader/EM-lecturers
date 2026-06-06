import bcrypt from 'bcrypt';
import type { PoolClient } from 'pg';
import pool from '../db/pool';
import { HttpError } from '../utils';

export type TeacherAccountStatus = 'active' | 'inactive' | 'suspended';
export type TeacherSubscriptionPackage = 'bronze' | 'silver' | 'gold' | 'diamond';

export type UpdateTeacherPayload = {
  name?: string;
  email?: string | null;
  phone?: string | null;
  password?: string;
  subject?: string | null;
  description?: string | null;
  avatar?: string | null;
  account_status?: TeacherAccountStatus;
  subscription_package?: TeacherSubscriptionPackage;
  grade_ids?: number[];
};

type TeacherRow = {
  id: number;
  tenant_id: number;
  name: string;
  email: string | null;
  phone: string | null;
  avatar: string | null;
  subject: string | null;
  description: string | null;
  account_status: TeacherAccountStatus;
  subscription_package: TeacherSubscriptionPackage;
};

async function getTeacherForScope(client: PoolClient, teacherId: number, tenantId?: number) {
  const hasTenantScope = tenantId !== undefined;
  const r = await client.query<TeacherRow>(
    `SELECT id, tenant_id, name, email, phone, avatar, subject, description, account_status, subscription_package
     FROM users
     WHERE id = $1
       AND role = 'teacher'
       AND ($2::int IS NULL OR tenant_id = $2)
     LIMIT 1`,
    [teacherId, hasTenantScope ? tenantId : null],
  );
  return r.rows[0] ?? null;
}

async function ensureGradeIdsExist(client: PoolClient, gradeIds: number[]) {
  if (!gradeIds.length) return;
  const g = await client.query(`SELECT id FROM grades WHERE id = ANY($1::int[])`, [gradeIds]);
  const found = new Set(g.rows.map((r) => Number(r.id)));
  const missing = gradeIds.filter((id) => !found.has(id));
  if (missing.length) throw new HttpError(400, `Invalid grade ids: ${missing.join(', ')}`);
}

export class AdminTeachersService {
  static async getTeacherWithGrades(teacherId: number, tenantId?: number) {
    const hasTenantScope = tenantId !== undefined;
    const r = await pool.query(
      `SELECT u.id, u.name, u.email, u.phone, u.avatar, u.subject, u.description, u.account_status, u.created_at
              ,u.subscription_package
       FROM users u
       WHERE u.id = $1
         AND u.role = 'teacher'
         AND ($2::int IS NULL OR u.tenant_id = $2)
       LIMIT 1`,
      [teacherId, hasTenantScope ? tenantId : null],
    );
    const teacher = r.rows[0];
    if (!teacher) return null;
    const gr = await pool.query(
      `SELECT g.id, g.name, g.slug, g.stage, g.status
       FROM teacher_grades tg
       JOIN grades g ON g.id = tg.grade_id
       WHERE tg.teacher_id = $1
       ORDER BY g.id`,
      [teacherId],
    );
    return { ...teacher, grades: gr.rows };
  }

  static async updateTeacher(teacherId: number, tenantId: number | undefined, patch: UpdateTeacherPayload) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const teacher = await getTeacherForScope(client, teacherId, tenantId);
      if (!teacher) throw new HttpError(404, 'Teacher not found');
      const effectiveTenantId = teacher.tenant_id;

      const updates: string[] = [];
      const values: unknown[] = [];
      let i = 1;
      const add = (col: string, val: unknown) => {
        updates.push(`${col} = $${i++}`);
        values.push(val);
      };

      if (patch.name !== undefined) add('name', patch.name);
      if (patch.email !== undefined) add('email', patch.email);
      if (patch.phone !== undefined) add('phone', patch.phone);
      if (patch.subject !== undefined) add('subject', patch.subject);
      if (patch.description !== undefined) add('description', patch.description);
      if (patch.avatar !== undefined) add('avatar', patch.avatar);
      if (patch.account_status !== undefined) add('account_status', patch.account_status);
      if (patch.subscription_package !== undefined) {
        add('subscription_package', patch.subscription_package);
        updates.push('subscription_package_assigned_at = NOW()');
      }
      if (patch.password) add('password', await bcrypt.hash(patch.password, 10));

      if (patch.email !== undefined && patch.email) {
        const ex = await client.query(
          `SELECT id FROM users WHERE tenant_id = $1 AND lower(trim(email)) = $2 AND id <> $3 LIMIT 1`,
          [effectiveTenantId, patch.email.trim().toLowerCase(), teacherId],
        );
        if (ex.rowCount) throw new HttpError(400, 'Email already registered');
      }

      if (patch.phone !== undefined && patch.phone) {
        const ex = await client.query(
          `SELECT id FROM users WHERE tenant_id = $1 AND phone = $2 AND id <> $3 LIMIT 1`,
          [effectiveTenantId, patch.phone, teacherId],
        );
        if (ex.rowCount) throw new HttpError(400, 'Phone already registered');
      }

      if (patch.grade_ids !== undefined) {
        await ensureGradeIdsExist(client, patch.grade_ids);
        await client.query(`DELETE FROM teacher_grades WHERE teacher_id = $1`, [teacherId]);
        if (patch.grade_ids.length) {
          await client.query(
            `INSERT INTO teacher_grades (teacher_id, grade_id)
             SELECT $1, unnest($2::int[])`,
            [teacherId, patch.grade_ids],
          );
        }
      }

      if (updates.length) {
        values.push(teacherId, effectiveTenantId);
        await client.query(
          `UPDATE users SET ${updates.join(', ')} WHERE id = $${i++} AND tenant_id = $${i}`,
          values,
        );
      }

      await client.query('COMMIT');
      return { previousAvatar: teacher.avatar };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  static async setTeacherStatus(
    teacherId: number,
    tenantId: number | undefined,
    status: TeacherAccountStatus,
  ) {
    const hasTenantScope = tenantId !== undefined;
    const r = await pool.query(
      `UPDATE users
       SET account_status = $1
       WHERE id = $2
         AND role = 'teacher'
         AND ($3::int IS NULL OR tenant_id = $3)
       RETURNING id`,
      [status, teacherId, hasTenantScope ? tenantId : null],
    );
    if (!r.rowCount) throw new HttpError(404, 'Teacher not found');
  }

  static async setTeacherPackage(
    teacherId: number,
    tenantId: number | undefined,
    subscriptionPackage: TeacherSubscriptionPackage,
  ) {
    const hasTenantScope = tenantId !== undefined;
    const r = await pool.query(
      `UPDATE users
       SET subscription_package = $1,
           subscription_package_assigned_at = NOW()
       WHERE id = $2
         AND role = 'teacher'
         AND ($3::int IS NULL OR tenant_id = $3)
       RETURNING id`,
      [subscriptionPackage, teacherId, hasTenantScope ? tenantId : null],
    );
    if (!r.rowCount) throw new HttpError(404, 'Teacher not found');
  }

  static async deleteTeacher(teacherId: number, tenantId?: number) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const teacher = await getTeacherForScope(client, teacherId, tenantId);
      if (!teacher) throw new HttpError(404, 'Teacher not found');
      const effectiveTenantId = teacher.tenant_id;

      // Explicit cleanup for core relations. Other relations rely on FK constraints.
      await client.query(`DELETE FROM teacher_grades WHERE teacher_id = $1`, [teacherId]);
      await client.query(`DELETE FROM teacher_activities WHERE teacher_id = $1`, [teacherId]);
      await client.query(`DELETE FROM teacher_activity_log WHERE teacher_id = $1`, [teacherId]);

      const courses = await client.query<{ id: number }>(
        `SELECT id FROM courses WHERE teacher_id = $1`,
        [teacherId],
      );
      const courseIds = courses.rows.map((r) => r.id);
      if (courseIds.length) {
        await client.query(`DELETE FROM enrollments WHERE course_id = ANY($1::int[])`, [courseIds]);
        await client.query(`DELETE FROM courses WHERE id = ANY($1::int[])`, [courseIds]);
      }

      await client.query(`DELETE FROM users WHERE id = $1 AND tenant_id = $2 AND role = 'teacher'`, [
        teacherId,
        effectiveTenantId,
      ]);

      await client.query('COMMIT');
      return { avatar: teacher.avatar };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
}
