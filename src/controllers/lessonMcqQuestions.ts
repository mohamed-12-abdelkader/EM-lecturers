import { Router } from 'express';
import { authMiddleware } from '../middleware/authentication';
import { asyncWrapper, uploadExamImage, uploadToCloudinary } from '../utils';
import { LessonMcqQuestionsService } from '../services/lessonMcqQuestions';
import { getSubjectIdByLessonId, teacherHasSubjectAccess } from '../services/teacherAccess';

export const router = Router();

// Preferred non-conflicting: POST /lessons/:lessonId/questions/bulk
router.post(
  '/lessons/:lessonId/questions/bulk',
  authMiddleware(['teacher', 'admin']),
  asyncWrapper(async (req, res) => {
    const lessonId = Number(req.params.lessonId);
    const body = req.body as { questions?: { text: string; options: string[] }[] | string };
    try {
      let inserted;
      if (typeof body.questions === 'string') {
        inserted = await LessonMcqQuestionsService.bulkCreateFromText(lessonId, body.questions);
      } else if (Array.isArray(body.questions)) {
        inserted = await LessonMcqQuestionsService.bulkCreate(lessonId, body.questions);
      } else {
        throw new Error('questions must be an array or a formatted string');
      }
      res.status(201).json({ success: true, message: 'Questions created', data: inserted });
    } catch (error: any) {
      const status = error.message === 'lesson not found' ? 404 : 400;
      res.status(status).json({ success: false, message: error.message });
    }
  }),
);

// Also support the requested path: POST /questions/bulk (may conflict in this codebase)
// POST /questions/bulk
router.post(
  '/questions/bulk',
  authMiddleware(['teacher', 'admin']),
  asyncWrapper(async (req, res) => {
    const { lessonId } = req.body as { lessonId: number };
    const body = req.body as { questions?: { text: string; options: string[] }[] | string };
    try {
      let inserted;
      if (typeof body.questions === 'string') {
        inserted = await LessonMcqQuestionsService.bulkCreateFromText(
          Number(lessonId),
          body.questions,
        );
      } else if (Array.isArray(body.questions)) {
        inserted = await LessonMcqQuestionsService.bulkCreate(Number(lessonId), body.questions);
      } else {
        throw new Error('questions must be an array or a formatted string');
      }
      res.status(201).json({ success: true, message: 'Questions created', data: inserted });
    } catch (error: any) {
      res.status(400).json({ success: false, message: error.message });
    }
  }),
);

// Preferred non-conflicting: PUT /lesson-questions/:id/answer
router.put(
  '/lesson-questions/:id/answer',
  authMiddleware(['teacher', 'admin']),
  asyncWrapper(async (req, res) => {
    const id = Number(req.params.id);
    const { correctAnswer } = req.body as { correctAnswer: string };
    try {
      const updated = await LessonMcqQuestionsService.setCorrectAnswer(id, correctAnswer);
      res.json({ success: true, message: 'Correct answer updated', data: updated });
    } catch (error: any) {
      const status = error.message === 'question not found' ? 404 : 400;
      res.status(status).json({ success: false, message: error.message });
    }
  }),
);

// Also support requested path: PUT /questions/:id/answer
// PUT /questions/:id/answer
router.put(
  '/questions/:id/answer',
  authMiddleware(['teacher', 'admin']),
  asyncWrapper(async (req, res) => {
    const id = Number(req.params.id);
    const { correctAnswer } = req.body as { correctAnswer: string };
    try {
      const updated = await LessonMcqQuestionsService.setCorrectAnswer(id, correctAnswer);
      res.json({ success: true, message: 'Correct answer updated', data: updated });
    } catch (error: any) {
      const status = error.message === 'question not found' ? 404 : 400;
      res.status(status).json({ success: false, message: error.message });
    }
  }),
);

// Preferred non-conflicting: PUT /lesson-questions/:id/image (multipart upload)
router.put(
  '/lesson-questions/:id/image',
  authMiddleware(['teacher', 'admin']),
  uploadExamImage.single('image'),
  asyncWrapper(async (req, res) => {
    const id = Number(req.params.id);
    try {
      const file = (req as any).file as Express.Multer.File | undefined;
      if (!file) return res.status(400).json({ success: false, message: 'image file is required' });
      const uploaded = await uploadToCloudinary(file.path);
      const updated = await LessonMcqQuestionsService.setImage(id, uploaded.secure_url);
      res.json({ success: true, message: 'Image updated', data: updated });
    } catch (error: any) {
      const status = error.message === 'question not found' ? 404 : 400;
      res.status(status).json({ success: false, message: error.message });
    }
  }),
);

