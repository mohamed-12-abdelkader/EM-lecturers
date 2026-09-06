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
import {
  canResumeCourseAttempt,
  collectCourseExamAnswersFromBody,
  computeAttemptExpireAt,
  gradeCourseAttemptAnswers,
  isAttemptExpired,
  isDurationUnlimited,
  mergeSavedAndSubmittedAnswers,
  normalizeDurationMinutes,
  parseCourseExamAnswerItem,
  remainingSeconds,
  type CourseExamAnswer,
  type CourseExamLetter,
} from './courseLevelExamAttemptPolicy';

interface RequestUser {
  id: number;
  role: string;
}

interface CreateCourseLevelExamInput {
  title: string;
  courseId: number;
  durationMinutes: number | null;
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
  durationMinutes?: number | null;
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
        normalizeDurationMinutes(input.durationMinutes),
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
      duration_unlimited: isDurationUnlimited(row.duration_minutes),
      durationUnlimited: isDurationUnlimited(row.duration_minutes),
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
      durationMinutes: row.duration_minutes ?? null,
      durationUnlimited: isDurationUnlimited(row.duration_minutes as number | null),
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

    if (
      input.durationMinutes !== undefined &&
      input.durationMinutes != null &&
      input.durationMinutes < 0
    ) {
      throw new HttpError(400, 'durationMinutes must be greater than 0, or null/0 for unlimited');
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
      values.push(normalizeDurationMinutes(input.durationMinutes));
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
    await this.expireOverdueAttemptIfNeeded(examId, studentId);

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

    if (activeRes.rowCount) {
      return Number(activeRes.rows[0].id);
    }

    const lastSubmitted = await pool.query(
      `SELECT id FROM course_level_exam_attempts
       WHERE exam_id = $1 AND student_id = $2 AND status = 'submitted'
       ORDER BY submitted_at DESC NULLS LAST, id DESC
       LIMIT 1`,
      [examId, studentId],
    );
    if (lastSubmitted.rowCount) {
      return Number(lastSubmitted.rows[0].id);
    }

    throw new HttpError(
      400,
      'attemptId is required, or start the exam first (POST /api/exams/:examId/start)',
    );
  }

  static parseAnswersFromRequestBody(
    body: unknown,
    options: { required?: boolean } = {},
  ): CourseExamAnswer[] {
    const { hasPayload, answers } = collectCourseExamAnswersFromBody(body);
    if (options.required && !hasPayload) {
      throw new HttpError(
        400,
        'answers required: send answers as array of { questionId, selectedAnswer }, or questionIds + selectedAnswers arrays, or answers as { "questionId": "A", ... }',
      );
    }
    const parsed: CourseExamAnswer[] = [];
    for (const item of answers) {
      const normalized = parseCourseExamAnswerItem(item);
      if (!normalized) {
        throw new HttpError(
          400,
          'Each answer must include selected option (selectedAnswer A/B/C/D or 0/1/2/3). Received: ' +
            JSON.stringify(item),
        );
      }
      parsed.push(normalized);
    }
    return parsed;
  }

  private static async loadSavedAnswersForStudent(attemptId: number): Promise<CourseExamAnswer[]> {
    const res = await pool.query(
      `SELECT question_id, selected_answer
       FROM course_level_exam_answers
       WHERE attempt_id = $1 AND selected_answer IS NOT NULL`,
      [attemptId],
    );
    return res.rows
      .map((row) =>
        parseCourseExamAnswerItem({
          questionId: row.question_id,
          selectedAnswer: row.selected_answer,
        }),
      )
      .filter((row): row is CourseExamAnswer => row != null);
  }

  private static async upsertAttemptAnswers(
    attemptId: number,
    answers: Array<{ questionId: number; selectedAnswer?: CourseExamLetter | null }>,
    correctByQuestionId?: Record<number, string | null | undefined>,
  ) {
    for (const answer of answers) {
      const selected = answer.selectedAnswer
        ? String(answer.selectedAnswer).trim().toUpperCase()
        : '';
      const letter =
        selected === 'A' || selected === 'B' || selected === 'C' || selected === 'D'
          ? selected
          : null;
      const correct = correctByQuestionId
        ? String(correctByQuestionId[answer.questionId] ?? '')
            .trim()
            .toUpperCase()
        : '';
      const isCorrect = Boolean(letter && correct && letter === correct);
      await pool.query(
        `INSERT INTO course_level_exam_answers (
           attempt_id, question_id, selected_answer, is_correct
         ) VALUES ($1, $2, $3, $4)
         ON CONFLICT (attempt_id, question_id) DO UPDATE SET
           selected_answer = EXCLUDED.selected_answer,
           is_correct = EXCLUDED.is_correct`,
        [attemptId, answer.questionId, letter, isCorrect],
      );
    }
  }

  private static async loadAttemptQuestions(exam: any, attempt: any, studentId: number) {
    const questionsRes = await pool.query(
      `SELECT * FROM course_level_exam_questions
       WHERE exam_id = $1
       ORDER BY created_at ASC, id ASC`,
      [exam.id ?? exam.exam_id],
    );
    const stored = parseSelectedQuestionIds(attempt?.selected_question_ids);
    const selectedIds =
      stored && stored.length
        ? stored
        : selectAttemptQuestions(
            questionsRes.rows.map((q) => q.id),
            exam.questions_count,
            exam.question_display_mode,
            attemptQuestionSeed(
              Number(exam.id ?? exam.exam_id),
              studentId,
              Number(attempt?.attempt_number || 1),
            ),
          );
    return orderItemsByIds(questionsRes.rows, selectedIds);
  }

