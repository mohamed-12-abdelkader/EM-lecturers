import { Router, Request, Response } from 'express';
import { CompetitionQuestionsService } from '../services/competitionQuestions';
import { authMiddleware } from '../middleware/authentication';
import {
  CompetitionQuestionCreate,
  CompetitionQuestionUpdate,
  BulkQuestionsCreate,
} from '../db/types';

const router = Router();

// إنشاء سؤال واحد (أدمن فقط)
router.post('/', authMiddleware(['admin']), async (req: Request, res: Response) => {
  try {
    const questionData: CompetitionQuestionCreate = req.body;

    // التحقق من البيانات المطلوبة
    if (
      !questionData.competition_id ||
      !questionData.question_text ||
      !questionData.option_a ||
      !questionData.option_b ||
      !questionData.option_c ||
      !questionData.option_d ||
      !questionData.correct_answer
    ) {
      return res.status(400).json({
        success: false,
        message: 'جميع البيانات مطلوبة: معرف المسابقة، نص السؤال، جميع الخيارات، والإجابة الصحيحة',
      });
    }

    const question = await CompetitionQuestionsService.create(questionData, req.user!.id);

    res.status(201).json({
      success: true,
      message: 'تم إنشاء السؤال بنجاح',
      data: question,
    });
  } catch (error: any) {
    console.error('Error creating question:', error);
    res.status(500).json({
      success: false,
      message: 'فشل في إنشاء السؤال',
      error: error.message,
    });
  }
});

// إنشاء مجموعة أسئلة دفعة واحدة (أدمن فقط)
router.post('/bulk', authMiddleware(['admin']), async (req: Request, res: Response) => {
  try {
    const bulkData: BulkQuestionsCreate = req.body;

    // التحقق من البيانات
    if (!bulkData.competition_id || !bulkData.questions || bulkData.questions.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'معرف المسابقة ومجموعة الأسئلة مطلوبان',
      });
    }

    // التحقق من صحة كل سؤال
    for (let i = 0; i < bulkData.questions.length; i++) {
      const question = bulkData.questions[i];
      if (
        !question.question_text ||
        !question.option_a ||
        !question.option_b ||
        !question.option_c ||
        !question.option_d ||
        !question.correct_answer
      ) {
        return res.status(400).json({
          success: false,
          message: `السؤال رقم ${i + 1} يحتوي على بيانات ناقصة`,
        });
      }
    }

    const questions = await CompetitionQuestionsService.createBulk(bulkData, req.user!.id);

    res.status(201).json({
      success: true,
      message: `تم إنشاء ${questions.length} سؤال بنجاح`,
      data: questions,
    });
  } catch (error: any) {
    console.error('Error creating bulk questions:', error);
    res.status(500).json({
      success: false,
      message: 'فشل في إنشاء الأسئلة',
      error: error.message,
    });
  }
});

// إنشاء أسئلة من نص بسيط (أدمن فقط)
router.post('/text', authMiddleware(['admin']), async (req: Request, res: Response) => {
  try {
    const { competition_id, questions_text } = req.body;

    // التحقق من البيانات
    if (!competition_id || !questions_text) {
      return res.status(400).json({
        success: false,
        message: 'معرف المسابقة ونص الأسئلة مطلوبان',
      });
    }

    if (typeof questions_text !== 'string' || questions_text.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'نص الأسئلة يجب أن يكون نصاً صحيحاً',
      });
    }

    const result = await CompetitionQuestionsService.createFromText(
      competition_id,
      questions_text,
      req.user!.id,
    );

    res.status(201).json({
      success: true,
      message: `تم إنشاء ${result.parsedCount} سؤال بنجاح من النص`,
      data: {
        questions: result.questions,
        parsed_count: result.parsedCount,
        errors: result.errors,
      },
      note: 'تم إنشاء الأسئلة بدون تحديد الإجابة الصحيحة. يمكنك تحديدها لاحقاً باستخدام API تحديث الإجابة الصحيحة.',
    });
  } catch (error: any) {
    console.error('Error creating questions from text:', error);
    res.status(500).json({
      success: false,
      message: 'فشل في إنشاء الأسئلة من النص',
      error: error.message,
    });
  }
});

