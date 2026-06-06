"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const express_1 = require("express");
const authentication_1 = require("../middleware/authentication");
const permissions_1 = require("../middleware/permissions");
const utils_1 = require("../utils");
const lessonQuestions_1 = require("../services/lessonQuestions");
const pool_1 = __importDefault(require("../db/pool"));
exports.router = (0, express_1.Router)();
// إضافة أسئلة دفعة واحدة للدرس
exports.router.post('/lecture/:lectureId/bulk', (0, authentication_1.authMiddleware)(['teacher', 'admin', 'employee']), (0, permissions_1.checkPermission)('question_bank_management'), (0, utils_1.asyncWrapper)(async (req, res) => {
    const lectureId = Number(req.params.lectureId);
    const { bulk_text } = req.body;
    if (isNaN(lectureId)) {
        return res.status(400).json({ message: 'Invalid lecture ID' });
    }
    if (!bulk_text || typeof bulk_text !== 'string') {
        return res.status(400).json({ message: 'bulk_text is required and must be a string' });
    }
    // التحقق من أن الدرس يخص المدرس
    if (req.user.role === 'teacher') {
        const lectureCheck = await pool_1.default.query('SELECT l.*, c.teacher_id FROM lectures l JOIN courses c ON l.course_id = c.id WHERE l.id = $1', [lectureId]);
        if (!lectureCheck.rowCount || lectureCheck.rows[0].teacher_id !== req.user.id) {
            return res.status(403).json({ message: 'ليس لديك صلاحية لإضافة أسئلة لهذا الدرس' });
        }
    }
    try {
        const result = await lessonQuestions_1.LessonQuestionsService.createBulkQuestionsForLesson(lectureId, bulk_text);
        res.status(201).json(result);
    }
    catch (error) {
        res.status(400).json({ message: error.message });
    }
}));
// جلب أسئلة درس معين (API جديد)
exports.router.get('/lessons/:lessonId/questions', (0, authentication_1.authMiddleware)(['teacher', 'admin', 'student', 'employee']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const lessonId = Number(req.params.lessonId);
    if (isNaN(lessonId)) {
        return res.status(400).json({ message: 'Invalid lesson ID' });
    }
    // التحقق من الصلاحيات للمدرس في بنك الأسئلة
    if (req.user.role === 'teacher') {
        const lessonCheck = await pool_1.default.query(`SELECT l.*, c.subject_id, s.question_bank_id 
         FROM lessons l 
         JOIN chapters c ON l.chapter_id = c.id 
         JOIN subjects s ON c.subject_id = s.id 
         WHERE l.id = $1`, [lessonId]);
        if (!lessonCheck.rowCount) {
            return res.status(404).json({ message: 'الدرس غير موجود في بنك الأسئلة' });
        }
        const lesson = lessonCheck.rows[0];
        // التحقق من صلاحيات المدرس للمادة
        const permissionCheck = await pool_1.default.query(`SELECT id FROM teacher_permissions 
         WHERE teacher_id = $1 AND subject_id = $2 AND question_bank_id = $3 AND is_active = true`, [req.user.id, lesson.subject_id, lesson.question_bank_id]);
        if (!permissionCheck.rowCount) {
            return res
                .status(403)
                .json({ message: 'ليس لديك صلاحية للوصول لهذا الدرس في بنك الأسئلة' });
        }
    }
    if (req.user.role === 'student') {
        // التحقق من أن الطالب مسجل في الكورس
        const enrollmentCheck = await pool_1.default.query('SELECT e.id FROM enrollments e JOIN lectures l ON e.course_id = l.course_id WHERE e.user_id = $1 AND l.id = $2', [req.user.id, lessonId]);
        if (!enrollmentCheck.rowCount) {
            return res.status(403).json({ message: 'لست مسجلاً في هذا الكورس' });
        }
    }
    try {
        const questions = await lessonQuestions_1.LessonQuestionsService.getLessonQuestionsFormatted(lessonId);
        res.json({ success: true, data: questions });
    }
    catch (error) {
        res.status(500).json({ message: error.message });
    }
}));
// جلب أسئلة درس معين (API قديم)
exports.router.get('/lecture/:lectureId/questions', (0, authentication_1.authMiddleware)(['teacher', 'admin', 'student', 'employee']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const lectureId = Number(req.params.lectureId);
    if (isNaN(lectureId)) {
        return res.status(400).json({ message: 'Invalid lecture ID' });
    }
    // التحقق من الصلاحيات
    if (req.user.role === 'teacher') {
        const lectureCheck = await pool_1.default.query('SELECT l.*, c.teacher_id FROM lectures l JOIN courses c ON l.course_id = c.id WHERE l.id = $1', [lectureId]);
        if (!lectureCheck.rowCount || lectureCheck.rows[0].teacher_id !== req.user.id) {
            return res.status(403).json({ message: 'ليس لديك صلاحية للوصول لهذا الدرس' });
        }
    }
    if (req.user.role === 'student') {
        // التحقق من أن الطالب مسجل في الكورس
        const enrollmentCheck = await pool_1.default.query('SELECT e.id FROM enrollments e JOIN lectures l ON e.course_id = l.course_id WHERE e.user_id = $1 AND l.id = $2', [req.user.id, lectureId]);
        if (!enrollmentCheck.rowCount) {
            return res.status(403).json({ message: 'لست مسجلاً في هذا الكورس' });
        }
    }
    try {
        const questions = await lessonQuestions_1.LessonQuestionsService.getLessonQuestions(lectureId);
        res.json({ questions });
    }
    catch (error) {
        res.status(500).json({ message: error.message });
    }
}));
// إضافة أسئلة اختيار من متعدد دفعة واحدة (بنك الأسئلة) - تدعم الإجابة الصحيحة
// التنسيق: سؤال ثم أ) ب) ج) د) واختياريًا "✅ الإجابة الصحيحة: ب"
exports.router.post('/lessons/:lessonId/questions/bulk', (0, authentication_1.authMiddleware)(['teacher', 'admin', 'employee']), (0, permissions_1.checkPermission)('question_bank_management'), (0, utils_1.asyncWrapper)(async (req, res) => {
    const lessonId = Number(req.params.lessonId);
    const { bulk_text } = req.body;
    if (isNaN(lessonId)) {
        return res.status(400).json({ message: 'معرف الدرس غير صحيح' });
    }
    if (!bulk_text || typeof bulk_text !== 'string') {
        return res.status(400).json({ message: 'bulk_text مطلوب ويجب أن يكون نصًا' });
    }
    if (req.user.role === 'teacher') {
        const lessonCheck = await pool_1.default.query(`SELECT l.*, c.subject_id, s.question_bank_id 
         FROM lessons l 
         JOIN chapters c ON l.chapter_id = c.id 
         JOIN subjects s ON c.subject_id = s.id 
         WHERE l.id = $1`, [lessonId]);
        if (!lessonCheck.rowCount) {
            return res.status(404).json({ message: 'الدرس غير موجود في بنك الأسئلة' });
        }
        const lesson = lessonCheck.rows[0];
        const permissionCheck = await pool_1.default.query(`SELECT id FROM teacher_permissions 
         WHERE teacher_id = $1 AND subject_id = $2 AND question_bank_id = $3 AND is_active = true`, [req.user.id, lesson.subject_id, lesson.question_bank_id]);
        if (!permissionCheck.rowCount) {
            return res.status(403).json({ message: 'ليس لديك صلاحية لإضافة أسئلة لهذا الدرس' });
        }
    }
    const result = await lessonQuestions_1.LessonQuestionsService.createBulkMcqForQuestionBankLesson(bulk_text, lessonId, req.user.role === 'teacher' ? req.user.id : undefined);
    res.status(201).json({
        success: true,
        message: `تمت إضافة ${result.inserted} سؤال/أسئلة`,
        data: result,
    });
}));
// إضافة أسئلة نصية للدرس في بنك الأسئلة (بدون تحليل الإجابة الصحيحة)
exports.router.post('/lessons/:lessonId/questions/text', (0, authentication_1.authMiddleware)(['teacher', 'admin', 'employee']), (0, permissions_1.checkPermission)('question_bank_management'), (0, utils_1.asyncWrapper)(async (req, res) => {
    const lessonId = Number(req.params.lessonId);
    const { bulk_text } = req.body;
    if (isNaN(lessonId)) {
        return res.status(400).json({ message: 'Invalid lesson ID' });
    }
    if (!bulk_text || typeof bulk_text !== 'string') {
        return res.status(400).json({ message: 'bulk_text is required and must be a string' });
    }
    // التحقق من أن الدرس يخص المدرس في بنك الأسئلة
    if (req.user.role === 'teacher') {
        const lessonCheck = await pool_1.default.query(`SELECT l.*, c.subject_id, s.question_bank_id 
         FROM lessons l 
         JOIN chapters c ON l.chapter_id = c.id 
         JOIN subjects s ON c.subject_id = s.id 
         WHERE l.id = $1`, [lessonId]);
        if (!lessonCheck.rowCount) {
            return res.status(404).json({ message: 'الدرس غير موجود' });
        }
        const lesson = lessonCheck.rows[0];
        // التحقق من صلاحيات المدرس
        const permissionCheck = await pool_1.default.query(`SELECT * FROM teacher_permissions 
         WHERE teacher_id = $1 AND subject_id = $2 AND is_active = true`, [req.user.id, lesson.subject_id]);
        if (!permissionCheck.rowCount) {
            return res.status(403).json({ message: 'ليس لديك صلاحية لإدارة هذا الدرس' });
        }
    }
    const questions = await lessonQuestions_1.LessonQuestionsService.createTextQuestionsForQuestionBankLesson(bulk_text, lessonId);
    res.json({
        success: true,
        data: questions,
    });
}));
// إضافة أسئلة بالصور للدرس في بنك الأسئلة
exports.router.post('/lessons/:lessonId/questions/images', (0, authentication_1.authMiddleware)(['teacher', 'admin', 'employee']), (0, permissions_1.checkPermission)('question_bank_management'), utils_1.uploadExamImage.array('images', 10), // يسمح برفع حتى 10 صور
(0, utils_1.asyncWrapper)(async (req, res) => {
    const files = req.files;
    const lessonId = Number(req.params.lessonId);
    if (isNaN(lessonId)) {
        return res.status(400).json({ message: 'Invalid lesson ID' });
    }
    if (!files || files.length === 0) {
        return res.status(400).json({ message: 'يجب رفع صورة واحدة على الأقل' });
    }
    if (files.length > 10) {
        return res.status(400).json({ message: 'يمكن رفع 10 صور كحد أقصى' });
    }
    // التحقق من أن الدرس يخص المدرس في بنك الأسئلة
    if (req.user.role === 'teacher') {
        const lessonCheck = await pool_1.default.query(`SELECT l.*, c.subject_id, s.question_bank_id 
         FROM lessons l 
         JOIN chapters c ON l.chapter_id = c.id 
         JOIN subjects s ON c.subject_id = s.id 
         WHERE l.id = $1`, [lessonId]);
        if (!lessonCheck.rowCount) {
            return res.status(404).json({ message: 'الدرس غير موجود في بنك الأسئلة' });
        }
        const lesson = lessonCheck.rows[0];
        // التحقق من صلاحيات المدرس للمادة
        const permissionCheck = await pool_1.default.query(`SELECT id FROM teacher_permissions 
         WHERE teacher_id = $1 AND subject_id = $2 AND question_bank_id = $3 AND is_active = true`, [req.user.id, lesson.subject_id, lesson.question_bank_id]);
        if (!permissionCheck.rowCount) {
            return res
                .status(403)
                .json({ message: 'ليس لديك صلاحية لإضافة أسئلة لهذا الدرس في بنك الأسئلة' });
        }
    }
    try {
        const questions = await lessonQuestions_1.LessonQuestionsService.createImageQuestionsForQuestionBankLesson(files, lessonId);
        res.status(201).json({ success: true, data: questions });
    }
    catch (error) {
        res.status(400).json({ message: error.message });
    }
}));
// إضافة أسئلة بالصور للدرس (API قديم)
exports.router.post('/lecture-question/', (0, authentication_1.authMiddleware)(['teacher', 'admin', 'employee']), (0, permissions_1.checkPermission)('question_bank_management'), utils_1.uploadExamImage.array('images', 10), // يسمح برفع حتى 10 صور
(0, utils_1.asyncWrapper)(async (req, res) => {
    const files = req.files;
    const { lecture_id } = req.body;
    if (!files || files.length === 0) {
        return res.status(400).json({ message: 'يجب رفع صورة واحدة على الأقل' });
    }
    if (files.length > 10) {
        return res.status(400).json({ message: 'يمكن رفع 10 صور كحد أقصى' });
    }
    if (lecture_id && isNaN(Number(lecture_id))) {
        return res.status(400).json({ message: 'lecture_id يجب أن يكون رقم صحيح' });
    }
    // التحقق من أن الدرس يخص المدرس
    if (req.user.role === 'teacher' && lecture_id) {
        const lectureCheck = await pool_1.default.query('SELECT l.*, c.teacher_id FROM lectures l JOIN courses c ON l.course_id = c.id WHERE l.id = $1', [lecture_id]);
        if (!lectureCheck.rowCount || lectureCheck.rows[0].teacher_id !== req.user.id) {
            return res.status(403).json({ message: 'ليس لديك صلاحية لإضافة أسئلة لهذا الدرس' });
        }
    }
    try {
        const questions = await lessonQuestions_1.LessonQuestionsService.createImageQuestionsForLesson(files, lecture_id ? Number(lecture_id) : undefined);
        res.status(201).json(questions);
    }
    catch (error) {
        res.status(400).json({ message: error.message });
    }
}));
// جلب تفاصيل درس (بيانات الدرس + الأسئلة)
exports.router.get('/lecture/:lectureId/details', (0, authentication_1.authMiddleware)(['teacher', 'admin', 'student', 'employee']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const lectureId = Number(req.params.lectureId);
    if (isNaN(lectureId)) {
        return res.status(400).json({ message: 'Invalid lecture ID' });
    }
    // التحقق من الصلاحيات
    if (req.user.role === 'teacher') {
        const lectureCheck = await pool_1.default.query('SELECT l.*, c.teacher_id FROM lectures l JOIN courses c ON l.course_id = c.id WHERE l.id = $1', [lectureId]);
        if (!lectureCheck.rowCount || lectureCheck.rows[0].teacher_id !== req.user.id) {
            return res.status(403).json({ message: 'ليس لديك صلاحية للوصول لهذا الدرس' });
        }
    }
    if (req.user.role === 'student') {
        // التحقق من أن الطالب مسجل في الكورس
        const enrollmentCheck = await pool_1.default.query('SELECT e.id FROM enrollments e JOIN lectures l ON e.course_id = l.course_id WHERE e.user_id = $1 AND l.id = $2', [req.user.id, lectureId]);
        if (!enrollmentCheck.rowCount) {
            return res.status(403).json({ message: 'لست مسجلاً في هذا الكورس' });
        }
    }
    try {
        const result = await lessonQuestions_1.LessonQuestionsService.getLessonDetails(lectureId);
        res.json(result);
    }
    catch (error) {
        res.status(404).json({ message: error.message });
    }
}));
// تعديل نص السؤال أو درجته أو صورته
exports.router.patch('/lecture-question/:questionId', (0, authentication_1.authMiddleware)(['teacher', 'admin', 'employee']), (0, permissions_1.checkPermission)('question_bank_management'), utils_1.uploadExamImage.single('image'), (0, utils_1.asyncWrapper)(async (req, res) => {
    const questionId = Number(req.params.questionId);
    const { question_text, grade } = req.body;
    const image = req.file ? req.file.filename : undefined;
    if (isNaN(questionId)) {
        return res.status(400).json({ message: 'Invalid question ID' });
    }
    // التحقق من أن السؤال يخص المدرس
    if (req.user.role === 'teacher') {
        const questionCheck = await pool_1.default.query(`SELECT lq.*, c.teacher_id 
         FROM lesson_questions lq
         JOIN lectures l ON lq.lecture_id = l.id
         JOIN courses c ON l.course_id = c.id
         WHERE lq.id = $1`, [questionId]);
        if (!questionCheck.rowCount || questionCheck.rows[0].teacher_id !== req.user.id) {
            return res.status(403).json({ message: 'ليس لديك صلاحية لتعديل هذا السؤال' });
        }
    }
    try {
        const result = await lessonQuestions_1.LessonQuestionsService.updateLessonQuestion(questionId, question_text, grade, image);
        res.json(result);
    }
    catch (error) {
        res.status(400).json({ message: error.message });
    }
}));
// تحديد الإجابة الصحيحة
exports.router.patch('/lecture-question/:questionId/answer', (0, authentication_1.authMiddleware)(['teacher', 'admin', 'employee']), (0, permissions_1.checkPermission)('question_bank_management'), (0, utils_1.asyncWrapper)(async (req, res) => {
    const questionId = Number(req.params.questionId);
    const { correct_answer } = req.body;
    if (isNaN(questionId) || isNaN(correct_answer)) {
        return res.status(400).json({ message: 'Invalid question ID or choice ID' });
    }
    // التحقق من أن السؤال يخص المدرس
    if (req.user.role === 'teacher') {
        const questionCheck = await pool_1.default.query(`SELECT lq.*, c.teacher_id 
         FROM lesson_questions lq
         JOIN lectures l ON lq.lecture_id = l.id
         JOIN courses c ON l.course_id = c.id
         WHERE lq.id = $1`, [questionId]);
        if (!questionCheck.rowCount || questionCheck.rows[0].teacher_id !== req.user.id) {
            return res.status(403).json({ message: 'ليس لديك صلاحية لتعديل هذا السؤال' });
        }
    }
    try {
        const result = await lessonQuestions_1.LessonQuestionsService.setLessonQuestionCorrectAnswer(questionId, correct_answer);
        res.json(result);
    }
    catch (error) {
        res.status(400).json({ message: error.message });
    }
}));
// حذف سؤال
exports.router.delete('/lecture-question/:questionId', (0, authentication_1.authMiddleware)(['teacher', 'admin', 'employee']), (0, permissions_1.checkPermission)('question_bank_management'), (0, utils_1.asyncWrapper)(async (req, res) => {
    const questionId = Number(req.params.questionId);
    if (isNaN(questionId)) {
        return res.status(400).json({ message: 'Invalid question ID' });
    }
    // التحقق من أن السؤال يخص المدرس
    if (req.user.role === 'teacher') {
        const questionCheck = await pool_1.default.query(`SELECT lq.*, c.teacher_id 
         FROM lesson_questions lq
         JOIN lectures l ON lq.lecture_id = l.id
         JOIN courses c ON l.course_id = c.id
         WHERE lq.id = $1`, [questionId]);
        if (!questionCheck.rowCount || questionCheck.rows[0].teacher_id !== req.user.id) {
            return res.status(403).json({ message: 'ليس لديك صلاحية لحذف هذا السؤال' });
        }
    }
    try {
        const result = await lessonQuestions_1.LessonQuestionsService.deleteLessonQuestion(questionId);
        res.json(result);
    }
    catch (error) {
        res.status(404).json({ message: error.message });
    }
}));
// حذف سؤال من درس في بنك الأسئلة
exports.router.delete('/questions/:questionId', (0, authentication_1.authMiddleware)(['teacher', 'admin', 'employee']), (0, permissions_1.checkPermission)('question_bank_management'), (0, utils_1.asyncWrapper)(async (req, res) => {
    const questionId = Number(req.params.questionId);
    if (isNaN(questionId)) {
        return res.status(400).json({ message: 'Invalid question ID' });
    }
    // التحقق من أن السؤال يخص المدرس
    if (req.user.role === 'teacher') {
        const questionCheck = await pool_1.default.query(`SELECT q.*, l.id as lesson_id, c.subject_id 
         FROM questions q 
         JOIN lessons l ON q.lesson_id = l.id 
         JOIN chapters c ON l.chapter_id = c.id 
         WHERE q.id = $1`, [questionId]);
        if (!questionCheck.rowCount) {
            return res.status(404).json({ message: 'السؤال غير موجود' });
        }
        const question = questionCheck.rows[0];
        // التحقق من صلاحيات المدرس
        const permissionCheck = await pool_1.default.query(`SELECT * FROM teacher_permissions 
         WHERE teacher_id = $1 AND subject_id = $2 AND is_active = true`, [req.user.id, question.subject_id]);
        if (!permissionCheck.rowCount) {
            return res.status(403).json({ message: 'ليس لديك صلاحية لحذف هذا السؤال' });
        }
    }
    const result = await lessonQuestions_1.LessonQuestionsService.deleteQuestionFromLesson(questionId);
    res.json({
        success: true,
        message: result.message,
    });
}));
// تعديل سؤال من درس في بنك الأسئلة
exports.router.put('/questions/:questionId', (0, authentication_1.authMiddleware)(['teacher', 'admin', 'employee']), (0, permissions_1.checkPermission)('question_bank_management'), (0, utils_1.asyncWrapper)(async (req, res) => {
    const questionId = Number(req.params.questionId);
    const { text, image, options, correct_answer } = req.body;
    if (isNaN(questionId)) {
        return res.status(400).json({ message: 'Invalid question ID' });
    }
    // التحقق من أن السؤال يخص المدرس
    if (req.user.role === 'teacher') {
        const questionCheck = await pool_1.default.query(`SELECT q.*, l.id as lesson_id, c.subject_id 
         FROM questions q 
         JOIN lessons l ON q.lesson_id = l.id 
         JOIN chapters c ON l.chapter_id = c.id 
         WHERE q.id = $1`, [questionId]);
        if (!questionCheck.rowCount) {
            return res.status(404).json({ message: 'السؤال غير موجود' });
        }
        const question = questionCheck.rows[0];
        // التحقق من صلاحيات المدرس
        const permissionCheck = await pool_1.default.query(`SELECT * FROM teacher_permissions 
         WHERE teacher_id = $1 AND subject_id = $2 AND is_active = true`, [req.user.id, question.subject_id]);
        if (!permissionCheck.rowCount) {
            return res.status(403).json({ message: 'ليس لديك صلاحية لتعديل هذا السؤال' });
        }
    }
    const updateData = {};
    if (text !== undefined)
        updateData.text = text;
    if (image !== undefined)
        updateData.image = image;
    if (options !== undefined)
        updateData.options = options;
    if (correct_answer !== undefined)
        updateData.correct_answer = correct_answer;
    const result = await lessonQuestions_1.LessonQuestionsService.updateQuestionFromLesson(questionId, updateData);
    res.json({
        success: true,
        message: result.message,
    });
}));
// تحديد الإجابة الصحيحة للسؤال
exports.router.post('/questions/:questionId/answer', (0, authentication_1.authMiddleware)(['teacher', 'admin', 'employee']), (0, permissions_1.checkPermission)('question_bank_management'), (0, utils_1.asyncWrapper)(async (req, res) => {
    const questionId = Number(req.params.questionId);
    const { correctChoiceId } = req.body;
    if (isNaN(questionId)) {
        return res.status(400).json({ message: 'Invalid question ID' });
    }
    if (correctChoiceId === undefined || correctChoiceId === null) {
        return res.status(400).json({ message: 'correctChoiceId is required' });
    }
    // التحقق من أن السؤال يخص المدرس
    if (req.user.role === 'teacher') {
        const questionCheck = await pool_1.default.query(`SELECT q.*, l.id as lesson_id, c.subject_id 
         FROM questions q 
         JOIN lessons l ON q.lesson_id = l.id 
         JOIN chapters c ON l.chapter_id = c.id 
         WHERE q.id = $1`, [questionId]);
        if (!questionCheck.rowCount) {
            return res.status(404).json({ message: 'السؤال غير موجود' });
        }
        const question = questionCheck.rows[0];
        // التحقق من صلاحيات المدرس
        const permissionCheck = await pool_1.default.query(`SELECT * FROM teacher_permissions 
         WHERE teacher_id = $1 AND subject_id = $2 AND is_active = true`, [req.user.id, question.subject_id]);
        if (!permissionCheck.rowCount) {
            return res.status(403).json({ message: 'ليس لديك صلاحية لتعديل هذا السؤال' });
        }
    }
    const result = await lessonQuestions_1.LessonQuestionsService.setLessonQuestionCorrectAnswer(questionId, correctChoiceId);
    res.json({
        success: true,
        message: result.message,
    });
}));
