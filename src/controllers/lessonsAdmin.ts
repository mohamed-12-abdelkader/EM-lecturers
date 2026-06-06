import { Request, Response, Router } from 'express';
import multer from 'multer';
import * as fs from 'node:fs';
import { authMiddleware } from '../middleware/authentication';
import { checkPermission } from '../middleware/permissions';
import { uploadToCloudinary } from '../utils';
import { AdminLessonService } from '../services/lessonsAdmin';
import { createQuestionBankChangeRequest } from '../services/questionBankChangeRequests';

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = 'uploads/lessons';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});
const upload = multer({ storage });

const router = Router();

// router.use(authMiddleware(['admin'])); // Disabled for more granular access below

// GET /api/chapters/:chapterId/lessons (list)
router.get('/chapters/:chapterId/lessons', authMiddleware(['admin', 'employee']), async (req: Request, res: Response) => {
  try {
    const chapterId = Number(req.params.chapterId);
    if (Number.isNaN(chapterId))
      return res.status(400).json({ success: false, message: 'معرف الفصل غير صحيح' });
    const lessons = await AdminLessonService.getByChapterId(chapterId);
    return res.status(200).json({ success: true, data: lessons });
  } catch (error: any) {
    if (error.message === 'الفصل غير موجود')
      return res.status(404).json({ success: false, message: error.message });
    return res
      .status(500)
      .json({ success: false, message: 'خطأ في جلب الدروس', error: error.message });
  }
});

// POST /api/chapters/:chapterId/lessons
router.post(
  '/chapters/:chapterId/lessons',
  authMiddleware(['admin', 'employee']), checkPermission('question_bank_management'),
  upload.single('image'),
  async (req: Request, res: Response) => {
    try {
      const chapterId = Number(req.params.chapterId);
      if (Number.isNaN(chapterId))
        return res.status(400).json({ success: false, message: 'معرف الفصل غير صحيح' });
      if (!req.body.name)
        return res.status(400).json({ success: false, message: 'حقل الاسم مطلوب' });

      let image_url: string | undefined;
      const file = (req as any).file as Express.Multer.File | undefined;
      if (file) image_url = (await uploadToCloudinary(file.path)).secure_url;

      const adminId = req.user?.id as number;
      const lesson = await AdminLessonService.create(
        chapterId,
        { name: req.body.name, description: req.body.description, image_url },
        adminId,
      );
      return res.status(201).json({ success: true, message: 'تم إنشاء الدرس بنجاح', data: lesson });
    } catch (error: any) {
      if (error.message === 'الفصل غير موجود')
        return res.status(404).json({ success: false, message: error.message });
      if (error.code === '23505' || error.message?.includes('بنفس الاسم'))
        return res
          .status(409)
          .json({ success: false, message: 'يوجد درس بنفس الاسم داخل نفس الفصل' });
      return res
        .status(500)
        .json({ success: false, message: 'خطأ في إنشاء الدرس', error: error.message });
    }
  },
);

// PUT /api/lessons/:id
router.put('/lessons/:id', authMiddleware(['admin', 'employee']), checkPermission('question_bank_management'), upload.single('image'), async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const id = Number(req.params.id);
    if (Number.isNaN(id))
      return res.status(400).json({ success: false, message: 'معرف الدرس غير صحيح' });

    let image_url: string | undefined;
    const file = (req as any).file as Express.Multer.File | undefined;
    if (file) image_url = (await uploadToCloudinary(file.path)).secure_url;

    const updatePayload = {
      name: req.body.name,
      description: req.body.description,
      image_url,
    };

    if (user.role === 'employee') {
      const request = await createQuestionBankChangeRequest({
        entityType: 'lesson',
        entityId: id,
        action: 'update',
        payload: updatePayload,
        requestedBy: user.id,
      });
      return res.status(202).json({
        success: true,
        message: 'تم إرسال طلب تعديل الدرس للأدمن للموافقة',
        data: request,
      });
    }

    const updated = await AdminLessonService.update(id, updatePayload);
    return res.status(200).json({ success: true, message: 'تم تعديل الدرس بنجاح', data: updated });
  } catch (error: any) {
    if (error.message === 'الدرس غير موجود')
      return res.status(404).json({ success: false, message: error.message });
    if (error.code === '23505' || error.message?.includes('بنفس الاسم'))
      return res
        .status(409)
        .json({ success: false, message: 'يوجد درس بنفس الاسم داخل نفس الفصل' });
    if (error.message === 'لا توجد بيانات للتحديث')
      return res.status(400).json({ success: false, message: error.message });
    return res
      .status(500)
      .json({ success: false, message: 'خطأ في تعديل الدرس', error: error.message });
  }
});

// DELETE /api/lessons/:id
router.delete('/lessons/:id', authMiddleware(['admin', 'employee']), checkPermission('question_bank_management'), async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const id = Number(req.params.id);
    if (Number.isNaN(id))
      return res.status(400).json({ success: false, message: 'معرف الدرس غير صحيح' });

    if (user.role === 'employee') {
      const request = await createQuestionBankChangeRequest({
        entityType: 'lesson',
        entityId: id,
        action: 'delete',
        requestedBy: user.id,
      });
      return res.status(202).json({
        success: true,
        message: 'تم إرسال طلب حذف الدرس للأدمن للموافقة',
        data: request,
      });
    }

    await AdminLessonService.delete(id);
    return res.status(200).json({ success: true, message: 'تم حذف الدرس بنجاح' });
  } catch (error: any) {
    if (error.message === 'الدرس غير موجود')
      return res.status(404).json({ success: false, message: error.message });
    return res
      .status(500)
      .json({ success: false, message: 'خطأ في حذف الدرس', error: error.message });
  }
});

export { router };
