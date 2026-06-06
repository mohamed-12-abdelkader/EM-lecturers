"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExamsService = void 0;
const pool_1 = __importDefault(require("../db/pool"));
const courseExamSettings_1 = require("./courseExamSettings");
class ExamsService {
    static async createCourseExam({ courseId, title, image, questionsCount, duration, totalGrade, isVisible = false, createdBy, showAt, hideAt, lockNextLectures, showAnswersImmediately, showAnswersAfterHours, allowMultipleAttempts, attemptLimit, showAnswersLater, answersReleaseDate, timeLimitEnabled, timeLimitMinutes, startWindow, endWindow, }) {
        const normalizedShowAt = (0, courseExamSettings_1.toDateOrNull)(showAt, 'showAt');
        const normalizedHideAt = (0, courseExamSettings_1.toDateOrNull)(hideAt, 'hideAt');
        const normalizedStartWindow = (0, courseExamSettings_1.toDateOrNull)(startWindow, 'startWindow');
        const normalizedEndWindow = (0, courseExamSettings_1.toDateOrNull)(endWindow, 'endWindow');
        const normalizedAnswersReleaseDate = (0, courseExamSettings_1.toDateOrNull)(answersReleaseDate, 'answersReleaseDate');
        const normalizedTimeLimitMinutesValue = (0, courseExamSettings_1.toNumberOrNullIfProvided)(timeLimitMinutes, 'timeLimitMinutes');
        const normalizedTimeLimitMinutes = normalizedTimeLimitMinutesValue === undefined ? null : normalizedTimeLimitMinutesValue;
        const normalizedShowAnswersAfterHours = (0, courseExamSettings_1.normalizeNonNegativeHours)(showAnswersAfterHours, 'showAnswersAfterHours');
        const normalizedShowAnswersImmediately = showAnswersImmediately === undefined ? true : !!showAnswersImmediately;
        const normalizedLockNextLectures = !!lockNextLectures;
        let normalizedAttemptLimit = null;
        if (attemptLimit !== undefined) {
            if (attemptLimit === null) {
                normalizedAttemptLimit = null;
            }
            else {
                const parsedLimit = Number(attemptLimit);
                if (!Number.isInteger(parsedLimit) || parsedLimit <= 0) {
                    throw (0, courseExamSettings_1.buildValidationError)('attemptLimit must be a positive integer when provided');
                }
                normalizedAttemptLimit = parsedLimit;
            }
        }
        const normalizedAllowMultipleAttempts = normalizedAttemptLimit !== null ? normalizedAttemptLimit > 1 : !!allowMultipleAttempts;
        const normalizedShowAnswersLater = !!showAnswersLater;
        const normalizedTimeLimitEnabled = !!timeLimitEnabled;
        if (normalizedTimeLimitEnabled &&
            (!normalizedTimeLimitMinutes || normalizedTimeLimitMinutes <= 0)) {
            throw (0, courseExamSettings_1.buildValidationError)('Provide a positive timeLimitMinutes value when enabling the timer for course exam');
        }
        if (normalizedShowAnswersLater && !normalizedAnswersReleaseDate) {
            throw (0, courseExamSettings_1.buildValidationError)('answersReleaseDate is required when showAnswersLater is enabled for course exam');
        }
        if (normalizedStartWindow &&
            normalizedEndWindow &&
            normalizedStartWindow.getTime() > normalizedEndWindow.getTime()) {
            throw (0, courseExamSettings_1.buildValidationError)('startWindow must be earlier than endWindow');
        }
        const res = await pool_1.default.query(`INSERT INTO course_exams (
        course_id, title, image, questions_count, duration, total_grade, is_visible, created_by,
        show_at, hide_at, lock_next_lectures, show_answers_immediately, show_answers_after_hours,
        allow_multiple_attempts, attempt_limit, show_answers_later, answers_release_date,
        time_limit_enabled, time_limit_minutes, start_window, end_window
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9, $10, $11, $12, $13,
        $14, $15, $16, $17,
        $18, $19, $20, $21
      ) RETURNING *`, [
            courseId,
            title,
            image,
            questionsCount,
            duration,
            totalGrade,
            isVisible,
            createdBy,
            normalizedShowAt,
            normalizedHideAt,
            normalizedLockNextLectures,
            normalizedShowAnswersImmediately,
            normalizedShowAnswersAfterHours,
            normalizedAllowMultipleAttempts,
            normalizedAttemptLimit,
            normalizedShowAnswersLater,
            normalizedAnswersReleaseDate,
            normalizedTimeLimitEnabled,
            normalizedTimeLimitMinutes,
            normalizedStartWindow,
            normalizedEndWindow,
        ]);
        return res.rows[0];
    }
    static async updateCourseExamSettings(examId, settings) {
        const providedKeys = Object.keys(settings).filter((key) => settings[key] !== undefined);
        if (!providedKeys.length) {
            return null;
        }
        const examRes = await pool_1.default.query('SELECT * FROM course_exams WHERE id = $1', [examId]);
        if (!examRes.rowCount) {
            throw new Error('Course exam not found');
        }
        const exam = examRes.rows[0];
        const updateFields = [];
        const values = [];
        let paramIndex = 1;
        const futureSettings = {
            startWindow: exam.start_window,
            endWindow: exam.end_window,
            showAnswersLater: exam.show_answers_later,
            answersReleaseDate: exam.answers_release_date,
            timeLimitEnabled: exam.time_limit_enabled,
            timeLimitMinutes: exam.time_limit_minutes,
        };
        if (settings.showAt !== undefined) {
            const normalized = (0, courseExamSettings_1.toDateOrNullIfProvided)(settings.showAt, 'showAt');
            updateFields.push(`show_at = $${paramIndex++}`);
            values.push(normalized);
        }
        if (settings.hideAt !== undefined) {
            const normalized = (0, courseExamSettings_1.toDateOrNullIfProvided)(settings.hideAt, 'hideAt');
            updateFields.push(`hide_at = $${paramIndex++}`);
            values.push(normalized);
        }
        if (settings.lockNextLectures !== undefined) {
            updateFields.push(`lock_next_lectures = $${paramIndex++}`);
            values.push(!!settings.lockNextLectures);
        }
        if (settings.showAnswersImmediately !== undefined) {
            updateFields.push(`show_answers_immediately = $${paramIndex++}`);
            values.push(!!settings.showAnswersImmediately);
        }
        if (settings.showAnswersAfterHours !== undefined) {
            const normalized = (0, courseExamSettings_1.normalizeNonNegativeHoursIfProvided)(settings.showAnswersAfterHours, 'showAnswersAfterHours');
            if (normalized !== undefined) {
                updateFields.push(`show_answers_after_hours = $${paramIndex++}`);
                values.push(normalized);
            }
        }
        if (settings.allowMultipleAttempts !== undefined) {
            updateFields.push(`allow_multiple_attempts = $${paramIndex++}`);
            values.push(!!settings.allowMultipleAttempts);
        }
        if (settings.showAnswersLater !== undefined) {
            const normalized = !!settings.showAnswersLater;
            updateFields.push(`show_answers_later = $${paramIndex++}`);
            values.push(normalized);
            futureSettings.showAnswersLater = normalized;
        }
        if (settings.attemptLimit !== undefined) {
            if (settings.attemptLimit === null) {
                updateFields.push(`attempt_limit = $${paramIndex++}`);
                values.push(null);
            }
            else {
                const parsedLimit = Number(settings.attemptLimit);
                if (!Number.isInteger(parsedLimit) || parsedLimit <= 0) {
                    throw (0, courseExamSettings_1.buildValidationError)('attemptLimit must be a positive integer when provided');
                }
                updateFields.push(`attempt_limit = $${paramIndex++}`);
                values.push(parsedLimit);
            }
        }
        if (settings.answersReleaseDate !== undefined) {
            const normalized = (0, courseExamSettings_1.toDateOrNullIfProvided)(settings.answersReleaseDate, 'answersReleaseDate');
            updateFields.push(`answers_release_date = $${paramIndex++}`);
            values.push(normalized);
            futureSettings.answersReleaseDate = normalized ?? null;
        }
        if (settings.timeLimitEnabled !== undefined) {
            const normalized = !!settings.timeLimitEnabled;
            updateFields.push(`time_limit_enabled = $${paramIndex++}`);
            values.push(normalized);
            futureSettings.timeLimitEnabled = normalized;
        }
        if (settings.timeLimitMinutes !== undefined) {
            const normalized = (0, courseExamSettings_1.toNumberOrNullIfProvided)(settings.timeLimitMinutes, 'timeLimitMinutes');
            updateFields.push(`time_limit_minutes = $${paramIndex++}`);
            values.push(normalized);
            futureSettings.timeLimitMinutes = normalized ?? null;
        }
        if (settings.startWindow !== undefined) {
            const normalized = (0, courseExamSettings_1.toDateOrNullIfProvided)(settings.startWindow, 'startWindow');
            updateFields.push(`start_window = $${paramIndex++}`);
            values.push(normalized);
            futureSettings.startWindow = normalized ?? null;
        }
        if (settings.endWindow !== undefined) {
            const normalized = (0, courseExamSettings_1.toDateOrNullIfProvided)(settings.endWindow, 'endWindow');
            updateFields.push(`end_window = $${paramIndex++}`);
            values.push(normalized);
            futureSettings.endWindow = normalized ?? null;
        }
        if (!updateFields.length) {
            return examRes.rows[0];
        }
        if (futureSettings.timeLimitEnabled &&
            (!futureSettings.timeLimitMinutes || futureSettings.timeLimitMinutes <= 0)) {
            throw (0, courseExamSettings_1.buildValidationError)('Provide a positive timeLimitMinutes value when enabling the timer for course exam');
        }
        if (futureSettings.showAnswersLater && !futureSettings.answersReleaseDate) {
            throw (0, courseExamSettings_1.buildValidationError)('answersReleaseDate is required when showAnswersLater is enabled for course exam');
        }
        if (futureSettings.startWindow &&
            futureSettings.endWindow &&
            futureSettings.startWindow.getTime() > futureSettings.endWindow.getTime()) {
            throw (0, courseExamSettings_1.buildValidationError)('startWindow must be earlier than endWindow');
        }
        updateFields.push(`updated_at = NOW()`);
        values.push(examId);
        const result = await pool_1.default.query(`UPDATE course_exams SET ${updateFields.join(', ')} WHERE id = $${paramIndex++} RETURNING *`, values);
        return result.rows[0];
    }
    static async getCourseExams(courseId) {
        const res = await pool_1.default.query(`SELECT * FROM course_exams WHERE course_id = $1 ORDER BY created_at DESC`, [courseId]);
        return res.rows;
    }
    static async getVisibleCourseExams(courseId) {
        const res = await pool_1.default.query(`SELECT * FROM course_exams WHERE course_id = $1 AND is_visible = true ORDER BY created_at DESC`, [courseId]);
        return res.rows;
    }
    static async addQuestionsFromBank({ examId, questionIds, }) {
        // احسب آخر position
        const posRes = await pool_1.default.query('SELECT COALESCE(MAX(position), 0) AS max_pos FROM course_exam_questions WHERE course_exam_id = $1', [examId]);
        let pos = posRes.rows[0].max_pos;
        for (const qid of questionIds) {
            pos++;
            await pool_1.default.query(`INSERT INTO course_exam_questions (course_exam_id, question_id, position, grade) VALUES ($1, $2, $3, 1)`, [examId, qid, pos]);
        }
    }
    static async bulkAddQuestions({ examId, questions, }) {
        const insertedQuestionIds = [];
        // احسب آخر position
        const posRes = await pool_1.default.query('SELECT COALESCE(MAX(position), 0) AS max_pos FROM course_exam_questions WHERE course_exam_id = $1', [examId]);
        let pos = posRes.rows[0].max_pos;
        for (const q of questions) {
            // أضف السؤال
            const qRes = await pool_1.default.query(`INSERT INTO questions (text, type, image) VALUES ($1, 'single_choice', $2) RETURNING id`, [q.text, q.image ?? null]);
            const questionId = qRes.rows[0].id;
            insertedQuestionIds.push(questionId);
            // أضف الاختيارات
            for (const choice of q.choices) {
                await pool_1.default.query(`INSERT INTO question_choices (question_id, text, is_correct) VALUES ($1, $2, $3)`, [questionId, choice.text, choice.is_correct]);
            }
            pos++;
            await pool_1.default.query(`INSERT INTO course_exam_questions (course_exam_id, question_id, position, grade) VALUES ($1, $2, $3, 1)`, [examId, questionId, pos]);
        }
        return { inserted: insertedQuestionIds.length, questionIds: insertedQuestionIds };
    }
    static async bulkAddQuestionsFromText({ examId, bulkText, }) {
        // Normalize text
        const normalizedText = bulkText.replace(/\r\n/g, '\n').trim();
        const parsedQuestions = this.parseQuestionsFromText(normalizedText);
        if (!parsedQuestions.length) {
            throw new Error('لم يتم العثور على أي أسئلة في النص. تأكد من استخدام تنسيق صحيح لكل سؤال مع الاختيارات A/B/C/D.');
        }
        await this.bulkAddQuestions({ examId, questions: parsedQuestions });
        return { success: true, inserted: parsedQuestions.length };
    }
    static parseQuestionsFromText(text) {
        if (!text) {
            return [];
        }
        const structuredSplit = text
            .split(/\n\s*\n/)
            .map((block) => block.trim())
            .filter(Boolean);
        const questions = [];
        const invalidBlocks = [];
        structuredSplit.forEach((block, idx) => {
            const lines = block
                .split('\n')
                .map((line) => line.trim())
                .filter(Boolean);
            if (!lines.length) {
                return;
            }
            const questionText = lines[0];
            const choices = [];
            for (let i = 1; i < lines.length && choices.length < 4; i++) {
                const sanitized = lines[i];
                const labeledChoice = sanitized.match(/^[A-D][).:,-]?\s*(.+)$/i);
                choices.push({
                    text: (labeledChoice ? labeledChoice[1] : sanitized).trim(),
                    is_correct: false,
                });
            }
            if (questionText && choices.length === 4) {
                questions.push({ text: questionText, choices });
            }
            else if (lines.length) {
                invalidBlocks.push(idx + 1);
            }
        });
        if (invalidBlocks.length && structuredSplit.length) {
            throw new Error(`هناك مشكلة في الأسئلة التالية: ${invalidBlocks.join(', ')}. تأكد أن كل سؤال يحتوي على نص وأربع اختيارات.`);
        }
        if (questions.length) {
            return questions;
        }
        // Fallback parser for المتسلسلة without new lines (e.g. "Question A)... D) ... Question...")
        const compactPattern = /(?<question>[\s\S]+?)A[).:,-]?\s*(?<choiceA>[\s\S]+?)B[).:,-]?\s*(?<choiceB>[\s\S]+?)C[).:,-]?\s*(?<choiceC>[\s\S]+?)D[).:,-]?\s*(?<choiceD>[\s\S]+?)(?=(?:\s+[A-Za-z].+?A[).:,-]?)|$)/g;
        const compactMatches = [...text.matchAll(compactPattern)];
        const compactQuestions = compactMatches
            .map((match) => {
            const groups = match.groups;
            if (!groups)
                return null;
            const questionText = groups.question?.trim();
            const choiceA = groups.choiceA?.trim();
            const choiceB = groups.choiceB?.trim();
            const choiceC = groups.choiceC?.trim();
            const choiceD = groups.choiceD?.trim();
            if (!questionText || !choiceA || !choiceB || !choiceC || !choiceD) {
                return null;
            }
            return {
                text: questionText,
                choices: [
                    { text: choiceA, is_correct: false },
                    { text: choiceB, is_correct: false },
                    { text: choiceC, is_correct: false },
                    { text: choiceD, is_correct: false },
                ],
            };
        })
            .filter(Boolean);
        return compactQuestions;
    }
    static async addImageQuestionToCourseExam({ examId, text, imageUrl, choices, }) {
        const posRes = await pool_1.default.query('SELECT COALESCE(MAX(position), 0) AS max_pos FROM course_exam_questions WHERE course_exam_id = $1', [examId]);
        const nextPosition = Number(posRes.rows[0].max_pos) + 1;
        const qRes = await pool_1.default.query(`INSERT INTO questions (text, type, image) VALUES ($1, 'single_choice', $2) RETURNING id`, [text ?? '', imageUrl]);
        const questionId = qRes.rows[0].id;
        for (const choice of choices) {
            await pool_1.default.query(`INSERT INTO question_choices (question_id, text, is_correct) VALUES ($1, $2, $3)`, [questionId, choice.text, choice.is_correct]);
        }
        await pool_1.default.query(`INSERT INTO course_exam_questions (course_exam_id, question_id, position, grade) VALUES ($1, $2, $3, 1)`, [examId, questionId, nextPosition]);
        return questionId;
    }
    static async bulkAddImageQuestionsToCourseExam({ examId, questions, }) {
        if (!questions.length) {
            return { inserted: 0, questionIds: [] };
        }
        const defaultChoices = [
            { text: 'A', is_correct: false },
            { text: 'B', is_correct: false },
            { text: 'C', is_correct: false },
            { text: 'D', is_correct: false },
        ];
        const posRes = await pool_1.default.query('SELECT COALESCE(MAX(position), 0) AS max_pos FROM course_exam_questions WHERE course_exam_id = $1', [examId]);
        let position = Number(posRes.rows[0].max_pos);
        const insertedQuestionIds = [];
        for (const question of questions) {
            const qRes = await pool_1.default.query(`INSERT INTO questions (text, type, image) VALUES ($1, 'single_choice', $2) RETURNING id`, [question.text ?? '', question.imageUrl]);
            const questionId = qRes.rows[0].id;
            insertedQuestionIds.push(questionId);
            for (const choice of defaultChoices) {
                await pool_1.default.query(`INSERT INTO question_choices (question_id, text, is_correct) VALUES ($1, $2, $3)`, [questionId, choice.text, choice.is_correct]);
            }
            position += 1;
            await pool_1.default.query(`INSERT INTO course_exam_questions (course_exam_id, question_id, position, grade) VALUES ($1, $2, $3, 1)`, [examId, questionId, position]);
        }
        return { inserted: insertedQuestionIds.length, questionIds: insertedQuestionIds };
    }
    static async getCourseExamQuestions(examId) {
        // جلب الأسئلة المرتبطة بالامتحان مع ترتيبها
        const qRes = await pool_1.default.query(`SELECT q.id, q.text, q.type, q.image, ceq.position
       FROM course_exam_questions ceq
       JOIN questions q ON ceq.question_id = q.id
       WHERE ceq.course_exam_id = $1
       ORDER BY ceq.position, ceq.id`, [examId]);
        const questions = qRes.rows;
        // جلب كل الاختيارات دفعة واحدة
        const questionIds = questions.map((q) => q.id);
        const choicesMap = {};
        if (questionIds.length) {
            const chRes = await pool_1.default.query(`SELECT * FROM question_choices WHERE question_id = ANY($1::int[])`, [questionIds]);
            for (const ch of chRes.rows) {
                if (!choicesMap[ch.question_id])
                    choicesMap[ch.question_id] = [];
                choicesMap[ch.question_id].push({ id: ch.id, text: ch.text, is_correct: ch.is_correct });
            }
        }
        return questions.map((q) => ({
            id: q.id,
            text: q.text,
            type: q.type,
            image: decodeURIComponent(q.image),
            position: q.position,
            choices: choicesMap[q.id] || [],
        }));
    }
    // حذف سؤال من امتحان الكورس الشامل
    static async deleteCourseExamQuestion(questionId) {
        // حذف الاختيارات أولاً
        await pool_1.default.query(`DELETE FROM question_choices WHERE question_id = $1`, [questionId]);
        // حذف السؤال من جدول course_exam_questions
        await pool_1.default.query(`DELETE FROM course_exam_questions WHERE question_id = $1`, [questionId]);
        // حذف السؤال نفسه
        const result = await pool_1.default.query(`DELETE FROM questions WHERE id = $1 RETURNING *`, [
            questionId,
        ]);
        if (!result.rowCount) {
            throw new Error('السؤال غير موجود');
        }
        return { message: 'تم حذف السؤال بنجاح' };
    }
    // تعديل نص سؤال أو اختياراته أو صورته في امتحان الكورس الشامل (كل سؤال بدرجة واحدة)
    static async updateCourseExamQuestion(questionId, text, grade, choices, image) {
        if (!text && !choices && !image) {
            throw new Error('يجب إرسال نص السؤال أو الاختيارات أو الصورة للتعديل');
        }
        // تحديث نص السؤال
        if (text !== undefined) {
            await pool_1.default.query(`UPDATE questions SET text = $1 WHERE id = $2`, [text, questionId]);
        }
        // تحديث صورة السؤال
        if (image !== undefined) {
            await pool_1.default.query(`UPDATE questions SET image = $1 WHERE id = $2`, [image, questionId]);
        }
        // تحديث الدرجة إلى 1 دائماً (كل سؤال بدرجة واحدة)
        await pool_1.default.query(`UPDATE course_exam_questions SET grade = 1 WHERE question_id = $1`, [
            questionId,
        ]);
        // تحديث الاختيارات
        if (Array.isArray(choices)) {
            // حذف الاختيارات القديمة
            await pool_1.default.query(`DELETE FROM question_choices WHERE question_id = $1`, [questionId]);
            // إضافة الاختيارات الجديدة
            for (const choice of choices) {
                await pool_1.default.query(`INSERT INTO question_choices (question_id, text, is_correct) VALUES ($1, $2, $3)`, [questionId, choice.text, !!choice.is_correct]);
            }
        }
        return { message: 'تم تحديث السؤال بنجاح' };
    }
    // تحديد الإجابة الصحيحة لسؤال في امتحان الكورس الشامل
    static async setCourseExamQuestionCorrectAnswer(questionId, correctChoiceId) {
        // اجلب كل الاختيارات لهذا السؤال
        const choicesRes = await pool_1.default.query(`SELECT id FROM question_choices WHERE question_id = $1`, [
            questionId,
        ]);
        if (!choicesRes.rowCount) {
            throw new Error('لا يوجد اختيارات لهذا السؤال');
        }
        // عيّن جميع الاختيارات is_correct = false
        await pool_1.default.query(`UPDATE question_choices SET is_correct = false WHERE question_id = $1`, [
            questionId,
        ]);
        // عيّن الاختيار الصحيح فقط
        const updateRes = await pool_1.default.query(`UPDATE question_choices SET is_correct = true WHERE id = $1 AND question_id = $2 RETURNING *`, [correctChoiceId, questionId]);
        if (!updateRes.rowCount) {
            throw new Error('لم يتم العثور على الاختيار الصحيح لهذا السؤال');
        }
        return { message: 'تم تحديث الإجابة الصحيحة بنجاح' };
    }
    // تصحيح امتحان الكورس الشامل للطالب
    static async submitCourseExam(examId, studentId, answers) {
        // جلب بيانات الامتحان والكورس
        const examInfoRes = await pool_1.default.query(`SELECT ce.id as exam_id, ce.course_id, ce.total_grade, ce.allow_multiple_attempts, ce.attempt_limit
       FROM course_exams ce
       WHERE ce.id = $1`, [examId]);
        if (!examInfoRes.rowCount) {
            throw new Error('امتحان الكورس غير موجود');
        }
        const { course_id, allow_multiple_attempts, attempt_limit } = examInfoRes.rows[0];
        // تحقق من اشتراك الطالب في الكورس
        const enrollRes = await pool_1.default.query('SELECT 1 FROM enrollments WHERE user_id = $1 AND course_id = $2', [studentId, course_id]);
        if (!enrollRes.rowCount) {
            const err = new Error('غير مسموح لك بحل هذا الامتحان. يجب أن تكون مشتركاً في الكورس.');
            err.status = 403;
            throw err;
        }
        // جلب جميع الأسئلة واختياراتها
        const questionsRes = await pool_1.default.query(`SELECT ceq.question_id, q.text as question_text, q.image as question_image, qc.id as choice_id, qc.text as choice_text, qc.is_correct
       FROM course_exam_questions ceq
       JOIN questions q ON ceq.question_id = q.id
       LEFT JOIN question_choices qc ON ceq.question_id = qc.question_id
       WHERE ceq.course_exam_id = $1
       ORDER BY ceq.position, ceq.question_id, qc.id`, [examId]);
        if (!questionsRes.rowCount) {
            throw new Error('لا يوجد أسئلة لهذا الامتحان');
        }
        // بناء خريطة الأسئلة
        const questionsMap = new Map();
        questionsRes.rows.forEach((row) => {
            if (!questionsMap.has(row.question_id)) {
                questionsMap.set(row.question_id, {
                    id: row.question_id,
                    text: row.question_text,
                    image: row.question_image,
                    choices: [],
                });
            }
            if (row.choice_id) {
                questionsMap.get(row.question_id).choices.push({
                    id: row.choice_id,
                    text: row.choice_text,
                    is_correct: row.is_correct,
                });
            }
        });
        // التصحيح (كل سؤال بدرجة واحدة)
        let total = 0;
        let maxTotal = 0;
        const wrongQuestions = [];
        for (const [questionId, q] of questionsMap.entries()) {
            maxTotal += 1; // كل سؤال بدرجة واحدة
            const answer = answers.find((a) => a.questionId === questionId);
            const correctChoice = q.choices.find((c) => c.is_correct);
            if (answer && correctChoice && answer.choiceId === correctChoice.id) {
                total += 1; // كل سؤال صحيح بدرجة واحدة
            }
            else {
                wrongQuestions.push({
                    questionId,
                    questionText: q.text,
                    questionImage: q.image || null,
                    correctChoice: correctChoice ? { id: correctChoice.id, text: correctChoice.text } : null,
                    yourChoice: answer ? q.choices.find((c) => c.id === answer.choiceId) : null,
                });
            }
        }
        // احسب النجاح (من نصف الدرجة الكلية)
        const examFullGrade = maxTotal; // مجموع الدرجة = عدد الأسئلة
        const passed = total >= Math.ceil(examFullGrade / 2);
        const attemptLimitValue = attempt_limit !== null && attempt_limit !== undefined
            ? Number(attempt_limit)
            : allow_multiple_attempts
                ? null
                : 1;
        const existingSubmissionRes = await pool_1.default.query('SELECT id, attempts_count FROM course_exam_submissions WHERE exam_id = $1 AND student_id = $2', [examId, studentId]);
        const attemptsCount = existingSubmissionRes.rowCount
            ? Number(existingSubmissionRes.rows[0].attempts_count || 1)
            : 0;
        if (attemptLimitValue !== null && attemptsCount >= attemptLimitValue) {
            const err = new Error('You have used all allowed attempts for this exam.');
            err.status = 403;
            throw err;
        }
        const isNewSubmission = !existingSubmissionRes.rowCount;
        if (existingSubmissionRes.rowCount) {
            await pool_1.default.query('UPDATE course_exam_submissions SET total_grade = $1, passed = $2, submitted_at = NOW(), attempts_count = attempts_count + 1 WHERE exam_id = $3 AND student_id = $4', [total, passed, examId, studentId]);
        }
        else {
            await pool_1.default.query('INSERT INTO course_exam_submissions (exam_id, student_id, total_grade, passed, submitted_at, attempts_count) VALUES ($1, $2, $3, $4, NOW(), 1)', [examId, studentId, total, passed]);
        }
        // إضافة نقاط الامتحان (من 20 نقطة حسب النسبة) - فقط للإدخال الجديد
        if (isNewSubmission) {
            try {
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-expect-error
                const { StudentPointsService } = await import('./studentPoints');
                const examInfo = await pool_1.default.query('SELECT title FROM course_exams WHERE id = $1', [examId]);
                const examTitle = examInfo.rowCount ? examInfo.rows[0].title : null;
                // جلب obtained_grade إذا كان موجوداً
                const submissionInfo = await pool_1.default.query('SELECT COALESCE(obtained_grade, total_grade) as obtained_grade FROM course_exam_submissions WHERE exam_id = $1 AND student_id = $2', [examId, studentId]);
                const obtainedGrade = submissionInfo.rowCount
                    ? parseInt(submissionInfo.rows[0].obtained_grade)
                    : total;
                // التحقق من أن الطالب لم يحصل على نقاط لهذا الامتحان من قبل
                const hasPoints = await StudentPointsService.hasExamPoints(studentId, examId);
                if (!hasPoints) {
                    await StudentPointsService.addExamPoints(studentId, examId, obtainedGrade, examFullGrade, examTitle, 'course_exam');
                }
            }
            catch (error) {
                // لا نوقف العملية إذا فشل إضافة النقاط
                console.error('Error adding exam points:', error);
            }
        }
        return {
            success: true,
            totalGrade: total,
            maxGrade: examFullGrade,
            passed,
            wrongQuestions,
        };
    }
}
exports.ExamsService = ExamsService;
