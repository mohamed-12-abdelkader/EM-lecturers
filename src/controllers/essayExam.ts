import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/authentication';
import { asyncWrapper } from '../utils';
import { EssayExamService } from '../services/essayExam';
import { NotificationService } from '../services/notifications';
import pool from '../db/pool';

const router = Router();

// إنشاء امتحان مقالي جديد (للمدرس)
router.post(
  '/lectures/:lectureId/exams',
  authMiddleware(['teacher', 'admin']),
  asyncWrapper(async (req, res) => {
    const lectureId = Number(req.params.lectureId);
    if (isNaN(lectureId)) {
      return res.status(400).json({ message: 'Invalid lecture ID' });
    }

    const schema = z.object({
      title: z.string().min(1, 'Title is required'),
      description: z.string().optional(),
      is_visible: z.boolean().default(true),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: 'Invalid payload',
        errors: parsed.error.flatten(),
      });
    }

    // التحقق من أن المحاضرة موجودة وأن المدرس يملكها
    const lectureCheck = await pool.query(
      'SELECT l.id FROM lectures l JOIN courses c ON l.course_id = c.id WHERE l.id = $1 AND c.teacher_id = $2',
      [lectureId, req.user!.id],
    );

    if (lectureCheck.rowCount === 0) {
      return res.status(404).json({ message: 'Lecture not found or access denied' });
    }

    const exam = await EssayExamService.createExam(
      lectureId,
      parsed.data.title,
      parsed.data.description || null,
      parsed.data.is_visible,
      req.user!.id,
    );

    // إرسال إشعار للطلاب إذا كان الامتحان ظاهر
    if (parsed.data.is_visible) {
      try {
        // جلب معلومات المحاضرة والكورس
        const lectureInfo = await pool.query(
          `SELECT l.title as lecture_title, c.id as course_id, c.title as course_title
           FROM lectures l
           JOIN courses c ON l.course_id = c.id
           WHERE l.id = $1`,
          [lectureId],
        );

        if (lectureInfo.rowCount && lectureInfo.rowCount > 0) {
          await NotificationService.notifyEssayExamCreated(
            lectureInfo.rows[0].course_id,
            parsed.data.title,
            lectureInfo.rows[0].lecture_title,
            req.user!.id,
          );
        }
      } catch (error) {
        console.error('خطأ في إرسال إشعار الامتحان المقالي:', error);
      }
    }

    res.status(201).json({ exam });
  }),
);

// جلب امتحانات محاضرة معينة
router.get(
  '/lectures/:lectureId/exams',
  authMiddleware(),
  asyncWrapper(async (req, res) => {
    const lectureId = Number(req.params.lectureId);
    if (isNaN(lectureId)) {
      return res.status(400).json({ message: 'Invalid lecture ID' });
    }

    const exams = await EssayExamService.getExamsByLecture(lectureId, req.user!.id, req.user!.role);

    res.json({ exams });
  }),
);

// جلب امتحان معين بالتفصيل
router.get(
  '/exams/:examId',
  authMiddleware(),
  asyncWrapper(async (req, res) => {
    const examId = Number(req.params.examId);
    if (isNaN(examId)) {
      return res.status(400).json({ message: 'Invalid exam ID' });
    }

    const exam = await EssayExamService.getExamById(examId, req.user!.id, req.user!.role);

    if (!exam) {
      return res.status(404).json({ message: 'Exam not found or access denied' });
    }

    // جلب الأسئلة إذا كان المستخدم مدرس أو إدمن
    let questions: any[] = [];
    let message = '';
    let status = '';

    if (req.user!.role === 'teacher' || req.user!.role === 'admin') {
      questions = await EssayExamService.getQuestionsByExam(examId);
    } else if (req.user!.role === 'student') {
      // للطلاب: التحقق من حالة الإجابة
      const answers = await EssayExamService.getStudentAnswers(examId, req.user!.id);
      const grade = await EssayExamService.getStudentGrade(examId, req.user!.id);

      if (answers.length > 0) {
        if (grade) {
          // تم التصحيح
          message = 'تم تصحيح إجابتك';
          status = 'graded';
        } else {
          // في انتظار التصحيح
          message = 'جار تصحيح الأسئلة';
          status = 'pending';
        }
      } else {
        // لم يرسل إجابة بعد
        questions = await EssayExamService.getQuestionsByExam(examId);
        message = 'يمكنك الآن حل الأسئلة';
        status = 'available';
      }
    }

    res.json({ exam, questions, message, status });
  }),
);

