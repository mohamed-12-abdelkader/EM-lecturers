import pool from '../db/pool';
import { config, HttpError } from '../utils';
import { QuestionBankV2Service } from './questionBankV2';
import { ExamFlowService } from './examFlow';
import { CourseLevelExamsService } from './courseLevelExams';
import {
  EXAM_BUILDER_INTENT_SYSTEM_PROMPT,
  EXAM_BUILDER_WELCOME_MESSAGE,
  EXAM_BUILDER_QUICK_EXAMPLES,
} from './examBuilderChatbot.prompts';

const DEEPSEEK_API_URL = `${config.DEEPSEEK_API_URL}/v1/chat/completions`;
const MAX_QUESTIONS = 100;
const DEFAULT_QUESTION_COUNT = 10;

export type QuestionSource = 'v2' | 'v1';

export type ExamBuilderDifficulty = 'easy' | 'medium' | 'hard';
export type ExamBuilderQuestionType = 'text_only' | 'text_with_image' | 'image_choices';

export interface BankCatalogLesson {
  id: number;
  name: string;
  order_num: number;
  question_count: number;
}

export interface BankCatalogChapter {
  id: number;
  name: string;
  order_num: number;
  subject_name: string;
  lessons: BankCatalogLesson[];
  question_count: number;
}

export interface ParsedExamRequest {
  question_count: number;
  chapter_names: string[];
  chapter_numbers: number[];
  lesson_names: string[];
  lesson_numbers: number[];
  question_types: ExamBuilderQuestionType[] | null;
  difficulty_levels: ExamBuilderDifficulty[] | null;
  exam_title: string | null;
  notes: string | null;
}

export interface ResolvedFilters {
  lesson_ids: number[];
  chapter_ids: number[];
  question_types: ExamBuilderQuestionType[] | null;
  difficulty_levels: ExamBuilderDifficulty[] | null;
  question_count: number;
  exam_title: string | null;
  matched_chapters: Array<{ id: number; name: string }>;
  matched_lessons: Array<{ id: number; name: string; chapter_name: string }>;
  unresolved_notes: string[];
}

export interface SelectedQuestionDetail {
  id: number;
  source: QuestionSource;
  preview_excerpt: string;
  question_type: string;
  difficulty_level: string;
  points: number;
  lesson_id: number;
  lesson_name: string | null;
  chapter_id: number;
  chapter_name: string | null;
  question: Record<string, unknown>;
}

export interface ExamBuilderSession {
  id: string;
  teacher_id: number;
  status: 'proposed' | 'approved' | 'cancelled';
  user_message: string;
  parsed_filters: ResolvedFilters;
  selected_questions: SelectedQuestionDetail[];
  shown_question_ids: number[];
  available_count: number;
  requested_count: number;
  exam_id: number | null;
  exam_type: 'lecture-exam' | 'course-exam' | null;
  created_at: Date;
  updated_at: Date;
}

export interface ExamBuilderHistoryItem {
  session_id: string;
  user_message: string;
  assistant_reply: string | null;
  status: ExamBuilderSession['status'];
  questions_count: number;
  requested_count: number;
  available_count: number;
  parsed_filters: ResolvedFilters;
  selected_questions: SelectedQuestionDetail[];
  exam_id: number | null;
  exam_type: ExamBuilderSession['exam_type'];
  created_at: Date;
  updated_at: Date;
}

export interface ExamBuilderChatResult {
  reply: string;
  session: ExamBuilderSession | null;
  thinking_ms?: number;
  actions: {
    can_approve: boolean;
    can_regenerate: boolean;
    can_adjust: boolean;
  };
}

export interface ExamAdjustInput {
  remove_ids?: number[];
  replace_ids?: number[];
  remove_positions?: number[]; // 1-based index in current proposal
  replace_positions?: number[];
  refill_removed?: boolean;
}

export interface ParsedExamAdjustRequest {
  remove_positions: number[];
  replace_positions: number[];
  remove_ids: number[];
  replace_ids: number[];
  refill_removed: boolean;
}

export interface ApproveExamPayload {
  lecture_id?: number;
  course_id?: number;
  title?: string;
  type?: string;
  duration?: number | null;
  duration_minutes?: number | null;
  total_grade?: number;
  questions_count?: number;
  create_exam?: boolean;
}

function normalizeArabic(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[أإآ]/g, 'ا')
    .replace(/[ة]/g, 'ه')
    .replace(/[ى]/g, 'ي')
    .replace(/[^\p{L}\p{N}\s]/gu, '');
}

