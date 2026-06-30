import { Request, Response, Router } from 'express';
import multer from 'multer';
import * as fs from 'node:fs';
import { authMiddleware } from '../middleware/authentication';
import { checkPermission } from '../middleware/permissions';
import { uploadToCloudinary } from '../utils';
import { SubjectBookService } from '../services/subjectBooks';
import { getBookWithChaptersAndLessons } from '../services/questionBankHierarchy';
import { teacherHasSubjectAccess } from '../services/teacherAccess';
import { createQuestionBankChangeRequest } from '../services/questionBankChangeRequests';

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const dir = 'uploads/books';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});
const upload = multer({ storage });

const router = Router();

async function assertTeacherBookAccess(userId: number, bookId: number): Promise<boolean> {
  const book = await SubjectBookService.getById(bookId);
  if (!book) return false;
  return teacherHasSubjectAccess(userId, book.subject_id);
}

// GET /api/books/:id/with-chapters
router.get(
  '/books/:id/with-chapters',
  authMiddleware(['admin', 'teacher', 'employee']),
  async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (Number.isNaN(id)) {
        return res.status(400).json({ success: false, message: 'معرف الكتاب غير صحيح' });
      }

      if (req.user?.role === 'teacher') {
        const allowed = await assertTeacherBookAccess(req.user.id, id);
        if (!allowed) {
          return res.status(403).json({ success: false, message: 'غير مصرح لك بهذا الكتاب' });
        }
      }

      const data = await getBookWithChaptersAndLessons(id);
      if (!data) {
        return res.status(404).json({ success: false, message: 'الكتاب غير موجود' });
      }

      return res.status(200).json({ success: true, data });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return res.status(500).json({ success: false, message: 'خطأ في جلب الكتاب', error: message });
    }
  },
);

// GET /api/subjects/:subjectId/books
router.get(
  '/subjects/:subjectId/books',
  authMiddleware(['admin', 'teacher', 'employee', 'student']),
  async (req: Request, res: Response) => {
    try {
      const subjectId = Number(req.params.subjectId);
      if (Number.isNaN(subjectId)) {
        return res.status(400).json({ success: false, message: 'معرف المادة غير صحيح' });
      }

      if (req.user?.role === 'teacher') {
        const allowed = await teacherHasSubjectAccess(req.user.id, subjectId);
        if (!allowed) {
          return res.status(403).json({ success: false, message: 'غير مصرح لك بهذه المادة' });
        }
      }

      const books = await SubjectBookService.getBySubjectId(subjectId, req.user?.role === 'student');
      return res.status(200).json({ success: true, data: books });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      if (message === 'المادة غير موجودة') {
        return res.status(404).json({ success: false, message });
      }
      return res.status(500).json({ success: false, message: 'خطأ في جلب الكتب', error: message });
    }
  },
);

// POST /api/subjects/:subjectId/books
router.post(
  '/subjects/:subjectId/books',
  authMiddleware(['admin', 'employee']),
  checkPermission('question_bank_management'),
  upload.single('image'),
  async (req: Request, res: Response) => {
    try {
      const subjectId = Number(req.params.subjectId);
      if (Number.isNaN(subjectId)) {
        return res.status(400).json({ success: false, message: 'معرف المادة غير صحيح' });
      }
      if (!req.body.name) {
        return res.status(400).json({ success: false, message: 'حقل الاسم مطلوب' });
      }

      let image_url: string | undefined;
      const file = (req as Request & { file?: Express.Multer.File }).file;
      if (file) image_url = (await uploadToCloudinary(file.path)).secure_url;

      const existingBooks = await SubjectBookService.getBySubjectId(subjectId);

      const book = await SubjectBookService.create(
        subjectId,
        {
          name: req.body.name,
          description: req.body.description,
          image_url,
          order_num: req.body.order_num ? Number(req.body.order_num) : undefined,
        },
        req.user?.id,
      );

      const message =
        existingBooks.length > 0
          ? 'تم إنشاء الكتاب بنجاح — تم نسخ الفصول والدروس من الكتاب الأول تلقائياً (الأسئلة منفصلة لكل كتاب)'
          : 'تم إنشاء الكتاب بنجاح';

      return res.status(201).json({ success: true, message, data: book });
    } catch (error: unknown) {
      const err = error as Error & { code?: string };
      if (err.message === 'المادة غير موجودة') {
        return res.status(404).json({ success: false, message: err.message });
      }
      if (err.code === '23505' || err.message?.includes('بنفس الاسم')) {
        return res.status(409).json({ success: false, message: 'يوجد كتاب بنفس الاسم داخل نفس المادة' });
      }
      return res.status(500).json({ success: false, message: 'خطأ في إنشاء الكتاب', error: err.message });
    }
  },
);

// PUT /api/books/:id
router.put(
  '/books/:id',
  authMiddleware(['admin', 'employee']),
  checkPermission('question_bank_management'),
  upload.single('image'),
  async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (Number.isNaN(id)) {
        return res.status(400).json({ success: false, message: 'معرف الكتاب غير صحيح' });
      }

      let image_url: string | undefined;
      const file = (req as Request & { file?: Express.Multer.File }).file;
      if (file) image_url = (await uploadToCloudinary(file.path)).secure_url;

      const updatePayload = {
        name: req.body.name,
        description: req.body.description,
        image_url,
        order_num: req.body.order_num !== undefined ? Number(req.body.order_num) : undefined,
        is_active:
          req.body.is_active !== undefined
            ? req.body.is_active === 'true' || req.body.is_active === true
            : undefined,
      };

      if (req.user!.role === 'employee') {
        const request = await createQuestionBankChangeRequest({
          entityType: 'book',
          entityId: id,
          action: 'update',
          payload: updatePayload,
          requestedBy: req.user!.id,
        });
        return res.status(202).json({
          success: true,
          message: 'تم إرسال طلب تعديل الكتاب للأدمن للموافقة',
          data: request,
        });
      }

      const updated = await SubjectBookService.update(id, updatePayload);
      return res.status(200).json({ success: true, message: 'تم تعديل الكتاب بنجاح', data: updated });
    } catch (error: unknown) {
      const err = error as Error & { code?: string };
      if (err.message === 'الكتاب غير موجود') {
        return res.status(404).json({ success: false, message: err.message });
      }
      if (err.code === '23505') {
        return res.status(409).json({ success: false, message: 'يوجد كتاب بنفس الاسم داخل نفس المادة' });
      }
      return res.status(500).json({ success: false, message: 'خطأ في تعديل الكتاب', error: err.message });
    }
  },
);

// DELETE /api/books/:id
router.delete(
  '/books/:id',
  authMiddleware(['admin', 'employee']),
  checkPermission('question_bank_management'),
  async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (Number.isNaN(id)) {
        return res.status(400).json({ success: false, message: 'معرف الكتاب غير صحيح' });
      }

      if (req.user!.role === 'employee') {
        const request = await createQuestionBankChangeRequest({
          entityType: 'book',
          entityId: id,
          action: 'delete',
          requestedBy: req.user!.id,
        });
        return res.status(202).json({
          success: true,
          message: 'تم إرسال طلب حذف الكتاب للأدمن للموافقة',
          data: request,
        });
      }

      await SubjectBookService.delete(id);
      return res.status(200).json({ success: true, message: 'تم حذف الكتاب بنجاح' });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      if (message === 'الكتاب غير موجود') {
        return res.status(404).json({ success: false, message });
      }
      return res.status(500).json({ success: false, message: 'خطأ في حذف الكتاب', error: message });
    }
  },
);

export { router };
