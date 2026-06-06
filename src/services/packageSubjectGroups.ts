import pool from '../db/pool';

export interface CreateGroupInput {
  name: string;
  teacher_id?: number | null;
  schedule_days?: string[] | null; // e.g. ["sat","tue"]
  schedule_time?: string | null; // e.g. "20:00"
}

export class PackageSubjectGroupsService {
  static async createGroup(subjectItemId: number, input: CreateGroupInput, createdBy: number) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const groupRes = await client.query(
        `INSERT INTO package_subject_item_groups (package_subject_item_id, name, teacher_id, schedule_days, schedule_time, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [
          subjectItemId,
          input.name,
          input.teacher_id ?? null,
          input.schedule_days ?? null,
          input.schedule_time ?? null,
          createdBy,
        ]
      );

      const group = groupRes.rows[0];

      await client.query('COMMIT');
      return group;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  static async listGroupsForSubject(subjectItemId: number) {
    const res = await pool.query(
      `SELECT g.*, u.name AS teacher_name, u.avatar AS teacher_avatar
       FROM package_subject_item_groups g
       LEFT JOIN users u ON u.id = g.teacher_id
       WHERE g.package_subject_item_id = $1
       ORDER BY g.created_at DESC`,
      [subjectItemId]
    );
    return res.rows;
  }

  static async listTeacherGroupsForSubject(subjectItemId: number, teacherId: number) {
    const res = await pool.query(
      `SELECT g.*, u.name AS teacher_name, u.avatar AS teacher_avatar
       FROM package_subject_item_groups g
       LEFT JOIN users u ON u.id = g.teacher_id
       WHERE g.package_subject_item_id = $1 AND g.teacher_id = $2
       ORDER BY g.created_at DESC`,
      [subjectItemId, teacherId]
    );
    return res.rows;
  }

  // جلب مواد الباقة التي لدى المدرس مجموعات فيها (مع ملخص المجموعات)
  static async listTeacherSubjectsWithGroups(teacherId: number) {
    const res = await pool.query(
      `SELECT 
         psi.id AS subject_id,
         psi.package_id,
         psi.name AS subject_name,
         psi.image AS subject_image,
         p.name AS package_name,
         p.grade_id,
         COUNT(g.id) AS groups_count
       FROM package_subject_item_groups g
       JOIN package_subject_items psi ON psi.id = g.package_subject_item_id
       JOIN packages p ON p.id = psi.package_id
       WHERE g.teacher_id = $1
       GROUP BY psi.id, psi.package_id, psi.name, psi.image, p.name, p.grade_id
       ORDER BY psi.id DESC`,
      [teacherId]
    );

    // جلب المجموعات لكل مادة
    const subjectIds = res.rows.map((r) => r.subject_id);
    let groupsBySubject = new Map<number, any[]>();
    if (subjectIds.length) {
      const groupsRes = await pool.query(
        `SELECT 
           g.id,
           g.package_subject_item_id AS subject_id,
           g.name,
           g.teacher_id,
           g.schedule_days,
           g.schedule_time,
           g.created_at
         FROM package_subject_item_groups g
         WHERE g.teacher_id = $1 AND g.package_subject_item_id = ANY($2::int[])
         ORDER BY g.created_at DESC`,
        [teacherId, subjectIds]
      );
      groupsBySubject = new Map<number, any[]>();
      for (const row of groupsRes.rows) {
        const arr = groupsBySubject.get(row.subject_id) ?? [];
        arr.push(row);
        groupsBySubject.set(row.subject_id, arr);
      }
    }

    return res.rows.map((r) => ({
      id: r.subject_id,
      package_id: r.package_id,
      name: r.subject_name,
      image: r.subject_image,
      package_name: r.package_name,
      grade_id: r.grade_id,
      groups_count: Number(r.groups_count ?? 0),
      groups: groupsBySubject.get(r.subject_id) ?? [],
    }));
  }

  static async getGroupById(groupId: number) {
    const res = await pool.query(
      `SELECT * FROM package_subject_item_groups WHERE id = $1`,
      [groupId]
    );
    return res.rows[0] || null;
  }

  static async updateGroup(
    groupId: number,
    data: Partial<Pick<CreateGroupInput, 'name' | 'teacher_id' | 'schedule_days' | 'schedule_time'>>
  ) {
    const updates: string[] = [];
    const values: any[] = [];
    let i = 1;

    if (data.name !== undefined) {
      updates.push(`name = $${i++}`);
      values.push(data.name);
    }
    if (data.teacher_id !== undefined) {
      updates.push(`teacher_id = $${i++}`);
      values.push(data.teacher_id);
    }
    if (data.schedule_days !== undefined) {
      updates.push(`schedule_days = $${i++}`);
      values.push(data.schedule_days);
    }
    if (data.schedule_time !== undefined) {
      updates.push(`schedule_time = $${i++}`);
      values.push(data.schedule_time);
    }

    if (!updates.length) {
      return await this.getGroupById(groupId);
    }

    updates.push(`updated_at = NOW()`);
    values.push(groupId);

    const res = await pool.query(
      `UPDATE package_subject_item_groups
       SET ${updates.join(', ')}
       WHERE id = $${i}
       RETURNING *`,
      values
    );
    return res.rows[0] || null;
  }

  static async deleteGroup(groupId: number): Promise<boolean> {
    const res = await pool.query(
      `DELETE FROM package_subject_item_groups WHERE id = $1`,
      [groupId]
    );
    return (res.rowCount ?? 0) > 0;
  }

  static async teacherOwnsGroup(groupId: number, teacherId: number): Promise<boolean> {
    const res = await pool.query(
      `SELECT 1 FROM package_subject_item_groups WHERE id = $1 AND teacher_id = $2 LIMIT 1`,
      [groupId, teacherId]
    );
    return (res.rowCount ?? 0) > 0;
  }

  static async addStudentsToGroup(groupId: number, studentIds: number[], addedBy: number) {
    if (!studentIds.length) return { added: 0 };
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // determine subject for this group (once)
      const groupRes = await client.query(
        `SELECT package_subject_item_id FROM package_subject_item_groups WHERE id = $1`,
        [groupId]
      );
      if (!groupRes.rowCount) {
        throw new Error('المجموعة غير موجودة');
      }
      const subjectItemId = groupRes.rows[0].package_subject_item_id as number;

      // check students already assigned to another group in same subject
      const conflictRes = await client.query(
        `SELECT student_id
         FROM package_subject_item_group_students
         WHERE package_subject_item_id = $1 AND student_id = ANY($2::int[])
           AND group_id <> $3`,
        [subjectItemId, studentIds, groupId]
      );
      const blocked = new Set<number>(conflictRes.rows.map((r: any) => r.student_id));

      let added = 0;
      let skipped_already_in_other_group = 0;
      for (const sid of studentIds) {
        if (blocked.has(sid)) {
          skipped_already_in_other_group++;
          continue;
        }
        const r = await client.query(
          `INSERT INTO package_subject_item_group_students (group_id, student_id, added_by)
           VALUES ($1, $2, $3)
           ON CONFLICT (group_id, student_id) DO NOTHING`,
          [groupId, sid, addedBy]
        );
        if ((r.rowCount ?? 0) > 0) added++;
      }
      await client.query('COMMIT');
      return { added, skipped_already_in_other_group };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  static async listGroupStudents(groupId: number) {
    const res = await pool.query(
      `SELECT u.id, u.name, u.email, u.phone, u.avatar, gs.added_at
       FROM package_subject_item_group_students gs
       JOIN users u ON u.id = gs.student_id
       WHERE gs.group_id = $1
       ORDER BY gs.added_at DESC`,
      [groupId]
    );
    return res.rows;
  }

  static async removeStudentFromGroup(groupId: number, studentId: number): Promise<boolean> {
    const res = await pool.query(
      `DELETE FROM package_subject_item_group_students
       WHERE group_id = $1 AND student_id = $2`,
      [groupId, studentId]
    );
    return (res.rowCount ?? 0) > 0;
  }

  static async unassignTeacherFromGroup(groupId: number) {
    return await this.updateGroup(groupId, { teacher_id: null });
  }

  static async getStudentGroupForSubject(subjectItemId: number, studentId: number): Promise<number | null> {
    const res = await pool.query(
      `SELECT gs.group_id
       FROM package_subject_item_group_students gs
       JOIN package_subject_item_groups g ON g.id = gs.group_id
       WHERE gs.student_id = $1 AND g.package_subject_item_id = $2
       LIMIT 1`,
      [studentId, subjectItemId]
    );
    return res.rows[0]?.group_id ?? null;
  }

  static async getSchedule(groupId: number) {
    const res = await pool.query(
      `SELECT id, title, starts_at, ends_at
       FROM package_subject_item_group_schedules
       WHERE group_id = $1
       ORDER BY starts_at ASC`,
      [groupId]
    );
    return res.rows;
  }
}


