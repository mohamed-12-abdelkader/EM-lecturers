import { Router } from 'express';
import { authMiddleware } from '../middleware/authentication';
import { checkPermission } from '../middleware/permissions';
import { asyncWrapper, uploadExamImage } from '../utils';
import { LessonQuestionsService } from '../services/lessonQuestions';
import pool from '../db/pool';

export const router = Router();

// إضافة أسئلة دفعة واحدة للدرس
router.post(
  '/lecture/:lectureId/bulk',
  authMiddleware(['teacher', 'admin', 'employee']), checkPermission('question_bank_management'),
  asyncWrapper(async (req, res) => {
    const lectureId = Number(req.params.lectureId);
    const { bulk_text } = req.body;

    if (isNaN(lectureId)) {
      return res.status(400).json({ message: 'Invalid lecture ID' });
    }

    if (!bulk_text || typeof bulk_text !== 'string') {
      return res.status(400).json({ message: 'bulk_text is required and must be a string' });
    }

    // التحقق من أن الدرس يخص المدرس
    if (req.user!.role === 'teacher') {
      const lectureCheck = await pool.query(
        'SELECT l.*, c.teacher_id FROM lectures l JOIN courses c ON l.course_id = c.id WHERE l.id = $1',
        [lectureId],
      );

      if (!lectureCheck.rowCount || lectureCheck.rows[0].teacher_id !== req.user!.id) {
        return res.status(403).json({ message: 'ليس لديك صلاحية لإضافة أسئلة لهذا الدرس' });
      }
    }

    try {
      const result = await LessonQuestionsService.createBulkQuestionsForLesson(
        lectureId,
        bulk_text,
      );
      res.status(201).json(result);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }),
);

// جلب أسئلة درس معين (API جديد)
router.get(
  '/lessons/:lessonId/questions',
  authMiddleware(['teacher', 'admin', 'student', 'employee']),
  asyncWrapper(async (req, res) => {
    const lessonId = Number(req.params.lessonId);

    if (isNaN(lessonId)) {
      return res.status(400).json({ message: 'Invalid lesson ID' });
    }

    // التحقق من الصلاحيات للمدرس في بنك الأسئلة
    if (req.user!.role === 'teacher') {
      const lessonCheck = await pool.query(
        `SELECT l.*, c.subject_id, s.question_bank_id 
         FROM lessons l 
         JOIN chapters c ON l.chapter_id = c.id 
         JOIN subjects s ON c.subject_id = s.id 
         WHERE l.id = $1`,
        [lessonId],
      );

      if (!lessonCheck.rowCount) {
        return res.status(404).json({ message: 'الدرس غير موجود في بنك الأسئلة' });
      }

      const lesson = lessonCheck.rows[0];

      // التحقق من صلاحيات المدرس للمادة
      const permissionCheck = await pool.query(
        `SELECT id FROM teacher_permissions 
         WHERE teacher_id = $1 AND subject_id = $2 AND question_bank_id = $3 AND is_active = true`,
        [req.user!.id, lesson.subject_id, lesson.question_bank_id],
      );

      if (!permissionCheck.rowCount) {
        return res
          .status(403)
          .json({ message: 'ليس لديك صلاحية للوصول لهذا الدرس في بنك الأسئلة' });
      }
    }

    if (req.user!.role === 'student') {
      // التحقق من أن الطالب مسجل في الكورس
      const enrollmentCheck = await pool.query(
        'SELECT e.id FROM enrollments e JOIN lectures l ON e.course_id = l.course_id WHERE e.user_id = $1 AND l.id = $2',
        [req.user!.id, lessonId],
      );

      if (!enrollmentCheck.rowCount) {
        return res.status(403).json({ message: 'لست مسجلاً في هذا الكورس' });
      }
    }

    try {
      const questions = await LessonQuestionsService.getLessonQuestionsFormatted(lessonId);
      res.json({ success: true, data: questions });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  }),
);

// جلب أسئلة درس معين (API قديم)
router.get(
  '/lecture/:lectureId/questions',
  authMiddleware(['teacher', 'admin', 'student', 'employee']),
  asyncWrapper(async (req, res) => {
    const lectureId = Number(req.params.lectureId);

    if (isNaN(lectureId)) {
      return res.status(400).json({ message: 'Invalid lecture ID' });
    }

    // التحقق من الصلاحيات
    if (req.user!.role === 'teacher') {
      const lectureCheck = await pool.query(
        'SELECT l.*, c.teacher_id FROM lectures l JOIN courses c ON l.course_id = c.id WHERE l.id = $1',
        [lectureId],
      );

      if (!lectureCheck.rowCount || lectureCheck.rows[0].teacher_id !== req.user!.id) {
        return res.status(403).json({ message: 'ليس لديك صلاحية للوصول لهذا الدرس' });
      }
    }

    if (req.user!.role === 'student') {
      // التحقق من أن الطالب مسجل في الكورس
      const enrollmentCheck = await pool.query(
        'SELECT e.id FROM enrollments e JOIN lectures l ON e.course_id = l.course_id WHERE e.user_id = $1 AND l.id = $2',
        [req.user!.id, lectureId],
      );

      if (!enrollmentCheck.rowCount) {
        return res.status(403).json({ message: 'لست مسجلاً في هذا الكورس' });
      }
    }

    try {
      const questions = await LessonQuestionsService.getLessonQuestions(lectureId);
      res.json({ questions });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  }),
);

// إضافة أسئلة اختيار من متعدد دفعة واحدة (بنك الأسئلة) - تدعم الإجابة الصحيحة
// التنسيق: سؤال ثم أ) ب) ج) د) واختياريًا "✅ الإجابة الصحيحة: ب"
router.post(
  '/lessons/:lessonId/questions/bulk',
  authMiddleware(['teacher', 'admin', 'employee']), checkPermission('question_bank_management'),
  asyncWrapper(async (req, res) => {
    const lessonId = Number(req.params.lessonId);
    const { bulk_text } = req.body;

    if (isNaN(lessonId)) {
      return res.status(400).json({ message: 'معرف الدرس غير صحيح' });
    }

    if (!bulk_text || typeof bulk_text !== 'string') {
      return res.status(400).json({ message: 'bulk_text مطلوب ويجب أن يكون نصًا' });
    }

    if (req.user!.role === 'teacher') {
      const lessonCheck = await pool.query(
        `SELECT l.*, c.subject_id, s.question_bank_id 
         FROM lessons l 
         JOIN chapters c ON l.chapter_id = c.id 
         JOIN subjects s ON c.subject_id = s.id 
         WHERE l.id = $1`,
        [lessonId],
      );

      if (!lessonCheck.rowCount) {
        return res.status(404).json({ message: 'الدرس غير موجود في بنك الأسئلة' });
      }

      const lesson = lessonCheck.rows[0];
      const permissionCheck = await pool.query(
        `SELECT id FROM teacher_permissions 
         WHERE teacher_id = $1 AND subject_id = $2 AND question_bank_id = $3 AND is_active = true`,
        [req.user!.id, lesson.subject_id, lesson.question_bank_id],
      );

      if (!permissionCheck.rowCount) {
        return res.status(403).json({ message: 'ليس لديك صلاحية لإضافة أسئلة لهذا الدرس' });
      }
    }

    const result = await LessonQuestionsService.createBulkMcqForQuestionBankLesson(
      bulk_text,
      lessonId,
      req.user!.role === 'teacher' ? (req.user!.id as number) : undefined,
    );

    res.status(201).json({
      success: true,
      message: `تمت إضافة ${result.inserted} سؤال/أسئلة`,
      data: result,
    });
  }),
);

// إضافة أسئلة نصية للدرس في بنك الأسئلة (بدون تحليل الإجابة الصحيحة)
router.post(
  '/lessons/:lessonId/questions/text',
  authMiddleware(['teacher', 'admin', 'employee']), checkPermission('question_bank_management'),
  asyncWrapper(async (req, res) => {
    const lessonId = Number(req.params.lessonId);
    const { bulk_text } = req.body;

    if (isNaN(lessonId)) {
      return res.status(400).json({ message: 'Invalid lesson ID' });
    }

    if (!bulk_text || typeof bulk_text !== 'string') {
      return res.status(400).json({ message: 'bulk_text is required and must be a string' });
    }

    // التحقق من أن الدرس يخص المدرس في بنك الأسئلة
    if (req.user!.role === 'teacher') {
      const lessonCheck = await pool.query(
        `SELECT l.*, c.subject_id, s.question_bank_id 
         FROM lessons l 
         JOIN chapters c ON l.chapter_id = c.id 
         JOIN subjects s ON c.subject_id = s.id 
         WHERE l.id = $1`,
        [lessonId],
      );

      if (!lessonCheck.rowCount) {
        return res.status(404).json({ message: 'الدرس غير موجود' });
      }

      const lesson = lessonCheck.rows[0];

      // التحقق من صلاحيات المدرس
      const permissionCheck = await pool.query(
        `SELECT * FROM teacher_permissions 
         WHERE teacher_id = $1 AND subject_id = $2 AND is_active = true`,
        [req.user!.id, lesson.subject_id],
      );

      if (!permissionCheck.rowCount) {
        return res.status(403).json({ message: 'ليس لديك صلاحية لإدارة هذا الدرس' });
      }
    }

    const questions = await LessonQuestionsService.createTextQuestionsForQuestionBankLesson(
      bulk_text,
      lessonId,
    );

    res.json({
      success: true,
      data: questions,
    });
  }),
);

// إضافة أسئلة بالصور للدرس في بنك الأسئلة
router.post(
  '/lessons/:lessonId/questions/images',
  authMiddleware(['teacher', 'admin', 'employee']), checkPermission('question_bank_management'),
  uploadExamImage.array('images', 10), // يسمح برفع حتى 10 صور
  asyncWrapper(async (req, res) => {
    const files = req.files as Express.Multer.File[];
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
    if (req.user!.role === 'teacher') {
      const lessonCheck = await pool.query(
        `SELECT l.*, c.subject_id, s.question_bank_id 
         FROM lessons l 
         JOIN chapters c ON l.chapter_id = c.id 
         JOIN subjects s ON c.subject_id = s.id 
         WHERE l.id = $1`,
        [lessonId],
      );

      if (!lessonCheck.rowCount) {
        return res.status(404).json({ message: 'الدرس غير موجود في بنك الأسئلة' });
      }

      const lesson = lessonCheck.rows[0];

      // التحقق من صلاحيات المدرس للمادة
      const permissionCheck = await pool.query(
        `SELECT id FROM teacher_permissions 
         WHERE teacher_id = $1 AND subject_id = $2 AND question_bank_id = $3 AND is_active = true`,
        [req.user!.id, lesson.subject_id, lesson.question_bank_id],
      );

      if (!permissionCheck.rowCount) {
        return res
          .status(403)
          .json({ message: 'ليس لديك صلاحية لإضافة أسئلة لهذا الدرس في بنك الأسئلة' });
      }
    }

    try {
      const questions = await LessonQuestionsService.createImageQuestionsForQuestionBankLesson(
        files,
        lessonId,
      );
      res.status(201).json({ success: true, data: questions });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }),
);

// إضافة أسئلة بالصور للدرس (API قديم)
router.post(
  '/lecture-question/',
  authMiddleware(['teacher', 'admin', 'employee']), checkPermission('question_bank_management'),
  uploadExamImage.array('images', 10), // يسمح برفع حتى 10 صور
  asyncWrapper(async (req, res) => {
    const files = req.files as Express.Multer.File[];
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
    if (req.user!.role === 'teacher' && lecture_id) {
      const lectureCheck = await pool.query(
        'SELECT l.*, c.teacher_id FROM lectures l JOIN courses c ON l.course_id = c.id WHERE l.id = $1',
        [lecture_id],
      );

      if (!lectureCheck.rowCount || lectureCheck.rows[0].teacher_id !== req.user!.id) {
        return res.status(403).json({ message: 'ليس لديك صلاحية لإضافة أسئلة لهذا الدرس' });
      }
    }

    try {
      const questions = await LessonQuestionsService.createImageQuestionsForLesson(
        files,
        lecture_id ? Number(lecture_id) : undefined,
      );
      res.status(201).json(questions);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }),
);

// جلب تفاصيل درس (بيانات الدرس + الأسئلة)
router.get(
  '/lecture/:lectureId/details',
  authMiddleware(['teacher', 'admin', 'student', 'employee']),
  asyncWrapper(async (req, res) => {
    const lectureId = Number(req.params.lectureId);
    if (isNaN(lectureId)) {
      return res.status(400).json({ message: 'Invalid lecture ID' });
    }

    // التحقق من الصلاحيات
    if (req.user!.role === 'teacher') {
      const lectureCheck = await pool.query(
        'SELECT l.*, c.teacher_id FROM lectures l JOIN courses c ON l.course_id = c.id WHERE l.id = $1',
        [lectureId],
      );

      if (!lectureCheck.rowCount || lectureCheck.rows[0].teacher_id !== req.user!.id) {
        return res.status(403).json({ message: 'ليس لديك صلاحية للوصول لهذا الدرس' });
      }
    }

    if (req.user!.role === 'student') {
      // التحقق من أن الطالب مسجل في الكورس
      const enrollmentCheck = await pool.query(
        'SELECT e.id FROM enrollments e JOIN lectures l ON e.course_id = l.course_id WHERE e.user_id = $1 AND l.id = $2',
        [req.user!.id, lectureId],
      );

      if (!enrollmentCheck.rowCount) {
        return res.status(403).json({ message: 'لست مسجلاً في هذا الكورس' });
      }
    }

    try {
      const result = await LessonQuestionsService.getLessonDetails(lectureId);
      res.json(result);
    } catch (error: any) {
      res.status(404).json({ message: error.message });
    }
  }),
);

// تعديل نص السؤال أو درجته أو صورته
router.patch(
  '/lecture-question/:questionId',
  authMiddleware(['teacher', 'admin', 'employee']), checkPermission('question_bank_management'),
  uploadExamImage.single('image'),
  asyncWrapper(async (req, res) => {
    const questionId = Number(req.params.questionId);
    const { question_text, grade } = req.body;
    const image = req.file ? req.file.filename : undefined;

    if (isNaN(questionId)) {
      return res.status(400).json({ message: 'Invalid question ID' });
    }

    // التحقق من أن السؤال يخص المدرس
    if (req.user!.role === 'teacher') {
      const questionCheck = await pool.query(
        `SELECT lq.*, c.teacher_id 
         FROM lesson_questions lq
         JOIN lectures l ON lq.lecture_id = l.id
         JOIN courses c ON l.course_id = c.id
         WHERE lq.id = $1`,
        [questionId],
      );

      if (!questionCheck.rowCount || questionCheck.rows[0].teacher_id !== req.user!.id) {
        return res.status(403).json({ message: 'ليس لديك صلاحية لتعديل هذا السؤال' });
      }
    }

    try {
      const result = await LessonQuestionsService.updateLessonQuestion(
        questionId,
        question_text,
        grade,
        image,
      );
      res.json(result);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }),
);

// تحديد الإجابة الصحيحة
router.patch(
  '/lecture-question/:questionId/answer',
  authMiddleware(['teacher', 'admin', 'employee']), checkPermission('question_bank_management'),
  asyncWrapper(async (req, res) => {
    const questionId = Number(req.params.questionId);
    const { correct_answer } = req.body;
    if (isNaN(questionId) || isNaN(correct_answer)) {
      return res.status(400).json({ message: 'Invalid question ID or choice ID' });
    }

    // التحقق من أن السؤال يخص المدرس
    if (req.user!.role === 'teacher') {
      const questionCheck = await pool.query(
        `SELECT lq.*, c.teacher_id 
         FROM lesson_questions lq
         JOIN lectures l ON lq.lecture_id = l.id
         JOIN courses c ON l.course_id = c.id
         WHERE lq.id = $1`,
        [questionId],
      );

      if (!questionCheck.rowCount || questionCheck.rows[0].teacher_id !== req.user!.id) {
        return res.status(403).json({ message: 'ليس لديك صلاحية لتعديل هذا السؤال' });
      }
    }

    try {
      const result = await LessonQuestionsService.setLessonQuestionCorrectAnswer(
        questionId,
        correct_answer,
      );
      res.json(result);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }),
);

// حذف سؤال
router.delete(
  '/lecture-question/:questionId',
  authMiddleware(['teacher', 'admin', 'employee']), checkPermission('question_bank_management'),
  asyncWrapper(async (req, res) => {
    const questionId = Number(req.params.questionId);
    if (isNaN(questionId)) {
      return res.status(400).json({ message: 'Invalid question ID' });
    }

    // التحقق من أن السؤال يخص المدرس
    if (req.user!.role === 'teacher') {
      const questionCheck = await pool.query(
        `SELECT lq.*, c.teacher_id 
         FROM lesson_questions lq
         JOIN lectures l ON lq.lecture_id = l.id
         JOIN courses c ON l.course_id = c.id
         WHERE lq.id = $1`,
        [questionId],
      );

      if (!questionCheck.rowCount || questionCheck.rows[0].teacher_id !== req.user!.id) {
        return res.status(403).json({ message: 'ليس لديك صلاحية لحذف هذا السؤال' });
      }
    }

    try {
      const result = await LessonQuestionsService.deleteLessonQuestion(questionId);
      res.json(result);
    } catch (error: any) {
      res.status(404).json({ message: error.message });
    }
  }),
);

// حذف سؤال من درس في بنك الأسئلة
router.delete(
  '/questions/:questionId',
  authMiddleware(['teacher', 'admin', 'employee']), checkPermission('question_bank_management'),
  asyncWrapper(async (req, res) => {
    const questionId = Number(req.params.questionId);

    if (isNaN(questionId)) {
      return res.status(400).json({ message: 'Invalid question ID' });
    }

    // التحقق من أن السؤال يخص المدرس
    if (req.user!.role === 'teacher') {
      const questionCheck = await pool.query(
        `SELECT q.*, l.id as lesson_id, c.subject_id 
         FROM questions q 
         JOIN lessons l ON q.lesson_id = l.id 
         JOIN chapters c ON l.chapter_id = c.id 
         WHERE q.id = $1`,
        [questionId],
      );

      if (!questionCheck.rowCount) {
        return res.status(404).json({ message: 'السؤال غير موجود' });
      }

      const question = questionCheck.rows[0];

      // التحقق من صلاحيات المدرس
      const permissionCheck = await pool.query(
        `SELECT * FROM teacher_permissions 
         WHERE teacher_id = $1 AND subject_id = $2 AND is_active = true`,
        [req.user!.id, question.subject_id],
      );

      if (!permissionCheck.rowCount) {
        return res.status(403).json({ message: 'ليس لديك صلاحية لحذف هذا السؤال' });
      }
    }

    const result = await LessonQuestionsService.deleteQuestionFromLesson(questionId);

    res.json({
      success: true,
      message: result.message,
    });
  }),
);

// تعديل سؤال من درس في بنك الأسئلة
router.put(
  '/questions/:questionId',
  authMiddleware(['teacher', 'admin', 'employee']), checkPermission('question_bank_management'),
  asyncWrapper(async (req, res) => {
    const questionId = Number(req.params.questionId);
    const { text, image, options, correct_answer } = req.body;

    if (isNaN(questionId)) {
      return res.status(400).json({ message: 'Invalid question ID' });
    }

    // التحقق من أن السؤال يخص المدرس
    if (req.user!.role === 'teacher') {
      const questionCheck = await pool.query(
        `SELECT q.*, l.id as lesson_id, c.subject_id 
         FROM questions q 
         JOIN lessons l ON q.lesson_id = l.id 
         JOIN chapters c ON l.chapter_id = c.id 
         WHERE q.id = $1`,
        [questionId],
      );

      if (!questionCheck.rowCount) {
        return res.status(404).json({ message: 'السؤال غير موجود' });
      }

      const question = questionCheck.rows[0];

      // التحقق من صلاحيات المدرس
      const permissionCheck = await pool.query(
        `SELECT * FROM teacher_permissions 
         WHERE teacher_id = $1 AND subject_id = $2 AND is_active = true`,
        [req.user!.id, question.subject_id],
      );

      if (!permissionCheck.rowCount) {
        return res.status(403).json({ message: 'ليس لديك صلاحية لتعديل هذا السؤال' });
      }
    }

    const updateData: any = {};
    if (text !== undefined) updateData.text = text;
    if (image !== undefined) updateData.image = image;
    if (options !== undefined) updateData.options = options;
    if (correct_answer !== undefined) updateData.correct_answer = correct_answer;

    const result = await LessonQuestionsService.updateQuestionFromLesson(questionId, updateData);

    res.json({
      success: true,
      message: result.message,
    });
  }),
);

// تحديد الإجابة الصحيحة للسؤال
router.post(
  '/questions/:questionId/answer',
  authMiddleware(['teacher', 'admin', 'employee']), checkPermission('question_bank_management'),
  asyncWrapper(async (req, res) => {
    const questionId = Number(req.params.questionId);
    const { correctChoiceId } = req.body;

    if (isNaN(questionId)) {
      return res.status(400).json({ message: 'Invalid question ID' });
    }

    if (correctChoiceId === undefined || correctChoiceId === null) {
      return res.status(400).json({ message: 'correctChoiceId is required' });
    }

    // التحقق من أن السؤال يخص المدرس
    if (req.user!.role === 'teacher') {
      const questionCheck = await pool.query(
        `SELECT q.*, l.id as lesson_id, c.subject_id 
         FROM questions q 
         JOIN lessons l ON q.lesson_id = l.id 
         JOIN chapters c ON l.chapter_id = c.id 
         WHERE q.id = $1`,
        [questionId],
      );

      if (!questionCheck.rowCount) {
        return res.status(404).json({ message: 'السؤال غير موجود' });
      }

      const question = questionCheck.rows[0];

      // التحقق من صلاحيات المدرس
      const permissionCheck = await pool.query(
        `SELECT * FROM teacher_permissions 
         WHERE teacher_id = $1 AND subject_id = $2 AND is_active = true`,
        [req.user!.id, question.subject_id],
      );

      if (!permissionCheck.rowCount) {
        return res.status(403).json({ message: 'ليس لديك صلاحية لتعديل هذا السؤال' });
      }
    }

    const result = await LessonQuestionsService.setLessonQuestionCorrectAnswer(
      questionId,
      correctChoiceId,
    );

    res.json({
      success: true,
      message: result.message,
    });
  }),
);
