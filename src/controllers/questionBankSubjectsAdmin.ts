import { Request, Response, Router } from 'express';
import multer from 'multer';
import * as fs from 'node:fs';
import { authMiddleware } from '../middleware/authentication';
import { uploadToCloudinary } from '../utils';
import { CreateSubjectSchema } from '../db/types/questionBank';
import { SubjectService } from '../services/subjects';

// Multer setup for optional image upload
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

import { checkPermission } from '../middleware/permissions';

// Admin or employee with permission
router.use(authMiddleware(['admin', 'employee']));
router.use(checkPermission('question_bank_management'));

// POST /api/question-banks/:bankId/subjects (create)
router.post('/:bankId/subjects', upload.single('image'), async (req: Request, res: Response) => {
  try {
    const bankId = Number(req.params.bankId);
    if (Number.isNaN(bankId)) {
      return res.status(400).json({ success: false, message: 'معرف بنك الأسئلة غير صحيح' });
    }

    let image_url: string | undefined;
    const file = (req as any).file as Express.Multer.File | undefined;
    if (file) image_url = (await uploadToCloudinary(file.path)).secure_url;

    const validated = CreateSubjectSchema.parse({ ...req.body, image_url });
    const adminId = req.user?.id as number;
    const subject = await SubjectService.create(bankId, validated, adminId);

    return res.status(201).json({
      success: true,
      message: 'تم إنشاء المادة بنجاح',
      data: subject,
    });
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res
        .status(400)
        .json({ success: false, message: 'بيانات غير صحيحة', errors: error.errors });
    }
    if (error.message === 'بنك الأسئلة غير موجود') {
      return res.status(404).json({ success: false, message: error.message });
    }
    if (error.code === '23505' || error.message?.includes('موجودة بالفعل')) {
      return res
        .status(409)
        .json({ success: false, message: 'يوجد مادة بنفس الاسم داخل نفس بنك الأسئلة' });
    }
    return res
      .status(500)
      .json({ success: false, message: 'خطأ في إنشاء المادة', error: error.message });
  }
});

export { router };