// تحديث امتحان مقالي (للمدرس)
router.put(
  '/exams/:examId',
  authMiddleware(['teacher', 'admin']),
  asyncWrapper(async (req, res) => {
    const examId = Number(req.params.examId);
    if (isNaN(examId)) {
      return res.status(400).json({ message: 'Invalid exam ID' });
    }

    const schema = z.object({
      title: z.string().min(1, 'Title is required'),
      description: z.string().optional(),
      is_visible: z.boolean(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: 'Invalid payload',
        errors: parsed.error.flatten(),
      });
    }

    const exam = await EssayExamService.updateExam(
      examId,
      parsed.data.title,
      parsed.data.description || null,
      parsed.data.is_visible,
      req.user!.id,
    );

    if (!exam) {
      return res.status(404).json({ message: 'Exam not found or access denied' });
    }

    res.json({ exam });
  }),
);

// حذف امتحان مقالي (للمدرس)
router.delete(
  '/exams/:examId',
  authMiddleware(['teacher', 'admin']),
  asyncWrapper(async (req, res) => {
    const examId = Number(req.params.examId);
    if (isNaN(examId)) {
      return res.status(400).json({ message: 'Invalid exam ID' });
    }

    const deleted = await EssayExamService.deleteExam(examId, req.user!.id);
    if (!deleted) {
      return res.status(404).json({ message: 'Exam not found or access denied' });
    }

    res.json({ message: 'Exam deleted successfully' });
  }),
);

// إضافة سؤال مقالي
router.post(
  '/exams/:examId/questions',
  authMiddleware(['teacher', 'admin']),
  asyncWrapper(async (req, res) => {
    const examId = Number(req.params.examId);
    if (isNaN(examId)) {
      return res.status(400).json({ message: 'Invalid exam ID' });
    }

    const schema = z.object({
      question_text: z.string().min(1, 'Question text is required'),
      order_index: z.number().int().min(0).default(0),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: 'Invalid payload',
        errors: parsed.error.flatten(),
      });
    }

    const question = await EssayExamService.addQuestion(
      examId,
      parsed.data.question_text,
      parsed.data.order_index,
      req.user!.id,
    );

    if (!question) {
      return res.status(404).json({ message: 'Exam not found or access denied' });
    }

    res.status(201).json({ question });
  }),
);

// تحديث سؤال مقالي
router.put(
  '/questions/:questionId',
  authMiddleware(['teacher', 'admin']),
  asyncWrapper(async (req, res) => {
    const questionId = Number(req.params.questionId);
    if (isNaN(questionId)) {
      return res.status(400).json({ message: 'Invalid question ID' });
    }

    const schema = z.object({
      question_text: z.string().min(1, 'Question text is required'),
      order_index: z.number().int().min(0),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: 'Invalid payload',
        errors: parsed.error.flatten(),
      });
    }

    const question = await EssayExamService.updateQuestion(
      questionId,
      parsed.data.question_text,
      parsed.data.order_index,
      req.user!.id,
    );

    if (!question) {
      return res.status(404).json({ message: 'Question not found or access denied' });
    }

    res.json({ question });
  }),
);

// حذف سؤال مقالي
router.delete(
  '/questions/:questionId',
  authMiddleware(['teacher', 'admin']),
  asyncWrapper(async (req, res) => {
    const questionId = Number(req.params.questionId);
    if (isNaN(questionId)) {
      return res.status(400).json({ message: 'Invalid question ID' });
    }

    const deleted = await EssayExamService.deleteQuestion(questionId, req.user!.id);
    if (!deleted) {
      return res.status(404).json({ message: 'Question not found or access denied' });
    }

    res.json({ message: 'Question deleted successfully' });
  }),
);

