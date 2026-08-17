import pool from '../../../db/pool';
import type {
  EnrollmentStatus,
  TcQrCodeRow,
  TcStudentGroupRow,
  TcStudentListItem,
  TcStudentRow,
} from '../types';

export class StudentsRepository {
  static async nextStudentCode(teacherId: number, client = pool): Promise<string> {
    const seq = await client.query<{ last_value: number }>(
      `INSERT INTO tc_student_code_seq (teacher_id, last_value)
       VALUES ($1, 1)
       ON CONFLICT (teacher_id)
       DO UPDATE SET last_value = tc_student_code_seq.last_value + 1
       RETURNING last_value`,
      [teacherId],
    );
    const n = seq.rows[0].last_value;
    return `TC-${teacherId}-${String(n).padStart(4, '0')}`;
  }

  /** Next visible student id inside a group (1, 2, 3, … independent per group). */
  static async nextGroupMemberNo(groupId: number, client = pool): Promise<number> {
    const seq = await client.query<{ last_value: number }>(
      `INSERT INTO tc_group_member_seq (group_id, last_value)
       VALUES ($1, 1)
       ON CONFLICT (group_id)
       DO UPDATE SET last_value = tc_group_member_seq.last_value + 1
       RETURNING last_value`,
      [groupId],
    );
    return seq.rows[0].last_value;
  }

