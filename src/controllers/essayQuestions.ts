import fs from 'fs';
import path from 'path';
import { Router } from 'express';
import multer from 'multer';
import { authMiddleware } from '../middleware/authentication';
import { COURSE_CONTENT_ROLES } from '../services/courseAccessControl';
import { EssayReviewService } from '../services/essayReview';
import { MistralOcrService } from '../services/mistralOcr';
import { asyncWrapper, HttpError, uploadToCloudinary } from '../utils';

export const router = Router();

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      if (!fs.existsSync('uploads')) fs.mkdirSync('uploads', { recursive: true });
      cb(null, 'uploads');
    },
    filename: (_req, file, cb) => {
      cb(null, `essay-${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024, files: 5 },
  fileFilter: (_req, file, cb) => {
    if (/jpeg|jpg|png|gif|webp/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  },
}).fields([
  { name: 'images', maxCount: 5 },
  { name: 'image', maxCount: 1 },
]);

function uploadedFiles(req: { files?: unknown }): Express.Multer.File[] {
  const files = req.files as Record<string, Express.Multer.File[]> | undefined;
  return [...(files?.images || []), ...(files?.image || [])];
}

router.post(
  '/ocr',
  authMiddleware(),
  upload,
  asyncWrapper(async (req, res) => {
    const files = uploadedFiles(req);
    if (!files.length) throw new HttpError(400, 'ارفع صورة واحدة على الأقل');
    const images = [];
    for (const file of files) {
      let extractedText = '';
      let ocrFailed = false;
      try {
        const ocr = await MistralOcrService.extractTextFromFile(file);
        extractedText = String(ocr.text || '').trim();
      } catch {
        ocrFailed = true;
      }
      const stored = await uploadToCloudinary(file.path, { category: 'essay' });
      images.push({
        url: stored.secure_url,
        extractedText,
        ocrFailed: ocrFailed || !extractedText,
      });
    }
    res.json({ images });
  }),
);

router.post(
  '/',
  authMiddleware(COURSE_CONTENT_ROLES),
  asyncWrapper(async (req, res) => {
    const scope = req.body.scope === 'lecture' ? 'lecture' : 'course';
    const created = await EssayReviewService.createQuestion(req.user!, {
      examId: Number(req.body.examId ?? req.body.exam_id),
      scope,
      questionText: req.body.questionText ?? req.body.question_text,
      questionImage: req.body.questionImage ?? req.body.question_image,
      modelAnswer: req.body.modelAnswer ?? req.body.model_answer,
      modelAnswerImage: req.body.modelAnswerImage ?? req.body.model_answer_image,
      points: Number(req.body.points ?? req.body.grade),
      rubric: req.body.rubric,
    });
    res.status(201).json({ success: true, message: 'تم حفظ السؤال المقالي', ...created });
  }),
);

router.get(
  '/reviews',
  authMiddleware(COURSE_CONTENT_ROLES),
  asyncWrapper(async (req, res) => {
    const items = await EssayReviewService.listForTeacher(req.user!, {
      status: typeof req.query.status === 'string' ? req.query.status : undefined,
      examId: Number(req.query.examId || req.query.exam_id) || undefined,
      scope: typeof req.query.scope === 'string' ? req.query.scope : undefined,
    });
    res.json({ items });
  }),
);

router.post(
  '/reviews/decision',
  authMiddleware(COURSE_CONTENT_ROLES),
  asyncWrapper(async (req, res) => {
    const source = req.body.source === 'lecture' ? 'lecture' : 'course';
    const result = await EssayReviewService.decide(req.user!, {
      source,
      answerId: Number(req.body.answerId ?? req.body.answer_id),
      score: Number(req.body.score),
      note: req.body.note ?? req.body.teacherNote,
    });
    res.json({ success: true, message: 'تم حفظ قرار المراجعة وتحديث الدرجة', ...result });
  }),
);