// جلب أسئلة امتحان معين
router.get(
  '/exams/:examId/questions',
  authMiddleware(),
  asyncWrapper(async (req, res) => {
    const examId = Number(req.params.examId);
    if (isNaN(examId)) {
      return res.status(400).json({ message: 'Invalid exam ID' });
    }

    // التحقق من صلاحية الوصول للامتحان
    const exam = await EssayExamService.getExamById(examId, req.user!.id, req.user!.role);

    if (!exam) {
      return res.status(404).json({ message: 'Exam not found or access denied' });
    }

    let questions: any[] = [];
    let message = '';
    let status = '';

    if (req.user!.role === 'teacher' || req.user!.role === 'admin') {
      // المدرسون والإدمن يرون الأسئلة دائماً
      questions = await EssayExamService.getQuestionsByExam(examId);
      message = 'أسئلة الامتحان';
      status = 'available';
    } else if (req.user!.role === 'student') {
      // للطلاب: التحقق من حالة الإجابة
      const answers = await EssayExamService.getStudentAnswers(examId, req.user!.id);
      const grade = await EssayExamService.getStudentGrade(examId, req.user!.id);

      if (answers.length > 0) {
        if (grade) {
          // تم التصحيح - إخفاء الأسئلة
          message = 'تم تصحيح إجابتك';
          status = 'graded';
        } else {
          // في انتظار التصحيح - إخفاء الأسئلة
          message = 'جار تصحيح الأسئلة';
          status = 'pending';
        }
      } else {
        // لم يرسل إجابة بعد - عرض الأسئلة
        questions = await EssayExamService.getQuestionsByExam(examId);
        message = 'يمكنك الآن حل الأسئلة';
        status = 'available';
      }
    }

    res.json({ questions, message, status });
  }),
);

// إرسال إجابة طالب
router.post(
  '/exams/:examId/answers',
  authMiddleware(['student']),
  asyncWrapper(async (req, res) => {
    const examId = Number(req.params.examId);
    if (isNaN(examId)) {
      return res.status(400).json({ message: 'Invalid exam ID' });
    }

    const schema = z.object({
      question_id: z.number().int().positive('Question ID is required'),
      answer_text: z.string().min(1, 'Answer text is required'),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: 'Invalid payload',
        errors: parsed.error.flatten(),
      });
    }

    // التحقق من أن الامتحان موجود وظاهر
    const exam = await EssayExamService.getExamById(examId, req.user!.id, req.user!.role);

    if (!exam) {
      return res.status(404).json({ message: 'Exam not found or not visible' });
    }

    const answer = await EssayExamService.submitAnswer(
      examId,
      req.user!.id,
      parsed.data.question_id,
      parsed.data.answer_text,
    );

    // التحقق من حالة التصحيح
    const grade = await EssayExamService.getStudentGrade(examId, req.user!.id);
    const isGraded = grade !== null;

    res.status(201).json({
      answer,
      message: isGraded ? 'تم تصحيح إجابتك' : 'تم إرسال إجابتك بنجاح، في انتظار تصحيح المعلم',
      status: isGraded ? 'graded' : 'pending',
      grade: isGraded ? grade : null,
    });
  }),
);

// جلب إجابات طالب على امتحان معين
router.get(
  '/exams/:examId/my-answers',
  authMiddleware(['student']),
  asyncWrapper(async (req, res) => {
    const examId = Number(req.params.examId);
    if (isNaN(examId)) {
      return res.status(400).json({ message: 'Invalid exam ID' });
    }

    const answers = await EssayExamService.getStudentAnswers(examId, req.user!.id);

    // التحقق من حالة التصحيح
    const grade = await EssayExamService.getStudentGrade(examId, req.user!.id);
    const isGraded = grade !== null;

    res.json({
      answers,
      status: isGraded ? 'graded' : 'pending',
      message: isGraded ? 'تم تصحيح إجابتك' : 'إجابتك في انتظار تصحيح المعلم',
      grade: isGraded ? grade : null,
    });
  }),
);

