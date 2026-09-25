import { z } from 'zod';
import type { PoolClient } from 'pg';
import pool from '../db/pool';
import { HttpError } from '../utils';
import { TeacherActivityLogService } from './teacherActivityLog';
import { ExamFlowService } from './examFlow';
import { CourseLevelExamQuestionsService } from './courseLevelExamQuestions';

const MIN_OPTIONS = 2;
const MAX_OPTIONS = 5;
const MAX_QUESTIONS_PER_PASSAGE = 50;

const optionInputSchema = z
  .object({
    text: z.string().min(1, 'نص الاختيار مطلوب').optional(),
    option_text: z.string().min(1).optional(),
    text_content: z.string().min(1).optional(),
    isCorrect: z.boolean().optional(),
    is_correct: z.boolean().optional(),
  })
  .passthrough();

const questionInputSchema = z
  .object({
    id: z.coerce.number().int().positive().optional(),
    questionText: z.string().optional(),
    question_text: z.string().optional(),
    type: z.string().optional(),
    question_type: z.string().optional(),
    options: z.array(optionInputSchema).optional(),
    choices: z.union([z.array(z.string()), z.array(optionInputSchema)]).optional(),
    optionA: z.string().optional(),
    optionB: z.string().optional(),
    optionC: z.string().optional(),
    optionD: z.string().optional(),
    option_a: z.string().optional(),
    option_b: z.string().optional(),
    option_c: z.string().optional(),
    option_d: z.string().optional(),
    correctAnswer: z.union([z.string(), z.number()]).optional(),
    correct_answer: z.union([z.string(), z.number()]).optional(),
    correctAnswerIndex: z.coerce.number().int().optional(),
    correct_answer_index: z.coerce.number().int().optional(),
    answer: z.string().optional(),
    explanation: z.string().nullable().optional(),
    difficulty_level: z.enum(['easy', 'medium', 'hard']).optional(),
    points: z.coerce.number().int().positive().optional(),
    image_url: z.string().nullable().optional(),
  })
  .passthrough();

export const CreateReadingPassageSchema = z.object({
  lessonId: z.coerce.number().int().positive().optional(),
  lesson_id: z.coerce.number().int().positive().optional(),
  passageText: z.string().optional(),
  passage_text: z.string().optional(),
  content: z.string().optional(),
  title: z.string().nullable().optional(),
  questions: z.array(questionInputSchema).optional(),
  questionsBulkText: z.string().optional(),
  bulkQuestionsText: z.string().optional(),
  bulk_text: z.string().optional(),
  mcqText: z.string().optional(),
  correctAnswers: z.array(z.union([z.string(), z.number()])).optional(),
});

export const UpdateReadingPassageSchema = z.object({
  passageText: z.string().optional(),
  passage_text: z.string().optional(),
  content: z.string().optional(),
  title: z.string().nullable().optional(),
  questions: z.array(questionInputSchema).optional(),
  questionsBulkText: z.string().optional(),
  bulkQuestionsText: z.string().optional(),
  bulk_text: z.string().optional(),
  mcqText: z.string().optional(),
  correctAnswers: z.array(z.union([z.string(), z.number()])).optional(),
});

export type NormalizedMcqQuestion = {
  id?: number;
  questionText: string;
  choices: string[];
  correctAnswerIndex: number;
  explanation: string | null;
  difficultyLevel: 'easy' | 'medium' | 'hard';
  points: number;
  imageUrl: string | null;
};

function optionText(opt: z.infer<typeof optionInputSchema> | string): string {
  if (typeof opt === 'string') return opt.trim();
  return String(opt.text ?? opt.option_text ?? opt.text_content ?? '').trim();
}

function optionIsCorrect(opt: z.infer<typeof optionInputSchema> | string): boolean | null {
  if (typeof opt === 'string') return null;
  if (typeof opt.isCorrect === 'boolean') return opt.isCorrect;
  if (typeof opt.is_correct === 'boolean') return opt.is_correct;
  return null;
}

