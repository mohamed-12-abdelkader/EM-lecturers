/**
 * API مستقل لاستيراد أسئلة من PDF لدرس في بنك الأسئلة.
 * لا يعدل أي endpoint أو خدمة إضافة أسئلة حالية.
 */
import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { authMiddleware } from '../middleware/authentication';
import { asyncWrapper } from '../utils';
import { LessonPdfQuestionsService } from '../services/lessonPdfQuestions';

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../../uploads');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const name = `${Date.now()}-${(file.originalname || 'document').replace(/[^a-zA-Z0-9.-]/g, '_')}`;
    cb(null, name);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 },
});

export const router = Router();

/** POST /lessons/:lessonId/import-pdf - رفع PDF واستيراد كل صفحة كسؤال صورة */
router.post(
  '/lessons/:lessonId/import-pdf',
  authMiddleware(['teacher', 'admin']),
  upload.single('pdf'),
  asyncWrapper(async (req: Request, res: Response) => {
    const lessonId = Number(req.params.lessonId);
    if (Number.isNaN(lessonId)) {
      return res.status(400).json({ success: false, message: 'معرف الدرس غير صحيح' });
    }
    const file = req.file;
    if (!file) {
      return res.status(400).json({ success: false, message: 'يجب رفع ملف PDF واحد' });
    }
    if (!(file.originalname || '').toLowerCase().endsWith('.pdf')) {
      if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
      return res.status(400).json({ success: false, message: 'يجب أن يكون الملف بصيغة PDF' });
    }
    const userId = (req as any).user.id;
    const userRole = (req as any).user.role;
    try {
      const result = await LessonPdfQuestionsService.importPdfForLesson(
        lessonId,
        file.path,
        file.originalname || 'document.pdf',
        userId,
        userRole,
      );
      if (fs.existsSync(file.path)) {
        try {
          fs.unlinkSync(file.path);
        } catch (_) {
          // .
        }
      }
      return res.status(201).json({
        success: true,
        message: `تم استيراد ${result.imported} سؤال من الملف`,
        data: result,
      });
    } catch (err: any) {
      if (file.path && fs.existsSync(file.path)) {
        try {
          fs.unlinkSync(file.path);
        } catch (_) {
          // .
        }
      }
      if (err.status === 404) return res.status(404).json({ success: false, message: err.message });
      if (err.status === 403) return res.status(403).json({ success: false, message: err.message });
      if (err.status === 400) return res.status(400).json({ success: false, message: err.message });
      throw err;
    }
  }),
);

/** GET /lessons/:lessonId/pdf-questions - جلب أسئلة PDF للدرس (النظام المستقل فقط) */
router.get(
  '/lessons/:lessonId/pdf-questions',
  authMiddleware(['teacher', 'admin', 'student']),
  asyncWrapper(async (req: Request, res: Response) => {
    const lessonId = Number(req.params.lessonId);
    if (Number.isNaN(lessonId)) {
      return res.status(400).json({ success: false, message: 'معرف الدرس غير صحيح' });
    }
    const questions = await LessonPdfQuestionsService.getByLesson(lessonId);
    return res.status(200).json({ success: true, data: questions });
  }),
);

/** PATCH /pdf-questions/:questionId/correct-answer - تحديد الإجابة الصحيحة لسؤال PDF */
router.patch(
  '/pdf-questions/:questionId/correct-answer',
  authMiddleware(['teacher', 'admin']),
  asyncWrapper(async (req: Request, res: Response) => {
    const questionId = Number(req.params.questionId);
    const { correct_answer: correctAnswer } = req.body as { correct_answer?: string };
    if (Number.isNaN(questionId)) {
      return res.status(400).json({ success: false, message: 'معرف السؤال غير صحيح' });
    }
    if (!correctAnswer || typeof correctAnswer !== 'string') {
      return res.status(400).json({ success: false, message: 'correct_answer مطلوب (أ، ب، ج، د)' });
    }
    const userId = (req as any).user.id;
    const userRole = (req as any).user.role;
    try {
      const question = await LessonPdfQuestionsService.setCorrectAnswer(
        questionId,
        correctAnswer.trim(),
        userId,
        userRole,
      );
      return res.status(200).json({ success: true, data: question });
    } catch (err: any) {
      if (err.status === 404) return res.status(404).json({ success: false, message: err.message });
      if (err.status === 403) return res.status(403).json({ success: false, message: err.message });
      if (err.status === 400) return res.status(400).json({ success: false, message: err.message });
      throw err;
    }
  }),
);
