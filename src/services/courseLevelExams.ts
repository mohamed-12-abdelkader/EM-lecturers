import pool from '../db/pool';
import { HttpError } from '../utils';
import { CourseAccessControl } from './courseAccessControl';
import { determineAnswerRelease } from './examPolicies';
import {
  attemptQuestionSeed,
  canStudentStartExam,
  courseLevelExamAvailabilityInput,
  flagsFromAnswersReleaseMode,
  getStudentExamAvailability,
  inferAnswersReleaseMode,
  normalizeAnswersReleaseMode,
  normalizeQuestionDisplayMode,
  orderItemsByIds,
  parseSelectedQuestionIds,
  selectAttemptQuestions,
  shouldListExamForStudent,
} from './examAccessPolicy';

interface RequestUser {
  id: number;
  role: string;
}

interface CreateCourseLevelExamInput {
  title: string;
  courseId: number;
  durationMinutes: number;
  questionsCount: number;
  isVisibleToStudents: boolean;
  visibilityEndDate: Date | null;
  availableFrom?: Date | null;
  showAnswersImmediately: boolean;
  answersVisibleAt: Date | null;
  answersReleaseMode?: string | null;
  showAnswersAfterHours?: number | null;
  questionDisplayMode?: string | null;
  isActive: boolean;
  attemptLimit?: number | null;
}

interface UpdateCourseLevelExamInput {
  title?: string;
  durationMinutes?: number;
  questionsCount?: number;
  isVisibleToStudents?: boolean;
  visibilityEndDate?: Date | null;
  availableFrom?: Date | null;
  showAnswersImmediately?: boolean;
  answersVisibleAt?: Date | null;
  answersReleaseMode?: string | null;
  showAnswersAfterHours?: number | null;
  questionDisplayMode?: string | null;
  isActive?: boolean;
  attemptLimit?: number | null;
}

export class CourseLevelExamsService {
  static async createExam(requester: RequestUser, input: CreateCourseLevelExamInput) {
    const courseRes = await pool.query('SELECT id, teacher_id FROM courses WHERE id = $1', [
      input.courseId,
    ]);

    if (!courseRes.rowCount) {
      throw new HttpError(404, 'Course not found');
    }

    const course = courseRes.rows[0];
    if (requester.role === 'teacher' && course.teacher_id !== requester.id) {
      throw new HttpError(403, 'You are not allowed to create exams for this course');
    }

    // Validate attemptLimit if provided
    if (
      input.attemptLimit !== undefined &&
      input.attemptLimit !== null &&
      input.attemptLimit <= 0
    ) {
      throw new HttpError(400, 'attemptLimit must be greater than 0 if provided');
    }

    const resolvedDisplayMode = normalizeQuestionDisplayMode(input.questionDisplayMode);
    const resolvedReleaseMode = input.answersReleaseMode
      ? normalizeAnswersReleaseMode(input.answersReleaseMode)
      : inferAnswersReleaseMode({
          showAnswersImmediately: input.showAnswersImmediately,
          answersVisibleAt: input.answersVisibleAt,
          showAnswersAfterHours: input.showAnswersAfterHours,
        });
    const releaseFlags = flagsFromAnswersReleaseMode(resolvedReleaseMode, {
      afterHours: input.showAnswersAfterHours,
      scheduledDate: input.answersVisibleAt,
    });

    const result = await pool.query(
      `INSERT INTO course_level_exams (
        course_id,
        title,
        duration_minutes,
        questions_count,
        is_visible_to_students,
        visibility_end_date,
        available_from,
        show_answers_immediately,
        answers_visible_at,
        is_active,
        attempt_limit,
        question_display_mode,
        answers_release_mode,
        show_answers_after_hours
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *`,
      [
        input.courseId,
        input.title,
        input.durationMinutes,
        input.questionsCount,
        input.isVisibleToStudents,
        input.visibilityEndDate,
        input.availableFrom ?? null,
        releaseFlags.showAnswersImmediately,
        resolvedReleaseMode === 'scheduled' ? input.answersVisibleAt : null,
        input.isActive,
        input.attemptLimit ?? null,
        resolvedDisplayMode,
        resolvedReleaseMode,
        releaseFlags.showAnswersAfterHours,
      ],
    );

    return result.rows[0];
  }

  static async getExamsByCourse(courseId: number, requester: RequestUser) {
    // Verify course exists and requester has access
    const courseRes = await pool.query('SELECT id, teacher_id FROM courses WHERE id = $1', [
      courseId,
    ]);

    if (!courseRes.rowCount) {
      throw new HttpError(404, 'Course not found');
    }

    const course = courseRes.rows[0];
    if (requester.role === 'teacher' && course.teacher_id !== requester.id) {
      throw new HttpError(403, 'You are not allowed to view exams for this course');
    }

    const result = await pool.query(
      `SELECT e.*,
              (SELECT COUNT(*)::int FROM course_level_exam_questions q WHERE q.exam_id = e.id) AS actual_questions_count
       FROM course_level_exams e
       WHERE e.course_id = $1
       ORDER BY e.created_at DESC`,
      [courseId],
    );

    return result.rows.map((row) => ({
      ...row,
      configuredQuestionsCount: row.questions_count,
      actualQuestionsCount: row.actual_questions_count,
      availability_status: getStudentExamAvailability(courseLevelExamAvailabilityInput(row)),
    }));
  }

  static async getExamsByTeacher(
    teacherId: number,
    filters?: { courseId?: number },
  ) {
    const params: unknown[] = [teacherId];
    let query = `
      SELECT
        e.*,
        c.title AS course_title,
        c.id AS course_id,
        COUNT(DISTINCT q.id)::int AS actual_questions_count,
        COUNT(DISTINCT a.id) FILTER (WHERE a.status = 'submitted')::int AS submissions_count
      FROM course_level_exams e
      INNER JOIN courses c ON e.course_id = c.id
      LEFT JOIN course_level_exam_questions q ON q.exam_id = e.id
      LEFT JOIN course_level_exam_attempts a ON a.exam_id = e.id
      WHERE c.teacher_id = $1
    `;

    if (filters?.courseId) {
      params.push(filters.courseId);
      query += ` AND c.id = $${params.length}`;
    }

    query += `
      GROUP BY e.id, c.title, c.id
      ORDER BY e.created_at DESC
    `;

    const result = await pool.query(query, params);
    return result.rows.map((row) => this.serializeTeacherCourseExam(row));
  }

  private static serializeTeacherCourseExam(row: Record<string, unknown>) {
    return {
      id: row.id,
      title: row.title,
      courseId: row.course_id,
      courseTitle: row.course_title,
      courseName: row.course_title,
      durationMinutes: row.duration_minutes,
      questionsCount: row.questions_count,
      configuredQuestionsCount: row.questions_count,
      actualQuestionsCount: row.actual_questions_count,
      questionDisplayMode: row.question_display_mode || 'ordered',
      answersReleaseMode: row.answers_release_mode,
      availableFrom: row.available_from,
      showAnswersAfterHours: row.show_answers_after_hours,
      isVisibleToStudents: row.is_visible_to_students,
      visibilityEndDate: row.visibility_end_date,
      showAnswersImmediately: row.show_answers_immediately,
      answersVisibleAt: row.answers_visible_at,
      isActive: row.is_active,
      attemptLimit: row.attempt_limit,
      submissionsCount: row.submissions_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      examKind: 'course_level' as const,
    };
  }

  static async getExamById(examId: number, requester: RequestUser) {
    const examRes = await pool.query(
      `SELECT e.*, c.teacher_id, c.title as course_title 
       FROM course_level_exams e
       JOIN courses c ON e.course_id = c.id
       WHERE e.id = $1`,
      [examId],
    );

    if (!examRes.rowCount) {
      throw new HttpError(404, 'Exam not found');
    }

    const exam = examRes.rows[0];
    if (requester.role === 'teacher' && exam.teacher_id !== requester.id) {
      throw new HttpError(403, 'You are not allowed to view this exam');
    }

    return exam;
  }