// جلب الطلاب الذين حلوا امتحان معين (للمدرس)
router.get(
  '/exams/:examId/students',
  authMiddleware(['teacher', 'admin']),
  asyncWrapper(async (req, res) => {
    const examId = Number(req.params.examId);
    if (isNaN(examId)) {
      return res.status(400).json({ message: 'Invalid exam ID' });
    }

    const students = await EssayExamService.getStudentsWhoAnswered(examId, req.user!.id);
    res.json({ students });
  }),
);

// جلب إجابات طالب معين (للمدرس)
router.get(
  '/exams/:examId/students/:studentId/answers',
  authMiddleware(['teacher', 'admin']),
  asyncWrapper(async (req, res) => {
    const examId = Number(req.params.examId);
    const studentId = Number(req.params.studentId);

    if (isNaN(examId) || isNaN(studentId)) {
      return res.status(400).json({ message: 'Invalid exam or student ID' });
    }

    const answers = await EssayExamService.getStudentAnswers(examId, studentId);
    res.json({ answers });
  }),
);

// تصحيح إجابات طالب (للمدرس)
router.post(
  '/exams/:examId/students/:studentId/grade',
  authMiddleware(['teacher', 'admin']),
  asyncWrapper(async (req, res) => {
    const examId = Number(req.params.examId);
    const studentId = Number(req.params.studentId);

    if (isNaN(examId) || isNaN(studentId)) {
      return res.status(400).json({ message: 'Invalid exam or student ID' });
    }

    const schema = z.object({
      total_grade: z.number().min(0, 'Total grade must be non-negative'),
      max_grade: z.number().positive('Max grade must be positive'),
      feedback: z.string().optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: 'Invalid payload',
        errors: parsed.error.flatten(),
      });
    }

    // التحقق من أن المدرس يملك الامتحان
    const examCheck = await pool.query(
      'SELECT id FROM essay_exams WHERE id = $1 AND created_by = $2',
      [examId, req.user!.id],
    );

    if (examCheck.rowCount === 0) {
      return res.status(404).json({ message: 'Exam not found or access denied' });
    }

    const grade = await EssayExamService.gradeStudent(
      examId,
      studentId,
      parsed.data.total_grade,
      parsed.data.max_grade,
      parsed.data.feedback || null,
      req.user!.id,
    );

    // إرسال إشعار للطالب
    try {
      // const studentResult = await pool.query('SELECT name FROM users WHERE id = $1', [studentId]);
      // const studentName = studentResult.rows[0]?.name || 'الطالب';

      await NotificationService.sendNotification(
        studentId,
        'تم تصحيح امتحانك',
        `تم تصحيح امتحانك وحصلت على ${parsed.data.total_grade}/${parsed.data.max_grade}`,
        'exam_graded',
        undefined,
        undefined,
        undefined,
        undefined,
        req.user!.id,
      );
    } catch (error) {
      console.error('خطأ في إرسال إشعار التصحيح:', error);
    }

    res.json({ grade });
  }),
);

// جلب درجات طالب في امتحان معين
router.get(
  '/exams/:examId/my-grade',
  authMiddleware(['student']),
  asyncWrapper(async (req, res) => {
    const examId = Number(req.params.examId);
    if (isNaN(examId)) {
      return res.status(400).json({ message: 'Invalid exam ID' });
    }

    const grade = await EssayExamService.getStudentGrade(examId, req.user!.id);

    if (grade) {
      res.json({
        grade,
        status: 'graded',
        message: 'تم تصحيح إجابتك',
      });
    } else {
      res.json({
        grade: null,
        status: 'pending',
        message: 'إجابتك في انتظار تصحيح المعلم',
      });
    }
  }),
);

