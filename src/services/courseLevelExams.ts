import pool from '../db/pool';
import { HttpError } from '../utils';

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
  showAnswersImmediately: boolean;
  answersVisibleAt: Date | null;
  isActive: boolean;
  attemptLimit?: number | null;
}

interface UpdateCourseLevelExamInput {
  title?: string;
  durationMinutes?: number;
  questionsCount?: number;
  isVisibleToStudents?: boolean;
  visibilityEndDate?: Date | null;
  showAnswersImmediately?: boolean;
  answersVisibleAt?: Date | null;
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

    const result = await pool.query(
      `INSERT INTO course_level_exams (
        course_id,
        title,
        duration_minutes,
        questions_count,
        is_visible_to_students,
        visibility_end_date,
        show_answers_immediately,
        answers_visible_at,
        is_active,
        attempt_limit
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *`,
      [
        input.courseId,
        input.title,
        input.durationMinutes,
        input.questionsCount,
        input.isVisibleToStudents,
        input.visibilityEndDate,
        input.showAnswersImmediately,
        input.answersVisibleAt,
        input.isActive,
        input.attemptLimit ?? null,
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
      `SELECT * FROM course_level_exams 
       WHERE course_id = $1 
       ORDER BY created_at DESC`,
      [courseId],
    );

    return result.rows;
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
      questionsCount: row.actual_questions_count ?? row.questions_count,
      configuredQuestionsCount: row.questions_count,
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
    const visibilityEndDate =
      input.visibilityEndDate !== undefined ? input.visibilityEndDate : exam.visibility_end_date;

    if (!isVisibleToStudents && !visibilityEndDate) {
      throw new HttpError(400, 'visibilityEndDate is required when isVisibleToStudents is false');
    }

    const showAnswersImmediately =
      input.showAnswersImmediately !== undefined
        ? input.showAnswersImmediately
        : exam.show_answers_immediately;
    const answersVisibleAt =
      input.answersVisibleAt !== undefined ? input.answersVisibleAt : exam.answers_visible_at;

    if (!showAnswersImmediately && !answersVisibleAt) {
      throw new HttpError(400, 'answersVisibleAt is required when showAnswersImmediately is false');
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
    if (input.showAnswersImmediately !== undefined) {
      updates.push(`show_answers_immediately = $${paramIndex++}`);
      values.push(input.showAnswersImmediately);
    }
    if (input.answersVisibleAt !== undefined) {
      updates.push(`answers_visible_at = $${paramIndex++}`);
      values.push(input.answersVisibleAt);
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
      `SELECT e.*, c.title as course_title
       FROM course_level_exams e
       JOIN courses c ON e.course_id = c.id
       WHERE e.course_id = $1
         AND e.is_active = TRUE
         AND e.is_visible_to_students = TRUE
         AND (e.visibility_end_date IS NULL OR e.visibility_end_date > $2)
       ORDER BY e.created_at DESC`,
      [courseId, now],
    );

    // Get attempt counts for each exam
    const examsWithAttempts = await Promise.all(
      result.rows.map(async (exam) => {
        const attemptsRes = await pool.query(
          `SELECT COUNT(*) as attempts_count, 
                  MAX(attempt_number) as last_attempt_number
           FROM course_level_exam_attempts
           WHERE exam_id = $1 AND student_id = $2`,
          [exam.id, studentId],
        );

        const attemptsCount = attemptsRes.rows[0]?.attempts_count || 0;
        const lastAttemptNumber = attemptsRes.rows[0]?.last_attempt_number || 0;
        const canAttempt = exam.attempt_limit === null || attemptsCount < exam.attempt_limit;

        return {
          ...exam,
          attempts_count: Number(attemptsCount),
          last_attempt_number: Number(lastAttemptNumber),
          can_attempt: canAttempt,
          attempts_remaining:
            exam.attempt_limit === null
              ? null
              : Math.max(0, exam.attempt_limit - Number(attemptsCount)),
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

    // Check visibility end date
    if (exam.visibility_end_date) {
      const now = new Date();
      const endDate = new Date(exam.visibility_end_date);
      if (now > endDate) {
        throw new HttpError(403, 'This exam is no longer available');
      }
    }

    // Check attempt limit and get previous attempts
    const attemptsRes = await pool.query(
      `SELECT COUNT(*) as attempts_count, MAX(attempt_number) as last_attempt_number
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

        // Check if answers should be shown
        const now = new Date();
        let showAnswers = false;
        let releaseReason = '';

        if (exam.show_answers_immediately) {
          showAnswers = true;
          releaseReason = 'immediate';
        } else if (exam.answers_visible_at) {
          const answersVisibleAt = new Date(exam.answers_visible_at);
          if (now >= answersVisibleAt) {
            showAnswers = true;
            releaseReason = 'scheduled';
          } else {
            releaseReason = 'scheduled_pending';
          }
        }

        // Get wrong questions if answers should be shown
        let wrongQuestions: any[] = [];
        if (showAnswers) {
          const wrongAnswersRes = await pool.query(
            `SELECT a.*, q.*
             FROM course_level_exam_answers a
             JOIN course_level_exam_questions q ON a.question_id = q.id
             WHERE a.attempt_id = $1 AND a.is_correct = FALSE
             ORDER BY q.created_at ASC`,
            [lastAttempt.id],
          );

          wrongQuestions = wrongAnswersRes.rows.map((row) => ({
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
            showAnswers,
            releaseReason,
            answersVisibleAt: exam.answers_visible_at,
            wrongQuestions: showAnswers ? wrongQuestions : [],
          },
        };
        throw error;
      }
    }

    // Check if attempts limit reached
    if (exam.attempt_limit !== null && attemptsCount >= exam.attempt_limit) {
      throw new HttpError(403, 'You have used all allowed attempts for this exam');
    }

    // Check if there's an active attempt
    const activeAttemptRes = await pool.query(
      `SELECT * FROM course_level_exam_attempts
       WHERE exam_id = $1 AND student_id = $2 AND status = 'in_progress'
       ORDER BY started_at DESC
       LIMIT 1`,
      [examId, studentId],
    );

    if (activeAttemptRes.rowCount && activeAttemptRes.rowCount > 0) {
      // Return existing active attempt
      const attempt = activeAttemptRes.rows[0];
      const questionsRes = await pool.query(
        `SELECT * FROM course_level_exam_questions
         WHERE exam_id = $1
         ORDER BY created_at ASC`,
        [examId],
      );

      return {
        attemptId: attempt.id,
        examId: exam.id,
        examTitle: exam.title,
        durationMinutes: exam.duration_minutes,
        questionsCount: exam.questions_count,
        startedAt: attempt.started_at,
        questions: questionsRes.rows.map((q) => ({
          id: q.id,
          type: q.type,
          questionText: q.question_text,
          questionImage: q.question_image,
          optionA: q.option_a,
          optionB: q.option_b,
          optionC: q.option_c,
          optionD: q.option_d,
        })),
      };
    }

    // Create new attempt
    const nextAttemptNumber = Number(attemptsRes.rows[0]?.last_attempt_number || 0) + 1;
    const attemptResult = await pool.query(
      `INSERT INTO course_level_exam_attempts (
        exam_id, student_id, attempt_number, status, started_at
      ) VALUES ($1, $2, $3, 'in_progress', NOW())
      RETURNING *`,
      [examId, studentId, nextAttemptNumber],
    );

    const attempt = attemptResult.rows[0];

    // Get questions (without correct answers)
    const questionsRes = await pool.query(
      `SELECT * FROM course_level_exam_questions
       WHERE exam_id = $1
       ORDER BY created_at ASC`,
      [examId],
    );

    return {
      attemptId: attempt.id,
      examId: exam.id,
      examTitle: exam.title,
      durationMinutes: exam.duration_minutes,
      questionsCount: exam.questions_count,
      startedAt: attempt.started_at,
      questions: questionsRes.rows.map((q) => ({
        id: q.id,
        type: q.type,
        questionText: q.question_text,
        questionImage: q.question_image,
        optionA: q.option_a,
        optionB: q.option_b,
        optionC: q.option_c,
        optionD: q.option_d,
      })),
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
    const questionsRes = await pool.query(
      `SELECT * FROM course_level_exam_questions
       WHERE exam_id = $1
       ORDER BY created_at ASC`,
      [examId],
    );

    const questions = questionsRes.rows;
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
    let showAnswers = false;
    let releaseReason = '';

    if (exam.show_answers_immediately) {
      showAnswers = true;
      releaseReason = 'immediate';
    } else if (exam.answers_visible_at) {
      const answersVisibleAt = new Date(exam.answers_visible_at);
      if (now >= answersVisibleAt) {
        showAnswers = true;
        releaseReason = 'scheduled';
      } else {
        releaseReason = 'scheduled_pending';
      }
    }

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
    // Get exam with course info
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

    // Verify student is enrolled
    const enrollmentCheck = await pool.query(
      'SELECT id FROM enrollments WHERE course_id = $1 AND user_id = $2',
      [exam.course_id, studentId],
    );

    if (!enrollmentCheck.rowCount) {
      throw new HttpError(403, 'You are not enrolled in this course');
    }

    // Get the last submitted attempt
    const attemptRes = await pool.query(
      `SELECT * FROM course_level_exam_attempts
       WHERE exam_id = $1 AND student_id = $2 AND status = 'submitted'
       ORDER BY submitted_at DESC
       LIMIT 1`,
      [examId, studentId],
    );

    if (!attemptRes.rowCount) {
      throw new HttpError(404, 'No completed attempt found for this exam');
    }

    const attempt = attemptRes.rows[0];

    // Check if answers should be shown
    const now = new Date();
    let showAnswers = false;
    let releaseReason = '';

    if (exam.show_answers_immediately) {
      showAnswers = true;
      releaseReason = 'immediate';
    } else if (exam.answers_visible_at) {
      const answersVisibleAt = new Date(exam.answers_visible_at);
      if (now >= answersVisibleAt) {
        showAnswers = true;
        releaseReason = 'scheduled';
      } else {
        releaseReason = 'scheduled_pending';
      }
    } else {
      throw new HttpError(403, 'Answers are not configured to be shown for this exam');
    }

    if (!showAnswers) {
      return {
        showAnswers: false,
        releaseReason: 'scheduled_pending',
        answersVisibleAt: exam.answers_visible_at,
        message: 'Answers will be available after the scheduled time',
      };
    }

    // Get wrong answers
    const wrongAnswersRes = await pool.query(
      `SELECT a.*, q.*
       FROM course_level_exam_answers a
       JOIN course_level_exam_questions q ON a.question_id = q.id
       WHERE a.attempt_id = $1 AND a.is_correct = FALSE
       ORDER BY q.created_at ASC`,
      [attempt.id],
    );

    const wrongQuestions = wrongAnswersRes.rows.map((row) => ({
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

    return {
      showAnswers: true,
      releaseReason,
      attemptId: attempt.id,
      totalGrade: attempt.obtained_grade,
      maxGrade: attempt.total_grade,
      submittedAt: attempt.submitted_at,
      wrongQuestions,
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
    let showAnswers = false;

    if (exam.show_answers_immediately) {
      showAnswers = true;
    } else if (exam.answers_visible_at && now >= new Date(exam.answers_visible_at)) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      showAnswers = true;
    } else {
      throw new HttpError(
        403,
        'لا يمكن عرض تقرير الإجابات حالياً (سيتم إظهارها في وقت لاحق أو غير مفعّل)',
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
   * Get detailed exam report with question statistics (teacher only)
   */
  static async getExamReport(examId: number, requester: RequestUser) {
    // Verify exam exists and teacher owns it
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

    // Verify teacher owns the course
    if (requester.role === 'teacher' && exam.teacher_id !== requester.id) {
      throw new HttpError(403, 'You are not allowed to view report for this exam');
    }

    // Get all questions
    const questionsRes = await pool.query(
      `SELECT id, type, question_text, question_image, option_a, option_b, option_c, option_d, correct_answer
       FROM course_level_exam_questions
       WHERE exam_id = $1
       ORDER BY id ASC`,
      [examId],
    );
    const questions = questionsRes.rows;

    // Get all submitted attempts
    const attemptsRes = await pool.query(
      `SELECT id, student_id
       FROM course_level_exam_attempts
       WHERE exam_id = $1 AND status = 'submitted'`,
      [examId],
    );
    const attempts = attemptsRes.rows;
    const totalAttempts = attempts.length;

    // Get all answers for submitted attempts
    const answersRes = await pool.query(
      `SELECT 
         a.question_id,
         a.selected_answer,
         a.is_correct,
         att.student_id,
         u.name as student_name
       FROM course_level_exam_answers a
       JOIN course_level_exam_attempts att ON a.attempt_id = att.id
       JOIN users u ON att.student_id = u.id
       WHERE att.exam_id = $1 AND att.status = 'submitted'
       ORDER BY a.question_id ASC`,
      [examId],
    );
    const answers = answersRes.rows;

    // Process questions with statistics
    const questionsWithStats = questions.map((question) => {
      const questionAnswers = answers.filter((a) => a.question_id === question.id);
      const correctAnswers = questionAnswers.filter((a) => a.is_correct);
      const wrongAnswers = questionAnswers.filter((a) => !a.is_correct);

      // Get students who answered correctly
      const correctStudents = correctAnswers.map((a) => ({
        studentId: a.student_id,
        studentName: a.student_name,
        selectedAnswer: a.selected_answer,
      }));

      // Get students who answered incorrectly
      const wrongStudents = wrongAnswers.map((a) => ({
        studentId: a.student_id,
        studentName: a.student_name,
        selectedAnswer: a.selected_answer,
      }));

      // Count answers by option
      const answerCounts = {
        A: questionAnswers.filter((a) => a.selected_answer === 'A').length,
        B: questionAnswers.filter((a) => a.selected_answer === 'B').length,
        C: questionAnswers.filter((a) => a.selected_answer === 'C').length,
        D: questionAnswers.filter((a) => a.selected_answer === 'D').length,
      };

      return {
        questionId: question.id,
        type: question.type,
        questionText: question.question_text,
        questionImage: question.question_image,
        optionA: question.option_a,
        optionB: question.option_b,
        optionC: question.option_c,
        optionD: question.option_d,
        correctAnswer: question.correct_answer,
        statistics: {
          totalAnswers: questionAnswers.length,
          correctAnswers: correctAnswers.length,
          wrongAnswers: wrongAnswers.length,
          correctPercentage:
            questionAnswers.length > 0
              ? Math.round((correctAnswers.length / questionAnswers.length) * 100 * 100) / 100
              : 0,
          wrongPercentage:
            questionAnswers.length > 0
              ? Math.round((wrongAnswers.length / questionAnswers.length) * 100 * 100) / 100
              : 0,
          answerDistribution: answerCounts,
        },
        correctStudents: correctStudents,
        wrongStudents: wrongStudents,
      };
    });

    // Sort questions by wrong answers count (most wrong first)
    const sortedQuestions = [...questionsWithStats].sort(
      (a, b) => b.statistics.wrongAnswers - a.statistics.wrongAnswers,
    );

    // Calculate overall statistics
    const totalQuestions = questions.length;
    const totalAnswers = answers.length;
    const totalCorrect = answers.filter((a) => a.is_correct).length;
    const totalWrong = answers.filter((a) => !a.is_correct).length;
    const overallCorrectPercentage =
      totalAnswers > 0 ? Math.round((totalCorrect / totalAnswers) * 100 * 100) / 100 : 0;

    // Get most problematic questions (top 5)
    const mostProblematicQuestions = sortedQuestions
      .filter((q) => q.statistics.wrongAnswers > 0)
      .slice(0, 5)
      .map((q) => ({
        questionId: q.questionId,
        questionText: q.questionText || 'Image Question',
        wrongAnswers: q.statistics.wrongAnswers,
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
      overallStatistics: {
        totalStudents: totalAttempts,
        totalQuestions,
        totalAnswers,
        totalCorrect,
        totalWrong,
        overallCorrectPercentage,
        overallWrongPercentage: Math.round((100 - overallCorrectPercentage) * 100) / 100,
      },
      questions: questionsWithStats,
      sortedQuestions: sortedQuestions, // Sorted by wrong answers
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

      try {
        await pool.query(`UPDATE course_level_exams SET questions_count = $1 WHERE id = $2`, [
          actualCount,
          examId,
        ]);
      } catch (updateError: any) {
        console.error(
          `[addQuestionsFromBank] Error updating questions_count:`,
          updateError.message,
        );
      }

      console.log(`[addQuestionsFromBank] Finished. Total questions added: ${addedCount}`);
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
}
