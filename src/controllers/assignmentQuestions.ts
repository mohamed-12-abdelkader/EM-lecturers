import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/authentication';
import { asyncWrapper } from '../utils';
import { AssignmentQuestionsService } from '../services/assignmentQuestions';
import { PackageSubjectLessonService } from '../services/packageSubjectLessons';
import { PackageSubjectPermissionsService } from '../services/packageSubjectPermissions';
import { PackageActivationCodeService } from '../services/packageActivationCodes';
import { uploadToCloudinary } from '../utils';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { z } from 'zod';
import pool from '../db/pool';

const router = Router();

// Configure multer for question images (up to 10 images)
const questionImageUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const uploadDir = 'uploads/assignment-questions';
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }
      cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
      cb(null, 'question-' + uniqueSuffix + path.extname(file.originalname));
    },
  }),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB per image
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('فقط ملفات الصور مسموح بها!'));
    }
  },
});

// Helper function للتحقق من صلاحية المدرس على الواجب
async function checkAssignmentPermission(assignmentId: number, userId: number, userRole: string) {
  if (userRole === 'admin') {
    return true;
  }

  if (userRole === 'teacher') {
    // جلب lesson_id من الواجب
    const assignment = await AssignmentQuestionsService.getAssignmentById(assignmentId);
    if (!assignment) {
      return false;
    }

    // جلب subject_id من الدرس
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error
    const subjectId = await PackageSubjectLessonService.getSubjectIdByLessonId(
      assignment.lesson_id,
    );
    if (!subjectId) {
      return false;
    }

    // التحقق من صلاحية المدرس على المادة
    return await PackageSubjectPermissionsService.hasPermission(subjectId, userId);
  }

  return false;
}

// Schemas للتحقق من البيانات
const CreateTextQuestionSchema = z
  .object({
    question_text: z.string().min(1, 'نص السؤال مطلوب'),
    // الصيغة الجديدة: options كمصفوفة
    options: z
      .array(
        z.object({
          option_text: z.string().min(1, 'نص الخيار مطلوب'),
          option_letter: z.enum(['a', 'b', 'c', 'd'], {
            errorMap: () => ({ message: 'option_letter يجب أن يكون a, b, c, أو d' }),
          }),
        }),
      )
      .length(4, 'يجب إضافة 4 خيارات بالضبط')
      .optional(),
    // الصيغة القديمة: option_a, option_b, option_c, option_d
    option_a: z.string().min(1, 'الخيار أ مطلوب').optional(),
    option_b: z.string().min(1, 'الخيار ب مطلوب').optional(),
    option_c: z.string().min(1, 'الخيار ج مطلوب').optional(),
    option_d: z.string().min(1, 'الخيار د مطلوب').optional(),
    correct_answer: z.enum(['a', 'b', 'c', 'd'], {
      errorMap: () => ({ message: 'الإجابة الصحيحة يجب أن تكون a, b, c, أو d' }),
    }),
    order_index: z.number().int().min(0).optional(),
  })
  .refine(
    (data) => {
      // يجب أن يكون إما options أو option_a, option_b, option_c, option_d
      const hasOptions = data.options && data.options.length === 4;
      const hasOldFormat = data.option_a && data.option_b && data.option_c && data.option_d;
      return hasOptions || hasOldFormat;
    },
    {
      message: 'يجب إرسال إما options (مصفوفة) أو option_a, option_b, option_c, option_d',
    },
  );

// Schema لإضافة سؤال بصورة
const CreateImageQuestionSchema = z
  .object({
    options: z
      .array(
        z.object({
          option_text: z.string().min(1, 'نص الخيار مطلوب'),
          option_letter: z.enum(['a', 'b', 'c', 'd'], {
            errorMap: () => ({ message: 'option_letter يجب أن يكون a, b, c, أو d' }),
          }),
        }),
      )
      .length(4, 'يجب إضافة 4 خيارات بالضبط')
      .optional(), // اختياري - افتراضي: أ، ب، ج، د
    correct_answer: z.enum(['a', 'b', 'c', 'd']).optional(), // اختياري - افتراضي: a
    order_index: z
      .union([
        z.number().int().min(0),
        z.string().transform((val) => {
          const num = parseInt(val, 10);
          if (isNaN(num) || num < 0) {
            throw new Error('order_index يجب أن يكون رقماً صحيحاً موجباً');
          }
          return num;
        }),
      ])
      .optional(),
  })
  .passthrough(); // يسمح بأي بيانات إضافية

