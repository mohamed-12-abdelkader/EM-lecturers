import type { PoolClient } from 'pg';
import pool from '../db/pool';
import {
  calculateRemainingSeconds,
  determineAnswerRelease,
  isPastExpiry,
  shouldPreventNewAttempt,
  type AttemptSnapshot,
  type ReleaseDecision,
} from './examPolicies';
import {
  attemptQuestionSeed,
  canStudentStartExam,
  flagsFromAnswersReleaseMode,
  getStudentExamAvailability,
  inferAnswersReleaseMode,
  lectureExamAvailabilityInput,
  normalizeAnswersReleaseMode,
  normalizeQuestionDisplayMode,
  orderItemsByIds,
  parseSelectedQuestionIds,
  selectAttemptQuestions,
} from './examAccessPolicy';
import { CourseAccessControl } from './courseAccessControl';

type UserRole = 'student' | 'teacher' | 'admin' | 'employee' | 'academy' | 'academy_teacher';

interface RequestUser {
  id: number;
  role: UserRole;
  tenant_id?: number | null;
}

interface AnswerPayload {
  questionId: number;
  choiceId?: number | null;
}

type LectureExamRecordType = 'exam' | 'assignment';

interface CreateExamPayload {
  lectureId: number;
  type?: string;
  title?: string;
  totalGrade?: number;
  duration?: number | null;
  isVisible?: boolean;
  showAt?: string | null;
  hideAt?: string | null;
  lockNextLectures?: boolean;
  showAnswersImmediately?: boolean;
  showAnswersAfterHours?: number;
  allowMultipleAttempts?: boolean;
  showAnswersLater?: boolean;
  answersReleaseDate?: string | null;
  answersReleaseMode?: string | null;
  questionsCount?: number | null;
  questionDisplayMode?: string | null;
  timeLimitEnabled?: boolean;
  timeLimitMinutes?: number | null;
  startWindow?: string | null;
  endWindow?: string | null;
}

interface StartAttemptResult {
  attemptId: number;
  attemptStartTime: string;
  attemptExpireAt: string | null;
  remainingSeconds: number | null;
  timeLimitMinutes: number | null;
}

interface SubmitAttemptParams {
  examId: number;
  studentId: number;
  answers: AnswerPayload[];
  attemptId?: number;
  allowAutoStart?: boolean;
}

interface SubmitAttemptResult {
  attemptId: number;
  status: 'submitted' | 'late';
  totalGrade: number;
  maxGrade: number;
  passed: boolean;
  wrongQuestions: WrongQuestion[];
  released: boolean;
  releaseReason?: string;
}

interface WrongQuestion {
  questionId: number;
  questionText: string | null;
  questionImage: string | null;
  correctChoice: { id: number | null; text: string | null } | null;
  yourChoice: { id: number | null; text: string | null } | null;
}

interface AttemptAnswersDetail {
  questionId: number;
  questionText: string | null;
  questionImage: string | null;
  selectedChoice: { id: number | null; text: string | null };
  correctChoice: { id: number | null; text: string | null } | null;
  isCorrect: boolean;
}

interface ExamQuestion {
  id: number;
  questionBankId: number | null;
  text: string | null;
  image: string | null;
  grade: number;
  passage_id?: number | null;
  passage?: { id: number | null; title?: string | null; content: string } | null;
  /** من بنك الأسئلة V2: يستخدم عند عدم وجود صفوف في question_options لإنشاء خيارات افتراضية أ، ب، ج، د */
  correct_answer_index?: number | null;
  /** تجاوز الإجابة الصحيحة في هذا الامتحان فقط (0=أ، 1=ب، 2=ج، 3=د) */
  correct_answer_index_override?: number | null;
  /** false = مخفي من الامتحان (لا يظهر للطالب) */
  isVisible?: boolean;
  choices: {
    id: number;
    text: string;
    image?: string | null;
    isCorrect: boolean;
  }[];
}

function normalizeChoiceContent(
  text: string | null | undefined,
  imageUrl?: string | null,
): { text: string; image: string | null } {
  if (imageUrl?.trim()) {
    return { text: text?.trim() || '', image: imageUrl.trim() };
  }
  const value = text?.trim() ?? '';
  if (/^https?:\/\//i.test(value)) {
    return { text: '', image: value };
  }
  return { text: value, image: null };
}

interface QuestionEvaluation extends WrongQuestion {
  grade: number;
  isCorrect: boolean;
  selectedChoiceId: number | null;
  correctChoiceId: number | null;
}

interface QuestionReportStudent {
  studentId: number;
  studentName: string | null;
  studentEmail?: string | null;
  submissionId: number | null;
  attemptNumber: number | null;
  selectedChoiceId?: number | null;
  selectedAnswerText?: string | null;
}

interface QuestionReportEntry {
  questionId: number;
  questionText: string | null;
  questionImage: string | null;
  grade: number;
  totalResponses: number;
  correctCount: number;
  incorrectCount: number;
  unansweredCount?: number;
  correctStudents: QuestionReportStudent[];
  incorrectStudents: QuestionReportStudent[];
  unansweredStudents?: QuestionReportStudent[];
}

function normalizeLectureExamType(
  value: unknown,
  fallback: LectureExamRecordType = 'exam',
): LectureExamRecordType {
  if (typeof value !== 'string') return fallback;
  const raw = value.trim().toLowerCase();
  if (raw === 'assignment' || raw === 'homework' || raw === 'task') return 'assignment';
  if (raw === 'exam' || raw === 'quiz' || raw === 'test') return 'exam';
  return fallback;
}

function parseLectureExamTypeFilter(value?: string): LectureExamRecordType | 'all' | null {
  if (!value?.trim()) return null;
  const raw = value.trim().toLowerCase();
  if (raw === 'all' || raw === 'any' || raw === '*') return 'all';
  return normalizeLectureExamType(raw, 'exam');
}