  static async updateExam(
    examId: number,
    requester: RequestUser,
    input: UpdateCourseLevelExamInput,
  ) {
    // Verify exam exists and requester owns it
    const examRes = await pool.query(
      `SELECT e.*, c.teacher_id 
       FROM course_level_exams e
       JOIN courses c ON e.course_id = c.id
       WHERE e.id = $1`,
      [examId],
    );

    if (!examRes.rowCount) {
      throw new HttpError(404, 'Exam not found');
    }

    const exam = examRes.rows[0];
    if (requester.role === 'teacher' && exam.teacher_id !== requester.id) {
      throw new HttpError(403, 'You are not allowed to update this exam');
    }

    // Validate conditional fields
    const isVisibleToStudents =
      input.isVisibleToStudents !== undefined
        ? input.isVisibleToStudents
        : exam.is_visible_to_students;

    const showAnswersImmediately =
      input.showAnswersImmediately !== undefined
        ? input.showAnswersImmediately
        : exam.show_answers_immediately;
    const answersVisibleAt =
      input.answersVisibleAt !== undefined ? input.answersVisibleAt : exam.answers_visible_at;
    const answersReleaseMode = normalizeAnswersReleaseMode(
      input.answersReleaseMode ?? exam.answers_release_mode,
      inferAnswersReleaseMode({
        showAnswersImmediately,
        answersVisibleAt,
        showAnswersAfterHours: input.showAnswersAfterHours ?? exam.show_answers_after_hours,
      }),
    );

    if (answersReleaseMode === 'scheduled' && !answersVisibleAt) {
      throw new HttpError(400, 'answersVisibleAt is required when answers are scheduled');
    }

    // Validate positive numbers if provided
    if (input.durationMinutes !== undefined && input.durationMinutes <= 0) {
      throw new HttpError(400, 'durationMinutes must be greater than 0');
    }
    if (input.questionsCount !== undefined && input.questionsCount <= 0) {
      throw new HttpError(400, 'questionsCount must be greater than 0');
    }
    if (
      input.attemptLimit !== undefined &&
      input.attemptLimit !== null &&
      input.attemptLimit <= 0
    ) {
      throw new HttpError(400, 'attemptLimit must be greater than 0 if provided');
    }

    // Build update query dynamically
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (input.title !== undefined) {
      updates.push(`title = $${paramIndex++}`);
      values.push(input.title.trim());
    }
    if (input.durationMinutes !== undefined) {
      updates.push(`duration_minutes = $${paramIndex++}`);
      values.push(input.durationMinutes);
    }
    if (input.questionsCount !== undefined) {
      updates.push(`questions_count = $${paramIndex++}`);
      values.push(input.questionsCount);
    }
    if (input.isVisibleToStudents !== undefined) {
      updates.push(`is_visible_to_students = $${paramIndex++}`);
      values.push(input.isVisibleToStudents);
    }
    if (input.visibilityEndDate !== undefined) {
      updates.push(`visibility_end_date = $${paramIndex++}`);
      values.push(input.visibilityEndDate);
    }
    if (input.availableFrom !== undefined) {
      updates.push(`available_from = $${paramIndex++}`);
      values.push(input.availableFrom);
    }
    if (input.showAnswersImmediately !== undefined) {
      updates.push(`show_answers_immediately = $${paramIndex++}`);
      values.push(input.showAnswersImmediately);
    }
    if (input.answersVisibleAt !== undefined) {
      updates.push(`answers_visible_at = $${paramIndex++}`);
      values.push(input.answersVisibleAt);
    }
    if (input.answersReleaseMode !== undefined) {
      updates.push(`answers_release_mode = $${paramIndex++}`);
      values.push(normalizeAnswersReleaseMode(input.answersReleaseMode));
    }
    if (input.showAnswersAfterHours !== undefined) {
      updates.push(`show_answers_after_hours = $${paramIndex++}`);
      values.push(input.showAnswersAfterHours ?? 0);
    }
    if (input.questionDisplayMode !== undefined) {
      updates.push(`question_display_mode = $${paramIndex++}`);
      values.push(normalizeQuestionDisplayMode(input.questionDisplayMode));
    }
    if (input.isActive !== undefined) {
      updates.push(`is_active = $${paramIndex++}`);
      values.push(input.isActive);
    }
    if (input.attemptLimit !== undefined) {
      updates.push(`attempt_limit = $${paramIndex++}`);
      values.push(input.attemptLimit);
    }

    if (updates.length === 0) {
      // No updates provided, return current exam
      return exam;
    }

    // Always update updated_at
    updates.push(`updated_at = NOW()`);
    values.push(examId);

    const query = `UPDATE course_level_exams 
                   SET ${updates.join(', ')} 
                   WHERE id = $${paramIndex} 
                   RETURNING *`;

    const result = await pool.query(query, values);
    return result.rows[0];
  }

  static async deleteExam(examId: number, requester: RequestUser) {
    // Verify exam exists and requester owns it
    const examRes = await pool.query(
      `SELECT e.*, c.teacher_id 
       FROM course_level_exams e
       JOIN courses c ON e.course_id = c.id
       WHERE e.id = $1`,
      [examId],
    );

    if (!examRes.rowCount) {
      throw new HttpError(404, 'Exam not found');
    }

    const exam = examRes.rows[0];
    if (requester.role === 'teacher' && exam.teacher_id !== requester.id) {
      throw new HttpError(403, 'You are not allowed to delete this exam');
    }

    await pool.query('DELETE FROM course_level_exams WHERE id = $1', [examId]);
    return { message: 'Exam deleted successfully' };
  }

  // ========== Student Methods ==========

  /** Resolve attempt id from body or fall back to the student's active in_progress attempt. */
  static async resolveActiveAttemptId(
    examId: number,
    studentId: number,
    attemptId?: number | string | null,
  ): Promise<number> {
    const parsed = attemptId != null && String(attemptId).trim() !== '' ? Number(attemptId) : NaN;
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }

    const activeRes = await pool.query(
      `SELECT id FROM course_level_exam_attempts
       WHERE exam_id = $1 AND student_id = $2 AND status = 'in_progress'
       ORDER BY started_at DESC
       LIMIT 1`,
      [examId, studentId],
    );

    if (!activeRes.rowCount) {
      throw new HttpError(
        400,
        'attemptId is required, or start the exam first (POST /api/exams/:examId/start)',
      );
    }