// الحصول على جميع أسئلة مسابقة معينة
router.get('/competition/:competitionId', async (req: Request, res: Response) => {
  try {
    const competitionId = parseInt(req.params.competitionId);

    if (isNaN(competitionId)) {
      return res.status(400).json({
        success: false,
        message: 'معرف المسابقة غير صحيح',
      });
    }

    const questions = await CompetitionQuestionsService.getByCompetition(competitionId);

    res.json({
      success: true,
      data: questions,
    });
  } catch (error: any) {
    console.error('Error fetching questions:', error);
    res.status(500).json({
      success: false,
      message: 'فشل في جلب الأسئلة',
      error: error.message,
    });
  }
});

// الحصول على أسئلة مسابقة معينة مع تفاصيل إضافية (أدمن فقط)
router.get(
  '/competition/:competitionId/details',
  authMiddleware(['admin']),
  async (req: Request, res: Response) => {
    try {
      const competitionId = parseInt(req.params.competitionId);

      if (isNaN(competitionId)) {
        return res.status(400).json({
          success: false,
          message: 'معرف المسابقة غير صحيح',
        });
      }

      const questions =
        await CompetitionQuestionsService.getByCompetitionWithDetails(competitionId);

      res.json({
        success: true,
        data: questions,
      });
    } catch (error: any) {
      console.error('Error fetching questions with details:', error);
      res.status(500).json({
        success: false,
        message: 'فشل في جلب الأسئلة مع التفاصيل',
        error: error.message,
      });
    }
  },
);

// الحصول على سؤال بواسطة المعرف
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);

    if (isNaN(id)) {
      return res.status(400).json({
        success: false,
        message: 'معرف السؤال غير صحيح',
      });
    }

    const question = await CompetitionQuestionsService.getById(id);

    if (!question) {
      return res.status(404).json({
        success: false,
        message: 'السؤال غير موجود',
      });
    }

    res.json({
      success: true,
      data: question,
    });
  } catch (error: any) {
    console.error('Error fetching question:', error);
    res.status(500).json({
      success: false,
      message: 'فشل في جلب السؤال',
      error: error.message,
    });
  }
});

// تحديث سؤال (أدمن فقط)
router.put('/:id', authMiddleware(['admin']), async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);

    if (isNaN(id)) {
      return res.status(400).json({
        success: false,
        message: 'معرف السؤال غير صحيح',
      });
    }

    // التحقق من وجود السؤال
    const existingQuestion = await CompetitionQuestionsService.getById(id);
    if (!existingQuestion) {
      return res.status(404).json({
        success: false,
        message: 'السؤال غير موجود',
      });
    }

    const updateData: CompetitionQuestionUpdate = req.body;

    // التحقق من صحة الإجابة الصحيحة إذا تم تحديثها
    if (updateData.correct_answer && !['A', 'B', 'C', 'D'].includes(updateData.correct_answer)) {
      return res.status(400).json({
        success: false,
        message: 'الإجابة الصحيحة يجب أن تكون A, B, C, أو D',
      });
    }

    const updatedQuestion = await CompetitionQuestionsService.update(id, updateData);

    res.json({
      success: true,
      message: 'تم تحديث السؤال بنجاح',
      data: updatedQuestion,
    });
  } catch (error: any) {
    console.error('Error updating question:', error);
    res.status(500).json({
      success: false,
      message: 'فشل في تحديث السؤال',
      error: error.message,
    });
  }
});

// حذف سؤال (أدمن فقط)
router.delete('/:id', authMiddleware(['admin']), async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);

    if (isNaN(id)) {
      return res.status(400).json({
        success: false,
        message: 'معرف السؤال غير صحيح',
      });
    }

    // التحقق من وجود السؤال
    const exists = await CompetitionQuestionsService.exists(id);
    if (!exists) {
      return res.status(404).json({
        success: false,
        message: 'السؤال غير موجود',
      });
    }

    await CompetitionQuestionsService.delete(id);

    res.json({
      success: true,
      message: 'تم حذف السؤال بنجاح',
    });
  } catch (error: any) {
    console.error('Error deleting question:', error);
    res.status(500).json({
      success: false,
      message: 'فشل في حذف السؤال',
      error: error.message,
    });
  }
});