  private static async buildStudentAttemptPayload(
    exam: any,
    attempt: any,
    studentId: number,
    resumed: boolean,
  ) {
    const questions = (await this.loadAttemptQuestions(exam, attempt, studentId)).map((q) =>
      this.mapCourseQuestionForStudent(q),
    );
    const savedAnswers = await this.loadSavedAnswersForStudent(attempt.id);
    return {
      attemptId: attempt.id,
      examId: exam.id,
      examTitle: exam.title,
      durationMinutes: exam.duration_minutes ?? null,
      durationUnlimited: isDurationUnlimited(exam.duration_minutes),
      questionsCount: questions.length,
      startedAt: attempt.started_at,
      attemptExpiresAt: attempt.attempt_expire_at ?? null,
      remainingSeconds: remainingSeconds(attempt.attempt_expire_at),
      resumed,
      questions,
      savedAnswers,
    };
  }

  private static async finalizeInProgressAttempt(
    exam: any,
    attempt: any,
    studentId: number,
    submitted: CourseExamAnswer[],
    options: { timedOut?: boolean } = {},
  ) {
    const questions = await this.loadAttemptQuestions(exam, attempt, studentId);
    const saved = await this.loadSavedAnswersForStudent(attempt.id);
    const allowed = new Set(questions.map((q) => Number(q.id)));
    const merged = mergeSavedAndSubmittedAnswers(saved, submitted).filter((a) =>
      allowed.has(a.questionId),
    );
    const correctByQuestionId: Record<number, string | null | undefined> = {};
    for (const q of questions) {
      correctByQuestionId[q.id] = q.correct_answer;
    }
    const graded = gradeCourseAttemptAnswers({
      questionIds: questions.map((q) => Number(q.id)),
      correctByQuestionId,
      answers: merged,
    });

    await this.upsertAttemptAnswers(
      attempt.id,
      graded.results.map((row) => ({
        questionId: row.questionId,
        selectedAnswer: row.selectedAnswer,
      })),
      correctByQuestionId,
    );

    await pool.query(
      `UPDATE course_level_exam_attempts
       SET status = 'submitted',
           submitted_at = NOW(),
           total_grade = $1,
           obtained_grade = $2,
           timed_out = $3
       WHERE id = $4 AND status = 'in_progress'`,
      [graded.maxGrade, graded.obtained, !!options.timedOut, attempt.id],
    );

    const updated = await pool.query(`SELECT * FROM course_level_exam_attempts WHERE id = $1`, [
      attempt.id,
    ]);
    const stored = updated.rows[0] || attempt;
    const now = new Date();
    const releaseDecision = this.courseAnswerRelease(
      exam,
      { ...stored, submitted_at: stored.submitted_at ?? now },
      now,
    );
    const showAnswers = releaseDecision.release;
    const wrongQuestions = showAnswers
      ? graded.results
          .filter((r) => !r.isCorrect)
          .map((r) => {
            const question = questions.find((q) => q.id === r.questionId);
            return {
              questionId: r.questionId,
              questionText: question?.question_text,
              questionImage: question?.question_image,
              type: question?.type,
              correctAnswer: r.correctAnswer,
              yourAnswer: r.selectedAnswer,
              optionA: question?.option_a,
              optionB: question?.option_b,
              optionC: question?.option_c,
              optionD: question?.option_d,
            };
          })
      : [];

    return {
      attemptId: stored.id,
      totalGrade: graded.obtained,
      maxGrade: graded.maxGrade,
      correctCount: graded.correctCount,
      wrongCount: graded.maxGrade - graded.correctCount,
      timedOut: !!stored.timed_out || !!options.timedOut,
      showAnswers,
      releaseReason: releaseDecision.release ? releaseDecision.reason : '',
      answersVisibleAt: exam.answers_visible_at,
      wrongQuestions,
      startedAt: stored.started_at,
      submittedAt: stored.submitted_at ?? now.toISOString(),
    };
  }