function letterOrIndexToCorrectIndex(value: unknown, choicesLength: number): number | null {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value >= 0 && value < choicesLength ? value : null;
  }
  const raw = String(value).trim();
  if (/^\d+$/.test(raw)) {
    const n = Number(raw);
    return n >= 0 && n < choicesLength ? n : null;
  }
  const map: Record<string, number> = {
    A: 0,
    B: 1,
    C: 2,
    D: 3,
    E: 4,
    أ: 0,
    ا: 0,
    ب: 1,
    ج: 2,
    د: 3,
  };
  const upper = raw.toUpperCase();
  if (upper in map) {
    const idx = map[upper]!;
    return idx < choicesLength ? idx : null;
  }
  if (raw in map) {
    const idx = map[raw]!;
    return idx < choicesLength ? idx : null;
  }
  return null;
}

function extractBulkText(body: Record<string, unknown>): string | null {
  const candidates = [
    body.questionsBulkText,
    body.bulkQuestionsText,
    body.bulk_text,
    body.mcqText,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim();
  }
  return null;
}

/** يقبل مصفوفة أسئلة أو JSON string أو نص Bulk لعدة أسئلة دفعة واحدة */
export function resolveQuestionsFromBody(body: Record<string, unknown>): unknown[] {
  let list: unknown[] = [];

  let rawQuestions = body.questions;
  if (typeof rawQuestions === 'string' && rawQuestions.trim()) {
    try {
      rawQuestions = JSON.parse(rawQuestions);
    } catch {
      throw new HttpError(400, 'حقل questions يجب أن يكون مصفوفة JSON صالحة');
    }
  }
  if (Array.isArray(rawQuestions)) {
    list = [...rawQuestions];
  }

  const bulkText = extractBulkText(body);
  if (bulkText) {
    const correctAnswers = Array.isArray(body.correctAnswers)
      ? (body.correctAnswers as ('A' | 'B' | 'C' | 'D')[])
      : undefined;
    type BulkQ = {
      questionText: string;
      optionA: string;
      optionB: string;
      optionC: string;
      optionD: string;
      correctAnswer: 'A' | 'B' | 'C' | 'D';
      points?: number;
    };
    let parsed: BulkQ[] = ExamFlowService.parsePassageMcqBulkText(bulkText).map((q) => ({
      ...q,
      correctAnswer: (q.correctAnswer ?? 'A') as 'A' | 'B' | 'C' | 'D',
    }));
    if (!parsed.length) {
      parsed = CourseLevelExamQuestionsService.parseBulkQuestionText(bulkText, correctAnswers);
    } else if (correctAnswers?.length) {
      parsed = parsed.map((q, i) => ({
        ...q,
        correctAnswer: (correctAnswers[i] ?? q.correctAnswer) as 'A' | 'B' | 'C' | 'D',
      }));
    }
    list = [
      ...list,
      ...parsed.map((q) => ({
        questionText: q.questionText,
        optionA: q.optionA,
        optionB: q.optionB,
        optionC: q.optionC,
        optionD: q.optionD,
        correctAnswer: q.correctAnswer,
        points: q.points,
      })),
    ];
  }

  if (!list.length) {
    throw new HttpError(
      400,
      'يجب إرسال questions كمصفوفة (5 أو 10 أسئلة مثلًا) أو questionsBulkText كنص لعدة أسئلة دفعة واحدة',
    );
  }
  if (list.length > MAX_QUESTIONS_PER_PASSAGE) {
    throw new HttpError(
      400,
      `الحد الأقصى ${MAX_QUESTIONS_PER_PASSAGE} سؤال مع القطعة في الطلب الواحد`,
    );
  }
  return list;
}