    return Number(activeRes.rows[0].id);
  }

  /**
   * Get visible exams for a student in a course
   */
  static async getVisibleExamsForStudent(courseId: number, studentId: number) {
    // Verify student is enrolled in the course
    const enrollmentCheck = await pool.query(
      'SELECT id FROM enrollments WHERE course_id = $1 AND user_id = $2',
      [courseId, studentId],
    );

    if (!enrollmentCheck.rowCount) {
      throw new HttpError(403, 'You are not enrolled in this course');
    }

    // Get visible exams
    const now = new Date();
    const result = await pool.query(
      `SELECT e.*, c.title as course_title,
              (SELECT COUNT(*)::int FROM course_level_exam_questions q WHERE q.exam_id = e.id) AS actual_questions_count
       FROM course_level_exams e
       JOIN courses c ON e.course_id = c.id
       WHERE e.course_id = $1
         AND e.is_active = TRUE
         AND e.is_visible_to_students = TRUE
       ORDER BY e.created_at DESC`,
      [courseId],
    );

    const listed = result.rows.filter((exam) =>
      shouldListExamForStudent(courseLevelExamAvailabilityInput(exam), now),
    );

    // Get attempt counts for each exam
    const examsWithAttempts = await Promise.all(
      listed.map(async (exam) => {
        const attemptsRes = await pool.query(
          `SELECT
             COUNT(*) FILTER (WHERE status = 'submitted')::int AS attempts_count,
             MAX(attempt_number) FILTER (WHERE status = 'submitted') AS last_attempt_number,
             MAX(id) FILTER (WHERE status = 'in_progress') AS in_progress_attempt_id
           FROM course_level_exam_attempts
           WHERE exam_id = $1 AND student_id = $2`,
          [exam.id, studentId],
        );

        const attemptsCount = Number(attemptsRes.rows[0]?.attempts_count || 0);
        const lastAttemptNumber = Number(attemptsRes.rows[0]?.last_attempt_number || 0);
        const inProgressAttemptId = attemptsRes.rows[0]?.in_progress_attempt_id
          ? Number(attemptsRes.rows[0].in_progress_attempt_id)
          : null;
        const hasInProgressAttempt =
          inProgressAttemptId != null &&
          Number.isInteger(inProgressAttemptId) &&
          inProgressAttemptId > 0;
        const canAttemptNew =
          exam.attempt_limit === null || attemptsCount < exam.attempt_limit;

        const availability_status = getStudentExamAvailability(
          courseLevelExamAvailabilityInput(exam),
          now,
        );
        const canStart = canStudentStartExam(courseLevelExamAvailabilityInput(exam), now, {
          hasInProgressAttempt,
        });

        return {
          ...exam,
          configuredQuestionsCount: exam.questions_count,
          actualQuestionsCount: exam.actual_questions_count,
          availability_status,
          attempts_count: attemptsCount,
          last_attempt_number: lastAttemptNumber,
          has_in_progress_attempt: hasInProgressAttempt,
          in_progress_attempt_id: inProgressAttemptId,
          can_attempt: (hasInProgressAttempt || canAttemptNew) && canStart,
          attempts_remaining:
            exam.attempt_limit === null
              ? null
              : Math.max(0, exam.attempt_limit - attemptsCount),
        };
      }),
    );

    return examsWithAttempts;
  }

  /**
   * Start an exam attempt for a student
   */
  static async startExamAttempt(examId: number, studentId: number) {
    // Get exam with course info
    const examRes = await pool.query(
      `SELECT e.*, c.id as course_id, c.teacher_id
       FROM course_level_exams e
       JOIN courses c ON e.course_id = c.id
       WHERE e.id = $1`,
      [examId],
    );

    if (!examRes.rowCount) {
      throw new HttpError(404, 'Exam not found');
    }

    const exam = examRes.rows[0];

    // Verify student is enrolled
    const enrollmentCheck = await pool.query(
      'SELECT id FROM enrollments WHERE course_id = $1 AND user_id = $2',
      [exam.course_id, studentId],
    );

    if (!enrollmentCheck.rowCount) {
      throw new HttpError(403, 'You are not enrolled in this course');
    }

    // Check if exam is visible and active
    if (!exam.is_active) {
      throw new HttpError(403, 'This exam is not active');
    }

    if (!exam.is_visible_to_students) {
      throw new HttpError(403, 'This exam is not visible to students');
    }

    const actualCountRes = await pool.query(
      `SELECT COUNT(*)::int AS count FROM course_level_exam_questions WHERE exam_id = $1`,
      [examId],
    );
    exam.actual_questions_count = actualCountRes.rows[0]?.count || 0;

    const activeAttemptRes = await pool.query(
      `SELECT * FROM course_level_exam_attempts
       WHERE exam_id = $1 AND student_id = $2 AND status = 'in_progress'
       ORDER BY started_at DESC
       LIMIT 1`,
      [examId, studentId],
    );
    const hasInProgressAttempt = !!(activeAttemptRes.rowCount && activeAttemptRes.rowCount > 0);

    if (
      !canStudentStartExam(courseLevelExamAvailabilityInput(exam), new Date(), {
        hasInProgressAttempt,
      })
    ) {
      const status = getStudentExamAvailability(courseLevelExamAvailabilityInput(exam));
      if (status === 'expired') {
        throw new HttpError(403, 'This exam has ended. You can view it but cannot start a new attempt.');
      }
      if (status === 'upcoming') {
        throw new HttpError(403, 'This exam is not open yet');
      }
      if (status === 'incomplete') {
        throw new HttpError(403, 'This exam is not ready yet');
      }
      throw new HttpError(403, 'This exam is no longer available');
    }

    // Resume the open attempt without counting a new one.
    if (hasInProgressAttempt) {
      const attempt = activeAttemptRes.rows[0];
      const questions = await CourseLevelExamsService.loadSlicedCourseQuestions(
        exam,
        attempt,
        studentId,
      );
      return {
        attemptId: attempt.id,
        examId: exam.id,
        examTitle: exam.title,
        durationMinutes: exam.duration_minutes,
        questionsCount: questions.length,
        startedAt: attempt.started_at,
        resumed: true,
        questions,
      };
    }

    // Count only submitted attempts toward the limit.
    const attemptsRes = await pool.query(
      `SELECT COUNT(*) FILTER (WHERE status = 'submitted') as attempts_count,
              MAX(attempt_number) FILTER (WHERE status = 'submitted') as last_submitted_number,
              MAX(attempt_number) as last_attempt_number
       FROM course_level_exam_attempts
       WHERE exam_id = $1 AND student_id = $2`,
      [examId, studentId],
    );

    const attemptsCount = Number(attemptsRes.rows[0]?.attempts_count || 0);
    const hasCompletedAttempts = attemptsCount > 0;

    // If attempt limit is 1 and student has already completed, return previous result with wrong questions
    if (exam.attempt_limit === 1 && hasCompletedAttempts) {
      // Get the last submitted attempt
      const lastAttemptRes = await pool.query(
        `SELECT * FROM course_level_exam_attempts
         WHERE exam_id = $1 AND student_id = $2 AND status = 'submitted'
         ORDER BY submitted_at DESC
         LIMIT 1`,
        [examId, studentId],
      );

      if (lastAttemptRes.rowCount && lastAttemptRes.rowCount > 0) {
        const lastAttempt = lastAttemptRes.rows[0];

        const now = new Date();
        const release = this.buildAnswerReleaseContext(exam, lastAttempt, now);

        let wrongQuestions: any[] = [];
        if (release.showAnswers) {
          wrongQuestions = await this.fetchWrongQuestionsForAttempt(lastAttempt.id);
        }

        const error: any = new HttpError(
          403,
          'You have already completed this exam. Only one attempt is allowed.',
        );
        error.details = {
          previousAttempt: {
            attemptId: lastAttempt.id,
            totalGrade: lastAttempt.obtained_grade,
            maxGrade: lastAttempt.total_grade,
            submittedAt: lastAttempt.submitted_at,
            showAnswers: release.showAnswers,
            releaseReason: release.releaseReason,
            answersReleaseMode: release.answersReleaseMode,
            examEndAt: release.examEndAt,
            answersVisibleAt: release.answersVisibleAt,
            wrongQuestions,
          },
        };
        throw error;
      }
    }

    // Check if attempts limit reached
    if (exam.attempt_limit !== null && attemptsCount >= exam.attempt_limit) {
      throw new HttpError(403, 'You have used all allowed attempts for this exam');
    }

    // Create new attempt
    const nextAttemptNumber = Number(attemptsRes.rows[0]?.last_attempt_number || 0) + 1;
    const allQuestionsRes = await pool.query(
      `SELECT * FROM course_level_exam_questions
       WHERE exam_id = $1
       ORDER BY created_at ASC, id ASC`,
      [examId],
    );
    const selectedQuestionIds = selectAttemptQuestions(
      allQuestionsRes.rows.map((q) => q.id),
      exam.questions_count,
      exam.question_display_mode,
      attemptQuestionSeed(exam.id, studentId, nextAttemptNumber),
    );

    const attemptResult = await pool.query(
      `INSERT INTO course_level_exam_attempts (
        exam_id, student_id, attempt_number, status, started_at, selected_question_ids
      ) VALUES ($1, $2, $3, 'in_progress', NOW(), $4)
      RETURNING *`,
      [examId, studentId, nextAttemptNumber, selectedQuestionIds],
    );

    const attempt = attemptResult.rows[0];
    const questions = orderItemsByIds(allQuestionsRes.rows, selectedQuestionIds).map((q) =>
      CourseLevelExamsService.mapCourseQuestionForStudent(q),
    );

    return {
      attemptId: attempt.id,
      examId: exam.id,
      examTitle: exam.title,
      durationMinutes: exam.duration_minutes,
      questionsCount: questions.length,
      startedAt: attempt.started_at,
      questions,
    };
  }

  private static mapCourseQuestionForStudent(q: any) {
    return {
      id: q.id,
      type: q.type,
      questionText: q.question_text,
      questionImage: q.question_image,
      optionA: q.option_a,
      optionB: q.option_b,
      optionC: q.option_c,
      optionD: q.option_d,
    };
  }

  private static async loadSlicedCourseQuestions(exam: any, attempt: any, studentId: number) {
    const questionsRes = await pool.query(
      `SELECT * FROM course_level_exam_questions
       WHERE exam_id = $1
       ORDER BY created_at ASC, id ASC`,
      [exam.id],
    );
    const stored = parseSelectedQuestionIds(attempt?.selected_question_ids);
    const selectedIds =
      stored && stored.length
        ? stored
        : selectAttemptQuestions(
            questionsRes.rows.map((q) => q.id),
            exam.questions_count,
            exam.question_display_mode,
            attemptQuestionSeed(Number(exam.id), studentId, Number(attempt?.attempt_number || 1)),
          );
    return orderItemsByIds(questionsRes.rows, selectedIds).map((q) =>
      this.mapCourseQuestionForStudent(q),
    );
  }

  private static courseAnswerRelease(exam: any, attempt: any, now: Date) {
    return determineAnswerRelease(
      {
        answersReleaseMode: exam.answers_release_mode,
        showAnswersImmediately: !!exam.show_answers_immediately,
        answersVisibleAt: exam.answers_visible_at,
        answersReleaseDate: exam.answers_visible_at,
        showAnswersAfterHours: exam.show_answers_after_hours ?? 0,
        examExpireAt: exam.visibility_end_date,
      },
      attempt
        ? {
            status: attempt.status,
            submittedAt: attempt.submitted_at,
          }
        : null,
      now,
    );
  }

  private static buildAnswerReleaseContext(exam: any, attempt: any, now: Date) {
    const decision = this.courseAnswerRelease(exam, attempt, now);
    const answersReleaseMode =
      exam.answers_release_mode ||
      inferAnswersReleaseMode({
        showAnswersImmediately: exam.show_answers_immediately,
        answersVisibleAt: exam.answers_visible_at,
        showAnswersAfterHours: exam.show_answers_after_hours,
      });

    return {
      showAnswers: decision.release,
      releaseReason: decision.release ? decision.reason : null,
      answersReleaseMode,
      examEndAt: exam.visibility_end_date,
      answersVisibleAt: exam.answers_visible_at,
      showAnswersAfterHours: exam.show_answers_after_hours ?? 0,
    };
  }

  private static pendingReleaseMessage(release: ReturnType<typeof CourseLevelExamsService.buildAnswerReleaseContext>) {
    if (release.answersReleaseMode === 'after_end') {
      return release.examEndAt
        ? 'Answers will be available after the exam ends'
        : 'Answers will be available after the exam end date is set';
    }
    if (release.answersReleaseMode === 'after_hours' && release.showAnswersAfterHours > 0) {
      return `Answers will be available ${release.showAnswersAfterHours} hour(s) after submission`;
    }
    if (release.answersReleaseMode === 'scheduled' && release.answersVisibleAt) {
      return 'Answers will be available after the scheduled time';
    }
    return 'Answers are not available yet';
  }

  private static async fetchWrongQuestionsForAttempt(attemptId: number) {
    const wrongAnswersRes = await pool.query(
      `SELECT a.*, q.*
       FROM course_level_exam_answers a
       JOIN course_level_exam_questions q ON a.question_id = q.id
       WHERE a.attempt_id = $1 AND a.is_correct = FALSE
       ORDER BY q.created_at ASC`,
      [attemptId],
    );

    return wrongAnswersRes.rows.map((row) => ({
      questionId: row.question_id,
      questionText: row.question_text,
      questionImage: row.question_image,
      type: row.type,
      correctAnswer: row.correct_answer,
      yourAnswer: row.selected_answer,
      optionA: row.option_a,
      optionB: row.option_b,
      optionC: row.option_c,
      optionD: row.option_d,
    }));
  }

  private static mapAttemptSummary(attempt: any) {
    const maxGrade = Number(attempt.total_grade ?? 0);
    const obtainedGrade = Number(attempt.obtained_grade ?? 0);
    return {
      attemptId: attempt.id,
      attemptNumber: attempt.attempt_number,
      totalGrade: obtainedGrade,
      maxGrade,
      correctCount: obtainedGrade,
      wrongCount: Math.max(0, maxGrade - obtainedGrade),
      startedAt: attempt.started_at,
      submittedAt: attempt.submitted_at,
    };
  }

  /**
   * Student attempt report: grades always, wrong questions only when release policy allows.
   */
  static async getStudentAttemptReport(
    examId: number,
    studentId: number,
    options?: { attemptId?: number },
  ) {
    const examRes = await pool.query(
      `SELECT e.*, c.id as course_id, c.title as course_title
       FROM course_level_exams e
       JOIN courses c ON e.course_id = c.id
       WHERE e.id = $1`,
      [examId],
    );

    if (!examRes.rowCount) {
      throw new HttpError(404, 'Exam not found');
    }

    const exam = examRes.rows[0];

    const enrollmentCheck = await pool.query(
      'SELECT id FROM enrollments WHERE course_id = $1 AND user_id = $2',
      [exam.course_id, studentId],
    );

    if (!enrollmentCheck.rowCount) {
      throw new HttpError(403, 'You are not enrolled in this course');
    }

    const attemptQuery = options?.attemptId
      ? await pool.query(
          `SELECT * FROM course_level_exam_attempts
           WHERE id = $1 AND exam_id = $2 AND student_id = $3 AND status = 'submitted'`,
          [options.attemptId, examId, studentId],
        )
      : await pool.query(
          `SELECT * FROM course_level_exam_attempts
           WHERE exam_id = $1 AND student_id = $2 AND status = 'submitted'
           ORDER BY submitted_at DESC
           LIMIT 1`,
          [examId, studentId],
        );

    if (!attemptQuery.rowCount) {
      throw new HttpError(404, 'No completed attempt found for this exam');
    }

    const attempt = attemptQuery.rows[0];
    const now = new Date();
    const release = this.buildAnswerReleaseContext(exam, attempt, now);
    const attemptSummary = this.mapAttemptSummary(attempt);

    if (!release.showAnswers) {
      return {
        examType: 'course' as const,
        exam: {
          id: exam.id,
          title: exam.title,
          courseId: exam.course_id,
          courseTitle: exam.course_title,
        },
        showAnswers: false,
        releaseReason: null,
        answersReleaseMode: release.answersReleaseMode,
        examEndAt: release.examEndAt,
        answersVisibleAt: release.answersVisibleAt,
        showAnswersAfterHours: release.showAnswersAfterHours,
        message: this.pendingReleaseMessage(release),
        attempt: attemptSummary,
        wrongQuestions: [],
      };
    }

    const wrongQuestions = await this.fetchWrongQuestionsForAttempt(attempt.id);

    return {
      examType: 'course' as const,
      exam: {
        id: exam.id,
        title: exam.title,
        courseId: exam.course_id,
        courseTitle: exam.course_title,
      },
      showAnswers: true,
      releaseReason: release.releaseReason,
      answersReleaseMode: release.answersReleaseMode,
      examEndAt: release.examEndAt,
      answersVisibleAt: release.answersVisibleAt,
      showAnswersAfterHours: release.showAnswersAfterHours,
      attempt: attemptSummary,
      wrongQuestions,
    };
  }

  /**
   * Submit an exam attempt
   */
  static async submitExamAttempt(
    examId: number,
    studentId: number,
    attemptId: number,
    answers: { questionId: number; selectedAnswer: 'A' | 'B' | 'C' | 'D' }[],
  ) {
    // Get attempt
    const attemptRes = await pool.query(
      `SELECT a.*, e.*, c.id as course_id
       FROM course_level_exam_attempts a
       JOIN course_level_exams e ON a.exam_id = e.id
       JOIN courses c ON e.course_id = c.id
       WHERE a.id = $1 AND a.exam_id = $2 AND a.student_id = $3`,
      [attemptId, examId, studentId],
    );

    if (!attemptRes.rowCount) {
      throw new HttpError(404, 'Attempt not found');
    }

    const attempt = attemptRes.rows[0];
    const exam = attemptRes.rows[0];

    if (attempt.status !== 'in_progress') {
      throw new HttpError(400, 'This attempt has already been submitted');
    }

    // Verify student is enrolled
    const enrollmentCheck = await pool.query(
      'SELECT id FROM enrollments WHERE course_id = $1 AND user_id = $2',
      [exam.course_id, studentId],
    );

    if (!enrollmentCheck.rowCount) {
      throw new HttpError(403, 'You are not enrolled in this course');
    }

    // Get all questions with correct answers
    const allQuestionsRes = await pool.query(
      `SELECT * FROM course_level_exam_questions
       WHERE exam_id = $1
       ORDER BY created_at ASC, id ASC`,
      [examId],
    );
    const storedIds = parseSelectedQuestionIds(attempt.selected_question_ids);
    const selectedIds =
      storedIds && storedIds.length
        ? storedIds
        : selectAttemptQuestions(
            allQuestionsRes.rows.map((q) => q.id),
            exam.questions_count,
            exam.question_display_mode,
            attemptQuestionSeed(examId, studentId, Number(attempt.attempt_number || 1)),
          );
    const questions = orderItemsByIds(allQuestionsRes.rows, selectedIds);
    let totalGrade = 0;
    let correctCount = 0;

    // Calculate grades
    const answerResults = answers
      .map((answer) => {
        const question = questions.find((q) => q.id === answer.questionId);
        if (!question) {
          return null;
        }

        const isCorrect = question.correct_answer === answer.selectedAnswer;
        if (isCorrect) {
          correctCount++;
          totalGrade++;
        }

        return {
          questionId: question.id,
          selectedAnswer: answer.selectedAnswer,
          correctAnswer: question.correct_answer,
          isCorrect,
        };
      })
      .filter((r) => r !== null);

    // Save answers
    for (const answer of answers) {
      const question = questions.find((q) => q.id === answer.questionId);
      if (question) {
        const isCorrect = question.correct_answer === answer.selectedAnswer;
        await pool.query(
          `INSERT INTO course_level_exam_answers (
            attempt_id, question_id, selected_answer, is_correct
          ) VALUES ($1, $2, $3, $4)`,
          [attemptId, answer.questionId, answer.selectedAnswer, isCorrect],
        );
      }
    }

    // Update attempt
    await pool.query(
      `UPDATE course_level_exam_attempts
       SET status = 'submitted',
           submitted_at = NOW(),
           total_grade = $1,
           obtained_grade = $2
       WHERE id = $3`,
      [questions.length, totalGrade, attemptId],
    );

    // Check if answers should be shown
    const now = new Date();
    const releaseDecision = this.courseAnswerRelease(exam, { ...attempt, submitted_at: now }, now);
    const showAnswers = releaseDecision.release;
    const releaseReason = releaseDecision.release ? releaseDecision.reason : '';

    // Get wrong questions if answers should be shown
    let wrongQuestions: any[] = [];
    if (showAnswers) {
      wrongQuestions = answerResults
        .filter((r) => r && !r.isCorrect)
        .map((r) => {
          const question = questions.find((q) => q.id === r!.questionId);
          return {
            questionId: question!.id,
            questionText: question!.question_text,
            questionImage: question!.question_image,
            type: question!.type,
            correctAnswer: question!.correct_answer,
            yourAnswer: r!.selectedAnswer,
            optionA: question!.option_a,
            optionB: question!.option_b,
            optionC: question!.option_c,
            optionD: question!.option_d,
          };
        });
    }

    const submittedAtRes = await pool.query(
      `SELECT started_at, submitted_at FROM course_level_exam_attempts WHERE id = $1`,
      [attemptId],
    );
    const row = submittedAtRes.rows[0] || {};
    return {
      attemptId,
      totalGrade,
      maxGrade: questions.length,
      correctCount,
      wrongCount: questions.length - correctCount,
      showAnswers,
      releaseReason,
      answersVisibleAt: exam.answers_visible_at,
      wrongQuestions: showAnswers ? wrongQuestions : [],
      startedAt: row.started_at ?? attempt.started_at,
      submittedAt: row.submitted_at ?? new Date().toISOString(),
    };
  }

  /**
   * Get wrong questions for a student after answers release date
   */
  static async getWrongQuestions(examId: number, studentId: number) {
    const report = await this.getStudentAttemptReport(examId, studentId);

    if (!report.showAnswers) {
      return {
        showAnswers: false,
        releaseReason: null,
        answersReleaseMode: report.answersReleaseMode,
        examEndAt: report.examEndAt,
        answersVisibleAt: report.answersVisibleAt,
        message: report.message,
        attemptId: report.attempt.attemptId,
        totalGrade: report.attempt.totalGrade,
        maxGrade: report.attempt.maxGrade,
        submittedAt: report.attempt.submittedAt,
        wrongQuestions: [],
      };
    }

    return {
      showAnswers: true,
      releaseReason: report.releaseReason,
      answersReleaseMode: report.answersReleaseMode,
      examEndAt: report.examEndAt,
      answersVisibleAt: report.answersVisibleAt,
      attemptId: report.attempt.attemptId,
      totalGrade: report.attempt.totalGrade,
      maxGrade: report.attempt.maxGrade,
      submittedAt: report.attempt.submittedAt,
      wrongQuestions: report.wrongQuestions,
    };
  }

  /**
   * تقرير امتحان الكورس للطالب: آخر محاولة مُسلَّمة مع كل الأسئلة وإجابته والإجابة الصحيحة
   */
  static async getMyCourseReport(examId: number, studentId: number) {
    const examRes = await pool.query(
      `SELECT e.*, c.id as course_id
       FROM course_level_exams e
       JOIN courses c ON e.course_id = c.id
       WHERE e.id = $1`,
      [examId],
    );

    if (!examRes.rowCount) {
      throw new HttpError(404, 'Exam not found');
    }

    const exam = examRes.rows[0];

    const enrollmentCheck = await pool.query(
      'SELECT id FROM enrollments WHERE course_id = $1 AND user_id = $2',
      [exam.course_id, studentId],
    );

    if (!enrollmentCheck.rowCount) {
      throw new HttpError(403, 'You are not enrolled in this course');
    }

    const attemptRes = await pool.query(
      `SELECT * FROM course_level_exam_attempts
       WHERE exam_id = $1 AND student_id = $2 AND status = 'submitted'
       ORDER BY submitted_at DESC
       LIMIT 1`,
      [examId, studentId],
    );

    if (!attemptRes.rowCount) {
      throw new HttpError(404, 'لا توجد محاولة مُسلَّمة لهذا الامتحان');
    }

    const attempt = attemptRes.rows[0];
    const now = new Date();
    const release = this.buildAnswerReleaseContext(exam, attempt, now);

    if (!release.showAnswers) {
      throw new HttpError(
        403,
        this.pendingReleaseMessage(release),
      );
    }

    const allAnswersRes = await pool.query(
      `SELECT a.question_id, a.selected_answer, a.is_correct,
              q.question_text, q.question_image, q.type,
              q.option_a, q.option_b, q.option_c, q.option_d, q.correct_answer
       FROM course_level_exam_answers a
       JOIN course_level_exam_questions q ON a.question_id = q.id
       WHERE a.attempt_id = $1
       ORDER BY q.created_at ASC`,
      [attempt.id],
    );

    const questions = allAnswersRes.rows.map((row) => ({
      questionId: row.question_id,
      questionText: row.question_text,
      questionImage: row.question_image,
      type: row.type,
      optionA: row.option_a,
      optionB: row.option_b,
      optionC: row.option_c,
      optionD: row.option_d,
      yourAnswer: row.selected_answer || null,
      correctAnswer: row.correct_answer || null,
      isCorrect: !!row.is_correct,
    }));

    return {
      examType: 'course' as const,
      exam: {
        id: exam.id,
        title: exam.title,
        totalGrade: attempt.total_grade ?? 0,
      },
      attempt: {
        attemptId: attempt.id,
        totalGrade: attempt.total_grade ?? 0,
        obtainedGrade: attempt.obtained_grade ?? 0,
        submittedAt: attempt.submitted_at,
        passed: (attempt.obtained_grade ?? 0) >= Math.ceil((attempt.total_grade ?? 0) / 2),
      },
      questions,
    };
  }

  /**
   * Get all students' grades for an exam (teacher only)
   */
  static async getExamGrades(examId: number, requester: RequestUser) {
    // Verify exam exists and teacher owns it
    const examRes = await pool.query(
      `SELECT e.id, e.title, e.course_id, c.teacher_id, c.title as course_title
       FROM course_level_exams e
       JOIN courses c ON e.course_id = c.id
       WHERE e.id = $1`,
      [examId],
    );

    if (!examRes.rowCount) {
      throw new HttpError(404, 'Exam not found');
    }

    const exam = examRes.rows[0];

    // Verify teacher owns the course
    if (requester.role === 'teacher' && exam.teacher_id !== requester.id) {
      throw new HttpError(403, 'You are not allowed to view grades for this exam');
    }

    // Get all submitted attempts with student info
    const attemptsRes = await pool.query(
      `SELECT 
         a.id as attempt_id,
         a.student_id,
         a.attempt_number,
         a.status,
         a.total_grade,
         a.obtained_grade,
         a.started_at,
         a.submitted_at,
         u.name as student_name,
         u.email as student_email
       FROM course_level_exam_attempts a
       JOIN users u ON a.student_id = u.id
       WHERE a.exam_id = $1 AND a.status = 'submitted'
       ORDER BY a.submitted_at DESC`,
      [examId],
    );

    const attempts = attemptsRes.rows;

    // Calculate statistics
    const totalStudents = attempts.length;
    const totalGrade = attempts.reduce((sum, a) => sum + (a.total_grade || 0), 0);
    const totalObtained = attempts.reduce((sum, a) => sum + (a.obtained_grade || 0), 0);
    const averageGrade = totalStudents > 0 ? (totalObtained / totalGrade) * 100 : 0;
    const maxGrade =
      attempts.length > 0 ? Math.max(...attempts.map((a) => a.obtained_grade || 0)) : 0;
    const minGrade =
      attempts.length > 0 ? Math.min(...attempts.map((a) => a.obtained_grade || 0)) : 0;

    return {
      exam: {
        id: exam.id,
        title: exam.title,
        courseId: exam.course_id,
        courseTitle: exam.course_title,
      },
      students: attempts.map((a) => ({
        studentId: a.student_id,
        studentName: a.student_name,
        studentEmail: a.student_email,
        attemptId: a.attempt_id,
        attemptNumber: a.attempt_number,
        totalGrade: a.total_grade,
        obtainedGrade: a.obtained_grade,
        percentage:
          a.total_grade > 0 ? Math.round((a.obtained_grade / a.total_grade) * 100 * 100) / 100 : 0,
        startedAt: a.started_at,
        submittedAt: a.submitted_at,
      })),
      statistics: {
        totalStudents,
        averageGrade: Math.round(averageGrade * 100) / 100,
        maxGrade,
        minGrade,
        totalGrade,
        totalObtainedGrade: totalObtained,
      },
    };
  }

  /**
   * تقرير الامتحان الشامل للمدرس: لكل سؤال كام صح / كام غلط ومين اللي غلط.
   * يعتمد آخر محاولة مسلَّمة لكل طالب.
   */
  private static pct(count: number, total: number): number {
    if (total <= 0) return 0;
    return Math.round((count / total) * 100 * 100) / 100;
  }

  private static isAttemptPassed(
    obtained: number | null | undefined,
    total: number | null | undefined,
    passPercentage: number,
  ): boolean {
    const max = Number(total ?? 0);
    const score = Number(obtained ?? 0);
    if (max <= 0) return false;
    return (score / max) * 100 >= passPercentage;
  }

  static async getExamReport(
    examId: number,
    requester: RequestUser,
    options?: { passPercentage?: number },
  ) {
    const examRes = await pool.query(
      `SELECT e.id, e.title, e.course_id, e.questions_count, c.teacher_id, c.title as course_title
       FROM course_level_exams e
       JOIN courses c ON e.course_id = c.id
       WHERE e.id = $1`,
      [examId],
    );

    if (!examRes.rowCount) {
      throw new HttpError(404, 'Exam not found');
    }

    const exam = examRes.rows[0];
    await CourseAccessControl.assertCanManageCourse(requester, Number(exam.course_id));

    const passPercentage =
      options?.passPercentage != null &&
      Number.isFinite(options.passPercentage) &&
      options.passPercentage >= 0 &&
      options.passPercentage <= 100
        ? options.passPercentage
        : 50;

    const enrolledRes = await pool.query(
      `SELECT u.id as student_id, u.name as student_name, u.email as student_email
       FROM enrollments e
       JOIN users u ON u.id = e.user_id
       WHERE e.course_id = $1 AND u.role = 'student'
       ORDER BY u.name ASC`,
      [exam.course_id],
    );
    const enrolledStudents = enrolledRes.rows;
    const enrolledTotal = enrolledStudents.length;

    const attemptStatusRes = await pool.query(
      `SELECT DISTINCT ON (a.student_id)
         a.student_id,
         a.status,
         a.obtained_grade,
         a.total_grade
       FROM course_level_exam_attempts a
       WHERE a.exam_id = $1
       ORDER BY a.student_id,
         CASE WHEN a.status = 'submitted' THEN 0 ELSE 1 END,
         a.submitted_at DESC NULLS LAST,
         a.id DESC`,
      [examId],
    );
    const attemptByStudent = new Map(
      attemptStatusRes.rows.map((row) => [Number(row.student_id), row]),
    );

    const submittedAttemptsRes = await pool.query(
      `SELECT DISTINCT ON (a.student_id)
         a.student_id,
         a.obtained_grade,
         a.total_grade
       FROM course_level_exam_attempts a
       WHERE a.exam_id = $1 AND a.status = 'submitted'
       ORDER BY a.student_id, a.submitted_at DESC NULLS LAST, a.id DESC`,
      [examId],
    );
    const submittedByStudent = new Map(
      submittedAttemptsRes.rows.map((row) => [Number(row.student_id), row]),
    );

    let examinedCount = 0;
    let startedNotSubmittedCount = 0;
    let passedCount = 0;
    let failedCount = 0;
    const notExaminedStudents: {
      studentId: number;
      studentName: string;
      studentEmail: string;
      examStatus: 'never_started' | 'in_progress';
    }[] = [];

    for (const student of enrolledStudents) {
      const studentId = Number(student.student_id);
      const latestAttempt = attemptByStudent.get(studentId);
      const submittedAttempt = submittedByStudent.get(studentId);

      if (submittedAttempt) {
        examinedCount++;
        if (
          this.isAttemptPassed(
            submittedAttempt.obtained_grade,
            submittedAttempt.total_grade,
            passPercentage,
          )
        ) {
          passedCount++;
        } else {
          failedCount++;
        }
        continue;
      }

      if (latestAttempt?.status === 'in_progress') {
        startedNotSubmittedCount++;
        notExaminedStudents.push({
          studentId,
          studentName: student.student_name,
          studentEmail: student.student_email,
          examStatus: 'in_progress',
        });
      } else {
        notExaminedStudents.push({
          studentId,
          studentName: student.student_name,
          studentEmail: student.student_email,
          examStatus: 'never_started',
        });
      }
    }

    const notExaminedCount = enrolledTotal - examinedCount;
    const enrollmentSummary = {
      passPercentage,
      enrolledTotal,
      examined: {
        count: examinedCount,
        percentage: this.pct(examinedCount, enrolledTotal),
      },
      notExamined: {
        count: notExaminedCount,
        percentage: this.pct(notExaminedCount, enrolledTotal),
      },
      startedNotSubmitted: {
        count: startedNotSubmittedCount,
        percentage: this.pct(startedNotSubmittedCount, enrolledTotal),
      },
      passed: {
        count: passedCount,
        percentage: this.pct(passedCount, enrolledTotal),
        percentageOfExamined: this.pct(passedCount, examinedCount),
      },
      failed: {
        count: failedCount,
        percentage: this.pct(failedCount, enrolledTotal),
        percentageOfExamined: this.pct(failedCount, examinedCount),
      },
    };

    const questionsRes = await pool.query(
      `SELECT id, type, question_text, question_image, option_a, option_b, option_c, option_d, correct_answer
       FROM course_level_exam_questions
       WHERE exam_id = $1
       ORDER BY id ASC`,
      [examId],
    );
    const questions = questionsRes.rows;

    const attemptsRes = await pool.query(
      `SELECT DISTINCT ON (a.student_id)
         a.id,
         a.student_id,
         u.name as student_name,
         u.email as student_email
       FROM course_level_exam_attempts a
       JOIN users u ON a.student_id = u.id
       WHERE a.exam_id = $1 AND a.status = 'submitted'
       ORDER BY a.student_id, a.submitted_at DESC NULLS LAST, a.id DESC`,
      [examId],
    );
    const attempts = attemptsRes.rows;
    const totalAttempts = attempts.length;
    const attemptIds = attempts.map((a) => Number(a.id));

    const answersRes =
      attemptIds.length === 0
        ? { rows: [] as any[] }
        : await pool.query(
            `SELECT
               a.attempt_id,
               a.question_id,
               a.selected_answer,
               a.is_correct,
               att.student_id,
               u.name as student_name,
               u.email as student_email
             FROM course_level_exam_answers a
             JOIN course_level_exam_attempts att ON a.attempt_id = att.id
             JOIN users u ON att.student_id = u.id
             WHERE a.attempt_id = ANY($1::int[])
             ORDER BY a.question_id ASC`,
            [attemptIds],
          );
    const answers = answersRes.rows;

    const optionText = (question: any, letter: string | null) => {
      if (!letter) return null;
      const key = String(letter).trim().toUpperCase();
      if (key === 'A') return question.option_a ?? null;
      if (key === 'B') return question.option_b ?? null;
      if (key === 'C') return question.option_c ?? null;
      if (key === 'D') return question.option_d ?? null;
      return null;
    };

    const mapStudent = (a: any, question: any) => {
      const selected = a.selected_answer ? String(a.selected_answer).trim().toUpperCase() : null;
      return {
        studentId: a.student_id,
        studentName: a.student_name,
        studentEmail: a.student_email,
        selectedAnswer: selected,
        selectedAnswerText: optionText(question, selected),
      };
    };

    const questionsWithStats = questions.map((question) => {
      const questionAnswers = answers.filter((a) => a.question_id === question.id);
      const answeredStudentIds = new Set(questionAnswers.map((a) => Number(a.student_id)));
      const correctAnswers = questionAnswers.filter((a) => a.is_correct);
      const wrongAnswers = questionAnswers.filter((a) => !a.is_correct);
      const unansweredStudents = attempts
        .filter((att) => !answeredStudentIds.has(Number(att.student_id)))
        .map((att) => ({
          studentId: att.student_id,
          studentName: att.student_name,
          studentEmail: att.student_email,
          selectedAnswer: null,
          selectedAnswerText: null,
        }));

      const correctCount = correctAnswers.length;
      const wrongCount = wrongAnswers.length + unansweredStudents.length;
      const answeredCount = questionAnswers.length;
      const totalStudents = totalAttempts;

      const answerCounts = {
        A: questionAnswers.filter((a) => a.selected_answer === 'A').length,
        B: questionAnswers.filter((a) => a.selected_answer === 'B').length,
        C: questionAnswers.filter((a) => a.selected_answer === 'C').length,
        D: questionAnswers.filter((a) => a.selected_answer === 'D').length,
      };

      const correctAnswer = question.correct_answer
        ? String(question.correct_answer).trim().toUpperCase()
        : null;

      return {
        questionId: question.id,
        type: question.type,
        questionText: question.question_text,
        questionImage: question.question_image,
        optionA: question.option_a,
        optionB: question.option_b,
        optionC: question.option_c,
        optionD: question.option_d,
        correctAnswer,
        correctAnswerText: optionText(question, correctAnswer),
        correctCount,
        wrongCount,
        unansweredCount: unansweredStudents.length,
        statistics: {
          totalStudents,
          totalAnswers: answeredCount,
          correctAnswers: correctCount,
          wrongAnswers: wrongCount,
          unanswered: unansweredStudents.length,
          correctPercentage:
            totalStudents > 0 ? Math.round((correctCount / totalStudents) * 100 * 100) / 100 : 0,
          wrongPercentage:
            totalStudents > 0 ? Math.round((wrongCount / totalStudents) * 100 * 100) / 100 : 0,
          answerDistribution: answerCounts,
        },
        correctStudents: correctAnswers.map((a) => mapStudent(a, question)),
        wrongStudents: [
          ...wrongAnswers.map((a) => mapStudent(a, question)),
          ...unansweredStudents,
        ],
        unansweredStudents,
      };
    });

    const sortedQuestions = [...questionsWithStats].sort((a, b) => b.wrongCount - a.wrongCount);

    const totalQuestions = questions.length;
    const totalAnswers = answers.length;
    const totalCorrect = answers.filter((a) => a.is_correct).length;
    const totalWrong = answers.filter((a) => !a.is_correct).length;
    const overallCorrectPercentage =
      totalAnswers > 0 ? Math.round((totalCorrect / totalAnswers) * 100 * 100) / 100 : 0;

    const mostProblematicQuestions = sortedQuestions
      .filter((q) => q.wrongCount > 0)
      .slice(0, 5)
      .map((q) => ({
        questionId: q.questionId,
        questionText: q.questionText || 'Image Question',
        wrongAnswers: q.wrongCount,
        wrongPercentage: q.statistics.wrongPercentage,
      }));

    return {
      exam: {
        id: exam.id,
        title: exam.title,
        courseId: exam.course_id,
        courseTitle: exam.course_title,
        questionsCount: exam.questions_count,
      },
      enrollmentSummary,
      notExaminedStudents,
      overallStatistics: {
        totalStudents: totalAttempts,
        enrolledTotal,
        totalQuestions,
        totalAnswers,
        totalCorrect,
        totalWrong,
        overallCorrectPercentage,
        overallWrongPercentage: Math.round((100 - overallCorrectPercentage) * 100) / 100,
      },
      questions: questionsWithStats,
      sortedQuestions,
      mostProblematicQuestions,
    };
  }

  /**
   * Verify that all question IDs exist in the question bank (V2 or legacy V1).
   */
  private static courseExamBankLinkColumns: { question_id: boolean; question_id_v2: boolean } | null =
    null;

  private static async getCourseExamBankLinkColumns(): Promise<{
    question_id: boolean;
    question_id_v2: boolean;
  }> {
    if (this.courseExamBankLinkColumns) return this.courseExamBankLinkColumns;

    const res = await pool.query<{ column_name: string }>(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'course_level_exam_questions'
         AND column_name IN ('question_id', 'question_id_v2')`,
    );
    const cols = new Set(res.rows.map((row) => row.column_name));
    this.courseExamBankLinkColumns = {
      question_id: cols.has('question_id'),
      question_id_v2: cols.has('question_id_v2'),
    };
    return this.courseExamBankLinkColumns;
  }

  /** Ensures migration 1700000007004 columns exist (idempotent). */
  private static async ensureCourseExamBankLinkColumns(): Promise<{
    question_id: boolean;
    question_id_v2: boolean;
  }> {
    let cols = await this.getCourseExamBankLinkColumns();
    if (cols.question_id && cols.question_id_v2) return cols;

    if (!cols.question_id_v2) {
      await pool.query(`
        ALTER TABLE course_level_exam_questions
        ADD COLUMN IF NOT EXISTS question_id_v2 INTEGER NULL REFERENCES questions_v2(id) ON DELETE SET NULL
      `);
    }

    if (!cols.question_id) {
      const legacyTable = await pool.query(
        `SELECT 1
         FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'questions'
         LIMIT 1`,
      );
      if ((legacyTable.rowCount ?? 0) > 0) {
        await pool.query(`
          ALTER TABLE course_level_exam_questions
          ADD COLUMN IF NOT EXISTS question_id INTEGER NULL REFERENCES questions(id) ON DELETE SET NULL
        `);
      }
    }

    this.courseExamBankLinkColumns = null;
    return this.getCourseExamBankLinkColumns();
  }

  static async validateQuestionIdsInBank(
    questionIds: number[],
  ): Promise<{ missing: number[] }> {
    if (!questionIds?.length) {
      return { missing: [] };
    }

    const uniqueIds = [...new Set(questionIds)];

    const v2Res = await pool.query(
      `SELECT id FROM questions_v2 WHERE id = ANY($1::int[])`,
      [uniqueIds],
    );
    const found = new Set(v2Res.rows.map((row: { id: number }) => row.id));

    const notInV2 = uniqueIds.filter((id) => !found.has(id));
    if (notInV2.length > 0) {
      const v1Res = await pool.query(
        `SELECT id FROM questions WHERE id = ANY($1::int[])`,
        [notInV2],
      );
      for (const row of v1Res.rows as { id: number }[]) {
        found.add(row.id);
      }
    }

    return { missing: uniqueIds.filter((id) => !found.has(id)) };
  }

  /**
   * Add questions from question bank to course-level exam
   */
  static async addQuestionsFromBank(requester: RequestUser, examId: number, questionIds: number[]) {
    console.log(
      `[addQuestionsFromBank] Called with examId=${examId}, questionIds=${JSON.stringify(questionIds)}, teacherId=${requester.id}`,
    );

    try {
      // Verify exam ownership
      console.log(`[addQuestionsFromBank] Verifying exam ownership for exam ${examId}...`);
      await this.verifyExamOwnership(examId, requester.id);
      console.log(`[addQuestionsFromBank] Exam ownership verified successfully`);
    } catch (error: any) {
      console.error(`[addQuestionsFromBank] Error verifying exam ownership:`, {
        error: error?.message,
        status: error?.status,
        stack: error?.stack,
        examId,
        teacherId: requester.id,
      });
      // Re-throw HTTP errors as-is
      if (error?.status) {
        throw error;
      }
      // Wrap other errors
      throw new HttpError(
        500,
        `Failed to verify exam ownership: ${error?.message || 'Unknown error'}`,
      );
    }

    if (!questionIds || questionIds.length === 0) {
      return 0;
    }

    try {
      const bankCols = await this.ensureCourseExamBankLinkColumns();

      // Filter unique IDs from input
      const inputIds = [...new Set(questionIds)];

      // Get existing questions in this exam to prevent duplicates
      const selectParts: string[] = [];
      if (bankCols.question_id) selectParts.push('question_id');
      if (bankCols.question_id_v2) selectParts.push('question_id_v2');

      const existingV1Ids = new Set<number>();
      const existingV2Ids = new Set<number>();
      if (selectParts.length > 0) {
        const existingQsRes = await pool.query(
          `SELECT ${selectParts.join(', ')} FROM course_level_exam_questions WHERE exam_id = $1`,
          [examId],
        );
        if (bankCols.question_id) {
          for (const row of existingQsRes.rows as { question_id?: number | null }[]) {
            if (row.question_id != null) existingV1Ids.add(row.question_id);
          }
        }
        if (bankCols.question_id_v2) {
          for (const row of existingQsRes.rows as { question_id_v2?: number | null }[]) {
            if (row.question_id_v2 != null) existingV2Ids.add(row.question_id_v2);
          }
        }
      }

      // Determine which IDs to actually process
      const uniqueIds = inputIds.filter((id) => !existingV1Ids.has(id) && !existingV2Ids.has(id));

      if (uniqueIds.length === 0) {
        return { addedCount: 0, addedQuestions: [] };
      }

      let addedCount = 0;
      const addedQuestions: any[] = [];

      console.log(`[addQuestionsFromBank] Processing questions to add to exam ${examId}`, {
        examId,
        questionIds: uniqueIds,
        teacherId: requester.id,
      });

      // 1. Try to fetch and insert from V2 (New Question Bank) first
      let v2Questions;
      try {
        v2Questions = await pool.query(
          `SELECT q.id, q.question_text, q.correct_answer_index, qm.media_url
           FROM questions_v2 q
           LEFT JOIN question_media qm ON q.id = qm.question_id
           WHERE q.id = ANY($1::int[])`,
          [uniqueIds],
        );
      } catch (queryError: any) {
        console.error(`[addQuestionsFromBank] Error fetching V2 questions:`, queryError.message);
        throw new HttpError(500, `Failed to fetch questions from bank: ${queryError.message}`);
      }

            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      if (v2Questions && v2Questions.rowCount > 0) {
        for (const question of v2Questions.rows) {
          // Get options for this question
          let optionsRes;
          try {
            optionsRes = await pool.query(
              `SELECT option_index, option_type, text_content, image_url
               FROM question_options
               WHERE question_id = $1
               ORDER BY option_index ASC`,
              [question.id],
            );
          } catch (optionsError: any) {
            console.error(
              `[addQuestionsFromBank] Error fetching options for V2 question ${question.id}:`,
              optionsError.message,
            );
            continue;
          }

          const options = optionsRes?.rows || [];
          const optionAValue = options[0]?.text_content || options[0]?.image_url || 'A';
          const optionBValue = options[1]?.text_content || options[1]?.image_url || 'B';
          const optionCValue = options[2]?.text_content || options[2]?.image_url || 'C';
          const optionDValue = options[3]?.text_content || options[3]?.image_url || 'D';

          const optionA = typeof optionAValue === 'string' ? optionAValue.substring(0, 500) : 'A';
          const optionB = typeof optionBValue === 'string' ? optionBValue.substring(0, 500) : 'B';
          const optionC = typeof optionCValue === 'string' ? optionCValue.substring(0, 500) : 'C';
          const optionD = typeof optionDValue === 'string' ? optionDValue.substring(0, 500) : 'D';

          const correctAnswer = String.fromCharCode(65 + (question.correct_answer_index ?? 0)) as
            | 'A'
            | 'B'
            | 'C'
            | 'D';
          const hasImage = question.media_url && question.media_url.trim() !== '';
          const questionType = hasImage ? 'IMAGE' : 'TEXT';

          let questionText: string | null = null;
          let questionImage: string | null = null;

          if (questionType === 'TEXT') {
            questionText =
              question.question_text && question.question_text.trim() !== ''
                ? question.question_text
                : 'السؤال';
            questionImage = null;
          } else {
            questionImage = hasImage ? question.media_url : null;
            questionText = null;
          }

          try {
            const insertCols = [
              'exam_id',
              'type',
              'question_text',
              'question_image',
              'option_a',
              'option_b',
              'option_c',
              'option_d',
              'correct_answer',
              'created_by',
            ];
            const insertVals: unknown[] = [
              examId,
              questionType,
              questionText,
              questionImage,
              optionA,
              optionB,
              optionC,
              optionD,
              correctAnswer,
              requester.id,
            ];
            if (bankCols.question_id_v2) {
              insertCols.push('question_id_v2');
              insertVals.push(question.id);
            }
            const placeholders = insertVals.map((_, index) => `$${index + 1}`).join(', ');
            const result = await pool.query(
              `INSERT INTO course_level_exam_questions (${insertCols.join(', ')})
               VALUES (${placeholders})
               RETURNING *`,
              insertVals,
            );
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
            if (result.rowCount > 0) {
              addedCount++;
              addedQuestions.push(result.rows[0]);
            }
          } catch (insertError: any) {
            console.error(
              `[addQuestionsFromBank] Error inserting V2 question ${question.id}:`,
              insertError.message,
            );
          }
        }
      }

      // 2. Identify remaining IDs from V1
      const addedV2Ids = (v2Questions?.rows ?? []).map((r: { id: number }) => r.id);
      const remainingIds = uniqueIds.filter((id) => !addedV2Ids.includes(id));

      if (remainingIds.length > 0) {
        let v1Questions;
        try {
          v1Questions = await pool.query(
            `SELECT q.id, q.text, q.image, q.correct_answer, q.points
             FROM questions q
             WHERE q.id = ANY($1::int[])`,
            [remainingIds],
          );
        } catch (queryError: any) {
          console.error(`[addQuestionsFromBank] Error fetching V1 questions:`, queryError.message);
          v1Questions = { rowCount: 0, rows: [] };
        }

        for (const question of v1Questions?.rows || []) {
          let choicesRes;
          try {
            choicesRes = await pool.query(
              `SELECT choice_text, is_correct
               FROM question_choices
               WHERE question_id = $1
               ORDER BY id ASC
               LIMIT 4`,
              [question.id],
            );
          } catch (choicesError: any) {
            console.error(
              `[addQuestionsFromBank] Error fetching choices for V1 question ${question.id}:`,
              choicesError.message,
            );
            continue;
          }

          const choices = choicesRes?.rows || [];
          const optionAValue = choices[0]?.choice_text || 'A';
          const optionBValue = choices[1]?.choice_text || 'B';
          const optionCValue = choices[2]?.choice_text || 'C';
          const optionDValue = choices[3]?.choice_text || 'D';

          const optionA = typeof optionAValue === 'string' ? optionAValue.substring(0, 500) : 'A';
          const optionB = typeof optionBValue === 'string' ? optionBValue.substring(0, 500) : 'B';
          const optionC = typeof optionCValue === 'string' ? optionCValue.substring(0, 500) : 'C';
          const optionD = typeof optionDValue === 'string' ? optionDValue.substring(0, 500) : 'D';

          let correctAnswerIndex = 0;
          for (let i = 0; i < choices.length; i++) {
            if (choices[i].is_correct) {
              correctAnswerIndex = i;
              break;
            }
          }

          const correctAnswer = String.fromCharCode(65 + correctAnswerIndex) as
            | 'A'
            | 'B'
            | 'C'
            | 'D';
          const hasImage = question.image && question.image.trim() !== '';
          const questionType = hasImage ? 'IMAGE' : 'TEXT';

          let questionText: string | null = null;
          let questionImage: string | null = null;

          if (questionType === 'TEXT') {
            questionText = question.text && question.text.trim() !== '' ? question.text : 'السؤال';
            questionImage = null;
          } else {
            questionImage = hasImage ? question.image : null;
            questionText = null;
          }

          try {
            const insertCols = [
              'exam_id',
              'type',
              'question_text',
              'question_image',
              'option_a',
              'option_b',
              'option_c',
              'option_d',
              'correct_answer',
              'created_by',
            ];
            const insertVals: unknown[] = [
              examId,
              questionType,
              questionText,
              questionImage,
              optionA,
              optionB,
              optionC,
              optionD,
              correctAnswer,
              requester.id,
            ];
            if (bankCols.question_id) {
              insertCols.push('question_id');
              insertVals.push(question.id);
            }
            const placeholders = insertVals.map((_, index) => `$${index + 1}`).join(', ');
            const result = await pool.query(
              `INSERT INTO course_level_exam_questions (${insertCols.join(', ')})
               VALUES (${placeholders})
               RETURNING *`,
              insertVals,
            );
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
            if (result.rowCount > 0) {
              addedCount++;
              addedQuestions.push(result.rows[0]);
            }
          } catch (insertError: any) {
            console.error(
              `[addQuestionsFromBank] Error inserting V1 question ${question.id}:`,
              insertError.message,
            );
          }
        }
      }

      // 4. Update the exam's questions_count
      const countRes = await pool.query(
        `SELECT COUNT(*) as count FROM course_level_exam_questions WHERE exam_id = $1`,
        [examId],
      );
      const actualCount = parseInt(countRes.rows[0]?.count || '0', 10);

      console.log(`[addQuestionsFromBank] Finished. Total questions added: ${addedCount}. Bank size: ${actualCount}`);
      return { addedCount, addedQuestions };
    } catch (error: any) {
      // If it's already an HttpError, re-throw it
      if (error?.status) {
        console.error('[addQuestionsFromBank] HttpError caught:', {
          status: error.status,
          message: error.message,
          examId,
          questionIds,
          teacherId: requester.id,
        });
        throw error;
      }
      // Wrap unexpected errors
      console.error('[addQuestionsFromBank] Unexpected error in addQuestionsFromBank:', {
        message: error?.message,
        stack: error?.stack,
        name: error?.name,
        code: error?.code,
        detail: error?.detail,
        constraint: error?.constraint,
        table: error?.table,
        column: error?.column,
        examId,
        questionIds,
        teacherId: requester.id,
        errorString: String(error),
        fullError: error,
      });
      throw new HttpError(
        500,
        `Failed to add questions from bank: ${error?.message || 'Unknown error'} `,
      );
    }
  }

  /**
   * Verify exam ownership
   */
  private static async verifyExamOwnership(examId: number, teacherId: number): Promise<void> {
    try {
      console.log(`[verifyExamOwnership] Checking exam ${examId} for teacher ${teacherId}`);
      const examRes = await pool.query(
        `SELECT e.id, c.teacher_id
         FROM course_level_exams e
         JOIN courses c ON e.course_id = c.id
         WHERE e.id = $1`,
        [examId],
      );

      console.log(`[verifyExamOwnership] Query result: `, {
        rowCount: examRes.rowCount,
        examId: examRes.rows[0]?.id,
        teacherId: examRes.rows[0]?.teacher_id,
        requestedTeacherId: teacherId,
      });

      if (!examRes.rowCount) {
        console.error(`[verifyExamOwnership] Exam ${examId} not found`);
        throw new HttpError(404, 'Exam not found');
      }

      if (examRes.rows[0].teacher_id !== teacherId) {
        console.error(
          `[verifyExamOwnership] Teacher ${teacherId} does not own exam ${examId} (owner: ${examRes.rows[0].teacher_id})`,
        );
        throw new HttpError(403, 'You do not own this exam');
      }

      console.log(`[verifyExamOwnership] Ownership verified successfully`);
    } catch (error: any) {
      console.error(`[verifyExamOwnership] Error: `, {
        message: error?.message,
        status: error?.status,
        stack: error?.stack,
        examId,
        teacherId,
      });
      throw error;
    }
  }

  /**
   * قائمة تسليمات الامتحان الشامل للمدرس مع الأسئلة الخاطئة وإجابة كل طالب.
   */
  static async listSubmissionsWithWrongQuestions(examId: number) {
    const subsRes = await pool.query(
      `SELECT
         a.id as submission_id,
         a.student_id,
         a.attempt_number,
         a.total_grade,
         a.obtained_grade,
         a.submitted_at,
         CASE WHEN a.obtained_grade >= (a.total_grade * 0.5) THEN true ELSE false END as passed,
         u.name,
         u.email,
         u.phone
       FROM course_level_exam_attempts a
       JOIN users u ON a.student_id = u.id
       WHERE a.exam_id = $1 AND a.status = 'submitted'
       ORDER BY a.submitted_at DESC`,
      [examId],
    );

    if (!subsRes.rowCount) {
      return [];
    }

    const attemptIds = subsRes.rows.map((r) => Number(r.submission_id));
    const answersRes = await pool.query(
      `SELECT
         a.attempt_id,
         a.question_id,
         a.selected_answer,
         a.is_correct,
         q.question_text,
         q.question_image,
         q.type,
         q.option_a,
         q.option_b,
         q.option_c,
         q.option_d,
         q.correct_answer
       FROM course_level_exam_answers a
       JOIN course_level_exam_questions q ON a.question_id = q.id
       WHERE a.attempt_id = ANY($1::int[])
         AND a.is_correct = FALSE
       ORDER BY a.attempt_id, q.id`,
      [attemptIds],
    );

    const optionText = (row: any, letter: string | null) => {
      if (!letter) return null;
      const key = String(letter).trim().toUpperCase();
      if (key === 'A') return row.option_a ?? null;
      if (key === 'B') return row.option_b ?? null;
      if (key === 'C') return row.option_c ?? null;
      if (key === 'D') return row.option_d ?? null;
      return null;
    };

    const wrongByAttempt = new Map<number, any[]>();
    for (const row of answersRes.rows) {
      const attemptId = Number(row.attempt_id);
      const list = wrongByAttempt.get(attemptId) || [];
      const yourAnswer = row.selected_answer ? String(row.selected_answer).trim().toUpperCase() : null;
      const correctAnswer = row.correct_answer ? String(row.correct_answer).trim().toUpperCase() : null;
      list.push({
        questionId: row.question_id,
        questionText: row.question_text,
        questionImage: row.question_image,
        type: row.type,
        correctAnswer,
        correctAnswerText: optionText(row, correctAnswer),
        yourAnswer,
        yourAnswerText: optionText(row, yourAnswer),
        optionA: row.option_a,
        optionB: row.option_b,
        optionC: row.option_c,
        optionD: row.option_d,
      });
      wrongByAttempt.set(attemptId, list);
    }

    return subsRes.rows.map((row) => {
      const wrong = wrongByAttempt.get(Number(row.submission_id)) || [];
      return {
        ...row,
        wrong_questions: wrong,
        wrong_questions_count: wrong.length,
      };
    });
  }
}
