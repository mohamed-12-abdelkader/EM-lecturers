import { Request, Response } from 'express';
import { QuestionService } from '../services/questions';
import { CreateQuestionSchema, UpdateQuestionStatusSchema } from '../db/types/questionBank';

export class QuestionController {
  // Create new question (Teacher)
  static async create(req: Request, res: Response) {
    try {
      const questionBankId = parseInt(req.params.bankId);
      const subjectId = parseInt(req.params.subjectId);
      const chapterId = parseInt(req.params.chapterId);
      const lessonId = parseInt(req.params.lessonId);

      if (isNaN(questionBankId) || isNaN(subjectId) || isNaN(chapterId) || isNaN(lessonId)) {
        return res.status(400).json({
          success: false,
          message: 'معرفات غير صحيحة',
        });
      }

      // Get teacher ID from authenticated user
      const teacherId = (req as any).user.id;

      const validatedData = CreateQuestionSchema.parse(req.body);
      const question = await QuestionService.create(
        questionBankId,
        subjectId,
        chapterId,
        lessonId,
        teacherId,
        validatedData,
      );

      res.status(201).json({
        success: true,
        message: 'تم إضافة السؤال بنجاح وتم إرساله للمراجعة',
        data: question,
      });
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return res.status(400).json({
          success: false,
          message: 'بيانات غير صحيحة',
          errors: error.errors,
        });
      }

      if (error.message === 'الدرس غير موجود أو لا ينتمي لهذا الفصل أو المادة أو بنك الأسئلة') {
        return res.status(404).json({
          success: false,
          message: error.message,
        });
      }

      if (error.message === 'ليس لديك صلاحية لإضافة أسئلة لهذه المادة') {
        return res.status(403).json({
          success: false,
          message: error.message,
        });
      }

      res.status(500).json({
        success: false,
        message: 'خطأ في إضافة السؤال',
        error: error.message,
      });
    }
  }

  // Get questions for a lesson
  static async getByLesson(req: Request, res: Response) {
    try {
      const questionBankId = parseInt(req.params.bankId);
      const subjectId = parseInt(req.params.subjectId);
      const chapterId = parseInt(req.params.chapterId);
      const lessonId = parseInt(req.params.lessonId);

      if (isNaN(questionBankId) || isNaN(subjectId) || isNaN(chapterId) || isNaN(lessonId)) {
        return res.status(400).json({
          success: false,
          message: 'معرفات غير صحيحة',
        });
      }

      const status = req.query.status as string;
      const limit = parseInt(req.query.limit as string) || 20;
      const offset = parseInt(req.query.offset as string) || 0;

      const result = await QuestionService.getByLesson(
        questionBankId,
        subjectId,
        chapterId,
        lessonId,
        status,
        limit,
        offset,
      );

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: 'خطأ في جلب الأسئلة',
        error: error.message,
      });
    }
  }

  // Get question by ID
  static async getById(req: Request, res: Response) {
    try {
      const id = parseInt(req.params.questionId);
      if (isNaN(id)) {
        return res.status(400).json({
          success: false,
          message: 'معرف السؤال غير صحيح',
        });
      }

      const question = await QuestionService.getById(id);
      if (!question) {
        return res.status(404).json({
          success: false,
          message: 'السؤال غير موجود',
        });
      }

      res.status(200).json({
        success: true,
        data: question,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: 'خطأ في جلب السؤال',
        error: error.message,
      });
    }
  }

  // Get pending questions for admin review
  static async getPending(req: Request, res: Response) {
    try {
      const limit = parseInt(req.query.limit as string) || 20;
      const offset = parseInt(req.query.offset as string) || 0;
      const subject_id = req.query.subject_id
        ? parseInt(req.query.subject_id as string)
        : undefined;
      const teacher_id = req.query.teacher_id
        ? parseInt(req.query.teacher_id as string)
        : undefined;
      const difficulty_level = req.query.difficulty_level as string;

      const result = await QuestionService.getPending(
        limit,
        offset,
        subject_id,
        teacher_id,
        difficulty_level,
      );

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: 'خطأ في جلب الأسئلة المعلقة',
        error: error.message,
      });
    }
  }

  // Approve question (Admin)
  static async approve(req: Request, res: Response) {
    try {
      const questionId = parseInt(req.params.questionId);
      if (isNaN(questionId)) {
        return res.status(400).json({
          success: false,
          message: 'معرف السؤال غير صحيح',
        });
      }

      const adminId = (req as any).user.id;
      const validatedData = UpdateQuestionStatusSchema.parse(req.body);

      const question = await QuestionService.approve(questionId, adminId, validatedData);

      res.status(200).json({
        success: true,
        message: 'تمت الموافقة على السؤال بنجاح',
        data: question,
      });
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return res.status(400).json({
          success: false,
          message: 'بيانات غير صحيحة',
          errors: error.errors,
        });
      }

      if (error.message === 'السؤال غير موجود أو تمت مراجعته بالفعل') {
        return res.status(404).json({
          success: false,
          message: error.message,
        });
      }

      res.status(500).json({
        success: false,
        message: 'خطأ في الموافقة على السؤال',
        error: error.message,
      });
    }
  }

  // Reject question (Admin)
  static async reject(req: Request, res: Response) {
    try {
      const questionId = parseInt(req.params.questionId);
      if (isNaN(questionId)) {
        return res.status(400).json({
          success: false,
          message: 'معرف السؤال غير صحيح',
        });
      }

      const adminId = (req as any).user.id;
      const validatedData = UpdateQuestionStatusSchema.parse(req.body);

      const question = await QuestionService.reject(questionId, adminId, validatedData);

      res.status(200).json({
        success: true,
        message: 'تم رفض السؤال بنجاح',
        data: question,
      });
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return res.status(400).json({
          success: false,
          message: 'بيانات غير صحيحة',
          errors: error.errors,
        });
      }

      if (error.message === 'سبب الرفض مطلوب') {
        return res.status(400).json({
          success: false,
          message: error.message,
        });
      }

      if (error.message === 'السؤال غير موجود أو تمت مراجعته بالفعل') {
        return res.status(404).json({
          success: false,
          message: error.message,
        });
      }

      res.status(500).json({
        success: false,
        message: 'خطأ في رفض السؤال',
        error: error.message,
      });
    }
  }

  // Delete question
  static async delete(req: Request, res: Response) {
    try {
      const questionId = parseInt(req.params.questionId);
      if (isNaN(questionId)) {
        return res.status(400).json({
          success: false,
          message: 'معرف السؤال غير صحيح',
        });
      }

      await QuestionService.delete(questionId);

      res.status(200).json({
        success: true,
        message: 'تم حذف السؤال بنجاح',
      });
    } catch (error: any) {
      if (error.message === 'السؤال غير موجود') {
        return res.status(404).json({
          success: false,
          message: error.message,
        });
      }

      res.status(500).json({
        success: false,
        message: 'خطأ في حذف السؤال',
        error: error.message,
      });
    }
  }
}
