import fs from 'node:fs';
import path from 'node:path';
import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { getMistralConfig } from '../config/mistral';
import { authMiddleware } from '../middleware/authentication';
import { asyncWrapper, HttpError } from '../utils';
import { MistralOcrService, parsePdfPageRange } from '../services/mistralOcr';
import { MistralQuestionExtractionService } from '../services/mistralQuestionExtraction';
import { QuestionExtractionImportService, buildImportExtractionResponse } from '../services/questionExtractionImport';
import {
  MistralQuestionExtractionSchema,
  parseQuestionExtractionImportPayload,
} from '../types/mistralQuestionExtraction';

export const router = Router();

const uploadDir = path.join(process.cwd(), 'uploads/mistral-ocr');
fs.mkdirSync(uploadDir, { recursive: true });

const MAX_UPLOAD_FILES = 20;

function buildOcrUpload() {
  const maxBytes = getMistralConfig().maxUploadBytes;
  return multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, uploadDir),
      filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname || '');
        cb(null, `mistral-ocr-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
      },
    }),
    limits: {
      // Omit fileSize when unlimited (MISTRAL_OCR_MAX_FILE_SIZE_MB=0)
      ...(Number.isFinite(maxBytes) ? { fileSize: maxBytes } : {}),
      files: MAX_UPLOAD_FILES,
    },
    fileFilter: (_req, file, cb) => {
      try {
        MistralOcrService.resolveSupportedMime(file);
        cb(null, true);
      } catch {
        cb(new Error('يسمح برفع PDF أو صورة فقط'));
      }
    },
  });
}

const uploadExtract = buildOcrUpload().fields([
  { name: 'file', maxCount: 1 },
  { name: 'files', maxCount: MAX_UPLOAD_FILES },
]);

/** Multer with Arabic 413 on oversized files (limit from MISTRAL_OCR_MAX_FILE_SIZE_MB). */
function uploadExtractSafe(req: Request, res: Response, next: NextFunction) {
  uploadExtract(req, res, (err: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        const maxMb = getMistralConfig().maxUploadBytes;
        const limitLabel = Number.isFinite(maxMb)
          ? `${Math.round(maxMb / (1024 * 1024))} MB`
          : 'غير محدود';
        return res.status(413).json({
          success: false,
          message: `حجم الملف أكبر من الحد المسموح (${limitLabel}). زد MISTRAL_OCR_MAX_FILE_SIZE_MB أو ضع 0 بلا حد`,
        });
      }
      if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
        return res.status(400).json({
          success: false,
          message: `عدد الملفات يتجاوز الحد (${MAX_UPLOAD_FILES})`,
        });
      }
      return res.status(400).json({ success: false, message: err.message });
    }
    const msg = err instanceof Error ? err.message : 'خطأ في رفع الملف';
    return res.status(400).json({ success: false, message: msg });
  });
}

const ImportQuestionBankV2Schema = z
  .object({
    lesson_id: z.coerce.number().int().positive(),
  })
  .passthrough();

function parseBooleanField(value: unknown): boolean {
  if (value === true || value === 1) return true;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    return v === 'true' || v === '1' || v === 'yes';
  }
  return false;
}

function parseOptionalInt(value: unknown): number | undefined {
  if (value == null || value === '') return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  return Math.trunc(n);
}

function collectUploadedFiles(req: Request): Express.Multer.File[] {
  const collected: Express.Multer.File[] = [];

  if (req.file) {
    collected.push(req.file);
  }

  const filesField = req.files;
  if (Array.isArray(filesField)) {
    collected.push(...filesField);
  } else if (filesField && typeof filesField === 'object') {
    for (const arr of Object.values(filesField)) {
      if (Array.isArray(arr)) collected.push(...arr);
    }
  }

  const seen = new Set<string>();
  return collected.filter((file) => {
    const key = file.path || `${file.originalname}-${file.size}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function cleanupFiles(files: Express.Multer.File[]): void {
  for (const file of files) {
    if (!file?.path) continue;
    fs.promises.unlink(file.path).catch(() => undefined);
  }
}

function handleOcrError(res: import('express').Response, error: unknown) {
  if (error instanceof HttpError) {
    return res.status(error.status).json({ success: false, message: error.message });
  }
  if (error instanceof z.ZodError) {
    return res.status(400).json({
      success: false,
      message: 'OCR provider returned invalid question JSON',
      errors: error.errors,
    });
  }
  const msg = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
  if (msg === 'MISTRAL_API_KEY_MISSING') {
    return res.status(503).json({ success: false, message: 'MISTRAL_API_KEY غير مُعد في البيئة' });
  }
  throw error;
}

function parseExtractionOptions(req: Request) {
  const inferCorrectAnswer = parseBooleanField(
    req.body.infer_correct_answer ?? req.query.infer_correct_answer,
  );
  const includeQuestionImages =
    req.body.include_question_images === undefined &&
    req.query.include_question_images === undefined
      ? true
      : parseBooleanField(req.body.include_question_images ?? req.query.include_question_images);

  const subjectRaw = req.body.subject ?? req.query.subject;
  const subject =
    typeof subjectRaw === 'string' && subjectRaw.trim() ? subjectRaw.trim() : undefined;

  return {
    inferCorrectAnswer,
    includeQuestionImages,
    startPage: parseOptionalInt(req.body.start_page ?? req.query.start_page),
    endPage: parseOptionalInt(req.body.end_page ?? req.query.end_page),
    subject,
  };
}

async function runOcrExtraction(
  files: Express.Multer.File[],
  options: ReturnType<typeof parseExtractionOptions>,
) {
  const pdfCount = files.filter((f) =>
    MistralOcrService.resolveSupportedMime(f).includes('pdf'),
  ).length;

  if (pdfCount > 0 && (options.startPage != null || options.endPage != null)) {
    parsePdfPageRange(options.startPage, options.endPage);
  }

  if (files.length === 1) {
    return MistralOcrService.extractTextFromFile(files[0], {
      pages:
        pdfCount > 0 ? parsePdfPageRange(options.startPage, options.endPage) : undefined,
    });
  }

  if (pdfCount > 0) {
    throw new HttpError(400, 'ارفع ملف PDF واحد فقط — للصور استخدم الحقل files');
  }

  return MistralOcrService.extractTextFromFiles(files);
}

router.post(
  '/extract-text',
  authMiddleware(['teacher', 'admin', 'employee']),
  uploadExtractSafe,
  asyncWrapper(async (req, res) => {
    const files = collectUploadedFiles(req);
    if (files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'يجب رفع ملف في file أو صور متعددة في files',
      });
    }

    const options = parseExtractionOptions(req);

    try {
      const data = await runOcrExtraction(files, options);
      return res.json({ success: true, data });
    } catch (error) {
      const handled = handleOcrError(res, error);
      if (handled) return handled;
      throw error;
    } finally {
      cleanupFiles(files);
    }
  }),
);