// Also support requested path: PUT /questions/:id/image (multipart as well)
router.put(
  '/questions/:id/image',
  authMiddleware(['teacher', 'admin']),
  uploadExamImage.single('image'),
  asyncWrapper(async (req, res) => {
    const id = Number(req.params.id);
    try {
      const file = (req as any).file as Express.Multer.File | undefined;
      if (!file) return res.status(400).json({ success: false, message: 'image file is required' });
      const uploaded = await uploadToCloudinary(file.path);
      const updated = await LessonMcqQuestionsService.setImage(id, uploaded.secure_url);
      res.json({ success: true, message: 'Image updated', data: updated });
    } catch (error: any) {
      const status = error.message === 'question not found' ? 404 : 400;
      res.status(status).json({ success: false, message: error.message });
    }
  }),
);

// GET /lessons/:lessonId/questions
router.get(
  '/lessons/:lessonId/questions',
  authMiddleware(['teacher', 'admin']),
  asyncWrapper(async (req, res) => {
    const lessonId = Number(req.params.lessonId);
    try {
      if (req.user?.role === 'teacher') {
        const subjectId = await getSubjectIdByLessonId(lessonId);
        if (!subjectId) return res.status(404).json({ success: false, message: 'الدرس غير موجود' });
        const allowed = await teacherHasSubjectAccess(req.user.id, subjectId);
        if (!allowed)
          return res.status(403).json({ success: false, message: 'غير مصرح لك بهذه المادة' });
      }
      const rows = await LessonMcqQuestionsService.getByLesson(lessonId);
      res.json({ success: true, data: rows });
    } catch (error: any) {
      const status = error.message.includes('lessonId') ? 400 : 500;
      res.status(status).json({ success: false, message: error.message });
    }
  }),
);

// Preferred non-conflicting: PUT /lesson-questions/:id
router.put(
  '/lesson-questions/:id',
  authMiddleware(['teacher', 'admin']),
  asyncWrapper(async (req, res) => {
    const id = Number(req.params.id);
    const { text, options } = req.body as { text?: string; options?: string[] };
    try {
      const updated = await LessonMcqQuestionsService.updateQuestion(id, { text, options });
      res.json({ success: true, message: 'Question updated', data: updated });
    } catch (error: any) {
      const status = error.message === 'question not found' ? 404 : 400;
      res.status(status).json({ success: false, message: error.message });
    }
  }),
);

// Also support requested path: PUT /questions/:id
// PUT /questions/:id
router.put(
  '/questions/:id',
  authMiddleware(['teacher', 'admin']),
  asyncWrapper(async (req, res) => {
    const id = Number(req.params.id);
    const { text, options } = req.body as { text?: string; options?: string[] };
    try {
      const updated = await LessonMcqQuestionsService.updateQuestion(id, { text, options });
      res.json({ success: true, message: 'Question updated', data: updated });
    } catch (error: any) {
      const status = error.message === 'question not found' ? 404 : 400;
      res.status(status).json({ success: false, message: error.message });
    }
  }),
);

// Preferred non-conflicting: DELETE /lesson-questions/:id
router.delete(
  '/lesson-questions/:id',
  authMiddleware(['teacher', 'admin']),
  asyncWrapper(async (req, res) => {
    const id = Number(req.params.id);
    try {
      await LessonMcqQuestionsService.delete(id);
      res.json({ success: true, message: 'Question deleted' });
    } catch (error: any) {
      const status = error.message === 'question not found' ? 404 : 400;
      res.status(status).json({ success: false, message: error.message });
    }
  }),
);

// Also support requested path: DELETE /questions/:id
// DELETE /questions/:id
router.delete(
  '/questions/:id',
  authMiddleware(['teacher', 'admin']),
  asyncWrapper(async (req, res) => {
    const id = Number(req.params.id);
    try {
      await LessonMcqQuestionsService.delete(id);
      res.json({ success: true, message: 'Question deleted' });
    } catch (error: any) {
      const status = error.message === 'question not found' ? 404 : 400;
      res.status(status).json({ success: false, message: error.message });
    }
  }),
);

export default router;
