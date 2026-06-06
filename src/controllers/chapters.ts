import { Request, Response } from 'express';
import { ChapterService } from '../services/chapters';
import { CreateChapterSchema, UpdateChapterSchema } from '../db/types/questionBank';

export class ChapterController {
  // Create new chapter
  static async create(req: Request, res: Response) {
    try {
      const questionBankId = parseInt(req.params.bankId);
      const subjectId = parseInt(req.params.subjectId);

      if (isNaN(questionBankId) || isNaN(subjectId)) {
        return res.status(400).json({
          success: false,
          message: 'معرفات غير صحيحة',
        });
      }

      const validatedData = CreateChapterSchema.parse(req.body);
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-expect-error
      const chapter = await ChapterService.create(questionBankId, subjectId, validatedData);

      res.status(201).json({
        success: true,
        message: 'تم إنشاء الفصل بنجاح',
        data: chapter,
      });
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return res.status(400).json({
          success: false,
          message: 'بيانات غير صحيحة',
          errors: error.errors,
        });
      }

      if (error.message === 'المادة غير موجودة أو لا تنتمي لهذا بنك الأسئلة') {
        return res.status(404).json({
          success: false,
          message: error.message,
        });
      }

      res.status(500).json({
        success: false,
        message: 'خطأ في إنشاء الفصل',
        error: error.message,
      });
    }
  }

  // Get all chapters for a subject
  static async getBySubject(req: Request, res: Response) {
    try {
      const questionBankId = parseInt(req.params.bankId);
      const subjectId = parseInt(req.params.subjectId);

      if (isNaN(questionBankId) || isNaN(subjectId)) {
        return res.status(400).json({
          success: false,
          message: 'معرفات غير صحيحة',
        });
      }

      const is_active =
        req.query.is_active !== undefined ? req.query.is_active === 'true' : undefined;
      const order = (req.query.order as 'asc' | 'desc') || 'asc';

      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-expect-error
      const result = await ChapterService.getBySubject(questionBankId, subjectId, is_active, order);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: 'خطأ في جلب الفصول',
        error: error.message,
      });
    }
  }

  // Get chapter by ID
  static async getById(req: Request, res: Response) {
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

      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-expect-error
      const chapter = await ChapterService.getById(questionBankId, subjectId, chapterId);
      if (!chapter) {
        return res.status(404).json({
          success: false,
          message: 'الفصل غير موجود',
        });
      }

      res.status(200).json({
        success: true,
        data: chapter,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: 'خطأ في جلب الفصل',
        error: error.message,
      });
    }
  }

  // Update chapter
  static async update(req: Request, res: Response) {
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

      const validatedData = UpdateChapterSchema.parse(req.body);
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      const chapter = await ChapterService.update(
        questionBankId,
        subjectId,
        chapterId,
        validatedData,
      );

      res.status(200).json({
        success: true,
        message: 'تم تحديث الفصل بنجاح',
        data: chapter,
      });
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return res.status(400).json({
          success: false,
          message: 'بيانات غير صحيحة',
          errors: error.errors,
        });
      }

      if (
        error.message === 'المادة غير موجودة أو لا تنتمي لهذا بنك الأسئلة' ||
        error.message === 'الفصل غير موجود أو لا ينتمي لهذه المادة'
      ) {
        return res.status(404).json({
          success: false,
          message: error.message,
        });
      }

      res.status(500).json({
        success: false,
        message: 'خطأ في تحديث الفصل',
        error: error.message,
      });
    }
  }

  // Delete chapter
  static async delete(req: Request, res: Response) {
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

      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-expect-error
      await ChapterService.delete(questionBankId, subjectId, chapterId);

      res.status(200).json({
        success: true,
        message: 'تم حذف الفصل بنجاح',
      });
    } catch (error: any) {
      if (
        error.message === 'المادة غير موجودة أو لا تنتمي لهذا بنك الأسئلة' ||
        error.message === 'الفصل غير موجود أو لا ينتمي لهذه المادة'
      ) {
        return res.status(404).json({
          success: false,
          message: error.message,
        });
      }

      if (error.message.includes('لا يمكن حذف الفصل')) {
        return res.status(400).json({
          success: false,
          message: error.message,
        });
      }

      res.status(500).json({
        success: false,
        message: 'خطأ في حذف الفصل',
        error: error.message,
      });
    }
  }
}
