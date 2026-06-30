import { Router, Request, Response } from 'express';
import { checkPermission } from '../middleware/permissions';
import { authMiddleware } from '../middleware/authentication';
import { asyncWrapper } from '../utils';
import { QuestionBankV2Service } from '../services/questionBankV2';
import {
  BulkTextQuestionsSchema,
  QuestionMediaSchema,
  UpdateQuestionStatusSchema,
  UpdateCorrectAnswerSchema,
  CreatePassageWithQuestionsSchema
} from '../db/types/questionBankV2';
import { QuestionExtractionImportService, buildImportExtractionResponse } from '../services/questionExtractionImport';
import {
  MistralQuestionExtractionSchema,
  parseQuestionExtractionImportPayload,
} from '../types/mistralQuestionExtraction';
import { z } from 'zod';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

export const router = Router();

// إعداد multer لرفع الملفات
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(__dirname, '../../uploads');
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const uniqueName = `${Date.now()}-${file.originalname}`;
      cb(null, uniqueName);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

// رفع حتى 20 صورة لأسئلة صورة فقط (Bulk)
const uploadImageOnlyBulk = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(__dirname, '../../uploads');
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}-${file.originalname || 'image'}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB per file, 20 files
});

// ============================================
// 0. قطعة + أسئلة MCQ (Passage with MCQs)
// ============================================
router.post(
  '/passages',
  authMiddleware(['teacher', 'admin', 'employee']), checkPermission('question_bank_management'),
  asyncWrapper(async (req: Request, res: Response) => {
    const userId = (req as any).user.id;
    const userRole = (req as any).user.role;
    const validatedData = CreatePassageWithQuestionsSchema.parse(req.body);
    const result = await QuestionBankV2Service.createPassageWithQuestions(
      userId,
      validatedData,
      userRole
    );
    res.status(201).json({
      success: true,
      message: `تمت إضافة القطعة مع ${result.questions.length} سؤال`,
      data: result
    });
  })
);

router.get(
  '/passages/:passageId',
  authMiddleware(['teacher', 'admin', 'student', 'employee']),
  asyncWrapper(async (req: Request, res: Response) => {
    const passageId = parseInt(req.params.passageId);
    if (isNaN(passageId)) {
      return res.status(400).json({ success: false, message: 'معرف القطعة غير صحيح' });
    }
    const result = await QuestionBankV2Service.getPassageWithQuestions(passageId);
    if (!result) {
      return res.status(404).json({ success: false, message: 'القطعة غير موجودة' });
    }
    res.status(200).json({ success: true, data: result });
  })
);

// ============================================
// 1. إضافة أسئلة نصية جماعية (Bulk Add)
// ============================================
router.post(
  '/bulk-text',
  authMiddleware(['teacher', 'admin', 'employee']), checkPermission('question_bank_management'),
  asyncWrapper(async (req: Request, res: Response) => {
    const userId = (req as any).user.id;
    const userRole = (req as any).user.role;
    const validatedData = BulkTextQuestionsSchema.parse(req.body);

    const questions = await QuestionBankV2Service.createBulkTextQuestions(
      validatedData.lesson_id,
      userId,
      validatedData,
      userRole
    );

    res.status(201).json({
      success: true,
      message: `تم إضافة ${questions.length} سؤال بنجاح`,
      data: questions
    });
  })
);

