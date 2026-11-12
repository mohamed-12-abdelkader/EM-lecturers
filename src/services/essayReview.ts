import pool from '../db/pool';
import { HttpError } from '../utils';
import { decideEssayOutcome, evaluateEssayWithDeepSeek } from './essayEvaluation';

export interface EssayDraft {
  questionId: number;
  answerText?: string | null;
  answerImages?: string[];
  ocrText?: string | null;
}

interface RequestUser {
  id: number;
  role: string;
}

const TEACHER_ROLES = new Set(['teacher', 'academy', 'academy_teacher', 'admin']);

function cleanText(value: unknown): string {
  return String(value ?? '').trim();
}

function imageList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => cleanText(item)).filter(Boolean).slice(0, 8);
}

export function extractEssayAnswerDrafts(body: unknown): EssayDraft[] {
  if (!body || typeof body !== 'object') return [];
  const answers = (body as { answers?: unknown }).answers;
  if (!Array.isArray(answers)) return [];
  const drafts: EssayDraft[] = [];
  for (const item of answers) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const questionId = Number(row.questionId ?? row.question_id);
    const essay = row.essay === true || row.essay === 'true';
    const answerText = row.answerText ?? row.answer_text;
    const images = imageList(row.answerImages ?? row.answer_images);
    const ocrText = row.ocrText ?? row.ocr_text;
    if (!Number.isInteger(questionId) || questionId <= 0) continue;
    if (!essay && answerText == null && images.length === 0 && ocrText == null) continue;
    drafts.push({
      questionId,
      answerText: answerText == null ? null : String(answerText),
      answerImages: images,
      ocrText: ocrText == null ? null : String(ocrText),
    });
  }
  return drafts;
}

function studentAnswerForGrading(answerText: string | null, ocrText: string | null): string {
  const typed = cleanText(answerText);
  if (typed) return typed;
  return cleanText(ocrText);
}

function readableAnswer(answerText: string | null, ocrText: string | null, images: string[]): boolean {
  if (cleanText(answerText) || cleanText(ocrText)) return true;
  return images.length === 0;
}

export function studentEssayStatus(status: string | null | undefined) {
  if (status === 'correct') return { label: 'إجابة صحيحة', pending: false };
  if (status === 'incorrect') return { label: 'إجابة خاطئة', pending: false };
  if (status === 'graded') return { label: 'تم التصحيح', pending: false };
  return { label: 'قيد مراجعة المدرس', pending: true };
}

const PENDING_NOTICE =
  'تم استلام إجابتك على السؤال المقالي، وهي حاليًا قيد مراجعة المدرس. إذا ثبتت صحة إجابتك، سيتم إضافة الدرجة المستحقة إلى مجموع درجاتك تلقائيًا.';

export class EssayReviewService {
  static async assertCourseExamTeacher(examId: number, user: RequestUser) {
    const res = await pool.query(
      `SELECT e.id, COALESCE(e.teacher_id, c.teacher_id) AS teacher_id
       FROM course_level_exams e
       LEFT JOIN courses c ON c.id = e.course_id
       WHERE e.id = $1`,
      [examId],
    );
    if (!res.rowCount) throw new HttpError(404, 'الامتحان غير موجود');
    if (user.role !== 'admin' && Number(res.rows[0].teacher_id) !== user.id) {
      throw new HttpError(403, 'غير مسموح بإدارة هذا الامتحان');
    }
    return res.rows[0];
  }

  static async assertLectureExamTeacher(examId: number, user: RequestUser) {
    const res = await pool.query(
      `SELECT e.id, e.created_by, COALESCE(c.teacher_id, c2.teacher_id) AS teacher_id
       FROM exams e
       LEFT JOIN courses c ON c.id = e.course_id
       LEFT JOIN lectures l ON l.id = e.lecture_id
       LEFT JOIN courses c2 ON c2.id = l.course_id
       WHERE e.id = $1`,
      [examId],
    );
    if (!res.rowCount) throw new HttpError(404, 'الامتحان غير موجود');
    const row = res.rows[0];
    const allowed =
      user.role === 'admin' ||
      Number(row.created_by) === user.id ||
      Number(row.teacher_id) === user.id;
    if (!allowed) throw new HttpError(403, 'غير مسموح بإدارة هذا الامتحان');
    return row;
  }

