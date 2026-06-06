import { Request, Response, Router } from 'express';
import multer from 'multer';
import * as fs from 'node:fs';
import { authMiddleware } from '../middleware/authentication';
import { checkPermission } from '../middleware/permissions';
import { uploadToCloudinary } from '../utils';
import { UpdateSubjectSchema } from '../db/types/questionBank';
import { SubjectService } from '../services/subjects';
import { ChapterService } from '../services/chapters';
import { TeacherSubjectService } from '../services/teacherSubjects';
import pool from '../db/pool';
import { createQuestionBankChangeRequest } from '../services/questionBankChangeRequests';

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = 'uploads/subjects';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});
const upload = multer({ storage });

const router = Router();

// PUT /api/subjects/:id
router.put(
  '/:id',
  authMiddleware(['admin', 'employee']), checkPermission('question_bank_management'),
  upload.single('image'),
  async (req: Request, res: Response) => {
    try {
      const user = req.user!;
      const subjectId = Number(req.params.id);
      if (Number.isNaN(subjectId))
        return res.status(400).json({ success: false, message: 'معرف المادة غير صحيح' });

      const existing = await SubjectService.getById(subjectId);
      if (!existing) return res.status(404).json({ success: false, message: 'المادة غير موجودة' });

      let image_url: string | undefined;
      const file = (req as any).file as Express.Multer.File | undefined;
      if (file) image_url = (await uploadToCloudinary(file.path)).secure_url;

      const validated = UpdateSubjectSchema.parse({ ...req.body, image_url });
      if (user.role === 'employee') {
        const request = await createQuestionBankChangeRequest({
          entityType: 'subject',
          entityId: subjectId,
          action: 'update',
          payload: validated as any,
          requestedBy: user.id,
        });
        return res.status(202).json({
          success: true,
          message: 'تم إرسال طلب تعديل المادة للأدمن للموافقة',
          data: request,
        });
      }
      const updated = await SubjectService.update(existing.question_bank_id, subjectId, validated);

      return res
        .status(200)
        .json({ success: true, message: 'تم تحديث المادة بنجاح', data: updated });
    } catch (error: any) {
      if (error.name === 'ZodError')
        return res
          .status(400)
          .json({ success: false, message: 'بيانات غير صحيحة', errors: error.errors });
      if (error.message?.includes('مادة بنفس الاسم'))
        return res
          .status(409)
          .json({ success: false, message: 'يوجد مادة بنفس الاسم داخل نفس بنك الأسئلة' });
      return res
        .status(500)
        .json({ success: false, message: 'خطأ في تحديث المادة', error: error.message });
    }
  },
);

// DELETE /api/subjects/:id
router.delete('/:id', authMiddleware(['admin', 'employee']), checkPermission('question_bank_management'), async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const subjectId = Number(req.params.id);
    if (Number.isNaN(subjectId))
      return res.status(400).json({ success: false, message: 'معرف المادة غير صحيح' });

    const existing = await SubjectService.getById(subjectId);
    if (!existing) return res.status(404).json({ success: false, message: 'المادة غير موجودة' });

    if (user.role === 'employee') {
      const request = await createQuestionBankChangeRequest({
        entityType: 'subject',
        entityId: subjectId,
        action: 'delete',
        requestedBy: user.id,
      });
      return res.status(202).json({
        success: true,
        message: 'تم إرسال طلب حذف المادة للأدمن للموافقة',
        data: request,
      });
    }

    await SubjectService.delete(existing.question_bank_id, subjectId);
    return res.status(200).json({ success: true, message: 'تم حذف المادة بنجاح' });
  } catch (error: any) {
    if (error.message?.includes('لا يمكن حذف المادة'))
      return res.status(409).json({ success: false, message: error.message });
    return res
      .status(500)
      .json({ success: false, message: 'خطأ في حذف المادة', error: error.message });
  }
});

export { router };

// Extra: GET /api/subjects/:id/with-chapters (admin or assigned teacher)
router.get(
  '/:id/with-chapters',
  authMiddleware(['admin', 'teacher', 'employee']),
  async (req: Request, res: Response) => {
    try {
      const subjectId = Number(req.params.id);
      if (Number.isNaN(subjectId))
        return res.status(400).json({ success: false, message: 'معرف المادة غير صحيح' });

      const subject = await SubjectService.getById(subjectId);
      if (!subject) return res.status(404).json({ success: false, message: 'المادة غير موجودة' });

      // If user is a teacher, ensure he is assigned to this subject
      const user = req.user!;
      if (user.role === 'teacher') {
        const assigned = await pool.query(
          'SELECT 1 FROM teacher_subjects WHERE teacher_id = $1 AND subject_id = $2',
          [user.id, subjectId],
        );
        if (!assigned.rowCount) {
          return res.status(403).json({ success: false, message: 'غير مصرح لك بهذه المادة' });
        }
      }

      const chapters = await ChapterService.getBySubjectId(subjectId);
      return res.status(200).json({ success: true, data: { subject, chapters } });
    } catch (error: any) {
      return res
        .status(500)
        .json({ success: false, message: 'خطأ في جلب المادة والفصول', error: error.message });
    }
  },
);
