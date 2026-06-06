import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/authentication';
import { PackageSubjectItemService } from '../services/packageSubjectItems';
import { logger, uploadToCloudinary } from '../utils';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

const router = Router();

// Configure multer for package subject item images
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'uploads';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'package-subject-' + uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('فقط ملفات الصور مسموح بها!'));
    }
  },
});

// 1. جلب جميع مواد الباقة
router.get('/package/:packageId', async (req: Request, res: Response) => {
  try {
    const { packageId } = req.params;

    // التحقق من وجود الباقة
    const packageExists = await PackageSubjectItemService.packageExists(parseInt(packageId));
    if (!packageExists) {
      return res.status(404).json({ error: 'الباقة غير موجودة' });
    }

    const items = await PackageSubjectItemService.getPackageSubjectItems(parseInt(packageId));
    res.json({ items });
  } catch (error) {
    logger.error('Error fetching package subject items:', error);
    res.status(500).json({ error: 'خطأ في جلب مواد الباقة' });
  }
});

// 2. جلب مادة باقة محددة
// جلب مادة باقة محددة مع التحقق من الصلاحيات
router.get('/:id', authMiddleware(['admin', 'teacher', 'student']), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const user = (req as any).user;
    const item = await PackageSubjectItemService.getPackageSubjectItem(parseInt(id));
    if (!item) {
      return res.status(404).json({ error: 'المادة غير موجودة' });
    }
    // الأدمن: صلاحية كاملة
    if (user.role === 'admin') {
      return res.json({ item });
    }
    // المدرس: يجب أن يكون لديه صلاحية تدريس المادة
    if (user.role === 'teacher') {
      // eslint-disable-next-line prettier/prettier, @typescript-eslint/no-require-imports
      const hasPermission = await require('../services/packageSubjectPermissions').PackageSubjectPermissionsService.hasPermission(item.id, user.id);
      if (!hasPermission) {
        return res.status(403).json({ error: 'ليس لديك صلاحية للوصول إلى هذه المادة' });
      }
      return res.json({ item });
    }
    // الطالب: يجب أن يكون مفعل الباقة
    if (user.role === 'student') {
        const isActivated =
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          await require('../services/packageActivationCodes').PackageActivationCodeService.isActivated(
            item.package_id,
            user.id,
          );
      if (!isActivated) {
        return res.status(403).json({ error: 'يجب تفعيل الباقة أولاً للوصول إلى المادة' });
      }
      return res.json({ item });
    }
    // أي دور آخر: مرفوض
    return res.status(403).json({ error: 'غير مصرح' });
  } catch (error) {
    logger.error('Error fetching package subject item:', error);
    res.status(500).json({ error: 'خطأ في جلب المادة' });
  }
});

// 3. إنشاء مادة باقة جديدة (للأدمن فقط)
router.post(
  '/package/:packageId',
  authMiddleware(['admin']),
  upload.single('image'),
  async (req: Request, res: Response) => {
    try {
      const { packageId } = req.params;
      const { name } = req.body;

      if (!name) {
        return res.status(400).json({ error: 'اسم المادة مطلوب' });
      }

      // التحقق من وجود الباقة
      const packageExists = await PackageSubjectItemService.packageExists(parseInt(packageId));
      if (!packageExists) {
        return res.status(404).json({ error: 'الباقة غير موجودة' });
      }

      const file = req.file ?? null;
      const image = file ? (await uploadToCloudinary(file.path)).secure_url : undefined;

      const item = await PackageSubjectItemService.createPackageSubjectItem(
        parseInt(packageId),
        name,
        image,
      );

      res.status(201).json({
        message: 'تم إنشاء مادة الباقة بنجاح',
        item,
      });
    } catch (error) {
      logger.error('Error creating package subject item:', error);
      res.status(500).json({ error: 'خطأ في إنشاء مادة الباقة' });
    }
  },
);

// 4. تحديث مادة باقة (للأدمن فقط)
router.put(
  '/:id',
  authMiddleware(['admin']),
  upload.single('image'),
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { name } = req.body;

      // التحقق من وجود المادة
      const existingItem = await PackageSubjectItemService.getPackageSubjectItem(parseInt(id));
      if (!existingItem) {
        return res.status(404).json({ error: 'المادة غير موجودة' });
      }

      // التحقق من أن name موجود إذا تم إرساله
      const updatedName = name !== undefined ? name.trim() : existingItem.name;
      if (!updatedName) {
        return res.status(400).json({ error: 'اسم المادة مطلوب' });
      }

      // رفع الصورة الجديدة إذا تم إرسالها، وإلا الاحتفاظ بالصورة القديمة
      const file = req.file ?? null;
      let imageUrl: string | undefined = existingItem.image || undefined;

      if (file) {
        try {
          const uploaded = await uploadToCloudinary(file.path);
          imageUrl = uploaded.secure_url;
        } catch (error) {
          logger.error('Error uploading image to Cloudinary:', error);
          return res.status(500).json({ error: 'فشل في رفع الصورة' });
        }
      }

      const item = await PackageSubjectItemService.updatePackageSubjectItem(
        parseInt(id),
        updatedName,
        imageUrl,
      );

      if (!item) {
        return res.status(404).json({ error: 'المادة غير موجودة' });
      }

      res.json({
        success: true,
        message: 'تم تحديث مادة الباقة بنجاح',
        item,
      });
    } catch (error) {
      logger.error('Error updating package subject item:', error);
      res.status(500).json({ error: 'خطأ في تحديث مادة الباقة' });
    }
  },
);

// 5. حذف مادة باقة (للأدمن فقط)
router.delete('/:id', authMiddleware(['admin']), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // جلب المادة قبل حذفها
    const existingItem = await PackageSubjectItemService.getPackageSubjectItem(parseInt(id));
    if (!existingItem) {
      return res.status(404).json({
        success: false,
        error: 'المادة غير موجودة',
      });
    }

    await PackageSubjectItemService.deletePackageSubjectItem(parseInt(id));

    // ملاحظة: الصور محفوظة على Cloudinary، لا حاجة لحذفها من النظام المحلي

    res.json({
      success: true,
      message: 'تم حذف مادة الباقة بنجاح',
      deleted_item: {
        id: existingItem.id,
        name: existingItem.name,
      },
    });
  } catch (error) {
    logger.error('Error deleting package subject item:', error);
    res.status(500).json({
      success: false,
      error: 'خطأ في حذف مادة الباقة',
    });
  }
});

export { router };