function excerpt(text: string, max = 120): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max)}…`;
}

function mapQuestionTypes(raw: string[] | null | undefined): ExamBuilderQuestionType[] | null {
  if (!raw?.length) return null;
  const mapped = new Set<ExamBuilderQuestionType>();
  for (const item of raw) {
    const value = item.trim().toLowerCase();
    if (value === 'mcq' || value === 'multiple_choice') {
      mapped.add('text_only');
      mapped.add('text_with_image');
    } else if (
      value === 'text_only' ||
      value === 'text_with_image' ||
      value === 'image_choices'
    ) {
      mapped.add(value);
    }
  }
  return mapped.size ? [...mapped] : null;
}

function mapDifficulty(raw: string[] | null | undefined): ExamBuilderDifficulty[] | null {
  if (!raw?.length) return null;
  const allowed = new Set<ExamBuilderDifficulty>();
  for (const item of raw) {
    if (item === 'easy' || item === 'medium' || item === 'hard') {
      allowed.add(item);
    }
  }
  return allowed.size ? [...allowed] : null;
}

function parseIntentJson(content: string): ParsedExamRequest {
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
  const countRaw = Number(parsed.question_count);
  const question_count =
    Number.isInteger(countRaw) && countRaw >= 1
      ? Math.min(countRaw, MAX_QUESTIONS)
      : DEFAULT_QUESTION_COUNT;

  return {
    question_count,
    chapter_names: Array.isArray(parsed.chapter_names)
      ? parsed.chapter_names.map(String).filter(Boolean)
      : [],
    chapter_numbers: Array.isArray(parsed.chapter_numbers)
      ? parsed.chapter_numbers
          .map(Number)
          .filter((n: number) => Number.isInteger(n) && n > 0)
      : [],
    lesson_names: Array.isArray(parsed.lesson_names)
      ? parsed.lesson_names.map(String).filter(Boolean)
      : [],
    lesson_numbers: Array.isArray(parsed.lesson_numbers)
      ? parsed.lesson_numbers
          .map(Number)
          .filter((n: number) => Number.isInteger(n) && n > 0)
      : [],
    question_types: mapQuestionTypes(parsed.question_types),
    difficulty_levels: mapDifficulty(parsed.difficulty_levels),
    exam_title: parsed.exam_title ? String(parsed.exam_title).trim() : null,
    notes: parsed.notes ? String(parsed.notes).trim() : null,
  };
}

function nameMatches(candidate: string, query: string): boolean {
  const a = normalizeArabic(candidate);
  const b = normalizeArabic(query);
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a);
}

function toPlainJson<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, item) => (item instanceof Date ? item.toISOString() : item)),
  ) as T;
}

const ACCESSIBLE_LESSONS_CTE = `
  WITH accessible_lessons AS (
    -- نفس مصدر /api/teacher/subjects (teacher_subjects)
    SELECT DISTINCT l.id AS lesson_id
    FROM teacher_subjects ts
    JOIN chapters c ON c.subject_id = ts.subject_id
    JOIN lessons l ON l.chapter_id = c.id
    WHERE ts.teacher_id = $1
    UNION
    SELECT DISTINCT l.id AS lesson_id
    FROM teacher_permissions tp
    JOIN subjects s ON s.id = tp.subject_id
    JOIN chapters c ON c.subject_id = s.id
    JOIN lessons l ON l.chapter_id = c.id
    WHERE tp.teacher_id = $1 AND COALESCE(tp.is_active, TRUE) = TRUE
    UNION
    SELECT DISTINCT q.lesson_id
    FROM questions_v2 q
    WHERE q.teacher_id = $1 AND q.lesson_id IS NOT NULL
    UNION
    SELECT DISTINCT q.lesson_id
    FROM questions q
    WHERE q.teacher_id = $1 AND q.lesson_id IS NOT NULL
  )`;

function uniquePositiveInts(values: unknown[]): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  for (const value of values) {
    const n = Number(value);
    if (!Number.isInteger(n) || n <= 0 || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

function extractNumbersFromChunk(chunk: string): number[] {
  const matches = String(chunk || '').match(/\d+/g) || [];
  return uniquePositiveInts(matches);
}

function looksLikeExamAdjustRequest(message: string): boolean {
  const value = message.trim();
  if (!value) return false;
  const hasAction =
    /(شيل|احذف|حذف|ازل|أزل|استبدل|بدّل|بدل|غير|غيّر|remove|replace|swap)/i.test(value);
  const hasQuestion =
    /(سؤال|اسألة|أسئلة|اسئلة|question)/i.test(value) ||
    /(أول|اول|آخر|اخر)\s*سؤال/i.test(value);
  return hasAction && hasQuestion;
}

export function parseExamAdjustRequest(message: string): ParsedExamAdjustRequest | null {
  if (!looksLikeExamAdjustRequest(message)) return null;

  const value = message.trim();
  const remove_positions: number[] = [];
  const replace_positions: number[] = [];
  const remove_ids: number[] = [];
  const replace_ids: number[] = [];

  const pushPositions = (target: number[], chunk: string) => {
    target.push(...extractNumbersFromChunk(chunk));
  };

  const replacePatterns = [
    /(استبدل|بدّل|بدل|غير|غيّر|replace|swap)\s*(?:السؤال|الأسئلة|الاسئلة|سؤال)?\s*(?:رقم|أرقام|ارقام|ids?)?\s*([#\d\sووو,،\-]+)/gi,
  ];
  const removePatterns = [
    /(شيل|احذف|حذف|ازل|أزل|remove)\s*(?:السؤال|الأسئلة|الاسئلة|سؤال)?\s*(?:رقم|أرقام|ارقام|ids?)?\s*([#\d\sووو,،\-]+)/gi,
  ];

  for (const pattern of replacePatterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(value)) !== null) {
      pushPositions(replace_positions, match[2] || '');
    }
  }
  for (const pattern of removePatterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(value)) !== null) {
      pushPositions(remove_positions, match[2] || '');
    }
  }

  if (/(استبدل|بدّل|بدل|غير|غيّر).{0,20}(أول|اول)\s*سؤال/i.test(value)) {
    replace_positions.push(1);
  }
  if (/(استبدل|بدّل|بدل|غير|غيّر).{0,20}(آخر|اخر)\s*سؤال/i.test(value)) {
    replace_positions.push(-1);
  }
  if (/(شيل|احذف|حذف|ازل|أزل).{0,20}(أول|اول)\s*سؤال/i.test(value)) {
    remove_positions.push(1);
  }
  if (/(شيل|احذف|حذف|ازل|أزل).{0,20}(آخر|اخر)\s*سؤال/i.test(value)) {
    remove_positions.push(-1);
  }

  const idMatches = value.matchAll(/(?:id\s*|#)\s*(\d+)/gi);
  for (const match of idMatches) {
    const id = Number(match[1]);
    if (!Number.isInteger(id) || id <= 0) continue;
    if (/(استبدل|بدّل|بدل|غير|غيّر|replace)/i.test(value)) replace_ids.push(id);
    else remove_ids.push(id);
  }

  const refill_removed = /(عوض|بدلهم|عوضهم|كمّل|كمل|نفس العدد|ارجع العدد)/i.test(value);

  const cleanedRemove = uniquePositiveInts(remove_positions.filter((n) => n !== -1));
  const finalRemove = [...cleanedRemove, ...(remove_positions.includes(-1) ? [-1] : [])];
  const cleanedReplace = uniquePositiveInts(replace_positions.filter((n) => n !== -1));
  const finalReplace = [...cleanedReplace, ...(replace_positions.includes(-1) ? [-1] : [])];

  if (!finalRemove.length && !finalReplace.length && !remove_ids.length && !replace_ids.length) {
    return null;
  }

  return {
    remove_positions: finalRemove,
    replace_positions: finalReplace,
    remove_ids: uniquePositiveInts(remove_ids),
    replace_ids: uniquePositiveInts(replace_ids),
    refill_removed,
  };
}

function resolvePositionList(positions: number[], selectedCount: number): number[] {
  const resolved: number[] = [];
  for (const pos of positions) {
    if (pos === -1) {
      if (selectedCount > 0) resolved.push(selectedCount);
      continue;
    }
    if (pos >= 1 && pos <= selectedCount) resolved.push(pos);
  }
  return uniquePositiveInts(resolved);
}

export class ExamBuilderChatbotService {
  static getBotInfo() {
    return {
      name: 'مساعد إنشاء الامتحانات',
      description:
        'يختار أسئلة عشوائية من بنك أسئلتك، ويمكنك حذف أو استبدال أسئلة معينة حتى تعتمد النسخة النهائية',
      welcome_message: EXAM_BUILDER_WELCOME_MESSAGE,
      quick_examples: EXAM_BUILDER_QUICK_EXAMPLES,
      max_questions: MAX_QUESTIONS,
      supported_question_types: ['text_only', 'text_with_image', 'image_choices'],
      supported_difficulties: ['easy', 'medium', 'hard'],
      supports_adjust: true,
    };
  }

  static async getAccessibleLessonIds(teacherId: number): Promise<number[]> {
    const result = await pool.query<{ lesson_id: number }>(
      `${ACCESSIBLE_LESSONS_CTE}
       SELECT lesson_id FROM accessible_lessons`,
      [teacherId],
    );
    return result.rows.map((row) => row.lesson_id);
  }

  private static async filterAccessibleLessonIds(
    teacherId: number,
    lessonIds: number[],
  ): Promise<number[]> {
    if (!lessonIds.length) return [];
    const accessible = new Set(await this.getAccessibleLessonIds(teacherId));
    return lessonIds.filter((id) => accessible.has(id));
  }

  private static async isQuestionAccessible(
    teacherId: number,
    questionId: number,
    source: QuestionSource,
  ): Promise<boolean> {
    const table = source === 'v2' ? 'questions_v2' : 'questions';
    const result = await pool.query(
      `SELECT 1
       FROM ${table} q
       WHERE q.id = $2
         AND (
           q.teacher_id = $1
           OR EXISTS (
             SELECT 1
             FROM lessons l
             JOIN chapters c ON c.id = l.chapter_id
             JOIN teacher_subjects ts ON ts.subject_id = c.subject_id
             WHERE l.id = q.lesson_id AND ts.teacher_id = $1
           )
           OR EXISTS (
             SELECT 1
             FROM lessons l
             JOIN chapters c ON c.id = l.chapter_id
             JOIN teacher_permissions tp ON tp.subject_id = c.subject_id
             WHERE l.id = q.lesson_id
               AND tp.teacher_id = $1
               AND COALESCE(tp.is_active, TRUE) = TRUE
           )
         )
       LIMIT 1`,
      [teacherId, questionId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  static async getTeacherCatalog(teacherId: number): Promise<BankCatalogChapter[]> {
    const result = await pool.query<{
      chapter_id: number;
      chapter_name: string;
      chapter_order: number;
      subject_name: string;
      lesson_id: number;
      lesson_name: string;
      lesson_order: number;
      question_count: string;
    }>(
      `${ACCESSIBLE_LESSONS_CTE}
       SELECT
         c.id AS chapter_id,
         c.name AS chapter_name,
         COALESCE(c.order_num, 1) AS chapter_order,
         s.name AS subject_name,
         l.id AS lesson_id,
         l.name AS lesson_name,
         COALESCE(l.order_num, 1) AS lesson_order,
         (
           COALESCE((
             SELECT COUNT(*)::int FROM questions_v2 q
             WHERE q.lesson_id = l.id
               AND COALESCE(q.status, 'pending') <> 'rejected'
           ), 0)
           +
           COALESCE((
             SELECT COUNT(*)::int FROM questions q
             WHERE q.lesson_id = l.id
               AND COALESCE(q.status, 'pending') <> 'rejected'
           ), 0)
         )::text AS question_count
       FROM accessible_lessons al
       JOIN lessons l ON l.id = al.lesson_id
       JOIN chapters c ON c.id = l.chapter_id
       JOIN subjects s ON s.id = c.subject_id
       ORDER BY s.name, chapter_order, lesson_order, l.id`,
      [teacherId],
    );

    const chaptersMap = new Map<number, BankCatalogChapter>();
    for (const row of result.rows) {
      const qCount = Number(row.question_count) || 0;
      if (!chaptersMap.has(row.chapter_id)) {
        chaptersMap.set(row.chapter_id, {
          id: row.chapter_id,
          name: row.chapter_name,
          order_num: row.chapter_order,
          subject_name: row.subject_name,
          lessons: [],
          question_count: 0,
        });
      }
      const chapter = chaptersMap.get(row.chapter_id)!;
      chapter.lessons.push({
        id: row.lesson_id,
        name: row.lesson_name,
        order_num: row.lesson_order,
        question_count: qCount,
      });
      chapter.question_count += qCount;
    }

    return [...chaptersMap.values()].filter((c) => c.question_count > 0);
  }

  static async parseExamRequest(
    message: string,
    catalog: BankCatalogChapter[],
  ): Promise<ParsedExamRequest> {
    const catalogSummary = catalog.map((chapter) => ({
      chapter_id: chapter.id,
      chapter_name: chapter.name,
      chapter_order: chapter.order_num,
      subject: chapter.subject_name,
      lessons: chapter.lessons.map((lesson) => ({
        lesson_id: lesson.id,
        lesson_name: lesson.name,
        lesson_order: lesson.order_num,
        question_count: lesson.question_count,
      })),
    }));

    try {
      const response = await fetch(DEEPSEEK_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.DEEPSEEK_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [
            { role: 'system', content: EXAM_BUILDER_INTENT_SYSTEM_PROMPT },
            {
              role: 'user',
              content: `فهرس بنك الأسئلة:\n${JSON.stringify(catalogSummary, null, 2)}\n\nطلب المدرس:\n${message.trim()}`,
            },
          ],
          temperature: 0.1,
          max_tokens: 600,
        }),
      });

      if (!response.ok) {
        return this.parseExamRequestFallback(message);
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = data.choices?.[0]?.message?.content?.trim();
      if (!content) return this.parseExamRequestFallback(message);
      return parseIntentJson(content);
    } catch {
      return this.parseExamRequestFallback(message);
    }
  }

  private static parseExamRequestFallback(message: string): ParsedExamRequest {
    const text = message.trim();
    const countMatch = text.match(/(\d+)\s*سؤال|(\d+)\s*اسئله|(\d+)\s*أسئلة|(\d+)\s*questions?/i);
    const count = countMatch
      ? Number(countMatch[1] || countMatch[2] || countMatch[3] || countMatch[4])
      : DEFAULT_QUESTION_COUNT;

    const chapterNumbers: number[] = [];
    const chapterMatch = text.match(/الفصل\s*(?:ال)?(?:اول|أول|1|الاول|الأول|ثاني|2|الثاني|ثالث|3|الثالث|\d+)/gi);
    if (chapterMatch) {
      for (const part of chapterMatch) {
        const num = part.match(/\d+/);
        if (num) chapterNumbers.push(Number(num[0]));
        else if (/اول|أول|1/.test(part)) chapterNumbers.push(1);
        else if (/ثاني|2/.test(part)) chapterNumbers.push(2);
        else if (/ثالث|3/.test(part)) chapterNumbers.push(3);
      }
    }

    const difficulty_levels: ExamBuilderDifficulty[] = [];
    if (/سهل|easy/i.test(text)) difficulty_levels.push('easy');
    if (/متوسط|medium/i.test(text)) difficulty_levels.push('medium');
    if (/صعب|hard/i.test(text)) difficulty_levels.push('hard');

    const question_types =
      /mcq|اختيار\s*من\s*متعدد|multiple\s*choice/i.test(text)
        ? (['text_only', 'text_with_image'] as ExamBuilderQuestionType[])
        : null;

    return {
      question_count: Math.min(Math.max(count || DEFAULT_QUESTION_COUNT, 1), MAX_QUESTIONS),
      chapter_names: [],
      chapter_numbers: [...new Set(chapterNumbers)],
      lesson_names: [],
      lesson_numbers: [],
      question_types,
      difficulty_levels: difficulty_levels.length ? difficulty_levels : null,
      exam_title: null,
      notes: null,
    };
  }

  static resolveFilters(
    parsed: ParsedExamRequest,
    catalog: BankCatalogChapter[],
  ): ResolvedFilters {
    const matchedChapterIds = new Set<number>();
    const matchedLessonIds = new Set<number>();
    const matchedChapters: Array<{ id: number; name: string }> = [];
    const matchedLessons: Array<{ id: number; name: string; chapter_name: string }> = [];
    const unresolved_notes: string[] = [];

    for (const chapter of catalog) {
      const byNumber = parsed.chapter_numbers.includes(chapter.order_num);
      const byName = parsed.chapter_names.some((name) => nameMatches(chapter.name, name));
      if (byNumber || byName) {
        matchedChapterIds.add(chapter.id);
        matchedChapters.push({ id: chapter.id, name: chapter.name });
      }
    }

    for (const chapter of catalog) {
      for (const lesson of chapter.lessons) {
        const byNumber = parsed.lesson_numbers.includes(lesson.order_num);
        const byName = parsed.lesson_names.some((name) => nameMatches(lesson.name, name));
        const byChapter = matchedChapterIds.has(chapter.id);
        if (byNumber || byName || (byChapter && !parsed.lesson_names.length && !parsed.lesson_numbers.length)) {
          matchedLessonIds.add(lesson.id);
          matchedLessons.push({
            id: lesson.id,
            name: lesson.name,
            chapter_name: chapter.name,
          });
        }
      }
    }

    if (matchedChapterIds.size && !matchedLessonIds.size) {
      for (const chapter of catalog) {
        if (!matchedChapterIds.has(chapter.id)) continue;
        for (const lesson of chapter.lessons) {
          matchedLessonIds.add(lesson.id);
          matchedLessons.push({
            id: lesson.id,
            name: lesson.name,
            chapter_name: chapter.name,
          });
        }
      }
    }

    if (!matchedLessonIds.size && !matchedChapterIds.size) {
      for (const chapter of catalog) {
        for (const lesson of chapter.lessons) {
          matchedLessonIds.add(lesson.id);
          matchedLessons.push({
            id: lesson.id,
            name: lesson.name,
            chapter_name: chapter.name,
          });
        }
      }
      if (parsed.chapter_names.length || parsed.chapter_numbers.length || parsed.lesson_names.length) {
        unresolved_notes.push('لم أجد تطابقاً دقيقاً للفصول/الدروس — تم البحث في كل بنك أسئلتك.');
      }
    }

    for (const name of parsed.chapter_names) {
      const found = catalog.some((c) => nameMatches(c.name, name));
      if (!found) unresolved_notes.push(`لم أجد فصلاً باسم: ${name}`);
    }
    for (const name of parsed.lesson_names) {
      const found = catalog.some((c) => c.lessons.some((l) => nameMatches(l.name, name)));
      if (!found) unresolved_notes.push(`لم أجد درساً باسم: ${name}`);
    }

    return {
      lesson_ids: [...matchedLessonIds],
      chapter_ids: [...matchedChapterIds],
      question_types: parsed.question_types,
      difficulty_levels: parsed.difficulty_levels,
      question_count: parsed.question_count,
      exam_title: parsed.exam_title,
      matched_chapters: matchedChapters,
      matched_lessons: matchedLessons,
      unresolved_notes,
    };
  }

  static async countAvailableQuestions(
    teacherId: number,
    filters: ResolvedFilters,
    excludeIds: number[] = [],
  ): Promise<number> {
    const lessonIds = await this.filterAccessibleLessonIds(teacherId, filters.lesson_ids);
    if (!lessonIds.length) return 0;

    const params: unknown[] = [lessonIds];
    let idx = 2;
    let typeClause = '';
    if (filters.question_types?.length) {
      typeClause = ` AND q.question_type = ANY($${idx}::text[])`;
      params.push(filters.question_types);
      idx++;
    }
    let diffClause = '';
    if (filters.difficulty_levels?.length) {
      diffClause = ` AND q.difficulty_level = ANY($${idx}::text[])`;
      params.push(filters.difficulty_levels);
      idx++;
    }
    const excludeClause =
      excludeIds.length > 0 ? ` AND NOT (q.id = ANY($${idx}::int[]))` : '';
    if (excludeIds.length > 0) {
      params.push(excludeIds);
      idx++;
    }

    const v2 = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM questions_v2 q
       WHERE q.lesson_id = ANY($1::int[])
         AND COALESCE(q.status, 'pending') <> 'rejected'
         ${typeClause}
         ${diffClause}
         ${excludeClause}`,
      params,
    );

    const legacyTypes = filters.question_types?.length
      ? filters.question_types.filter((t) => t !== 'image_choices')
      : null;
    let legacyTypeClause = '';
    const legacyParams: unknown[] = [lessonIds];
    let legacyIdx = 2;
    if (legacyTypes?.length) {
      legacyTypeClause = ` AND (
        CASE
          WHEN q.image IS NOT NULL AND TRIM(q.image) <> '' THEN 'text_with_image'
          ELSE 'text_only'
        END
      ) = ANY($${legacyIdx}::text[])`;
      legacyParams.push(legacyTypes);
      legacyIdx++;
    }
    let legacyDiffClause = '';
    if (filters.difficulty_levels?.length) {
      legacyDiffClause = ` AND q.difficulty_level = ANY($${legacyIdx}::text[])`;
      legacyParams.push(filters.difficulty_levels);
      legacyIdx++;
    }
    const legacyExcludeClause =
      excludeIds.length > 0 ? ` AND NOT (q.id = ANY($${legacyIdx}::int[]))` : '';
    if (excludeIds.length > 0) {
      legacyParams.push(excludeIds);
    }

    const v1 = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM questions q
       WHERE q.lesson_id = ANY($1::int[])
         AND COALESCE(q.status, 'pending') <> 'rejected'
         ${legacyTypeClause}
         ${legacyDiffClause}
         ${legacyExcludeClause}`,
      legacyParams,
    );

    return Number(v2.rows[0]?.count ?? 0) + Number(v1.rows[0]?.count ?? 0);
  }

  static async selectRandomQuestions(
    teacherId: number,
    filters: ResolvedFilters,
    excludeIds: number[] = [],
  ): Promise<{ questions: SelectedQuestionDetail[]; available_count: number }> {
    const lessonIds = await this.filterAccessibleLessonIds(teacherId, filters.lesson_ids);
    if (!lessonIds.length) {
      return { questions: [], available_count: 0 };
    }

    const scopedFilters = { ...filters, lesson_ids: lessonIds };
    const available_count = await this.countAvailableQuestions(teacherId, scopedFilters, excludeIds);
    const limit = Math.min(filters.question_count, available_count);

    if (limit <= 0) {
      return { questions: [], available_count };
    }

    const queryParams: unknown[] = [lessonIds];
    const conditions: string[] = [];

    if (filters.question_types?.length) {
      queryParams.push(filters.question_types);
      conditions.push(`combined.question_type = ANY($${queryParams.length}::text[])`);
    }
    if (filters.difficulty_levels?.length) {
      queryParams.push(filters.difficulty_levels);
      conditions.push(`combined.difficulty_level = ANY($${queryParams.length}::text[])`);
    }
    if (excludeIds.length > 0) {
      queryParams.push(excludeIds);
      conditions.push(`NOT (combined.id = ANY($${queryParams.length}::int[]))`);
    }
    queryParams.push(limit);

    const whereExtra = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const rows = await pool.query<{
      id: number;
      source: QuestionSource;
      question_text: string;
      question_type: string;
      difficulty_level: string;
      points: number;
      lesson_id: number;
      lesson_name: string;
      chapter_id: number;
      chapter_name: string;
    }>(
      `SELECT * FROM (
         SELECT
           q.id,
           'v2'::text AS source,
           q.question_text,
           q.question_type,
           COALESCE(q.difficulty_level, 'medium') AS difficulty_level,
           COALESCE(q.points, 1) AS points,
           l.id AS lesson_id,
           l.name AS lesson_name,
           c.id AS chapter_id,
           c.name AS chapter_name
         FROM questions_v2 q
         JOIN lessons l ON l.id = q.lesson_id
         JOIN chapters c ON c.id = l.chapter_id
         WHERE q.lesson_id = ANY($1::int[])
           AND COALESCE(q.status, 'pending') <> 'rejected'
         UNION ALL
         SELECT
           q.id,
           'v1'::text AS source,
           COALESCE(q.text, '') AS question_text,
           CASE
             WHEN q.image IS NOT NULL AND TRIM(q.image) <> '' THEN 'text_with_image'
             ELSE 'text_only'
           END AS question_type,
           COALESCE(q.difficulty_level, 'medium') AS difficulty_level,
           COALESCE(q.points, 1) AS points,
           l.id AS lesson_id,
           l.name AS lesson_name,
           c.id AS chapter_id,
           c.name AS chapter_name
         FROM questions q
         JOIN lessons l ON l.id = q.lesson_id
         JOIN chapters c ON c.id = l.chapter_id
         WHERE q.lesson_id = ANY($1::int[])
           AND COALESCE(q.status, 'pending') <> 'rejected'
       ) combined
       ${whereExtra}
       ORDER BY RANDOM()
       LIMIT $${queryParams.length}`,
      queryParams,
    );

    const summaries = rows.rows.map((row) => ({
      id: row.id,
      source: row.source,
      question_text: row.question_text,
      question_type: row.question_type,
      difficulty_level: row.difficulty_level,
      points: row.points,
      lesson_id: row.lesson_id,
      lesson_name: row.lesson_name,
      chapter_id: row.chapter_id,
      chapter_name: row.chapter_name,
      preview_excerpt: excerpt(row.question_text),
    }));

    const questions = await this.enrichSelectedQuestions(summaries);

    return { questions, available_count };
  }

  private static async loadV2QuestionsBatch(
    questionIds: number[],
  ): Promise<Map<number, Record<string, unknown>>> {
    const map = new Map<number, Record<string, unknown>>();
    if (!questionIds.length) return map;

    const [questionsRes, optionsRes, mediaRes] = await Promise.all([
      pool.query(`SELECT * FROM questions_v2 WHERE id = ANY($1::int[])`, [questionIds]),
      pool.query(
        `SELECT * FROM question_options WHERE question_id = ANY($1::int[]) ORDER BY question_id, option_index ASC`,
        [questionIds],
      ),
      pool.query(`SELECT * FROM question_media WHERE question_id = ANY($1::int[])`, [questionIds]),
    ]);

    const optionsByQuestion = new Map<number, Record<string, unknown>[]>();
    for (const row of optionsRes.rows) {
      const list = optionsByQuestion.get(row.question_id) ?? [];
      list.push(toPlainJson(row));
      optionsByQuestion.set(row.question_id, list);
    }

    const mediaByQuestion = new Map<number, Record<string, unknown>>();
    for (const row of mediaRes.rows) {
      mediaByQuestion.set(row.question_id, toPlainJson(row));
    }

    for (const row of questionsRes.rows) {
      map.set(row.id, toPlainJson({
        ...row,
        options: optionsByQuestion.get(row.id) ?? [],
        media: mediaByQuestion.get(row.id) ?? null,
      }));
    }

    return map;
  }

  private static async loadV1Question(
    questionId: number,
  ): Promise<Record<string, unknown> | null> {
    const result = await pool.query(`SELECT * FROM questions WHERE id = $1`, [questionId]);
    if (!result.rowCount) return null;
    const row = result.rows[0];
    const rawOptions = row.options;
    let options: unknown[] = [];
    if (Array.isArray(rawOptions)) {
      options = rawOptions;
    } else if (rawOptions && typeof rawOptions === 'object') {
      options = Object.entries(rawOptions).map(([key, value]) => ({ key, value }));
    }

    return toPlainJson({
      id: row.id,
      question_text: row.text ?? '',
      question_type: row.image ? 'text_with_image' : 'text_only',
      difficulty_level: row.difficulty_level ?? 'medium',
      points: row.points ?? 1,
      lesson_id: row.lesson_id,
      correct_answer: row.correct_answer,
      explanation: row.explanation,
      options,
      image: row.image ?? null,
      status: row.status ?? 'pending',
    });
  }

  private static async enrichSelectedQuestions(
    summaries: Array<{
      id: number;
      source: QuestionSource;
      question_text: string;
      question_type: string;
      difficulty_level: string;
      points: number;
      lesson_id: number;
      lesson_name: string;
      chapter_id: number;
      chapter_name: string;
      preview_excerpt: string;
    }>,
  ): Promise<SelectedQuestionDetail[]> {
    const v2Ids = summaries.filter((s) => s.source === 'v2').map((s) => s.id);
    const v2Map = await this.loadV2QuestionsBatch(v2Ids);

    return Promise.all(
      summaries.map(async (summary) => {
        let question: Record<string, unknown>;
        if (summary.source === 'v2') {
          const fromBatch = v2Map.get(summary.id);
          if (fromBatch) {
            question = fromBatch;
          } else {
            const loaded = await QuestionBankV2Service.getQuestionById(summary.id);
            question = loaded
              ? toPlainJson({
                  ...loaded,
                  options: loaded.options ?? [],
                  media: loaded.media ?? null,
                })
              : { question_text: summary.question_text, options: [], media: null };
          }
        } else {
          question =
            (await this.loadV1Question(summary.id)) ?? {
              question_text: summary.question_text,
              options: [],
              image: null,
            };
        }

        if (!Array.isArray(question.options)) {
          question.options = [];
        }

        return {
          id: summary.id,
          source: summary.source,
          preview_excerpt: summary.preview_excerpt,
          question_type: String(question.question_type ?? summary.question_type),
          difficulty_level: String(question.difficulty_level ?? summary.difficulty_level),
          points: Number(question.points ?? summary.points),
          lesson_id: summary.lesson_id,
          lesson_name: summary.lesson_name,
          chapter_id: summary.chapter_id,
          chapter_name: summary.chapter_name,
          question,
        };
      }),
    );
  }

  static buildProposalReply(
    filters: ResolvedFilters,
    selected: SelectedQuestionDetail[],
    available_count: number,
    requested_count: number,
    isRegenerate = false,
  ): string {
    const lines: string[] = [];
    if (isRegenerate) {
      lines.push('🔄 **تم اختيار مجموعة جديدة من الأسئلة.**');
      lines.push('');
    }

    lines.push(`تم العثور على **${available_count}** سؤالاً مطابقاً للفلاتر.`);

    if (selected.length < requested_count) {
      lines.push(
        `⚠️ طلبت **${requested_count}** سؤالاً، لكن المتاح فقط **${selected.length}** سؤال.`,
      );
    } else {
      lines.push(`اخترت لك **${selected.length}** سؤالاً عشوائياً.`);
    }

    if (filters.matched_chapters.length) {
      lines.push(
        `**الفصول:** ${filters.matched_chapters.map((c) => c.name).join('، ')}`,
      );
    }
    if (filters.matched_lessons.length) {
      const lessonNames = filters.matched_lessons.map((l) => l.name).slice(0, 8);
      const suffix =
        filters.matched_lessons.length > 8
          ? ` … (+${filters.matched_lessons.length - 8})`
          : '';
      lines.push(`**الدروس:** ${lessonNames.join('، ')}${suffix}`);
    }
    if (filters.difficulty_levels?.length) {
      lines.push(`**الصعوبة:** ${filters.difficulty_levels.join('، ')}`);
    }
    if (filters.question_types?.length) {
      lines.push(`**نوع السؤال:** ${filters.question_types.join('، ')}`);
    }
    for (const note of filters.unresolved_notes) {
      lines.push(`ℹ️ ${note}`);
    }

    lines.push('');
    lines.push(
      'راجع الأسئلة أدناه. يمكنك **حذف** أو **استبدال** سؤال معيّن، أو **إعادة اختيار** الكل، ثم **اعتماد** النسخة النهائية.',
    );
    lines.push('مثال من الشات: «شيل السؤال 3» أو «استبدل السؤال 1 و2».');
    return lines.join('\n');
  }

  private static mapSessionRow(row: Record<string, unknown>): ExamBuilderSession {
    return {
      id: String(row.id),
      teacher_id: Number(row.teacher_id),
      status: row.status as ExamBuilderSession['status'],
      user_message: String(row.user_message),
      parsed_filters: row.parsed_filters as ResolvedFilters,
      selected_questions: row.selected_questions as SelectedQuestionDetail[],
      shown_question_ids: (row.shown_question_ids as number[]) ?? [],
      available_count: Number(row.available_count),
      requested_count: Number(row.requested_count),
      exam_id: row.exam_id != null ? Number(row.exam_id) : null,
      exam_type: (row.exam_type as ExamBuilderSession['exam_type']) ?? null,
      created_at: new Date(String(row.created_at)),
      updated_at: new Date(String(row.updated_at)),
    };
  }

  static async saveMessage(
    teacherId: number,
    role: 'teacher' | 'assistant',
    message: string,
    sessionId?: string | null,
    payload: Record<string, unknown> = {},
  ) {
    const result = await pool.query(
      `INSERT INTO exam_builder_chatbot_messages (teacher_id, session_id, role, message, payload)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       RETURNING id, teacher_id, session_id, role, message, payload, created_at`,
      [teacherId, sessionId ?? null, role, message, JSON.stringify(payload)],
    );
    return result.rows[0];
  }

  static async getHistory(teacherId: number, limit = 30, offset = 0) {
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const safeOffset = Math.max(offset, 0);
    const [rows, count] = await Promise.all([
      pool.query(
        `SELECT id, teacher_id, session_id, role, message, payload, created_at
         FROM exam_builder_chatbot_messages
         WHERE teacher_id = $1
         ORDER BY created_at DESC
         LIMIT $2 OFFSET $3`,
        [teacherId, safeLimit, safeOffset],
      ),
      pool.query<{ total: string }>(
        `SELECT COUNT(*)::text AS total FROM exam_builder_chatbot_messages WHERE teacher_id = $1`,
        [teacherId],
      ),
    ]);
    return {
      messages: rows.rows.reverse(),
      total: Number(count.rows[0]?.total ?? 0),
    };
  }

  static async getSessionsHistory(
    teacherId: number,
    limit = 20,
    offset = 0,
    status?: ExamBuilderSession['status'],
  ): Promise<{ items: ExamBuilderHistoryItem[]; total: number }> {
    const safeLimit = Math.min(Math.max(limit, 1), 50);
    const safeOffset = Math.max(offset, 0);
    const params: unknown[] = [teacherId];
    let statusClause = '';
    if (status) {
      params.push(status);
      statusClause = ` AND s.status = $${params.length}`;
    }
    params.push(safeLimit, safeOffset);

    const [rows, count] = await Promise.all([
      pool.query(
        `SELECT
           s.id,
           s.user_message,
           s.status,
           s.parsed_filters,
           s.selected_questions,
           s.available_count,
           s.requested_count,
           s.exam_id,
           s.exam_type,
           s.created_at,
           s.updated_at,
           (
             SELECT m.message
             FROM exam_builder_chatbot_messages m
             WHERE m.session_id = s.id
               AND m.role = 'assistant'
               AND COALESCE(m.payload->>'action', 'proposal') IN ('proposal', 'regenerate')
             ORDER BY m.created_at DESC
             LIMIT 1
           ) AS assistant_reply
         FROM exam_builder_chatbot_sessions s
         WHERE s.teacher_id = $1${statusClause}
         ORDER BY s.created_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      ),
      pool.query<{ total: string }>(
        `SELECT COUNT(*)::text AS total
         FROM exam_builder_chatbot_sessions s
         WHERE s.teacher_id = $1${statusClause}`,
        status ? [teacherId, status] : [teacherId],
      ),
    ]);

    const items: ExamBuilderHistoryItem[] = rows.rows.map((row) => {
      const selected = (row.selected_questions as SelectedQuestionDetail[]) ?? [];
      return {
        session_id: String(row.id),
        user_message: String(row.user_message),
        assistant_reply: row.assistant_reply ? String(row.assistant_reply) : null,
        status: row.status as ExamBuilderSession['status'],
        questions_count: selected.length,
        requested_count: Number(row.requested_count),
        available_count: Number(row.available_count),
        parsed_filters: row.parsed_filters as ResolvedFilters,
        selected_questions: selected,
        exam_id: row.exam_id != null ? Number(row.exam_id) : null,
        exam_type: (row.exam_type as ExamBuilderSession['exam_type']) ?? null,
        created_at: new Date(String(row.created_at)),
        updated_at: new Date(String(row.updated_at)),
      };
    });

    return { items, total: Number(count.rows[0]?.total ?? 0) };
  }

  static async getSession(sessionId: string, teacherId: number): Promise<ExamBuilderSession> {
    const result = await pool.query(
      `SELECT * FROM exam_builder_chatbot_sessions WHERE id = $1 AND teacher_id = $2`,
      [sessionId, teacherId],
    );
    if (!result.rowCount) {
      throw new HttpError(404, 'الجلسة غير موجودة');
    }
    const session = this.mapSessionRow(result.rows[0]);
    return this.hydrateSessionQuestions(session);
  }

  private static async hydrateSessionQuestions(
    session: ExamBuilderSession,
  ): Promise<ExamBuilderSession> {
    const needsEnrich = session.selected_questions.some(
      (q) => !q.question || !Array.isArray(q.question.options),
    );
    if (!needsEnrich) return session;

    const summaries = session.selected_questions.map((q) => ({
      id: q.id,
      source: q.source,
      question_text: String(q.question?.question_text ?? q.preview_excerpt ?? ''),
      question_type: q.question_type,
      difficulty_level: q.difficulty_level,
      points: q.points,
      lesson_id: q.lesson_id,
      lesson_name: q.lesson_name ?? '',
      chapter_id: q.chapter_id,
      chapter_name: q.chapter_name ?? '',
      preview_excerpt: q.preview_excerpt,
    }));

    const enriched = await this.enrichSelectedQuestions(summaries);
    return { ...session, selected_questions: enriched };
  }

  static async getSessionHistoryItem(
    sessionId: string,
    teacherId: number,
  ): Promise<ExamBuilderHistoryItem> {
    const session = await this.getSession(sessionId, teacherId);
    const replyRes = await pool.query<{ message: string }>(
      `SELECT message FROM exam_builder_chatbot_messages
       WHERE session_id = $1
         AND role = 'assistant'
         AND COALESCE(payload->>'action', 'proposal') IN ('proposal', 'regenerate')
       ORDER BY created_at DESC
       LIMIT 1`,
      [sessionId],
    );

    return {
      session_id: session.id,
      user_message: session.user_message,
      assistant_reply: replyRes.rows[0]?.message ?? null,
      status: session.status,
      questions_count: session.selected_questions.length,
      requested_count: session.requested_count,
      available_count: session.available_count,
      parsed_filters: session.parsed_filters,
      selected_questions: session.selected_questions,
      exam_id: session.exam_id,
      exam_type: session.exam_type,
      created_at: session.created_at,
      updated_at: session.updated_at,
    };
  }

  static async createProposalSession(
    teacherId: number,
    userMessage: string,
    filters: ResolvedFilters,
    selected: SelectedQuestionDetail[],
    available_count: number,
  ): Promise<ExamBuilderSession> {
    const shownIds = selected.map((q) => q.id);
    const result = await pool.query(
      `INSERT INTO exam_builder_chatbot_sessions (
         teacher_id, status, user_message, parsed_filters, selected_questions,
         shown_question_ids, available_count, requested_count
       ) VALUES ($1, 'proposed', $2, $3::jsonb, $4::jsonb, $5, $6, $7)
       RETURNING *`,
      [
        teacherId,
        userMessage,
        JSON.stringify(filters),
        JSON.stringify(selected),
        shownIds,
        available_count,
        filters.question_count,
      ],
    );
    return this.mergeSessionWithSelectedQuestions(result.rows[0], selected);
  }

  private static mergeSessionWithSelectedQuestions(
    row: Record<string, unknown>,
    selected: SelectedQuestionDetail[],
  ): ExamBuilderSession {
    return {
      ...this.mapSessionRow(row),
      selected_questions: selected,
    };
  }

  static async updateSessionProposal(
    sessionId: string,
    teacherId: number,
    selected: SelectedQuestionDetail[],
    available_count: number,
    shownIds: number[],
  ): Promise<ExamBuilderSession> {
    const result = await pool.query(
      `UPDATE exam_builder_chatbot_sessions
       SET selected_questions = $3::jsonb,
           shown_question_ids = $4,
           available_count = $5,
           updated_at = NOW()
       WHERE id = $1 AND teacher_id = $2 AND status = 'proposed'
       RETURNING *`,
      [sessionId, teacherId, JSON.stringify(selected), shownIds, available_count],
    );
    if (!result.rowCount) {
      throw new HttpError(404, 'الجلسة غير موجودة أو تم اعتمادها مسبقاً');
    }
    return this.mergeSessionWithSelectedQuestions(result.rows[0], selected);
  }

  static async handleChatMessage(
    teacherId: number,
    message: string,
    sessionId?: string | null,
  ): Promise<ExamBuilderChatResult> {
    const started = Date.now();
    const trimmed = message.trim();
    const emptyActions = {
      can_approve: false,
      can_regenerate: false,
      can_adjust: false,
    };
    if (!trimmed) {
      return {
        reply: EXAM_BUILDER_WELCOME_MESSAGE,
        session: null,
        actions: emptyActions,
      };
    }

    const accessibleLessons = await this.getAccessibleLessonIds(teacherId);
    if (!accessibleLessons.length) {
      return {
        reply:
          'لا توجد مواد مسندة إليك في بنك الأسئلة. تواصل مع الإدارة لإسناد المواد (نفس قائمة /api/teacher/subjects).',
        session: null,
        thinking_ms: Date.now() - started,
        actions: emptyActions,
      };
    }

    const catalog = await this.getTeacherCatalog(teacherId);
    if (!catalog.length) {
      return {
        reply:
          'لديك مواد ودروس متاحة، لكن لا توجد أسئلة بعد في هذه الدروس. أضف أسئلة من بنك الأسئلة ثم عد للمحاولة.',
        session: null,
        thinking_ms: Date.now() - started,
        actions: emptyActions,
      };
    }

    // Follow-up adjustments on an existing proposal
    const parsedAdjust = parseExamAdjustRequest(trimmed);
    if (parsedAdjust) {
      let targetSessionId = sessionId || null;
      if (!targetSessionId) {
        const latest = await this.getLatestProposedSession(teacherId);
        targetSessionId = latest?.id ?? null;
      }
      if (targetSessionId) {
        const adjusted = await this.adjustSession(targetSessionId, teacherId, parsedAdjust);
        return {
          ...adjusted,
          thinking_ms: Date.now() - started,
        };
      }
      return {
        reply:
          'لم أجد مقترحاً نشطاً لتعديله. اطلب إنشاء امتحان أولاً، ثم قل مثلاً: «شيل السؤال 2» أو «استبدل السؤال 1».',
        session: null,
        thinking_ms: Date.now() - started,
        actions: emptyActions,
      };
    }

    const parsed = await this.parseExamRequest(trimmed, catalog);
    const filters = this.resolveFilters(parsed, catalog);
    const { questions, available_count } = await this.selectRandomQuestions(teacherId, filters);

    if (!questions.length) {
      const reply =
        'لم أجد أسئلة مطابقة للفلاتر المطلوبة. جرّب توسيع نطاق الفصول/الدروس أو تقليل عدد الأسئلة.';
      return {
        reply,
        session: null,
        thinking_ms: Date.now() - started,
        actions: emptyActions,
      };
    }

    const session = await this.createProposalSession(
      teacherId,
      trimmed,
      filters,
      questions,
      available_count,
    );
    const reply = this.buildProposalReply(
      filters,
      questions,
      available_count,
      filters.question_count,
    );

    return {
      reply,
      session,
      thinking_ms: Date.now() - started,
      actions: { can_approve: true, can_regenerate: true, can_adjust: true },
    };
  }

  static async getLatestProposedSession(teacherId: number): Promise<ExamBuilderSession | null> {
    const result = await pool.query(
      `SELECT * FROM exam_builder_chatbot_sessions
       WHERE teacher_id = $1 AND status = 'proposed'
       ORDER BY updated_at DESC
       LIMIT 1`,
      [teacherId],
    );
    if (!result.rowCount) return null;
    return this.mapSessionRow(result.rows[0]);
  }

  static async adjustSession(
    sessionId: string,
    teacherId: number,
    input: ExamAdjustInput,
  ): Promise<ExamBuilderChatResult> {
    const started = Date.now();
    const session = await this.getSession(sessionId, teacherId);
    if (session.status !== 'proposed') {
      throw new HttpError(400, 'لا يمكن تعديل الأسئلة بعد اعتماد المقترح');
    }

    const selected = [...(session.selected_questions || [])];
    if (!selected.length) {
      throw new HttpError(400, 'لا توجد أسئلة في هذا المقترح');
    }

    const removePositions = resolvePositionList(input.remove_positions || [], selected.length);
    const replacePositions = resolvePositionList(input.replace_positions || [], selected.length);
    const removeIds = new Set(uniquePositiveInts(input.remove_ids || []));
    const replaceIds = new Set(uniquePositiveInts(input.replace_ids || []));

    for (const pos of removePositions) {
      const q = selected[pos - 1];
      if (q) removeIds.add(q.id);
    }
    for (const pos of replacePositions) {
      const q = selected[pos - 1];
      if (q) replaceIds.add(q.id);
    }

    // Replace takes precedence over remove for the same id
    for (const id of replaceIds) removeIds.delete(id);

    if (!removeIds.size && !replaceIds.size) {
      throw new HttpError(
        400,
        'حدد أرقام الأسئلة للتعديل. مثال: شيل السؤال 3 أو استبدل السؤال 1 و2',
      );
    }

    const removedLabels: string[] = [];
    const replacedLabels: string[] = [];
    let next = [...selected];
    const excludeBase = [
      ...new Set([...(session.shown_question_ids || []), ...selected.map((q) => q.id)]),
    ];

    if (replaceIds.size) {
      const needed = replaceIds.size;
      let { questions: replacements } = await this.selectRandomQuestions(
        teacherId,
        { ...session.parsed_filters, question_count: needed },
        excludeBase,
      );
      if (replacements.length < needed) {
        ({ questions: replacements } = await this.selectRandomQuestions(
          teacherId,
          { ...session.parsed_filters, question_count: needed },
          next.map((q) => q.id),
        ));
      }
      if (!replacements.length) {
        throw new HttpError(400, 'لا توجد أسئلة بديلة متاحة للاستبدال بنفس الفلاتر');
      }

      let replacementIndex = 0;
      next = next.map((q, index) => {
        if (!replaceIds.has(q.id)) return q;
        const replacement = replacements[replacementIndex++];
        if (!replacement) {
          replacedLabels.push(`#${index + 1} (تعذر البديل)`);
          return q;
        }
        replacedLabels.push(`#${index + 1}`);
        return replacement;
      });
    }

    if (removeIds.size) {
      next = next.filter((q, index) => {
        if (!removeIds.has(q.id)) return true;
        // index may shift; label by original position when possible
        const originalIndex = selected.findIndex((item) => item.id === q.id);
        removedLabels.push(`#${(originalIndex >= 0 ? originalIndex : index) + 1}`);
        return false;
      });
    }

    const refill =
      input.refill_removed === true && removeIds.size > 0 && !replaceIds.size;
    if (refill) {
      const deficit = Math.max(0, session.requested_count - next.length);
      if (deficit > 0) {
        const exclude = [
          ...new Set([
            ...(session.shown_question_ids || []),
            ...selected.map((q) => q.id),
            ...next.map((q) => q.id),
          ]),
        ];
        let { questions: fillers } = await this.selectRandomQuestions(
          teacherId,
          { ...session.parsed_filters, question_count: deficit },
          exclude,
        );
        if (!fillers.length) {
          ({ questions: fillers } = await this.selectRandomQuestions(
            teacherId,
            { ...session.parsed_filters, question_count: deficit },
            next.map((q) => q.id),
          ));
        }
        next = [...next, ...fillers];
      }
    }

    if (!next.length) {
      throw new HttpError(400, 'لا يمكن حذف كل الأسئلة. أبقِ سؤالاً واحداً على الأقل أو اعتمد مقترحاً جديداً');
    }

    const newShown = [
      ...new Set([...(session.shown_question_ids || []), ...selected.map((q) => q.id), ...next.map((q) => q.id)]),
    ];
    const available_count = session.available_count;
    const updated = await this.updateSessionProposal(
      sessionId,
      teacherId,
      next,
      available_count,
      newShown,
    );

    const parts: string[] = ['✏️ **تم تعديل المقترح.**', ''];
    if (removedLabels.length) {
      parts.push(`حُذف: ${removedLabels.join('، ')}`);
    }
    if (replacedLabels.length) {
      parts.push(`استُبدل: ${replacedLabels.join('، ')}`);
    }
    parts.push(`الآن لديك **${next.length}** سؤالاً.`);
    parts.push('');
    parts.push('يمكنك طلب تعديلات أخرى، أو **اعتماد** النسخة النهائية.');

    return {
      reply: parts.join('\n'),
      session: updated,
      thinking_ms: Date.now() - started,
      actions: { can_approve: true, can_regenerate: true, can_adjust: true },
    };
  }

  static async regenerateSession(
    sessionId: string,
    teacherId: number,
  ): Promise<ExamBuilderChatResult> {
    const started = Date.now();
    const session = await this.getSession(sessionId, teacherId);
    if (session.status !== 'proposed') {
      throw new HttpError(400, 'لا يمكن إعادة التوليد بعد اعتماد الأسئلة');
    }

    const filters = session.parsed_filters;
    const excludeIds = session.shown_question_ids;
    let { questions, available_count } = await this.selectRandomQuestions(
      teacherId,
      filters,
      excludeIds,
    );

    if (!questions.length && excludeIds.length > 0) {
      ({ questions, available_count } = await this.selectRandomQuestions(teacherId, filters, []));
    }

    if (!questions.length) {
      throw new HttpError(400, 'لا توجد أسئلة بديلة متاحة بنفس الفلاتر');
    }

    const newShown = [...new Set([...excludeIds, ...questions.map((q) => q.id)])];
    const updated = await this.updateSessionProposal(
      sessionId,
      teacherId,
      questions,
      available_count,
      newShown,
    );

    const reply = this.buildProposalReply(
      filters,
      questions,
      available_count,
      updated.requested_count,
      true,
    );

    return {
      reply,
      session: updated,
      thinking_ms: Date.now() - started,
      actions: { can_approve: true, can_regenerate: true, can_adjust: true },
    };
  }

  static async getQuestionPreview(
    teacherId: number,
    questionId: number,
    source: QuestionSource,
  ) {
    if (source === 'v2') {
      const accessible = await this.isQuestionAccessible(teacherId, questionId, 'v2');
      if (!accessible) {
        throw new HttpError(404, 'السؤال غير موجود أو لا يخصك');
      }
      const question = await QuestionBankV2Service.getQuestionById(questionId);
      if (!question) throw new HttpError(404, 'السؤال غير موجود');
      const meta = await pool.query(
        `SELECT l.name AS lesson_name, c.name AS chapter_name
         FROM lessons l JOIN chapters c ON c.id = l.chapter_id
         WHERE l.id = $1`,
        [question.lesson_id],
      );
      return {
        source: 'v2' as const,
        question,
        lesson_name: meta.rows[0]?.lesson_name ?? null,
        chapter_name: meta.rows[0]?.chapter_name ?? null,
      };
    }

    const accessible = await this.isQuestionAccessible(teacherId, questionId, 'v1');
    if (!accessible) {
      throw new HttpError(404, 'السؤال غير موجود أو لا يخصك');
    }

    const result = await pool.query(
      `SELECT q.*, l.name AS lesson_name, c.name AS chapter_name
       FROM questions q
       JOIN lessons l ON l.id = q.lesson_id
       JOIN chapters c ON c.id = l.chapter_id
       WHERE q.id = $1`,
      [questionId],
    );
    if (!result.rowCount) {
      throw new HttpError(404, 'السؤال غير موجود');
    }
    const row = result.rows[0];
    const options = Array.isArray(row.options)
      ? row.options
      : row.options && typeof row.options === 'object'
        ? Object.values(row.options)
        : [];
    return {
      source: 'v1' as const,
      question: {
        id: row.id,
        question_text: row.text,
        question_type: row.image ? 'text_with_image' : 'text_only',
        difficulty_level: row.difficulty_level,
        points: row.points,
        options,
        image: row.image,
        correct_answer: row.correct_answer,
        explanation: row.explanation,
        lesson_id: row.lesson_id,
      },
      lesson_name: row.lesson_name,
      chapter_name: row.chapter_name,
    };
  }

  static async approveSession(
    teacherId: number,
    sessionId: string,
    payload: ApproveExamPayload = {},
  ) {
    const session = await this.getSession(sessionId, teacherId);
    if (session.status !== 'proposed') {
      throw new HttpError(400, 'تم اعتماد هذه الجلسة مسبقاً');
    }
    if (!session.selected_questions.length) {
      throw new HttpError(400, 'لا توجد أسئلة للاعتماد');
    }

    const questionIds = session.selected_questions.map((q) => q.id);
    const createExam = payload.create_exam !== false && (payload.lecture_id || payload.course_id);

    let examId: number | null = null;
    let examType: 'lecture-exam' | 'course-exam' | null = null;

    if (createExam && payload.lecture_id) {
      const exam = await ExamFlowService.createExam(teacherId, {
        lectureId: payload.lecture_id,
        title: payload.title ?? session.parsed_filters.exam_title ?? 'امتحان من بنك الأسئلة',
        type: payload.type ?? 'exam',
        duration: payload.duration ?? null,
        totalGrade: payload.total_grade,
      });
      const createdExamId = Number(exam.id);
      examId = createdExamId;
      examType = 'lecture-exam';
      await ExamFlowService.addQuestionsFromBank(teacherId, createdExamId, questionIds);
    } else if (createExam && payload.course_id) {
      const durationMinutes = payload.duration_minutes ?? payload.duration ?? 60;
      const exam = await CourseLevelExamsService.createExam(
        { id: teacherId, role: 'teacher' },
        {
          title: payload.title ?? session.parsed_filters.exam_title ?? 'امتحان من بنك الأسئلة',
          courseId: payload.course_id,
          durationMinutes: Number(durationMinutes),
          questionsCount: questionIds.length,
          isVisibleToStudents: true,
          visibilityEndDate: null,
          showAnswersImmediately: true,
          answersVisibleAt: null,
          isActive: true,
        },
      );
      const createdExamId = Number(exam.id);
      examId = createdExamId;
      examType = 'course-exam';
      await CourseLevelExamsService.addQuestionsFromBank(
        { id: teacherId, role: 'teacher' },
        createdExamId,
        questionIds,
      );
    }

    const result = await pool.query(
      `UPDATE exam_builder_chatbot_sessions
       SET status = 'approved', exam_id = $3, exam_type = $4, updated_at = NOW()
       WHERE id = $1 AND teacher_id = $2
       RETURNING *`,
      [sessionId, teacherId, examId, examType],
    );

    return {
      session: this.mapSessionRow(result.rows[0]),
      question_ids: questionIds,
      questions: session.selected_questions,
      exam_id: examId,
      exam_type: examType,
      redirect: examId
        ? {
            exam_id: examId,
            exam_type: examType,
            question_ids: questionIds,
          }
        : {
            question_ids: questionIds,
            filters: session.parsed_filters,
          },
    };
  }
}