  private static async expireOverdueAttemptIfNeeded(examId: number, studentId: number) {
    const res = await pool.query(
      `SELECT a.*, e.title, e.duration_minutes, e.questions_count, e.question_display_mode,
              e.show_answers_immediately, e.answers_visible_at, e.answers_release_mode,
              e.show_answers_after_hours, e.visibility_end_date, e.course_id,
              e.id as exam_row_id
       FROM course_level_exam_attempts a
       JOIN course_level_exams e ON e.id = a.exam_id
       WHERE a.exam_id = $1 AND a.student_id = $2 AND a.status = 'in_progress'
       ORDER BY a.started_at DESC
       LIMIT 1`,
      [examId, studentId],
    );
    if (!res.rowCount) return null;
    const row = res.rows[0];
    if (!isAttemptExpired(row.attempt_expire_at)) return null;
    const exam = { ...row, id: row.exam_id };
    return this.finalizeInProgressAttempt(exam, row, studentId, [], { timedOut: true });
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
        await this.expireOverdueAttemptIfNeeded(exam.id, studentId);
        const attemptsRes = await pool.query(
          `SELECT
             COUNT(*) FILTER (WHERE status = 'submitted')::int AS attempts_count,
             MAX(attempt_number) FILTER (WHERE status = 'submitted') AS last_attempt_number,
             MAX(id) FILTER (WHERE status = 'in_progress') AS in_progress_attempt_id,
             MAX(attempt_expire_at) FILTER (WHERE status = 'in_progress') AS in_progress_expire_at,
             MAX(started_at) FILTER (WHERE status = 'in_progress') AS in_progress_started_at
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
        const canStartNew = canStudentStartExam(courseLevelExamAvailabilityInput(exam), now);
        const inProgressExpireAt = attemptsRes.rows[0]?.in_progress_expire_at ?? null;

        return {
          ...exam,
          configuredQuestionsCount: exam.questions_count,
          actualQuestionsCount: exam.actual_questions_count,
          duration_unlimited: isDurationUnlimited(exam.duration_minutes),
          availability_status,
          attempts_count: attemptsCount,
          last_attempt_number: lastAttemptNumber,
          has_in_progress_attempt: hasInProgressAttempt,
          in_progress_attempt_id: inProgressAttemptId,
          attempt_expires_at: hasInProgressAttempt ? inProgressExpireAt : null,
          remaining_seconds: hasInProgressAttempt ? remainingSeconds(inProgressExpireAt, now) : null,
          can_resume: hasInProgressAttempt && canResumeCourseAttempt(inProgressExpireAt, now),
          can_attempt:
            (hasInProgressAttempt && canResumeCourseAttempt(inProgressExpireAt, now)) ||
            (canAttemptNew && canStartNew),
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

    const enrollmentCheck = await pool.query(
      'SELECT id FROM enrollments WHERE course_id = $1 AND user_id = $2',
      [exam.course_id, studentId],
    );

    if (!enrollmentCheck.rowCount) {
      throw new HttpError(403, 'You are not enrolled in this course');
    }

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

    await this.expireOverdueAttemptIfNeeded(examId, studentId);

    const activeAttemptRes = await pool.query(
      `SELECT * FROM course_level_exam_attempts
       WHERE exam_id = $1 AND student_id = $2 AND status = 'in_progress'
       ORDER BY started_at DESC
       LIMIT 1`,
      [examId, studentId],
    );

    if (activeAttemptRes.rowCount) {
      const activeAttempt = activeAttemptRes.rows[0];
      if (isAttemptExpired(activeAttempt.attempt_expire_at)) {
        await this.finalizeInProgressAttempt(exam, activeAttempt, studentId, [], {
          timedOut: true,
        });
      } else {
        return this.buildStudentAttemptPayload(exam, activeAttempt, studentId, true);
      }
    }

    if (!canStudentStartExam(courseLevelExamAvailabilityInput(exam), new Date())) {
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

    if (exam.attempt_limit === 1 && hasCompletedAttempts) {
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
            timedOut: !!lastAttempt.timed_out,
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

    if (exam.attempt_limit !== null && attemptsCount >= exam.attempt_limit) {
      throw new HttpError(403, 'You have used all allowed attempts for this exam');
    }

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

    const startedAt = new Date();
    const attemptExpireAt = computeAttemptExpireAt({
      startedAt,
      durationMinutes: exam.duration_minutes,
      visibilityEndDate: exam.visibility_end_date,
    });

    let attempt;
    try {
      const attemptResult = await pool.query(
        `INSERT INTO course_level_exam_attempts (
          exam_id, student_id, attempt_number, status, started_at,
          selected_question_ids, attempt_expire_at
        ) VALUES ($1, $2, $3, 'in_progress', $4, $5, $6)
        RETURNING *`,
        [examId, studentId, nextAttemptNumber, startedAt, selectedQuestionIds, attemptExpireAt],
      );
      attempt = attemptResult.rows[0];
    } catch (error: any) {
      if (error?.code === '23505') {
        const existing = await pool.query(
          `SELECT * FROM course_level_exam_attempts
           WHERE exam_id = $1 AND student_id = $2 AND status = 'in_progress'
           ORDER BY started_at DESC LIMIT 1`,
          [examId, studentId],
        );
        if (existing.rowCount) {
          return this.buildStudentAttemptPayload(exam, existing.rows[0], studentId, true);
        }
      }
      throw error;
    }

    return this.buildStudentAttemptPayload(exam, attempt, studentId, false);
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

  private static mapCourseWrongQuestion(question: any, answer?: any) {
    const optionText = (letter: string | null) => {
      if (!letter) return null;
      const key = String(letter).trim().toUpperCase();
      if (key === 'A') return question.option_a ?? null;
      if (key === 'B') return question.option_b ?? null;
      if (key === 'C') return question.option_c ?? null;
      if (key === 'D') return question.option_d ?? null;
      return null;
    };
    const yourAnswer = answer?.selected_answer
      ? String(answer.selected_answer).trim().toUpperCase()
      : null;
    const correctAnswer = question.correct_answer
      ? String(question.correct_answer).trim().toUpperCase()
      : null;
    const unanswered = !yourAnswer;
    return {
      questionId: question.id ?? question.question_id,
      questionText: question.question_text,
      questionImage: question.question_image,
      type: question.type,
      correctAnswer,
      correctAnswerText: optionText(correctAnswer),
      yourAnswer,
      yourAnswerText: optionText(yourAnswer),
      unanswered,
      optionA: question.option_a,
      optionB: question.option_b,
      optionC: question.option_c,
      optionD: question.option_d,
    };
  }

  private static resolveAttemptQuestionIds(
    exam: { id?: number; questions_count?: number | null; question_display_mode?: string | null },
    attempt: { student_id?: number; attempt_number?: number; selected_question_ids?: unknown },
    allQuestionIds: number[],
  ): number[] {
    const stored = parseSelectedQuestionIds(attempt?.selected_question_ids);
    if (stored && stored.length) {
      return stored.filter((id) => allQuestionIds.includes(id));
    }
    return selectAttemptQuestions(
      allQuestionIds,
      exam.questions_count,
      exam.question_display_mode ?? 'ordered',
      attemptQuestionSeed(
        Number(exam.id),
        Number(attempt.student_id || 0),
        Number(attempt.attempt_number || 1),
      ),
    );
  }

  private static async fetchWrongQuestionsForAttempt(attemptId: number) {
    const attemptRes = await pool.query(
      `SELECT a.id, a.exam_id, a.student_id, a.attempt_number, a.selected_question_ids,
              e.questions_count, e.question_display_mode
       FROM course_level_exam_attempts a
       JOIN course_level_exams e ON e.id = a.exam_id
       WHERE a.id = $1`,
      [attemptId],
    );
    if (!attemptRes.rowCount) return [];
    const attempt = attemptRes.rows[0];
    const questionsRes = await pool.query(
      `SELECT id, type, question_text, question_image, option_a, option_b, option_c, option_d, correct_answer
       FROM course_level_exam_questions
       WHERE exam_id = $1
       ORDER BY created_at ASC, id ASC`,
      [attempt.exam_id],
    );
    const questionsById = new Map(questionsRes.rows.map((q) => [Number(q.id), q]));
    const questionIds = this.resolveAttemptQuestionIds(
      { id: attempt.exam_id, questions_count: attempt.questions_count, question_display_mode: attempt.question_display_mode },
      attempt,
      questionsRes.rows.map((q) => Number(q.id)),
    );
    const answersRes = await pool.query(
      `SELECT question_id, selected_answer, is_correct
       FROM course_level_exam_answers
       WHERE attempt_id = $1`,
      [attemptId],
    );
    const answersByQuestion = new Map(
      answersRes.rows.map((row) => [Number(row.question_id), row]),
    );

    return questionIds
      .map((questionId) => {
        const question = questionsById.get(questionId);
        if (!question) return null;
        const answer = answersByQuestion.get(questionId);
        const selected = answer?.selected_answer
          ? String(answer.selected_answer).trim().toUpperCase()
          : null;
        const isCorrect = Boolean(answer?.is_correct) && Boolean(selected);
        if (isCorrect) return null;
        return this.mapCourseWrongQuestion(question, answer);
      })
      .filter((row): row is NonNullable<typeof row> => row != null);
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
      timedOut: !!attempt.timed_out,
    };
  }

  private static async buildSubmitResultFromStored(exam: any, attempt: any) {
    const now = new Date();
    const releaseDecision = this.courseAnswerRelease(exam, attempt, now);
    const showAnswers = releaseDecision.release;
    const maxGrade = Number(attempt.total_grade ?? 0);
    const obtained = Number(attempt.obtained_grade ?? 0);
    return {
      attemptId: attempt.id,
      totalGrade: obtained,
      maxGrade,
      correctCount: obtained,
      wrongCount: Math.max(0, maxGrade - obtained),
      timedOut: !!attempt.timed_out,
      showAnswers,
      releaseReason: releaseDecision.release ? releaseDecision.reason : '',
      answersVisibleAt: exam.answers_visible_at,
      wrongQuestions: showAnswers ? await this.fetchWrongQuestionsForAttempt(attempt.id) : [],
      startedAt: attempt.started_at,
      submittedAt: attempt.submitted_at,
    };
  }

  /**
   * Persist in-progress answers without grading (server-side progress).
   */
  static async autosaveExamAnswers(
    examId: number,
    studentId: number,
    answers: CourseExamAnswer[],
    attemptId?: number,
  ) {
    const expired = await this.expireOverdueAttemptIfNeeded(examId, studentId);
    if (expired && (attemptId == null || expired.attemptId === attemptId)) {
      return { ...expired, autosaved: false };
    }

    const resolvedId = await this.resolveActiveAttemptId(examId, studentId, attemptId);
    const attemptRes = await pool.query(
      `SELECT a.*, e.title, e.duration_minutes, e.questions_count, e.question_display_mode,
              e.show_answers_immediately, e.answers_visible_at, e.answers_release_mode,
              e.show_answers_after_hours, e.visibility_end_date, e.course_id
       FROM course_level_exam_attempts a
       JOIN course_level_exams e ON e.id = a.exam_id
       WHERE a.id = $1 AND a.exam_id = $2 AND a.student_id = $3`,
      [resolvedId, examId, studentId],
    );
    if (!attemptRes.rowCount) {
      throw new HttpError(404, 'Attempt not found');
    }
    const row = attemptRes.rows[0];
    const exam = { ...row, id: row.exam_id };

    if (row.status !== 'in_progress') {
      return { ...(await this.buildSubmitResultFromStored(exam, row)), autosaved: false };
    }
    if (isAttemptExpired(row.attempt_expire_at)) {
      return {
        ...(await this.finalizeInProgressAttempt(exam, row, studentId, answers, {
          timedOut: true,
        })),
        autosaved: false,
      };
    }

    const questions = await this.loadAttemptQuestions(exam, row, studentId);
    const allowed = new Set(questions.map((q) => Number(q.id)));
    const valid = answers.filter((a) => allowed.has(a.questionId));
    await this.upsertAttemptAnswers(resolvedId, valid);
    await pool.query(
      `UPDATE course_level_exam_attempts SET last_autosave_at = NOW() WHERE id = $1`,
      [resolvedId],
    );

    return {
      attemptId: resolvedId,
      autosaved: true,
      timedOut: false,
      savedCount: valid.length,
      remainingSeconds: remainingSeconds(row.attempt_expire_at),
      attemptExpiresAt: row.attempt_expire_at ?? null,
      durationUnlimited: isDurationUnlimited(exam.duration_minutes),
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
    const expired = await this.expireOverdueAttemptIfNeeded(examId, studentId);
    if (expired && expired.attemptId === attemptId) {
      return expired;
    }

    const attemptRes = await pool.query(
      `SELECT a.id, a.exam_id, a.student_id, a.attempt_number, a.status, a.started_at,
              a.submitted_at, a.total_grade, a.obtained_grade, a.selected_question_ids,
              a.attempt_expire_at, a.timed_out,
              e.title, e.duration_minutes, e.questions_count, e.question_display_mode,
              e.show_answers_immediately, e.answers_visible_at, e.answers_release_mode,
              e.show_answers_after_hours, e.visibility_end_date, e.course_id
       FROM course_level_exam_attempts a
       JOIN course_level_exams e ON a.exam_id = e.id
       WHERE a.id = $1 AND a.exam_id = $2 AND a.student_id = $3`,
      [attemptId, examId, studentId],
    );

    if (!attemptRes.rowCount) {
      throw new HttpError(404, 'Attempt not found');
    }

    const row = attemptRes.rows[0];
    const exam = { ...row, id: row.exam_id };
    const attempt = row;

    const enrollmentCheck = await pool.query(
      'SELECT id FROM enrollments WHERE course_id = $1 AND user_id = $2',
      [exam.course_id, studentId],
    );
    if (!enrollmentCheck.rowCount) {
      throw new HttpError(403, 'You are not enrolled in this course');
    }

    if (attempt.status === 'submitted') {
      return this.buildSubmitResultFromStored(exam, attempt);
    }
    if (attempt.status !== 'in_progress') {
      throw new HttpError(400, 'This attempt has already been submitted');
    }

    const timedOut = isAttemptExpired(attempt.attempt_expire_at);
    return this.finalizeInProgressAttempt(exam, attempt, studentId, answers, { timedOut });
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
  static async getExamGrades(
    examId: number,
    requester: RequestUser,
    options?: { groupId?: number; groupType?: 'study' | 'course' },
  ) {
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

    const groupFilter = await this.resolveStudyGroupFilter(
      Number(exam.teacher_id),
      options?.groupId,
      {
        courseId: Number(exam.course_id),
        requesterId: requester.id,
        groupType: options?.groupType,
      },
    );

    const groupParam = groupFilter?.groupId ?? null;
    const groupType = groupFilter?.groupType ?? 'study';
    const membershipSql = groupFilter
      ? this.groupMembershipSql(groupType, 'a.student_id', '$2')
      : 'TRUE';

    // Get all submitted attempts with student info (optional study-group filter)
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
         AND ($2::int IS NULL OR ${membershipSql})
       ORDER BY a.submitted_at DESC`,
      [examId, groupParam],
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
      groupFilter,
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

  /** تحقق من أن المجموعة صالحة لفلترة تقرير هذا الكورس (study_groups أو course_groups) */
  private static async resolveStudyGroupFilter(
    teacherId: number,
    groupId?: number | null,
    opts?: { courseId?: number; requesterId?: number; groupType?: 'study' | 'course' },
  ): Promise<{
    groupId: number;
    groupName: string;
    groupType: 'study' | 'course';
  } | null> {
    if (groupId == null || !Number.isFinite(groupId) || groupId <= 0) {
      return null;
    }

    const prefer = opts?.groupType;
    const tryStudy = !prefer || prefer === 'study';
    const tryCourse = !prefer || prefer === 'course';

    if (tryStudy) {
      const studyRes = await pool.query<{ id: number; name: string }>(
        `SELECT sg.id, sg.name
         FROM study_groups sg
         WHERE sg.id = $1
           AND (
             sg.teacher_id = $2
             OR ($3::int IS NOT NULL AND sg.teacher_id = $3)
             OR (
               $4::int IS NOT NULL AND EXISTS (
                 SELECT 1
                 FROM group_students gs
                 JOIN enrollments e ON e.user_id = gs.student_id AND e.course_id = $4
                 WHERE gs.group_id = sg.id
               )
             )
           )`,
        [groupId, teacherId, opts?.requesterId ?? null, opts?.courseId ?? null],
      );
      if (studyRes.rowCount) {
        return {
          groupId: Number(studyRes.rows[0].id),
          groupName: studyRes.rows[0].name,
          groupType: 'study',
        };
      }
    }

    if (tryCourse) {
      try {
        const courseGroupRes = await pool.query<{ id: number; name: string }>(
          `SELECT cg.id, cg.name
           FROM course_groups cg
           WHERE cg.id = $1
             AND COALESCE(cg.status, 'active') = 'active'
             AND (
               cg.teacher_id = $2
               OR ($3::int IS NOT NULL AND cg.teacher_id = $3)
               OR (
                 $4::int IS NOT NULL AND EXISTS (
                   SELECT 1
                   FROM student_course_group_memberships m
                   JOIN enrollments e ON e.user_id = m.student_id AND e.course_id = $4
                   WHERE m.group_id = cg.id
                 )
               )
             )`,
          [groupId, teacherId, opts?.requesterId ?? null, opts?.courseId ?? null],
        );
        if (courseGroupRes.rowCount) {
          return {
            groupId: Number(courseGroupRes.rows[0].id),
            groupName: courseGroupRes.rows[0].name,
            groupType: 'course',
          };
        }
      } catch {
        // course_groups table may not exist on older DBs
      }
    }

    throw new HttpError(
      404,
      'Group is not linked to this course teacher or enrolled students',
    );
  }

  /** مجموعات study_groups + course_groups المرتبطة بالكورس/المدرس */
  private static async listCourseRelatedStudyGroups(
    teacherId: number,
    courseId: number,
    requesterId?: number,
  ) {
    const studyRes = await pool.query<{ id: number; name: string; grade_id: number | null }>(
      `SELECT DISTINCT sg.id, sg.name, sg.grade_id
       FROM study_groups sg
       WHERE sg.teacher_id = $1
          OR ($3::int IS NOT NULL AND sg.teacher_id = $3)
          OR EXISTS (
            SELECT 1
            FROM group_students gs
            JOIN enrollments e ON e.user_id = gs.student_id AND e.course_id = $2
            WHERE gs.group_id = sg.id
          )
       ORDER BY sg.name ASC`,
      [teacherId, courseId, requesterId ?? null],
    );

    const courseRes = await pool
      .query<{ id: number; name: string; grade_id: number | null }>(
        `SELECT DISTINCT cg.id, cg.name, cg.grade_id
         FROM course_groups cg
         WHERE COALESCE(cg.status, 'active') = 'active'
           AND (
             cg.teacher_id = $1
             OR ($3::int IS NOT NULL AND cg.teacher_id = $3)
             OR EXISTS (
               SELECT 1
               FROM student_course_group_memberships m
               JOIN enrollments e ON e.user_id = m.student_id AND e.course_id = $2
               WHERE m.group_id = cg.id
             )
           )
         ORDER BY cg.name ASC`,
        [teacherId, courseId, requesterId ?? null],
      )
      .catch(() => ({ rows: [] as { id: number; name: string; grade_id: number | null }[] }));

    const study = studyRes.rows.map((g) => ({
      id: Number(g.id),
      name: g.name,
      gradeId: g.grade_id != null ? Number(g.grade_id) : null,
      groupType: 'study' as const,
    }));
    const course = courseRes.rows.map((g) => ({
      id: Number(g.id),
      name: g.name,
      gradeId: g.grade_id != null ? Number(g.grade_id) : null,
      groupType: 'course' as const,
    }));
    return [...study, ...course];
  }

  private static groupMembershipSql(
    groupType: 'study' | 'course',
    studentExpr: string,
    groupParam: string,
  ): string {
    if (groupType === 'course') {
      return `EXISTS (
        SELECT 1 FROM student_course_group_memberships m
        WHERE m.student_id = ${studentExpr} AND m.group_id = ${groupParam}
      )`;
    }
    return `EXISTS (
      SELECT 1 FROM group_students gs
      WHERE gs.student_id = ${studentExpr} AND gs.group_id = ${groupParam}
    )`;
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
    options?: { passPercentage?: number; groupId?: number; groupType?: 'study' | 'course' },
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

    const groupFilter = await this.resolveStudyGroupFilter(
      Number(exam.teacher_id),
      options?.groupId,
      {
        courseId: Number(exam.course_id),
        requesterId: requester.id,
        groupType: options?.groupType,
      },
    );
    const availableStudyGroups = await this.listCourseRelatedStudyGroups(
      Number(exam.teacher_id),
      Number(exam.course_id),
      requester.id,
    );

    const groupParam = groupFilter?.groupId ?? null;
    const membershipForUser = groupFilter
      ? this.groupMembershipSql(groupFilter.groupType, 'u.id', '$2')
      : 'TRUE';

    const enrolledRes = await pool.query(
      `SELECT u.id as student_id, u.name as student_name, u.email as student_email
       FROM enrollments e
       JOIN users u ON u.id = e.user_id
       WHERE e.course_id = $1 AND u.role = 'student'
         AND ($2::int IS NULL OR ${membershipForUser})
       ORDER BY u.name ASC`,
      [exam.course_id, groupParam],
    );
    const enrolledStudents = enrolledRes.rows;
    const enrolledTotal = enrolledStudents.length;
    const enrolledStudentIds = new Set(
      enrolledStudents.map((s) => Number(s.student_id)),
    );

    const attemptStatusRes = await pool.query(
      `SELECT DISTINCT ON (a.student_id)
         a.student_id,
         a.status,
         a.obtained_grade,
         a.total_grade,
         a.started_at,
         a.attempt_expire_at,
         a.last_autosave_at,
         (
           SELECT COUNT(*)::int
           FROM course_level_exam_answers ans
           WHERE ans.attempt_id = a.id AND ans.selected_answer IS NOT NULL
         ) AS answered_count
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
    const examinedStudents: {
      studentId: number;
      studentName: string;
      studentEmail: string;
      obtainedGrade: number | null;
      totalGrade: number | null;
      percentage: number;
      passed: boolean;
      submittedAt?: string | null;
    }[] = [];
    const notExaminedStudents: {
      studentId: number;
      studentName: string;
      studentEmail: string;
      examStatus: 'never_started' | 'in_progress';
      startedAt?: string | null;
      lastAutosaveAt?: string | null;
      remainingSeconds?: number | null;
      answeredCount?: number;
      questionsCount?: number;
    }[] = [];

    for (const student of enrolledStudents) {
      const studentId = Number(student.student_id);
      const latestAttempt = attemptByStudent.get(studentId);
      const submittedAttempt = submittedByStudent.get(studentId);

      if (submittedAttempt) {
        examinedCount++;
        const obtained = Number(submittedAttempt.obtained_grade ?? 0);
        const total = Number(submittedAttempt.total_grade ?? 0);
        const passed = this.isAttemptPassed(
          submittedAttempt.obtained_grade,
          submittedAttempt.total_grade,
          passPercentage,
        );
        if (passed) {
          passedCount++;
        } else {
          failedCount++;
        }
        examinedStudents.push({
          studentId,
          studentName: student.student_name,
          studentEmail: student.student_email,
          obtainedGrade:
            submittedAttempt.obtained_grade != null
              ? Number(submittedAttempt.obtained_grade)
              : null,
          totalGrade:
            submittedAttempt.total_grade != null ? Number(submittedAttempt.total_grade) : null,
          percentage: total > 0 ? Math.round((obtained / total) * 100 * 100) / 100 : 0,
          passed,
        });
        continue;
      }

      if (latestAttempt?.status === 'in_progress') {
        startedNotSubmittedCount++;
        notExaminedStudents.push({
          studentId,
          studentName: student.student_name,
          studentEmail: student.student_email,
          examStatus: 'in_progress',
          startedAt: latestAttempt.started_at ?? null,
          lastAutosaveAt: latestAttempt.last_autosave_at ?? null,
          remainingSeconds: remainingSeconds(latestAttempt.attempt_expire_at),
          answeredCount: Number(latestAttempt.answered_count || 0),
          questionsCount: Number(exam.questions_count || 0) || undefined,
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
      groupId: groupFilter?.groupId ?? null,
      groupName: groupFilter?.groupName ?? null,
      groupType: groupFilter?.groupType ?? null,
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

    const membershipForAttempt = groupFilter
      ? this.groupMembershipSql(groupFilter.groupType, 'a.student_id', '$2')
      : 'TRUE';

    const attemptsRes = await pool.query(
      `SELECT DISTINCT ON (a.student_id)
         a.id,
         a.student_id,
         u.name as student_name,
         u.email as student_email,
         a.obtained_grade,
         a.total_grade,
         a.submitted_at
       FROM course_level_exam_attempts a
       JOIN users u ON a.student_id = u.id
       WHERE a.exam_id = $1 AND a.status = 'submitted'
         AND ($2::int IS NULL OR ${membershipForAttempt})
       ORDER BY a.student_id, a.submitted_at DESC NULLS LAST, a.id DESC`,
      [examId, groupParam],
    );
    const attempts = attemptsRes.rows.filter((a) =>
      enrolledStudentIds.has(Number(a.student_id)),
    );
    const totalAttempts = attempts.length;
    const attemptIds = attempts.map((a) => Number(a.id));

    // Enrich examinedStudents with submittedAt from attempts query
    const submittedAtByStudent = new Map(
      attempts.map((a) => [Number(a.student_id), a.submitted_at ?? null]),
    );
    for (const s of examinedStudents) {
      s.submittedAt = submittedAtByStudent.get(s.studentId) ?? null;
    }

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
      const answeredRows = questionAnswers.filter((a) => a.selected_answer);
      const answeredStudentIds = new Set(answeredRows.map((a) => Number(a.student_id)));
      const correctAnswers = answeredRows.filter((a) => a.is_correct);
      const wrongAnswers = answeredRows.filter((a) => !a.is_correct);
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
      const answeredCount = answeredRows.length;
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
    const totalCorrect = questionsWithStats.reduce((sum, q) => sum + q.correctCount, 0);
    const totalWrong = questionsWithStats.reduce((sum, q) => sum + q.wrongCount, 0);
    const totalUnanswered = questionsWithStats.reduce((sum, q) => sum + q.unansweredCount, 0);
    const scoredPairs = totalCorrect + totalWrong;
    const overallCorrectPercentage =
      scoredPairs > 0 ? Math.round((totalCorrect / scoredPairs) * 100 * 100) / 100 : 0;

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
      groupFilter,
      availableStudyGroups,
      enrollmentSummary,
      examinedStudents,
      notExaminedStudents,
      overallStatistics: {
        totalStudents: totalAttempts,
        enrolledTotal,
        totalQuestions,
        totalAnswers: scoredPairs,
        totalCorrect,
        totalWrong,
        totalUnanswered,
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
   * قائمة تسليمات الامتحان الشامل للمدرس مع الأسئلة الخاطئة والمتروكة وإجابة كل طالب.
   */
  static async listSubmissionsWithWrongQuestions(examId: number) {
    const examRes = await pool.query(
      `SELECT id, questions_count, question_display_mode FROM course_level_exams WHERE id = $1`,
      [examId],
    );
    if (!examRes.rowCount) return [];
    const exam = examRes.rows[0];

    const questionsRes = await pool.query(
      `SELECT id, type, question_text, question_image, option_a, option_b, option_c, option_d, correct_answer
       FROM course_level_exam_questions
       WHERE exam_id = $1
       ORDER BY created_at ASC, id ASC`,
      [examId],
    );
    const questionsById = new Map(questionsRes.rows.map((q) => [Number(q.id), q]));
    const allQuestionIds = questionsRes.rows.map((q) => Number(q.id));

    const subsRes = await pool.query(
      `SELECT
         a.id as submission_id,
         a.student_id,
         a.attempt_number,
         a.status,
         a.total_grade,
         a.obtained_grade,
         a.started_at,
         a.submitted_at,
         a.attempt_expire_at,
         a.last_autosave_at,
         a.timed_out,
         a.selected_question_ids,
         CASE
           WHEN a.status = 'submitted' AND a.obtained_grade >= (a.total_grade * 0.5) THEN true
           ELSE false
         END as passed,
         u.name,
         u.email,
         u.phone
       FROM course_level_exam_attempts a
       JOIN users u ON a.student_id = u.id
       WHERE a.exam_id = $1 AND a.status IN ('submitted', 'in_progress')
       ORDER BY CASE WHEN a.status = 'in_progress' THEN 0 ELSE 1 END,
         a.submitted_at DESC NULLS LAST, a.started_at DESC`,
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
         a.is_correct
       FROM course_level_exam_answers a
       WHERE a.attempt_id = ANY($1::int[])`,
      [attemptIds],
    );

    const answersByAttempt = new Map<number, Map<number, any>>();
    for (const row of answersRes.rows) {
      const attemptId = Number(row.attempt_id);
      const byQuestion = answersByAttempt.get(attemptId) || new Map();
      byQuestion.set(Number(row.question_id), row);
      answersByAttempt.set(attemptId, byQuestion);
    }

    return subsRes.rows.map((row) => {
      const inProgress = row.status === 'in_progress';
      const questionIds = this.resolveAttemptQuestionIds(
        exam,
        row,
        allQuestionIds,
      );
      const answers = answersByAttempt.get(Number(row.submission_id)) || new Map();
      const wrong: any[] = [];
      let answeredCount = 0;
      for (const questionId of questionIds) {
        const question = questionsById.get(questionId);
        if (!question) continue;
        const answer = answers.get(questionId);
        const selected = answer?.selected_answer
          ? String(answer.selected_answer).trim().toUpperCase()
          : null;
        if (selected) answeredCount += 1;
        const isCorrect = Boolean(answer?.is_correct) && Boolean(selected);
        if (!isCorrect) {
          wrong.push(this.mapCourseWrongQuestion(question, answer));
        }
      }
      const questionsCount = questionIds.length;
      const unansweredCount = Math.max(0, questionsCount - answeredCount);
      const obtained = Number(row.obtained_grade ?? 0);
      const maxGrade = Number(row.total_grade ?? questionsCount);
      const percentage = maxGrade > 0 ? Math.round((obtained / maxGrade) * 100) : 0;

      return {
        ...row,
        obtained_grade: inProgress ? null : obtained,
        total_grade: maxGrade,
        max_grade: maxGrade,
        percentage: inProgress ? null : percentage,
        in_progress: inProgress,
        exam_status: inProgress ? 'in_progress' : row.timed_out ? 'timed_out' : 'submitted',
        timed_out: Boolean(row.timed_out),
        remaining_seconds: inProgress ? remainingSeconds(row.attempt_expire_at) : null,
        questions_count: questionsCount,
        answered_count: answeredCount,
        unanswered_count: inProgress ? unansweredCount : unansweredCount,
        wrong_questions: inProgress ? [] : wrong,
        wrong_questions_count: inProgress ? 0 : wrong.length,
      };
    });
  }
}