// ============================================
// 2. إضافة سؤال باختيارات صور
// ============================================
router.post(
  '/image-choices',
  authMiddleware(['teacher', 'admin', 'employee']), checkPermission('question_bank_management'),
  upload.fields([
    { name: 'option_0', maxCount: 1 },
    { name: 'option_1', maxCount: 1 },
    { name: 'option_2', maxCount: 1 },
    { name: 'option_3', maxCount: 1 }
  ]),
  asyncWrapper(async (req: Request, res: Response) => {
    const userId = (req as any).user.id;
    const userRole = (req as any).user.role;
    const files = req.files as { [fieldname: string]: Express.Multer.File[] };

    // ترتيب الملفات حسب الفهرس
    const optionFiles: Express.Multer.File[] = [];
    for (let i = 0; i < 4; i++) {
      const file = files[`option_${i}`]?.[0];
      if (!file) {
        return res.status(400).json({
          success: false,
          message: `يجب رفع صورة للخيار ${i + 1}`
        });
      }
      optionFiles.push(file);
    }

    // التحقق من البيانات الأساسية (بدون options لأننا نرفع ملفات)
    const baseData = {
      question_text: req.body.question_text,
      lesson_id: parseInt(req.body.lesson_id),
      correct_answer_index: parseInt(req.body.correct_answer_index),
      explanation: req.body.explanation,
      difficulty_level: req.body.difficulty_level || 'medium',
      points: parseInt(req.body.points) || 1
    };

    // التحقق من البيانات الأساسية
    if (!baseData.question_text || baseData.question_text.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'نص السؤال مطلوب'
      });
    }

    if (isNaN(baseData.lesson_id) || baseData.lesson_id <= 0) {
      return res.status(400).json({
        success: false,
        message: 'معرف الدرس غير صحيح'
      });
    }

    if (isNaN(baseData.correct_answer_index) || baseData.correct_answer_index < 0 || baseData.correct_answer_index > 3) {
      return res.status(400).json({
        success: false,
        message: 'الإجابة الصحيحة يجب أن تكون بين 0 و 3'
      });
    }

    // إنشاء questionData للـ service (بدون التحقق من options لأننا نرفع ملفات)
    const questionData = {
      question_text: baseData.question_text,
      lesson_id: baseData.lesson_id,
      options: [
        { option_index: 0, option_type: 'image' as const },
        { option_index: 1, option_type: 'image' as const },
        { option_index: 2, option_type: 'image' as const },
        { option_index: 3, option_type: 'image' as const }
      ],
      correct_answer_index: baseData.correct_answer_index,
      explanation: baseData.explanation,
      difficulty_level: baseData.difficulty_level as 'easy' | 'medium' | 'hard',
      points: baseData.points
    };

    const question = await QuestionBankV2Service.createImageChoicesQuestion(
      userId,
      questionData,
      optionFiles,
      userRole
    );

    res.status(201).json({
      success: true,
      message: 'تم إضافة السؤال بنجاح',
      data: question
    });
  })
);

// ============================================
// 3. إضافة/تحديث صورة السؤال (Optional)
// ============================================
router.post(
  '/:questionId/media',
  authMiddleware(['teacher', 'admin', 'employee']), checkPermission('question_bank_management'),
  upload.single('media'),
  asyncWrapper(async (req: Request, res: Response) => {
    const questionId = parseInt(req.params.questionId);
    const userId = (req as any).user.id;
    const userRole = (req as any).user.role;
    const file = (req as any).file as Express.Multer.File;

    if (!file) {
      return res.status(400).json({
        success: false,
        message: 'يجب رفع ملف'
      });
    }

    if (isNaN(questionId)) {
      return res.status(400).json({
        success: false,
        message: 'معرف السؤال غير صحيح'
      });
    }

    const mediaData = QuestionMediaSchema.parse({
      media_type: req.body.media_type || 'image',
      media_name: req.body.media_name || file.originalname,
      media_size: file.size
    });

    const media = await QuestionBankV2Service.updateQuestionMedia(
      questionId,
      userId,
      file,
      mediaData,
      userRole
    );

    res.status(200).json({
      success: true,
      message: 'تم إضافة/تحديث صورة السؤال بنجاح',
      data: media
    });
  })
);

