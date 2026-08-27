import pool from '../db/pool';
import { HttpError } from '../utils';

export type LectureAccessType = 'all' | 'groups';
export type CourseGroupStatus = 'active' | 'inactive';

export type TeacherCourseSettings = {
  teacher_id: number;
  course_group_access_enabled: boolean;
};

export type CourseGroupRow = {
  id: number;
  teacher_id: number;
  grade_id: number;
  name: string;
  description: string | null;
  status: CourseGroupStatus;
  created_at: Date;
  updated_at: Date;
  grade_name?: string;
  students_count?: number;
};

export type GroupAccessCheck = {
  allowed: boolean;
  message: string;
  status: 'open' | 'group_restricted' | 'not_applicable';
  access_type?: LectureAccessType;
  teacher_group_access_enabled?: boolean;
};

export class CourseGroupAccessService {
  // ─── Teacher settings ─────────────────────────────────────

  static async getTeacherSettings(teacherId: number): Promise<TeacherCourseSettings> {
    const r = await pool.query(
      `SELECT teacher_id, course_group_access_enabled
       FROM teacher_course_settings WHERE teacher_id = $1`,
      [teacherId],
    );
    if (!r.rowCount) {
      return { teacher_id: teacherId, course_group_access_enabled: false };
    }
    return {
      teacher_id: teacherId,
      course_group_access_enabled: !!r.rows[0].course_group_access_enabled,
    };
  }

  static async updateTeacherSettings(
    teacherId: number,
    patch: { course_group_access_enabled?: boolean },
  ): Promise<TeacherCourseSettings> {
    if (patch.course_group_access_enabled === undefined) {
      return this.getTeacherSettings(teacherId);
    }
    const r = await pool.query(
      `INSERT INTO teacher_course_settings (teacher_id, course_group_access_enabled, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (teacher_id) DO UPDATE
         SET course_group_access_enabled = EXCLUDED.course_group_access_enabled,
             updated_at = NOW()
       RETURNING teacher_id, course_group_access_enabled`,
      [teacherId, patch.course_group_access_enabled],
    );
    return {
      teacher_id: r.rows[0].teacher_id,
      course_group_access_enabled: !!r.rows[0].course_group_access_enabled,
    };
  }

  static async isGroupAccessEnabledForTeacher(teacherId: number): Promise<boolean> {
    const s = await this.getTeacherSettings(teacherId);
    return s.course_group_access_enabled;
  }

  static async resolveCourseTeacherId(courseId: number): Promise<number | null> {
    const r = await pool.query<{ teacher_id: number }>(
      `SELECT teacher_id FROM courses WHERE id = $1`,
      [courseId],
    );
    return r.rowCount ? r.rows[0].teacher_id : null;
  }

  static async resolveTenantOwnerTeacherId(tenantId: number): Promise<number | null> {
    const r = await pool.query<{ owner_user_id: number | null }>(
      `SELECT owner_user_id FROM tenants WHERE id = $1`,
      [tenantId],
    );
    return r.rowCount && r.rows[0].owner_user_id ? r.rows[0].owner_user_id : null;
  }

  // ─── Groups CRUD ──────────────────────────────────────────

  static async listGroups(
    teacherId: number,
    opts?: { grade_id?: number; include_inactive?: boolean },
  ): Promise<CourseGroupRow[]> {
    const params: unknown[] = [teacherId];
    let sql = `
      SELECT cg.*, g.name AS grade_name,
             (SELECT COUNT(*)::int FROM student_course_group_memberships m WHERE m.group_id = cg.id) AS students_count
      FROM course_groups cg
      JOIN grades g ON g.id = cg.grade_id
      WHERE cg.teacher_id = $1`;
    if (!opts?.include_inactive) {
      sql += ` AND cg.status = 'active'`;
    }
    if (opts?.grade_id) {
      params.push(opts.grade_id);
      sql += ` AND cg.grade_id = $${params.length}`;
    }
    sql += ` ORDER BY g.level NULLS LAST, g.name, cg.name`;
    const r = await pool.query<CourseGroupRow>(sql, params);
    return r.rows;
  }