  static async create(input: {
    teacherId: number;
    fullName: string;
    phone?: string | null;
    parentPhone?: string | null;
    notes?: string | null;
    studentCode?: string;
  }): Promise<TcStudentRow> {
    const studentCode = input.studentCode ?? (await this.nextStudentCode(input.teacherId));
    const result = await pool.query<TcStudentRow>(
      `INSERT INTO tc_students (
         teacher_id, student_code, full_name, phone, parent_phone, notes
       ) VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        input.teacherId,
        studentCode,
        input.fullName,
        input.phone ?? null,
        input.parentPhone ?? null,
        input.notes ?? null,
      ],
    );
    return result.rows[0];
  }

  static async update(
    id: number,
    teacherId: number,
    patch: Partial<{
      fullName: string;
      phone: string | null;
      parentPhone: string | null;
      notes: string | null;
      isActive: boolean;
    }>,
  ): Promise<TcStudentRow | null> {
    const fields: string[] = [];
    const values: unknown[] = [];
    const map: Array<[keyof typeof patch, string]> = [
      ['fullName', 'full_name'],
      ['phone', 'phone'],
      ['parentPhone', 'parent_phone'],
      ['notes', 'notes'],
      ['isActive', 'is_active'],
    ];

    for (const [key, column] of map) {
      if (patch[key] !== undefined) {
        values.push(patch[key]);
        fields.push(`${column} = $${values.length}`);
      }
    }
    if (!fields.length) return this.findById(id, teacherId);

    fields.push('updated_at = NOW()');
    values.push(id, teacherId);

    const result = await pool.query<TcStudentRow>(
      `UPDATE tc_students
       SET ${fields.join(', ')}
       WHERE id = $${values.length - 1} AND teacher_id = $${values.length} AND deleted_at IS NULL
       RETURNING *`,
      values,
    );
    return result.rows[0] ?? null;
  }

  static async softDelete(id: number, teacherId: number): Promise<boolean> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `UPDATE tc_students
         SET deleted_at = NOW(), updated_at = NOW(), is_active = FALSE
         WHERE id = $1 AND teacher_id = $2 AND deleted_at IS NULL`,
        [id, teacherId],
      );
      if ((result.rowCount ?? 0) === 0) {
        await client.query('ROLLBACK');
        return false;
      }
      await client.query(
        `UPDATE tc_student_groups
         SET status = 'left', deleted_at = NOW(), updated_at = NOW()
         WHERE student_id = $1 AND deleted_at IS NULL`,
        [id],
      );
      await client.query('COMMIT');
      return true;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  static async findById(id: number, teacherId: number): Promise<TcStudentListItem | null> {
    const result = await pool.query<TcStudentRow>(
      `SELECT * FROM tc_students
       WHERE id = $1 AND teacher_id = $2 AND deleted_at IS NULL`,
      [id, teacherId],
    );
    const student = result.rows[0];
    if (!student) return null;

    const groups = await pool.query<{
      id: number;
      name: string;
      status: EnrollmentStatus;
      member_no: number | null;
    }>(
      `SELECT g.id, g.name, sg.status, sg.member_no
       FROM tc_student_groups sg
       JOIN tc_groups g ON g.id = sg.group_id AND g.deleted_at IS NULL
       WHERE sg.student_id = $1 AND sg.deleted_at IS NULL`,
      [id],
    );
    const qr = await pool.query<TcQrCodeRow>(
      `SELECT * FROM tc_qr_codes WHERE student_id = $1`,
      [id],
    );

    return {
      ...student,
      groups: groups.rows,
      qr_token: qr.rows[0]?.qr_token ?? null,
      qr_image_base64: qr.rows[0]?.qr_image_base64 ?? null,
    };
  }

  static async list(
    teacherId: number,
    opts: {
      groupId?: number;
      search?: string;
      isActive?: boolean;
      page?: number;
      limit?: number;
    } = {},
  ): Promise<{ items: TcStudentListItem[]; total: number }> {
    const page = opts.page ?? 1;
    const limit = opts.limit ?? 50;
    const params: unknown[] = [teacherId];
    const where = ['st.teacher_id = $1', 'st.deleted_at IS NULL'];

    if (opts.isActive !== undefined) {
      params.push(opts.isActive);
      where.push(`st.is_active = $${params.length}`);
    }
    if (opts.search?.trim()) {
      params.push(`%${opts.search.trim()}%`);
      where.push(
        `(st.full_name ILIKE $${params.length} OR st.phone ILIKE $${params.length} OR st.parent_phone ILIKE $${params.length} OR st.student_code ILIKE $${params.length})`,
      );
    }
    if (opts.groupId) {
      params.push(opts.groupId);
      where.push(`EXISTS (
        SELECT 1 FROM tc_student_groups sg
        WHERE sg.student_id = st.id AND sg.group_id = $${params.length}
          AND sg.deleted_at IS NULL AND sg.status = 'active'
      )`);
    }

    const whereSql = where.join(' AND ');
    const countRes = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM tc_students st WHERE ${whereSql}`,
      params,
    );
    const total = parseInt(countRes.rows[0]?.count ?? '0', 10);

    params.push(limit, (page - 1) * limit);
    const listRes = await pool.query<TcStudentRow>(
      `SELECT st.* FROM tc_students st
       WHERE ${whereSql}
       ORDER BY st.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    const items: TcStudentListItem[] = [];
    for (const student of listRes.rows) {
      const groups = await pool.query<{
        id: number;
        name: string;
        status: EnrollmentStatus;
        member_no: number | null;
      }>(
        `SELECT g.id, g.name, sg.status, sg.member_no
         FROM tc_student_groups sg
         JOIN tc_groups g ON g.id = sg.group_id AND g.deleted_at IS NULL
         WHERE sg.student_id = $1 AND sg.deleted_at IS NULL`,
        [student.id],
      );
      items.push({ ...student, groups: groups.rows });
    }

    return { items, total };
  }

  static async listByGroup(
    groupId: number,
    teacherId: number,
  ): Promise<
    Array<
      TcStudentRow & {
        enrolled_at: string;
        enrollment_status: EnrollmentStatus;
        member_no: number | null;
        group_student_id: number | null;
      }
    >
  > {
    const result = await pool.query<
      TcStudentRow & {
        enrolled_at: string;
        enrollment_status: EnrollmentStatus;
        member_no: number | null;
      }
    >(
      `SELECT st.*, sg.enrolled_at, sg.status AS enrollment_status, sg.member_no
       FROM tc_student_groups sg
       JOIN tc_students st ON st.id = sg.student_id AND st.deleted_at IS NULL
       JOIN tc_groups g ON g.id = sg.group_id AND g.teacher_id = $2 AND g.deleted_at IS NULL
       WHERE sg.group_id = $1 AND sg.deleted_at IS NULL AND sg.status = 'active'
       ORDER BY sg.member_no ASC NULLS LAST, st.full_name ASC`,
      [groupId, teacherId],
    );
    return result.rows.map((row) => ({
      ...row,
      group_student_id: row.member_no,
      // Display code inside the group is the per-group number (1, 2, 3…)
      student_code: row.member_no != null ? String(row.member_no) : row.student_code,
    }));
  }

  static async enroll(
    studentId: number,
    groupId: number,
  ): Promise<TcStudentGroupRow> {
    const existing = await pool.query<TcStudentGroupRow>(
      `SELECT * FROM tc_student_groups
       WHERE student_id = $1 AND group_id = $2`,
      [studentId, groupId],
    );
    const prev = existing.rows[0];

    // Re-activate keeps the same member_no; first enroll / missing number gets next
    let memberNo = prev?.member_no ?? null;
    if (memberNo == null) {
      memberNo = await this.nextGroupMemberNo(groupId);
    }

    return this.enrollWithMemberNo(studentId, groupId, memberNo);
  }

  static async enrollWithMemberNo(
    studentId: number,
    groupId: number,
    memberNo: number,
  ): Promise<TcStudentGroupRow> {
    const result = await pool.query<TcStudentGroupRow>(
      `INSERT INTO tc_student_groups (student_id, group_id, status, member_no)
       VALUES ($1, $2, 'active', $3)
       ON CONFLICT (student_id, group_id)
       DO UPDATE SET
         status = 'active',
         deleted_at = NULL,
         updated_at = NOW(),
         enrolled_at = CURRENT_DATE,
         member_no = COALESCE(tc_student_groups.member_no, EXCLUDED.member_no)
       RETURNING *`,
      [studentId, groupId, memberNo],
    );
    return result.rows[0];
  }

  static async unenroll(studentId: number, groupId: number, teacherId: number): Promise<boolean> {
    const result = await pool.query(
      `UPDATE tc_student_groups sg
       SET status = 'left', deleted_at = NOW(), updated_at = NOW()
       FROM tc_groups g, tc_students st
       WHERE sg.group_id = g.id AND sg.student_id = st.id
         AND sg.student_id = $1 AND sg.group_id = $2
         AND g.teacher_id = $3 AND st.teacher_id = $3
         AND sg.deleted_at IS NULL`,
      [studentId, groupId, teacherId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  static async isEnrolled(studentId: number, groupId: number): Promise<boolean> {
    const result = await pool.query(
      `SELECT 1 FROM tc_student_groups
       WHERE student_id = $1 AND group_id = $2 AND deleted_at IS NULL AND status = 'active'`,
      [studentId, groupId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  static async upsertQr(input: {
    studentId: number;
    qrToken: string;
    qrPayload: string;
    qrImageBase64: string;
    barcode?: string | null;
  }): Promise<TcQrCodeRow> {
    const result = await pool.query<TcQrCodeRow>(
      `INSERT INTO tc_qr_codes (student_id, qr_token, qr_payload, qr_image_base64, barcode)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (student_id)
       DO UPDATE SET
         qr_token = EXCLUDED.qr_token,
         qr_payload = EXCLUDED.qr_payload,
         qr_image_base64 = EXCLUDED.qr_image_base64,
         barcode = COALESCE(EXCLUDED.barcode, tc_qr_codes.barcode),
         updated_at = NOW()
       RETURNING *`,
      [
        input.studentId,
        input.qrToken,
        input.qrPayload,
        input.qrImageBase64,
        input.barcode ?? null,
      ],
    );
    return result.rows[0];
  }

  static async findByQrToken(qrToken: string, teacherId: number): Promise<TcStudentRow | null> {
    const result = await pool.query<TcStudentRow>(
      `SELECT st.*
       FROM tc_qr_codes qr
       JOIN tc_students st ON st.id = qr.student_id
       WHERE qr.qr_token = $1 AND st.teacher_id = $2 AND st.deleted_at IS NULL`,
      [qrToken, teacherId],
    );
    return result.rows[0] ?? null;
  }

  static async findByQrTokenPublic(qrToken: string): Promise<TcStudentRow | null> {
    const result = await pool.query<TcStudentRow>(
      `SELECT st.*
       FROM tc_qr_codes qr
       JOIN tc_students st ON st.id = qr.student_id
       WHERE LOWER(qr.qr_token::text) = LOWER($1)
         AND st.deleted_at IS NULL
         AND st.is_active = TRUE`,
      [qrToken],
    );
    return result.rows[0] ?? null;
  }

  static async getQr(studentId: number, teacherId: number): Promise<TcQrCodeRow | null> {
    const result = await pool.query<TcQrCodeRow>(
      `SELECT qr.*
       FROM tc_qr_codes qr
       JOIN tc_students st ON st.id = qr.student_id
       WHERE qr.student_id = $1 AND st.teacher_id = $2 AND st.deleted_at IS NULL`,
      [studentId, teacherId],
    );
    return result.rows[0] ?? null;
  }

  static async countByTeacher(teacherId: number): Promise<{ total: number; active: number }> {
    const result = await pool.query<{ total: string; active: string }>(
      `SELECT
         COUNT(*)::text AS total,
         COUNT(*) FILTER (WHERE is_active)::text AS active
       FROM tc_students
       WHERE teacher_id = $1 AND deleted_at IS NULL`,
      [teacherId],
    );
    return {
      total: parseInt(result.rows[0]?.total ?? '0', 10),
      active: parseInt(result.rows[0]?.active ?? '0', 10),
    };
  }

  static async listActiveEnrollments(teacherId: number): Promise<
    Array<{ student_id: number; group_id: number; monthly_fee: string }>
  > {
    const result = await pool.query<{ student_id: number; group_id: number; monthly_fee: string }>(
      `SELECT sg.student_id, sg.group_id, g.monthly_fee::text AS monthly_fee
       FROM tc_student_groups sg
       JOIN tc_groups g ON g.id = sg.group_id
       JOIN tc_students st ON st.id = sg.student_id
       WHERE g.teacher_id = $1
         AND g.deleted_at IS NULL AND g.status = 'active'
         AND sg.deleted_at IS NULL AND sg.status = 'active'
         AND st.deleted_at IS NULL AND st.is_active = TRUE`,
      [teacherId],
    );
    return result.rows;
  }
}