const UpdateQuestionSchema = z.object({
  question_text: z.string().min(1).optional(),
  option_a: z.string().min(1).optional(),
  option_b: z.string().min(1).optional(),
  option_c: z.string().min(1).optional(),
  option_d: z.string().min(1).optional(),
  correct_answer: z.enum(['a', 'b', 'c', 'd']).optional(),
  order_index: z.number().int().min(0).optional(),
  image_urls: z.array(z.string().url()).max(10).optional(),
});

const UpdateCorrectAnswerSchema = z.object({
  correct_answer: z.enum(['a', 'b', 'c', 'd'], {
    errorMap: () => ({ message: 'الإجابة الصحيحة يجب أن تكون a, b, c, أو d' }),
  }),
});

// 1. إضافة سؤال نصي
router.post(
  '/assignments/:assignmentId/questions/text',
  authMiddleware(['admin', 'teacher']),
  asyncWrapper(async (req: Request, res: Response) => {
    try {
      const assignmentId = parseInt(req.params.assignmentId);
      if (isNaN(assignmentId)) {
        return res.status(400).json({ error: 'Invalid assignment ID' });
      }

      // التحقق من وجود الواجب
      const assignment = await AssignmentQuestionsService.getAssignmentById(assignmentId);
      if (!assignment) {
        return res.status(404).json({ error: 'الواجب غير موجود' });
      }

      const user = (req as any).user;

      // التحقق من الصلاحيات
      const hasPermission = await checkAssignmentPermission(assignmentId, user.id, user.role);
      if (!hasPermission) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'ليس لديك صلاحية لإضافة أسئلة لهذا الواجب',
        });
      }

      // التحقق من صحة البيانات
      const parse = CreateTextQuestionSchema.safeParse(req.body);
      if (!parse.success) {
        return res.status(400).json({
          error: 'Validation failed',
          errors: parse.error.errors,
        });
      }

      // تحويل البيانات إلى الصيغة المطلوبة
      let options;
      if (parse.data.options && parse.data.options.length === 4) {
        // الصيغة الجديدة: options كمصفوفة
        options = parse.data.options;
      } else if (
        parse.data.option_a &&
        parse.data.option_b &&
        parse.data.option_c &&
        parse.data.option_d
      ) {
        // الصيغة القديمة: تحويل option_a, option_b, etc إلى options
        options = [
          { option_text: parse.data.option_a, option_letter: 'a' },
          { option_text: parse.data.option_b, option_letter: 'b' },
          { option_text: parse.data.option_c, option_letter: 'c' },
          { option_text: parse.data.option_d, option_letter: 'd' },
        ];
      } else {
        return res.status(400).json({
          error: 'Validation failed',
          message: 'يجب إرسال إما options (مصفوفة) أو option_a, option_b, option_c, option_d',
        });
      }

      const questionData: any = {
        question_text: parse.data.question_text,
        options: options,
        correct_answer: parse.data.correct_answer,
        order_index: parse.data.order_index,
      };

      const question = await AssignmentQuestionsService.createTextQuestion(
        assignmentId,
        questionData,
      );

      res.status(201).json({
        success: true,
        message: 'تم إضافة السؤال النصي بنجاح',
        question,
      });
    } catch (error: any) {
      console.error('Error creating text question:', error);
      res.status(500).json({
        error: 'خطأ في إضافة السؤال',
        message: error.message,
      });
    }
  }),
);