export function normalizeMcqQuestion(
  raw: z.infer<typeof questionInputSchema>,
  index: number,
): NormalizedMcqQuestion {
  const questionText = String(raw.questionText ?? raw.question_text ?? '').trim();
  if (!questionText) {
    throw new HttpError(400, `نص السؤال مطلوب للسؤال رقم ${index + 1}`);
  }

  const type = String(raw.type ?? raw.question_type ?? 'MCQ').trim().toLowerCase();
  const allowedTypes = new Set(['mcq', 'choice', 'multiple_choice', 'multiple-choice', '']);
  if (!allowedTypes.has(type)) {
    throw new HttpError(400, `أسئلة قطعة القراءة يجب أن تكون MCQ فقط (السؤال رقم ${index + 1})`);
  }

  let choices: string[] = [];
  let correctFromFlags: number | null = null;

  if (Array.isArray(raw.options) && raw.options.length > 0) {
    choices = raw.options.map(optionText);
    const correctFlags = raw.options.map(optionIsCorrect);
    const trueIndexes = correctFlags
      .map((v, i) => (v === true ? i : -1))
      .filter((i) => i >= 0);
    if (trueIndexes.length > 1) {
      throw new HttpError(400, `يجب أن تكون هناك إجابة صحيحة واحدة فقط للسؤال رقم ${index + 1}`);
    }
    if (trueIndexes.length === 1) correctFromFlags = trueIndexes[0]!;
    if (correctFlags.every((v) => v === false)) {
      throw new HttpError(400, `يجب تحديد إجابة صحيحة للسؤال رقم ${index + 1}`);
    }
  } else if (Array.isArray(raw.choices) && raw.choices.length > 0) {
    if (typeof raw.choices[0] === 'string') {
      choices = (raw.choices as string[]).map((c) => String(c ?? '').trim());
    } else {
      const opts = raw.choices as z.infer<typeof optionInputSchema>[];
      choices = opts.map(optionText);
      const trueIndexes = opts
        .map((o, i) => (optionIsCorrect(o) === true ? i : -1))
        .filter((i) => i >= 0);
      if (trueIndexes.length > 1) {
        throw new HttpError(400, `يجب أن تكون هناك إجابة صحيحة واحدة فقط للسؤال رقم ${index + 1}`);
      }
      if (trueIndexes.length === 1) correctFromFlags = trueIndexes[0]!;
    }
  } else {
    // صيغة optionA/B/C/D الشائعة عند إرسال عدة أسئلة دفعة واحدة
    const fromLetters = [
      raw.optionA ?? raw.option_a,
      raw.optionB ?? raw.option_b,
      raw.optionC ?? raw.option_c,
      raw.optionD ?? raw.option_d,
    ]
      .map((v) => (v != null ? String(v).trim() : ''))
      .filter((v) => v.length > 0);
    if (fromLetters.length) choices = fromLetters;
  }

  choices = choices.filter((c) => c.length > 0);
  if (choices.length < MIN_OPTIONS) {
    throw new HttpError(
      400,
      `كل سؤال يحتاج ${MIN_OPTIONS} اختيارات على الأقل (السؤال رقم ${index + 1})`,
    );
  }
  if (choices.length > MAX_OPTIONS) {
    throw new HttpError(
      400,
      `الحد الأقصى للاختيارات ${MAX_OPTIONS} (السؤال رقم ${index + 1})`,
    );
  }

  let correctAnswerIndex =
    correctFromFlags ??
    (raw.correctAnswerIndex != null ? Number(raw.correctAnswerIndex) : null) ??
    (raw.correct_answer_index != null ? Number(raw.correct_answer_index) : null);

  if (correctAnswerIndex == null) {
    correctAnswerIndex = letterOrIndexToCorrectIndex(
      raw.correctAnswer ?? raw.correct_answer ?? raw.answer,
      choices.length,
    );
  }

  if (correctAnswerIndex == null && raw.answer) {
    const answer = String(raw.answer).trim();
    const byText = choices.findIndex((c) => c === answer);
    if (byText >= 0) correctAnswerIndex = byText;
  }

  if (
    correctAnswerIndex == null ||
    !Number.isInteger(correctAnswerIndex) ||
    correctAnswerIndex < 0 ||
    correctAnswerIndex >= choices.length
  ) {
    throw new HttpError(400, `يجب تحديد إجابة صحيحة واحدة صالحة للسؤال رقم ${index + 1}`);
  }

  return {
    id: raw.id,
    questionText,
    choices,
    correctAnswerIndex,
    explanation: raw.explanation != null ? String(raw.explanation) : null,
    difficultyLevel: raw.difficulty_level ?? 'medium',
    points: raw.points ?? 1,
    imageUrl: raw.image_url != null ? String(raw.image_url) : null,
  };
}

function resolvePassageText(body: {
  passageText?: string;
  passage_text?: string;
  content?: string;
}): string {
  return String(body.passageText ?? body.passage_text ?? body.content ?? '').trim();
}

