"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExamFlowService = void 0;
const pool_1 = __importDefault(require("../db/pool"));
const examPolicies_1 = require("./examPolicies");
function normalizeChoiceContent(text, imageUrl) {
    if (imageUrl?.trim()) {
        return { text: text?.trim() || '', image: imageUrl.trim() };
    }
    const value = text?.trim() ?? '';
    if (/^https?:\/\//i.test(value)) {
        return { text: '', image: value };
    }
    return { text: value, image: null };
}
function normalizeLectureExamType(value, fallback = 'exam') {
    if (typeof value !== 'string')
        return fallback;
    const raw = value.trim().toLowerCase();
    if (raw === 'assignment' || raw === 'homework' || raw === 'task')
        return 'assignment';
    if (raw === 'exam' || raw === 'quiz' || raw === 'test')
        return 'exam';
    return fallback;
}
function parseLectureExamTypeFilter(value) {
    if (!value?.trim())
        return null;
    const raw = value.trim().toLowerCase();
    if (raw === 'all' || raw === 'any' || raw === '*')
        return 'all';
    return normalizeLectureExamType(raw, 'exam');
}
class ExamFlowService {
    /**
     * تحويل نص Bulk لأسئلة MCQ (يدعم: 1- ... + (أ)/(ب)/(ج)/(د) أو A/B/C/D)
     */
    static parsePassageMcqBulkText(bulkText) {
        const text = String(bulkText || '').replace(/\r\n/g, '\n').trim();
        if (!text)
            return [];
        const lines = text
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.length > 0);
        const questions = [];
        let current = null;
        const optionRegex = /^\(?\s*(أ|ا|ب|ج|د|A|B|C|D)\s*\)?\s*[).:\-]?\s*(.+)$/i;
        const questionStartRegex = /^\d+\s*[-.)]\s*(.+)$/;
        const pushCurrentIfComplete = () => {
            if (current &&
                current.questionText &&
                current.optionA &&
                current.optionB &&
                current.optionC &&
                current.optionD) {
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
                if (!value)
                    continue;
                if (rawKey === 'أ' || rawKey === 'ا' || rawKey === 'A')
                    current.optionA = value;
                else if (rawKey === 'ب' || rawKey === 'B')
                    current.optionB = value;
                else if (rawKey === 'ج' || rawKey === 'C')
                    current.optionC = value;
                else if (rawKey === 'د' || rawKey === 'D')
                    current.optionD = value;
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
    static async createExam(teacherId, payload) {
        const { lectureId, type, title, totalGrade, duration, isVisible, showAt, hideAt, lockNextLectures, showAnswersImmediately, showAnswersAfterHours, allowMultipleAttempts, showAnswersLater, answersReleaseDate, timeLimitEnabled, timeLimitMinutes, startWindow, endWindow, } = payload;
        if (!lectureId || Number.isNaN(Number(lectureId))) {
            const error = new Error('lectureId is required');
            error.status = 400;
            throw error;
        }
        const lectureRes = await pool_1.default.query(`SELECT l.id, c.teacher_id
       FROM lectures l
       JOIN courses c ON l.course_id = c.id
       WHERE l.id = $1`, [lectureId]);
        if (!lectureRes.rowCount) {
            const error = new Error('Lecture not found');
            error.status = 404;
            throw error;
        }
        if (lectureRes.rows[0].teacher_id !== teacherId) {
            const error = new Error('You do not own this lecture');
            error.status = 403;
            throw error;
        }
        const normalizedTimeLimitMinutes = timeLimitMinutes === undefined || timeLimitMinutes === null ? null : Number(timeLimitMinutes);
        if (normalizedTimeLimitMinutes !== null && Number.isNaN(normalizedTimeLimitMinutes)) {
            const error = new Error('timeLimitMinutes must be a valid number');
            error.status = 400;
            throw error;
        }
        if (timeLimitEnabled && (!normalizedTimeLimitMinutes || normalizedTimeLimitMinutes <= 0)) {
            const error = new Error('Provide a positive timeLimitMinutes value when enabling the timer');
            error.status = 400;
            throw error;
        }
        const normalizedAnswersReleaseDate = answersReleaseDate ? new Date(answersReleaseDate) : null;
        if (normalizedAnswersReleaseDate && Number.isNaN(normalizedAnswersReleaseDate.getTime())) {
            const error = new Error('answersReleaseDate must be a valid ISO date');
            error.status = 400;
            throw error;
        }
        if (showAnswersLater && !normalizedAnswersReleaseDate) {
            const error = new Error('answersReleaseDate is required when showAnswersLater is enabled');
            error.status = 400;
            throw error;
        }
        const normalizedStartWindow = startWindow ? new Date(startWindow) : null;
        if (normalizedStartWindow && Number.isNaN(normalizedStartWindow.getTime())) {
            const error = new Error('startWindow must be a valid ISO date');
            error.status = 400;
            throw error;
        }
        const normalizedEndWindow = endWindow ? new Date(endWindow) : null;
        if (normalizedEndWindow && Number.isNaN(normalizedEndWindow.getTime())) {
            const error = new Error('endWindow must be a valid ISO date');
            error.status = 400;
            throw error;
        }
        if (normalizedStartWindow &&
            normalizedEndWindow &&
            normalizedStartWindow.getTime() > normalizedEndWindow.getTime()) {
            const error = new Error('startWindow must be earlier than endWindow');
            error.status = 400;
            throw error;
        }
        const normalizedShowAt = showAt ? new Date(showAt) : null;
        const normalizedHideAt = hideAt ? new Date(hideAt) : null;
        const examType = normalizeLectureExamType(type, 'exam');
        const result = await pool_1.default.query(`INSERT INTO exams (
        lecture_id, type, total_grade, created_by, title, duration, is_visible,
        show_at, hide_at, lock_next_lectures,
        show_answers_immediately, show_answers_after_hours,
        allow_multiple_attempts, show_answers_later, answers_release_date,
        time_limit_enabled, time_limit_minutes, start_window, end_window
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10,
        $11, $12,
        $13, $14, $15,
        $16, $17, $18, $19
      ) RETURNING *`, [
            lectureId,
            examType,
            totalGrade ?? 100,
            teacherId,
            title?.trim() || (examType === 'assignment' ? 'Lecture Assignment' : 'Lecture Exam'),
            duration ?? null,
            isVisible ?? false,
            normalizedShowAt,
            normalizedHideAt,
            lockNextLectures ?? false,
            showAnswersImmediately ?? true,
            showAnswersAfterHours ?? 0,
            allowMultipleAttempts ?? false,
            showAnswersLater ?? false,
            normalizedAnswersReleaseDate,
            timeLimitEnabled ?? false,
            normalizedTimeLimitMinutes,
            normalizedStartWindow,
            normalizedEndWindow,
        ]);
        return this.mapExamRow(result.rows[0]);
    }
    static async addQuestionsFromBank(teacherId, examId, questionIds, txClient) {
        const exam = await this.getExamWithCourse(examId);
        if (!exam) {
            const error = new Error('Exam not found');
            error.status = 404;
            throw error;
        }
        if (exam.teacher_id !== teacherId) {
            const error = new Error('You do not own this exam');
            error.status = 403;
            throw error;
        }
        if (!questionIds || questionIds.length === 0) {
            return { addedCount: 0, examQuestionIds: [], addedBankIds: [] };
        }
        const db = txClient ?? pool_1.default;
        // Filter unique IDs
        const uniqueIds = [...new Set(questionIds)];
        let addedCount = 0;
        const examQuestionIds = [];
        const addedBankIds = [];
        // 1. Try to fetch and insert from V2 (New Question Bank) first
        const v2Result = await db.query(`INSERT INTO exam_questions (exam_id, question_id_v2, question_text, grade, image)
       SELECT $1, q.id, q.question_text, q.points, qm.media_url
       FROM questions_v2 q
       LEFT JOIN question_media qm ON q.id = qm.question_id
       WHERE q.id = ANY($2::int[])
       RETURNING id, question_id_v2`, [examId, uniqueIds]);
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        addedCount += v2Result.rowCount;
        v2Result.rows.forEach((r) => {
            examQuestionIds.push(r.id);
            if (r.question_id_v2 != null)
                addedBankIds.push(r.question_id_v2);
        });
        const addedV2Ids = v2Result.rows.map((r) => r.question_id_v2);
        // نسخة الخيارات داخل الامتحان (snapshot) حتى لا يتأثر الامتحان بتعديل البنك
        for (const row of v2Result.rows) {
            try {
                await db.query(`INSERT INTO exam_question_options (exam_question_id, option_index, text_content)
           SELECT $1, qo.option_index, COALESCE(qo.text_content, qo.image_url, '')
           FROM question_options qo
           WHERE qo.question_id = $2
           ORDER BY qo.option_index`, [row.id, row.question_id_v2]);
            }
            catch {
                // الجدول قد يكون غير موجود قبل تشغيل migration 1700000007006
            }
        }
        // 2. Identify remaining IDs that were NOT found in V2
        const remainingIds = uniqueIds.filter((id) => !addedV2Ids.includes(id));
        // 3. Try to insert remaining IDs from V1 (Legacy) + نسخة الخيارات
        if (remainingIds.length > 0) {
            const v1Result = await db.query(`INSERT INTO exam_questions (exam_id, question_id, question_text, grade, image)
         SELECT $1, id, COALESCE(text, ''), COALESCE(points, 1), image
         FROM questions
         WHERE id = ANY($2::int[])
         RETURNING id, question_id`, [examId, remainingIds]);
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            addedCount += v1Result.rowCount;
            v1Result.rows.forEach((r) => {
                examQuestionIds.push(r.id);
                if (r.question_id != null)
                    addedBankIds.push(r.question_id);
            });
            for (const row of v1Result.rows) {
                try {
                    await db.query(`INSERT INTO exam_question_options (exam_question_id, option_index, text_content)
             SELECT $1, sub.rn - 1, sub.text
             FROM (
               SELECT qc.text, ROW_NUMBER() OVER (ORDER BY qc.id) AS rn
               FROM question_choices qc
               WHERE qc.question_id = $2
               LIMIT 4
             ) sub`, [row.id, row.question_id]);
                }
                catch {
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
    static async addPassageQuestionsToExam(teacherId, examId, passageId) {
        const exam = await this.getExamWithCourse(examId);
        if (!exam) {
            const err = new Error('Exam not found');
            err.status = 404;
            throw err;
        }
        if (exam.teacher_id !== teacherId) {
            const err = new Error('You do not own this exam');
            err.status = 403;
            throw err;
        }
        const passageRow = await pool_1.default.query(`SELECT id, title, content FROM question_passages WHERE id = $1`, [passageId]);
        if (!passageRow.rows.length) {
            const err = new Error('القطعة غير موجودة');
            err.status = 404;
            throw err;
        }
        const passage = passageRow.rows[0];
        const qIdsResult = await pool_1.default.query(`SELECT id FROM questions_v2 WHERE passage_id = $1 ORDER BY id ASC`, [passageId]);
        const passageQuestionIds = qIdsResult.rows.map((r) => r.id);
        if (passageQuestionIds.length === 0) {
            const err = new Error('القطعة لا تحتوي على أسئلة');
            err.status = 400;
            throw err;
        }
        const existingResult = await pool_1.default.query(`SELECT question_id_v2 FROM exam_questions WHERE exam_id = $1 AND question_id_v2 IS NOT NULL`, [examId]);
        const existingV2Ids = new Set(existingResult.rows.map((r) => r.question_id_v2));
        const toAdd = passageQuestionIds.filter((id) => !existingV2Ids.has(id));
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
    static async createPassageWithQuestionsForExam(teacherId, examId, payload) {
        const exam = await this.getExamWithCourse(examId);
        if (!exam) {
            const err = new Error('Exam not found');
            err.status = 404;
            throw err;
        }
        if (exam.teacher_id !== teacherId) {
            const err = new Error('You do not own this exam');
            err.status = 403;
            throw err;
        }
        if (!payload.content || !String(payload.content).trim()) {
            const err = new Error('content is required');
            err.status = 400;
            throw err;
        }
        if (!Array.isArray(payload.questions) || payload.questions.length === 0) {
            const err = new Error('questions must be a non-empty array');
            err.status = 400;
            throw err;
        }
        const toCorrectIndex = (value) => {
            if (typeof value === 'number') {
                if (value >= 0 && value <= 3)
                    return value;
                throw new Error('correctAnswer number must be between 0 and 3');
            }
            const letter = String(value).trim().toUpperCase();
            const map = { A: 0, B: 1, C: 2, D: 3 };
            if (!(letter in map)) {
                throw new Error('correctAnswer must be one of A, B, C, D or 0..3');
            }
            return map[letter];
        };
        const client = await pool_1.default.connect();
        try {
            await client.query('BEGIN');
            const hasLegacyOptionsRes = await client.query(`SELECT 1
         FROM information_schema.columns
         WHERE table_name = 'questions' AND column_name = 'options'
         LIMIT 1`);
            const hasLegacyOptions = (hasLegacyOptionsRes.rowCount ?? 0) > 0;
            const passage = {
                id: null,
                title: payload.title?.trim() || null,
                content: payload.content.trim(),
            };
            const questionIds = [];
            const examQuestionIds = [];
            for (const item of payload.questions) {
                const questionText = String(item.questionText || '').trim();
                const optionA = String(item.optionA || '').trim();
                const optionB = String(item.optionB || '').trim();
                const optionC = String(item.optionC || '').trim();
                const optionD = String(item.optionD || '').trim();
                const points = Number.isFinite(Number(item.points)) ? Math.max(1, Math.trunc(Number(item.points))) : 1;
                if (!questionText || !optionA || !optionB || !optionC || !optionD) {
                    const err = new Error('Each question must include questionText, optionA, optionB, optionC, and optionD');
                    err.status = 400;
                    throw err;
                }
                const correctIndex = toCorrectIndex(item.correctAnswer);
                const qRes = hasLegacyOptions
                    ? await client.query(`INSERT INTO questions (text, type, options)
               VALUES ($1, 'single_choice', $2::jsonb)
               RETURNING id`, [questionText, JSON.stringify({ __passage_content: passage.content, __passage_title: passage.title })])
                    : await client.query(`INSERT INTO questions (text, type)
               VALUES ($1, 'single_choice')
               RETURNING id`, [questionText]);
                const questionId = Number(qRes.rows[0].id);
                questionIds.push(questionId);
                const options = [optionA, optionB, optionC, optionD];
                for (let i = 0; i < 4; i++) {
                    await client.query(`INSERT INTO question_choices (question_id, text, is_correct)
             VALUES ($1, $2, $3)`, [questionId, options[i], i === correctIndex]);
                }
                const examQuestionRes = await client.query(`INSERT INTO exam_questions (exam_id, question_id, question_text, grade, image)
           VALUES ($1, $2, $3, $4, NULL)
           RETURNING id`, [examId, questionId, questionText, points]);
                const examQuestionId = examQuestionRes.rows[0].id;
                examQuestionIds.push(examQuestionId);
                // مهم: أي خطأ داخل transaction يفسدها بالكامل، لذا نستخدم SAVEPOINT
                // لإبقاء إدراج snapshot اختياريًا بدون كسر العملية الأساسية.
                await client.query('SAVEPOINT sp_exam_question_options');
                try {
                    await client.query(`INSERT INTO exam_question_options (exam_question_id, option_index, text_content)
             VALUES ($1, 0, $2), ($1, 1, $3), ($1, 2, $4), ($1, 3, $5)`, [examQuestionId, optionA, optionB, optionC, optionD]);
                    await client.query('RELEASE SAVEPOINT sp_exam_question_options');
                }
                catch {
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
        }
        catch (error) {
            await client.query('ROLLBACK');
            throw error;
        }
        finally {
            client.release();
        }
    }
    static async removeQuestionFromExam(teacherId, examId, questionId) {
        const exam = await this.getExamWithCourse(examId);
        if (!exam) {
            const error = new Error('Exam not found');
            error.status = 404;
            throw error;
        }
        if (exam.teacher_id !== teacherId) {
            const error = new Error('You do not own this exam');
            error.status = 403;
            throw error;
        }
        const result = await pool_1.default.query('DELETE FROM exam_questions WHERE id = $1 AND exam_id = $2', [questionId, examId]);
        if (result.rowCount === 0) {
            const error = new Error('Question not found in this exam');
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
    static async setQuestionCorrectAnswer(teacherId, examId, examQuestionId, correct_answer_index) {
        const exam = await this.getExamWithCourse(examId);
        if (!exam) {
            const error = new Error('Exam not found');
            error.status = 404;
            throw error;
        }
        if (exam.teacher_id !== teacherId) {
            const error = new Error('You do not own this exam');
            error.status = 403;
            throw error;
        }
        const index = Math.min(3, Math.max(0, correct_answer_index));
        try {
            const result = await pool_1.default.query(`UPDATE exam_questions
         SET correct_answer_index_override = $1
         WHERE id = $2 AND exam_id = $3
         RETURNING id`, [index, examQuestionId, examId]);
            if (result.rowCount === 0) {
                const error = new Error('Question not found in this exam');
                error.status = 404;
                throw error;
            }
        }
        catch (err) {
            if (err?.message?.includes('correct_answer_index_override')) {
                const error = new Error('Correct answer override is not available. Run migration 1700000007003_add_exam_question_correct_answer_override.');
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
    static async setQuestionVisibility(teacherId, examId, examQuestionId, isVisible) {
        const exam = await this.getExamWithCourse(examId);
        if (!exam) {
            const error = new Error('Exam not found');
            error.status = 404;
            throw error;
        }
        if (exam.teacher_id !== teacherId) {
            const error = new Error('You do not own this exam');
            error.status = 403;
            throw error;
        }
        try {
            const result = await pool_1.default.query(`UPDATE exam_questions SET is_visible = $1 WHERE id = $2 AND exam_id = $3 RETURNING id`, [isVisible, examQuestionId, examId]);
            if (result.rowCount === 0) {
                const error = new Error('Question not found in this exam');
                error.status = 404;
                throw error;
            }
        }
        catch (err) {
            if (err?.message?.includes('is_visible')) {
                const error = new Error('Visibility is not available. Run migration 1700000007005_add_is_visible_to_exam_questions.');
                error.status = 501;
                throw error;
            }
            throw err;
        }
    }
    static async getExamsByTeacher(teacherId, filters) {
        let typeFilter = parseLectureExamTypeFilter(filters?.type);
        if (typeFilter === 'assignment') {
            const assignmentCountRes = await pool_1.default.query(`SELECT COUNT(*)::int AS c
         FROM exams e
         INNER JOIN lectures l ON e.lecture_id = l.id
         INNER JOIN courses c ON l.course_id = c.id
         WHERE c.teacher_id = $1 AND e.type = 'assignment'`, [teacherId]);
            if ((assignmentCountRes.rows[0]?.c ?? 0) === 0) {
                // سجلات قديمة: كانت تُحفظ دائماً كـ exam رغم إنشائها كواجب
                typeFilter = 'exam';
            }
        }
        const params = [teacherId];
        let query = `
      SELECT
        e.*,
        l.title AS lecture_title,
        c.title AS course_title,
        c.id AS course_id,
        COUNT(DISTINCT eq.id)::int AS questions_count,
        COUNT(DISTINCT es.id)::int AS submissions_count
      FROM exams e
      INNER JOIN lectures l ON e.lecture_id = l.id
      INNER JOIN courses c ON l.course_id = c.id
      LEFT JOIN exam_questions eq ON eq.exam_id = e.id
      LEFT JOIN exam_submissions es ON es.exam_id = e.id
      WHERE c.teacher_id = $1
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
      GROUP BY e.id, l.title, c.title, c.id
      ORDER BY e.created_at DESC
    `;
        const result = await pool_1.default.query(query, params);
        return result.rows.map((row) => ({
            ...this.mapExamRow(row),
            type: row.type,
            lectureTitle: row.lecture_title,
            lectureName: row.lecture_title,
            courseTitle: row.course_title,
            courseName: row.course_title,
            courseId: row.course_id,
            questionsCount: row.questions_count,
            submissionsCount: row.submissions_count,
        }));
    }
    static async getExamForUser(examId, user) {
        const exam = await this.getExamWithCourse(examId);
        if (!exam) {
            const error = new Error('Exam not found');
            error.status = 404;
            throw error;
        }
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error
        if (user.role === 'teacher' && exam.teacher_id !== user.id && user.role !== 'admin') {
            const error = new Error('You do not own this exam');
            error.status = 403;
            throw error;
        }
        if (user.role === 'student') {
            await this.ensureStudentEnrollment(exam.lecture_id, user.id);
            await this.expireOverdueAttempts(exam.id, user.id);
            const attempts = await this.getStudentAttempts(exam.id, user.id);
            const normalizedAttempts = attempts.map(toAttemptSnapshot);
            const activeAttemptIndex = attempts.findIndex((a) => a.status === 'in_progress');
            const activeAttempt = activeAttemptIndex >= 0 ? attempts[activeAttemptIndex] : null;
            const activeAttemptSnapshot = activeAttemptIndex >= 0 ? normalizedAttempts[activeAttemptIndex] : null;
            const attemptHistory = this.summarizeAttempts(attempts);
            const feedback = await this.buildFeedbackIfAllowed(exam, attempts);
            const baseResponse = {
                exam: this.mapExamRow(exam),
                attemptHistory,
                attempt: activeAttempt ? this.mapAttemptForStudent(activeAttempt) : null,
                feedback,
            };
            if (!exam.is_visible || !this.isWithinVisibilityWindow(exam)) {
                return {
                    ...baseResponse,
                    status: 'hidden',
                    message: 'This exam is not visible right now.',
                };
            }
            const availability = this.getWindowStatus(exam);
            if (availability.status !== 'ready') {
                return {
                    ...baseResponse,
                    status: availability.status,
                    message: availability.message,
                };
            }
            const preventNewAttempt = (0, examPolicies_1.shouldPreventNewAttempt)({
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
            const questions = await this.loadExamQuestions(exam.id, true);
            return {
                ...baseResponse,
                status: 'ready',
                questions: this.sanitizeQuestions(questions, false),
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
    static async startAttempt(examId, studentId) {
        const exam = await this.getExamWithCourse(examId);
        if (!exam) {
            const error = new Error('Exam not found');
            error.status = 404;
            throw error;
        }
        await this.ensureStudentEnrollment(exam.lecture_id, studentId);
        if (!exam.is_visible || !this.isWithinVisibilityWindow(exam)) {
            const error = new Error('This exam is not available right now');
            error.status = 403;
            throw error;
        }
        const availability = this.getWindowStatus(exam);
        if (availability.status !== 'ready') {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-expect-error
            const error = new Error(availability.message);
            error.status = 403;
            throw error;
        }
        await this.expireOverdueAttempts(exam.id, studentId);
        const attempts = await this.getStudentAttempts(exam.id, studentId);
        const activeAttempt = attempts.find((a) => a.status === 'in_progress');
        if (activeAttempt) {
            return this.mapAttemptForStudent(activeAttempt);
        }
        const preventNewAttempt = (0, examPolicies_1.shouldPreventNewAttempt)({
            allowMultipleAttempts: !!exam.allow_multiple_attempts,
            attempts: attempts.map(toAttemptSnapshot),
        });
        if (preventNewAttempt) {
            const error = new Error('You have already completed this exam.');
            error.status = 403;
            throw error;
        }
        const attemptNumber = (attempts[0]?.attempt_number || 0) + 1;
        const startTime = new Date();
        const expireAt = exam.time_limit_enabled && exam.time_limit_minutes
            ? new Date(startTime.getTime() + exam.time_limit_minutes * 60 * 1000)
            : null;
        const insertResult = await pool_1.default.query(`INSERT INTO exam_submissions (
        exam_id, student_id, total_grade, passed, submitted_at,
        attempt_start_time, attempt_end_time, status, attempt_number,
        time_limit_minutes, attempt_expire_at, is_late
      ) VALUES (
        $1, $2, NULL, NULL, NULL,
        $3, NULL, 'in_progress', $4,
        $5, $6, FALSE
      ) RETURNING *`, [exam.id, studentId, startTime, attemptNumber, exam.time_limit_minutes ?? null, expireAt]);
        return this.mapAttemptForStudent(insertResult.rows[0]);
    }
    static async submitAttempt({ examId, studentId, answers, attemptId, allowAutoStart = true, }) {
        const exam = await this.getExamWithCourse(examId);
        if (!exam) {
            const error = new Error('Exam not found');
            error.status = 404;
            throw error;
        }
        await this.ensureStudentEnrollment(exam.lecture_id, studentId);
        if (!Array.isArray(answers) || answers.length === 0) {
            const error = new Error('answers array is required');
            error.status = 400;
            throw error;
        }
        await this.expireOverdueAttempts(exam.id, studentId);
        let attempt = attemptId
            ? await this.getAttemptById(attemptId, exam.id, studentId)
            : await this.getActiveAttempt(exam.id, studentId);
        if (!attempt && allowAutoStart) {
            attempt = (await this.startAttempt(exam.id, studentId));
            attempt = await this.getAttemptById(attempt.attemptId, exam.id, studentId);
        }
        if (!attempt) {
            const error = new Error('No active attempt found. Please start the exam first.');
            error.status = 400;
            throw error;
        }
        if (attempt.status !== 'in_progress') {
            const error = new Error('This attempt is already finished');
            error.status = 400;
            throw error;
        }
        const questionBank = await this.loadExamQuestions(exam.id, true);
        if (!questionBank.length) {
            const error = new Error('This exam has no questions yet.');
            error.status = 400;
            throw error;
        }
        const evaluation = this.evaluateAnswers(questionBank, answers);
        const now = new Date();
        const isLate = (0, examPolicies_1.isPastExpiry)(attempt.attempt_expire_at, now);
        const status = isLate ? 'late' : 'submitted';
        // Late attempts are still graded but highlighted for downstream late policies.
        const updateRes = await pool_1.default.query(`UPDATE exam_submissions
       SET total_grade = $1,
           passed = $2,
           submitted_at = $3,
           attempt_end_time = $4,
           status = $5,
           is_late = $6
       WHERE id = $7
       RETURNING *`, [evaluation.totalGrade, evaluation.passed, now, now, status, isLate, attempt.id]);
        const updatedAttempt = updateRes.rows[0];
        await this.persistAttemptAnswers(updatedAttempt.id, evaluation.questions);
        await this.maybeAddStudentPoints(studentId, exam.id, evaluation.totalGrade, evaluation.maxGrade);
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
    static async getAttemptDetails(examId, attemptId, user) {
        const exam = await this.getExamWithCourse(examId);
        if (!exam) {
            const error = new Error('Exam not found');
            error.status = 404;
            throw error;
        }
        const attempt = await this.getAttemptById(attemptId, exam.id);
        if (!attempt) {
            const error = new Error('Attempt not found');
            error.status = 404;
            throw error;
        }
        if (user.role === 'student' && attempt.student_id !== user.id) {
            const error = new Error('You cannot access this attempt');
            error.status = 403;
            throw error;
        }
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error
        if (user.role === 'teacher' && exam.teacher_id !== user.id && user.role !== 'admin') {
            const error = new Error('You do not own this exam');
            error.status = 403;
            throw error;
        }
        const canViewAnswers = user.role !== 'student' || this.shouldReleaseAnswers(exam, attempt, new Date()).release;
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
    static async getMyLectureReport(examId, studentId) {
        const exam = await this.getExamWithCourse(examId);
        if (!exam) {
            const error = new Error('Exam not found');
            error.status = 404;
            throw error;
        }
        await this.ensureStudentEnrollment(exam.lecture_id, studentId);
        const attempts = await this.getStudentAttempts(examId, studentId);
        const latestSubmitted = attempts.find((a) => ['submitted', 'late', 'expired'].includes(a.status));
        if (!latestSubmitted) {
            const error = new Error('لا توجد محاولة مُسلَّمة لهذا الامتحان');
            error.status = 404;
            throw error;
        }
        const decision = this.shouldReleaseAnswers(exam, latestSubmitted, new Date());
        if (!decision.release) {
            const error = new Error(
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-expect-error
            decision.reason === 'scheduled_pending'
                ? 'سيتم إظهار الإجابات في وقت لاحق'
                : 'لا يمكن عرض تقرير الإجابات لهذا الامتحان');
            error.status = 403;
            throw error;
        }
        const answers = await this.getAttemptAnswers(latestSubmitted.id);
        const totalGrade = latestSubmitted.total_grade ?? 0;
        const maxGrade = exam.total_grade ?? 0;
        return {
            examType: 'lecture',
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
                    ? { letter: null, text: a.selectedChoice.text }
                    : { letter: null, text: null },
                correctAnswer: a.correctChoice?.text
                    ? { letter: null, text: a.correctChoice.text }
                    : { letter: null, text: null },
                isCorrect: a.isCorrect,
            })),
        };
    }
    static async getExamQuestionReport(examId, user) {
        const exam = await this.getExamWithCourse(examId);
        if (!exam) {
            const error = new Error('Exam not found');
            error.status = 404;
            throw error;
        }
        if (user.role !== 'admin' && exam.teacher_id !== user.id) {
            const error = new Error('You do not own this exam');
            error.status = 403;
            throw error;
        }
        const questionsRes = await pool_1.default.query(`SELECT
         eq.id AS exam_question_id,
         COALESCE(NULLIF(eq.question_text, ''), q.text) AS question_text,
         COALESCE(eq.image, q.image) AS question_image,
         eq.grade
       FROM exam_questions eq
       LEFT JOIN questions q ON eq.question_id = q.id
       WHERE eq.exam_id = $1
       ORDER BY eq.id`, [exam.id]);
        const reportMap = new Map();
        questionsRes.rows.forEach((row) => {
            reportMap.set(row.exam_question_id, {
                questionId: row.exam_question_id,
                questionText: row.question_text,
                questionImage: row.question_image,
                grade: row.grade || 1,
                totalResponses: 0,
                correctCount: 0,
                incorrectCount: 0,
                correctStudents: [],
                incorrectStudents: [],
            });
        });
        if (!reportMap.size) {
            return {
                exam: this.mapExamRow(exam),
                questions: [],
            };
        }
        const answersRes = await pool_1.default.query(`SELECT
         ea.question_id AS exam_question_id,
         ea.is_correct,
         es.student_id,
         es.id AS submission_id,
         es.attempt_number,
         u.name AS student_name
       FROM exam_answers ea
       JOIN exam_submissions es ON ea.submission_id = es.id
       JOIN users u ON es.student_id = u.id
       WHERE es.exam_id = $1
         AND es.status IN ('submitted', 'late', 'expired')
       ORDER BY ea.question_id, es.attempt_number, es.id`, [exam.id]);
        answersRes.rows.forEach((row) => {
            const bucket = reportMap.get(row.exam_question_id);
            if (!bucket)
                return;
            const student = {
                studentId: row.student_id,
                studentName: row.student_name,
                submissionId: row.submission_id,
                attemptNumber: row.attempt_number,
            };
            bucket.totalResponses += 1;
            if (row.is_correct) {
                bucket.correctCount += 1;
                bucket.correctStudents.push(student);
            }
            else {
                bucket.incorrectCount += 1;
                bucket.incorrectStudents.push(student);
            }
        });
        return {
            exam: this.mapExamRow(exam),
            questions: Array.from(reportMap.values()),
        };
    }
    /** Get lecture exam by id with course/teacher info. Returns null if not found. */
    static async getExamWithCourse(examId) {
        const res = await pool_1.default.query(`SELECT e.*, l.course_id, c.teacher_id
       FROM exams e
       JOIN lectures l ON e.lecture_id = l.id
       JOIN courses c ON l.course_id = c.id
       WHERE e.id = $1`, [examId]);
        return res.rows[0] || null;
    }
    static async ensureStudentEnrollment(lectureId, studentId) {
        const enrollment = await pool_1.default.query(`SELECT 1
       FROM enrollments en
       JOIN lectures l ON l.course_id = en.course_id
       WHERE l.id = $1 AND en.user_id = $2`, [lectureId, studentId]);
        if (!enrollment.rowCount) {
            const error = new Error('You are not enrolled in this course');
            error.status = 403;
            throw error;
        }
    }
    static isWithinVisibilityWindow(exam) {
        const now = new Date();
        if (exam.show_at && new Date(exam.show_at) > now) {
            return false;
        }
        if (exam.hide_at && new Date(exam.hide_at) < now) {
            return false;
        }
        return true;
    }
    static getWindowStatus(exam) {
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
    static async expireOverdueAttempts(examId, studentId) {
        await pool_1.default.query(`UPDATE exam_submissions
       SET status = 'expired',
           attempt_end_time = attempt_expire_at,
           submitted_at = attempt_expire_at,
           total_grade = COALESCE(total_grade, 0),
           passed = FALSE
       WHERE exam_id = $1
         AND student_id = $2
         AND status = 'in_progress'
         AND attempt_expire_at IS NOT NULL
         AND attempt_expire_at <= NOW()`, [examId, studentId]);
    }
    static async getStudentAttempts(examId, studentId) {
        const res = await pool_1.default.query(`SELECT *
       FROM exam_submissions
       WHERE exam_id = $1 AND student_id = $2
       ORDER BY attempt_start_time DESC`, [examId, studentId]);
        return res.rows;
    }
    static async getAttemptById(attemptId, examId, studentId) {
        const params = [attemptId, examId];
        let query = `SELECT * FROM exam_submissions WHERE id = $1 AND exam_id = $2`;
        if (studentId) {
            query += ` AND student_id = $3`;
            params.push(studentId);
        }
        const res = await pool_1.default.query(query, params);
        return res.rows[0] || null;
    }
    static async getActiveAttempt(examId, studentId) {
        const res = await pool_1.default.query(`SELECT *
       FROM exam_submissions
       WHERE exam_id = $1 AND student_id = $2 AND status = 'in_progress'
       ORDER BY attempt_start_time DESC
       LIMIT 1`, [examId, studentId]);
        return res.rows[0] || null;
    }
    static summarizeAttempts(attempts) {
        return attempts.map((attempt) => ({
            attemptId: attempt.id,
            attemptNumber: attempt.attempt_number,
            status: attempt.status,
            totalGrade: attempt.total_grade,
            submittedAt: attempt.submitted_at,
            isLate: attempt.is_late,
        }));
    }
    static mapAttemptForStudent(attempt) {
        const remainingSeconds = (0, examPolicies_1.calculateRemainingSeconds)(attempt.attempt_expire_at);
        return {
            attemptId: attempt.id,
            attemptStartTime: attempt.attempt_start_time,
            attemptExpireAt: attempt.attempt_expire_at,
            remainingSeconds,
            timeLimitMinutes: attempt.time_limit_minutes,
        };
    }
    static async getExamAttemptSummary(examId) {
        const res = await pool_1.default.query(`SELECT 
        COUNT(*) as total_attempts,
        COUNT(CASE WHEN status = 'submitted' THEN 1 END) as submitted_attempts,
        COUNT(CASE WHEN status = 'late' THEN 1 END) as late_attempts,
        COUNT(CASE WHEN status = 'expired' THEN 1 END) as expired_attempts
       FROM exam_submissions
       WHERE exam_id = $1`, [examId]);
        return res.rows[0];
    }
    static async loadExamQuestions(examId, forStudent) {
        const hasLegacyOptionsRes = await pool_1.default.query(`SELECT 1
       FROM information_schema.columns
       WHERE table_name = 'questions' AND column_name = 'options'
       LIMIT 1`);
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
        let res;
        try {
            res = await pool_1.default.query(queryWithOverride, [examId]);
        }
        catch (err) {
            if (err?.message?.includes('correct_answer_index_override') ||
                err?.message?.includes('is_visible')) {
                res = await pool_1.default.query(queryWithoutOverride, [examId]);
            }
            else {
                throw err;
            }
        }
        const hasOverrideColumn = res.rows.length === 0 || res.rows[0].correct_answer_index_override !== undefined;
        const hasVisibleColumn = res.rows.length === 0 || res.rows[0].is_visible !== undefined;
        const skippedByVisibility = new Set();
        const map = new Map();
        res.rows.forEach((row) => {
            if (forStudent && hasVisibleColumn && row.is_visible === false) {
                skippedByVisibility.add(row.exam_question_id);
            }
            if (skippedByVisibility.has(row.exam_question_id))
                return;
            if (!map.has(row.exam_question_id)) {
                const isV2 = !!row.bank_question_id_v2;
                const text = row.question_text ||
                    (isV2 ? row.bank_text_v2 : row.bank_text) ||
                    null;
                const image = row.image ||
                    (isV2 ? row.bank_image_v2 : row.bank_image) ||
                    null;
                const override = hasOverrideColumn && row.correct_answer_index_override != null
                    ? Number(row.correct_answer_index_override)
                    : null;
                const legacyPassageContent = row.bank_options_v1 &&
                    typeof row.bank_options_v1 === 'object' &&
                    row.bank_options_v1.__passage_content
                    ? String(row.bank_options_v1.__passage_content)
                    : null;
                const legacyPassageTitle = row.bank_options_v1 &&
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
                    passage: !isV2 && legacyPassageContent && legacyPassageContent.trim() !== ''
                        ? { id: null, title: legacyPassageTitle, content: legacyPassageContent }
                        : undefined,
                });
            }
            const question = map.get(row.exam_question_id);
            const overrideIndex = question.correct_answer_index_override;
            // Handle V1 Choice
            if (row.choice_id) {
                const isCorrect = overrideIndex != null
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
                const isCorrect = effectiveCorrect !== null && choiceIndex !== null && choiceIndex === effectiveCorrect;
                const { text: choiceText, image: choiceImage } = normalizeChoiceContent(row.choice_text_v2, row.choice_image_v2);
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
                const snapshotRes = await pool_1.default.query(`SELECT exam_question_id, option_index, text_content
           FROM exam_question_options
           WHERE exam_question_id = ANY($1::int[])
           ORDER BY exam_question_id, option_index`, [examQuestionIds]);
                const byExamQuestion = new Map();
                snapshotRes.rows.forEach((r) => {
                    if (!byExamQuestion.has(r.exam_question_id))
                        byExamQuestion.set(r.exam_question_id, []);
                    byExamQuestion.get(r.exam_question_id).push({
                        option_index: r.option_index,
                        text_content: r.text_content,
                    });
                });
                byExamQuestion.forEach((opts, examQuestionId) => {
                    const question = map.get(examQuestionId);
                    if (!question || opts.length === 0)
                        return;
                    const effectiveCorrect = question.correct_answer_index_override ?? question.correct_answer_index ?? null;
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
            }
            catch {
                // جدول exam_question_options قد يكون غير موجود قبل تشغيل migration
            }
        }
        // أسئلة صورة من بنك الأسئلة قد تُضاف بدون صفوف في question_options أو question_choices؛ إضافة خيارات افتراضية أ، ب، ج، د
        const defaultChoiceLabels = ['أ', 'ب', 'ج', 'د'];
        map.forEach((question) => {
            if (question.choices.length !== 0)
                return;
            // أي سؤال بدون خيارات (سواء صورة أو نص) نضيف له الخيارات الافتراضية إن وُجدت إجابة صحيحة، وإلا نضيفها لأي سؤال صورة
            const hasImage = !!question.image;
            const correctIndex = question.correct_answer_index_override != null
                ? question.correct_answer_index_override
                : question.correct_answer_index != null &&
                    question.correct_answer_index >= 0 &&
                    question.correct_answer_index <= 3
                    ? question.correct_answer_index
                    : null;
            const shouldAddDefaults = hasImage || correctIndex !== null;
            if (!shouldAddDefaults)
                return;
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
            ...new Set(questions.map((q) => q.passage_id).filter((id) => id != null)),
        ];
        if (passageIds.length > 0) {
            const passagesRes = await pool_1.default.query(`SELECT id, title, content FROM question_passages WHERE id = ANY($1::int[])`, [passageIds]);
            const passageMap = new Map();
            passagesRes.rows.forEach((row) => {
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
    static sanitizeOneQuestion(question, includeCorrect) {
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
    static sanitizeQuestions(items, includeCorrect) {
        return items.map((item) => this.sanitizeOneQuestion(item, includeCorrect));
    }
    static evaluateAnswers(questions, answers) {
        const answerMap = new Map();
        answers.forEach((answer) => {
            answerMap.set(answer.questionId, answer.choiceId ?? null);
        });
        let totalGrade = 0;
        let maxGrade = 0;
        const evaluatedQuestions = [];
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
    static async persistAttemptAnswers(attemptId, questions) {
        await pool_1.default.query('DELETE FROM exam_answers WHERE submission_id = $1', [attemptId]);
        const values = [];
        const placeholders = [];
        questions.forEach((question, idx) => {
            const base = idx * 5;
            placeholders.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, NULL, $${base + 5})`);
            // الخيارات الافتراضية (أ، ب، ج، د) تستخدم IDs سالبة ولا تُخزَن في question_choices؛ نمرّر null لـ selected_choice_id
            const selectedChoiceId = question.selectedChoiceId != null && question.selectedChoiceId > 0
                ? question.selectedChoiceId
                : null;
            values.push(attemptId, question.questionId, selectedChoiceId, question.isCorrect, question.isCorrect ? question.grade : 0);
        });
        if (values.length) {
            await pool_1.default.query(`INSERT INTO exam_answers (
          submission_id,
          question_id,
          selected_choice_id,
          is_correct,
          answer_text,
          grade
        ) VALUES ${placeholders.join(', ')}`, values);
        }
    }
    static shouldReleaseAnswers(exam, attempt, referenceDate) {
        return (0, examPolicies_1.determineAnswerRelease)({
            showAnswersImmediately: !!exam.show_answers_immediately,
            showAnswersLater: !!exam.show_answers_later,
            answersReleaseDate: exam.answers_release_date,
            showAnswersAfterHours: exam.show_answers_after_hours ?? 0,
        }, attempt
            ? {
                status: attempt.status,
                attemptStartTime: attempt.attempt_start_time,
                attemptExpireAt: attempt.attempt_expire_at,
                submittedAt: attempt.submitted_at,
            }
            : null, referenceDate);
    }
    static async buildFeedbackIfAllowed(exam, attempts) {
        const latestAttempt = attempts.find((a) => ['submitted', 'late'].includes(a.status));
        if (!latestAttempt)
            return null;
        const decision = this.shouldReleaseAnswers(exam, latestAttempt, new Date());
        if (!decision.release)
            return null;
        const answers = await this.getAttemptAnswers(latestAttempt.id);
        return {
            attemptId: latestAttempt.id,
            releasedAt: new Date(),
            releaseReason: decision.reason,
            wrongQuestions: mapWrongQuestionsFromAnswers(answers),
            answers,
        };
    }
    static async getAttemptAnswers(attemptId) {
        const res = await pool_1.default.query(`SELECT 
        ea.question_id as exam_question_id,
        eq.question_text,
        eq.image,
        q.text as bank_text,
        q.image as bank_image,
        ea.selected_choice_id,
        ea.is_correct,
        selected_choice.text as selected_choice_text,
        correct_choice.id as correct_choice_id,
        correct_choice.text as correct_choice_text
       FROM exam_answers ea
       JOIN exam_questions eq ON ea.question_id = eq.id
       LEFT JOIN questions q ON eq.question_id = q.id
       LEFT JOIN question_choices selected_choice ON selected_choice.id = ea.selected_choice_id
       LEFT JOIN question_choices correct_choice 
         ON correct_choice.question_id = eq.question_id AND correct_choice.is_correct = true
       WHERE ea.submission_id = $1
       ORDER BY ea.question_id`, [attemptId]);
        return res.rows.map((row) => ({
            questionId: row.exam_question_id,
            questionText: row.question_text || row.bank_text || null,
            questionImage: row.image || row.bank_image || null,
            selectedChoice: {
                id: row.selected_choice_id,
                text: row.selected_choice_text || null,
            },
            correctChoice: row.correct_choice_id
                ? { id: row.correct_choice_id, text: row.correct_choice_text }
                : null,
            isCorrect: row.is_correct,
        }));
    }
    static async maybeAddStudentPoints(studentId, examId, obtainedGrade, maxGrade) {
        try {
            // @ts-expect-error dynamic import
            const { StudentPointsService } = await import('./studentPoints');
            const examInfo = await pool_1.default.query('SELECT title FROM exams WHERE id = $1', [examId]);
            const examTitle = examInfo.rowCount ? examInfo.rows[0].title : null;
            const hasPoints = await StudentPointsService.hasExamPoints(studentId, examId);
            if (!hasPoints) {
                await StudentPointsService.addExamPoints(studentId, examId, obtainedGrade, maxGrade, examTitle, 'lecture_exam');
            }
        }
        catch (error) {
            console.error('Error adding exam points:', error);
        }
    }
    static mapExamRow(row) {
        return {
            id: row.id,
            lectureId: row.lecture_id,
            title: row.title,
            totalGrade: row.total_grade,
            duration: row.duration,
            isVisible: row.is_visible,
            showAt: row.show_at,
            hideAt: row.hide_at,
            lockNextLectures: row.lock_next_lectures,
            showAnswersImmediately: row.show_answers_immediately,
            showAnswersAfterHours: row.show_answers_after_hours,
            allowMultipleAttempts: row.allow_multiple_attempts,
            showAnswersLater: row.show_answers_later,
            answersReleaseDate: row.answers_release_date,
            timeLimitEnabled: row.time_limit_enabled,
            timeLimitMinutes: row.time_limit_minutes,
            startWindow: row.start_window,
            endWindow: row.end_window,
            createdAt: row.created_at,
        };
    }
}
exports.ExamFlowService = ExamFlowService;
const toAttemptSnapshot = (attempt) => ({
    status: attempt.status,
    attemptStartTime: attempt.attempt_start_time,
    attemptExpireAt: attempt.attempt_expire_at,
    submittedAt: attempt.submitted_at,
});
const mapWrongQuestionsFromAnswers = (answers) => answers
    .filter((answer) => !answer.isCorrect)
    .map((answer) => ({
    questionId: answer.questionId,
    questionText: answer.questionText,
    questionImage: answer.questionImage,
    correctChoice: answer.correctChoice,
    yourChoice: answer.selectedChoice,
}));