// تغيير حالة النشاط (أدمن فقط)
router.patch(
  '/:id/toggle-active',
  authMiddleware(['admin']),
  async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);

      if (isNaN(id)) {
        return res.status(400).json({
          success: false,
          message: 'معرف السؤال غير صحيح',
        });
      }

      const updatedQuestion = await CompetitionQuestionsService.toggleActive(id);
      if (!updatedQuestion) {
        return res.status(404).json({
          success: false,
          message: 'السؤال غير موجود',
        });
      }

      res.json({
        success: true,
        message: `تم ${updatedQuestion.is_active ? 'تفعيل' : 'إلغاء تفعيل'} السؤال بنجاح`,
        data: updatedQuestion,
      });
    } catch (error: any) {
      console.error('Error toggling question active status:', error);
      res.status(500).json({
        success: false,
        message: 'فشل في تغيير حالة النشاط',
        error: error.message,
      });
    }
  },
);

// تغيير ترتيب الأسئلة (أدمن فقط)
router.patch(
  '/reorder/:competitionId',
  authMiddleware(['admin']),
  async (req: Request, res: Response) => {
    try {
      const competitionId = parseInt(req.params.competitionId);

      if (isNaN(competitionId)) {
        return res.status(400).json({
          success: false,
          message: 'معرف المسابقة غير صحيح',
        });
      }

      const { questionOrders } = req.body;

      if (!Array.isArray(questionOrders) || questionOrders.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'ترتيب الأسئلة مطلوب',
        });
      }

      // التحقق من صحة البيانات
      for (const item of questionOrders) {
        if (!item.id || typeof item.order !== 'number' || item.order < 0) {
          return res.status(400).json({
            success: false,
            message: 'بيانات ترتيب الأسئلة غير صحيحة',
          });
        }
      }

      await CompetitionQuestionsService.reorderQuestions(competitionId, questionOrders);

      res.json({
        success: true,
        message: 'تم تغيير ترتيب الأسئلة بنجاح',
      });
    } catch (error: any) {
      console.error('Error reordering questions:', error);
      res.status(500).json({
        success: false,
        message: 'فشل في تغيير ترتيب الأسئلة',
        error: error.message,
      });
    }
  },
);

// الحصول على إحصائيات الأسئلة لمسابقة معينة (أدمن فقط)
router.get(
  '/stats/:competitionId',
  authMiddleware(['admin']),
  async (req: Request, res: Response) => {
    try {
      const competitionId = parseInt(req.params.competitionId);

      if (isNaN(competitionId)) {
        return res.status(400).json({
          success: false,
          message: 'معرف المسابقة غير صحيح',
        });
      }

      const stats = await CompetitionQuestionsService.getCompetitionStats(competitionId);

      res.json({
        success: true,
        data: stats,
      });
    } catch (error: any) {
      console.error('Error fetching question stats:', error);
      res.status(500).json({
        success: false,
        message: 'فشل في جلب إحصائيات الأسئلة',
        error: error.message,
      });
    }
  },
);

// تحديد الإجابة الصحيحة للسؤال (أدمن فقط)
router.patch(
  '/:id/correct-answer',
  authMiddleware(['admin']),
  async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);

      if (isNaN(id)) {
        return res.status(400).json({
          success: false,
          message: 'معرف السؤال غير صحيح',
        });
      }

      const { correct_answer } = req.body;

      // التحقق من وجود الإجابة الصحيحة
      if (!correct_answer) {
        return res.status(400).json({
          success: false,
          message: 'الإجابة الصحيحة مطلوبة',
        });
      }

      // التحقق من صحة الإجابة الصحيحة
      if (!['A', 'B', 'C', 'D'].includes(correct_answer)) {
        return res.status(400).json({
          success: false,
          message: 'الإجابة الصحيحة يجب أن تكون A, B, C, أو D',
        });
      }

      // التحقق من وجود السؤال
      const existingQuestion = await CompetitionQuestionsService.getById(id);
      if (!existingQuestion) {
        return res.status(404).json({
          success: false,
          message: 'السؤال غير موجود',
        });
      }

      // تحديث الإجابة الصحيحة فقط
      const updatedQuestion = await CompetitionQuestionsService.updateCorrectAnswer(
        id,
        correct_answer,
      );

      res.json({
        success: true,
        message: `تم تحديث الإجابة الصحيحة إلى ${correct_answer} بنجاح`,
        data: updatedQuestion,
      });
    } catch (error: any) {
      console.error('Error updating correct answer:', error);
      res.status(500).json({
        success: false,
        message: 'فشل في تحديث الإجابة الصحيحة',
        error: error.message,
      });
    }
  },
);

export { router };