function formatQuestionRow(row: Record<string, unknown>, passage?: PassageSummary | null) {
  let choices = row.choices;
  if (typeof choices === 'string') {
    try {
      choices = JSON.parse(choices);
    } catch {
      choices = [];
    }
  }
  const options = Array.isArray(choices)
    ? choices.map((text: unknown, i: number) => ({
        text: String(text ?? ''),
        isCorrect: Number(row.correct_answer_index) === i,
      }))
    : [];

  return {
    id: row.id,
    lessonId: row.lesson_id,
    lesson_id: row.lesson_id,
    passageId: row.passage_id ?? null,
    passage_id: row.passage_id ?? null,
    questionText: row.question_text,
    question_text: row.question_text,
    type: 'MCQ',
    question_type: row.question_type ?? 'choice',
    options,
    choices,
    correctAnswerIndex: row.correct_answer_index,
    correct_answer_index: row.correct_answer_index,
    answer: row.answer,
    explanation: row.explanation,
    difficulty_level: row.difficulty_level,
    points: row.points,
    image_url: row.image_url,
    created_at: row.created_at,
    passage:
      passage === undefined
        ? undefined
        : passage
          ? { id: passage.id, text: passage.text, title: passage.title ?? null }
          : null,
  };
}

export type PassageSummary = {
  id: number;
  text: string;
  title?: string | null;
  lessonId: number;
};

export type PassageRow = {
  id: number;
  lesson_id: number;
  title: string | null;
  content: string;
  order_index: number;
  created_at: Date;
  updated_at: Date;
};

async function verifyLessonOwnership(
  lessonId: number,
  teacherId: number,
  client: PoolClient | typeof pool = pool,
): Promise<boolean> {
  const result = await client.query(
    `SELECT id FROM teacher_question_lessons WHERE id = $1 AND teacher_id = $2`,
    [lessonId, teacherId],
  );
  return Boolean(result.rowCount);
}

async function getOwnedPassage(
  passageId: number,
  teacherId: number,
  client: PoolClient | typeof pool = pool,
): Promise<(PassageRow & { teacher_id: number }) | null> {
  const result = await client.query(
    `SELECT p.*, l.teacher_id
     FROM teacher_question_passages p
     JOIN teacher_question_lessons l ON l.id = p.lesson_id
     WHERE p.id = $1 AND l.teacher_id = $2`,
    [passageId, teacherId],
  );
  return result.rows[0] ?? null;
}

