import pool from '../../../db/pool';
import { HttpError } from '../../../utils';
import { AttendanceRepository } from '../repositories/attendance.repository';
import { ExamsRepository } from '../repositories/exams.repository';
import { StudentsRepository } from '../repositories/students.repository';
import type { AttendanceStatus, TcStudentRow } from '../types';

const PAYMENT_AR: Record<string, string> = {
  paid: 'مدفوع',
  unpaid: 'غير مدفوع',
  partial: 'جزئي',
  exempt: 'معفي',
};

const ATTENDANCE_AR: Record<AttendanceStatus, string> = {
  present: 'حاضر',
  absent: 'غائب',
  late: 'متأخر',
  excused: 'بعذر',
};

const MONTHS_AR = [
  'يناير',
  'فبراير',
  'مارس',
  'أبريل',
  'مايو',
  'يونيو',
  'يوليو',
  'أغسطس',
  'سبتمبر',
  'أكتوبر',
  'نوفمبر',
  'ديسمبر',
];

function toNumber(value: string | number | null | undefined): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function formatTime(value: string | null): string | null {
  if (!value) return null;
  return value.slice(0, 5);
}

export type PublicStudentCard = {
  student: {
    full_name: string;
    student_code: string;
  };
  teacher_name: string;
  billing_month: {
    year: number;
    month: number;
    label: string;
  };
  groups: Array<{
    group_id: number;
    group_name: string;
    grade_name: string | null;
    subject_name: string | null;
    days: string[];
    start_time: string | null;
    end_time: string | null;
    schedule_label: string | null;
    monthly_fee: number;
    present: number;
    absent: number;
    late: number;
    excused: number;
    lectures_attended: number;
    last_attendance_date: string | null;
    payment_status: string | null;
    payment_status_ar: string | null;
    amount_due: number | null;
    amount_paid: number | null;
    remaining: number | null;
  }>;
  attendance_totals: {
    present: number;
    absent: number;
    late: number;
    excused: number;
    lectures_attended: number;
  };
  recent_attendance: Array<{
    attendance_date: string;
    day_name: string | null;
    status: AttendanceStatus;
    status_ar: string;
    group_name: string;
  }>;
  exams: Array<{
    title: string;
    group_name: string;
    total_grade: number;
    score: number | null;
    percentage: number | null;
    is_absent: boolean;
    exam_date: string | null;
  }>;
};

export class PublicStudentCardService {
  static async getByQrToken(qrToken: string): Promise<PublicStudentCard> {
    const student = await StudentsRepository.findByQrTokenPublic(qrToken);
    if (!student) throw new HttpError(404, 'بطاقة الطالب غير موجودة أو غير نشطة');
    return this.getForStudent(student);
  }

  static async getByStudentId(studentId: number, teacherId: number): Promise<PublicStudentCard> {
    const student = await StudentsRepository.findById(studentId, teacherId);
    if (!student) throw new HttpError(404, 'الطالب غير موجود');
    return this.getForStudent(student);
  }

  static async getForStudent(student: TcStudentRow): Promise<PublicStudentCard> {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;

    const [teacherRes, attendance, exams, payments, recent] = await Promise.all([
      pool.query<{ name: string }>(`SELECT name FROM users WHERE id = $1`, [student.teacher_id]),
      AttendanceRepository.summaryByStudent(student.id, student.teacher_id),
      ExamsRepository.listByStudent(student.id, student.teacher_id),
      pool.query<{
        group_id: number;
        status: string;
        amount_due: string;
        amount_paid: string;
        remaining: string;
      }>(
        `SELECT group_id, status, amount_due::text, amount_paid::text, remaining::text
         FROM tc_monthly_subscriptions
         WHERE student_id = $1 AND year = $2 AND month = $3 AND deleted_at IS NULL`,
        [student.id, year, month],
      ),
      AttendanceRepository.listRecentByStudent(student.teacher_id, student.id, 20),
    ]);

    const payByGroup = new Map(payments.rows.map((p) => [p.group_id, p]));
    const groups = attendance.map((g) => {
      const pay = payByGroup.get(g.group_id);
      const start = formatTime(g.start_time);
      const end = formatTime(g.end_time);
      const timeLabel = start && end ? `${start} – ${end}` : start || end;
      const daysLabel = g.days.length ? g.days.join('، ') : null;
      const schedule_label = [daysLabel, timeLabel].filter(Boolean).join(' · ') || null;
      const status = pay?.status ?? null;

      return {
        group_id: g.group_id,
        group_name: g.group_name,
        grade_name: g.grade_name,
        subject_name: g.subject_name,
        days: g.days,
        start_time: start,
        end_time: end,
        schedule_label,
        monthly_fee: toNumber(g.monthly_fee),
        present: g.present,
        absent: g.absent,
        late: g.late,
        excused: g.excused,
        lectures_attended: g.present + g.late,
        last_attendance_date: g.last_attendance_date,
        payment_status: status,
        payment_status_ar: status ? PAYMENT_AR[status] ?? status : null,
        amount_due: pay ? toNumber(pay.amount_due) : null,
        amount_paid: pay ? toNumber(pay.amount_paid) : null,
        remaining: pay ? toNumber(pay.remaining) : null,
      };
    });

    const attendance_totals = groups.reduce(
      (acc, g) => ({
        present: acc.present + g.present,
        absent: acc.absent + g.absent,
        late: acc.late + g.late,
        excused: acc.excused + g.excused,
        lectures_attended: acc.lectures_attended + g.lectures_attended,
      }),
      { present: 0, absent: 0, late: 0, excused: 0, lectures_attended: 0 },
    );

    return {
      student: {
        full_name: student.full_name,
        student_code: student.student_code,
      },
      teacher_name: teacherRes.rows[0]?.name ?? 'السنتر',
      billing_month: {
        year,
        month,
        label: `${MONTHS_AR[month - 1]} ${year}`,
      },
      groups,
      attendance_totals,
      recent_attendance: recent.map((row) => ({
        attendance_date: String(row.attendance_date).slice(0, 10),
        day_name: row.day_name,
        status: row.status,
        status_ar: ATTENDANCE_AR[row.status] ?? row.status,
        group_name: row.group_name,
      })),
      exams: exams.map((e) => ({
        title: e.title,
        group_name: e.group_name,
        total_grade: e.total_grade,
        score: e.score,
        percentage: e.percentage,
        is_absent: e.is_absent,
        exam_date: e.exam_date,
      })),
    };
  }
}
