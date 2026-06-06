import { Request, Response } from 'express';
import { LessonService } from '../services/lessons';
import { CreateLessonSchema, UpdateLessonSchema } from '../db/types/questionBank';

export class LessonController {
  // Create new lesson
  static async create(req: Request, res: Response) {
    try {
      const questionBankId = parseInt(req.params.bankId);
      const subjectId = parseInt(req.params.subjectId);
      const chapterId = parseInt(req.params.chapterId);

      if (isNaN(questionBankId) || isNaN(subjectId) || isNaN(chapterId)) {
        return res.status(400).json({
          success: false,
          message: 'معرفات غير صحيحة',
        });
      }

      const validatedData = CreateLessonSchema.parse(req.body);
      const lesson = await LessonService.create(
        questionBankId,
        subjectId,
        chapterId,
        validatedData,
      );

      res.status(201).json({
        success: true,
        message: 'تم إنشاء الدرس بنجاح',
        data: lesson,
      });
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return res.status(400).json({
          success: false,
          message: 'بيانات غير صحيحة',
          errors: error.errors,
        });
      }

      if (error.message === 'الفصل غير موجود أو لا ينتمي لهذه المادة أو بنك الأسئلة') {
        return res.status(404).json({
          success: false,
          message: error.message,
        });
      }

      res.status(500).json({
        success: false,
        message: 'خطأ في إنشاء الدرس',
        error: error.message,
      });
    }
  }

  // Get all lessons for a chapter
  static async getByChapter(req: Request, res: Response) {
    try {
      const questionBankId = parseInt(req.params.bankId);
      const subjectId = parseInt(req.params.subjectId);
      const chapterId = parseInt(req.params.chapterId);

      if (isNaN(questionBankId) || isNaN(subjectId) || isNaN(chapterId)) {
        return res.status(400).json({
          success: false,
          message: 'معرفات غير صحيحة',
        });
      }

      const is_active =
        req.query.is_active !== undefined ? req.query.is_active === 'true' : undefined;
      const order = (req.query.order as 'asc' | 'desc') || 'asc';

      const result = await LessonService.getByChapter(
        questionBankId,
        subjectId,
        chapterId,
        is_active,
        order,
      );

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: 'خطأ في جلب الدروس',
        error: error.message,
      });
    }
  }

  // Get lesson by ID
  static async getById(req: Request, res: Response) {
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

      const lesson = await LessonService.getById(questionBankId, subjectId, chapterId, lessonId);
      if (!lesson) {
        return res.status(404).json({
          success: false,
          message: 'الدرس غير موجود',
        });
      }

      res.status(200).json({
        success: true,
        data: lesson,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: 'خطأ في جلب الدرس',
        error: error.message,
      });
    }
  }

  // Update lesson
  static async update(req: Request, res: Response) {
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

      const validatedData = UpdateLessonSchema.parse(req.body);
      const lesson = await LessonService.update(
        questionBankId,
        subjectId,
        chapterId,
        lessonId,
        validatedData,
      );

      res.status(200).json({
        success: true,
        message: 'تم تحديث الدرس بنجاح',
        data: lesson,
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

      res.status(500).json({
        success: false,
        message: 'خطأ في تحديث الدرس',
        error: error.message,
      });
    }
  }

  // Delete lesson
  static async delete(req: Request, res: Response) {
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

      await LessonService.delete(questionBankId, subjectId, chapterId, lessonId);

      res.status(200).json({
        success: true,
        message: 'تم حذف الدرس بنجاح',
      });
    } catch (error: any) {
      if (error.message === 'الدرس غير موجود أو لا ينتمي لهذا الفصل أو المادة أو بنك الأسئلة') {
        return res.status(404).json({
          success: false,
          message: error.message,
        });
      }

      if (error.message.includes('لا يمكن حذف الدرس')) {
        return res.status(400).json({
          success: false,
          message: error.message,
        });
      }

      res.status(500).json({
        success: false,
        message: 'خطأ في حذف الدرس',
        error: error.message,
      });
    }
  }
}