async function insertQuestion(
  client: PoolClient,
  lessonId: number,
  passageId: number,
  q: NormalizedMcqQuestion,
) {
  const result = await client.query(
    `INSERT INTO teacher_questions (
       lesson_id, passage_id, question_text, question_type, choices, answer,
       image_url, correct_answer_index, explanation, difficulty_level, points
     ) VALUES ($1, $2, $3, 'choice', $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      lessonId,
      passageId,
      q.questionText,
      JSON.stringify(q.choices),
      q.choices[q.correctAnswerIndex] ?? null,
      q.imageUrl,
      q.correctAnswerIndex,
      q.explanation,
      q.difficultyLevel,
      q.points,
    ],
  );
  return result.rows[0];
}

async function updateQuestion(
  client: PoolClient,
  questionId: number,
  lessonId: number,
  passageId: number,
  q: NormalizedMcqQuestion,
) {
  const result = await client.query(
    `UPDATE teacher_questions
     SET question_text = $1,
         question_type = 'choice',
         choices = $2,
         answer = $3,
         image_url = $4,
         correct_answer_index = $5,
         explanation = $6,
         difficulty_level = $7,
         points = $8,
         passage_id = $9
     WHERE id = $10 AND lesson_id = $11
     RETURNING *`,
    [
      q.questionText,
      JSON.stringify(q.choices),
      q.choices[q.correctAnswerIndex] ?? null,
      q.imageUrl,
      q.correctAnswerIndex,
      q.explanation,
      q.difficultyLevel,
      q.points,
      passageId,
      questionId,
      lessonId,
    ],
  );
  if (!result.rowCount) {
    throw new HttpError(404, `السؤال ${questionId} غير موجود داخل هذه القطعة/الدرس`);
  }
  return result.rows[0];
}

export class TeacherReadingPassagesService {
  static formatPassage(row: PassageRow, questions: Record<string, unknown>[] = []) {
    const summary: PassageSummary = {
      id: row.id,
      text: row.content,
      title: row.title,
      lessonId: row.lesson_id,
    };
    return {
      id: row.id,
      lessonId: row.lesson_id,
      lesson_id: row.lesson_id,
      title: row.title,
      passageText: row.content,
      content: row.content,
      order_index: row.order_index,
      created_at: row.created_at,
      updated_at: row.updated_at,
      questions: questions.map((q) => formatQuestionRow(q, summary)),
      questionsCount: questions.length,
    };
  }

  static attachPassageToQuestion(
    question: Record<string, unknown>,
    passageById: Map<number, PassageSummary>,
  ) {
    const passageId = question.passage_id != null ? Number(question.passage_id) : null;
    const passage = passageId != null ? passageById.get(passageId) ?? null : null;
    return formatQuestionRow(question, passage);
  }

  static async loadPassageMapForQuestions(
    questions: Array<{ passage_id?: number | null }>,
  ): Promise<Map<number, PassageSummary>> {
    const ids = [
      ...new Set(
        questions
          .map((q) => (q.passage_id != null ? Number(q.passage_id) : null))
          .filter((id): id is number => id != null && Number.isInteger(id) && id > 0),
      ),
    ];
    const map = new Map<number, PassageSummary>();
    if (!ids.length) return map;
    const res = await pool.query<PassageRow>(
      `SELECT * FROM teacher_question_passages WHERE id = ANY($1::int[])`,
      [ids],
    );
    for (const row of res.rows) {
      map.set(row.id, {
        id: row.id,
        text: row.content,
        title: row.title,
        lessonId: row.lesson_id,
      });
    }
    return map;
  }

  static async create(teacherId: number, body: unknown) {
    const parsed = CreateReadingPassageSchema.safeParse(body);
    if (!parsed.success) {
      throw new HttpError(400, 'Validation failed', {
        errors: parsed.error.errors,
      });
    }

    const lessonId = parsed.data.lessonId ?? parsed.data.lesson_id;
    if (lessonId == null) {
      throw new HttpError(400, 'lessonId مطلوب');
    }

    const passageText = resolvePassageText(parsed.data);
    if (!passageText) {
      throw new HttpError(400, 'passageText مطلوب ولا يمكن أن يكون فارغًا');
    }

    if (!(await verifyLessonOwnership(lessonId, teacherId))) {
      throw new HttpError(404, 'الدرس غير موجود أو غير مسموح لك بالإضافة إليه');
    }

    // يدعم إرسال كل الأسئلة (5 / 10 / ...) مع القطعة في نفس الطلب
    const rawQuestions = resolveQuestionsFromBody(parsed.data as Record<string, unknown>);
    const questions = rawQuestions.map((q, i) =>
      normalizeMcqQuestion(questionInputSchema.parse(q), i),
    );
    const title =
      parsed.data.title != null && String(parsed.data.title).trim()
        ? String(parsed.data.title).trim()
        : null;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const passageResult = await client.query<PassageRow>(
        `INSERT INTO teacher_question_passages (lesson_id, title, content, order_index)
         VALUES ($1, $2, $3, 0)
         RETURNING *`,
        [lessonId, title, passageText],
      );
      const passage = passageResult.rows[0];

      const createdQuestions = [];
      for (const q of questions) {
        createdQuestions.push(await insertQuestion(client, lessonId, passage.id, q));
      }

      await client.query('COMMIT');

      await TeacherActivityLogService.log({
        teacher_id: teacherId,
        action: 'add_reading_passage',
        entity_type: 'reading_passage',
        entity_id: passage.id,
        description: `أضاف قطعة قراءة مع ${createdQuestions.length} سؤال`,
      });

      const formatted = this.formatPassage(passage, createdQuestions);
      return {
        passage: {
          id: formatted.id,
          lessonId: formatted.lessonId,
          passageText: formatted.passageText,
          title: formatted.title,
        },
        questions: formatted.questions,
        questionsCount: formatted.questionsCount,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  static async getById(teacherId: number, passageId: number) {
    const owned = await getOwnedPassage(passageId, teacherId);
    if (!owned) throw new HttpError(404, 'قطعة القراءة غير موجودة');

    const questions = (
      await pool.query(
        `SELECT * FROM teacher_questions WHERE passage_id = $1 ORDER BY id ASC`,
        [passageId],
      )
    ).rows;

    return this.formatPassage(owned, questions);
  }

  static async update(teacherId: number, passageId: number, body: unknown) {
    const parsed = UpdateReadingPassageSchema.safeParse(body);
    if (!parsed.success) {
      throw new HttpError(400, 'Validation failed', {
        errors: parsed.error.errors,
      });
    }

    const owned = await getOwnedPassage(passageId, teacherId);
    if (!owned) throw new HttpError(404, 'قطعة القراءة غير موجودة');

    const nextText = resolvePassageText(parsed.data);
    const hasTextUpdate =
      parsed.data.passageText !== undefined ||
      parsed.data.passage_text !== undefined ||
      parsed.data.content !== undefined;

    if (hasTextUpdate && !nextText) {
      throw new HttpError(400, 'passageText لا يمكن أن يكون فارغًا');
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const titleUpdate =
        parsed.data.title !== undefined
          ? parsed.data.title != null && String(parsed.data.title).trim()
            ? String(parsed.data.title).trim()
            : null
          : owned.title;

      const contentUpdate = hasTextUpdate ? nextText : owned.content;

      const passageResult = await client.query<PassageRow>(
        `UPDATE teacher_question_passages
         SET title = $1, content = $2, updated_at = NOW()
         WHERE id = $3
         RETURNING *`,
        [titleUpdate, contentUpdate, passageId],
      );
      const passage = passageResult.rows[0];

      let questionsRows: Record<string, unknown>[] = [];

      const hasQuestionsUpdate =
        parsed.data.questions !== undefined ||
        extractBulkText(parsed.data as Record<string, unknown>) != null;

      if (hasQuestionsUpdate) {
        const rawQuestions = resolveQuestionsFromBody(parsed.data as Record<string, unknown>);
        const normalized = rawQuestions.map((q, i) =>
          normalizeMcqQuestion(questionInputSchema.parse(q), i),
        );
        const existingRes = await client.query<{ id: number }>(
          `SELECT id FROM teacher_questions WHERE passage_id = $1`,
          [passageId],
        );
        const existingIds = new Set(existingRes.rows.map((r) => r.id));
        const keepIds = new Set<number>();

        for (const q of normalized) {
          if (q.id != null) {
            if (!existingIds.has(q.id)) {
              throw new HttpError(404, `السؤال ${q.id} غير مرتبط بهذه القطعة`);
            }
            keepIds.add(q.id);
            questionsRows.push(
              await updateQuestion(client, q.id, owned.lesson_id, passageId, q),
            );
          } else {
            const created = await insertQuestion(client, owned.lesson_id, passageId, q);
            keepIds.add(created.id);
            questionsRows.push(created);
          }
        }

        const toDelete = [...existingIds].filter((id) => !keepIds.has(id));
        if (toDelete.length) {
          await client.query(
            `DELETE FROM teacher_questions WHERE passage_id = $1 AND id = ANY($2::int[])`,
            [passageId, toDelete],
          );
        }

        // re-fetch in stable order
        questionsRows = (
          await client.query(
            `SELECT * FROM teacher_questions WHERE passage_id = $1 ORDER BY id ASC`,
            [passageId],
          )
        ).rows;
      } else {
        questionsRows = (
          await client.query(
            `SELECT * FROM teacher_questions WHERE passage_id = $1 ORDER BY id ASC`,
            [passageId],
          )
        ).rows;
      }

      await client.query('COMMIT');

      await TeacherActivityLogService.log({
        teacher_id: teacherId,
        action: 'edit_reading_passage',
        entity_type: 'reading_passage',
        entity_id: passageId,
        description: `عدّل قطعة قراءة #${passageId}`,
      });

      return this.formatPassage(passage, questionsRows);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  static async remove(teacherId: number, passageId: number) {
    const owned = await getOwnedPassage(passageId, teacherId);
    if (!owned) throw new HttpError(404, 'قطعة القراءة غير موجودة');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Soft-delete غير مستخدم في مكتبة المدرّس — نحذف الأسئلة ثم القطعة.
      // أسئلة الامتحانات المنسوخة تبقى snapshots مستقلة عبر exam_questions.
      await client.query(`DELETE FROM teacher_questions WHERE passage_id = $1`, [passageId]);
      await client.query(`DELETE FROM teacher_question_passages WHERE id = $1`, [passageId]);
      await client.query('COMMIT');

      await TeacherActivityLogService.log({
        teacher_id: teacherId,
        action: 'delete_reading_passage',
        entity_type: 'reading_passage',
        entity_id: passageId,
        description: `حذف قطعة قراءة #${passageId}`,
      });

      return { success: true, deletedPassageId: passageId };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
