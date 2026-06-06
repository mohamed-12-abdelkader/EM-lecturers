import { Request, Response, Router } from 'express';
import { SubjectService } from '../services/subjects';
import { CreateSubjectSchema, UpdateSubjectSchema } from '../db/types/questionBank';
import { authMiddleware } from '../middleware/authentication';
import { checkPermission } from '../middleware/permissions';

// Create new subject
async function create(req: Request, res: Response) {
  try {
    const questionBankId = parseInt(req.params.bankId);
    if (isNaN(questionBankId)) {
      return res.status(400).json({
        success: false,
        message: 'معرف بنك الأسئلة غير صحيح',
      });
    }

    const validatedData = CreateSubjectSchema.parse(req.body);
    const subject = await SubjectService.create(questionBankId, validatedData);

    res.status(201).json({
      success: true,
      message: 'تم إنشاء المادة بنجاح',
      data: subject,
    });
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({
        success: false,
        message: 'بيانات غير صحيحة',
        errors: error.errors,
      });
    }

    if (error.message === 'بنك الأسئلة غير موجود') {
      return res.status(404).json({
        success: false,
        message: error.message,
      });
    }

    res.status(500).json({
      success: false,
      message: 'خطأ في إنشاء المادة',
      error: error.message,
    });
  }
}

// Get all subjects for a question bank
async function getByQuestionBank(req: Request, res: Response) {
  try {
    const questionBankId = parseInt(req.params.bankId);
    if (isNaN(questionBankId)) {
      return res.status(400).json({
        success: false,
        message: 'معرف بنك الأسئلة غير صحيح',
      });
    }

    const is_active =
      req.query.is_active !== undefined ? req.query.is_active === 'true' : undefined;
    const result = await SubjectService.getByQuestionBank(questionBankId, is_active);

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: 'خطأ في جلب المواد',
      error: error.message,
    });
  }
}

// Get subject by ID
async function getById(req: Request, res: Response) {
  try {
    const id = parseInt(req.params.subjectId);
    if (isNaN(id)) {
      return res.status(400).json({
        success: false,
        message: 'معرف المادة غير صحيح',
      });
    }

    const subject = await SubjectService.getById(id);
    if (!subject) {
      return res.status(404).json({
        success: false,
        message: 'المادة غير موجودة',
      });
    }

    res.status(200).json({
      success: true,
      data: subject,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: 'خطأ في جلب المادة',
      error: error.message,
    });
  }
}

// Update subject
async function update(req: Request, res: Response) {
  try {
    const questionBankId = parseInt(req.params.bankId);
    const subjectId = parseInt(req.params.subjectId);

    if (isNaN(questionBankId) || isNaN(subjectId)) {
      return res.status(400).json({
        success: false,
        message: 'معرفات غير صحيحة',
      });
    }

    const validatedData = UpdateSubjectSchema.parse(req.body);
    const subject = await SubjectService.update(questionBankId, subjectId, validatedData);

    res.status(200).json({
      success: true,
      message: 'تم تحديث المادة بنجاح',
      data: subject,
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
      message: 'خطأ في تحديث المادة',
      error: error.message,
    });
  }
}

// Delete subject
async function deleteSubject(req: Request, res: Response) {
  try {
    const questionBankId = parseInt(req.params.bankId);
    const subjectId = parseInt(req.params.subjectId);

    if (isNaN(questionBankId) || isNaN(subjectId)) {
      return res.status(400).json({
        success: false,
        message: 'معرفات غير صحيحة',
      });
    }

    await SubjectService.delete(questionBankId, subjectId);

    res.status(200).json({
      success: true,
      message: 'تم حذف المادة بنجاح',
    });
  } catch (error: any) {
    if (error.message === 'المادة غير موجودة أو لا تنتمي لهذا بنك الأسئلة') {
      return res.status(404).json({
        success: false,
        message: error.message,
      });
    }

    if (error.message.includes('لا يمكن حذف المادة')) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }

    res.status(500).json({
      success: false,
      message: 'خطأ في حذف المادة',
      error: error.message,
    });
  }
}

// Get subjects accessible to teacher
async function getTeacherSubjects(req: Request, res: Response) {
  try {
    const teacherId = parseInt(req.params.teacherId);
    if (isNaN(teacherId)) {
      return res.status(400).json({
        success: false,
        message: 'معرف المدرس غير صحيح',
      });
    }

    const subjects = await SubjectService.getTeacherSubjects(teacherId);

    res.status(200).json({
      success: true,
      data: {
        subjects,
        total: subjects.length,
      },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: 'خطأ في جلب مواد المدرس',
      error: error.message,
    });
  }
}

// Create router
const router = Router();

// Apply authentication middleware
router.use(authMiddleware(['admin', 'teacher', 'employee']));

// Subject routes
router.post('/:bankId/subjects', checkPermission('question_bank_management'), create);
router.get('/:bankId/subjects', getByQuestionBank);
router.get('/:bankId/subjects/:subjectId', getById);
router.put('/:bankId/subjects/:subjectId', checkPermission('question_bank_management'), update);
router.delete('/:bankId/subjects/:subjectId', checkPermission('question_bank_management'), deleteSubject);

// Teacher-specific routes
router.get('/teacher/:teacherId/subjects', getTeacherSubjects);

export { router };
