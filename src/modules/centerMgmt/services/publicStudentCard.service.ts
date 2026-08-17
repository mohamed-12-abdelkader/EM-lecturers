import pool from '../../../db/pool';
import { HttpError } from '../../../utils';
import { AttendanceRepository } from '../repositories/attendance.repository';
import { ExamsRepository } from '../repositories/exams.repository';
import { StudentsRepository } from '../repositories/students.repository';

const PAYMENT_AR: Record<string, string> = {
  paid: 'مدفوع',
  unpaid: 'غير مدفوع',
  partial: 'جزئي',
  exempt: 'معفي',
};

export type PublicStudentCard = {
  student: {
    full_name: string;
    student_code: string;
  };
  teacher_name: string;
  groups: Array<{
    group_id: number;
    group_name: string;
    present: number;
    absent: number;
    late: number;
    excused: number;
    lectures_attended: number;
    payment_status: string | null;
    payment_status_ar: string | null;
  }>;
  attendance_totals: {
    present: number;
    absent: number;
    late: number;
    excused: number;
  };
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

    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;

    const [teacherRes, attendance, exams, payments] = await Promise.all([
      pool.query<{ name: string }>(`SELECT name FROM users WHERE id = $1`, [student.teacher_id]),
      AttendanceRepository.summaryByStudent(student.id, student.teacher_id),
      ExamsRepository.listByStudent(student.id, student.teacher_id),
      pool.query<{
        group_id: number;
        status: string;
      }>(
        `SELECT group_id, status
         FROM tc_monthly_subscriptions
         WHERE student_id = $1 AND year = $2 AND month = $3 AND deleted_at IS NULL`,
        [student.id, year, month],
      ),
    ]);

    const payByGroup = new Map(payments.rows.map((p) => [p.group_id, p.status]));
    const groups = attendance.map((g) => {
      const status = payByGroup.get(g.group_id) ?? null;
      return {
        ...g,
        lectures_attended: g.present + g.late,
        payment_status: status,
        payment_status_ar: status ? PAYMENT_AR[status] ?? status : null,
      };
    });

    const attendance_totals = groups.reduce(
      (acc, g) => ({
        present: acc.present + g.present,
        absent: acc.absent + g.absent,
        late: acc.late + g.late,
        excused: acc.excused + g.excused,
      }),
      { present: 0, absent: 0, late: 0, excused: 0 },
    );

    return {
      student: {
        full_name: student.full_name,
        student_code: student.student_code,
      },
      teacher_name: teacherRes.rows[0]?.name ?? 'السنتر',
      groups,
      attendance_totals,
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