export class ExamFlowService {
  private static async canUserManageCourse(userId: number, courseId: number): Promise<boolean> {
    const u = await pool.query<{ role: string; tenant_id: number | null }>(
      `SELECT role, tenant_id FROM users WHERE id = $1`,
      [userId],
    );
    if (!u.rowCount) return false;
    return CourseAccessControl.canManageCourse(
      { id: userId, role: u.rows[0].role, tenant_id: u.rows[0].tenant_id },
      courseId,
    );
  }
  /**
   * تحويل نص Bulk لأسئلة MCQ (يدعم: 1- ... + (أ)/(ب)/(ج)/(د) أو A/B/C/D)
   */
  static parsePassageMcqBulkText(
    bulkText: string,
  ): Array<{
    questionText: string;
    optionA: string;
    optionB: string;
    optionC: string;
    optionD: string;
    correctAnswer: 'A';
    points?: number;
  }> {
    const text = String(bulkText || '').replace(/\r\n/g, '\n').trim();
    if (!text) return [];

    const lines = text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    const questions: Array<{
      questionText: string;
      optionA: string;
      optionB: string;
      optionC: string;
      optionD: string;
      correctAnswer: 'A';
      points?: number;
    }> = [];

    type Draft = {
      questionText: string;
      optionA?: string;
      optionB?: string;
      optionC?: string;
      optionD?: string;
    };

    let current: Draft | null = null;

    const optionRegex =
      /^\(?\s*(أ|ا|ب|ج|د|A|B|C|D)\s*\)?\s*[).:\-]?\s*(.+)$/i;
    const questionStartRegex = /^\d+\s*[-.)]\s*(.+)$/;

    const pushCurrentIfComplete = () => {
      if (
        current &&
        current.questionText &&
        current.optionA &&
        current.optionB &&
        current.optionC &&
        current.optionD
      ) {
        questions.push({
          questionText: current.questionText.trim(),
          optionA: current.optionA.trim(),
          optionB: current.optionB.trim(),
          optionC: current.optionC.trim(),
          optionD: current.optionD.trim(),
          // عند عدم إرسال مفتاح إجابة صريح في النص، نستخدم A كقيمة افتراضية
          correctAnswer: 'A',
          points: 1,
        });
      }
      current = null;
    };

    for (const line of lines) {
      const questionMatch = line.match(questionStartRegex);
      if (questionMatch) {
        pushCurrentIfComplete();
        current = { questionText: questionMatch[1].trim() };
        continue;
      }

      const optionMatch = line.match(optionRegex);
      if (optionMatch && current) {
        const rawKey = optionMatch[1].toUpperCase();
        const value = optionMatch[2].trim();
        if (!value) continue;

        if (rawKey === 'أ' || rawKey === 'ا' || rawKey === 'A') current.optionA = value;
        else if (rawKey === 'ب' || rawKey === 'B') current.optionB = value;
        else if (rawKey === 'ج' || rawKey === 'C') current.optionC = value;
        else if (rawKey === 'د' || rawKey === 'D') current.optionD = value;
        continue;
      }

      // سطر تكميلي لنص السؤال (قبل بدء الاختيارات)
      if (current && !current.optionA) {
        current.questionText = `${current.questionText} ${line}`.trim();
      }
    }

    pushCurrentIfComplete();
    return questions;
  }

  static async createExam(teacherId: number, payload: CreateExamPayload) {
    const {
      lectureId,
      type,
      title,
      totalGrade,
      duration,
      isVisible,
      showAt,
      hideAt,
      lockNextLectures,
      showAnswersImmediately,
      showAnswersAfterHours,
      allowMultipleAttempts,
      showAnswersLater,
      answersReleaseDate,
      answersReleaseMode,
      questionsCount,
      questionDisplayMode,
      timeLimitEnabled,
      timeLimitMinutes,
      startWindow,
      endWindow,
    } = payload;

    if (!lectureId || Number.isNaN(Number(lectureId))) {
      const error: any = new Error('lectureId is required');
      error.status = 400;
      throw error;
    }

    const lectureRes = await pool.query(
      `SELECT l.id, l.course_id, c.teacher_id
       FROM lectures l
       JOIN courses c ON l.course_id = c.id
       WHERE l.id = $1`,
      [lectureId],
    );

    if (!lectureRes.rowCount) {
      const error: any = new Error('Lecture not found');
      error.status = 404;
      throw error;
    }

    if (
      lectureRes.rows[0].teacher_id !== teacherId &&
      !(await this.canUserManageCourse(teacherId, Number(lectureRes.rows[0].course_id)))
    ) {
      const error: any = new Error('You do not own this lecture');
      error.status = 403;
      throw error;
    }

    const normalizedTimeLimitMinutes =
      timeLimitMinutes === undefined || timeLimitMinutes === null ? null : Number(timeLimitMinutes);
    if (normalizedTimeLimitMinutes !== null && Number.isNaN(normalizedTimeLimitMinutes)) {
      const error: any = new Error('timeLimitMinutes must be a valid number');
      error.status = 400;
      throw error;
    }

    if (timeLimitEnabled && (!normalizedTimeLimitMinutes || normalizedTimeLimitMinutes <= 0)) {
      const error: any = new Error(
        'Provide a positive timeLimitMinutes value when enabling the timer',
      );
      error.status = 400;
      throw error;
    }

    const normalizedAnswersReleaseDate = answersReleaseDate ? new Date(answersReleaseDate) : null;
    if (normalizedAnswersReleaseDate && Number.isNaN(normalizedAnswersReleaseDate.getTime())) {
      const error: any = new Error('answersReleaseDate must be a valid ISO date');
      error.status = 400;
      throw error;
    }
    if (showAnswersLater && !normalizedAnswersReleaseDate) {
      const error: any = new Error(
        'answersReleaseDate is required when showAnswersLater is enabled',
      );
      error.status = 400;
      throw error;
    }

    const normalizedStartWindow = startWindow ? new Date(startWindow) : null;
    if (normalizedStartWindow && Number.isNaN(normalizedStartWindow.getTime())) {
      const error: any = new Error('startWindow must be a valid ISO date');
      error.status = 400;
      throw error;
    }
    const normalizedEndWindow = endWindow ? new Date(endWindow) : null;
    if (normalizedEndWindow && Number.isNaN(normalizedEndWindow.getTime())) {
      const error: any = new Error('endWindow must be a valid ISO date');
      error.status = 400;
      throw error;
    }
    if (
      normalizedStartWindow &&
      normalizedEndWindow &&
      normalizedStartWindow.getTime() > normalizedEndWindow.getTime()
    ) {
      const error: any = new Error('startWindow must be earlier than endWindow');
      error.status = 400;
      throw error;
    }

    const normalizedShowAt = showAt ? new Date(showAt) : null;
    const normalizedHideAt = hideAt ? new Date(hideAt) : null;
    const examType = normalizeLectureExamType(type, 'exam');

    const normalizedQuestionsCount =
      questionsCount === undefined || questionsCount === null
        ? null
        : Number(questionsCount);
    if (
      normalizedQuestionsCount !== null &&
      (!Number.isFinite(normalizedQuestionsCount) || normalizedQuestionsCount <= 0)
    ) {
      const error: any = new Error('questionsCount must be a positive number');
      error.status = 400;
      throw error;
    }

    const resolvedDisplayMode = normalizeQuestionDisplayMode(questionDisplayMode);
    const resolvedReleaseMode = answersReleaseMode
      ? normalizeAnswersReleaseMode(answersReleaseMode)
      : inferAnswersReleaseMode({
          showAnswersImmediately,
          showAnswersLater,
          answersReleaseDate: normalizedAnswersReleaseDate,
          showAnswersAfterHours,
        });
    const releaseFlags = flagsFromAnswersReleaseMode(resolvedReleaseMode, {
      afterHours: showAnswersAfterHours,
      scheduledDate: normalizedAnswersReleaseDate,
    });

    const result = await pool.query(
      `INSERT INTO exams (
        lecture_id, type, total_grade, created_by, title, duration, is_visible,
        show_at, hide_at, lock_next_lectures,
        show_answers_immediately, show_answers_after_hours,
        allow_multiple_attempts, show_answers_later, answers_release_date,
        time_limit_enabled, time_limit_minutes, start_window, end_window,
        questions_count, question_display_mode, answers_release_mode
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10,
        $11, $12,
        $13, $14, $15,
        $16, $17, $18, $19,
        $20, $21, $22
      ) RETURNING *`,
      [
        lectureId,
        examType,
        totalGrade ?? 100,
        teacherId,
        title?.trim() || (examType === 'assignment' ? 'Lecture Assignment' : 'Lecture Exam'),
        duration ?? null,
        isVisible ?? false,
        normalizedShowAt,
        normalizedHideAt,
        lockNextLectures ?? examType === 'assignment',
        releaseFlags.showAnswersImmediately,
        releaseFlags.showAnswersAfterHours,
        allowMultipleAttempts ?? false,
        releaseFlags.showAnswersLater,
        releaseFlags.answersReleaseDate,
        timeLimitEnabled ?? false,
        normalizedTimeLimitMinutes,
        normalizedStartWindow,
        normalizedEndWindow,
        normalizedQuestionsCount,
        resolvedDisplayMode,
        resolvedReleaseMode,
      ],
    );

    return this.mapExamRow(result.rows[0]);
  }

  static async addQuestionsFromBank(
    teacherId: number,
    examId: number,
    questionIds: number[],
    txClient?: PoolClient,
  ): Promise<{ addedCount: number; examQuestionIds: number[]; addedBankIds: number[] }> {
    const exam = await this.getExamWithCourse(examId);
    if (!exam) {
      const error: any = new Error('Exam not found');
      error.status = 404;
      throw error;
    }

    if (!(await this.canUserManageCourse(teacherId, Number(exam.course_id))) && exam.teacher_id !== teacherId) {
      const error: any = new Error('You do not own this exam');
      error.status = 403;
      throw error;
    }

    if (!questionIds || questionIds.length === 0) {
      return { addedCount: 0, examQuestionIds: [], addedBankIds: [] };
    }

    const db = txClient ?? pool;

    // Filter unique IDs
    const uniqueIds = [...new Set(questionIds)];
    let addedCount = 0;
    const examQuestionIds: number[] = [];
    const addedBankIds: number[] = [];

    // 1. Try to fetch and insert from V2 (New Question Bank) first
    const v2Result = await db.query(
      `INSERT INTO exam_questions (exam_id, question_id_v2, question_text, grade, image)
       SELECT $1, q.id, q.question_text, q.points, qm.media_url
       FROM questions_v2 q
       LEFT JOIN question_media qm ON q.id = qm.question_id
       WHERE q.id = ANY($2::int[])
       RETURNING id, question_id_v2`,
      [examId, uniqueIds],
    );
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    addedCount += v2Result.rowCount;
    v2Result.rows.forEach((r: { id: number; question_id_v2: number }) => {
      examQuestionIds.push(r.id);
      if (r.question_id_v2 != null) addedBankIds.push(r.question_id_v2);
    });
    const addedV2Ids = v2Result.rows.map((r: { question_id_v2: number }) => r.question_id_v2);

    // نسخة الخيارات داخل الامتحان (snapshot) حتى لا يتأثر الامتحان بتعديل البنك
    for (const row of v2Result.rows as { id: number; question_id_v2: number }[]) {
      try {
        await db.query(
          `INSERT INTO exam_question_options (exam_question_id, option_index, text_content)
           SELECT $1, qo.option_index, COALESCE(qo.text_content, qo.image_url, '')
           FROM question_options qo
           WHERE qo.question_id = $2
           ORDER BY qo.option_index`,
          [row.id, row.question_id_v2],
        );
      } catch {
        // الجدول قد يكون غير موجود قبل تشغيل migration 1700000007006
      }
    }

    // 2. Identify remaining IDs that were NOT found in V2
    const remainingIds = uniqueIds.filter((id) => !addedV2Ids.includes(id));

    // 3. Try to insert remaining IDs from V1 (Legacy) + نسخة الخيارات
    if (remainingIds.length > 0) {
      const v1Result = await db.query(
        `INSERT INTO exam_questions (exam_id, question_id, question_text, grade, image)
         SELECT $1, id, COALESCE(text, ''), COALESCE(points, 1), image
         FROM questions
         WHERE id = ANY($2::int[])
         RETURNING id, question_id`,
        [examId, remainingIds],
      );
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
      addedCount += v1Result.rowCount;
      (v1Result.rows as { id: number; question_id: number }[]).forEach((r) => {
        examQuestionIds.push(r.id);
        if (r.question_id != null) addedBankIds.push(r.question_id);
      });
      for (const row of v1Result.rows as { id: number; question_id: number }[]) {
        try {
          await db.query(
            `INSERT INTO exam_question_options (exam_question_id, option_index, text_content)
             SELECT $1, sub.rn - 1, sub.text
             FROM (
               SELECT qc.text, ROW_NUMBER() OVER (ORDER BY qc.id) AS rn
               FROM question_choices qc
               WHERE qc.question_id = $2
               LIMIT 4
             ) sub`,
            [row.id, row.question_id],
          );
        } catch {
          // الجدول قد يكون غير موجود قبل تشغيل migration
        }
      }
    }

    return { addedCount, examQuestionIds, addedBankIds };
  }

  /**
   * إضافة أسئلة القطعة (من بنك الأسئلة) لامتحان المحاضرة.
   * يجلب كل الأسئلة المرتبطة بالقطعة (questions_v2 WHERE passage_id = passageId) ويضيفها للامتحان.
   */
  static async addPassageQuestionsToExam(
    teacherId: number,
    examId: number,
    passageId: number,
  ): Promise<{ added: number; passage: { id: number; title?: string; content: string }; questionIds: number[] }> {
    const exam = await this.getExamWithCourse(examId);
    if (!exam) {
      const err: any = new Error('Exam not found');
      err.status = 404;
      throw err;
    }
    if (!(await this.canUserManageCourse(teacherId, Number(exam.course_id))) && exam.teacher_id !== teacherId) {
      const err: any = new Error('You do not own this exam');
      err.status = 403;
      throw err;
    }

    const passageRow = await pool.query(
      `SELECT id, title, content FROM question_passages WHERE id = $1`,
      [passageId],
    );
    if (!passageRow.rows.length) {
      const err: any = new Error('القطعة غير موجودة');
      err.status = 404;
      throw err;
    }
    const passage = passageRow.rows[0];

    const qIdsResult = await pool.query(
      `SELECT id FROM questions_v2 WHERE passage_id = $1 ORDER BY id ASC`,
      [passageId],
    );
    const passageQuestionIds = qIdsResult.rows.map((r: { id: number }) => r.id);
    if (passageQuestionIds.length === 0) {
      const err: any = new Error('القطعة لا تحتوي على أسئلة');
      err.status = 400;
      throw err;
    }

    const existingResult = await pool.query(
      `SELECT question_id_v2 FROM exam_questions WHERE exam_id = $1 AND question_id_v2 IS NOT NULL`,
      [examId],
    );
    const existingV2Ids = new Set(existingResult.rows.map((r: { question_id_v2: number }) => r.question_id_v2));
    const toAdd = passageQuestionIds.filter((id: number) => !existingV2Ids.has(id));
    if (toAdd.length === 0) {
      return {
        added: 0,
        passage: {
          id: passage.id,
          title: passage.title,
          content: passage.content,
        },
        questionIds: passageQuestionIds,
      };
    }

    const result = await this.addQuestionsFromBank(teacherId, examId, toAdd);
    return {
      added: result.addedCount,
      passage: {
        id: passage.id,
        title: passage.title,
        content: passage.content,
      },
      questionIds: toAdd,
    };
  }

  /**
   * إنشاء قطعة جديدة مع أسئلتها وربطها مباشرة بامتحان المحاضرة (بدون الحاجة لإضافتها مسبقًا من بنك الأسئلة).
   */
  static async createPassageWithQuestionsForExam(
    teacherId: number,
    examId: number,
    payload: {
      title?: string;
      content: string;
      questions: Array<{
        questionText: string;
        optionA: string;
        optionB: string;
        optionC: string;
        optionD: string;
        correctAnswer: 'A' | 'B' | 'C' | 'D' | 0 | 1 | 2 | 3;
        points?: number;
      }>;
    },
  ): Promise<{
    passage: { id: number | null; title?: string | null; content: string };
    added: number;
    questionIds: number[];
    examQuestionIds: number[];
  }> {
    const exam = await this.getExamWithCourse(examId);
    if (!exam) {
      const err: any = new Error('Exam not found');
      err.status = 404;
      throw err;
    }
    if (!(await this.canUserManageCourse(teacherId, Number(exam.course_id))) && exam.teacher_id !== teacherId) {
      const err: any = new Error('You do not own this exam');
      err.status = 403;
      throw err;
    }

    if (!payload.content || !String(payload.content).trim()) {
      const err: any = new Error('content is required');
      err.status = 400;
      throw err;
    }
    if (!Array.isArray(payload.questions) || payload.questions.length === 0) {
      const err: any = new Error('questions must be a non-empty array');
      err.status = 400;
      throw err;
    }

    const toCorrectIndex = (value: 'A' | 'B' | 'C' | 'D' | 0 | 1 | 2 | 3): number => {
      if (typeof value === 'number') {
        if (value >= 0 && value <= 3) return value;
        throw new Error('correctAnswer number must be between 0 and 3');
      }
      const letter = String(value).trim().toUpperCase();
      const map: Record<string, number> = { A: 0, B: 1, C: 2, D: 3 };
      if (!(letter in map)) {
        throw new Error('correctAnswer must be one of A, B, C, D or 0..3');
      }
      return map[letter];
    };

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const hasLegacyOptionsRes = await client.query(
        `SELECT 1
         FROM information_schema.columns
         WHERE table_name = 'questions' AND column_name = 'options'
         LIMIT 1`,
      );
      const hasLegacyOptions = (hasLegacyOptionsRes.rowCount ?? 0) > 0;
      const passage = {
        id: null,
        title: payload.title?.trim() || null,
        content: payload.content.trim(),
      };

      const questionIds: number[] = [];
      const examQuestionIds: number[] = [];

      for (const item of payload.questions) {
        const questionText = String(item.questionText || '').trim();
        const optionA = String(item.optionA || '').trim();
        const optionB = String(item.optionB || '').trim();
        const optionC = String(item.optionC || '').trim();
        const optionD = String(item.optionD || '').trim();
        const points = Number.isFinite(Number(item.points)) ? Math.max(1, Math.trunc(Number(item.points))) : 1;

        if (!questionText || !optionA || !optionB || !optionC || !optionD) {
          const err: any = new Error(
            'Each question must include questionText, optionA, optionB, optionC, and optionD',
          );
          err.status = 400;
          throw err;
        }

        const correctIndex = toCorrectIndex(item.correctAnswer);

        const qRes = hasLegacyOptions
          ? await client.query(
              `INSERT INTO questions (text, type, options)
               VALUES ($1, 'single_choice', $2::jsonb)
               RETURNING id`,
              [questionText, JSON.stringify({ __passage_content: passage.content, __passage_title: passage.title })],
            )
          : await client.query(
              `INSERT INTO questions (text, type)
               VALUES ($1, 'single_choice')
               RETURNING id`,
              [questionText],
            );
        const questionId = Number(qRes.rows[0].id);
        questionIds.push(questionId);

        const options = [optionA, optionB, optionC, optionD];
        for (let i = 0; i < 4; i++) {
          await client.query(
            `INSERT INTO question_choices (question_id, text, is_correct)
             VALUES ($1, $2, $3)`,
            [questionId, options[i], i === correctIndex],
          );
        }

        const examQuestionRes = await client.query(
          `INSERT INTO exam_questions (exam_id, question_id, question_text, grade, image)
           VALUES ($1, $2, $3, $4, NULL)
           RETURNING id`,
          [examId, questionId, questionText, points],
        );
        const examQuestionId = examQuestionRes.rows[0].id as number;
        examQuestionIds.push(examQuestionId);

        // مهم: أي خطأ داخل transaction يفسدها بالكامل، لذا نستخدم SAVEPOINT
        // لإبقاء إدراج snapshot اختياريًا بدون كسر العملية الأساسية.
        await client.query('SAVEPOINT sp_exam_question_options');
        try {
          await client.query(
            `INSERT INTO exam_question_options (exam_question_id, option_index, text_content)
             VALUES ($1, 0, $2), ($1, 1, $3), ($1, 2, $4), ($1, 3, $5)`,
            [examQuestionId, optionA, optionB, optionC, optionD],
          );
          await client.query('RELEASE SAVEPOINT sp_exam_question_options');
        } catch {
          await client.query('ROLLBACK TO SAVEPOINT sp_exam_question_options');
          await client.query('RELEASE SAVEPOINT sp_exam_question_options');
        }
      }

      await client.query('COMMIT');
      return {
        passage,
        added: questionIds.length,
        questionIds,
        examQuestionIds,
      };
    } catch (error: any) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  static async removeQuestionFromExam(teacherId: number, examId: number, questionId: number) {
    const exam = await this.getExamWithCourse(examId);
    if (!exam) {
      const error: any = new Error('Exam not found');
      error.status = 404;
      throw error;
    }

    if (!(await this.canUserManageCourse(teacherId, Number(exam.course_id))) && exam.teacher_id !== teacherId) {
      const error: any = new Error('You do not own this exam');
      error.status = 403;
      throw error;
    }

    const result = await pool.query(
      'DELETE FROM exam_questions WHERE id = $1 AND exam_id = $2',
      [questionId, examId],
    );

    if (result.rowCount === 0) {
      const error: any = new Error('Question not found in this exam');
      error.status = 404;
      throw error;
    }

    return true;
  }

  /**
   * تحديد الإجابة الصحيحة لسؤال في امتحان المحاضرة (للسؤال المُضاف من بنك الأسئلة).
   * التعديل يطبق على هذا الامتحان فقط ولا يغيّر بنك الأسئلة.
   * @param correct_answer_index 0=أ، 1=ب، 2=ج، 3=د
   */
  static async setQuestionCorrectAnswer(
    teacherId: number,
    examId: number,
    examQuestionId: number,
    correct_answer_index: number,
  ): Promise<void> {
    const exam = await this.getExamWithCourse(examId);
    if (!exam) {
      const error: any = new Error('Exam not found');
      error.status = 404;
      throw error;
    }
    if (!(await this.canUserManageCourse(teacherId, Number(exam.course_id))) && exam.teacher_id !== teacherId) {
      const error: any = new Error('You do not own this exam');
      error.status = 403;
      throw error;
    }
    const index = Math.min(3, Math.max(0, correct_answer_index));
    try {
      const result = await pool.query(
        `UPDATE exam_questions
         SET correct_answer_index_override = $1
         WHERE id = $2 AND exam_id = $3
         RETURNING id`,
        [index, examQuestionId, examId],
      );
      if (result.rowCount === 0) {
        const error: any = new Error('Question not found in this exam');
        error.status = 404;
        throw error;
      }
    } catch (err: any) {
      if (err?.message?.includes('correct_answer_index_override')) {
        const error: any = new Error(
          'Correct answer override is not available. Run migration 1700000007003_add_exam_question_correct_answer_override.',
        );
        error.status = 501;
        throw error;
      }
      throw err;
    }
  }

  /**
   * إخفاء أو إظهار سؤال في امتحان المحاضرة (بدون حذفه).
   * السؤال المخفي لا يظهر للطالب عند حل الامتحان.
   */
  static async setQuestionVisibility(
    teacherId: number,
    examId: number,
    examQuestionId: number,
    isVisible: boolean,
  ): Promise<void> {
    const exam = await this.getExamWithCourse(examId);
    if (!exam) {
      const error: any = new Error('Exam not found');
      error.status = 404;
      throw error;
    }
    if (!(await this.canUserManageCourse(teacherId, Number(exam.course_id))) && exam.teacher_id !== teacherId) {
      const error: any = new Error('You do not own this exam');
      error.status = 403;
      throw error;
    }
    try {
      const result = await pool.query(
        `UPDATE exam_questions SET is_visible = $1 WHERE id = $2 AND exam_id = $3 RETURNING id`,
        [isVisible, examQuestionId, examId],
      );
      if (result.rowCount === 0) {
        const error: any = new Error('Question not found in this exam');
        error.status = 404;
        throw error;
      }
    } catch (err: any) {
      if (err?.message?.includes('is_visible')) {
        const error: any = new Error(
          'Visibility is not available. Run migration 1700000007005_add_is_visible_to_exam_questions.',
        );
        error.status = 501;
        throw error;
      }
      throw err;
    }
  }

  static async getExamsByTeacher(
    teacherId: number,
    filters?: { courseId?: number; lectureId?: number; type?: string },
  ) {
    let typeFilter = parseLectureExamTypeFilter(filters?.type);

    const teacherOwnsCourseSql = `(
      c.teacher_id = $1
      OR EXISTS (SELECT 1 FROM course_managers cm WHERE cm.course_id = c.id AND cm.user_id = $1)
      OR EXISTS (SELECT 1 FROM tenants t WHERE t.id = c.tenant_id AND t.owner_user_id = $1 AND t.platform_type = $academy$)
    )`;

    // امتحانات/واجبات المحاضرة + واجبات الكورس المنفصلة (assignment_mode = course_based)
    const includeCourseBasedAssignmentsSql = `(
      e.lecture_id IS NOT NULL
      OR (
        e.lecture_id IS NULL
        AND COALESCE(c.assignment_mode, 'lecture_based') = 'course_based'
      )
    )`;

    if (typeFilter === 'assignment') {
      const assignmentCountRes = await pool.query<{ c: number }>(
        `SELECT COUNT(*)::int AS c
         FROM exams e
         LEFT JOIN lectures l ON e.lecture_id = l.id
         INNER JOIN courses c ON c.id = COALESCE(e.course_id, l.course_id)
         WHERE ${teacherOwnsCourseSql}
           AND ${includeCourseBasedAssignmentsSql}
           AND e.type = 'assignment'`,
        [teacherId],
      );
      if ((assignmentCountRes.rows[0]?.c ?? 0) === 0) {
        // سجلات قديمة: كانت تُحفظ دائماً كـ exam رغم إنشائها كواجب
        typeFilter = 'exam';
      }
    }

    const params: unknown[] = [teacherId];
    let query = `
      SELECT
        e.*,
        l.title AS lecture_title,
        c.title AS course_title,
        c.id AS course_id,
        COALESCE(c.assignment_mode, 'lecture_based') AS assignment_mode,
        CASE WHEN e.lecture_id IS NULL THEN 'course' ELSE 'lecture' END AS scope,
        COUNT(DISTINCT eq.id)::int AS questions_count,
        COUNT(DISTINCT es.id)::int AS submissions_count
      FROM exams e
      LEFT JOIN lectures l ON e.lecture_id = l.id
      INNER JOIN courses c ON c.id = COALESCE(e.course_id, l.course_id)
      LEFT JOIN exam_questions eq ON eq.exam_id = e.id
      LEFT JOIN exam_submissions es ON es.exam_id = e.id
      WHERE c.teacher_id = $1
        AND ${includeCourseBasedAssignmentsSql}
    `;

    if (typeFilter && typeFilter !== 'all') {
      params.push(typeFilter);
      query += ` AND e.type = $${params.length}`;
    }

    if (filters?.courseId) {
      params.push(filters.courseId);
      query += ` AND c.id = $${params.length}`;
    }
    if (filters?.lectureId) {
      params.push(filters.lectureId);
      query += ` AND l.id = $${params.length}`;
    }

    query += `
      GROUP BY e.id, l.title, c.title, c.id, c.assignment_mode
      ORDER BY e.created_at DESC
    `;

    const result = await pool.query(query, params);

    return result.rows.map((row) => ({
      ...this.mapExamRow(row),
      type: row.type,
      scope: row.scope,
      assignmentMode: row.assignment_mode,
      lectureTitle: row.lecture_title,
      lectureName: row.lecture_title,
      courseTitle: row.course_title,
      courseName: row.course_title,
      courseId: row.course_id,
      questionsCount: row.questions_count,
      submissionsCount: row.submissions_count,
    }));
  }

  static async getExamForUser(examId: number, user: RequestUser) {
    const exam = await this.getExamWithCourse(examId);
    if (!exam) {
      const error: any = new Error('Exam not found');
      error.status = 404;
      throw error;
    }

    if (user.role !== 'admin' && user.role !== 'student' && !(await CourseAccessControl.canManageCourse(user, Number(exam.course_id))) && exam.teacher_id !== user.id) {
      const error: any = new Error('You do not own this exam');
      error.status = 403;
      throw error;
    }

    if (user.role === 'student') {
      await this.ensureStudentEnrollment(
        { lectureId: exam.lecture_id, courseId: exam.course_id },
        user.id,
      );

      await this.expireOverdueAttempts(exam.id, user.id);

      const attempts = await this.getStudentAttempts(exam.id, user.id);
      const normalizedAttempts = attempts.map(toAttemptSnapshot);
      const activeAttemptIndex = attempts.findIndex((a) => a.status === 'in_progress');
      const activeAttempt = activeAttemptIndex >= 0 ? attempts[activeAttemptIndex] : null;
      const activeAttemptSnapshot =
        activeAttemptIndex >= 0 ? normalizedAttempts[activeAttemptIndex] : null;
      const attemptHistory = this.summarizeAttempts(attempts);
      const feedback = await this.buildFeedbackIfAllowed(exam, attempts);
      const availabilityStatus = getStudentExamAvailability(
        lectureExamAvailabilityInput(exam),
      );
      const baseResponse = {
        exam: this.mapExamRow(exam, availabilityStatus),
        attemptHistory,
        attempt: activeAttempt ? this.mapAttemptForStudent(activeAttempt) : null,
        feedback,
      };

      if (
        availabilityStatus === 'hidden' ||
        availabilityStatus === 'incomplete' ||
        availabilityStatus === 'upcoming'
      ) {
        return {
          ...baseResponse,
          status: availabilityStatus === 'upcoming' ? 'not_open_yet' : 'hidden',
          message:
            availabilityStatus === 'upcoming'
              ? 'This exam is not visible yet.'
              : availabilityStatus === 'incomplete'
                ? 'This exam is not ready yet.'
                : 'This exam is not visible right now.',
        };
      }

      const windowAvailability = this.getWindowStatus(exam);
      if (windowAvailability.status !== 'ready' && !activeAttempt) {
        return {
          ...baseResponse,
          status: windowAvailability.status,
          message: windowAvailability.message,
        };
      }

      if (activeAttempt) {
        const questions = await this.loadStudentAttemptQuestions(exam, activeAttempt, user.id);
        return {
          ...baseResponse,
          status: 'ready',
          questions: this.sanitizeQuestions(questions, false),
        };
      }

      const preventNewAttempt = shouldPreventNewAttempt({
        allowMultipleAttempts: !!exam.allow_multiple_attempts,
        attempts: normalizedAttempts,
        activeAttempt: activeAttemptSnapshot,
      });

      if (preventNewAttempt) {
        return {
          ...baseResponse,
          status: 'already_submitted',
          message: 'You have already completed this exam.',
        };
      }

      if (availabilityStatus === 'expired') {
        return {
          ...baseResponse,
          status: 'closed',
          message: 'This exam has ended. You can view it but cannot start a new attempt.',
        };
      }

      return {
        ...baseResponse,
        status: 'ready',
        questions: [],
      };
    }

    // Teacher/Admin view
    const questions = await this.loadExamQuestions(exam.id, false);
    return {
      exam: this.mapExamRow(exam),
      status: 'ready',
      questions: this.sanitizeQuestions(questions, true),
      attemptSummary: await this.getExamAttemptSummary(exam.id),
    };
  }

  static async startAttempt(examId: number, studentId: number): Promise<StartAttemptResult> {
    const exam = await this.getExamWithCourse(examId);
    if (!exam) {
      const error: any = new Error('Exam not found');
      error.status = 404;
      throw error;
    }

    await this.ensureStudentEnrollment(
      { lectureId: exam.lecture_id, courseId: exam.course_id },
      studentId,
    );

    await this.expireOverdueAttempts(exam.id, studentId);
    const attempts = await this.getStudentAttempts(exam.id, studentId);
    const activeAttempt = attempts.find((a) => a.status === 'in_progress');

    if (activeAttempt) {
      return this.mapAttemptForStudent(activeAttempt);
    }

    if (
      !canStudentStartExam(lectureExamAvailabilityInput(exam), new Date(), {
        hasInProgressAttempt: false,
      })
    ) {
      const status = getStudentExamAvailability(lectureExamAvailabilityInput(exam));
      const message =
        status === 'expired'
          ? 'This exam has ended. You can view it but cannot start a new attempt.'
          : status === 'upcoming'
            ? 'This exam is not open yet.'
            : status === 'incomplete'
              ? 'This exam is not ready yet.'
              : 'This exam is not available right now';
      const error: any = new Error(message);
      error.status = 403;
      throw error;
    }

    const availability = this.getWindowStatus(exam);
    if (availability.status !== 'ready') {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-expect-error
      const error: any = new Error(availability.message);
      error.status = 403;
      throw error;
    }

    const preventNewAttempt = shouldPreventNewAttempt({
      allowMultipleAttempts: !!exam.allow_multiple_attempts,
      attempts: attempts.map(toAttemptSnapshot),
    });
    if (preventNewAttempt) {
      const error: any = new Error('You have already completed this exam.');
      error.status = 403;
      throw error;
    }

    const attemptNumber = (attempts[0]?.attempt_number || 0) + 1;
    const startTime = new Date();
    const expireAt =
      exam.time_limit_enabled && exam.time_limit_minutes
        ? new Date(startTime.getTime() + exam.time_limit_minutes * 60 * 1000)
        : null;

    const questionBank = await this.loadExamQuestions(exam.id, true);
    const selectedQuestionIds = selectAttemptQuestions(
      questionBank.map((q) => q.id),
      exam.questions_count,
      exam.question_display_mode,
      attemptQuestionSeed(exam.id, studentId, attemptNumber),
    );

    const insertResult = await pool.query(
      `INSERT INTO exam_submissions (
        exam_id, student_id, total_grade, passed, submitted_at,
        attempt_start_time, attempt_end_time, status, attempt_number,
        time_limit_minutes, attempt_expire_at, is_late, selected_question_ids
      ) VALUES (
        $1, $2, NULL, NULL, NULL,
        $3, NULL, 'in_progress', $4,
        $5, $6, FALSE, $7
      ) RETURNING *`,
      [
        exam.id,
        studentId,
        startTime,
        attemptNumber,
        exam.time_limit_minutes ?? null,
        expireAt,
        selectedQuestionIds,
      ],
    );

    return this.mapAttemptForStudent(insertResult.rows[0]);
  }

  static async submitAttempt({
    examId,
    studentId,
    answers,
    attemptId,
    allowAutoStart = true,
  }: SubmitAttemptParams): Promise<SubmitAttemptResult> {
    const exam = await this.getExamWithCourse(examId);
    if (!exam) {
      const error: any = new Error('Exam not found');
      error.status = 404;
      throw error;
    }

    await this.ensureStudentEnrollment(
      { lectureId: exam.lecture_id, courseId: exam.course_id },
      studentId,
    );

    if (!Array.isArray(answers) || answers.length === 0) {
      const error: any = new Error('answers array is required');
      error.status = 400;
      throw error;
    }

    await this.expireOverdueAttempts(exam.id, studentId);
    let attempt = attemptId
      ? await this.getAttemptById(attemptId, exam.id, studentId)
      : await this.getActiveAttempt(exam.id, studentId);

    if (!attempt && allowAutoStart) {
      attempt = (await this.startAttempt(exam.id, studentId)) as any;
      attempt = await this.getAttemptById(attempt.attemptId, exam.id, studentId);
    }

    if (!attempt) {
      const error: any = new Error('No active attempt found. Please start the exam first.');
      error.status = 400;
      throw error;
    }

    if (attempt.status !== 'in_progress') {
      const error: any = new Error('This attempt is already finished');
      error.status = 400;
      throw error;
    }

    const questionBank = await this.loadStudentAttemptQuestions(exam, attempt, studentId);
    if (!questionBank.length) {
      const error: any = new Error('This exam has no questions yet.');
      error.status = 400;
      throw error;
    }
    const evaluation = this.evaluateAnswers(questionBank, answers);

    const now = new Date();
    const isLate = isPastExpiry(attempt.attempt_expire_at, now);
    const status: 'submitted' | 'late' = isLate ? 'late' : 'submitted';
    // Late attempts are still graded but highlighted for downstream late policies.

    const updateRes = await pool.query(
      `UPDATE exam_submissions
       SET total_grade = $1,
           passed = $2,
           submitted_at = $3,
           attempt_end_time = $4,
           status = $5,
           is_late = $6
       WHERE id = $7
       RETURNING *`,
      [evaluation.totalGrade, evaluation.passed, now, now, status, isLate, attempt.id],
    );
    const updatedAttempt = updateRes.rows[0];

    await this.persistAttemptAnswers(updatedAttempt.id, evaluation.questions);
    await this.maybeAddStudentPoints(
      studentId,
      exam.id,
      evaluation.totalGrade,
      evaluation.maxGrade,
    );

    const releaseDecision = this.shouldReleaseAnswers(exam, updatedAttempt, now);
    const wrongQuestions = releaseDecision.release
      ? evaluation.questions
        .filter((q) => !q.isCorrect)
        .map((q) => ({
          questionId: q.questionId,
          questionText: q.questionText,
          questionImage: q.questionImage,
          correctChoice: q.correctChoice,
          yourChoice: q.yourChoice,
        }))
      : [];

    return {
      attemptId: updatedAttempt.id,
      status,
      totalGrade: evaluation.totalGrade,
      maxGrade: evaluation.maxGrade,
      passed: evaluation.passed,
      wrongQuestions,
      released: releaseDecision.release,
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-expect-error
      releaseReason: releaseDecision.reason,
    };
  }

  static async getAttemptDetails(examId: number, attemptId: number, user: RequestUser) {
    const exam = await this.getExamWithCourse(examId);
    if (!exam) {
      const error: any = new Error('Exam not found');
      error.status = 404;
      throw error;
    }

    const attempt = await this.getAttemptById(attemptId, exam.id);
    if (!attempt) {
      const error: any = new Error('Attempt not found');
      error.status = 404;
      throw error;
    }

    if (user.role === 'student' && attempt.student_id !== user.id) {
      const error: any = new Error('You cannot access this attempt');
      error.status = 403;
      throw error;
    }

    if (user.role !== 'admin' && user.role !== 'student' && !(await CourseAccessControl.canManageCourse(user, Number(exam.course_id))) && exam.teacher_id !== user.id) {
      const error: any = new Error('You do not own this exam');
      error.status = 403;
      throw error;
    }

    const canViewAnswers =
      user.role !== 'student' || this.shouldReleaseAnswers(exam, attempt, new Date()).release;
    const answers = canViewAnswers ? await this.getAttemptAnswers(attempt.id) : [];

    return {
      attemptId: attempt.id,
      examId: attempt.exam_id,
      studentId: attempt.student_id,
      status: attempt.status,
      submittedAt: attempt.submitted_at,
      totalGrade: attempt.total_grade,
      passed: attempt.passed,
      timeLimitMinutes: attempt.time_limit_minutes,
      attemptStartTime: attempt.attempt_start_time,
      attemptEndTime: attempt.attempt_end_time,
      canViewAnswers,
      wrongQuestions: canViewAnswers ? mapWrongQuestionsFromAnswers(answers) : [],
      answers,
    };
  }

  /**
   * تقرير امتحان المحاضرة للطالب: آخر محاولة مُسلَّمة مع كل الأسئلة وإجابته والإجابة الصحيحة
   */
  static async getMyLectureReport(examId: number, studentId: number) {
    const exam = await this.getExamWithCourse(examId);
    if (!exam) {
      const error: any = new Error('Exam not found');
      error.status = 404;
      throw error;
    }
    await this.ensureStudentEnrollment(
      { lectureId: exam.lecture_id, courseId: exam.course_id },
      studentId,
    );

    const attempts = await this.getStudentAttempts(examId, studentId);
    const latestSubmitted = attempts.find((a) =>
      ['submitted', 'late', 'expired'].includes(a.status),
    );
    if (!latestSubmitted) {
      const error: any = new Error('لا توجد محاولة مُسلَّمة لهذا الامتحان');
      error.status = 404;
      throw error;
    }

    const decision = this.shouldReleaseAnswers(exam, latestSubmitted, new Date());
    if (!decision.release) {
      const error: any = new Error(
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-expect-error
        decision.reason === 'scheduled_pending'
          ? 'سيتم إظهار الإجابات في وقت لاحق'
          : 'لا يمكن عرض تقرير الإجابات لهذا الامتحان',
      );
      error.status = 403;
      throw error;
    }

    const answers = await this.getAttemptAnswers(latestSubmitted.id);
    const totalGrade = latestSubmitted.total_grade ?? 0;
    const maxGrade = exam.total_grade ?? 0;

    return {
      examType: 'lecture' as const,
      exam: {
        id: exam.id,
        title: exam.title,
        totalGrade: maxGrade,
      },
      attempt: {
        attemptId: latestSubmitted.id,
        totalGrade: maxGrade,
        obtainedGrade: totalGrade,
        submittedAt: latestSubmitted.submitted_at,
        passed: !!latestSubmitted.passed,
      },
      questions: answers.map((a) => ({
        questionId: a.questionId,
        questionText: a.questionText,
        questionImage: a.questionImage,
        yourAnswer: a.selectedChoice?.text
          ? { letter: null as string | null, text: a.selectedChoice.text }
          : { letter: null, text: null },
        correctAnswer: a.correctChoice?.text
          ? { letter: null as string | null, text: a.correctChoice.text }
          : { letter: null, text: null },
        isCorrect: a.isCorrect,
      })),
    };
  }

  static async getExamQuestionReport(
    examId: number,
    user: RequestUser,
    options?: { passPercentage?: number },
  ) {
    const exam = await this.getExamWithCourse(examId);
    if (!exam) {
      const error: any = new Error('Exam not found');
      error.status = 404;
      throw error;
    }

    if (
      user.role !== 'admin' &&
      !(await CourseAccessControl.canManageCourse(user, Number(exam.course_id))) &&
      exam.teacher_id !== user.id
    ) {
      const error: any = new Error('You do not own this exam');
      error.status = 403;
      throw error;
    }

    const questionsRes = await pool.query(
      `SELECT
         eq.id AS exam_question_id,
         COALESCE(NULLIF(eq.question_text, ''), q.text, q2.question_text) AS question_text,
         COALESCE(eq.image, q.image, qm.media_url) AS question_image,
         eq.grade
       FROM exam_questions eq
       LEFT JOIN questions q ON eq.question_id = q.id
       LEFT JOIN questions_v2 q2 ON eq.question_id_v2 = q2.id
       LEFT JOIN question_media qm ON q2.id = qm.question_id
       WHERE eq.exam_id = $1
       ORDER BY eq.id`,
      [exam.id],
    );

    const reportMap = new Map<number, QuestionReportEntry>();
    questionsRes.rows.forEach((row) => {
      reportMap.set(row.exam_question_id, {
        questionId: row.exam_question_id,
        questionText: row.question_text,
        questionImage: row.question_image,
        grade: row.grade || 1,
        totalResponses: 0,
        correctCount: 0,
        incorrectCount: 0,
        unansweredCount: 0,
        correctStudents: [],
        incorrectStudents: [],
        unansweredStudents: [],
      });
    });

    const examMeta = {
      ...this.mapExamRow(exam),
      type: exam.type,
      courseId: exam.course_id,
      lectureTitle: exam.lecture_title || null,
      scope: exam.lecture_id ? 'lecture' : 'course',
    };

    if (!reportMap.size) {
      const enrollment = await this.buildLectureEnrollmentSummary(exam, options?.passPercentage);
      return {
        exam: examMeta,
        overallStatistics: {
          totalStudents: 0,
          totalQuestions: 0,
          totalCorrect: 0,
          totalWrong: 0,
        },
        questions: [],
        enrollmentSummary: enrollment.enrollmentSummary,
        notExaminedStudents: enrollment.notExaminedStudents,
      };
    }

    const latestSubsRes = await pool.query(
      `SELECT DISTINCT ON (es.student_id)
         es.id AS submission_id,
         es.student_id,
         es.attempt_number,
         u.name AS student_name,
         u.email AS student_email
       FROM exam_submissions es
       JOIN users u ON es.student_id = u.id
       WHERE es.exam_id = $1
         AND COALESCE(es.status, 'submitted') IN ('submitted', 'late', 'expired')
       ORDER BY es.student_id, es.submitted_at DESC NULLS LAST, es.id DESC`,
      [exam.id],
    );
    const latestSubs = latestSubsRes.rows;
    const submissionIds = latestSubs.map((s) => Number(s.submission_id));

    const answersRes =
      submissionIds.length === 0
        ? { rows: [] as any[] }
        : await pool.query(
            `SELECT
               ea.submission_id,
               ea.question_id AS exam_question_id,
               ea.is_correct,
               ea.selected_choice_id,
               selected_choice.text AS selected_choice_text,
               selected_opt.text_content AS selected_choice_text_v2
             FROM exam_answers ea
             JOIN exam_questions eq ON ea.question_id = eq.id
             LEFT JOIN question_choices selected_choice ON selected_choice.id = ea.selected_choice_id
             LEFT JOIN question_options selected_opt ON selected_opt.id = ea.selected_choice_id
             WHERE ea.submission_id = ANY($1::int[])`,
            [submissionIds],
          );

    const answersByQuestion = new Map<number, any[]>();
    for (const row of answersRes.rows) {
      const qid = Number(row.exam_question_id);
      const list = answersByQuestion.get(qid) || [];
      list.push(row);
      answersByQuestion.set(qid, list);
    }

    const subById = new Map(latestSubs.map((s) => [Number(s.submission_id), s]));

    reportMap.forEach((bucket, questionId) => {
      const qAnswers = answersByQuestion.get(questionId) || [];
      const answeredSubIds = new Set(qAnswers.map((a) => Number(a.submission_id)));

      for (const row of qAnswers) {
        const sub = subById.get(Number(row.submission_id));
        const student: QuestionReportStudent = {
          studentId: Number(sub?.student_id),
          studentName: sub?.student_name ?? null,
          studentEmail: sub?.student_email ?? null,
          submissionId: row.submission_id,
          attemptNumber: sub?.attempt_number ?? null,
          selectedChoiceId: row.selected_choice_id ?? null,
          selectedAnswerText: row.selected_choice_text || row.selected_choice_text_v2 || null,
        };
        bucket.totalResponses += 1;
        if (row.is_correct) {
          bucket.correctCount += 1;
          bucket.correctStudents.push(student);
        } else {
          bucket.incorrectCount += 1;
          bucket.incorrectStudents.push(student);
        }
      }

      const unanswered = latestSubs.filter((s) => !answeredSubIds.has(Number(s.submission_id)));
      bucket.unansweredCount = unanswered.length;
      bucket.unansweredStudents = unanswered.map((s) => ({
        studentId: s.student_id,
        studentName: s.student_name,
        studentEmail: s.student_email,
        submissionId: s.submission_id,
        attemptNumber: s.attempt_number,
        selectedChoiceId: null,
        selectedAnswerText: null,
      }));
      bucket.incorrectCount += unanswered.length;
      bucket.incorrectStudents.push(...(bucket.unansweredStudents || []));
    });

    const questions = Array.from(reportMap.values());
    const totalCorrect = questions.reduce((sum, q) => sum + q.correctCount, 0);
    const totalWrong = questions.reduce((sum, q) => sum + q.incorrectCount, 0);
    const enrollment = await this.buildLectureEnrollmentSummary(exam, options?.passPercentage);

    return {
      exam: examMeta,
      overallStatistics: {
        totalStudents: latestSubs.length,
        totalQuestions: questions.length,
        totalCorrect,
        totalWrong,
      },
      questions,
      enrollmentSummary: enrollment.enrollmentSummary,
      notExaminedStudents: enrollment.notExaminedStudents,
    };
  }

  private static pct(count: number, total: number): number {
    if (total <= 0) return 0;
    return Math.round((count / total) * 100 * 100) / 100;
  }

  /**
   * مشتركون لم يسلّموا بعد: لم يبدأوا، أو بدأوا وما زالت المحاولة in_progress.
   */
  private static async buildLectureEnrollmentSummary(
    exam: any,
    passPercentageInput?: number,
  ) {
    const passPercentage =
      passPercentageInput != null &&
      Number.isFinite(passPercentageInput) &&
      passPercentageInput >= 0 &&
      passPercentageInput <= 100
        ? passPercentageInput
        : 50;
    const maxGrade = Number(exam.total_grade ?? 0);

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
      `SELECT DISTINCT ON (es.student_id)
         es.student_id,
         COALESCE(es.status, 'submitted') AS status,
         es.total_grade,
         es.passed,
         es.attempt_start_time,
         es.attempt_expire_at,
         (
           SELECT COUNT(*)::int
           FROM exam_answers ea
           WHERE ea.submission_id = es.id
         ) AS answered_count
       FROM exam_submissions es
       WHERE es.exam_id = $1
       ORDER BY es.student_id,
         CASE
           WHEN COALESCE(es.status, 'submitted') IN ('submitted', 'late', 'expired') THEN 0
           ELSE 1
         END,
         es.submitted_at DESC NULLS LAST,
         es.id DESC`,
      [exam.id],
    );
    const attemptByStudent = new Map(
      attemptStatusRes.rows.map((row) => [Number(row.student_id), row]),
    );

    let examinedCount = 0;
    let startedNotSubmittedCount = 0;
    let passedCount = 0;
    let failedCount = 0;
    const notExaminedStudents: Array<{
      studentId: number;
      studentName: string;
      studentEmail: string;
      examStatus: 'never_started' | 'in_progress';
      startedAt?: string | null;
      remainingSeconds?: number | null;
      answeredCount?: number;
      questionsCount?: number;
    }> = [];

    for (const student of enrolledStudents) {
      const studentId = Number(student.student_id);
      const latest = attemptByStudent.get(studentId);
      const status = String(latest?.status || '');
      const completed = ['submitted', 'late', 'expired'].includes(status);

      if (completed) {
        examinedCount++;
        const obtained = Number(latest?.total_grade ?? 0);
        const passed =
          latest?.passed != null
            ? Boolean(latest.passed)
            : maxGrade > 0 && (obtained / maxGrade) * 100 >= passPercentage;
        if (passed) passedCount++;
        else failedCount++;
        continue;
      }

      if (status === 'in_progress') {
        startedNotSubmittedCount++;
        notExaminedStudents.push({
          studentId,
          studentName: student.student_name,
          studentEmail: student.student_email,
          examStatus: 'in_progress',
          startedAt: latest?.attempt_start_time ?? null,
          remainingSeconds: calculateRemainingSeconds(latest?.attempt_expire_at),
          answeredCount: Number(latest?.answered_count || 0),
          questionsCount: Number(exam.actual_questions_count || exam.questions_count || 0) || undefined,
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
    return {
      notExaminedStudents,
      enrollmentSummary: {
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
      },
    };
  }

  /**
   * تقارير واجبات/امتحانات المحاضرة + الواجبات المنفصلة على مستوى الكورس.
   */
  static async listCourseAssignmentReports(
    courseId: number,
    filters?: { type?: string; scope?: string },
  ) {
    const typeRaw = String(filters?.type || 'all').trim().toLowerCase();
    const types =
      typeRaw === 'exam'
        ? ['exam']
        : typeRaw === 'assignment'
          ? ['assignment']
          : ['exam', 'assignment'];

    const scopeRaw = String(filters?.scope || 'all').trim().toLowerCase();
    const scopeSql =
      scopeRaw === 'lecture'
        ? 'AND e.lecture_id IS NOT NULL'
        : scopeRaw === 'course'
          ? 'AND e.lecture_id IS NULL'
          : '';

    const result = await pool.query(
      `WITH latest_subs AS (
         SELECT DISTINCT ON (es.exam_id, es.student_id)
           es.exam_id,
           es.student_id,
           es.total_grade,
           es.passed
         FROM exam_submissions es
         WHERE COALESCE(es.status, 'submitted') IN ('submitted', 'late', 'expired')
         ORDER BY es.exam_id, es.student_id, es.submitted_at DESC NULLS LAST, es.id DESC
       )
       SELECT
         e.id,
         e.title,
         e.type,
         e.lecture_id,
         e.total_grade,
         e.is_visible,
         e.created_at,
         l.title AS lecture_title,
         CASE WHEN e.lecture_id IS NULL THEN 'course' ELSE 'lecture' END AS scope,
         COUNT(DISTINCT eq.id)::int AS questions_count,
         COUNT(DISTINCT ls.student_id)::int AS submissions_count,
         COUNT(DISTINCT ls.student_id) FILTER (WHERE ls.passed IS TRUE)::int AS passed_count,
         ROUND(AVG(ls.total_grade)::numeric, 2) AS average_grade
       FROM exams e
       LEFT JOIN lectures l ON e.lecture_id = l.id
       LEFT JOIN exam_questions eq ON eq.exam_id = e.id
       LEFT JOIN latest_subs ls ON ls.exam_id = e.id
       WHERE COALESCE(e.course_id, l.course_id) = $1
         AND e.type = ANY($2::text[])
         ${scopeSql}
       GROUP BY e.id, l.title
       ORDER BY e.created_at DESC`,
      [courseId, types],
    );

    return result.rows.map((row) => ({
      id: row.id,
      title: row.title,
      type: row.type,
      scope: row.scope,
      lectureId: row.lecture_id,
      lectureTitle: row.lecture_title,
      totalGrade: row.total_grade,
      isVisible: row.is_visible,
      createdAt: row.created_at,
      questionsCount: row.questions_count,
      submissionsCount: row.submissions_count,
      passedCount: row.passed_count,
      averageGrade: row.average_grade != null ? Number(row.average_grade) : 0,
    }));
  }

  /** Get exam/assignment by id with course/teacher info (lecture-based أو course-based). */
  static async getExamWithCourse(examId: number) {
    const res = await pool.query(
      `SELECT e.*,
              COALESCE(e.course_id, l.course_id) AS course_id,
              c.teacher_id,
              l.title AS lecture_title,
              (
                SELECT COUNT(*)::int
                FROM exam_questions eq
                WHERE eq.exam_id = e.id
              ) AS actual_questions_count
       FROM exams e
       LEFT JOIN lectures l ON e.lecture_id = l.id
       JOIN courses c ON c.id = COALESCE(e.course_id, l.course_id)
       WHERE e.id = $1`,
      [examId],
    );
    return res.rows[0] || null;
  }

  private static async ensureStudentEnrollment(
    lectureOrCourse: { lectureId?: number | null; courseId?: number | null },
    studentId: number,
  ) {
    let courseId = lectureOrCourse.courseId ? Number(lectureOrCourse.courseId) : null;
    if (!courseId && lectureOrCourse.lectureId) {
      const lec = await pool.query(`SELECT course_id FROM lectures WHERE id = $1`, [
        lectureOrCourse.lectureId,
      ]);
      courseId = lec.rowCount ? Number(lec.rows[0].course_id) : null;
    }
    if (!courseId) {
      const error: any = new Error('You are not enrolled in this course');
      error.status = 403;
      throw error;
    }
    const enrollment = await pool.query(
      `SELECT 1 FROM enrollments WHERE course_id = $1 AND user_id = $2`,
      [courseId, studentId],
    );
    if (!enrollment.rowCount) {
      const error: any = new Error('You are not enrolled in this course');
      error.status = 403;
      throw error;
    }
  }

  private static isWithinVisibilityWindow(exam: any) {
    const status = getStudentExamAvailability(lectureExamAvailabilityInput(exam));
    return status === 'open';
  }

  private static getWindowStatus(exam: any) {
    const now = new Date();
    if (exam.start_window && new Date(exam.start_window) > now) {
      return {
        status: 'not_open_yet',
        message: 'This exam is not open yet.',
      };
    }
    if (exam.end_window && new Date(exam.end_window) < now) {
      return {
        status: 'closed',
        message: 'This exam is closed.',
      };
    }
    return { status: 'ready', message: null };
  }

  private static async expireOverdueAttempts(examId: number, studentId: number) {
    await pool.query(
      `UPDATE exam_submissions
       SET status = 'expired',
           attempt_end_time = attempt_expire_at,
           submitted_at = attempt_expire_at,
           total_grade = COALESCE(total_grade, 0),
           passed = FALSE
       WHERE exam_id = $1
         AND student_id = $2
         AND status = 'in_progress'
         AND attempt_expire_at IS NOT NULL
         AND attempt_expire_at <= NOW()`,
      [examId, studentId],
    );
  }

  private static async getStudentAttempts(examId: number, studentId: number) {
    const res = await pool.query(
      `SELECT *
       FROM exam_submissions
       WHERE exam_id = $1 AND student_id = $2
       ORDER BY attempt_start_time DESC`,
      [examId, studentId],
    );
    return res.rows;
  }

  private static async getAttemptById(attemptId: number, examId: number, studentId?: number) {
    const params: any[] = [attemptId, examId];
    let query = `SELECT * FROM exam_submissions WHERE id = $1 AND exam_id = $2`;
    if (studentId) {
      query += ` AND student_id = $3`;
      params.push(studentId);
    }
    const res = await pool.query(query, params);
    return res.rows[0] || null;
  }

  private static async getActiveAttempt(examId: number, studentId: number) {
    const res = await pool.query(
      `SELECT *
       FROM exam_submissions
       WHERE exam_id = $1 AND student_id = $2 AND status = 'in_progress'
       ORDER BY attempt_start_time DESC
       LIMIT 1`,
      [examId, studentId],
    );
    return res.rows[0] || null;
  }

  private static summarizeAttempts(attempts: any[]) {
    return attempts.map((attempt) => ({
      attemptId: attempt.id,
      attemptNumber: attempt.attempt_number,
      status: attempt.status,
      totalGrade: attempt.total_grade,
      submittedAt: attempt.submitted_at,
      isLate: attempt.is_late,
    }));
  }

  private static mapAttemptForStudent(attempt: any): StartAttemptResult {
    const remainingSeconds = calculateRemainingSeconds(attempt.attempt_expire_at);

    return {
      attemptId: attempt.id,
      attemptStartTime: attempt.attempt_start_time,
      attemptExpireAt: attempt.attempt_expire_at,
      remainingSeconds,
      timeLimitMinutes: attempt.time_limit_minutes,
    };
  }

  private static async getExamAttemptSummary(examId: number) {
    const res = await pool.query(
      `SELECT 
        COUNT(*) as total_attempts,
        COUNT(CASE WHEN status = 'submitted' THEN 1 END) as submitted_attempts,
        COUNT(CASE WHEN status = 'late' THEN 1 END) as late_attempts,
        COUNT(CASE WHEN status = 'expired' THEN 1 END) as expired_attempts
       FROM exam_submissions
       WHERE exam_id = $1`,
      [examId],
    );
    return res.rows[0];
  }

  private static async loadStudentAttemptQuestions(
    exam: any,
    attempt: any,
    studentId: number,
  ): Promise<ExamQuestion[]> {
    const allQuestions = await this.loadExamQuestions(exam.id, true);
    const storedIds = parseSelectedQuestionIds(attempt?.selected_question_ids);
    const selectedIds =
      storedIds && storedIds.length
        ? storedIds
        : selectAttemptQuestions(
            allQuestions.map((q) => q.id),
            exam.questions_count,
            exam.question_display_mode,
            attemptQuestionSeed(
              Number(exam.id),
              studentId,
              Number(attempt?.attempt_number || 1),
            ),
          );
    return orderItemsByIds(allQuestions, selectedIds);
  }

  private static async loadExamQuestions(examId: number, forStudent?: boolean): Promise<ExamQuestion[]> {
    const hasLegacyOptionsRes = await pool.query(
      `SELECT 1
       FROM information_schema.columns
       WHERE table_name = 'questions' AND column_name = 'options'
       LIMIT 1`,
    );
    const hasLegacyOptions = (hasLegacyOptionsRes.rowCount ?? 0) > 0;
    const legacyOptionsSelect = hasLegacyOptions ? 'q.options as bank_options_v1,' : 'NULL::jsonb as bank_options_v1,';

    const queryWithOverride = `SELECT
        eq.id as exam_question_id,
        eq.question_id as bank_question_id,
        eq.question_id_v2 as bank_question_id_v2,
        eq.question_text,
        eq.image,
        eq.grade,
        eq.correct_answer_index_override,
        eq.is_visible,
        q2.passage_id,
        q.text as bank_text,
        ${legacyOptionsSelect}
        q.image as bank_image,
        qc.id as choice_id,
        qc.text as choice_text,
        qc.is_correct,
        q2.question_text as bank_text_v2,
        qm.media_url as bank_image_v2,
        qo.id as choice_id_v2,
        qo.text_content as choice_text_v2,
        qo.image_url as choice_image_v2,
        qo.option_index as choice_index_v2,
        q2.correct_answer_index
       FROM exam_questions eq
       LEFT JOIN questions q ON eq.question_id = q.id
       LEFT JOIN question_choices qc ON q.id = qc.question_id
       LEFT JOIN questions_v2 q2 ON eq.question_id_v2 = q2.id
       LEFT JOIN question_media qm ON q2.id = qm.question_id
       LEFT JOIN question_options qo ON q2.id = qo.question_id
       WHERE eq.exam_id = $1
       ORDER BY eq.id, qc.id, qo.option_index`;

    const queryWithoutOverride = `SELECT
        eq.id as exam_question_id,
        eq.question_id as bank_question_id,
        eq.question_id_v2 as bank_question_id_v2,
        eq.question_text,
        eq.image,
        eq.grade,
        q2.passage_id,
        q.text as bank_text,
        ${legacyOptionsSelect}
        q.image as bank_image,
        qc.id as choice_id,
        qc.text as choice_text,
        qc.is_correct,
        q2.question_text as bank_text_v2,
        qm.media_url as bank_image_v2,
        qo.id as choice_id_v2,
        qo.text_content as choice_text_v2,
        qo.image_url as choice_image_v2,
        qo.option_index as choice_index_v2,
        q2.correct_answer_index
       FROM exam_questions eq
       LEFT JOIN questions q ON eq.question_id = q.id
       LEFT JOIN question_choices qc ON q.id = qc.question_id
       LEFT JOIN questions_v2 q2 ON eq.question_id_v2 = q2.id
       LEFT JOIN question_media qm ON q2.id = qm.question_id
       LEFT JOIN question_options qo ON q2.id = qo.question_id
       WHERE eq.exam_id = $1
       ORDER BY eq.id, qc.id, qo.option_index`;

    let res: { rows: any[] };
    try {
      res = await pool.query(queryWithOverride, [examId]);
    } catch (err: any) {
      if (
        err?.message?.includes('correct_answer_index_override') ||
        err?.message?.includes('is_visible')
      ) {
        res = await pool.query(queryWithoutOverride, [examId]);
      } else {
        throw err;
      }
    }

    const hasOverrideColumn = res.rows.length === 0 || res.rows[0].correct_answer_index_override !== undefined;
    const hasVisibleColumn = res.rows.length === 0 || res.rows[0].is_visible !== undefined;
    const skippedByVisibility = new Set<number>();

    const map = new Map<number, ExamQuestion>();
    res.rows.forEach((row) => {
      if (forStudent && hasVisibleColumn && row.is_visible === false) {
        skippedByVisibility.add(row.exam_question_id);
      }
      if (skippedByVisibility.has(row.exam_question_id)) return;
      if (!map.has(row.exam_question_id)) {
        const isV2 = !!row.bank_question_id_v2;
        const text =
          row.question_text ||
          (isV2 ? row.bank_text_v2 : row.bank_text) ||
          null;
        const image =
          row.image ||
          (isV2 ? row.bank_image_v2 : row.bank_image) ||
          null;

        const override =
          hasOverrideColumn && row.correct_answer_index_override != null
            ? Number(row.correct_answer_index_override)
            : null;
        const legacyPassageContent =
          row.bank_options_v1 &&
          typeof row.bank_options_v1 === 'object' &&
          row.bank_options_v1.__passage_content
            ? String(row.bank_options_v1.__passage_content)
            : null;
        const legacyPassageTitle =
          row.bank_options_v1 &&
          typeof row.bank_options_v1 === 'object' &&
          row.bank_options_v1.__passage_title
            ? String(row.bank_options_v1.__passage_title)
            : null;

        map.set(row.exam_question_id, {
          id: row.exam_question_id,
          questionBankId: row.bank_question_id || row.bank_question_id_v2,
          text,
          image,
          grade: row.grade || 1,
          passage_id: row.passage_id ?? null,
          correct_answer_index: isV2 && row.correct_answer_index != null ? Number(row.correct_answer_index) : null,
          correct_answer_index_override: override != null && override >= 0 && override <= 3 ? override : null,
          isVisible: hasVisibleColumn ? row.is_visible !== false : true,
          choices: [],
          passage:
            !isV2 && legacyPassageContent && legacyPassageContent.trim() !== ''
              ? { id: null, title: legacyPassageTitle, content: legacyPassageContent }
              : undefined,
        });
      }

      const question = map.get(row.exam_question_id)!;
      const overrideIndex = question.correct_answer_index_override;

      // Handle V1 Choice
      if (row.choice_id) {
        const isCorrect =
          overrideIndex != null
            ? question.choices.length === overrideIndex
            : !!row.is_correct;
        question.choices.push({
          id: row.choice_id,
          text: row.choice_text,
          isCorrect,
        });
      }

      // Handle V2 Choice
      if (row.choice_id_v2) {
        const bankCorrectIndex = row.correct_answer_index != null ? Number(row.correct_answer_index) : null;
        const choiceIndex = row.choice_index_v2 != null ? Number(row.choice_index_v2) : null;
        const effectiveCorrect = overrideIndex ?? bankCorrectIndex;
        const isCorrect =
          effectiveCorrect !== null && choiceIndex !== null && choiceIndex === effectiveCorrect;
        const { text: choiceText, image: choiceImage } = normalizeChoiceContent(
          row.choice_text_v2,
          row.choice_image_v2,
        );

        question.choices.push({
          id: row.choice_id_v2,
          text: choiceText,
          image: choiceImage,
          isCorrect,
        });
      }
    });

    // استخدام نسخة الخيارات داخل الامتحان (exam_question_options) إن وُجدت؛ حتى لا يتأثر الامتحان بتعديل البنك
    const examQuestionIds = Array.from(map.keys());
    if (examQuestionIds.length > 0) {
      try {
        const snapshotRes = await pool.query<{
          exam_question_id: number;
          option_index: number;
          text_content: string | null;
        }>(
          `SELECT exam_question_id, option_index, text_content
           FROM exam_question_options
           WHERE exam_question_id = ANY($1::int[])
           ORDER BY exam_question_id, option_index`,
          [examQuestionIds],
        );
        const byExamQuestion = new Map<number, { option_index: number; text_content: string | null }[]>();
        snapshotRes.rows.forEach((r) => {
          if (!byExamQuestion.has(r.exam_question_id)) byExamQuestion.set(r.exam_question_id, []);
          byExamQuestion.get(r.exam_question_id)!.push({
            option_index: r.option_index,
            text_content: r.text_content,
          });
        });
        byExamQuestion.forEach((opts, examQuestionId) => {
          const question = map.get(examQuestionId);
          if (!question || opts.length === 0) return;
          const effectiveCorrect =
            question.correct_answer_index_override ?? question.correct_answer_index ?? null;
          question.choices = opts
            .sort((a, b) => a.option_index - b.option_index)
            .map((o, i) => {
              const { text, image } = normalizeChoiceContent(o.text_content);
              return {
                id: -(examQuestionId * 10 + i + 1),
                text,
                image,
                isCorrect: effectiveCorrect !== null && i === effectiveCorrect,
              };
            });
        });
      } catch {
        // جدول exam_question_options قد يكون غير موجود قبل تشغيل migration
      }
    }

    // Fallback: أسئلة مكتبة المدرس بدون snapshot — اقرأ الخيارات من teacher_questions
    const missingChoiceIds = Array.from(map.entries())
      .filter(([, q]) => q.choices.length === 0)
      .map(([id]) => id);
    if (missingChoiceIds.length > 0) {
      try {
        const libraryRes = await pool.query<{
          exam_question_id: number;
          choices: unknown;
          correct_answer_index: number | null;
        }>(
          `SELECT eq.id AS exam_question_id, tq.choices, tq.correct_answer_index
           FROM exam_questions eq
           JOIN teacher_questions tq ON tq.id = eq.teacher_question_id
           WHERE eq.id = ANY($1::int[])`,
          [missingChoiceIds],
        );
        for (const row of libraryRes.rows) {
          const question = map.get(row.exam_question_id);
          if (!question) continue;
          let choices: string[] = [];
          if (Array.isArray(row.choices)) {
            choices = row.choices.map((v) => String(v ?? '').trim()).filter(Boolean);
          } else if (typeof row.choices === 'string') {
            try {
              const parsed = JSON.parse(row.choices);
              if (Array.isArray(parsed)) {
                choices = parsed.map((v) => String(v ?? '').trim()).filter(Boolean);
              }
            } catch {
              choices = [];
            }
          }
          if (choices.length === 0) continue;
          const override = question.correct_answer_index_override;
          const bankCorrect =
            row.correct_answer_index != null ? Number(row.correct_answer_index) : null;
          const effectiveCorrect = override ?? bankCorrect;
          if (question.correct_answer_index == null && bankCorrect != null) {
            question.correct_answer_index = bankCorrect;
          }
          question.choices = choices.slice(0, 4).map((text, i) => ({
            id: -(row.exam_question_id * 10 + i + 1),
            text,
            isCorrect: effectiveCorrect !== null && i === effectiveCorrect,
          }));
        }
      } catch {
        // teacher_questions / teacher_question_id may be unavailable on older DBs
      }
    }

    // أسئلة صورة من بنك الأسئلة قد تُضاف بدون صفوف في question_options أو question_choices؛ إضافة خيارات افتراضية أ، ب، ج، د
    const defaultChoiceLabels = ['أ', 'ب', 'ج', 'د'];
    map.forEach((question) => {
      if (question.choices.length !== 0) return;
      // أي سؤال بدون خيارات (سواء صورة أو نص) نضيف له الخيارات الافتراضية إن وُجدت إجابة صحيحة، وإلا نضيفها لأي سؤال صورة
      const hasImage = !!question.image;
      const correctIndex =
        question.correct_answer_index_override != null
          ? question.correct_answer_index_override
          : question.correct_answer_index != null &&
              question.correct_answer_index >= 0 &&
              question.correct_answer_index <= 3
            ? question.correct_answer_index
            : null;
      const shouldAddDefaults = hasImage || correctIndex !== null;
      if (!shouldAddDefaults) return;

      defaultChoiceLabels.forEach((text, index) => {
        question.choices.push({
          id: -(index + 1), // IDs سالبة لتجنب التضارب مع خيارات حقيقية
          text,
          isCorrect: correctIndex !== null ? index === correctIndex : false,
        });
      });
    });

    const questions = Array.from(map.values());
    const passageIds = [
      ...new Set(questions.map((q) => q.passage_id).filter((id): id is number => id != null)),
    ];
    if (passageIds.length > 0) {
      const passagesRes = await pool.query(
        `SELECT id, title, content FROM question_passages WHERE id = ANY($1::int[])`,
        [passageIds],
      );
      const passageMap = new Map<number, { id: number; title?: string | null; content: string }>();
      passagesRes.rows.forEach((row: { id: number; title?: string | null; content: string }) => {
        passageMap.set(row.id, { id: row.id, title: row.title, content: row.content });
      });
      questions.forEach((question) => {
        if (question.passage_id != null) {
          question.passage = passageMap.get(question.passage_id) ?? null;
        }
      });
    }
    return questions;
  }

  private static sanitizeOneQuestion(question: ExamQuestion, includeCorrect: boolean) {
    return {
      id: question.id,
      examQuestionId: question.id,
      text: question.text,
      image: question.image,
      grade: question.grade,
      passage: question.passage ?? null,
      ...(question.isVisible !== undefined && includeCorrect ? { isVisible: question.isVisible } : {}),
      choices: question.choices.map((choice) => ({
        id: choice.id,
        text: choice.text,
        ...(choice.image ? { image: choice.image } : {}),
        ...(includeCorrect ? { is_correct: choice.isCorrect } : {}),
      })),
    };
  }

  private static sanitizeQuestions(
    items: ExamQuestion[],
    includeCorrect: boolean,
  ) {
    return items.map((item) => this.sanitizeOneQuestion(item, includeCorrect));
  }

  private static evaluateAnswers(questions: ExamQuestion[], answers: AnswerPayload[]) {
    const answerMap = new Map<number, number | null>();
    answers.forEach((answer) => {
      answerMap.set(answer.questionId, answer.choiceId ?? null);
    });

    let totalGrade = 0;
    let maxGrade = 0;
    const evaluatedQuestions: QuestionEvaluation[] = [];

    questions.forEach((question) => {
      const selectedChoiceId = answerMap.get(question.id) ?? null;
      const selectedChoice = question.choices.find((c) => c.id === selectedChoiceId) || null;
      const correctChoice = question.choices.find((c) => c.isCorrect) || null;

      const isCorrect = !!(selectedChoice && selectedChoice.isCorrect);
      if (isCorrect) {
        totalGrade += question.grade || 1;
      }
      maxGrade += question.grade || 1;

      evaluatedQuestions.push({
        questionId: question.id,
        questionText: question.text,
        questionImage: question.image,
        grade: question.grade || 1,
        isCorrect,
        correctChoiceId: correctChoice ? correctChoice.id : null,
        selectedChoiceId,
        correctChoice: correctChoice ? { id: correctChoice.id, text: correctChoice.text } : null,
        yourChoice: selectedChoice
          ? { id: selectedChoice.id, text: selectedChoice.text }
          : { id: null, text: null },
      });
    });

    const passed = totalGrade >= Math.ceil(maxGrade / 2);

    return { totalGrade, maxGrade, passed, questions: evaluatedQuestions };
  }

  private static async persistAttemptAnswers(attemptId: number, questions: QuestionEvaluation[]) {
    await pool.query('DELETE FROM exam_answers WHERE submission_id = $1', [attemptId]);

    const values: any[] = [];
    const placeholders: string[] = [];
    questions.forEach((question, idx) => {
      const base = idx * 5;
      placeholders.push(
        `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, NULL, $${base + 5})`,
      );
      // الخيارات الافتراضية (أ، ب، ج، د) تستخدم IDs سالبة ولا تُخزَن في question_choices؛ نمرّر null لـ selected_choice_id
      const selectedChoiceId =
        question.selectedChoiceId != null && question.selectedChoiceId > 0
          ? question.selectedChoiceId
          : null;
      values.push(
        attemptId,
        question.questionId,
        selectedChoiceId,
        question.isCorrect,
        question.isCorrect ? question.grade : 0,
      );
    });

    if (values.length) {
      await pool.query(
        `INSERT INTO exam_answers (
          submission_id,
          question_id,
          selected_choice_id,
          is_correct,
          answer_text,
          grade
        ) VALUES ${placeholders.join(', ')}`,
        values,
      );
    }
  }

  private static shouldReleaseAnswers(
    exam: any,
    attempt: any,
    referenceDate: Date,
  ): ReleaseDecision {
    return determineAnswerRelease(
      {
        answersReleaseMode: exam.answers_release_mode,
        showAnswersImmediately: !!exam.show_answers_immediately,
        showAnswersLater: !!exam.show_answers_later,
        answersReleaseDate: exam.answers_release_date,
        showAnswersAfterHours: exam.show_answers_after_hours ?? 0,
        examExpireAt: exam.hide_at,
      },
      attempt
        ? {
          status: attempt.status as AttemptSnapshot['status'],
          attemptStartTime: attempt.attempt_start_time,
          attemptExpireAt: attempt.attempt_expire_at,
          submittedAt: attempt.submitted_at,
        }
        : null,
      referenceDate,
    );
  }

  private static async buildFeedbackIfAllowed(exam: any, attempts: any[]) {
    const latestAttempt = attempts.find((a) => ['submitted', 'late'].includes(a.status));
    if (!latestAttempt) return null;

    const decision = this.shouldReleaseAnswers(exam, latestAttempt, new Date());
    if (!decision.release) return null;

    const answers = await this.getAttemptAnswers(latestAttempt.id);
    return {
      attemptId: latestAttempt.id,
      releasedAt: new Date(),
      releaseReason: decision.reason,
      wrongQuestions: mapWrongQuestionsFromAnswers(answers),
      answers,
    };
  }

  private static async getAttemptAnswers(attemptId: number): Promise<AttemptAnswersDetail[]> {
    const res = await pool.query(
      `SELECT 
        ea.question_id as exam_question_id,
        eq.question_text,
        eq.image,
        q.text as bank_text,
        q.image as bank_image,
        q2.question_text as bank_text_v2,
        qm.media_url as bank_image_v2,
        ea.selected_choice_id,
        ea.is_correct,
        selected_choice.text as selected_choice_text,
        selected_opt.text_content as selected_choice_text_v2,
        correct_choice.id as correct_choice_id,
        correct_choice.text as correct_choice_text,
        correct_opt.id as correct_choice_id_v2,
        correct_opt.text_content as correct_choice_text_v2
       FROM exam_answers ea
       JOIN exam_questions eq ON ea.question_id = eq.id
       LEFT JOIN questions q ON eq.question_id = q.id
       LEFT JOIN question_choices selected_choice ON selected_choice.id = ea.selected_choice_id
       LEFT JOIN question_choices correct_choice 
         ON correct_choice.question_id = eq.question_id AND correct_choice.is_correct = true
       LEFT JOIN questions_v2 q2 ON eq.question_id_v2 = q2.id
       LEFT JOIN question_media qm ON q2.id = qm.question_id
       LEFT JOIN question_options selected_opt ON selected_opt.id = ea.selected_choice_id
       LEFT JOIN question_options correct_opt
         ON correct_opt.question_id = q2.id
        AND correct_opt.option_index = q2.correct_answer_index
       WHERE ea.submission_id = $1
       ORDER BY ea.question_id`,
      [attemptId],
    );

    return res.rows.map((row) => {
      const selectedText = row.selected_choice_text || row.selected_choice_text_v2 || null;
      const correctId = row.correct_choice_id ?? row.correct_choice_id_v2 ?? null;
      const correctText = row.correct_choice_text || row.correct_choice_text_v2 || null;
      return {
        questionId: row.exam_question_id,
        questionText: row.question_text || row.bank_text || row.bank_text_v2 || null,
        questionImage: row.image || row.bank_image || row.bank_image_v2 || null,
        selectedChoice: {
          id: row.selected_choice_id,
          text: selectedText,
        },
        correctChoice:
          correctId != null || correctText ? { id: correctId, text: correctText } : null,
        isCorrect: row.is_correct,
      };
    });
  }

  /**
   * قائمة تسليمات امتحان المحاضرة للمدرس مع الأسئلة الخاطئة لكل طالب.
   */
  static async listLectureExamSubmissionsWithWrongQuestions(examId: number) {
    const subsRes = await pool.query(
      `SELECT s.id as submission_id, s.student_id, s.total_grade, s.submitted_at, s.passed,
              s.status, s.attempt_number, s.attempt_start_time, s.attempt_expire_at,
              (
                SELECT COUNT(*)::int FROM exam_answers ea WHERE ea.submission_id = s.id
              ) AS answered_count,
              u.name, u.email, u.phone
       FROM exam_submissions s
       JOIN users u ON s.student_id = u.id
       WHERE s.exam_id = $1
         AND COALESCE(s.status, 'submitted') IN ('submitted', 'late', 'expired', 'in_progress')
       ORDER BY CASE WHEN COALESCE(s.status, 'submitted') = 'in_progress' THEN 0 ELSE 1 END,
         s.submitted_at DESC NULLS LAST, s.id DESC`,
      [examId],
    );

    if (!subsRes.rowCount) {
      return [];
    }

    const submissionIds = subsRes.rows.map((r) => Number(r.submission_id));
    const answersRes = await pool.query(
      `SELECT 
        ea.submission_id,
        ea.question_id as exam_question_id,
        eq.question_text,
        eq.image,
        q.text as bank_text,
        q.image as bank_image,
        q2.question_text as bank_text_v2,
        qm.media_url as bank_image_v2,
        ea.selected_choice_id,
        ea.is_correct,
        selected_choice.text as selected_choice_text,
        selected_opt.text_content as selected_choice_text_v2,
        correct_choice.id as correct_choice_id,
        correct_choice.text as correct_choice_text,
        correct_opt.id as correct_choice_id_v2,
        correct_opt.text_content as correct_choice_text_v2
       FROM exam_answers ea
       JOIN exam_questions eq ON ea.question_id = eq.id
       LEFT JOIN questions q ON eq.question_id = q.id
       LEFT JOIN question_choices selected_choice ON selected_choice.id = ea.selected_choice_id
       LEFT JOIN question_choices correct_choice 
         ON correct_choice.question_id = eq.question_id AND correct_choice.is_correct = true
       LEFT JOIN questions_v2 q2 ON eq.question_id_v2 = q2.id
       LEFT JOIN question_media qm ON q2.id = qm.question_id
       LEFT JOIN question_options selected_opt ON selected_opt.id = ea.selected_choice_id
       LEFT JOIN question_options correct_opt
         ON correct_opt.question_id = q2.id
        AND correct_opt.option_index = q2.correct_answer_index
       WHERE ea.submission_id = ANY($1::int[])
         AND ea.is_correct = FALSE
       ORDER BY ea.submission_id, ea.question_id`,
      [submissionIds],
    );

    const wrongBySubmission = new Map<number, WrongQuestion[]>();
    for (const row of answersRes.rows) {
      const sid = Number(row.submission_id);
      const list = wrongBySubmission.get(sid) || [];
      const correctId = row.correct_choice_id ?? row.correct_choice_id_v2 ?? null;
      const correctText = row.correct_choice_text || row.correct_choice_text_v2 || null;
      list.push({
        questionId: row.exam_question_id,
        questionText: row.question_text || row.bank_text || row.bank_text_v2 || null,
        questionImage: row.image || row.bank_image || row.bank_image_v2 || null,
        correctChoice:
          correctId != null || correctText ? { id: correctId, text: correctText } : null,
        yourChoice: {
          id: row.selected_choice_id,
          text: row.selected_choice_text || row.selected_choice_text_v2 || null,
        },
      });
      wrongBySubmission.set(sid, list);
    }

    return subsRes.rows.map((row) => {
      const wrong = wrongBySubmission.get(Number(row.submission_id)) || [];
      const inProgress = String(row.status || '') === 'in_progress';
      return {
        submission_id: row.submission_id,
        student_id: row.student_id,
        total_grade: inProgress ? null : row.total_grade,
        submitted_at: row.submitted_at,
        started_at: row.attempt_start_time ?? null,
        passed: inProgress ? false : row.passed,
        status: row.status,
        in_progress: inProgress,
        exam_status: inProgress ? 'in_progress' : row.status,
        attempt_number: row.attempt_number,
        answered_count: Number(row.answered_count || 0),
        remaining_seconds: inProgress ? calculateRemainingSeconds(row.attempt_expire_at) : null,
        name: row.name,
        email: row.email,
        phone: row.phone,
        wrong_questions: inProgress ? [] : wrong,
        wrong_questions_count: inProgress ? 0 : wrong.length,
      };
    });
  }

  private static async maybeAddStudentPoints(
    studentId: number,
    examId: number,
    obtainedGrade: number,
    maxGrade: number,
  ) {
    try {
      // @ts-expect-error dynamic import
      const { StudentPointsService } = await import('./studentPoints');
      const examInfo = await pool.query('SELECT title FROM exams WHERE id = $1', [examId]);
      const examTitle = examInfo.rowCount ? examInfo.rows[0].title : null;
      const hasPoints = await StudentPointsService.hasExamPoints(studentId, examId);
      if (!hasPoints) {
        await StudentPointsService.addExamPoints(
          studentId,
          examId,
          obtainedGrade,
          maxGrade,
          examTitle,
          'lecture_exam',
        );
      }
    } catch (error) {
      console.error('Error adding exam points:', error);
    }
  }

  private static mapExamRow(row: any, availabilityStatus?: string) {
    return {
      id: row.id,
      lectureId: row.lecture_id,
      title: row.title,
      type: row.type,
      totalGrade: row.total_grade,
      duration: row.duration,
      isVisible: row.is_visible,
      showAt: row.show_at,
      hideAt: row.hide_at,
      expireAt: row.hide_at,
      lockNextLectures: row.lock_next_lectures,
      questionsCount: row.questions_count,
      actualQuestionsCount: row.actual_questions_count ?? null,
      questionDisplayMode: row.question_display_mode || 'ordered',
      answersReleaseMode: row.answers_release_mode || inferAnswersReleaseMode({
        showAnswersImmediately: row.show_answers_immediately,
        showAnswersLater: row.show_answers_later,
        answersReleaseDate: row.answers_release_date,
        showAnswersAfterHours: row.show_answers_after_hours,
      }),
      showAnswersImmediately: row.show_answers_immediately,
      showAnswersAfterHours: row.show_answers_after_hours,
      allowMultipleAttempts: row.allow_multiple_attempts,
      showAnswersLater: row.show_answers_later,
      answersReleaseDate: row.answers_release_date,
      timeLimitEnabled: row.time_limit_enabled,
      timeLimitMinutes: row.time_limit_minutes,
      startWindow: row.start_window,
      endWindow: row.end_window,
      availabilityStatus: availabilityStatus || null,
      canStart: availabilityStatus ? availabilityStatus === 'open' : null,
      createdAt: row.created_at,
    };
  }
}

const toAttemptSnapshot = (attempt: any): AttemptSnapshot => ({
  status: attempt.status as AttemptSnapshot['status'],
  attemptStartTime: attempt.attempt_start_time,
  attemptExpireAt: attempt.attempt_expire_at,
  submittedAt: attempt.submitted_at,
});

const mapWrongQuestionsFromAnswers = (answers: AttemptAnswersDetail[]): WrongQuestion[] =>
  answers
    .filter((answer) => !answer.isCorrect)
    .map((answer) => ({
      questionId: answer.questionId,
      questionText: answer.questionText,
      questionImage: answer.questionImage,
      correctChoice: answer.correctChoice,
      yourChoice: answer.selectedChoice,
    }));
