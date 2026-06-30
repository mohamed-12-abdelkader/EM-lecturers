"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExamBuilderChatbotService = void 0;
const pool_1 = __importDefault(require("../db/pool"));
const utils_1 = require("../utils");
const questionBankV2_1 = require("./questionBankV2");
const examFlow_1 = require("./examFlow");
const courseLevelExams_1 = require("./courseLevelExams");
const examBuilderChatbot_prompts_1 = require("./examBuilderChatbot.prompts");
const DEEPSEEK_API_URL = `${utils_1.config.DEEPSEEK_API_URL}/v1/chat/completions`;
const MAX_QUESTIONS = 100;
const DEFAULT_QUESTION_COUNT = 10;
function normalizeArabic(text) {
    return text
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .replace(/[أإآ]/g, 'ا')
        .replace(/[ة]/g, 'ه')
        .replace(/[ى]/g, 'ي')
        .replace(/[^\p{L}\p{N}\s]/gu, '');
}
function excerpt(text, max = 120) {
    const clean = text.replace(/\s+/g, ' ').trim();
    if (clean.length <= max)
        return clean;
    return `${clean.slice(0, max)}…`;
}
function mapQuestionTypes(raw) {
    if (!raw?.length)
        return null;
    const mapped = new Set();
    for (const item of raw) {
        const value = item.trim().toLowerCase();
        if (value === 'mcq' || value === 'multiple_choice') {
            mapped.add('text_only');
            mapped.add('text_with_image');
        }
        else if (value === 'text_only' ||
            value === 'text_with_image' ||
            value === 'image_choices') {
            mapped.add(value);
        }
    }
    return mapped.size ? [...mapped] : null;
}
function mapDifficulty(raw) {
    if (!raw?.length)
        return null;
    const allowed = new Set();
    for (const item of raw) {
        if (item === 'easy' || item === 'medium' || item === 'hard') {
            allowed.add(item);
        }
    }
    return allowed.size ? [...allowed] : null;
}
function parseIntentJson(content) {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
    const countRaw = Number(parsed.question_count);
    const question_count = Number.isInteger(countRaw) && countRaw >= 1
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
                .filter((n) => Number.isInteger(n) && n > 0)
            : [],
        lesson_names: Array.isArray(parsed.lesson_names)
            ? parsed.lesson_names.map(String).filter(Boolean)
            : [],
        lesson_numbers: Array.isArray(parsed.lesson_numbers)
            ? parsed.lesson_numbers
                .map(Number)
                .filter((n) => Number.isInteger(n) && n > 0)
            : [],
        question_types: mapQuestionTypes(parsed.question_types),
        difficulty_levels: mapDifficulty(parsed.difficulty_levels),
        exam_title: parsed.exam_title ? String(parsed.exam_title).trim() : null,
        notes: parsed.notes ? String(parsed.notes).trim() : null,
    };
}
function nameMatches(candidate, query) {
    const a = normalizeArabic(candidate);
    const b = normalizeArabic(query);
    if (!a || !b)
        return false;
    return a.includes(b) || b.includes(a);
}
function toPlainJson(value) {
    return JSON.parse(JSON.stringify(value, (_key, item) => (item instanceof Date ? item.toISOString() : item)));
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
class ExamBuilderChatbotService {
    static getBotInfo() {
        return {
            name: 'مساعد إنشاء الامتحانات',
            description: 'يختار أسئلة عشوائية من بنك أسئلتك بناءً على طلبك باللغة الطبيعية',
            welcome_message: examBuilderChatbot_prompts_1.EXAM_BUILDER_WELCOME_MESSAGE,
            quick_examples: examBuilderChatbot_prompts_1.EXAM_BUILDER_QUICK_EXAMPLES,
            max_questions: MAX_QUESTIONS,
            supported_question_types: ['text_only', 'text_with_image', 'image_choices'],
            supported_difficulties: ['easy', 'medium', 'hard'],
        };
    }
    static async getAccessibleLessonIds(teacherId) {
        const result = await pool_1.default.query(`${ACCESSIBLE_LESSONS_CTE}
       SELECT lesson_id FROM accessible_lessons`, [teacherId]);
        return result.rows.map((row) => row.lesson_id);
    }
    static async filterAccessibleLessonIds(teacherId, lessonIds) {
        if (!lessonIds.length)
            return [];
        const accessible = new Set(await this.getAccessibleLessonIds(teacherId));
        return lessonIds.filter((id) => accessible.has(id));
    }
    static async isQuestionAccessible(teacherId, questionId, source) {
        const table = source === 'v2' ? 'questions_v2' : 'questions';
        const result = await pool_1.default.query(`SELECT 1
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
       LIMIT 1`, [teacherId, questionId]);
        return (result.rowCount ?? 0) > 0;
    }
    static async getTeacherCatalog(teacherId) {
        const result = await pool_1.default.query(`${ACCESSIBLE_LESSONS_CTE}
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
       ORDER BY s.name, chapter_order, lesson_order, l.id`, [teacherId]);
        const chaptersMap = new Map();
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
            const chapter = chaptersMap.get(row.chapter_id);
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
    static async parseExamRequest(message, catalog) {
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
                    Authorization: `Bearer ${utils_1.config.DEEPSEEK_API_KEY}`,
                },
                body: JSON.stringify({
                    model: 'deepseek-chat',
                    messages: [
                        { role: 'system', content: examBuilderChatbot_prompts_1.EXAM_BUILDER_INTENT_SYSTEM_PROMPT },
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
            const data = (await response.json());
            const content = data.choices?.[0]?.message?.content?.trim();
            if (!content)
                return this.parseExamRequestFallback(message);
            return parseIntentJson(content);
        }
        catch {
            return this.parseExamRequestFallback(message);
        }
    }
    static parseExamRequestFallback(message) {
        const text = message.trim();
        const countMatch = text.match(/(\d+)\s*سؤال|(\d+)\s*اسئله|(\d+)\s*أسئلة|(\d+)\s*questions?/i);
        const count = countMatch
            ? Number(countMatch[1] || countMatch[2] || countMatch[3] || countMatch[4])
            : DEFAULT_QUESTION_COUNT;
        const chapterNumbers = [];
        const chapterMatch = text.match(/الفصل\s*(?:ال)?(?:اول|أول|1|الاول|الأول|ثاني|2|الثاني|ثالث|3|الثالث|\d+)/gi);
        if (chapterMatch) {
            for (const part of chapterMatch) {
                const num = part.match(/\d+/);
                if (num)
                    chapterNumbers.push(Number(num[0]));
                else if (/اول|أول|1/.test(part))
                    chapterNumbers.push(1);
                else if (/ثاني|2/.test(part))
                    chapterNumbers.push(2);
                else if (/ثالث|3/.test(part))
                    chapterNumbers.push(3);
            }
        }
        const difficulty_levels = [];
        if (/سهل|easy/i.test(text))
            difficulty_levels.push('easy');
        if (/متوسط|medium/i.test(text))
            difficulty_levels.push('medium');
        if (/صعب|hard/i.test(text))
            difficulty_levels.push('hard');
        const question_types = /mcq|اختيار\s*من\s*متعدد|multiple\s*choice/i.test(text)
            ? ['text_only', 'text_with_image']
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
    static resolveFilters(parsed, catalog) {
        const matchedChapterIds = new Set();
        const matchedLessonIds = new Set();
        const matchedChapters = [];
        const matchedLessons = [];
        const unresolved_notes = [];
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
                if (!matchedChapterIds.has(chapter.id))
                    continue;
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
            if (!found)
                unresolved_notes.push(`لم أجد فصلاً باسم: ${name}`);
        }
        for (const name of parsed.lesson_names) {
            const found = catalog.some((c) => c.lessons.some((l) => nameMatches(l.name, name)));
            if (!found)
                unresolved_notes.push(`لم أجد درساً باسم: ${name}`);
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
    static async countAvailableQuestions(teacherId, filters, excludeIds = []) {
        const lessonIds = await this.filterAccessibleLessonIds(teacherId, filters.lesson_ids);
        if (!lessonIds.length)
            return 0;
        const params = [lessonIds];
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
        const excludeClause = excludeIds.length > 0 ? ` AND NOT (q.id = ANY($${idx}::int[]))` : '';
        if (excludeIds.length > 0) {
            params.push(excludeIds);
            idx++;
        }
        const v2 = await pool_1.default.query(`SELECT COUNT(*)::text AS count
       FROM questions_v2 q
       WHERE q.lesson_id = ANY($1::int[])
         AND COALESCE(q.status, 'pending') <> 'rejected'
         ${typeClause}
         ${diffClause}
         ${excludeClause}`, params);
        const legacyTypes = filters.question_types?.length
            ? filters.question_types.filter((t) => t !== 'image_choices')
            : null;
        let legacyTypeClause = '';
        const legacyParams = [lessonIds];
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
        const legacyExcludeClause = excludeIds.length > 0 ? ` AND NOT (q.id = ANY($${legacyIdx}::int[]))` : '';
        if (excludeIds.length > 0) {
            legacyParams.push(excludeIds);
        }
        const v1 = await pool_1.default.query(`SELECT COUNT(*)::text AS count
       FROM questions q
       WHERE q.lesson_id = ANY($1::int[])
         AND COALESCE(q.status, 'pending') <> 'rejected'
         ${legacyTypeClause}
         ${legacyDiffClause}
         ${legacyExcludeClause}`, legacyParams);
        return Number(v2.rows[0]?.count ?? 0) + Number(v1.rows[0]?.count ?? 0);
    }
    static async selectRandomQuestions(teacherId, filters, excludeIds = []) {
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
        const queryParams = [lessonIds];
        const conditions = [];
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
        const rows = await pool_1.default.query(`SELECT * FROM (
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
       LIMIT $${queryParams.length}`, queryParams);
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
    static async loadV2QuestionsBatch(questionIds) {
        const map = new Map();
        if (!questionIds.length)
            return map;
        const [questionsRes, optionsRes, mediaRes] = await Promise.all([
            pool_1.default.query(`SELECT * FROM questions_v2 WHERE id = ANY($1::int[])`, [questionIds]),
            pool_1.default.query(`SELECT * FROM question_options WHERE question_id = ANY($1::int[]) ORDER BY question_id, option_index ASC`, [questionIds]),
            pool_1.default.query(`SELECT * FROM question_media WHERE question_id = ANY($1::int[])`, [questionIds]),
        ]);
        const optionsByQuestion = new Map();
        for (const row of optionsRes.rows) {
            const list = optionsByQuestion.get(row.question_id) ?? [];
            list.push(toPlainJson(row));
            optionsByQuestion.set(row.question_id, list);
        }
        const mediaByQuestion = new Map();
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
    static async loadV1Question(questionId) {
        const result = await pool_1.default.query(`SELECT * FROM questions WHERE id = $1`, [questionId]);
        if (!result.rowCount)
            return null;
        const row = result.rows[0];
        const rawOptions = row.options;
        let options = [];
        if (Array.isArray(rawOptions)) {
            options = rawOptions;
        }
        else if (rawOptions && typeof rawOptions === 'object') {
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
    static async enrichSelectedQuestions(summaries) {
        const v2Ids = summaries.filter((s) => s.source === 'v2').map((s) => s.id);
        const v2Map = await this.loadV2QuestionsBatch(v2Ids);
        return Promise.all(summaries.map(async (summary) => {
            let question;
            if (summary.source === 'v2') {
                const fromBatch = v2Map.get(summary.id);
                if (fromBatch) {
                    question = fromBatch;
                }
                else {
                    const loaded = await questionBankV2_1.QuestionBankV2Service.getQuestionById(summary.id);
                    question = loaded
                        ? toPlainJson({
                            ...loaded,
                            options: loaded.options ?? [],
                            media: loaded.media ?? null,
                        })
                        : { question_text: summary.question_text, options: [], media: null };
                }
            }
            else {
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
        }));
    }
    static buildProposalReply(filters, selected, available_count, requested_count, isRegenerate = false) {
        const lines = [];
        if (isRegenerate) {
            lines.push('🔄 **تم اختيار مجموعة جديدة من الأسئلة.**');
            lines.push('');
        }
        lines.push(`تم العثور على **${available_count}** سؤالاً مطابقاً للفلاتر.`);
        if (selected.length < requested_count) {
            lines.push(`⚠️ طلبت **${requested_count}** سؤالاً، لكن المتاح فقط **${selected.length}** سؤال.`);
        }
        else {
            lines.push(`اخترت لك **${selected.length}** سؤالاً عشوائياً.`);
        }
        if (filters.matched_chapters.length) {
            lines.push(`**الفصول:** ${filters.matched_chapters.map((c) => c.name).join('، ')}`);
        }
        if (filters.matched_lessons.length) {
            const lessonNames = filters.matched_lessons.map((l) => l.name).slice(0, 8);
            const suffix = filters.matched_lessons.length > 8
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
        lines.push('راجع الأسئلة أدناه، ثم **اعتماد** أو **إعادة اختيار**.');
        return lines.join('\n');
    }
    static mapSessionRow(row) {
        return {
            id: String(row.id),
            teacher_id: Number(row.teacher_id),
            status: row.status,
            user_message: String(row.user_message),
            parsed_filters: row.parsed_filters,
            selected_questions: row.selected_questions,
            shown_question_ids: row.shown_question_ids ?? [],
            available_count: Number(row.available_count),
            requested_count: Number(row.requested_count),
            exam_id: row.exam_id != null ? Number(row.exam_id) : null,
            exam_type: row.exam_type ?? null,
            created_at: new Date(String(row.created_at)),
            updated_at: new Date(String(row.updated_at)),
        };
    }
    static async saveMessage(teacherId, role, message, sessionId, payload = {}) {
        const result = await pool_1.default.query(`INSERT INTO exam_builder_chatbot_messages (teacher_id, session_id, role, message, payload)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       RETURNING id, teacher_id, session_id, role, message, payload, created_at`, [teacherId, sessionId ?? null, role, message, JSON.stringify(payload)]);
        return result.rows[0];
    }
    static async getHistory(teacherId, limit = 30, offset = 0) {
        const safeLimit = Math.min(Math.max(limit, 1), 100);
        const safeOffset = Math.max(offset, 0);
        const [rows, count] = await Promise.all([
            pool_1.default.query(`SELECT id, teacher_id, session_id, role, message, payload, created_at
         FROM exam_builder_chatbot_messages
         WHERE teacher_id = $1
         ORDER BY created_at DESC
         LIMIT $2 OFFSET $3`, [teacherId, safeLimit, safeOffset]),
            pool_1.default.query(`SELECT COUNT(*)::text AS total FROM exam_builder_chatbot_messages WHERE teacher_id = $1`, [teacherId]),
        ]);
        return {
            messages: rows.rows.reverse(),
            total: Number(count.rows[0]?.total ?? 0),
        };
    }
    static async getSessionsHistory(teacherId, limit = 20, offset = 0, status) {
        const safeLimit = Math.min(Math.max(limit, 1), 50);
        const safeOffset = Math.max(offset, 0);
        const params = [teacherId];
        let statusClause = '';
        if (status) {
            params.push(status);
            statusClause = ` AND s.status = $${params.length}`;
        }
        params.push(safeLimit, safeOffset);
        const [rows, count] = await Promise.all([
            pool_1.default.query(`SELECT
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
         LIMIT $${params.length - 1} OFFSET $${params.length}`, params),
            pool_1.default.query(`SELECT COUNT(*)::text AS total
         FROM exam_builder_chatbot_sessions s
         WHERE s.teacher_id = $1${statusClause}`, status ? [teacherId, status] : [teacherId]),
        ]);
        const items = rows.rows.map((row) => {
            const selected = row.selected_questions ?? [];
            return {
                session_id: String(row.id),
                user_message: String(row.user_message),
                assistant_reply: row.assistant_reply ? String(row.assistant_reply) : null,
                status: row.status,
                questions_count: selected.length,
                requested_count: Number(row.requested_count),
                available_count: Number(row.available_count),
                parsed_filters: row.parsed_filters,
                selected_questions: selected,
                exam_id: row.exam_id != null ? Number(row.exam_id) : null,
                exam_type: row.exam_type ?? null,
                created_at: new Date(String(row.created_at)),
                updated_at: new Date(String(row.updated_at)),
            };
        });
        return { items, total: Number(count.rows[0]?.total ?? 0) };
    }
    static async getSession(sessionId, teacherId) {
        const result = await pool_1.default.query(`SELECT * FROM exam_builder_chatbot_sessions WHERE id = $1 AND teacher_id = $2`, [sessionId, teacherId]);
        if (!result.rowCount) {
            throw new utils_1.HttpError(404, 'الجلسة غير موجودة');
        }
        const session = this.mapSessionRow(result.rows[0]);
        return this.hydrateSessionQuestions(session);
    }
    static async hydrateSessionQuestions(session) {
        const needsEnrich = session.selected_questions.some((q) => !q.question || !Array.isArray(q.question.options));
        if (!needsEnrich)
            return session;
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
    static async getSessionHistoryItem(sessionId, teacherId) {
        const session = await this.getSession(sessionId, teacherId);
        const replyRes = await pool_1.default.query(`SELECT message FROM exam_builder_chatbot_messages
       WHERE session_id = $1
         AND role = 'assistant'
         AND COALESCE(payload->>'action', 'proposal') IN ('proposal', 'regenerate')
       ORDER BY created_at DESC
       LIMIT 1`, [sessionId]);
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
    static async createProposalSession(teacherId, userMessage, filters, selected, available_count) {
        const shownIds = selected.map((q) => q.id);
        const result = await pool_1.default.query(`INSERT INTO exam_builder_chatbot_sessions (
         teacher_id, status, user_message, parsed_filters, selected_questions,
         shown_question_ids, available_count, requested_count
       ) VALUES ($1, 'proposed', $2, $3::jsonb, $4::jsonb, $5, $6, $7)
       RETURNING *`, [
            teacherId,
            userMessage,
            JSON.stringify(filters),
            JSON.stringify(selected),
            shownIds,
            available_count,
            filters.question_count,
        ]);
        return this.mergeSessionWithSelectedQuestions(result.rows[0], selected);
    }
    static mergeSessionWithSelectedQuestions(row, selected) {
        return {
            ...this.mapSessionRow(row),
            selected_questions: selected,
        };
    }
    static async updateSessionProposal(sessionId, teacherId, selected, available_count, shownIds) {
        const result = await pool_1.default.query(`UPDATE exam_builder_chatbot_sessions
       SET selected_questions = $3::jsonb,
           shown_question_ids = $4,
           available_count = $5,
           updated_at = NOW()
       WHERE id = $1 AND teacher_id = $2 AND status = 'proposed'
       RETURNING *`, [sessionId, teacherId, JSON.stringify(selected), shownIds, available_count]);
        if (!result.rowCount) {
            throw new utils_1.HttpError(404, 'الجلسة غير موجودة أو تم اعتمادها مسبقاً');
        }
        return this.mergeSessionWithSelectedQuestions(result.rows[0], selected);
    }
    static async handleChatMessage(teacherId, message) {
        const started = Date.now();
        const trimmed = message.trim();
        if (!trimmed) {
            return {
                reply: examBuilderChatbot_prompts_1.EXAM_BUILDER_WELCOME_MESSAGE,
                session: null,
                actions: { can_approve: false, can_regenerate: false },
            };
        }
        const accessibleLessons = await this.getAccessibleLessonIds(teacherId);
        if (!accessibleLessons.length) {
            return {
                reply: 'لا توجد مواد مسندة إليك في بنك الأسئلة. تواصل مع الإدارة لإسناد المواد (نفس قائمة /api/teacher/subjects).',
                session: null,
                thinking_ms: Date.now() - started,
                actions: { can_approve: false, can_regenerate: false },
            };
        }
        const catalog = await this.getTeacherCatalog(teacherId);
        if (!catalog.length) {
            return {
                reply: 'لديك مواد ودروس متاحة، لكن لا توجد أسئلة بعد في هذه الدروس. أضف أسئلة من بنك الأسئلة ثم عد للمحاولة.',
                session: null,
                thinking_ms: Date.now() - started,
                actions: { can_approve: false, can_regenerate: false },
            };
        }
        const parsed = await this.parseExamRequest(trimmed, catalog);
        const filters = this.resolveFilters(parsed, catalog);
        const { questions, available_count } = await this.selectRandomQuestions(teacherId, filters);
        if (!questions.length) {
            const reply = 'لم أجد أسئلة مطابقة للفلاتر المطلوبة. جرّب توسيع نطاق الفصول/الدروس أو تقليل عدد الأسئلة.';
            return {
                reply,
                session: null,
                thinking_ms: Date.now() - started,
                actions: { can_approve: false, can_regenerate: false },
            };
        }
        const session = await this.createProposalSession(teacherId, trimmed, filters, questions, available_count);
        const reply = this.buildProposalReply(filters, questions, available_count, filters.question_count);
        return {
            reply,
            session,
            thinking_ms: Date.now() - started,
            actions: { can_approve: true, can_regenerate: true },
        };
    }
    static async regenerateSession(sessionId, teacherId) {
        const started = Date.now();
        const session = await this.getSession(sessionId, teacherId);
        if (session.status !== 'proposed') {
            throw new utils_1.HttpError(400, 'لا يمكن إعادة التوليد بعد اعتماد الأسئلة');
        }
        const filters = session.parsed_filters;
        const excludeIds = session.shown_question_ids;
        let { questions, available_count } = await this.selectRandomQuestions(teacherId, filters, excludeIds);
        if (!questions.length && excludeIds.length > 0) {
            ({ questions, available_count } = await this.selectRandomQuestions(teacherId, filters, []));
        }
        if (!questions.length) {
            throw new utils_1.HttpError(400, 'لا توجد أسئلة بديلة متاحة بنفس الفلاتر');
        }
        const newShown = [...new Set([...excludeIds, ...questions.map((q) => q.id)])];
        const updated = await this.updateSessionProposal(sessionId, teacherId, questions, available_count, newShown);
        const reply = this.buildProposalReply(filters, questions, available_count, updated.requested_count, true);
        return {
            reply,
            session: updated,
            thinking_ms: Date.now() - started,
            actions: { can_approve: true, can_regenerate: true },
        };
    }
    static async getQuestionPreview(teacherId, questionId, source) {
        if (source === 'v2') {
            const accessible = await this.isQuestionAccessible(teacherId, questionId, 'v2');
            if (!accessible) {
                throw new utils_1.HttpError(404, 'السؤال غير موجود أو لا يخصك');
            }
            const question = await questionBankV2_1.QuestionBankV2Service.getQuestionById(questionId);
            if (!question)
                throw new utils_1.HttpError(404, 'السؤال غير موجود');
            const meta = await pool_1.default.query(`SELECT l.name AS lesson_name, c.name AS chapter_name
         FROM lessons l JOIN chapters c ON c.id = l.chapter_id
         WHERE l.id = $1`, [question.lesson_id]);
            return {
                source: 'v2',
                question,
                lesson_name: meta.rows[0]?.lesson_name ?? null,
                chapter_name: meta.rows[0]?.chapter_name ?? null,
            };
        }
        const accessible = await this.isQuestionAccessible(teacherId, questionId, 'v1');
        if (!accessible) {
            throw new utils_1.HttpError(404, 'السؤال غير موجود أو لا يخصك');
        }
        const result = await pool_1.default.query(`SELECT q.*, l.name AS lesson_name, c.name AS chapter_name
       FROM questions q
       JOIN lessons l ON l.id = q.lesson_id
       JOIN chapters c ON c.id = l.chapter_id
       WHERE q.id = $1`, [questionId]);
        if (!result.rowCount) {
            throw new utils_1.HttpError(404, 'السؤال غير موجود');
        }
        const row = result.rows[0];
        const options = Array.isArray(row.options)
            ? row.options
            : row.options && typeof row.options === 'object'
                ? Object.values(row.options)
                : [];
        return {
            source: 'v1',
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
    static async approveSession(teacherId, sessionId, payload = {}) {
        const session = await this.getSession(sessionId, teacherId);
        if (session.status !== 'proposed') {
            throw new utils_1.HttpError(400, 'تم اعتماد هذه الجلسة مسبقاً');
        }
        if (!session.selected_questions.length) {
            throw new utils_1.HttpError(400, 'لا توجد أسئلة للاعتماد');
        }
        const questionIds = session.selected_questions.map((q) => q.id);
        const createExam = payload.create_exam !== false && (payload.lecture_id || payload.course_id);
        let examId = null;
        let examType = null;
        if (createExam && payload.lecture_id) {
            const exam = await examFlow_1.ExamFlowService.createExam(teacherId, {
                lectureId: payload.lecture_id,
                title: payload.title ?? session.parsed_filters.exam_title ?? 'امتحان من بنك الأسئلة',
                type: payload.type ?? 'exam',
                duration: payload.duration ?? null,
                totalGrade: payload.total_grade,
            });
            const createdExamId = Number(exam.id);
            examId = createdExamId;
            examType = 'lecture-exam';
            await examFlow_1.ExamFlowService.addQuestionsFromBank(teacherId, createdExamId, questionIds);
        }
        else if (createExam && payload.course_id) {
            const durationMinutes = payload.duration_minutes ?? payload.duration ?? 60;
            const exam = await courseLevelExams_1.CourseLevelExamsService.createExam({ id: teacherId, role: 'teacher' }, {
                title: payload.title ?? session.parsed_filters.exam_title ?? 'امتحان من بنك الأسئلة',
                courseId: payload.course_id,
                durationMinutes: Number(durationMinutes),
                questionsCount: questionIds.length,
                isVisibleToStudents: true,
                visibilityEndDate: null,
                showAnswersImmediately: true,
                answersVisibleAt: null,
                isActive: true,
            });
            const createdExamId = Number(exam.id);
            examId = createdExamId;
            examType = 'course-exam';
            await courseLevelExams_1.CourseLevelExamsService.addQuestionsFromBank({ id: teacherId, role: 'teacher' }, createdExamId, questionIds);
        }
        const result = await pool_1.default.query(`UPDATE exam_builder_chatbot_sessions
       SET status = 'approved', exam_id = $3, exam_type = $4, updated_at = NOW()
       WHERE id = $1 AND teacher_id = $2
       RETURNING *`, [sessionId, teacherId, examId, examType]);
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
exports.ExamBuilderChatbotService = ExamBuilderChatbotService;
