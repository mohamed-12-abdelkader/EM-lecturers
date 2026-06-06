import { Request, Response, Router } from 'express';
import multer from 'multer';
import * as fs from 'node:fs';
import { authMiddleware } from '../middleware/authentication';
import { checkPermission } from '../middleware/permissions';
import { teacherHasSubjectAccess, getSubjectIdByChapterId } from '../services/teacherAccess';
import { uploadToCloudinary } from '../utils';
import { ChapterService } from '../services/chapters';
import { ChapterService as SimpleChapterService } from '../services/chapters';
import { AdminLessonService } from '../services/lessonsAdmin';
import { createQuestionBankChangeRequest } from '../services/questionBankChangeRequests';

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = 'uploads/chapters';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});
const upload = multer({ storage });

const router = Router();

// Keep admin guard for mutating routes; read route below will allow teacher too

// GET /api/chapters/:id/with-lessons (admin or assigned teacher)
router.get(
  '/chapters/:id/with-lessons',
  authMiddleware(['admin', 'teacher', 'employee']),
  async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (Number.isNaN(id))
        return res.status(400).json({ success: false, message: 'معرف الفصل غير صحيح' });

      if (req.user?.role === 'teacher') {
        const subjectId = await getSubjectIdByChapterId(id);
        if (!subjectId) return res.status(404).json({ success: false, message: 'الفصل غير موجود' });
        const allowed = await teacherHasSubjectAccess(req.user.id, subjectId);
        if (!allowed)
          return res.status(403).json({ success: false, message: 'غير مصرح لك بهذه المادة' });
      }

      const chapter = await SimpleChapterService.getById(id);
      if (!chapter) return res.status(404).json({ success: false, message: 'الفصل غير موجود' });

      const lessons = await AdminLessonService.getByChapterId(id);
      return res.status(200).json({ success: true, data: { chapter, lessons } });
    } catch (error: any) {
      return res
        .status(500)
        .json({ success: false, message: 'خطأ في جلب الفصل والدروس', error: error.message });
    }
  },
);

// POST /api/subjects/:subjectId/chapters
router.post(
  '/subjects/:subjectId/chapters',
  authMiddleware(['admin', 'employee']), checkPermission('question_bank_management'),
  upload.single('image'),
  async (req: Request, res: Response) => {
    try {
      const subjectId = Number(req.params.subjectId);
      if (Number.isNaN(subjectId))
        return res.status(400).json({ success: false, message: 'معرف المادة غير صحيح' });

      if (!req.body.name)
        return res.status(400).json({ success: false, message: 'حقل الاسم مطلوب' });

      let image_url: string | undefined;
      const file = (req as any).file as Express.Multer.File | undefined;
      if (file) image_url = (await uploadToCloudinary(file.path)).secure_url;

      const adminId = req.user?.id as number;
      const chapter = await ChapterService.create(
        subjectId,
        { name: req.body.name, description: req.body.description, image_url },
        adminId,
      );
      return res
        .status(201)
        .json({ success: true, message: 'تم إنشاء الفصل بنجاح', data: chapter });
    } catch (error: any) {
      if (error.message === 'المادة غير موجودة')
        return res.status(404).json({ success: false, message: error.message });
      if (error.code === '23505' || error.message?.includes('باسم موجود'))
        return res
          .status(409)
          .json({ success: false, message: 'يوجد فصل بنفس الاسم داخل نفس المادة' });
      return res
        .status(500)
        .json({ success: false, message: 'خطأ في إنشاء الفصل', error: error.message });
    }
  },
);

// PUT /api/chapters/:id
router.put(
  '/chapters/:id',
  authMiddleware(['admin', 'employee']), checkPermission('question_bank_management'),
  upload.single('image'),
  async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (Number.isNaN(id))
        return res.status(400).json({ success: false, message: 'معرف الفصل غير صحيح' });

      let image_url: string | undefined;
      const file = (req as any).file as Express.Multer.File | undefined;
      if (file) image_url = (await uploadToCloudinary(file.path)).secure_url;

      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      const updatePayload = {
        name: req.body.name,
        description: req.body.description,
        image_url,
      };

      if (req.user!.role === 'employee') {
        const request = await createQuestionBankChangeRequest({
          entityType: 'chapter',
          entityId: id,
          action: 'update',
          payload: updatePayload,
          requestedBy: req.user!.id,
        });
        return res.status(202).json({
          success: true,
          message: 'تم إرسال طلب تعديل الفصل للأدمن للموافقة',
          data: request,
        });
      }

      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      const updated = await ChapterService.update(id, updatePayload);
      return res
        .status(200)
        .json({ success: true, message: 'تم تعديل الفصل بنجاح', data: updated });
    } catch (error: any) {
      if (error.message === 'الفصل غير موجود')
        return res.status(404).json({ success: false, message: error.message });
      if (error.code === '23505' || error.message?.includes('باسم موجود'))
        return res
          .status(409)
          .json({ success: false, message: 'يوجد فصل بنفس الاسم داخل نفس المادة' });
      if (error.message === 'لا توجد بيانات للتحديث')
        return res.status(400).json({ success: false, message: error.message });
      return res
        .status(500)
        .json({ success: false, message: 'خطأ في تعديل الفصل', error: error.message });
    }
  },
);

// DELETE /api/chapters/:id
router.delete('/chapters/:id', authMiddleware(['admin', 'employee']), checkPermission('question_bank_management'), async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const id = Number(req.params.id);
    if (Number.isNaN(id))
      return res.status(400).json({ success: false, message: 'معرف الفصل غير صحيح' });

    if (user.role === 'employee') {
      const request = await createQuestionBankChangeRequest({
        entityType: 'chapter',
        entityId: id,
        action: 'delete',
        requestedBy: user.id,
      });
      return res.status(202).json({
        success: true,
        message: 'تم إرسال طلب حذف الفصل للأدمن للموافقة',
        data: request,
      });
    }

    await ChapterService.delete(id);
    return res.status(200).json({ success: true, message: 'تم حذف الفصل بنجاح' });
  } catch (error: any) {
    if (error.message === 'الفصل غير موجود')
      return res.status(404).json({ success: false, message: error.message });
    return res
      .status(500)
      .json({ success: false, message: 'خطأ في حذف الفصل', error: error.message });
  }
});

export { router };