// 2. إضافة سؤال بصورة
router.post(
  '/assignments/:assignmentId/questions/image',
  authMiddleware(['admin', 'teacher']),
  questionImageUpload.array('images', 10), // حتى 10 صور
  asyncWrapper(async (req: Request, res: Response) => {
    try {
      const assignmentId = parseInt(req.params.assignmentId);
      if (isNaN(assignmentId)) {
        return res.status(400).json({ error: 'Invalid assignment ID' });
      }

      // التحقق من وجود الواجب
      const assignment = await AssignmentQuestionsService.getAssignmentById(assignmentId);
      if (!assignment) {
        return res.status(404).json({ error: 'الواجب غير موجود' });
      }

      const user = (req as any).user;

      // التحقق من الصلاحيات
      const hasPermission = await checkAssignmentPermission(assignmentId, user.id, user.role);
      if (!hasPermission) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'ليس لديك صلاحية لإضافة أسئلة لهذا الواجب',
        });
      }

      // جلب الملفات المرفوعة
      const files = (req.files as Express.Multer.File[]) || [];
      if (files.length === 0) {
        return res.status(400).json({ error: 'يجب رفع صورة واحدة على الأقل' });
      }

      if (files.length > 10) {
        return res.status(400).json({ error: 'الحد الأقصى للصور هو 10 صور' });
      }

      // رفع الصور إلى Cloudinary
      const imageUrls: string[] = [];
      const uploadErrors: any[] = [];

      for (const file of files) {
        try {
          // التحقق من وجود الملف
          if (!fs.existsSync(file.path)) {
            throw new Error(`الملف غير موجود: ${file.path}`);
          }

          const uploaded = await uploadToCloudinary(file.path);
          imageUrls.push(uploaded.secure_url);
          // لا نحذف الملف هنا لأن uploadToCloudinary يحذفه تلقائياً
        } catch (error: any) {
          console.error('Error uploading image:', {
            filename: file.originalname,
            path: file.path,
            size: file.size,
            mimetype: file.mimetype,
            error: error.message,
            stack: error.stack,
          });
          uploadErrors.push({
            filename: file.originalname,
            error: error.message || error.toString() || 'فشل في رفع الصورة',
            path: file.path,
            details: error.response?.data || error.http_code || null,
          });
          // حذف الملف المحلي حتى لو فشل الرفع
          try {
            if (fs.existsSync(file.path)) {
              fs.unlinkSync(file.path);
            }
          } catch (unlinkError) {
            console.error('Error deleting file:', unlinkError);
          }
        }
      }

      if (uploadErrors.length > 0) {
        return res.status(500).json({
          error: 'فشل في رفع بعض الصور',
          errors: uploadErrors,
          uploaded_count: imageUrls.length,
          failed_count: uploadErrors.length,
        });
      }

      // التحقق من صحة البيانات (اختياري - للخيارات المخصصة)
      const parse = CreateImageQuestionSchema.safeParse(req.body);
      if (!parse.success) {
        return res.status(400).json({
          error: 'Validation failed',
          errors: parse.error.errors,
        });
      }

      // تحضير البيانات
      const questionData: any = {
        image_urls: imageUrls,
        order_index: parse.data.order_index,
      };

      // إذا تم إرسال خيارات مخصصة، استخدمها
      if (parse.data.options && parse.data.options.length === 4) {
        questionData.options = parse.data.options;
        questionData.correct_answer = parse.data.correct_answer || 'a';
      }

      const question = await AssignmentQuestionsService.createImageQuestion(
        assignmentId,
        questionData,
      );

      res.status(201).json({
        success: true,
        message: 'تم إضافة السؤال بالصورة بنجاح',
        question,
      });
    } catch (error: any) {
      console.error('Error creating image question:', error);
      res.status(500).json({
        error: 'خطأ في إضافة السؤال',
        message: error.message,
      });
    }
  }),
);

