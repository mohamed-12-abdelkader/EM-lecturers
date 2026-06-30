"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const express_1 = require("express");
const authentication_1 = require("../middleware/authentication");
const utils_1 = require("../utils");
const examFlow_1 = require("../services/examFlow");
const courseLevelExams_1 = require("../services/courseLevelExams");
const courseLevelExamQuestions_1 = require("../services/courseLevelExamQuestions");
const questionsManagement_1 = require("../services/questionsManagement");
const notifications_1 = require("../services/notifications");
const utils_2 = require("../utils");
const requestParsers_1 = require("../utils/requestParsers");
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const pool_1 = __importDefault(require("../db/pool"));
const teacherLibraryExamQuestions_1 = require("../services/teacherLibraryExamQuestions");
exports.router = (0, express_1.Router)();
// Configure multer for image uploads
const questionImageStorage = multer_1.default.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = 'uploads';
        if (!fs_1.default.existsSync(uploadDir)) {
            fs_1.default.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        cb(null, 'exam-question-' + uniqueSuffix + path_1.default.extname(file.originalname));
    },
});
const uploadQuestionImage = (0, multer_1.default)({
    storage: questionImageStorage,
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB limit
    },
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif|webp/;
        const extname = allowedTypes.test(path_1.default.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        if (mimetype && extname) {
            return cb(null, true);
        }
        else {
            cb(new Error('Only image files are allowed'));
        }
    },
});
const parseTimestampOrNull = (value, field) => {
    const parsed = (0, requestParsers_1.parseDateInput)(value);
    if (parsed === undefined) {
        return null;
    }
    if (parsed === null) {
        return null;
    }
    const date = new Date(parsed);
    if (Number.isNaN(date.getTime())) {
        throw new utils_2.HttpError(400, `${field} must be a valid ISO date`);
    }
    return date;
};
const parseRequiredPositiveNumber = (value, field) => {
    const parsed = (0, requestParsers_1.parseNumberInput)(value);
    if (parsed === undefined || parsed === null) {
        throw new utils_2.HttpError(400, `${field} is required`);
    }
    const numericValue = Number(parsed);
    if (!Number.isFinite(numericValue)) {
        throw new utils_2.HttpError(400, `${field} must be a valid number`);
    }
    if (numericValue <= 0) {
        throw new utils_2.HttpError(400, `${field} must be greater than 0`);
    }
    return numericValue;
};
exports.router.post('/', (0, authentication_1.authMiddleware)(['teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const rawCourseId = (0, requestParsers_1.pickBodyValue)(req.body, 'courseId', 'course_id');
    const rawLectureId = (0, requestParsers_1.pickBodyValue)(req.body, 'lectureId', 'lecture_id');
    // Determine if this is a course-level exam or lecture exam
    const isCourseLevelExam = rawCourseId !== undefined;
    const isLectureExam = rawLectureId !== undefined;
    if (!isCourseLevelExam && !isLectureExam) {
        throw new utils_2.HttpError(400, 'Either courseId (for course-level exam) or lectureId (for lecture exam) is required');
    }
    // Handle course-level exam
    if (isCourseLevelExam) {
        const titleInput = typeof req.body.title === 'string' ? req.body.title.trim() : '';
        if (!titleInput) {
            throw new utils_2.HttpError(400, 'title is required');
        }
        const courseIdParsed = (0, requestParsers_1.parseNumberInput)(rawCourseId);
        if (courseIdParsed === undefined || courseIdParsed === null) {
            throw new utils_2.HttpError(400, 'courseId is required');
        }
        const courseId = Number(courseIdParsed);
        if (!Number.isInteger(courseId) || courseId <= 0) {
            throw new utils_2.HttpError(400, 'courseId must be a valid positive integer');
        }
        const durationMinutes = parseRequiredPositiveNumber((0, requestParsers_1.pickBodyValue)(req.body, 'durationMinutes', 'duration_minutes'), 'durationMinutes');
        const questionsCount = parseRequiredPositiveNumber((0, requestParsers_1.pickBodyValue)(req.body, 'questionsCount', 'questions_count'), 'questionsCount');
        const isVisibleInput = (0, requestParsers_1.parseBooleanInput)((0, requestParsers_1.pickBodyValue)(req.body, 'isVisibleToStudents', 'is_visible_to_students'));
        const isVisibleToStudents = isVisibleInput ?? true;
        const visibilityEndDate = parseTimestampOrNull((0, requestParsers_1.pickBodyValue)(req.body, 'visibilityEndDate', 'visibility_end_date'), 'visibilityEndDate');
        if (!isVisibleToStudents && !visibilityEndDate) {
            throw new utils_2.HttpError(400, 'visibilityEndDate is required when isVisibleToStudents is false');
        }
        const showAnswersInput = (0, requestParsers_1.parseBooleanInput)((0, requestParsers_1.pickBodyValue)(req.body, 'showAnswersImmediately', 'show_answers_immediately'));
        const showAnswersImmediately = showAnswersInput ?? true;
        const answersVisibleAt = parseTimestampOrNull((0, requestParsers_1.pickBodyValue)(req.body, 'answersVisibleAt', 'answers_visible_at'), 'answersVisibleAt');
        if (!showAnswersImmediately && !answersVisibleAt) {
            throw new utils_2.HttpError(400, 'answersVisibleAt is required when showAnswersImmediately is false');
        }
        const isActiveInput = (0, requestParsers_1.parseBooleanInput)((0, requestParsers_1.pickBodyValue)(req.body, 'isActive', 'is_active'));
        const isActive = isActiveInput ?? true;
        // Parse attemptLimit (optional, can be null for unlimited)
        const rawAttemptLimit = (0, requestParsers_1.pickBodyValue)(req.body, 'attemptLimit', 'attempt_limit');
        let attemptLimit = undefined;
        if (rawAttemptLimit !== undefined) {
            if (rawAttemptLimit === null || rawAttemptLimit === 'null' || rawAttemptLimit === '') {
                attemptLimit = null; // Unlimited attempts
            }
            else {
                const parsed = (0, requestParsers_1.parseNumberInput)(rawAttemptLimit);
                if (parsed !== undefined && parsed !== null) {
                    const numValue = Number(parsed);
                    if (!Number.isInteger(numValue) || numValue <= 0) {
                        throw new utils_2.HttpError(400, 'attemptLimit must be a positive integer');
                    }
                    attemptLimit = numValue;
                }
            }
        }
        const exam = await courseLevelExams_1.CourseLevelExamsService.createExam(req.user, {
            title: titleInput,
            courseId,
            durationMinutes,
            questionsCount,
            isVisibleToStudents,
            visibilityEndDate,
            showAnswersImmediately,
            answersVisibleAt,
            isActive,
            attemptLimit,
        });
        // إرسال إشعار مباشر للطلاب المشتركين في الكورس
        if (isVisibleToStudents) {
            try {
                console.log(`📝 [Exam] Creating course-level exam ${exam.id} for course ${courseId}`);
                const courseInfo = await pool_1.default.query('SELECT title FROM courses WHERE id = $1', [courseId]);
                const courseTitle = courseInfo.rowCount ? courseInfo.rows[0].title : 'الكورس';
                const result = await notifications_1.NotificationService.notifyExamAdded(courseId, undefined, // lectureId - null for course-level exam
                exam.id, titleInput, undefined, // lectureTitle
                courseTitle);
                console.log(`✅ [Exam] Notification result:`, result);
            }
            catch (notifError) {
                console.error('❌ [Exam] Error sending exam notification:', notifError);
                // لا نوقف العملية إذا فشل الإشعار
            }
        }
        else {
            console.log(`⚠️ [Exam] Exam ${exam.id} is not visible to students, skipping notification`);
        }
        return res.status(201).json({ exam });
    }
    // Handle lecture exam (existing logic)
    if (isLectureExam) {
        const teacherId = req.user.id;
        const rawType = (0, requestParsers_1.pickBodyValue)(req.body, 'type', 'examType', 'exam_type');
        const exam = await examFlow_1.ExamFlowService.createExam(teacherId, {
            lectureId: Number(rawLectureId),
            type: typeof rawType === 'string' ? rawType : undefined,
            title: req.body.title,
            totalGrade: req.body.totalGrade,
            duration: req.body.duration,
            isVisible: req.body.isVisible,
            showAt: req.body.showAt,
            hideAt: req.body.hideAt,
            lockNextLectures: req.body.lockNextLectures,
            showAnswersImmediately: req.body.showAnswersImmediately,
            showAnswersAfterHours: req.body.showAnswersAfterHours,
            allowMultipleAttempts: req.body.allowMultipleAttempts,
            showAnswersLater: req.body.showAnswersLater,
            answersReleaseDate: req.body.answersReleaseDate,
            timeLimitEnabled: req.body.timeLimitEnabled,
            timeLimitMinutes: req.body.timeLimitMinutes,
            startWindow: req.body.startWindow,
            endWindow: req.body.endWindow,
        });
        // إرسال إشعار مباشر للطلاب المشتركين في الكورس
        const isVisible = req.body.isVisible !== false && req.body.isVisible !== 'false';
        if (isVisible) {
            try {
                console.log(`📝 [Exam] Creating lecture exam ${exam.id} for lecture ${Number(rawLectureId)}`);
                const lectureInfo = await pool_1.default.query(`SELECT l.title as lecture_title, c.id as course_id, c.title as course_title
             FROM lectures l
             JOIN courses c ON l.course_id = c.id
             WHERE l.id = $1`, [Number(rawLectureId)]);
                if (lectureInfo.rowCount) {
                    const result = await notifications_1.NotificationService.notifyExamAdded(lectureInfo.rows[0].course_id, Number(rawLectureId), exam.id, req.body.title || 'Lecture Exam', lectureInfo.rows[0].lecture_title, lectureInfo.rows[0].course_title);
                    console.log(`✅ [Exam] Notification result:`, result);
                }
                else {
                    console.log(`⚠️ [Exam] Lecture ${Number(rawLectureId)} not found`);
                }
            }
            catch (notifError) {
                console.error('❌ [Exam] Error sending exam notification:', notifError);
                // لا نوقف العملية إذا فشل الإشعار
            }
        }
        else {
            console.log(`⚠️ [Exam] Exam ${exam.id} is not visible to students, skipping notification`);
        }
        return res.status(201).json({ exam });
    }
}));
// Course-level exams routes (must be before /:examId to avoid conflicts)
exports.router.get('/course/:courseId', (0, authentication_1.authMiddleware)(['teacher', 'admin']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const courseId = Number(req.params.courseId);
    if (Number.isNaN(courseId)) {
        return res.status(400).json({ message: 'Invalid course id' });
    }
    const exams = await courseLevelExams_1.CourseLevelExamsService.getExamsByCourse(courseId, req.user);
    res.json({ exams });
}));
exports.router.get('/teacher', (0, authentication_1.authMiddleware)(['teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const exams = await courseLevelExams_1.CourseLevelExamsService.getExamsByTeacher(req.user.id);
    res.json({ success: true, total: exams.length, exams });
}));
// POST /api/exams/lecture/:examId/questions/bulk — إضافة مجموعة أسئلة بنص واحد لامتحان المحاضرة (نفس صيغة امتحان الكورس: سؤال ثم a. b. c. d.)
exports.router.post('/lecture/:examId/questions/bulk', (0, authentication_1.authMiddleware)(['teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const examId = Number(req.params.examId);
    if (Number.isNaN(examId)) {
        return res.status(400).json({ message: 'Invalid exam id' });
    }
    const body = req.body;
    const bulkText = typeof body.text === 'string'
        ? body.text
        : typeof body.questionText === 'string'
            ? body.questionText
            : null;
    if (!bulkText || !bulkText.trim()) {
        return res.status(400).json({
            message: 'text or questionText مطلوب (نص الأسئلة بصيغة: سؤال ثم a. b. c. d.)',
        });
    }
    const parsed = courseLevelExamQuestions_1.CourseLevelExamQuestionsService.parseBulkQuestionText(bulkText.trim(), Array.isArray(body.correctAnswers) ? body.correctAnswers : undefined);
    if (parsed.length === 0) {
        return res.status(400).json({
            message: 'لم يتم العثور على أسئلة بصيغة صحيحة. كل سؤال يحتاج نص السؤال ثم أربعة أسطر: a. b. c. d.',
        });
    }
    try {
        const result = await questionsManagement_1.QuestionsManagementService.createBulkQuestionsForLectureExamFromParsed(examId, req.user.id, parsed);
        return res.status(201).json({
            message: `تمت إضافة ${result.inserted} سؤال`,
            count: result.inserted,
            questions: result.questions,
            examId: result.examId,
        });
    }
    catch (error) {
        if (error.message) {
            return res.status(400).json({ message: error.message });
        }
        console.error('Error creating lecture exam questions from bulk text:', error);
        return res.status(500).json({ message: 'Failed to create questions' });
    }
}));
// POST /api/exams/lecture/:examId/questions/passage/bulk
// إضافة قطعة + مجموعة أسئلة MCQ بنص واحد لامتحان المحاضرة
// Body:
// {
//   "content": "نص القطعة ...",
//   "title": "اختياري",
//   "text": "1- السؤال...\n(أ) ...\n(ب) ...\n(ج) ...\n(د) ...\n\n2- ..."
// }
exports.router.post('/lecture/:examId/questions/passage/bulk', (0, authentication_1.authMiddleware)(['teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const examId = Number(req.params.examId);
    if (Number.isNaN(examId)) {
        return res.status(400).json({ message: 'Invalid exam id' });
    }
    const body = req.body;
    const passageContent = String(body.content ?? body.passage ?? '').trim();
    if (!passageContent) {
        return res.status(400).json({ message: 'content (or passage) is required' });
    }
    const bulkText = typeof body.text === 'string'
        ? body.text
        : typeof body.questionText === 'string'
            ? body.questionText
            : typeof body.questionsBulkText === 'string'
                ? body.questionsBulkText
                : typeof body.bulkQuestionsText === 'string'
                    ? body.bulkQuestionsText
                    : typeof body.mcqText === 'string'
                        ? body.mcqText
                        : '';
    if (!bulkText.trim()) {
        return res.status(400).json({
            message: 'text (or questionText/questionsBulkText/bulkQuestionsText/mcqText) is required',
        });
    }
    const parsed = examFlow_1.ExamFlowService.parsePassageMcqBulkText(bulkText);
    if (parsed.length === 0) {
        return res.status(400).json({
            message: 'لم يتم العثور على أسئلة بصيغة صحيحة. كل سؤال يحتاج نص السؤال ثم أربعة اختيارات (أ/ب/ج/د) أو (A/B/C/D).',
        });
    }
    const result = await examFlow_1.ExamFlowService.createPassageWithQuestionsForExam(req.user.id, examId, {
        title: body.title,
        content: passageContent,
        questions: parsed,
    });
    return res.status(201).json({
        message: `تم إنشاء القطعة وإضافة ${result.added} سؤال للامتحان`,
        examId,
        passage: result.passage,
        questionIds: result.questionIds,
        examQuestionIds: result.examQuestionIds,
        added: result.added,
    });
}));
// GET /api/exams/teacher/lecture-exams - كل امتحانات المحاضرات للمدرس
exports.router.get('/teacher/lecture-exams', (0, authentication_1.authMiddleware)(['teacher', 'admin']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const teacherId = req.user.role === 'admin'
        ? (0, requestParsers_1.parseNumberInput)(req.query.teacher_id) ?? req.user.id
        : req.user.id;
    const courseId = (0, requestParsers_1.parseNumberInput)(req.query.course_id);
    const lectureId = (0, requestParsers_1.parseNumberInput)(req.query.lecture_id);
    const type = typeof req.query.type === 'string' ? req.query.type : undefined;
    const exams = await examFlow_1.ExamFlowService.getExamsByTeacher(teacherId, {
        courseId: courseId ?? undefined,
        lectureId: lectureId ?? undefined,
        type,
    });
    res.json({
        success: true,
        total: exams.length,
        exams,
        filters: {
            teacherId,
            courseId: courseId ?? null,
            lectureId: lectureId ?? null,
            type: type ?? 'all',
        },
    });
}));
// Get exam grades for all students (teacher only)
exports.router.get('/:examId/grades', (0, authentication_1.authMiddleware)(['teacher', 'admin']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const examId = Number(req.params.examId);
    if (Number.isNaN(examId)) {
        return res.status(400).json({ message: 'Invalid exam id' });
    }
    const result = await courseLevelExams_1.CourseLevelExamsService.getExamGrades(examId, req.user);
    res.json(result);
}));
// Get detailed exam report with question statistics (teacher only)
exports.router.get('/:examId/report', (0, authentication_1.authMiddleware)(['teacher', 'admin']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const examId = Number(req.params.examId);
    if (Number.isNaN(examId)) {
        return res.status(400).json({ message: 'Invalid exam id' });
    }
    // Try course-level exam first
    try {
        const result = await courseLevelExams_1.CourseLevelExamsService.getExamReport(examId, req.user);
        return res.json(result);
    }
    catch (error) {
        // If not found or not course-level exam, try lecture exam
        if (error.status === 404 || error.status === 403) {
            try {
                const report = await examFlow_1.ExamFlowService.getExamQuestionReport(examId, {
                    id: req.user.id,
                    role: req.user.role,
                });
                return res.json(report);
            }
            catch (lectureError) {
                if (lectureError.status) {
                    return res.status(lectureError.status).json({ message: lectureError.message });
                }
                console.error('Error fetching lecture exam report:', lectureError);
                return res.status(500).json({ message: 'Failed to fetch exam report' });
            }
        }
        // Re-throw other errors
        if (error.status) {
            return res.status(error.status).json({ message: error.message });
        }
        console.error('Error fetching course-level exam report:', error);
        return res.status(500).json({ message: 'Failed to fetch exam report' });
    }
}));
exports.router.get('/:examId', (0, authentication_1.authMiddleware)(['teacher', 'student', 'admin']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const examId = Number(req.params.examId);
    if (Number.isNaN(examId)) {
        return res.status(400).json({ message: 'Invalid exam id' });
    }
    // Try course-level exam first
    try {
        const exam = await courseLevelExams_1.CourseLevelExamsService.getExamById(examId, req.user);
        return res.json({ exam });
    }
    catch (error) {
        // If not found or not course-level exam, try lecture exam
        if (error.status === 404) {
            const result = await examFlow_1.ExamFlowService.getExamForUser(examId, {
                id: req.user.id,
                role: req.user.role,
            });
            return res.json(result);
        }
        throw error;
    }
}));
exports.router.patch('/:examId', (0, authentication_1.authMiddleware)(['teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const examId = Number(req.params.examId);
    if (Number.isNaN(examId)) {
        return res.status(400).json({ message: 'Invalid exam id' });
    }
    const updateData = {};
    if (req.body.title !== undefined) {
        const titleInput = typeof req.body.title === 'string' ? req.body.title.trim() : '';
        if (!titleInput) {
            throw new utils_2.HttpError(400, 'title cannot be empty');
        }
        updateData.title = titleInput;
    }
    if (req.body.durationMinutes !== undefined || req.body.duration_minutes !== undefined) {
        const duration = parseRequiredPositiveNumber((0, requestParsers_1.pickBodyValue)(req.body, 'durationMinutes', 'duration_minutes'), 'durationMinutes');
        updateData.durationMinutes = duration;
    }
    if (req.body.questionsCount !== undefined || req.body.questions_count !== undefined) {
        const questionsCount = parseRequiredPositiveNumber((0, requestParsers_1.pickBodyValue)(req.body, 'questionsCount', 'questions_count'), 'questionsCount');
        updateData.questionsCount = questionsCount;
    }
    if (req.body.isVisibleToStudents !== undefined ||
        req.body.is_visible_to_students !== undefined) {
        const isVisible = (0, requestParsers_1.parseBooleanInput)((0, requestParsers_1.pickBodyValue)(req.body, 'isVisibleToStudents', 'is_visible_to_students'));
        if (isVisible === undefined) {
            throw new utils_2.HttpError(400, 'isVisibleToStudents must be a boolean');
        }
        updateData.isVisibleToStudents = isVisible;
    }
    if (req.body.visibilityEndDate !== undefined || req.body.visibility_end_date !== undefined) {
        const visibilityEndDate = parseTimestampOrNull((0, requestParsers_1.pickBodyValue)(req.body, 'visibilityEndDate', 'visibility_end_date'), 'visibilityEndDate');
        updateData.visibilityEndDate = visibilityEndDate;
    }
    if (req.body.showAnswersImmediately !== undefined ||
        req.body.show_answers_immediately !== undefined) {
        const showAnswers = (0, requestParsers_1.parseBooleanInput)((0, requestParsers_1.pickBodyValue)(req.body, 'showAnswersImmediately', 'show_answers_immediately'));
        if (showAnswers === undefined) {
            throw new utils_2.HttpError(400, 'showAnswersImmediately must be a boolean');
        }
        updateData.showAnswersImmediately = showAnswers;
    }
    if (req.body.answersVisibleAt !== undefined || req.body.answers_visible_at !== undefined) {
        const answersVisibleAt = parseTimestampOrNull((0, requestParsers_1.pickBodyValue)(req.body, 'answersVisibleAt', 'answers_visible_at'), 'answersVisibleAt');
        updateData.answersVisibleAt = answersVisibleAt;
    }
    if (req.body.isActive !== undefined || req.body.is_active !== undefined) {
        const isActive = (0, requestParsers_1.parseBooleanInput)((0, requestParsers_1.pickBodyValue)(req.body, 'isActive', 'is_active'));
        if (isActive === undefined) {
            throw new utils_2.HttpError(400, 'isActive must be a boolean');
        }
        updateData.isActive = isActive;
    }
    // Parse attemptLimit (optional, can be null for unlimited)
    const rawAttemptLimit = (0, requestParsers_1.pickBodyValue)(req.body, 'attemptLimit', 'attempt_limit');
    if (rawAttemptLimit !== undefined) {
        if (rawAttemptLimit === null || rawAttemptLimit === 'null' || rawAttemptLimit === '') {
            updateData.attemptLimit = null; // Unlimited attempts
        }
        else {
            const parsed = (0, requestParsers_1.parseNumberInput)(rawAttemptLimit);
            if (parsed !== undefined && parsed !== null) {
                const numValue = Number(parsed);
                if (!Number.isInteger(numValue) || numValue <= 0) {
                    throw new utils_2.HttpError(400, 'attemptLimit must be a positive integer');
                }
                updateData.attemptLimit = numValue;
            }
            else {
                throw new utils_2.HttpError(400, 'attemptLimit must be a positive integer or null');
            }
        }
    }
    try {
        const updatedExam = await courseLevelExams_1.CourseLevelExamsService.updateExam(examId, req.user, updateData);
        res.json({ exam: updatedExam });
    }
    catch (error) {
        if (error.status === 404 || error.status === 403) {
            return res.status(error.status).json({ message: error.message });
        }
        throw error;
    }
}));
exports.router.delete('/:examId', (0, authentication_1.authMiddleware)(['teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const examId = Number(req.params.examId);
    if (Number.isNaN(examId)) {
        return res.status(400).json({ message: 'Invalid exam id' });
    }
    try {
        const result = await courseLevelExams_1.CourseLevelExamsService.deleteExam(examId, req.user);
        res.json(result);
    }
    catch (error) {
        if (error.status === 404 || error.status === 403) {
            return res.status(error.status).json({ message: error.message });
        }
        throw error;
    }
}));
// Course-level exam questions routes (must be before /:examId to avoid conflicts)
// POST /api/exams/:examId/questions/from-bank — إضافة أسئلة من بنك الأسئلة للامتحان (course-exam أو lecture-exam)
// Body: { questionIds: number[], type?: "course-exam" } — إذا type = "course-exam" يعامل كامتحان كورس، وإلا امتحان محاضرة
exports.router.post('/:examId/questions/from-bank', (0, authentication_1.authMiddleware)(['teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const examId = Number(req.params.examId);
    if (Number.isNaN(examId) || examId <= 0) {
        return res.status(400).json({ message: 'Invalid exam id' });
    }
    const body = req.body;
    const questionIds = Array.isArray(body.questionIds)
        ? body.questionIds.map((id) => Number(id)).filter((n) => Number.isInteger(n) && n > 0)
        : [];
    if (questionIds.length === 0) {
        return res.status(400).json({ message: 'questionIds is required and must be a non-empty array of question IDs' });
    }
    const { missing } = await courseLevelExams_1.CourseLevelExamsService.validateQuestionIdsInBank(questionIds);
    if (missing.length > 0) {
        return res.status(400).json({
            message: 'Some question IDs were not found in the question bank',
            missingQuestionIds: missing,
        });
    }
    const isCourseExam = body.type === 'course-exam';
    if (isCourseExam) {
        try {
            await courseLevelExams_1.CourseLevelExamsService.getExamById(examId, req.user);
        }
        catch (err) {
            if (err?.status === 404) {
                return res.status(400).json({
                    message: 'Exam not found or is not a course-level exam. Use type "course-exam" only for course exams.',
                });
            }
            if (err?.status === 403) {
                return res.status(403).json({ message: err.message });
            }
            throw err;
        }
        let result;
        const client = await pool_1.default.connect();
        try {
            await client.query('BEGIN');
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-expect-error
            result = await courseLevelExams_1.CourseLevelExamsService.addQuestionsFromBank(req.user, examId, questionIds, client);
            await client.query('COMMIT');
        }
        catch (txErr) {
            await client.query('ROLLBACK').catch(() => { });
            throw txErr;
        }
        finally {
            client.release();
        }
        const addedBankIds = (result.addedQuestions || []).map((row) => row.question_id_v2 ?? row.question_id).filter((id) => id != null);
        const skippedQuestions = result.alreadyInExamIds ?? [];
        if (skippedQuestions.length > 0 && addedBankIds.length > 0) {
            return res.status(200).json({
                message: 'Some questions were skipped because they already exist',
                addedQuestions: addedBankIds,
                skippedQuestions,
                examId,
                examType: 'course-exam',
            });
        }
        if (skippedQuestions.length > 0 && addedBankIds.length === 0) {
            return res.status(200).json({
                message: 'Some questions were skipped because they already exist',
                addedQuestions: [],
                skippedQuestions,
                examId,
                examType: 'course-exam',
            });
        }
        return res.status(200).json({
            message: 'Questions added successfully',
            addedQuestions: addedBankIds,
            examId,
            examType: 'course-exam',
        });
    }
    // Lecture exam
    const lectureExam = await examFlow_1.ExamFlowService.getExamWithCourse(examId);
    if (!lectureExam) {
        return res.status(404).json({ message: 'Exam not found' });
    }
    if (lectureExam.teacher_id !== req.user.id) {
        return res.status(403).json({ message: 'You do not own this exam' });
    }
    const existingRes = await pool_1.default.query('SELECT question_id_v2, question_id FROM exam_questions WHERE exam_id = $1', [examId]);
    const existingV2 = new Set(existingRes.rows.map((r) => r.question_id_v2).filter((id) => id != null));
    const existingV1 = new Set(existingRes.rows.map((r) => r.question_id).filter((id) => id != null));
    const toAdd = questionIds.filter((id) => !existingV2.has(id) && !existingV1.has(id));
    const skippedQuestions = questionIds.filter((id) => existingV2.has(id) || existingV1.has(id));
    if (toAdd.length === 0) {
        return res.status(200).json({
            message: 'Some questions were skipped because they already exist',
            addedQuestions: [],
            skippedQuestions,
            examId,
            examType: 'lecture-exam',
        });
    }
    const result = await examFlow_1.ExamFlowService.addQuestionsFromBank(req.user.id, examId, toAdd);
    const addedBankIds = result.addedBankIds ?? [];
    if (skippedQuestions.length > 0) {
        return res.status(200).json({
            message: 'Some questions were skipped because they already exist',
            addedQuestions: addedBankIds,
            skippedQuestions,
            examId,
            examType: 'lecture-exam',
        });
    }
    return res.status(200).json({
        message: 'Questions added successfully',
        addedQuestions: addedBankIds,
        examId,
        examType: 'lecture-exam',
    });
}));
function parseTeacherLibraryBody(body) {
    const questionIds = Array.isArray(body.questionIds)
        ? body.questionIds.map((id) => Number(id)).filter((n) => Number.isInteger(n) && n > 0)
        : [];
    const lessonId = body.lessonId != null ? Number(body.lessonId) : null;
    const passageId = body.passageId != null ? Number(body.passageId) : null;
    return { questionIds, lessonId, passageId };
}
async function resolveTeacherLibraryQuestionIds(teacherId, body) {
    const { questionIds, lessonId, passageId } = parseTeacherLibraryBody(body);
    if (lessonId != null && Number.isInteger(lessonId) && lessonId > 0) {
        return teacherLibraryExamQuestions_1.TeacherLibraryExamQuestionsService.fetchLessonQuestionIds(teacherId, lessonId);
    }
    if (passageId != null && Number.isInteger(passageId) && passageId > 0) {
        return teacherLibraryExamQuestions_1.TeacherLibraryExamQuestionsService.fetchPassageQuestionIds(teacherId, passageId);
    }
    return questionIds;
}
// POST /api/exams/lecture/:examId/questions/from-teacher-library — امتحان المحاضرة
exports.router.post('/lecture/:examId/questions/from-teacher-library', (0, authentication_1.authMiddleware)(['teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const examId = Number(req.params.examId);
    if (Number.isNaN(examId) || examId <= 0) {
        return res.status(400).json({ message: 'Invalid exam id' });
    }
    const teacherId = req.user.id;
    const questionIds = await resolveTeacherLibraryQuestionIds(teacherId, req.body ?? {});
    if (!questionIds.length) {
        return res.status(400).json({
            message: 'Provide questionIds (non-empty array), or lessonId, or passageId from your question library',
        });
    }
    const { missing } = await teacherLibraryExamQuestions_1.TeacherLibraryExamQuestionsService.validateQuestionIds(teacherId, questionIds);
    if (missing.length) {
        return res.status(400).json({
            message: 'Some question IDs were not found in your question library',
            missingQuestionIds: missing,
        });
    }
    const result = await teacherLibraryExamQuestions_1.TeacherLibraryExamQuestionsService.addToLectureExam(teacherId, examId, questionIds);
    return res.status(200).json({
        message: result.addedCount > 0 ? 'Questions added successfully' : 'All selected questions already exist',
        examId,
        examType: 'lecture-exam',
        addedCount: result.addedCount,
        examQuestionIds: result.examQuestionIds,
        addedTeacherQuestionIds: result.addedTeacherQuestionIds,
        skippedTeacherQuestionIds: result.skippedTeacherQuestionIds,
    });
}));
// POST /api/exams/course-level/:examId/questions/from-teacher-library — امتحان الكورس العام
exports.router.post('/course-level/:examId/questions/from-teacher-library', (0, authentication_1.authMiddleware)(['teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const examId = Number(req.params.examId);
    if (Number.isNaN(examId) || examId <= 0) {
        return res.status(400).json({ message: 'Invalid exam id' });
    }
    const teacherId = req.user.id;
    const questionIds = await resolveTeacherLibraryQuestionIds(teacherId, req.body ?? {});
    if (!questionIds.length) {
        return res.status(400).json({
            message: 'Provide questionIds (non-empty array), or lessonId, or passageId from your question library',
        });
    }
    const { missing } = await teacherLibraryExamQuestions_1.TeacherLibraryExamQuestionsService.validateQuestionIds(teacherId, questionIds);
    if (missing.length) {
        return res.status(400).json({
            message: 'Some question IDs were not found in your question library',
            missingQuestionIds: missing,
        });
    }
    const client = await pool_1.default.connect();
    try {
        await client.query('BEGIN');
        const result = await teacherLibraryExamQuestions_1.TeacherLibraryExamQuestionsService.addToCourseExam(teacherId, examId, questionIds, client);
        await client.query('COMMIT');
        return res.status(200).json({
            message: result.addedCount > 0 ? 'Questions added successfully' : 'All selected questions already exist',
            examId,
            examType: 'course-exam',
            addedCount: result.addedCount,
            addedTeacherQuestionIds: result.addedTeacherQuestionIds,
            skippedTeacherQuestionIds: result.skippedTeacherQuestionIds,
            questions: result.addedQuestions,
        });
    }
    catch (err) {
        await client.query('ROLLBACK').catch(() => { });
        throw err;
    }
    finally {
        client.release();
    }
}));
// POST /api/exams/:examId/questions/from-teacher-library — إضافة من مكتبة أسئلة المدرس
// Body: { questionIds?: number[], lessonId?: number, passageId?: number, type?: "course-exam" }
exports.router.post('/:examId/questions/from-teacher-library', (0, authentication_1.authMiddleware)(['teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const examId = Number(req.params.examId);
    if (Number.isNaN(examId) || examId <= 0) {
        return res.status(400).json({ message: 'Invalid exam id' });
    }
    const teacherId = req.user.id;
    const questionIds = await resolveTeacherLibraryQuestionIds(teacherId, req.body ?? {});
    if (!questionIds.length) {
        return res.status(400).json({
            message: 'Provide questionIds (non-empty array), or lessonId, or passageId from your question library',
        });
    }
    const { missing } = await teacherLibraryExamQuestions_1.TeacherLibraryExamQuestionsService.validateQuestionIds(teacherId, questionIds);
    if (missing.length > 0) {
        return res.status(400).json({
            message: 'Some question IDs were not found in your question library',
            missingQuestionIds: missing,
        });
    }
    const isCourseExam = req.body?.type === 'course-exam';
    if (isCourseExam) {
        const client = await pool_1.default.connect();
        try {
            await client.query('BEGIN');
            const result = await teacherLibraryExamQuestions_1.TeacherLibraryExamQuestionsService.addToCourseExam(teacherId, examId, questionIds, client);
            await client.query('COMMIT');
            return res.status(200).json({
                message: result.skippedTeacherQuestionIds.length > 0 && result.addedCount > 0
                    ? 'Some questions were skipped because they already exist'
                    : result.addedCount > 0
                        ? 'Questions added successfully'
                        : 'All selected questions already exist in this exam',
                examId,
                examType: 'course-exam',
                addedCount: result.addedCount,
                addedTeacherQuestionIds: result.addedTeacherQuestionIds,
                skippedTeacherQuestionIds: result.skippedTeacherQuestionIds,
                questions: result.addedQuestions,
            });
        }
        catch (err) {
            await client.query('ROLLBACK').catch(() => { });
            throw err;
        }
        finally {
            client.release();
        }
    }
    const result = await teacherLibraryExamQuestions_1.TeacherLibraryExamQuestionsService.addToLectureExam(teacherId, examId, questionIds);
    return res.status(200).json({
        message: result.skippedTeacherQuestionIds.length > 0 && result.addedCount > 0
            ? 'Some questions were skipped because they already exist'
            : result.addedCount > 0
                ? 'Questions added successfully'
                : 'All selected questions already exist in this exam',
        examId,
        examType: 'lecture-exam',
        addedCount: result.addedCount,
        examQuestionIds: result.examQuestionIds,
        addedTeacherQuestionIds: result.addedTeacherQuestionIds,
        skippedTeacherQuestionIds: result.skippedTeacherQuestionIds,
    });
}));
// POST /api/exams/:examId/questions/from-passage — إضافة كل أسئلة قطعة واحدة (Reading Comprehension) لامتحان المحاضرة
// Body: { passageId: number }
exports.router.post('/:examId/questions/from-passage', (0, authentication_1.authMiddleware)(['teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const examId = Number(req.params.examId);
    const passageId = Number(req.body?.passageId ?? req.body?.passage_id);
    if (Number.isNaN(examId) || examId <= 0) {
        return res.status(400).json({ message: 'Invalid exam id' });
    }
    if (Number.isNaN(passageId) || passageId <= 0) {
        return res.status(400).json({ message: 'passageId is required and must be a positive integer' });
    }
    const result = await examFlow_1.ExamFlowService.addPassageQuestionsToExam(req.user.id, examId, passageId);
    return res.status(200).json({
        message: result.added > 0
            ? `تمت إضافة ${result.added} سؤال من القطعة`
            : 'كل أسئلة القطعة موجودة مسبقًا في الامتحان',
        examId,
        passage: result.passage,
        questionIds: result.questionIds,
        added: result.added,
    });
}));
// POST /api/exams/:examId/questions/passage — إنشاء قطعة بأسئلتها وإضافتها مباشرة لامتحان المحاضرة
exports.router.post('/:examId/questions/passage', (0, authentication_1.authMiddleware)(['teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const examId = Number(req.params.examId);
    if (Number.isNaN(examId) || examId <= 0) {
        return res.status(400).json({ message: 'Invalid exam id' });
    }
    const body = req.body;
    const rawBulkText = typeof body.questionsBulkText === 'string'
        ? body.questionsBulkText
        : typeof body.bulkQuestionsText === 'string'
            ? body.bulkQuestionsText
            : typeof body.mcqText === 'string'
                ? body.mcqText
                : null;
    const parsedQuestionsFromText = rawBulkText && rawBulkText.trim().length > 0
        ? examFlow_1.ExamFlowService.parsePassageMcqBulkText(rawBulkText)
        : [];
    const normalizedQuestions = Array.isArray(body.questions) && body.questions.length > 0
        ? body.questions.map((q) => ({
            questionText: String(q.questionText ?? '').trim(),
            optionA: String(q.optionA ?? '').trim(),
            optionB: String(q.optionB ?? '').trim(),
            optionC: String(q.optionC ?? '').trim(),
            optionD: String(q.optionD ?? '').trim(),
            correctAnswer: (q.correctAnswer ?? 'A'),
            points: q.points,
        }))
        : parsedQuestionsFromText;
    if (!normalizedQuestions.length) {
        return res.status(400).json({
            message: 'يجب إرسال questions كمصفوفة أو questionsBulkText كنص Bulk بصيغة مرقمة مع خيارات (أ/ب/ج/د)',
        });
    }
    const result = await examFlow_1.ExamFlowService.createPassageWithQuestionsForExam(req.user.id, examId, {
        title: body.title,
        content: String(body.content ?? body.passage ?? ''),
        questions: normalizedQuestions,
    });
    return res.status(201).json({
        message: `تم إنشاء القطعة وإضافة ${result.added} سؤال للامتحان`,
        examId,
        passage: result.passage,
        questionIds: result.questionIds,
        examQuestionIds: result.examQuestionIds,
        added: result.added,
    });
}));
// POST /api/exams/:examId/questions/bulk — إضافة مجموعة أسئلة بنص واحد (امتحانات الكورس)
// Body: { text: "سؤال؟\na. خيار\nb. خيار\nc. خيار\nd. خيار\n\nسؤال ثاني؟\na. ..." } أو questionText، اختياري: correctAnswers: ['A','B',...]
exports.router.post('/:examId/questions/bulk', (0, authentication_1.authMiddleware)(['teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const examId = Number(req.params.examId);
    if (Number.isNaN(examId)) {
        return res.status(400).json({ message: 'Invalid exam id' });
    }
    const body = req.body;
    const bulkText = typeof body.text === 'string' ? body.text : (typeof body.questionText === 'string' ? body.questionText : null);
    if (!bulkText || !bulkText.trim()) {
        return res.status(400).json({ message: 'text or questionText مطلوب (نص الأسئلة بصيغة: سؤال ثم a. b. c. d.)' });
    }
    const parsed = courseLevelExamQuestions_1.CourseLevelExamQuestionsService.parseBulkQuestionText(bulkText.trim(), Array.isArray(body.correctAnswers) ? body.correctAnswers : undefined);
    if (parsed.length === 0) {
        return res.status(400).json({
            message: 'لم يتم العثور على أسئلة بصيغة صحيحة. كل سؤال يحتاج نص السؤال ثم أربعة أسطر: a. b. c. d.',
        });
    }
    try {
        const questions = await courseLevelExamQuestions_1.CourseLevelExamQuestionsService.createTextQuestionsBulk(req.user, examId, parsed);
        return res.status(201).json({
            message: `تمت إضافة ${questions.length} سؤال`,
            questions,
            count: questions.length,
        });
    }
    catch (error) {
        if (error.status) {
            return res.status(error.status).json({ message: error.message });
        }
        console.error('Error creating questions from bulk text:', error);
        return res.status(500).json({ message: 'Failed to create questions' });
    }
}));
// POST /api/exams/:examId/questions - Create text-based question (واحد) أو مجموعة أسئلة
exports.router.post('/:examId/questions', (0, authentication_1.authMiddleware)(['teacher']), uploadQuestionImage.single('questionImage'), (0, utils_1.asyncWrapper)(async (req, res) => {
    const examId = Number(req.params.examId);
    if (Number.isNaN(examId)) {
        return res.status(400).json({ message: 'Invalid exam id' });
    }
    const body = req.body;
    // إضافة مجموعة أسئلة من نص: { text: "..." } أو { questionText: "..." } — أي نص يحتوي a. و b. يُحلّل كمجموعة أسئلة (مع أو بدون سطر فاضي بين الأسئلة)
    const bulkText = typeof body.text === 'string'
        ? body.text
        : typeof body.questionText === 'string' && body.questionText.includes('a.') && body.questionText.includes('b.')
            ? body.questionText
            : null;
    if (bulkText && bulkText.trim().length > 0) {
        const parsed = courseLevelExamQuestions_1.CourseLevelExamQuestionsService.parseBulkQuestionText(bulkText.trim(), Array.isArray(body.correctAnswers) ? body.correctAnswers : undefined);
        if (parsed.length === 0) {
            return res.status(400).json({
                message: 'لم يتم العثور على أسئلة بصيغة صحيحة. كل سؤال يحتاج نص السؤال ثم أربعة أسطر: a. b. c. d.',
            });
        }
        try {
            const questions = await courseLevelExamQuestions_1.CourseLevelExamQuestionsService.createTextQuestionsBulk(req.user, examId, parsed);
            return res.status(201).json({
                message: `تمت إضافة ${questions.length} سؤال`,
                questions,
                count: questions.length,
            });
        }
        catch (error) {
            if (error.status) {
                return res.status(error.status).json({ message: error.message });
            }
            console.error('Error creating questions from text:', error);
            return res.status(500).json({ message: 'Failed to create questions' });
        }
    }
    // إضافة مجموعة أسئلة: { questions: [ { questionText, optionA, optionB, optionC, optionD, correctAnswer }, ... ] }
    if (Array.isArray(body.questions) && body.questions.length > 0) {
        try {
            const questions = await courseLevelExamQuestions_1.CourseLevelExamQuestionsService.createTextQuestionsBulk(req.user, examId, body.questions);
            return res.status(201).json({
                message: `تمت إضافة ${questions.length} سؤال`,
                questions,
                count: questions.length,
            });
        }
        catch (error) {
            if (error.status) {
                return res.status(error.status).json({ message: error.message });
            }
            console.error('Error creating questions bulk:', error);
            return res.status(500).json({ message: 'Failed to create questions' });
        }
    }
    // إضافة سؤال واحد (نفس الطريقة السابقة)
    const { type, questionText, optionA, optionB, optionC, optionD, correctAnswer } = body;
    if (type !== 'TEXT') {
        return res.status(400).json({ message: 'type must be "TEXT" for this endpoint' });
    }
    if (!questionText || !optionA || !optionB || !optionC || !optionD || !correctAnswer) {
        return res.status(400).json({
            message: 'questionText, optionA, optionB, optionC, optionD, and correctAnswer are required',
        });
    }
    if (!['A', 'B', 'C', 'D'].includes(correctAnswer)) {
        return res.status(400).json({ message: 'correctAnswer must be one of A, B, C, or D' });
    }
    let questionImage = null;
    if (req.file) {
        try {
            const uploaded = await (0, utils_1.uploadToCloudinary)(req.file.path);
            questionImage = uploaded.secure_url;
        }
        catch (error) {
            console.error('Error uploading image:', error);
            return res.status(500).json({ message: 'Failed to upload image' });
        }
    }
    try {
        const question = await courseLevelExamQuestions_1.CourseLevelExamQuestionsService.createTextQuestion(req.user, {
            examId,
            questionText: questionText.trim(),
            optionA: optionA.trim(),
            optionB: optionB.trim(),
            optionC: optionC.trim(),
            optionD: optionD.trim(),
            correctAnswer: correctAnswer,
            questionImage,
            createdBy: req.user.id,
        });
        res.status(201).json({ question });
    }
    catch (error) {
        if (error.status) {
            return res.status(error.status).json({ message: error.message });
        }
        console.error('Error creating question:', error);
        res.status(500).json({ message: 'Failed to create question' });
    }
}));
// DELETE /api/exams/:examId/questions/:questionId - Remove question from exam (teacher only, lecture exams - يدعم الأسئلة المضافة من البنك)
exports.router.delete('/:examId/questions/:questionId', (0, authentication_1.authMiddleware)(['teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const examId = Number(req.params.examId);
    const questionId = Number(req.params.questionId);
    if (Number.isNaN(examId) || Number.isNaN(questionId)) {
        return res.status(400).json({ message: 'Invalid identifiers' });
    }
    try {
        await examFlow_1.ExamFlowService.removeQuestionFromExam(req.user.id, examId, questionId);
        res.json({ message: 'Question removed successfully' });
    }
    catch (error) {
        if (error.status) {
            return res.status(error.status).json({ message: error.message });
        }
        console.error('Error removing question from exam:', error);
        res.status(500).json({ message: 'Failed to remove question' });
    }
}));
// PATCH /api/exams/:examId/questions/:questionId/correct-answer - Set correct answer for question in lecture exam (أسئلة من البنك - التعديل للامتحان فقط)
exports.router.patch('/:examId/questions/:questionId/correct-answer', (0, authentication_1.authMiddleware)(['teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const examId = Number(req.params.examId);
    const questionId = Number(req.params.questionId);
    const correct_answer_index = req.body.correct_answer_index ?? req.body.correctAnswerIndex;
    if (Number.isNaN(examId) || Number.isNaN(questionId)) {
        return res.status(400).json({ message: 'Invalid identifiers' });
    }
    const index = typeof correct_answer_index === 'number' ? correct_answer_index : Number(correct_answer_index);
    if (Number.isNaN(index) || index < 0 || index > 3) {
        return res.status(400).json({
            message: 'correct_answer_index is required and must be 0 (أ), 1 (ب), 2 (ج), or 3 (د)',
        });
    }
    try {
        await examFlow_1.ExamFlowService.setQuestionCorrectAnswer(req.user.id, examId, questionId, index);
        res.json({ message: 'Correct answer updated successfully' });
    }
    catch (error) {
        if (error.status) {
            return res.status(error.status).json({ message: error.message });
        }
        console.error('Error setting correct answer:', error);
        res.status(500).json({ message: 'Failed to update correct answer' });
    }
}));
// PATCH /api/exams/:examId/questions/:questionId/visibility - إخفاء أو إظهار سؤال في امتحان المحاضرة (بدون حذفه)
exports.router.patch('/:examId/questions/:questionId/visibility', (0, authentication_1.authMiddleware)(['teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const examId = Number(req.params.examId);
    const questionId = Number(req.params.questionId);
    const isVisible = req.body.isVisible ?? req.body.is_visible ?? req.body.visible;
    if (Number.isNaN(examId) || Number.isNaN(questionId)) {
        return res.status(400).json({ message: 'Invalid identifiers' });
    }
    if (typeof isVisible !== 'boolean') {
        return res.status(400).json({
            message: 'isVisible is required and must be true (إظهار) or false (إخفاء)',
        });
    }
    try {
        await examFlow_1.ExamFlowService.setQuestionVisibility(req.user.id, examId, questionId, isVisible);
        res.json({
            message: isVisible ? 'Question is now visible in the exam' : 'Question is now hidden from the exam',
            isVisible,
        });
    }
    catch (error) {
        if (error.status) {
            return res.status(error.status).json({ message: error.message });
        }
        console.error('Error setting question visibility:', error);
        res.status(500).json({ message: 'Failed to update visibility' });
    }
}));
// POST /api/exams/:examId/questions/images - Create image-based questions (bulk)
exports.router.post('/:examId/questions/images', (0, authentication_1.authMiddleware)(['teacher']), uploadQuestionImage.any(), (0, utils_1.asyncWrapper)(async (req, res) => {
    const examId = Number(req.params.examId);
    if (Number.isNaN(examId)) {
        return res.status(400).json({ message: 'Invalid exam id' });
    }
    // Get all uploaded files (supports 'images', 'images[]', or any field name)
    const allFiles = req.files || [];
    const files = allFiles.filter((file) => file.mimetype && file.mimetype.startsWith('image/'));
    if (files.length === 0) {
        return res.status(400).json({ message: 'At least one image is required' });
    }
    if (files.length > 10) {
        return res.status(400).json({ message: 'Maximum 10 images allowed per request' });
    }
    const imageUrls = [];
    const uploadErrors = [];
    for (const file of files) {
        try {
            const uploaded = await (0, utils_1.uploadToCloudinary)(file.path);
            imageUrls.push(uploaded.secure_url);
        }
        catch (error) {
            console.error('Error uploading image:', error);
            uploadErrors.push(file.originalname);
        }
    }
    if (uploadErrors.length > 0) {
        return res.status(500).json({
            message: 'Failed to upload some images',
            errors: uploadErrors,
        });
    }
    try {
        const questions = await courseLevelExamQuestions_1.CourseLevelExamQuestionsService.createImageQuestions(req.user, examId, imageUrls);
        res.status(201).json({
            message: 'Image questions created successfully',
            questions,
            count: questions.length,
        });
    }
    catch (error) {
        if (error.status) {
            return res.status(error.status).json({ message: error.message });
        }
        console.error('Error creating image questions:', error);
        res.status(500).json({ message: 'Failed to create image questions' });
    }
}));
// GET /api/exams/:examId/questions - Get all questions for an exam (teacher only)
exports.router.get('/:examId/questions', (0, authentication_1.authMiddleware)(['teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const examId = Number(req.params.examId);
    if (Number.isNaN(examId)) {
        return res.status(400).json({ message: 'Invalid exam id' });
    }
    try {
        const questions = await courseLevelExamQuestions_1.CourseLevelExamQuestionsService.getExamQuestions(examId, req.user);
        res.json({ questions });
    }
    catch (error) {
        if (error.status) {
            return res.status(error.status).json({ message: error.message });
        }
        console.error('Error fetching questions:', error);
        res.status(500).json({ message: 'Failed to fetch questions' });
    }
}));
// ========== Student Routes for Course-Level Exams ==========
// GET /api/exams/course/:courseId/student - Get visible exams for student
exports.router.get('/course/:courseId/student', (0, authentication_1.authMiddleware)(['student']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const courseId = Number(req.params.courseId);
    if (Number.isNaN(courseId)) {
        return res.status(400).json({ message: 'Invalid course id' });
    }
    try {
        const exams = await courseLevelExams_1.CourseLevelExamsService.getVisibleExamsForStudent(courseId, req.user.id);
        res.json({ exams });
    }
    catch (error) {
        if (error.status) {
            return res.status(error.status).json({ message: error.message });
        }
        console.error('Error fetching visible exams:', error);
        res.status(500).json({ message: 'Failed to fetch exams' });
    }
}));
// POST /api/exams/:examId/start - Start exam attempt (student only)
// Note: This route handles both lecture exams and course-level exams
exports.router.post('/:examId/start', (0, authentication_1.authMiddleware)(['student']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const examId = Number(req.params.examId);
    if (Number.isNaN(examId)) {
        return res.status(400).json({ message: 'Invalid exam id' });
    }
    // Try course-level exam first
    try {
        const attempt = await courseLevelExams_1.CourseLevelExamsService.startExamAttempt(examId, req.user.id);
        return res.json(attempt);
    }
    catch (error) {
        // If error is about single attempt already completed, return previous attempt info with wrong questions
        if (error.status === 403 && error.details?.previousAttempt) {
            return res.status(403).json({
                message: error.message,
                previousAttempt: error.details.previousAttempt,
            });
        }
        // If not found or not course-level exam, try lecture exam
        if (error.status === 404 || error.status === 403) {
            // Try lecture exam
            const attempt = await examFlow_1.ExamFlowService.startAttempt(examId, req.user.id);
            return res.json(attempt);
        }
        if (error.status) {
            return res.status(error.status).json({ message: error.message });
        }
        throw error;
    }
}));
// POST /api/exams/:examId/submit - Submit exam attempt (student only)
// Note: This route handles both lecture exams and course-level exams
exports.router.post('/:examId/submit', (0, authentication_1.authMiddleware)(['student']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const examId = Number(req.params.examId);
    if (Number.isNaN(examId)) {
        return res.status(400).json({ message: 'Invalid exam id' });
    }
    const { attemptId, answers } = req.body;
    if (!Array.isArray(answers) || answers.length === 0) {
        return res.status(400).json({ message: 'answers array is required' });
    }
    const answersList = answers.filter((a) => a != null);
    if (answersList.length === 0) {
        return res.status(400).json({ message: 'answers array is required' });
    }
    // Try course-level exam first
    try {
        // Check if this is a course-level exam first
        await courseLevelExams_1.CourseLevelExamsService.getExamById(examId, req.user);
        // If it's a course-level exam, attemptId is required
        if (!attemptId) {
            throw new utils_2.HttpError(400, 'attemptId is required');
        }
        // Validate answers format for course-level exams (accept multiple key names and formats)
        const validLetters = ['A', 'B', 'C', 'D'];
        const validatedAnswers = answersList.map((answer) => {
            const questionId = Number(answer.questionId ?? answer.question_id ?? answer.id);
            let selectedAnswer = answer.selectedAnswer ??
                answer.selected_answer ??
                answer.answer ??
                answer.choice ??
                answer.option ??
                answer.selectedOption ??
                answer.response ??
                answer.value ??
                answer.selected ??
                answer.selectedIndex;
            if (answer.optionA || answer.optionB || answer.optionC || answer.optionD) {
                if (answer.optionA)
                    selectedAnswer = 'A';
                else if (answer.optionB)
                    selectedAnswer = 'B';
                else if (answer.optionC)
                    selectedAnswer = 'C';
                else if (answer.optionD)
                    selectedAnswer = 'D';
            }
            if (typeof selectedAnswer === 'string') {
                selectedAnswer = selectedAnswer.trim().toUpperCase();
                if (selectedAnswer.startsWith('OPTION') && validLetters.includes(selectedAnswer.slice(-1))) {
                    selectedAnswer = selectedAnswer.slice(-1);
                }
            }
            else if (typeof selectedAnswer === 'number' && selectedAnswer >= 0 && selectedAnswer <= 3) {
                selectedAnswer = validLetters[selectedAnswer];
            }
            if (Number.isNaN(questionId) || questionId <= 0) {
                throw new utils_2.HttpError(400, 'Invalid questionId in answers');
            }
            if (!selectedAnswer || !validLetters.includes(selectedAnswer)) {
                throw new utils_2.HttpError(400, 'Each answer must include selected option (selectedAnswer, selected_answer, answer, choice, option, or optionA/optionB/optionC/optionD). Value: A/B/C/D or a/b/c/d or 0/1/2/3. Received: ' +
                    JSON.stringify(answer));
            }
            return {
                questionId,
                selectedAnswer: selectedAnswer,
            };
        });
        const result = await courseLevelExams_1.CourseLevelExamsService.submitExamAttempt(examId, req.user.id, Number(attemptId), validatedAnswers);
        return res.json(result);
    }
    catch (error) {
        // If not found or not course-level exam, try lecture exam
        if (error.status === 404 || error.status === 403) {
            // Try lecture exam format
            const normalizedAnswers = answers.map((answer) => {
                const questionId = Number(answer.questionId);
                const choiceId = answer.choiceId === null || answer.choiceId === undefined
                    ? null
                    : Number(answer.choiceId);
                if (Number.isNaN(questionId)) {
                    throw Object.assign(new Error('Invalid questionId in answers'), { status: 400 });
                }
                if (choiceId !== null && Number.isNaN(choiceId)) {
                    throw Object.assign(new Error('Invalid choiceId in answers'), { status: 400 });
                }
                return { questionId, choiceId };
            });
            const result = await examFlow_1.ExamFlowService.submitAttempt({
                examId,
                studentId: req.user.id,
                answers: normalizedAnswers,
                attemptId: req.body.attemptId ?? req.body.attempt_id,
                allowAutoStart: true,
            });
            const courseRow = await pool_1.default.query(`SELECT l.course_id FROM exams e JOIN lectures l ON l.id = e.lecture_id WHERE e.id = $1`, [examId]);
            if (courseRow.rowCount && courseRow.rows[0].course_id) {
                (0, notifications_1.emitLectureLockUpdated)(req.user.id, courseRow.rows[0].course_id);
            }
            return res.json({
                attemptId: result.attemptId,
                status: result.status,
                totalGrade: result.totalGrade,
                maxGrade: result.maxGrade,
                passed: result.passed,
                showAnswers: result.released,
                releaseReason: result.releaseReason,
                wrongQuestions: result.wrongQuestions,
                courseId: courseRow.rowCount ? courseRow.rows[0].course_id : undefined,
            });
        }
        if (error.status) {
            return res.status(error.status).json({ message: error.message });
        }
        console.error('Error submitting exam attempt:', error);
        res.status(500).json({ message: 'Failed to submit exam attempt' });
    }
}));
// GET /api/exams/:examId/my-report - تقرير الامتحان للطالب (محاضرة أو كورس): كل الأسئلة وإجابته والإجابة الصحيحة
exports.router.get('/:examId/my-report', (0, authentication_1.authMiddleware)(['student']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const examId = Number(req.params.examId);
    if (Number.isNaN(examId)) {
        return res.status(400).json({ message: 'Invalid exam id' });
    }
    try {
        const report = await examFlow_1.ExamFlowService.getMyLectureReport(examId, req.user.id);
        return res.json(report);
    }
    catch (lectureErr) {
        if (lectureErr.status === 404) {
            try {
                const report = await courseLevelExams_1.CourseLevelExamsService.getMyCourseReport(examId, req.user.id);
                return res.json(report);
            }
            catch (courseErr) {
                if (courseErr.status) {
                    return res.status(courseErr.status).json({ message: courseErr.message });
                }
                throw courseErr;
            }
        }
        if (lectureErr.status) {
            return res.status(lectureErr.status).json({ message: lectureErr.message });
        }
        throw lectureErr;
    }
}));
// GET /api/exams/:examId/wrong-questions - Get wrong questions after release date (student only)
exports.router.get('/:examId/wrong-questions', (0, authentication_1.authMiddleware)(['student']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const examId = Number(req.params.examId);
    if (Number.isNaN(examId)) {
        return res.status(400).json({ message: 'Invalid exam id' });
    }
    try {
        const result = await courseLevelExams_1.CourseLevelExamsService.getWrongQuestions(examId, req.user.id);
        res.json(result);
    }
    catch (error) {
        if (error.status) {
            return res.status(error.status).json({ message: error.message });
        }
        console.error('Error fetching wrong questions:', error);
        res.status(500).json({ message: 'Failed to fetch wrong questions' });
    }
}));
exports.router.get('/:examId/report', (0, authentication_1.authMiddleware)(['teacher', 'admin']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const examId = Number(req.params.examId);
    if (Number.isNaN(examId)) {
        return res.status(400).json({ message: 'Invalid exam id' });
    }
    const report = await examFlow_1.ExamFlowService.getExamQuestionReport(examId, {
        id: req.user.id,
        role: req.user.role,
    });
    res.json(report);
}));
exports.router.post('/:examId/start', (0, authentication_1.authMiddleware)(['student']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const examId = Number(req.params.examId);
    if (Number.isNaN(examId)) {
        return res.status(400).json({ message: 'Invalid exam id' });
    }
    // Try course-level exam first
    try {
        const attempt = await courseLevelExams_1.CourseLevelExamsService.startExamAttempt(examId, req.user.id);
        return res.json(attempt);
    }
    catch (error) {
        // If not found or not course-level exam, try lecture exam
        if (error.status === 404 || error.status === 403) {
            const attempt = await examFlow_1.ExamFlowService.startAttempt(examId, req.user.id);
            return res.json(attempt);
        }
        if (error.status) {
            return res.status(error.status).json({ message: error.message });
        }
        throw error;
    }
}));
exports.router.post('/:examId/submit', (0, authentication_1.authMiddleware)(['student']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const examId = Number(req.params.examId);
    if (Number.isNaN(examId)) {
        return res.status(400).json({ message: 'Invalid exam id' });
    }
    const answers = req.body.answers;
    if (!Array.isArray(answers) || answers.length === 0) {
        return res.status(400).json({ message: 'answers array is required' });
    }
    const normalizedAnswers = answers.map((answer) => {
        const questionId = Number(answer.questionId);
        const choiceId = answer.choiceId === null || answer.choiceId === undefined ? null : Number(answer.choiceId);
        if (Number.isNaN(questionId)) {
            throw Object.assign(new Error('Invalid questionId in answers'), { status: 400 });
        }
        if (choiceId !== null && Number.isNaN(choiceId)) {
            throw Object.assign(new Error('Invalid choiceId in answers'), { status: 400 });
        }
        return { questionId, choiceId };
    });
    const result = await examFlow_1.ExamFlowService.submitAttempt({
        examId,
        studentId: req.user.id,
        answers: normalizedAnswers,
        attemptId: req.body.attemptId ?? req.body.attempt_id,
        allowAutoStart: true,
    });
    // تحديث قفل المحاضرات فوراً: إرسال حدث للطالب لإعادة تحميل حالة القفل (بدون إعادة تحميل الصفحة)
    const courseRow = await pool_1.default.query(`SELECT l.course_id FROM exams e JOIN lectures l ON l.id = e.lecture_id WHERE e.id = $1`, [examId]);
    if (courseRow.rowCount && courseRow.rows[0].course_id) {
        (0, notifications_1.emitLectureLockUpdated)(req.user.id, courseRow.rows[0].course_id);
    }
    res.json({
        attemptId: result.attemptId,
        status: result.status,
        totalGrade: result.totalGrade,
        maxGrade: result.maxGrade,
        passed: result.passed,
        showAnswers: result.released,
        releaseReason: result.releaseReason,
        wrongQuestions: result.wrongQuestions,
        courseId: courseRow.rowCount ? courseRow.rows[0].course_id : undefined,
    });
}));
exports.router.get('/:examId/attempts/:attemptId', (0, authentication_1.authMiddleware)(['teacher', 'student', 'admin']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const examId = Number(req.params.examId);
    const attemptId = Number(req.params.attemptId);
    if (Number.isNaN(examId) || Number.isNaN(attemptId)) {
        return res.status(400).json({ message: 'Invalid identifiers' });
    }
    const attempt = await examFlow_1.ExamFlowService.getAttemptDetails(examId, attemptId, {
        id: req.user.id,
        role: req.user.role,
    });
    res.json(attempt);
}));