// ============================================
// 4. جلب سؤال معين
// ============================================
router.get(
  '/:questionId',
  authMiddleware(['teacher', 'admin', 'student', 'employee']),
  asyncWrapper(async (req: Request, res: Response) => {
    const questionId = parseInt(req.params.questionId);

    if (isNaN(questionId)) {
      return res.status(400).json({
        success: false,
        message: 'معرف السؤال غير صحيح'
      });
    }

    const question = await QuestionBankV2Service.getQuestionById(questionId);

    if (!question) {
      return res.status(404).json({
        success: false,
        message: 'السؤال غير موجود'
      });
    }

    res.status(200).json({
      success: true,
      data: question
    });
  })
);

// ============================================
// 4b. إضافة أسئلة صورة فقط (Bulk) - حتى 20 صورة، اختيارات ثابتة a,b,c,d
// ============================================
router.post(
  '/lesson/:lessonId/questions/image-only-bulk',
  authMiddleware(['teacher', 'admin', 'employee']), checkPermission('question_bank_management'),
  uploadImageOnlyBulk.array('images', 20),
  asyncWrapper(async (req: Request, res: Response) => {
    const lessonId = parseInt(req.params.lessonId);
    if (isNaN(lessonId)) {
      return res.status(400).json({ success: false, message: 'معرف الدرس غير صحيح' });
    }
    const files = (req.files as Express.Multer.File[]) || [];
    if (files.length === 0) {
      return res.status(400).json({ success: false, message: 'يجب رفع صورة واحدة على الأقل (حتى 20)' });
    }
    if (files.length > 20) {
      return res.status(400).json({ success: false, message: 'الحد الأقصى 20 صورة في الطلب الواحد' });
    }
    const userId = (req as any).user.id;
    const userRole = (req as any).user.role;
    let teacherId = userId;
    if (userRole === 'admin' && req.body.teacher_id != null) {
      const tid = parseInt(req.body.teacher_id, 10);
      if (!Number.isNaN(tid)) teacherId = tid;
    }
    let meta: Array<{ correct_answer_index: number; difficulty_level?: string; points?: number }> = [];
    if (req.body.meta && typeof req.body.meta === 'string') {
      try {
        meta = JSON.parse(req.body.meta);
        if (!Array.isArray(meta)) meta = [];
      } catch (_) {
        meta = [];
      }
    }
    const result = await QuestionBankV2Service.createBulkImageOnlyQuestions(
      lessonId,
      teacherId,
      files,
      meta,
      userRole
    );
    const status = result.failed === 0 ? 201 : result.added > 0 ? 207 : 400;
    res.status(status).json({
      success: result.added > 0,
      message:
        result.failed === 0
          ? `تمت إضافة ${result.added} سؤال بنجاح`
          : `تمت إضافة ${result.added} سؤال، وفشل ${result.failed}`,
      data: result,
    });
  })
);

// ============================================
// 4b. استيراد أسئلة مستخرجة بالـ AI (OCR) إلى الدرس
// ============================================
router.post(
  '/lesson/:lessonId/import-extraction',
  authMiddleware(['teacher', 'admin', 'employee']),
  checkPermission('question_bank_management'),
  asyncWrapper(async (req: Request, res: Response) => {
    const lessonId = parseInt(req.params.lessonId);
    if (isNaN(lessonId) || lessonId <= 0) {
      return res.status(400).json({
        success: false,
        message: 'معرف الدرس غير صحيح',
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
        message: 'صيغة بيانات الاستخراج غير صحيحة — أرسل ناتج extract-questions كما هو (data) أو { extraction: ... }',
      });
    }

    const result = await QuestionExtractionImportService.importToQuestionBankV2({
      lessonId,
      teacherId: (req as any).user.id,
      userRole: (req as any).user.role,
      extraction: payload.extraction,
    });

    return res.status(201).json({
      success: true,
      message: `تم استيراد ${result.questions.length} سؤال`,
      data: buildImportExtractionResponse(payload.meta, result),
    });
  }),
);