  static async createQuestion(user: RequestUser, input: {
    examId: number;
    scope: 'course' | 'lecture';
    questionText?: string | null;
    questionImage?: string | null;
    modelAnswer?: string | null;
    modelAnswerImage?: string | null;
    points?: number;
    rubric?: string | null;
  }) {
    if (!TEACHER_ROLES.has(user.role)) throw new HttpError(403, 'غير مسموح');
    const questionText = cleanText(input.questionText);
    const questionImage = cleanText(input.questionImage);
    const modelAnswer = cleanText(input.modelAnswer);
    const modelImage = cleanText(input.modelAnswerImage);
    const points = Number(input.points);
    if (!questionText && !questionImage) {
      throw new HttpError(400, 'أدخل نص السؤال أو صورته');
    }
    if (!modelAnswer) {
      throw new HttpError(400, 'أدخل الإجابة النموذجية بعد مراجعتها');
    }
    if (!Number.isFinite(points) || points <= 0) {
      throw new HttpError(400, 'أدخل درجة السؤال');
    }

    if (input.scope === 'lecture') {
      await this.assertLectureExamTeacher(input.examId, user);
      const result = await pool.query(
        `INSERT INTO exam_questions (
           exam_id, question_text, grade, image, question_kind, model_answer, model_answer_image, rubric
         ) VALUES ($1, $2, $3, $4, 'essay', $5, $6, $7)
         RETURNING *`,
        [
          input.examId,
          questionText || 'سؤال مقالي',
          points,
          questionImage || null,
          modelAnswer,
          modelImage || null,
          cleanText(input.rubric) || null,
        ],
      );
      return { scope: 'lecture' as const, question: result.rows[0] };
    }

    await this.assertCourseExamTeacher(input.examId, user);
    const result = await pool.query(
      `INSERT INTO course_level_exam_questions (
         exam_id, type, question_text, question_image, option_a, option_b, option_c, option_d,
         correct_answer, created_by, model_answer, model_answer_image, points, rubric
       ) VALUES ($1, 'ESSAY', $2, $3, '-', '-', '-', '-', NULL, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        input.examId,
        questionText || null,
        questionImage || null,
        user.id,
        modelAnswer,
        modelImage || null,
        points,
        cleanText(input.rubric) || null,
      ],
    );
    return { scope: 'course' as const, question: result.rows[0] };
  }

  static async persistCourseDrafts(
    attemptId: number,
    essayQuestions: Array<{ id: number }>,
    drafts: EssayDraft[],
  ) {
    if (!essayQuestions.length) return;
    const incoming = new Map(drafts.map((draft) => [draft.questionId, draft]));
    for (const question of essayQuestions) {
      const draft = incoming.get(Number(question.id));
      if (!draft) {
        await pool.query(
          `INSERT INTO course_level_exam_answers (
             attempt_id, question_id, selected_answer, is_correct, grading_status
           ) VALUES ($1, $2, NULL, FALSE, 'pending')
           ON CONFLICT (attempt_id, question_id) DO NOTHING`,
          [attemptId, question.id],
        );
        continue;
      }
      await pool.query(
        `INSERT INTO course_level_exam_answers (
           attempt_id, question_id, selected_answer, is_correct, answer_text, answer_images,
           ocr_text, grading_status
         ) VALUES ($1, $2, NULL, FALSE, $3, $4::jsonb, $5, 'pending')
         ON CONFLICT (attempt_id, question_id) DO UPDATE SET
           answer_text = EXCLUDED.answer_text,
           answer_images = EXCLUDED.answer_images,
           ocr_text = EXCLUDED.ocr_text,
           grading_status = CASE
             WHEN course_level_exam_answers.reviewed_at IS NULL
              AND course_level_exam_answers.final_score IS NULL
             THEN 'pending' ELSE course_level_exam_answers.grading_status END`,
        [
          attemptId,
          question.id,
          draft.answerText ?? null,
          JSON.stringify(draft.answerImages || []),
          draft.ocrText ?? null,
        ],
      );
    }
  }

  static async persistLectureDrafts(
    submissionId: number,
    essayQuestionIds: number[],
    drafts: EssayDraft[],
  ) {
    if (!essayQuestionIds.length) return;
    const incoming = new Map(drafts.map((draft) => [draft.questionId, draft]));
    for (const questionId of essayQuestionIds) {
      const draft = incoming.get(questionId);
      if (!draft) {
        await pool.query(
          `INSERT INTO exam_answers (
             submission_id, question_id, is_correct, answer_text, grade, grading_status
           ) VALUES ($1, $2, FALSE, NULL, 0, 'pending')
           ON CONFLICT (submission_id, question_id) DO NOTHING`,
          [submissionId, questionId],
        );
        continue;
      }
      await pool.query(
        `INSERT INTO exam_answers (
           submission_id, question_id, is_correct, answer_text, answer_images, ocr_text, grade, grading_status
         ) VALUES ($1, $2, FALSE, $3, $4::jsonb, $5, 0, 'pending')
         ON CONFLICT (submission_id, question_id) DO UPDATE SET
           answer_text = EXCLUDED.answer_text,
           answer_images = EXCLUDED.answer_images,
           ocr_text = EXCLUDED.ocr_text,
           grading_status = CASE
             WHEN exam_answers.reviewed_at IS NULL AND exam_answers.final_score IS NULL
             THEN 'pending' ELSE exam_answers.grading_status END`,
        [
          submissionId,
          questionId,
          draft.answerText ?? null,
          JSON.stringify(draft.answerImages || []),
          draft.ocrText ?? null,
        ],
      );
    }
  }

  static async recomputeCourseAttempt(attemptId: number, options: { syncPoints?: boolean } = {}) {
    const updated = await pool.query(
      `UPDATE course_level_exam_attempts a
       SET obtained_grade = src.obtained,
           total_grade = src.max_grade
       FROM (
         SELECT
           COALESCE(SUM(
             CASE
               WHEN q.type = 'ESSAY' THEN COALESCE(ans.final_score, 0)
               WHEN ans.is_correct THEN 1
               ELSE 0
             END
           ), 0) AS obtained,
           COALESCE(SUM(
             CASE WHEN q.type = 'ESSAY' THEN COALESCE(q.points, 1) ELSE 1 END
           ), 0) AS max_grade
         FROM course_level_exam_answers ans
         JOIN course_level_exam_questions q ON q.id = ans.question_id
         WHERE ans.attempt_id = $1
       ) src
       WHERE a.id = $1
       RETURNING a.obtained_grade, a.total_grade, a.student_id, a.exam_id`,
      [attemptId],
    );
    const row = updated.rows[0];
    if (row && options.syncPoints) {
      const { CourseLevelExamsService } = await import('./courseLevelExams.js');
      await CourseLevelExamsService.syncStoredCourseAttemptPoints(
        attemptId,
        Number(row.obtained_grade ?? 0),
        Number(row.total_grade ?? 0),
      );
    }
    return {
      obtained: Number(row?.obtained_grade ?? 0),
      max: Number(row?.total_grade ?? 0),
    };
  }

  static async recomputeLectureSubmission(submissionId: number) {
    const updated = await pool.query(
      `UPDATE exam_submissions s
       SET total_grade = src.obtained,
           passed = src.obtained >= CEIL(src.max_grade / 2.0)
       FROM (
         SELECT
           COALESCE(SUM(
             CASE
               WHEN q.question_kind = 'essay' THEN COALESCE(a.final_score, 0)
               ELSE COALESCE(a.grade, 0)
             END
           ), 0) AS obtained,
           COALESCE(SUM(COALESCE(q.grade, 1)), 0) AS max_grade
         FROM exam_answers a
         JOIN exam_questions q ON q.id = a.question_id
         WHERE a.submission_id = $1
       ) src
       WHERE s.id = $1
       RETURNING s.total_grade, src.max_grade`,
      [submissionId],
    );
    return {
      obtained: Number(updated.rows[0]?.total_grade ?? 0),
      max: Number(updated.rows[0]?.max_grade ?? 0),
    };
  }

  static scheduleCourseGrading(attemptId: number) {
    setImmediate(() => {
      this.gradeCourseAttempt(attemptId, { syncPoints: true }).catch((error) => {
        console.error('essay course grading failed', error);
      });
    });
  }

  static scheduleLectureGrading(submissionId: number) {
    setImmediate(() => {
      this.gradeLectureSubmission(submissionId).catch((error) => {
        console.error('essay lecture grading failed', error);
      });
    });
  }

  /** يصحح المقالية فورًا قبل إرجاع نتيجة التسليم للطالب */
  static async gradeCourseAttempt(
    attemptId: number,
    options: { syncPoints?: boolean } = {},
  ) {
    const res = await pool.query(
      `SELECT a.id, a.answer_text, a.ocr_text, a.answer_images,
              q.question_text, q.question_image, q.model_answer, q.rubric, q.points
       FROM course_level_exam_answers a
       JOIN course_level_exam_questions q ON q.id = a.question_id
       WHERE a.attempt_id = $1
         AND q.type = 'ESSAY'
         AND a.grading_status = 'pending'
         AND a.final_score IS NULL
         AND a.reviewed_at IS NULL`,
      [attemptId],
    );
    for (const row of res.rows) {
      await this.gradeCourseRow(row);
    }
    if (res.rowCount) {
      await this.recomputeCourseAttempt(attemptId, { syncPoints: !!options.syncPoints });
    }
  }

  static async gradeLectureSubmission(submissionId: number) {
    const res = await pool.query(
      `SELECT a.id, a.answer_text, a.ocr_text, a.answer_images,
              q.question_text, q.image AS question_image, q.model_answer, q.rubric, q.grade AS points
       FROM exam_answers a
       JOIN exam_questions q ON q.id = a.question_id
       WHERE a.submission_id = $1
         AND q.question_kind = 'essay'
         AND a.grading_status = 'pending'
         AND a.final_score IS NULL
         AND a.reviewed_at IS NULL`,
      [submissionId],
    );
    for (const row of res.rows) {
      await this.gradeLectureRow(row);
    }
    if (res.rowCount) await this.recomputeLectureSubmission(submissionId);
  }

  private static async gradeCourseRow(row: any) {
    const claimed = await pool.query(
      `UPDATE course_level_exam_answers
       SET grading_status = 'grading'
       WHERE id = $1 AND grading_status = 'pending' AND final_score IS NULL AND reviewed_at IS NULL
       RETURNING id`,
      [row.id],
    );
    if (!claimed.rowCount) return;
    const decision = await this.decideRow(row);
    await pool.query(
      `UPDATE course_level_exam_answers
       SET grading_status = $2,
           awarded_score = $3,
           final_score = $4,
           is_correct = $5,
           ai_result = $6::jsonb
       WHERE id = $1 AND reviewed_at IS NULL AND grading_status = 'grading'`,
      [
        row.id,
        decision.status,
        decision.awardedScore,
        decision.finalScore,
        decision.status === 'correct',
        JSON.stringify(decision),
      ],
    );
    await this.writeLog('course', Number(row.id), null, null, decision.finalScore, decision.status, decision.reason);
  }

  private static async gradeLectureRow(row: any) {
    const claimed = await pool.query(
      `UPDATE exam_answers
       SET grading_status = 'grading'
       WHERE id = $1 AND grading_status = 'pending' AND final_score IS NULL AND reviewed_at IS NULL
       RETURNING id`,
      [row.id],
    );
    if (!claimed.rowCount) return;
    const decision = await this.decideRow(row);
    await pool.query(
      `UPDATE exam_answers
       SET grading_status = $2,
           awarded_score = $3,
           final_score = $4,
           grade = COALESCE($4, 0),
           is_correct = $5,
           ai_result = $6::jsonb
       WHERE id = $1 AND reviewed_at IS NULL AND grading_status = 'grading'`,
      [
        row.id,
        decision.status,
        decision.awardedScore,
        decision.finalScore,
        decision.status === 'correct',
        JSON.stringify(decision),
      ],
    );
    await this.writeLog('lecture', Number(row.id), null, null, decision.finalScore, decision.status, decision.reason);
  }

  private static async decideRow(row: any) {
    const images = imageList(row.answer_images);
    const answerText = row.answer_text == null ? null : String(row.answer_text);
    const ocrText = row.ocr_text == null ? null : String(row.ocr_text);
    const studentAnswer = studentAnswerForGrading(answerText, ocrText);
    const hasContent = Boolean(studentAnswer) || images.length > 0;
    const readable = readableAnswer(answerText, ocrText, images);
    const maxScore = Number(row.points ?? 1);
    if (!hasContent || !readable) {
      return decideEssayOutcome(null, maxScore, { hasContent, readable });
    }
    return evaluateEssayWithDeepSeek({
      questionText: cleanText(row.question_text) || 'سؤال مقالي',
      questionImageNote: row.question_image ? 'يوجد صورة مرفقة بالسؤال' : null,
      modelAnswer: cleanText(row.model_answer),
      rubric: row.rubric,
      studentAnswer,
      maxScore,
    });
  }

  static async summarizeCourseEssays(attemptId: number) {
    const res = await pool.query(
      `SELECT a.question_id, a.grading_status, a.final_score, a.teacher_note, q.points
       FROM course_level_exam_answers a
       JOIN course_level_exam_questions q ON q.id = a.question_id
       WHERE a.attempt_id = $1 AND q.type = 'ESSAY'
       ORDER BY a.question_id`,
      [attemptId],
    );
    return this.mapStudentSummary(res.rows, 'points');
  }

  static async summarizeLectureEssays(submissionId: number) {
    const res = await pool.query(
      `SELECT a.question_id, a.grading_status, a.final_score, a.teacher_note, q.grade AS points
       FROM exam_answers a
       JOIN exam_questions q ON q.id = a.question_id
       WHERE a.submission_id = $1 AND q.question_kind = 'essay'
       ORDER BY a.question_id`,
      [submissionId],
    );
    return this.mapStudentSummary(res.rows, 'points');
  }

  private static mapStudentSummary(rows: any[], pointsKey: string) {
    const essayQuestions = rows.map((row) => {
      const view = studentEssayStatus(row.grading_status);
      return {
        questionId: Number(row.question_id),
        status: view.pending ? 'needs_review' : row.grading_status,
        statusLabel: view.label,
        score: row.final_score == null ? null : Number(row.final_score),
        maxScore: Number(row.points ?? row[pointsKey] ?? 0),
        teacherNote: row.teacher_note || null,
        pending: view.pending,
      };
    });
    return {
      essayQuestions,
      essayNotice: essayQuestions.some((item) => item.pending) ? PENDING_NOTICE : null,
    };
  }

  /** أسئلة مقالية اعتُمدت خاطئة — للعرض مع الأسئلة الموضوعية الخاطئة */
  static async listIncorrectCourseEssays(attemptId: number) {
    const res = await pool.query(
      `SELECT a.question_id, a.answer_text, a.answer_images, a.ocr_text, a.final_score,
              a.grading_status, a.teacher_note,
              q.question_text, q.question_image, q.model_answer, q.model_answer_image, q.points
       FROM course_level_exam_answers a
       JOIN course_level_exam_questions q ON q.id = a.question_id
       WHERE a.attempt_id = $1
         AND q.type = 'ESSAY'
         AND a.grading_status = 'incorrect'`,
      [attemptId],
    );
    return res.rows.map((row) => this.mapIncorrectEssay(row));
  }

  static async listIncorrectLectureEssays(submissionId: number) {
    const res = await pool.query(
      `SELECT a.question_id, a.answer_text, a.answer_images, a.ocr_text, a.final_score,
              a.grading_status, a.teacher_note,
              q.question_text, q.image AS question_image, q.model_answer, q.model_answer_image,
              q.grade AS points
       FROM exam_answers a
       JOIN exam_questions q ON q.id = a.question_id
       WHERE a.submission_id = $1
         AND q.question_kind = 'essay'
         AND a.grading_status = 'incorrect'`,
      [submissionId],
    );
    return res.rows.map((row) => this.mapIncorrectEssay(row));
  }

  private static mapIncorrectEssay(row: any) {
    const yourText =
      cleanText(row.answer_text) || cleanText(row.ocr_text) || null;
    return {
      questionId: Number(row.question_id),
      type: 'ESSAY',
      questionText: row.question_text,
      questionImage: row.question_image,
      yourAnswer: null,
      yourAnswerText: yourText,
      yourAnswerImages: imageList(row.answer_images),
      correctAnswer: null,
      correctAnswers: [],
      correctAnswerText: cleanText(row.model_answer) || null,
      correctAnswerImage: row.model_answer_image || null,
      unanswered: !yourText && imageList(row.answer_images).length === 0,
      score: row.final_score == null ? 0 : Number(row.final_score),
      maxScore: Number(row.points ?? 0),
      gradingStatus: row.grading_status,
      teacherNote: row.teacher_note || null,
      optionA: null,
      optionB: null,
      optionC: null,
      optionD: null,
    };
  }

  static async listForTeacher(user: RequestUser, filters: {
    status?: string;
    examId?: number;
    scope?: string;
  }) {
    if (!TEACHER_ROLES.has(user.role)) throw new HttpError(403, 'غير مسموح');
    const status = cleanText(filters.status) || 'needs_review';
    const examId = filters.examId && filters.examId > 0 ? filters.examId : null;
    const scope = filters.scope === 'lecture' || filters.scope === 'course' ? filters.scope : null;
    const teacherFilter = user.role === 'admin' ? null : user.id;
    const items = [];

    if (scope !== 'lecture') {
      const course = await pool.query(
        `SELECT a.id AS answer_id, a.answer_text, a.answer_images, a.ocr_text, a.grading_status,
                a.awarded_score, a.final_score, a.ai_result, a.teacher_note, a.created_at,
                att.submitted_at, att.student_id, u.name AS student_name,
                e.id AS exam_id, e.title AS exam_title, e.exam_scope,
                g.name AS grade_name, grp.group_name,
                q.id AS question_id, q.question_text, q.question_image, q.model_answer,
                q.model_answer_image, q.points, q.rubric
         FROM course_level_exam_answers a
         JOIN course_level_exam_attempts att ON att.id = a.attempt_id
         JOIN course_level_exam_questions q ON q.id = a.question_id
         JOIN course_level_exams e ON e.id = q.exam_id
         JOIN users u ON u.id = att.student_id
         LEFT JOIN courses c ON c.id = e.course_id
         LEFT JOIN grades g ON g.id = e.grade_id
         LEFT JOIN LATERAL (
           SELECT sg.name AS group_name
           FROM group_students gs
           JOIN study_groups sg ON sg.id = gs.group_id
           WHERE gs.student_id = att.student_id
           ORDER BY gs.id DESC
           LIMIT 1
         ) grp ON TRUE
         WHERE q.type = 'ESSAY'
           AND att.status = 'submitted'
           AND ($1::text = 'all' OR a.grading_status = $1)
           AND ($2::int IS NULL OR e.id = $2)
           AND ($3::int IS NULL OR COALESCE(e.teacher_id, c.teacher_id) = $3)
         ORDER BY att.submitted_at DESC NULLS LAST
         LIMIT 100`,
        [status, examId, teacherFilter],
      );
      items.push(...course.rows.map((row) => this.mapReviewRow(row, 'course')));
    }

    if (scope !== 'course') {
      const lecture = await pool.query(
        `SELECT a.id AS answer_id, a.answer_text, a.answer_images, a.ocr_text, a.grading_status,
                a.awarded_score, a.final_score, a.ai_result, a.teacher_note,
                s.submitted_at, s.student_id, u.name AS student_name,
                e.id AS exam_id, e.title AS exam_title, e.type AS exam_scope,
                g.name AS grade_name, grp.group_name,
                q.id AS question_id, q.question_text, q.image AS question_image, q.model_answer,
                q.model_answer_image, q.grade AS points, q.rubric
         FROM exam_answers a
         JOIN exam_submissions s ON s.id = a.submission_id
         JOIN exam_questions q ON q.id = a.question_id
         JOIN exams e ON e.id = q.exam_id
         JOIN users u ON u.id = s.student_id
         LEFT JOIN courses c ON c.id = e.course_id
         LEFT JOIN lectures l ON l.id = e.lecture_id
         LEFT JOIN courses c2 ON c2.id = l.course_id
         LEFT JOIN grades g ON g.id = COALESCE(c.grade_id, c2.grade_id)
         LEFT JOIN LATERAL (
           SELECT sg.name AS group_name
           FROM group_students gs
           JOIN study_groups sg ON sg.id = gs.group_id
           WHERE gs.student_id = s.student_id
           ORDER BY gs.id DESC
           LIMIT 1
         ) grp ON TRUE
         WHERE q.question_kind = 'essay'
           AND s.status = 'submitted'
           AND ($1::text = 'all' OR a.grading_status = $1)
           AND ($2::int IS NULL OR e.id = $2)
           AND ($3::int IS NULL OR e.created_by = $3 OR COALESCE(c.teacher_id, c2.teacher_id) = $3)
         ORDER BY s.submitted_at DESC NULLS LAST
         LIMIT 100`,
        [status, examId, teacherFilter],
      );
      items.push(...lecture.rows.map((row) => this.mapReviewRow(row, 'lecture')));
    }

    items.sort((a, b) => String(b.submittedAt || '').localeCompare(String(a.submittedAt || '')));
    return items.slice(0, 100);
  }

  private static mapReviewRow(row: any, source: 'course' | 'lecture') {
    const ai = row.ai_result && typeof row.ai_result === 'object' ? row.ai_result : {};
    return {
      source,
      answerId: Number(row.answer_id),
      studentId: Number(row.student_id),
      studentName: row.student_name,
      gradeName: row.grade_name || null,
      groupName: row.group_name || null,
      examId: Number(row.exam_id),
      examTitle: row.exam_title,
      examScope: row.exam_scope,
      questionId: Number(row.question_id),
      questionText: row.question_text,
      questionImage: row.question_image,
      modelAnswer: row.model_answer,
      modelAnswerImage: row.model_answer_image,
      rubric: row.rubric,
      answerText: row.answer_text,
      answerImages: imageList(row.answer_images),
      ocrText: row.ocr_text,
      maxScore: Number(row.points ?? 0),
      awardedScore: row.awarded_score == null ? null : Number(row.awarded_score),
      finalScore: row.final_score == null ? null : Number(row.final_score),
      gradingStatus: row.grading_status,
      aiReason: ai.reason || null,
      matchedPoints: Array.isArray(ai.matchedPoints) ? ai.matchedPoints : ai.matched_points || [],
      missingPoints: Array.isArray(ai.missingPoints) ? ai.missingPoints : ai.missing_points || [],
      errors: Array.isArray(ai.errors) ? ai.errors : [],
      teacherNote: row.teacher_note,
      submittedAt: row.submitted_at,
    };
  }

  static async decide(user: RequestUser, input: {
    source: 'course' | 'lecture';
    answerId: number;
    score: number;
    note?: string | null;
  }) {
    if (!TEACHER_ROLES.has(user.role)) throw new HttpError(403, 'غير مسموح');
    const score = Number(input.score);
    if (!Number.isFinite(score) || score < 0) throw new HttpError(400, 'الدرجة غير صالحة');

    if (input.source === 'lecture') {
      const current = await pool.query(
        `SELECT a.id, a.final_score, a.submission_id, q.grade AS points, e.id AS exam_id, e.created_by,
                COALESCE(c.teacher_id, c2.teacher_id) AS teacher_id
         FROM exam_answers a
         JOIN exam_questions q ON q.id = a.question_id
         JOIN exam_submissions s ON s.id = a.submission_id
         JOIN exams e ON e.id = s.exam_id
         LEFT JOIN courses c ON c.id = e.course_id
         LEFT JOIN lectures l ON l.id = e.lecture_id
         LEFT JOIN courses c2 ON c2.id = l.course_id
         WHERE a.id = $1 AND q.question_kind = 'essay'`,
        [input.answerId],
      );
      if (!current.rowCount) throw new HttpError(404, 'الإجابة غير موجودة');
      const row = current.rows[0];
      if (
        user.role !== 'admin' &&
        Number(row.created_by) !== user.id &&
        Number(row.teacher_id) !== user.id
      ) {
        throw new HttpError(403, 'غير مسموح بمراجعة هذه الإجابة');
      }
      const max = Number(row.points ?? 0);
      if (score > max) throw new HttpError(400, 'الدرجة أكبر من درجة السؤال');
      const status = score <= 0 ? 'incorrect' : score >= max ? 'correct' : 'graded';
      await pool.query(
        `UPDATE exam_answers
         SET final_score = $2, teacher_score = $2, grade = $2, is_correct = $3,
             grading_status = $4, teacher_note = $5, reviewed_by = $6, reviewed_at = NOW()
         WHERE id = $1`,
        [input.answerId, score, status === 'correct', status, cleanText(input.note) || null, user.id],
      );
      await this.writeLog('lecture', input.answerId, user.id, row.final_score, score, status, input.note);
      const totals = await this.recomputeLectureSubmission(Number(row.submission_id));
      return { source: 'lecture', answerId: input.answerId, status, score, ...totals };
    }

    const current = await pool.query(
      `SELECT a.id, a.final_score, a.attempt_id, q.points,
              COALESCE(e.teacher_id, c.teacher_id) AS teacher_id
       FROM course_level_exam_answers a
       JOIN course_level_exam_questions q ON q.id = a.question_id
       JOIN course_level_exam_attempts att ON att.id = a.attempt_id
       JOIN course_level_exams e ON e.id = att.exam_id
       LEFT JOIN courses c ON c.id = e.course_id
       WHERE a.id = $1 AND q.type = 'ESSAY'`,
      [input.answerId],
    );
    if (!current.rowCount) throw new HttpError(404, 'الإجابة غير موجودة');
    const row = current.rows[0];
    if (user.role !== 'admin' && Number(row.teacher_id) !== user.id) {
      throw new HttpError(403, 'غير مسموح بمراجعة هذه الإجابة');
    }
    const max = Number(row.points ?? 0);
    if (score > max) throw new HttpError(400, 'الدرجة أكبر من درجة السؤال');
    const status = score <= 0 ? 'incorrect' : score >= max ? 'correct' : 'graded';
    await pool.query(
      `UPDATE course_level_exam_answers
       SET final_score = $2, teacher_score = $2, is_correct = $3, grading_status = $4,
           teacher_note = $5, reviewed_by = $6, reviewed_at = NOW()
       WHERE id = $1`,
      [input.answerId, score, status === 'correct', status, cleanText(input.note) || null, user.id],
    );
    await this.writeLog('course', input.answerId, user.id, row.final_score, score, status, input.note);
    const totals = await this.recomputeCourseAttempt(Number(row.attempt_id), { syncPoints: true });
    return { source: 'course', answerId: input.answerId, status, score, ...totals };
  }

  private static async writeLog(
    source: 'course' | 'lecture',
    answerId: number,
    actorId: number | null,
    previousScore: number | null,
    newScore: number | null,
    status: string,
    note?: string | null,
  ) {
    await pool.query(
      `INSERT INTO essay_grade_log (source, answer_id, actor_id, previous_score, new_score, status, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [source, answerId, actorId, previousScore, newScore, status, cleanText(note) || null],
    );
  }
}