// جلب جميع درجات طالب
router.get(
  '/my-grades',
  authMiddleware(['student']),
  asyncWrapper(async (req, res) => {
    const grades = await EssayExamService.getStudentAllGrades(req.user!.id);
    res.json({ grades });
  }),
);

// جلب تقرير مفصل للطالب (للمدرس)
router.get(
  '/exams/:examId/students/:studentId/report',
  authMiddleware(['teacher', 'admin']),
  asyncWrapper(async (req, res) => {
    const examId = Number(req.params.examId);
    const studentId = Number(req.params.studentId);

    if (isNaN(examId) || isNaN(studentId)) {
      return res.status(400).json({ message: 'Invalid exam or student ID' });
    }

    // التحقق من أن المدرس يملك الامتحان
    const examCheck = await pool.query(
      'SELECT id FROM essay_exams WHERE id = $1 AND created_by = $2',
      [examId, req.user!.id],
    );

    if (examCheck.rowCount === 0) {
      return res.status(404).json({ message: 'Exam not found or access denied' });
    }

    // جلب معلومات الامتحان
    const examResult = await pool.query(
      `SELECT e.*, l.title as lecture_title, c.title as course_title
       FROM essay_exams e
       JOIN lectures l ON e.lecture_id = l.id
       JOIN courses c ON l.course_id = c.id
       WHERE e.id = $1`,
      [examId],
    );

    if (examResult.rowCount === 0) {
      return res.status(404).json({ message: 'Exam not found' });
    }

    // جلب الأسئلة مع إجابات الطالب
    const questionsResult = await pool.query(
      `SELECT 
         q.id as question_id,
         q.question_text,
         q.order_index,
         a.answer_text,
         a.submitted_at
       FROM essay_questions q
       LEFT JOIN essay_answers a ON q.id = a.question_id AND a.student_id = $2
       WHERE q.exam_id = $1
       ORDER BY q.order_index, q.id`,
      [examId, studentId],
    );

    // جلب الدرجة إذا كانت موجودة
    const grade = await EssayExamService.getStudentGrade(examId, studentId);

    res.json({
      exam: examResult.rows[0],
      questions: questionsResult.rows,
      grade: grade,
      status: grade ? 'graded' : 'pending',
      message: grade ? 'تم تصحيح إجابتك' : 'إجابتك في انتظار تصحيح المعلم',
    });
  }),
);

// جلب تقرير مفصل للطالب (للطالب نفسه)
router.get(
  '/exams/:examId/my-report',
  authMiddleware(['student']),
  asyncWrapper(async (req, res) => {
    const examId = Number(req.params.examId);
    if (isNaN(examId)) {
      return res.status(400).json({ message: 'Invalid exam ID' });
    }

    // جلب معلومات الامتحان
    const examResult = await pool.query(
      `SELECT e.*, l.title as lecture_title, c.title as course_title
       FROM essay_exams e
       JOIN lectures l ON e.lecture_id = l.id
       JOIN courses c ON l.course_id = c.id
       WHERE e.id = $1`,
      [examId],
    );

    if (examResult.rowCount === 0) {
      return res.status(404).json({ message: 'Exam not found' });
    }

    // جلب الأسئلة مع إجابات الطالب
    const questionsResult = await pool.query(
      `SELECT 
         q.id as question_id,
         q.question_text,
         q.order_index,
         a.answer_text,
         a.submitted_at
       FROM essay_questions q
       LEFT JOIN essay_answers a ON q.id = a.question_id AND a.student_id = $2
       WHERE q.exam_id = $1
       ORDER BY q.order_index, q.id`,
      [examId, req.user!.id],
    );

    // جلب الدرجة إذا كانت موجودة
    const grade = await EssayExamService.getStudentGrade(examId, req.user!.id);

    res.json({
      exam: examResult.rows[0],
      questions: questionsResult.rows,
      grade: grade,
      status: grade ? 'graded' : 'pending',
      message: grade ? 'تم تصحيح إجابتك' : 'إجابتك في انتظار تصحيح المعلم',
    });
  }),
);

export default router;
