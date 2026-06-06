import { Router } from 'express';
import { checkPermission } from '../middleware/permissions';
import { authMiddleware } from '../middleware/authentication';
import { asyncWrapper, uploadExamImage, uploadToCloudinary } from '../utils';
import { QuestionsManagementService } from '../services/questionsManagement';
import pool from '../db/pool';

export const router = Router();

// إضافة أسئلة دفعة واحدة
router.post(
  '/bulk',
  authMiddleware(['teacher', 'admin', 'employee']), checkPermission('question_bank_management'),
  asyncWrapper(async (req, res) => {
    const { bulk_text } = req.body;

    if (!bulk_text || typeof bulk_text !== 'string') {
      return res.status(400).json({ message: 'bulk_text is required and must be a string' });
    }

    try {
      const result = await QuestionsManagementService.createBulkQuestions(bulk_text);
      res.status(201).json(result);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }),
);

// إضافة أسئلة دفعة واحدة لامتحان محاضرة معينة
router.post(
  '/lecture-exam/:examId/bulk',
  authMiddleware(['teacher', 'admin', 'employee']), checkPermission('question_bank_management'),
  asyncWrapper(async (req, res) => {
    const examId = Number(req.params.examId);
    const { bulk_text } = req.body;

    if (isNaN(examId)) {
      return res.status(400).json({ message: 'Invalid exam ID' });
    }

    if (!bulk_text || typeof bulk_text !== 'string') {
      return res.status(400).json({ message: 'bulk_text is required and must be a string' });
    }

    try {
      const result = await QuestionsManagementService.createBulkQuestionsForLectureExam(
        examId,
        bulk_text,
      );
      res.status(201).json(result);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }),
);

// جلب أسئلة امتحان محاضرة معين
router.get(
  '/lecture-exam/:examId/questions',
  authMiddleware(['teacher', 'admin', 'student']),
  asyncWrapper(async (req, res) => {
    const examId = Number(req.params.examId);

    if (isNaN(examId)) {
      return res.status(400).json({ message: 'Invalid exam ID' });
    }

    try {
      // جلب بيانات الامتحان أولاً
      let duration = null;
      try {
        const examRes = await pool.query(
          "SELECT duration FROM exams WHERE id = $1 AND type = 'exam'",
          [examId],
        );
        if (!examRes.rowCount) {
          console.error('امتحان المحاضرة غير موجود أو النوع غير صحيح examId=', examId);
          return res.status(404).json({ message: 'امتحان المحاضرة غير موجود' });
        }
        duration = examRes.rows[0].duration ?? null;
      } catch (err) {
        console.error('خطأ أثناء جلب مدة الامتحان:', err);
        duration = null;
      }
      const questions = await QuestionsManagementService.getLectureExamQuestions(examId);
      res.json({ questions, duration });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  }),
);

// جلب جميع الأسئلة
router.get(
  '/',
  authMiddleware(['teacher', 'admin', 'employee']), checkPermission('question_bank_management'),
  asyncWrapper(async (req, res) => {
    const questions = await QuestionsManagementService.getAllQuestions();
    res.json(questions);
  }),
);

// جلب سؤال واحد
router.get(
  '/:id',
  authMiddleware(['teacher', 'admin', 'employee']), checkPermission('question_bank_management'),
  asyncWrapper(async (req, res) => {
    const questionId = Number(req.params.id);

    if (isNaN(questionId)) {
      return res.status(400).json({ message: 'Invalid question ID' });
    }

    try {
      const question = await QuestionsManagementService.getQuestionById(questionId);
      res.json(question);
    } catch (error: any) {
      res.status(404).json({ message: error.message });
    }
  }),
);

// تحديث الإجابة الصحيحة لسؤال
router.patch(
  '/:id/answer',
  authMiddleware(['teacher', 'admin', 'employee']), checkPermission('question_bank_management'),
  asyncWrapper(async (req, res) => {
    const questionId = Number(req.params.id);
    const { correctOption } = req.body;

    if (isNaN(questionId)) {
      return res.status(400).json({ message: 'Invalid question ID' });
    }

    if (!correctOption || typeof correctOption !== 'string') {
      return res.status(400).json({ message: 'correctOption is required and must be a string' });
    }

    try {
      const question = await QuestionsManagementService.updateCorrectAnswer(
        questionId,
        correctOption,
      );
      res.json(question);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }),
);

// حذف سؤال
router.delete(
  '/:id',
  authMiddleware(['teacher', 'admin', 'employee']), checkPermission('question_bank_management'),
  asyncWrapper(async (req, res) => {
    const questionId = Number(req.params.id);

    if (isNaN(questionId)) {
      return res.status(400).json({ message: 'Invalid question ID' });
    }

    try {
      const result = await QuestionsManagementService.deleteQuestion(questionId);
      res.json(result);
    } catch (error: any) {
      res.status(404).json({ message: error.message });
    }
  }),
);

// تحديث سؤال كامل
router.put(
  '/:id',
  authMiddleware(['teacher', 'admin', 'employee']), checkPermission('question_bank_management'),
  asyncWrapper(async (req, res) => {
    const questionId = Number(req.params.id);
    const { questionText, options } = req.body;

    if (isNaN(questionId)) {
      return res.status(400).json({ message: 'Invalid question ID' });
    }

    if (!questionText || typeof questionText !== 'string') {
      return res.status(400).json({ message: 'questionText is required and must be a string' });
    }

    if (!options || typeof options !== 'object') {
      return res.status(400).json({ message: 'options is required and must be an object' });
    }

    try {
      const question = await QuestionsManagementService.updateQuestion(
        questionId,
        questionText,
        options,
      );
      res.json(question);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }),
);

// تعديل نص السؤال أو درجته أو صورته
router.patch(
  '/lecture-exam-question/:questionId',
  authMiddleware(['teacher', 'admin', 'employee']), checkPermission('question_bank_management'),
  uploadExamImage.single('image'),
  asyncWrapper(async (req, res) => {
    const questionId = Number(req.params.questionId);
    const { question_text, grade } = req.body;

    if (isNaN(questionId)) {
      return res.status(400).json({ message: 'Invalid question ID' });
    }

    let imageUrl: string | undefined = undefined;

    // إذا تم رفع صورة، ارفعها على Cloudinary
    if (req.file) {
      try {
        const uploaded = await uploadToCloudinary(req.file.path);
        imageUrl = uploaded.secure_url;
      } catch (uploadError) {
        console.error('Error uploading image to Cloudinary:', uploadError);
        return res.status(500).json({ message: 'فشل في رفع الصورة' });
      }
    }

    try {
      const result = await QuestionsManagementService.updateLectureExamQuestion(
        questionId,
        question_text,
        grade,
        imageUrl,
      );
      res.json(result);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }),
);

// تحديد الإجابة الصحيحة
router.patch(
  '/lecture-exam-question/:questionId/answer',
  authMiddleware(['teacher', 'admin', 'employee']), checkPermission('question_bank_management'),
  asyncWrapper(async (req, res) => {
    const questionId = Number(req.params.questionId);
    const { correct_answer } = req.body;
    if (isNaN(questionId) || isNaN(correct_answer)) {
      return res.status(400).json({ message: 'Invalid question ID or choice ID' });
    }
    try {
      const result = await QuestionsManagementService.setLectureExamQuestionCorrectAnswer(
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
  '/lecture-exam-question/:questionId',
  authMiddleware(['teacher', 'admin', 'employee']), checkPermission('question_bank_management'),
  asyncWrapper(async (req, res) => {
    const questionId = Number(req.params.questionId);
    if (isNaN(questionId)) {
      return res.status(400).json({ message: 'Invalid question ID' });
    }
    try {
      const result = await QuestionsManagementService.deleteLectureExamQuestion(questionId);
      res.json(result);
    } catch (error: any) {
      res.status(404).json({ message: error.message });
    }
  }),
);

// حل امتحان المحاضرة
router.post(
  '/lecture-exam/:examId/submit',
  authMiddleware(['student']),
  asyncWrapper(async (req, res) => {
    const examId = Number(req.params.examId);
    const { answers } = req.body; // answers: [{ questionId, choiceId }]
    const user = req.user;
    if (isNaN(examId) || !Array.isArray(answers)) {
      return res.status(400).json({ message: 'بيانات غير صحيحة' });
    }
    try {
      const result = await QuestionsManagementService.submitLectureExam(examId, user!.id, answers);
      res.json(result);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }),
);

// إضافة سؤال جديد في امتحان المحاضرة مع إمكانية إضافة صورة
router.post(
  '/lecture-exam/:examId/question',
  authMiddleware(['teacher', 'admin', 'employee']), checkPermission('question_bank_management'),
  uploadExamImage.single('image'),
  asyncWrapper(async (req, res) => {
    const examId = Number(req.params.examId);
    const { question_text, grade } = req.body;

    if (isNaN(examId)) {
      return res.status(400).json({ message: 'معرف الامتحان غير صحيح' });
    }

    // يجب إرسال نص السؤال أو صورة على الأقل
    if (!question_text && !req.file) {
      return res.status(400).json({ message: 'يجب إرسال نص السؤال أو صورة على الأقل' });
    }

    try {
      const question = await QuestionsManagementService.addQuestionToLectureExam(
        examId,
        question_text || null,
        req.file || null,
        grade ? Number(grade) : 1,
      );

      res.status(201).json({
        success: true,
        message: 'تم إضافة السؤال بنجاح',
        question,
      });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }),
);

// إضافة أسئلة بالصور لامتحان المحاضرة
router.post(
  '/lecture-exam-question/',
  authMiddleware(['teacher', 'admin', 'employee']), checkPermission('question_bank_management'),
  uploadExamImage.array('images', 10), // يسمح برفع حتى 10 صور
  asyncWrapper(async (req, res) => {
    const files = req.files as Express.Multer.File[];
    const { exam_id } = req.body;

    if (!files || files.length === 0) {
      return res.status(400).json({ message: 'يجب رفع صورة واحدة على الأقل' });
    }

    if (files.length > 10) {
      return res.status(400).json({ message: 'يمكن رفع 10 صور كحد أقصى' });
    }

    if (exam_id && isNaN(Number(exam_id))) {
      return res.status(400).json({ message: 'exam_id يجب أن يكون رقم صحيح' });
    }

    try {
      const questions = await QuestionsManagementService.createImageQuestions(
        files,
        exam_id ? Number(exam_id) : undefined,
      );
      res.status(201).json(questions);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }),
);

// جلب تفاصيل امتحان محاضرة (بيانات الامتحان + الأسئلة)
router.get(
  '/lecture-exam/:examId/details',
  authMiddleware(['teacher', 'admin', 'student']),
  asyncWrapper(async (req, res) => {
    const examId = Number(req.params.examId);
    if (isNaN(examId)) {
      return res.status(400).json({ message: 'Invalid exam ID' });
    }
    // جلب بيانات الامتحان
    const examRes = await pool.query("SELECT * FROM exams WHERE id = $1 AND type = 'exam'", [
      examId,
    ]);
    if (!examRes.rowCount) {
      return res.status(404).json({ message: 'امتحان المحاضرة غير موجود' });
    }
    const exam = examRes.rows[0];
    // جلب الأسئلة
    let questions = [];
    try {
      questions = await QuestionsManagementService.getLectureExamQuestions(examId);
    } catch (_err) {
      questions = [];
    }
    res.json({
      exam: {
        id: exam.id,
        title: exam.title,
        duration: exam.duration ?? null,
        total_grade: exam.total_grade ?? null,
        created_at: exam.created_at,
        lecture_id: exam.lecture_id,
        // أضف أي حقول أخرى تحتاجها
      },
      questions,
    });
  }),
);
