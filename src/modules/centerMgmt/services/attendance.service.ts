import { HttpError } from '../../../utils';
import { ActivityLogsRepository } from '../repositories/activityLogs.repository';
import { AttendanceRepository } from '../repositories/attendance.repository';
import { GroupsRepository } from '../repositories/groups.repository';
import { StudentsRepository } from '../repositories/students.repository';
import { SubscriptionsRepository } from '../repositories/subscriptions.repository';
import type { AttendanceStatus } from '../types';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function parseQrToken(input: { qr_token?: string; qr_payload?: string }): string | null {
  if (input.qr_token) return input.qr_token;
  if (!input.qr_payload) return null;
  try {
    const parsed = JSON.parse(input.qr_payload) as { qr_token?: string };
    return parsed.qr_token ?? null;
  } catch {
    const uuidLike =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidLike.test(input.qr_payload) ? input.qr_payload : null;
  }
}

export class AttendanceService {
  static async markManual(
    teacherId: number,
    actorUserId: number,
    input: {
      group_id: number;
      student_id: number;
      attendance_date: string;
      status: AttendanceStatus;
      notes?: string | null;
    },
  ) {
    const group = await GroupsRepository.findById(input.group_id, teacherId);
    if (!group) throw new HttpError(404, 'المجموعة غير موجودة');

    const enrolled = await StudentsRepository.isEnrolled(input.student_id, input.group_id);
    if (!enrolled) throw new HttpError(400, 'الطالب غير مسجل في هذه المجموعة');

    const record = await AttendanceRepository.upsert({
      teacherId,
      groupId: input.group_id,
      studentId: input.student_id,
      attendanceDate: input.attendance_date,
      status: input.status,
      method: 'manual',
      notes: input.notes,
      recordedBy: actorUserId,
    });

    await ActivityLogsRepository.log({
      teacherId,
      actorUserId,
      action: 'attendance.manual',
      entityType: 'tc_attendance',
      entityId: record.id,
      meta: {
        student_id: input.student_id,
        group_id: input.group_id,
        status: input.status,
        date: input.attendance_date,
      },
    });

    return record;
  }

  static async markBulk(
    teacherId: number,
    actorUserId: number,
    input: {
      group_id: number;
      attendance_date: string;
      records: Array<{ student_id: number; status: AttendanceStatus; notes?: string | null }>;
    },
  ) {
    const group = await GroupsRepository.findById(input.group_id, teacherId);
    if (!group) throw new HttpError(404, 'المجموعة غير موجودة');

    const saved = [];
    for (const r of input.records) {
      const enrolled = await StudentsRepository.isEnrolled(r.student_id, input.group_id);
      if (!enrolled) continue;
      const row = await AttendanceRepository.upsert({
        teacherId,
        groupId: input.group_id,
        studentId: r.student_id,
        attendanceDate: input.attendance_date,
        status: r.status,
        method: 'manual',
        notes: r.notes,
        recordedBy: actorUserId,
      });
      saved.push(row);
    }

    await ActivityLogsRepository.log({
      teacherId,
      actorUserId,
      action: 'attendance.bulk',
      entityType: 'tc_attendance',
      meta: { group_id: input.group_id, date: input.attendance_date, count: saved.length },
    });

    return { count: saved.length, records: saved };
  }

  static async scanQr(
    teacherId: number,
    actorUserId: number,
    input: {
      qr_token?: string;
      qr_payload?: string;
      group_id: number;
      attendance_date?: string;
      status?: 'present' | 'late';
      notes?: string | null;
    },
  ) {
    const token = parseQrToken(input);
    if (!token) throw new HttpError(400, 'QR غير صالح');

    const group = await GroupsRepository.findById(input.group_id, teacherId);
    if (!group) throw new HttpError(404, 'المجموعة غير موجودة');

    const student = await StudentsRepository.findByQrToken(token, teacherId);
    if (!student) throw new HttpError(404, 'الطالب غير موجود لهذا الـ QR');

    const enrolled = await StudentsRepository.isEnrolled(student.id, input.group_id);
    if (!enrolled) {
      throw new HttpError(400, 'الطالب غير مسجل في هذه المجموعة');
    }

    const date = input.attendance_date || todayIso();
    const status = input.status ?? 'present';

    const record = await AttendanceRepository.upsert({
      teacherId,
      groupId: input.group_id,
      studentId: student.id,
      attendanceDate: date,
      status,
      method: 'qr',
      notes: input.notes,
      recordedBy: actorUserId,
    });

    await ActivityLogsRepository.log({
      teacherId,
      actorUserId,
      action: 'attendance.scan',
      entityType: 'tc_attendance',
      entityId: record.id,
      meta: { student_id: student.id, group_id: input.group_id, date },
    });

    return {
      attendance: record,
      student: {
        id: student.id,
        full_name: student.full_name,
        student_code: student.student_code,
        phone: student.phone,
      },
    };
  }

  static listByDate(teacherId: number, groupId: number, date: string) {
    return AttendanceRepository.listByDate(teacherId, groupId, date);
  }

  static listByStudent(
    teacherId: number,
    studentId: number,
    opts: { groupId?: number; from?: string; to?: string },
  ) {
    return AttendanceRepository.listByStudent(teacherId, studentId, opts);
  }

  static async studentReport(
    teacherId: number,
    studentId: number,
    groupId: number,
    from: string,
    to: string,
  ) {
    const report = await AttendanceRepository.studentReport(
      teacherId,
      studentId,
      groupId,
      from,
      to,
    );
    if (!report) throw new HttpError(404, 'الطالب أو المجموعة غير موجودة');
    return {
      student: {
        id: studentId,
        full_name: report.student_name,
        student_code: report.student_code,
      },
      group_id: groupId,
      group_name: report.group_name,
      from,
      to,
      totals: report.totals,
      records: report.records,
    };
  }

  static groupSummary(teacherId: number, groupId: number, from: string, to: string) {
    return AttendanceRepository.groupSummary(teacherId, groupId, from, to);
  }
}

export class DashboardService {
  static async get(teacherId: number) {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const today = todayIso();

    const [groupsCount, studentCounts, finances, todayAttendance] = await Promise.all([
      GroupsRepository.countByTeacher(teacherId),
      StudentsRepository.countByTeacher(teacherId),
      SubscriptionsRepository.monthSummary(teacherId, year, month),
      AttendanceRepository.todaySummary(teacherId, today),
    ]);

    return {
      groups_count: groupsCount,
      students_count: studentCounts.total,
      active_students_count: studentCounts.active,
      current_month: { year, month },
      finances,
      today_attendance: todayAttendance,
    };
  }
}
