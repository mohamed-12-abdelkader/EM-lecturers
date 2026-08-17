import { HttpError } from '../../../utils';
import { ActivityLogsRepository } from '../repositories/activityLogs.repository';
import { ExamsRepository } from '../repositories/exams.repository';
import { GroupsRepository } from '../repositories/groups.repository';
import { StudentsRepository } from '../repositories/students.repository';
import type { TcGroupExamGradeInput } from '../types';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export class ExamsService {
  static async create(
    teacherId: number,
    actorUserId: number,
    groupId: number,
    input: {
      title: string;
      total_grade: number;
      exam_date?: string | null;
      notes?: string | null;
      grades?: TcGroupExamGradeInput[];
    },
  ) {
    const group = await GroupsRepository.findById(groupId, teacherId);
    if (!group) throw new HttpError(404, 'المجموعة غير موجودة');

    const exam = await ExamsRepository.create({
      teacherId,
      groupId,
      title: input.title.trim(),
      totalGrade: input.total_grade,
      examDate: input.exam_date,
      notes: input.notes,
    });

    if (input.grades?.length) {
      await this.saveGrades(teacherId, actorUserId, exam.id, input.grades, exam);
    }

    await ActivityLogsRepository.log({
      teacherId,
      actorUserId,
      action: 'exam.create',
      entityType: 'tc_group_exams',
      entityId: exam.id,
      meta: {
        group_id: groupId,
        title: exam.title,
        grades_count: input.grades?.length ?? 0,
      },
    });

    return this.get(teacherId, groupId, exam.id);
  }

  static async update(
    teacherId: number,
    actorUserId: number,
    groupId: number,
    examId: number,
    input: Partial<{
      title: string;
      total_grade: number;
      exam_date: string | null;
      notes: string | null;
    }>,
  ) {
    const exam = await this.requireExam(teacherId, groupId, examId);
    const updated = await ExamsRepository.update(exam.id, teacherId, {
      title: input.title?.trim(),
      totalGrade: input.total_grade,
      examDate: input.exam_date,
      notes: input.notes,
    });
    if (!updated) throw new HttpError(404, 'الامتحان غير موجود');

    await ActivityLogsRepository.log({
      teacherId,
      actorUserId,
      action: 'exam.update',
      entityType: 'tc_group_exams',
      entityId: examId,
    });

    return this.get(teacherId, groupId, examId);
  }

  static async remove(teacherId: number, actorUserId: number, groupId: number, examId: number) {
    await this.requireExam(teacherId, groupId, examId);
    const ok = await ExamsRepository.softDelete(examId, teacherId);
    if (!ok) throw new HttpError(404, 'الامتحان غير موجود');

    await ActivityLogsRepository.log({
      teacherId,
      actorUserId,
      action: 'exam.delete',
      entityType: 'tc_group_exams',
      entityId: examId,
      meta: { group_id: groupId },
    });

    return { success: true };
  }

  static async list(teacherId: number, groupId: number) {
    const group = await GroupsRepository.findById(groupId, teacherId);
    if (!group) throw new HttpError(404, 'المجموعة غير موجودة');
    return ExamsRepository.listByGroup(groupId, teacherId);
  }

  static async get(teacherId: number, groupId: number, examId: number) {
    const exam = await this.requireExam(teacherId, groupId, examId);
    const students = await ExamsRepository.roster(examId, teacherId);
    const graded = students.filter((s) => s.recorded && !s.is_absent && s.score != null);
    const scores = graded.map((s) => s.score as number);
    const average = scores.length ? round2(scores.reduce((a, b) => a + b, 0) / scores.length) : null;

    return {
      exam: {
        ...exam,
        total_grade: Number(exam.total_grade),
      },
      students,
      summary: {
        students_count: students.length,
        graded_count: graded.length,
        absent_count: students.filter((s) => s.is_absent).length,
        not_recorded_count: students.filter((s) => !s.recorded).length,
        average_score: average,
        max_score: scores.length ? Math.max(...scores) : null,
        min_score: scores.length ? Math.min(...scores) : null,
      },
    };
  }

  static async upsertGrades(
    teacherId: number,
    actorUserId: number,
    groupId: number,
    examId: number,
    grades: TcGroupExamGradeInput[],
  ) {
    const exam = await this.requireExam(teacherId, groupId, examId);
    await this.saveGrades(teacherId, actorUserId, examId, grades, exam);

    await ActivityLogsRepository.log({
      teacherId,
      actorUserId,
      action: 'exam.grades.upsert',
      entityType: 'tc_group_exams',
      entityId: examId,
      meta: { group_id: groupId, grades_count: grades.length },
    });

    return this.get(teacherId, groupId, examId);
  }

  static async updateStudentGrade(
    teacherId: number,
    actorUserId: number,
    groupId: number,
    examId: number,
    studentId: number,
    input: { score?: number | null; is_absent?: boolean; notes?: string | null },
  ) {
    const exam = await this.requireExam(teacherId, groupId, examId);
    const roster = await ExamsRepository.roster(examId, teacherId);
    const existing = roster.find((s) => s.student_id === studentId);
    if (!existing) throw new HttpError(400, 'الطالب غير مسجل في هذه المجموعة');

    await this.saveGrades(
      teacherId,
      actorUserId,
      examId,
      [
        {
          student_id: studentId,
          score: input.score !== undefined ? input.score : existing.score,
          is_absent: input.is_absent !== undefined ? input.is_absent : existing.is_absent,
          notes: input.notes !== undefined ? input.notes : existing.notes,
        },
      ],
      exam,
    );

    await ActivityLogsRepository.log({
      teacherId,
      actorUserId,
      action: 'exam.grade.update',
      entityType: 'tc_group_exam_grades',
      entityId: examId,
      meta: { student_id: studentId, group_id: groupId },
    });

    return this.get(teacherId, groupId, examId);
  }

  static async deleteStudentGrade(
    teacherId: number,
    actorUserId: number,
    groupId: number,
    examId: number,
    studentId: number,
  ) {
    await this.requireExam(teacherId, groupId, examId);
    const ok = await ExamsRepository.deleteGrade(examId, studentId, teacherId);
    if (!ok) throw new HttpError(404, 'درجة الطالب غير موجودة');

    await ActivityLogsRepository.log({
      teacherId,
      actorUserId,
      action: 'exam.grade.delete',
      entityType: 'tc_group_exam_grades',
      entityId: examId,
      meta: { student_id: studentId, group_id: groupId },
    });

    return this.get(teacherId, groupId, examId);
  }

  static listByStudent(teacherId: number, studentId: number) {
    return ExamsRepository.listByStudent(studentId, teacherId);
  }

  private static async requireExam(teacherId: number, groupId: number, examId: number) {
    const group = await GroupsRepository.findById(groupId, teacherId);
    if (!group) throw new HttpError(404, 'المجموعة غير موجودة');
    const exam = await ExamsRepository.findById(examId, teacherId);
    if (!exam || exam.group_id !== groupId) throw new HttpError(404, 'الامتحان غير موجود');
    return exam;
  }

  private static async saveGrades(
    teacherId: number,
    actorUserId: number,
    examId: number,
    grades: TcGroupExamGradeInput[],
    exam: { group_id: number; total_grade: string | number },
  ) {
    const total = Number(exam.total_grade);
    const invalidIds: number[] = [];
    const overMax: number[] = [];
    const missingScore: number[] = [];

    for (const g of grades) {
      const enrolled = await StudentsRepository.isEnrolled(g.student_id, exam.group_id);
      if (!enrolled) {
        invalidIds.push(g.student_id);
        continue;
      }
      const isAbsent = g.is_absent === true;
      if (!isAbsent && (g.score == null || Number.isNaN(Number(g.score)))) {
        missingScore.push(g.student_id);
        continue;
      }
      if (!isAbsent && Number(g.score) > total) {
        overMax.push(g.student_id);
      }
    }

    if (invalidIds.length) {
      throw new HttpError(400, 'بعض الطلاب غير مسجلين في هذه المجموعة', {
        invalid_student_ids: invalidIds,
      });
    }
    if (missingScore.length) {
      throw new HttpError(400, 'الدرجة مطلوبة إلا إذا كان الطالب غائباً', {
        student_ids: missingScore,
      });
    }
    if (overMax.length) {
      throw new HttpError(400, `الدرجة لا يمكن أن تتجاوز الدرجة الكلية (${total})`, {
        student_ids: overMax,
        total_grade: total,
      });
    }

    await ExamsRepository.upsertGrades({
      teacherId,
      examId,
      recordedBy: actorUserId,
      grades,
    });
  }
}