// 3. تحديث الإجابة الصحيحة
router.patch(
  '/assignment-questions/:questionId/correct-answer',
  authMiddleware(['admin', 'teacher']),
  asyncWrapper(async (req: Request, res: Response) => {
    try {
      const questionId = parseInt(req.params.questionId);
      if (isNaN(questionId)) {
        return res.status(400).json({ error: 'Invalid question ID' });
      }

      // التحقق من وجود السؤال
      const existingQuestion = await AssignmentQuestionsService.getQuestionById(questionId);
      if (!existingQuestion) {
        return res.status(404).json({ error: 'السؤال غير موجود' });
      }

      // جلب assignment_id من السؤال
      const assignment = await AssignmentQuestionsService.getAssignmentById(
        existingQuestion.assignment_id,
      );
      if (!assignment) {
        return res.status(404).json({ error: 'الواجب غير موجود' });
      }

      const user = (req as any).user;

      // التحقق من الصلاحيات
      const hasPermission = await checkAssignmentPermission(assignment.id, user.id, user.role);
      if (!hasPermission) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'ليس لديك صلاحية لتعديل هذا السؤال',
        });
      }

      // التحقق من صحة البيانات
      const parse = UpdateCorrectAnswerSchema.safeParse(req.body);
      if (!parse.success) {
        return res.status(400).json({
          error: 'Validation failed',
          errors: parse.error.errors,
        });
      }

      const updatedQuestion = await AssignmentQuestionsService.updateCorrectAnswer(
        questionId,
        parse.data.correct_answer,
      );

      res.json({
        success: true,
        message: 'تم تحديث الإجابة الصحيحة بنجاح',
        question: updatedQuestion,
      });
    } catch (error: any) {
      console.error('Error updating correct answer:', error);
      res.status(500).json({
        error: 'خطأ في تحديث الإجابة الصحيحة',
        message: error.message,
      });
    }
  }),
);

// 4. تحديث سؤال
router.put(
  '/assignment-questions/:questionId',
  authMiddleware(['admin', 'teacher']),
  asyncWrapper(async (req: Request, res: Response) => {
    try {
      const questionId = parseInt(req.params.questionId);
      if (isNaN(questionId)) {
        return res.status(400).json({ error: 'Invalid question ID' });
      }

      // التحقق من وجود السؤال
      const existingQuestion = await AssignmentQuestionsService.getQuestionById(questionId);
      if (!existingQuestion) {
        return res.status(404).json({ error: 'السؤال غير موجود' });
      }

      // جلب assignment_id من السؤال
      const assignment = await AssignmentQuestionsService.getAssignmentById(
        existingQuestion.assignment_id,
      );
      if (!assignment) {
        return res.status(404).json({ error: 'الواجب غير موجود' });
      }

      const user = (req as any).user;

      // التحقق من الصلاحيات
      const hasPermission = await checkAssignmentPermission(assignment.id, user.id, user.role);
      if (!hasPermission) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'ليس لديك صلاحية لتعديل هذا السؤال',
        });
      }

      // التحقق من صحة البيانات
      const parse = UpdateQuestionSchema.safeParse(req.body);
      if (!parse.success) {
        return res.status(400).json({
          error: 'Validation failed',
          errors: parse.error.errors,
        });
      }

      const updatedQuestion = await AssignmentQuestionsService.updateQuestion(
        questionId,
        parse.data,
      );

      res.json({
        success: true,
        message: 'تم تحديث السؤال بنجاح',
        question: updatedQuestion,
      });
    } catch (error: any) {
      console.error('Error updating question:', error);
      res.status(500).json({
        error: 'خطأ في تحديث السؤال',
        message: error.message,
      });
    }
  }),
);

// 5. حذف سؤال
router.delete(
  '/assignment-questions/:questionId',
  authMiddleware(['admin', 'teacher']),
  asyncWrapper(async (req: Request, res: Response) => {
    try {
      const questionId = parseInt(req.params.questionId);
      if (isNaN(questionId)) {
        return res.status(400).json({ error: 'Invalid question ID' });
      }

      // التحقق من وجود السؤال
      const existingQuestion = await AssignmentQuestionsService.getQuestionById(questionId);
      if (!existingQuestion) {
        return res.status(404).json({ error: 'السؤال غير موجود' });
      }

      // جلب assignment_id من السؤال
      const assignment = await AssignmentQuestionsService.getAssignmentById(
        existingQuestion.assignment_id,
      );
      if (!assignment) {
        return res.status(404).json({ error: 'الواجب غير موجود' });
      }

      const user = (req as any).user;

      // التحقق من الصلاحيات
      const hasPermission = await checkAssignmentPermission(assignment.id, user.id, user.role);
      if (!hasPermission) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'ليس لديك صلاحية لحذف هذا السؤال',
        });
      }

      await AssignmentQuestionsService.deleteQuestion(questionId);

      res.json({
        success: true,
        message: 'تم حذف السؤال بنجاح',
      });
    } catch (error: any) {
      console.error('Error deleting question:', error);
      res.status(500).json({
        error: 'خطأ في حذف السؤال',
        message: error.message,
      });
    }
  }),
);

