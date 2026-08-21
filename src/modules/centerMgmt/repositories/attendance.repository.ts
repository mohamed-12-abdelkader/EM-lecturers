import pool from '../../../db/pool';
import type {
  AttendanceMethod,
  AttendanceStatus,
  TcAttendanceListItem,
  TcAttendanceRow,
} from '../types';

const ARABIC_DAYS = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

export function arabicDayName(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00`);
  return ARABIC_DAYS[d.getDay()] ?? '';
}

export class AttendanceRepository {
  static async upsert(input: {
    teacherId: number;
    groupId: number;
    studentId: number;
    attendanceDate: string;
    status: AttendanceStatus;
    method?: AttendanceMethod;
    notes?: string | null;
    recordedBy?: number | null;
  }): Promise<TcAttendanceRow> {
    const dayName = arabicDayName(input.attendanceDate);
    const checkedInAt = ['present', 'late'].includes(input.status) ? new Date() : null;

    const result = await pool.query<TcAttendanceRow>(
      `INSERT INTO tc_attendance (
         teacher_id, group_id, student_id, attendance_date, day_name,
         status, checked_in_at, method, notes, recorded_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (student_id, group_id, attendance_date)
       DO UPDATE SET
         status = EXCLUDED.status,
         checked_in_at = EXCLUDED.checked_in_at,
         method = EXCLUDED.method,
         notes = EXCLUDED.notes,
         recorded_by = EXCLUDED.recorded_by,
         day_name = EXCLUDED.day_name,
         updated_at = NOW()
       RETURNING *`,
      [
        input.teacherId,
        input.groupId,
        input.studentId,
        input.attendanceDate,
        dayName,
        input.status,
        checkedInAt,
        input.method ?? 'manual',
        input.notes ?? null,
        input.recordedBy ?? null,
      ],
    );
    return result.rows[0];
  }

  static async listByDate(
    teacherId: number,
    groupId: number,
    attendanceDate: string,
  ): Promise<TcAttendanceListItem[]> {
    const result = await pool.query<TcAttendanceListItem>(
      `SELECT a.*, st.full_name AS student_name, st.student_code, g.name AS group_name
       FROM tc_attendance a
       JOIN tc_students st ON st.id = a.student_id
       JOIN tc_groups g ON g.id = a.group_id
       WHERE a.teacher_id = $1 AND a.group_id = $2 AND a.attendance_date = $3
       ORDER BY st.full_name ASC`,
      [teacherId, groupId, attendanceDate],
    );
    return result.rows;
  }

  static async listByStudent(
    teacherId: number,
    studentId: number,
    opts: { groupId?: number; from?: string; to?: string } = {},
  ): Promise<TcAttendanceListItem[]> {
    const params: unknown[] = [teacherId, studentId];
    const where = ['a.teacher_id = $1', 'a.student_id = $2'];

    if (opts.groupId) {
      params.push(opts.groupId);
      where.push(`a.group_id = $${params.length}`);
    }
    if (opts.from) {
      params.push(opts.from);
      where.push(`a.attendance_date >= $${params.length}`);
    }
    if (opts.to) {
      params.push(opts.to);
      where.push(`a.attendance_date <= $${params.length}`);
    }

    const result = await pool.query<TcAttendanceListItem>(
      `SELECT a.*, st.full_name AS student_name, st.student_code, g.name AS group_name
       FROM tc_attendance a
       JOIN tc_students st ON st.id = a.student_id
       JOIN tc_groups g ON g.id = a.group_id
       WHERE ${where.join(' AND ')}
       ORDER BY a.attendance_date DESC`,
      params,
    );
    return result.rows;
  }

  static async studentReport(
    teacherId: number,
    studentId: number,
    groupId: number,
    from: string,
    to: string,
  ): Promise<{
    student_name: string;
    student_code: string;
    group_name: string;
    totals: { present: number; absent: number; late: number; excused: number; total_days: number };
    records: TcAttendanceListItem[];
  } | null> {
    const meta = await pool.query<{
      student_name: string;
      student_code: string;
      group_name: string;
    }>(
      `SELECT st.full_name AS student_name, st.student_code, g.name AS group_name
       FROM tc_students st
       JOIN tc_groups g ON g.id = $3 AND g.teacher_id = $1 AND g.deleted_at IS NULL
       WHERE st.id = $2 AND st.teacher_id = $1 AND st.deleted_at IS NULL`,
      [teacherId, studentId, groupId],
    );
    if (!meta.rows[0]) return null;

    const records = await this.listByStudent(teacherId, studentId, { groupId, from, to });
    const totals = {
      present: records.filter((r) => r.status === 'present').length,
      absent: records.filter((r) => r.status === 'absent').length,
      late: records.filter((r) => r.status === 'late').length,
      excused: records.filter((r) => r.status === 'excused').length,
      total_days: records.length,
    };

    return {
      ...meta.rows[0],
      totals,
      records,
    };
  }

  static async todaySummary(teacherId: number, date: string): Promise<{
    present: number;
    absent: number;
    late: number;
    excused: number;
  }> {
    const result = await pool.query<{
      present: string;
      absent: string;
      late: string;
      excused: string;
    }>(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'present')::text AS present,
         COUNT(*) FILTER (WHERE status = 'absent')::text AS absent,
         COUNT(*) FILTER (WHERE status = 'late')::text AS late,
         COUNT(*) FILTER (WHERE status = 'excused')::text AS excused
       FROM tc_attendance
       WHERE teacher_id = $1 AND attendance_date = $2`,
      [teacherId, date],
    );
    const row = result.rows[0];
    return {
      present: parseInt(row?.present ?? '0', 10),
      absent: parseInt(row?.absent ?? '0', 10),
      late: parseInt(row?.late ?? '0', 10),
      excused: parseInt(row?.excused ?? '0', 10),
    };
  }

  static async groupSummary(
    teacherId: number,
    groupId: number,
    from: string,
    to: string,
  ): Promise<
    Array<{
      student_id: number;
      student_name: string;
      student_code: string;
      present: number;
      absent: number;
      late: number;
      excused: number;
      total_days: number;
    }>
  > {
    const result = await pool.query<{
      student_id: number;
      student_name: string;
      student_code: string;
      present: string;
      absent: string;
      late: string;
      excused: string;
      total_days: string;
    }>(
      `SELECT
         st.id AS student_id,
         st.full_name AS student_name,
         st.student_code,
         COUNT(*) FILTER (WHERE a.status = 'present')::text AS present,
         COUNT(*) FILTER (WHERE a.status = 'absent')::text AS absent,
         COUNT(*) FILTER (WHERE a.status = 'late')::text AS late,
         COUNT(*) FILTER (WHERE a.status = 'excused')::text AS excused,
         COUNT(*)::text AS total_days
       FROM tc_student_groups sg
       JOIN tc_students st ON st.id = sg.student_id AND st.deleted_at IS NULL
       LEFT JOIN tc_attendance a
         ON a.student_id = st.id AND a.group_id = sg.group_id
         AND a.attendance_date BETWEEN $3 AND $4
       WHERE sg.group_id = $2 AND sg.deleted_at IS NULL AND sg.status = 'active'
         AND EXISTS (
           SELECT 1 FROM tc_groups g
           WHERE g.id = sg.group_id AND g.teacher_id = $1 AND g.deleted_at IS NULL
         )
       GROUP BY st.id, st.full_name, st.student_code
       ORDER BY st.full_name ASC`,
      [teacherId, groupId, from, to],
    );

    return result.rows.map((r) => ({
      student_id: r.student_id,
      student_name: r.student_name,
      student_code: r.student_code,
      present: parseInt(r.present, 10),
      absent: parseInt(r.absent, 10),
      late: parseInt(r.late, 10),
      excused: parseInt(r.excused, 10),
      total_days: parseInt(r.total_days, 10),
    }));
  }

  static async summaryByStudent(
    studentId: number,
    teacherId: number,
  ): Promise<
    Array<{
      group_id: number;
      group_name: string;
      grade_name: string | null;
      subject_name: string | null;
      days: string[];
      start_time: string | null;
      end_time: string | null;
      monthly_fee: string;
      present: number;
      absent: number;
      late: number;
      excused: number;
      last_attendance_date: string | null;
    }>
  > {
    const result = await pool.query<{
      group_id: number;
      group_name: string;
      grade_name: string | null;
      subject_name: string | null;
      days: string[] | null;
      start_time: string | null;
      end_time: string | null;
      monthly_fee: string;
      present: string;
      absent: string;
      late: string;
      excused: string;
      last_attendance_date: string | null;
    }>(
      `SELECT
         g.id AS group_id,
         g.name AS group_name,
         gr.name AS grade_name,
         s.name AS subject_name,
         g.days,
         g.start_time::text AS start_time,
         g.end_time::text AS end_time,
         g.monthly_fee::text AS monthly_fee,
         COUNT(a.id) FILTER (WHERE a.status = 'present')::text AS present,
         COUNT(a.id) FILTER (WHERE a.status = 'absent')::text AS absent,
         COUNT(a.id) FILTER (WHERE a.status = 'late')::text AS late,
         COUNT(a.id) FILTER (WHERE a.status = 'excused')::text AS excused,
         MAX(a.attendance_date)::text AS last_attendance_date
       FROM tc_student_groups sg
       JOIN tc_groups g ON g.id = sg.group_id AND g.deleted_at IS NULL
       LEFT JOIN grades gr ON gr.id = g.grade_id
       LEFT JOIN subjects s ON s.id = g.subject_id
       LEFT JOIN tc_attendance a
         ON a.student_id = sg.student_id AND a.group_id = sg.group_id
       WHERE sg.student_id = $1
         AND g.teacher_id = $2
         AND sg.deleted_at IS NULL
         AND sg.status = 'active'
       GROUP BY g.id, g.name, gr.name, s.name, g.days, g.start_time, g.end_time, g.monthly_fee
       ORDER BY g.name ASC`,
      [studentId, teacherId],
    );
    return result.rows.map((r) => ({
      group_id: r.group_id,
      group_name: r.group_name,
      grade_name: r.grade_name,
      subject_name: r.subject_name,
      days: Array.isArray(r.days) ? r.days : [],
      start_time: r.start_time,
      end_time: r.end_time,
      monthly_fee: r.monthly_fee,
      present: parseInt(r.present, 10),
      absent: parseInt(r.absent, 10),
      late: parseInt(r.late, 10),
      excused: parseInt(r.excused, 10),
      last_attendance_date: r.last_attendance_date,
    }));
  }

  static async listRecentByStudent(
    teacherId: number,
    studentId: number,
    limit = 20,
  ): Promise<
    Array<{
      attendance_date: string;
      day_name: string | null;
      status: AttendanceStatus;
      group_name: string;
    }>
  > {
    const safeLimit = Math.min(Math.max(limit, 1), 50);
    const result = await pool.query<{
      attendance_date: string;
      day_name: string | null;
      status: AttendanceStatus;
      group_name: string;
    }>(
      `SELECT a.attendance_date::text AS attendance_date, a.day_name, a.status, g.name AS group_name
       FROM tc_attendance a
       JOIN tc_groups g ON g.id = a.group_id
       WHERE a.teacher_id = $1 AND a.student_id = $2
       ORDER BY a.attendance_date DESC, a.id DESC
       LIMIT $3`,
      [teacherId, studentId, safeLimit],
    );
    return result.rows;
  }
}