// ============================================
// 5. جلب القطع وأسئلتها في الدرس (يجب أن يكون قبل /lesson/:lessonId)
// ============================================
router.get(
  '/lesson/:lessonId/passages',
  authMiddleware(['teacher', 'admin', 'student', 'employee']),
  asyncWrapper(async (req: Request, res: Response) => {
    const lessonId = parseInt(req.params.lessonId);
    if (isNaN(lessonId)) {
      return res.status(400).json({
        success: false,
        message: 'معرف الدرس غير صحيح'
      });
    }
    const passages = await QuestionBankV2Service.getLessonPassages(lessonId);
    res.status(200).json({
      success: true,
      data: passages
    });
  })
);

// ============================================
// 6. جلب أسئلة الدرس
// ============================================
router.get(
  '/lesson/:lessonId',
  authMiddleware(['teacher', 'admin', 'student', 'employee']),
  asyncWrapper(async (req: Request, res: Response) => {
    const lessonId = parseInt(req.params.lessonId);
    const status = req.query.status as string | undefined;
    const limit = parseInt(req.query.limit as string) || 500;
    const offset = parseInt(req.query.offset as string) || 0;

    if (isNaN(lessonId)) {
      return res.status(400).json({
        success: false,
        message: 'معرف الدرس غير صحيح'
      });
    }

    const result = await QuestionBankV2Service.getLessonQuestions(
      lessonId,
      status,
      limit,
      offset
    );

    res.status(200).json({
      success: true,
      data: result
    });
  })
);

// ============================================
// 7. تحديث حالة السؤال (Admin)
// ============================================
router.put(
  '/:questionId/status',
  authMiddleware(['admin', 'employee']), checkPermission('question_bank_management'),
  asyncWrapper(async (req: Request, res: Response) => {
    const questionId = parseInt(req.params.questionId);
    const adminId = (req as any).user.id;

    if (isNaN(questionId)) {
      return res.status(400).json({
        success: false,
        message: 'معرف السؤال غير صحيح'
      });
    }

    const validatedData = UpdateQuestionStatusSchema.parse(req.body);

    const question = await QuestionBankV2Service.updateQuestionStatus(
      questionId,
      adminId,
      validatedData
    );

    res.status(200).json({
      success: true,
      message: validatedData.status === 'approved' ? 'تمت الموافقة على السؤال' : 'تم رفض السؤال',
      data: question
    });
  })
);

// ============================================
// 7b. تحديد الإجابة الصحيحة لسؤال (Admin)
// ============================================
router.patch(
  '/:questionId/correct-answer',
  authMiddleware(['admin', 'employee']), checkPermission('question_bank_management'),
  asyncWrapper(async (req: Request, res: Response) => {
    const questionId = parseInt(req.params.questionId);

    if (isNaN(questionId)) {
      return res.status(400).json({
        success: false,
        message: 'معرف السؤال غير صحيح'
      });
    }

    const validatedData = UpdateCorrectAnswerSchema.parse(req.body);

    const question = await QuestionBankV2Service.updateQuestionCorrectAnswer(
      questionId,
      validatedData.correct_answer_index
    );

    res.status(200).json({
      success: true,
      message: 'تم تحديث الإجابة الصحيحة بنجاح',
      data: question
    });
  })
);

// ============================================
// 8. حذف سؤال
// ============================================
router.delete(
  '/:questionId',
  authMiddleware(['teacher', 'admin', 'employee']), checkPermission('question_bank_management'),
  asyncWrapper(async (req: Request, res: Response) => {
    const questionId = parseInt(req.params.questionId);
    const userId = (req as any).user.id;
    const userRole = (req as any).user.role;

    if (isNaN(questionId)) {
      return res.status(400).json({
        success: false,
        message: 'معرف السؤال غير صحيح'
      });
    }

    await QuestionBankV2Service.deleteQuestion(questionId, userId, userRole);

    res.status(200).json({
      success: true,
      message: 'تم حذف السؤال بنجاح'
    });
  })
);