  static async getGroupById(groupId: number, teacherId?: number): Promise<CourseGroupRow | null> {
    const params: unknown[] = [groupId];
    let sql = `
      SELECT cg.*, g.name AS grade_name,
             (SELECT COUNT(*)::int FROM student_course_group_memberships m WHERE m.group_id = cg.id) AS students_count
      FROM course_groups cg
      JOIN grades g ON g.id = cg.grade_id
      WHERE cg.id = $1`;
    if (teacherId != null) {
      params.push(teacherId);
      sql += ` AND cg.teacher_id = $${params.length}`;
    }
    const r = await pool.query<CourseGroupRow>(sql, params);
    return r.rowCount ? r.rows[0] : null;
  }

  static async createGroup(input: {
    teacher_id: number;
    grade_id: number;
    name: string;
    description?: string | null;
  }): Promise<CourseGroupRow> {
    const grade = await pool.query(`SELECT id FROM grades WHERE id = $1 AND status = 'active'`, [
      input.grade_id,
    ]);
    if (!grade.rowCount) throw new HttpError(400, 'الصف الدراسي غير موجود أو غير نشط');

    const dup = await pool.query(
      `SELECT id FROM course_groups
       WHERE teacher_id = $1 AND grade_id = $2 AND lower(name) = lower($3) AND status = 'active'`,
      [input.teacher_id, input.grade_id, input.name.trim()],
    );
    if (dup.rowCount) throw new HttpError(409, 'يوجد مجموعة بنفس الاسم لهذا الصف');

    const r = await pool.query<CourseGroupRow>(
      `INSERT INTO course_groups (teacher_id, grade_id, name, description)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [input.teacher_id, input.grade_id, input.name.trim(), input.description?.trim() || null],
    );
    const row = r.rows[0];
    const withGrade = await this.getGroupById(row.id, input.teacher_id);
    return withGrade!;
  }

  static async updateGroup(
    groupId: number,
    teacherId: number,
    patch: { name?: string; description?: string | null; grade_id?: number; status?: CourseGroupStatus },
  ): Promise<CourseGroupRow> {
    const existing = await this.getGroupById(groupId, teacherId);
    if (!existing) throw new HttpError(404, 'المجموعة غير موجودة');

    if (patch.grade_id != null) {
      const grade = await pool.query(`SELECT id FROM grades WHERE id = $1 AND status = 'active'`, [
        patch.grade_id,
      ]);
      if (!grade.rowCount) throw new HttpError(400, 'الصف الدراسي غير موجود أو غير نشط');
    }

    if (patch.name) {
      const dup = await pool.query(
        `SELECT id FROM course_groups
         WHERE teacher_id = $1 AND grade_id = $2 AND lower(name) = lower($3)
           AND status = 'active' AND id <> $4`,
        [
          teacherId,
          patch.grade_id ?? existing.grade_id,
          patch.name.trim(),
          groupId,
        ],
      );
      if (dup.rowCount) throw new HttpError(409, 'يوجد مجموعة بنفس الاسم لهذا الصف');
    }

    const fields: string[] = [];
    const vals: unknown[] = [];
    let i = 1;
    const add = (col: string, v: unknown) => {
      fields.push(`${col} = $${i++}`);
      vals.push(v);
    };
    if (patch.name !== undefined) add('name', patch.name.trim());
    if (patch.description !== undefined) add('description', patch.description?.trim() || null);
    if (patch.grade_id !== undefined) add('grade_id', patch.grade_id);
    if (patch.status !== undefined) add('status', patch.status);
    add('updated_at', new Date());

    if (!fields.length) return existing;

    vals.push(groupId, teacherId);
    const r = await pool.query(
      `UPDATE course_groups SET ${fields.join(', ')}
       WHERE id = $${i++} AND teacher_id = $${i}
       RETURNING id`,
      vals,
    );
    if (!r.rowCount) throw new HttpError(404, 'المجموعة غير موجودة');
    return (await this.getGroupById(groupId, teacherId))!;
  }

  static async deactivateGroup(groupId: number, teacherId: number): Promise<CourseGroupRow> {
    return this.updateGroup(groupId, teacherId, { status: 'inactive' });
  }

  // ─── Student membership ───────────────────────────────────

  static async getStudentMembershipForTeacher(studentId: number, teacherId: number) {
    const r = await pool.query(
      `SELECT m.*, cg.name AS group_name, cg.grade_id, g.name AS grade_name, cg.status AS group_status
       FROM student_course_group_memberships m
       JOIN course_groups cg ON cg.id = m.group_id
       JOIN grades g ON g.id = cg.grade_id
       WHERE m.student_id = $1 AND cg.teacher_id = $2 AND cg.status = 'active'
       ORDER BY m.updated_at DESC
       LIMIT 1`,
      [studentId, teacherId],
    );
    return r.rowCount ? r.rows[0] : null;
  }

  static async listGroupStudents(groupId: number, teacherId: number) {
    const group = await this.getGroupById(groupId, teacherId);
    if (!group) throw new HttpError(404, 'المجموعة غير موجودة');

    const r = await pool.query(
      `SELECT u.id, u.name, u.phone, u.avatar, m.created_at AS joined_at
       FROM student_course_group_memberships m
       JOIN users u ON u.id = m.student_id
       WHERE m.group_id = $1
       ORDER BY u.name`,
      [groupId],
    );
    return r.rows;
  }

  /** Assign student to group — one active group per teacher; validates grade alignment */
  static async assignStudentToGroup(
    studentId: number,
    groupId: number,
    teacherId: number,
    opts?: { skipGradeCheck?: boolean },
  ) {
    const group = await this.getGroupById(groupId, teacherId);
    if (!group || group.status !== 'active') {
      throw new HttpError(404, 'المجموعة غير موجودة أو غير نشطة');
    }

    const student = await pool.query(
      `SELECT id, role, tenant_id FROM users WHERE id = $1`,
      [studentId],
    );
    if (!student.rowCount || student.rows[0].role !== 'student') {
      throw new HttpError(404, 'الطالب غير موجود');
    }

    if (!opts?.skipGradeCheck) {
      const gradeMatch = await pool.query(
        `SELECT 1 FROM user_grades WHERE user_id = $1 AND grade_id = $2 LIMIT 1`,
        [studentId, group.grade_id],
      );
      if (!gradeMatch.rowCount) {
        throw new HttpError(
          400,
          'صف الطالب لا يطابق صف المجموعة — حدّث صف الطالب أو اختر مجموعة مناسبة',
        );
      }
    }

    await pool.query('BEGIN');
    try {
      // Remove from any other group of same teacher
      await pool.query(
        `DELETE FROM student_course_group_memberships m
         USING course_groups cg
         WHERE m.group_id = cg.id
           AND cg.teacher_id = $1
           AND m.student_id = $2
           AND m.group_id <> $3`,
        [teacherId, studentId, groupId],
      );

      await pool.query(
        `INSERT INTO student_course_group_memberships (student_id, group_id, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (student_id, group_id) DO UPDATE SET updated_at = NOW()`,
        [studentId, groupId],
      );
      await pool.query('COMMIT');
    } catch (e) {
      await pool.query('ROLLBACK');
      throw e;
    }

    return this.getStudentMembershipForTeacher(studentId, teacherId);
  }

  static async removeStudentFromGroup(studentId: number, groupId: number, teacherId: number) {
    const group = await this.getGroupById(groupId, teacherId);
    if (!group) throw new HttpError(404, 'المجموعة غير موجودة');

    const r = await pool.query(
      `DELETE FROM student_course_group_memberships m
       USING course_groups cg
       WHERE m.group_id = cg.id
         AND m.student_id = $1
         AND m.group_id = $2
         AND cg.teacher_id = $3
       RETURNING m.id`,
      [studentId, groupId, teacherId],
    );
    if (!r.rowCount) throw new HttpError(404, 'الطالب غير موجود في هذه المجموعة');
    return { success: true };
  }

  static async validateGroupIdsForTeacher(groupIds: number[], teacherId: number): Promise<number[]> {
    if (!groupIds.length) return [];
    const unique = [...new Set(groupIds.map(Number).filter((id) => id > 0))];
    const r = await pool.query(
      `SELECT id FROM course_groups
       WHERE teacher_id = $1 AND status = 'active' AND id = ANY($2::int[])`,
      [teacherId, unique],
    );
    if (r.rowCount !== unique.length) {
      throw new HttpError(400, 'واحدة أو أكثر من المجموعات غير صالحة أو لا تخص هذا المدرس');
    }
    return unique;
  }

  // ─── Lecture targeting ────────────────────────────────────

  static async getLectureGroupIds(lectureId: number): Promise<number[]> {
    const r = await pool.query<{ group_id: number }>(
      `SELECT group_id FROM lecture_course_groups WHERE lecture_id = $1`,
      [lectureId],
    );
    return r.rows.map((row) => row.group_id);
  }

  static async getLectureAccessMeta(lectureId: number): Promise<{
    access_type: LectureAccessType;
    group_ids: number[];
    course_id: number;
    teacher_id: number;
  } | null> {
    const r = await pool.query(
      `SELECT l.id, l.course_id, COALESCE(l.access_type, 'all') AS access_type, c.teacher_id
       FROM lectures l
       JOIN courses c ON c.id = l.course_id
       WHERE l.id = $1`,
      [lectureId],
    );
    if (!r.rowCount) return null;
    const row = r.rows[0];
    const groupIds = await this.getLectureGroupIds(lectureId);
    return {
      access_type: row.access_type as LectureAccessType,
      group_ids: groupIds,
      course_id: row.course_id,
      teacher_id: row.teacher_id,
    };
  }

  static async setLectureAccess(
    lectureId: number,
    teacherId: number,
    accessType: LectureAccessType,
    groupIds: number[],
  ) {
    const meta = await this.getLectureAccessMeta(lectureId);
    if (!meta || meta.teacher_id !== teacherId) {
      throw new HttpError(404, 'المحاضرة غير موجودة أو لا تخص هذا المدرس');
    }

    if (accessType === 'groups') {
      // تفعيل نظام المجموعات تلقائيًا عند اختيار مجموعات للمحاضرة
      await this.updateTeacherSettings(teacherId, { course_group_access_enabled: true });
      const validIds = await this.validateGroupIdsForTeacher(groupIds, teacherId);
      if (!validIds.length) {
        throw new HttpError(400, 'يجب اختيار مجموعة واحدة على الأقل عندما تكون المحاضرة لمجموعات محددة');
      }
      groupIds = validIds;
    } else {
      groupIds = [];
    }

    await pool.query('BEGIN');
    try {
      await pool.query(
        `UPDATE lectures
         SET access_type = $1,
             access_mode = CASE
               WHEN $1 = 'groups' THEN 'groups'
               WHEN COALESCE(access_mode, 'open') = 'groups' THEN 'open'
               ELSE COALESCE(access_mode, 'open')
             END
         WHERE id = $2`,
        [accessType, lectureId],
      );
      await pool.query(`DELETE FROM lecture_course_groups WHERE lecture_id = $1`, [lectureId]);
      if (accessType === 'groups' && groupIds.length) {
        for (const gid of groupIds) {
          await pool.query(
            `INSERT INTO lecture_course_groups (lecture_id, group_id) VALUES ($1, $2)
             ON CONFLICT DO NOTHING`,
            [lectureId, gid],
          );
        }
      }
      await pool.query('COMMIT');
    } catch (e) {
      await pool.query('ROLLBACK');
      throw e;
    }

    return this.getLectureAccessMeta(lectureId);
  }

  static async attachGroupsToNewLecture(
    lectureId: number,
    teacherId: number,
    accessType: LectureAccessType,
    groupIds: number[],
  ) {
    if (accessType === 'all') return;
    await this.setLectureAccess(lectureId, teacherId, accessType, groupIds);
  }

  /** Core authorization: can this student see this lecture based on group rules?
   *  opts.enforce = true → تجاهل إعداد المدرس وطبّق قيد المجموعات دائمًا (وضع access_mode=groups)
   */
  static async checkStudentLectureGroupAccess(
    lectureId: number,
    studentId: number,
    opts?: { enforce?: boolean },
  ): Promise<GroupAccessCheck> {
    const meta = await this.getLectureAccessMeta(lectureId);
    if (!meta) {
      return { allowed: false, message: 'المحاضرة غير موجودة', status: 'group_restricted' };
    }

    const enforce = !!opts?.enforce;
    const modeRes = await pool.query<{ access_mode: string }>(
      `SELECT COALESCE(access_mode, 'open') AS access_mode FROM lectures WHERE id = $1`,
      [lectureId],
    );
    const accessMode = modeRes.rows[0]?.access_mode || 'open';
    const isGroupsMode = accessMode === 'groups' || meta.access_type === 'groups';

    if (!enforce) {
      const enabled = await this.isGroupAccessEnabledForTeacher(meta.teacher_id);
      if (!enabled) {
        return {
          allowed: true,
          message: 'نظام المجموعات غير مفعّل',
          status: 'not_applicable',
          access_type: meta.access_type,
          teacher_group_access_enabled: false,
        };
      }
      if (!isGroupsMode) {
        return {
          allowed: true,
          message: 'المحاضرة متاحة للكل',
          status: 'open',
          access_type: 'all',
          teacher_group_access_enabled: true,
        };
      }
    } else if (!isGroupsMode) {
      return {
        allowed: true,
        message: 'المحاضرة متاحة للكل',
        status: 'open',
        access_type: 'all',
        teacher_group_access_enabled: true,
      };
    }

    if (!meta.group_ids.length) {
      return {
        allowed: false,
        message: 'المحاضرة غير متاحة لمجموعتك',
        status: 'group_restricted',
        access_type: 'groups',
        teacher_group_access_enabled: true,
      };
    }

    const membership = await this.getStudentMembershipForTeacher(studentId, meta.teacher_id);
    if (!membership) {
      return {
        allowed: false,
        message: 'المحاضرة متاحة لمجموعات محددة فقط — أنت غير مرتبط بمجموعة',
        status: 'group_restricted',
        access_type: 'groups',
        teacher_group_access_enabled: true,
      };
    }

    if (!meta.group_ids.includes(Number(membership.group_id))) {
      return {
        allowed: false,
        message: 'المحاضرة غير متاحة لمجموعتك',
        status: 'group_restricted',
        access_type: 'groups',
        teacher_group_access_enabled: true,
      };
    }

    return {
      allowed: true,
      message: 'المحاضرة متاحة لمجموعتك',
      status: 'open',
      access_type: 'groups',
      teacher_group_access_enabled: true,
    };
  }

  /** SQL fragment — محاضرات المجموعات تظهر للكل (غير الأعضاء يفتحونها بالكود) */
  static buildStudentLectureFilterClause(
    _studentId: number,
    _teacherId: number,
    _lectureAlias = 'l',
    _startIndex = 1,
  ): { sql: string; params: unknown[] } {
    return {
      sql: `TRUE`,
      params: [],
    };
  }

  static async filterLectureRowsForStudent<T extends { id: number }>(
    lectures: T[],
    _courseId: number,
    _studentId: number,
  ): Promise<T[]> {
    // كل المحاضرات الظاهرة تُعرض؛ القفل بالكود يُحسب في LectureAccessService
    return lectures;
  }

  static async listPublicGroupsByGrade(tenantId: number, gradeId: number) {
    const teacherId = await this.resolveTenantOwnerTeacherId(tenantId);
    if (!teacherId) return [];

    const enabled = await this.isGroupAccessEnabledForTeacher(teacherId);
    if (!enabled) return [];

    return this.listGroups(teacherId, { grade_id: gradeId });
  }
}