router.post(
  '/extract-questions',
  authMiddleware(['teacher', 'admin', 'employee']),
  uploadExtractSafe,
  asyncWrapper(async (req, res) => {
    const files = collectUploadedFiles(req);
    if (files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'يجب رفع ملف PDF في file أو صور متعددة في files',
      });
    }

    const options = parseExtractionOptions(req);

    try {
      const data = await MistralQuestionExtractionService.extractQuestionsFromFiles(files, {
        inferCorrectAnswer: options.inferCorrectAnswer,
        includeQuestionImages: options.includeQuestionImages,
        startPage: options.startPage,
        endPage: options.endPage,
        subject: options.subject,
      });
      return res.json({ success: true, data });
    } catch (error) {
      const handled = handleOcrError(res, error);
      if (handled) return handled;
      throw error;
    } finally {
      cleanupFiles(files);
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

    let payload;
    try {
      payload = parseQuestionExtractionImportPayload(req.body);
      MistralQuestionExtractionSchema.parse(payload.extraction);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: error.errors,
        });
      }
      return res.status(400).json({
        success: false,
        message: 'صيغة بيانات الاستخراج غير صحيحة',
      });
    }

    const result = await QuestionExtractionImportService.importToQuestionBankV2({
      lessonId: parsed.data.lesson_id,
      teacherId: req.user!.id,
      userRole: req.user!.role,
      extraction: payload.extraction,
    });

    return res.status(201).json({
      success: true,
      message: `تم استيراد ${result.questions.length} سؤال`,
      data: buildImportExtractionResponse(payload.meta, result),
    });
  }),
);
