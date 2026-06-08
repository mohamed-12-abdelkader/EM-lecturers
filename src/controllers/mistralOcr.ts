import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { authMiddleware } from '../middleware/authentication';
import { asyncWrapper } from '../utils';
import { MistralOcrService } from '../services/mistralOcr';
import { MistralQuestionExtractionService } from '../services/mistralQuestionExtraction';
import { QuestionExtractionImportService } from '../services/questionExtractionImport';
import { MistralQuestionExtractionSchema } from '../types/mistralQuestionExtraction';

export const router = Router();

const uploadDir = path.join(process.cwd(), 'uploads/mistral-ocr');
fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '');
      cb(null, `mistral-ocr-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
    },
  }),
  limits: {
    fileSize: 25 * 1024 * 1024,
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    if (MistralOcrService.isSupportedMime(file.mimetype)) cb(null, true);
    else cb(new Error('يسمح برفع PDF أو صورة فقط'));
  },
});

const ImportQuestionBankV2Schema = z.object({
  lesson_id: z.coerce.number().int().positive(),
  extraction: MistralQuestionExtractionSchema,
});

function parseBooleanField(value: unknown): boolean {
  if (value === true || value === 'true' || value === '1' || value === 1) return true;
  return false;
}

function cleanupFile(file?: Express.Multer.File): void {
  if (!file?.path) return;
  fs.promises.unlink(file.path).catch(() => undefined);
}

router.post(
  '/extract-text',
  authMiddleware(['teacher', 'admin', 'employee']),
  upload.single('file'),
  asyncWrapper(async (req, res) => {
    const file = req.file;
    if (!file) {
      return res.status(400).json({
        success: false,
        message: 'يجب رفع ملف واحد في الحقل file (PDF أو صورة)',
      });
    }

    try {
      const data = await MistralOcrService.extractTextFromFile(file);
      return res.json({ success: true, data });
    } finally {
      cleanupFile(file);
    }
  }),
);

router.post(
  '/extract-questions',
  authMiddleware(['teacher', 'admin', 'employee']),
  upload.single('file'),
  asyncWrapper(async (req, res) => {
    const file = req.file;
    if (!file) {
      return res.status(400).json({
        success: false,
        message: 'يجب رفع ملف واحد في الحقل file (PDF أو صورة)',
      });
    }

    const inferCorrectAnswer = parseBooleanField(
      req.body.infer_correct_answer ?? req.query.infer_correct_answer,
    );
    const includeQuestionImages =
      req.body.include_question_images === undefined &&
      req.query.include_question_images === undefined
        ? true
        : parseBooleanField(req.body.include_question_images ?? req.query.include_question_images);

    try {
      const data = await MistralQuestionExtractionService.extractQuestionsFromFile(file, {
        inferCorrectAnswer,
        includeQuestionImages,
      });
      return res.json({ success: true, data });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          success: false,
          message: 'OCR provider returned invalid question JSON',
          errors: error.errors,
        });
      }
      throw error;
    } finally {
      cleanupFile(file);
    }
  }),
);

router.post(
  '/import-question-bank-v2',
  authMiddleware(['teacher', 'admin', 'employee']),
  asyncWrapper(async (req, res) => {
    const parsed = ImportQuestionBankV2Schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: parsed.error.errors,
      });
    }

    const result = await QuestionExtractionImportService.importToQuestionBankV2({
      lessonId: parsed.data.lesson_id,
      teacherId: req.user!.id,
      userRole: req.user!.role,
      extraction: parsed.data.extraction,
    });

    return res.status(201).json({
      success: true,
      message: `تم استيراد ${result.questions.length} سؤال`,
      data: result,
    });
  }),
);