// 6. عرض أسئلة واجب معين
router.get(
  '/assignments/:assignmentId/questions',
  authMiddleware(['admin', 'teacher', 'student']),
  asyncWrapper(async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      console.log('[Admin/Teacher Questions Endpoint] Request received', {
        assignmentId: req.params.assignmentId,
        userId: user.id,
        userRole: user.role,
        url: req.url,
        method: req.method,
      });

      // للطلاب: يجب توجيههم إلى endpoint المخصص لهم في assignmentSubmissions
      if (user.role === 'student') {
        console.warn('[Admin/Teacher Questions Endpoint] Student trying to access admin endpoint, should use assignmentSubmissions');
        // لا نمنعهم هنا، لكن نتحقق من الصلاحيات
      }

      const assignmentId = parseInt(req.params.assignmentId);
      if (isNaN(assignmentId)) {
        return res.status(400).json({ error: 'Invalid assignment ID' });
      }

      // التحقق من وجود الواجب
      const assignment = await AssignmentQuestionsService.getAssignmentById(assignmentId);
      if (!assignment) {
        return res.status(404).json({ error: 'الواجب غير موجود' });
      }

      // للطلاب: التحقق من الاشتراك في الباقة
      if (user.role === 'student') {
        // جلب lesson_id من الواجب
        if (!assignment.lesson_id) {
          console.error('[Student Access] Assignment has no lesson_id:', assignmentId);
          return res.status(404).json({ error: 'الواجب غير مرتبط بدرس' });
        }

        // جلب lesson
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error
        const lesson = await PackageSubjectLessonService.getLessonById(assignment.lesson_id);
        if (!lesson) {
          console.error('[Student Access] Lesson not found:', assignment.lesson_id);
          return res.status(404).json({ error: 'الدرس غير موجود' });
        }

        // جلب subject_id من الدرس (package_subject_item_id)
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error
        const subjectId = await PackageSubjectLessonService.getSubjectIdByLessonId(lesson.id);
        if (!subjectId) {
          console.error('[Student Access] Subject not found for lesson:', lesson.id);
          return res.status(404).json({ error: 'المادة غير موجودة' });
        }

        // جلب package_id من المادة
        const subjectResult = await pool.query(
          'SELECT package_id FROM package_subject_items WHERE id = $1',
          [subjectId],
        );

        if (!subjectResult.rowCount) {
          console.error('[Student Access] Package not found for subject:', subjectId);
          return res.status(404).json({ error: 'المادة غير موجودة' });
        }

        const packageId = subjectResult.rows[0].package_id;

        console.log('[Student Access Check]', {
          assignmentId,
          lessonId: assignment.lesson_id,
          subjectId,
          packageId,
          studentId: user.id,
        });

        // التحقق من تفعيل الباقة
        const isActivated = await PackageActivationCodeService.isActivated(packageId, user.id);

        console.log('[Student Access Result]', {
          assignmentId,
          packageId,
          studentId: user.id,
          isActivated,
        });

        if (!isActivated) {
          return res.status(403).json({
            error: 'Forbidden',
            message: 'يجب تفعيل الباقة أولاً للوصول إلى أسئلة الواجب',
            details: {
              assignment_id: assignmentId,
              lesson_id: assignment.lesson_id,
              subject_id: subjectId,
              package_id: packageId,
              student_id: user.id,
            },
          });
        }
      }

      // للأدمن والمدرسين: التحقق من الصلاحيات
      if (user.role === 'admin' || user.role === 'teacher') {
        const hasPermission = await checkAssignmentPermission(assignmentId, user.id, user.role);
        if (!hasPermission && user.role === 'teacher') {
          return res.status(403).json({
            error: 'Forbidden',
            message: 'ليس لديك صلاحية لعرض أسئلة هذا الواجب',
          });
        }
      }

      const questions = await AssignmentQuestionsService.getQuestionsByAssignment(assignmentId);

      res.json({
        success: true,
        assignment_id: assignmentId,
        questions,
        total: questions.length,
      });
    } catch (error: any) {
      console.error('Error fetching questions:', error);
      res.status(500).json({
        error: 'خطأ في جلب الأسئلة',
        message: error.message,
      });
    }
  }),
);

export { router };
