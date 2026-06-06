import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { CompetitionsService } from '../services/competitions';
import { authMiddleware } from '../middleware/authentication';
import { uploadToBunnyStorage } from '../services/bunny';
import { CompetitionCreate, CompetitionUpdate } from '../db/types';

const router = Router();

// إعداد multer لرفع الملفات
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'uploads/competitions';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'competition-' + uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('فقط ملفات الصور مسموح بها'));
    }
  },
});

// إنشاء مسابقة جديدة (أدمن فقط)
router.post(
  '/',
  authMiddleware(['admin']),
  upload.single('image'),
  async (req: Request, res: Response) => {
    try {
      const { title, description, duration, grade_id, is_visible, is_active } = req.body;

      if (!title || !duration || !grade_id) {
        return res.status(400).json({
          success: false,
          message: 'العنوان والمدة والصف الدراسي مطلوبون',
        });
      }

      let image_url = null;

      // رفع الصورة إذا تم توفيرها
      if (req.file) {
        try {
          const uploadResult = await uploadToBunnyStorage({
            path: req.file.path,
            ext: path.extname(req.file.originalname).substring(1),
            mime: req.file.mimetype,
            originalname: req.file.originalname,
          });
          image_url = uploadResult;
        } catch (uploadError) {
          return res.status(500).json({
            success: false,
            message: 'فشل في رفع الصورة',
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-expect-error
            error: uploadError.message,
          });
        }
      }

      const competitionData: CompetitionCreate = {
        title,
        description: description || '',
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error
        image_url,
        duration: parseInt(duration),
        grade_id: parseInt(grade_id),
        is_visible: is_visible === 'true' || is_visible === true,
        is_active: is_active === 'true' || is_active === true,
      };

      const competition = await CompetitionsService.create(competitionData, req.user!.id);

      res.status(201).json({
        success: true,
        message: 'تم إنشاء المسابقة بنجاح',
        data: competition,
      });
    } catch (error: any) {
      console.error('Error creating competition:', error);
      res.status(500).json({
        success: false,
        message: 'فشل في إنشاء المسابقة',
        error: error.message,
      });
    }
  },
);

// الحصول على جميع المسابقات (أدمن فقط)
router.get('/admin', authMiddleware(['admin']), async (req: Request, res: Response) => {
  try {
    const competitions = await CompetitionsService.getAll();

    res.json({
      success: true,
      data: competitions,
    });
  } catch (error: any) {
    console.error('Error fetching competitions:', error);
    res.status(500).json({
      success: false,
      message: 'فشل في جلب المسابقات',
      error: error.message,
    });
  }
});

// الحصول على المسابقات المرئية (للطلاب)
router.get('/', async (req: Request, res: Response) => {
  try {
    const { grade_id } = req.query;

    let competitions;
    if (grade_id) {
      competitions = await CompetitionsService.getByGrade(parseInt(grade_id as string));
    } else {
      competitions = await CompetitionsService.getVisible();
    }

    res.json({
      success: true,
      data: competitions,
    });
  } catch (error: any) {
    console.error('Error fetching visible competitions:', error);
    res.status(500).json({
      success: false,
      message: 'فشل في جلب المسابقات',
      error: error.message,
    });
  }
});

// ===== واجهات الطالب =====

// جلب مسابقات الطالب - API جديد تماماً
router.get('/student', authMiddleware(['student']), async (req: Request, res: Response) => {
  try {
    // التحقق من وجود المستخدم
    if (!req.user || !req.user.id) {
      return res.status(400).json({
        success: false,
        message: 'بيانات المستخدم غير صحيحة',
      });
    }

    // استخراج معرف الطالب
    const studentId = parseInt(req.user.id.toString());

    // التحقق من صحة المعرف
    if (isNaN(studentId) || studentId <= 0) {
      return res.status(400).json({
        success: false,
        message: 'معرف الطالب غير صحيح',
      });
    }

    // جلب المسابقات المتاحة للطالب
    const competitions = await CompetitionsService.getStudentCompetitionsSimple(studentId);

    res.json({
      success: true,
      data: competitions,
      message: 'تم جلب المسابقات بنجاح',
    });
  } catch (error: any) {
    console.error('Error getting student competitions:', error);
    res.status(500).json({
      success: false,
      message: 'فشل في جلب مسابقات الطالب',
      error: error.message,
    });
  }
});

// الحصول على مسابقة بواسطة المعرف
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const competition = await CompetitionsService.getById(id);

    if (!competition) {
      return res.status(404).json({
        success: false,
        message: 'المسابقة غير موجودة',
      });
    }

    res.json({
      success: true,
      data: competition,
    });
  } catch (error: any) {
    console.error('Error fetching competition:', error);
    res.status(500).json({
      success: false,
      message: 'فشل في جلب المسابقة',
      error: error.message,
    });
  }
});

// تحديث مسابقة (أدمن فقط)
router.put(
  '/:id',
  authMiddleware(['admin']),
  upload.single('image'),
  async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);

      // التحقق من وجود المسابقة
      const existingCompetition = await CompetitionsService.getById(id);
      if (!existingCompetition) {
        return res.status(404).json({
          success: false,
          message: 'المسابقة غير موجودة',
        });
      }

      const { title, description, duration, grade_id, is_visible, is_active } = req.body;

      let image_url = existingCompetition.image_url;

      // رفع صورة جديدة إذا تم توفيرها
      if (req.file) {
        try {
          const uploadResult = await uploadToBunnyStorage({
            path: req.file.path,
            ext: path.extname(req.file.originalname).substring(1),
            mime: req.file.mimetype,
            originalname: req.file.originalname,
          });
          image_url = uploadResult;
        } catch (uploadError) {
          return res.status(500).json({
            success: false,
            message: 'فشل في رفع الصورة',
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-expect-error
            error: uploadError.message,
          });
        }
      }

      const updateData: CompetitionUpdate = {};
      if (title) updateData.title = title;
      if (description !== undefined) updateData.description = description;
      if (duration) updateData.duration = parseInt(duration);
      if (grade_id) updateData.grade_id = parseInt(grade_id);
      if (is_visible !== undefined)
        updateData.is_visible = is_visible === 'true' || is_visible === true;
      if (is_active !== undefined)
        updateData.is_active = is_active === 'true' || is_active === true;
      if (image_url !== existingCompetition.image_url) updateData.image_url = image_url;

      const updatedCompetition = await CompetitionsService.update(id, updateData);

      res.json({
        success: true,
        message: 'تم تحديث المسابقة بنجاح',
        data: updatedCompetition,
      });
    } catch (error: any) {
      console.error('Error updating competition:', error);
      res.status(500).json({
        success: false,
        message: 'فشل في تحديث المسابقة',
        error: error.message,
      });
    }
  },
);

// حذف مسابقة (أدمن فقط)
router.delete('/:id', authMiddleware(['admin']), async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);

    // التحقق من وجود المسابقة
    const exists = await CompetitionsService.exists(id);
    if (!exists) {
      return res.status(404).json({
        success: false,
        message: 'المسابقة غير موجودة',
      });
    }

    await CompetitionsService.delete(id);

    res.json({
      success: true,
      message: 'تم حذف المسابقة بنجاح',
    });
  } catch (error: any) {
    console.error('Error deleting competition:', error);
    res.status(500).json({
      success: false,
      message: 'فشل في حذف المسابقة',
      error: error.message,
    });
  }
});

// تغيير حالة الرؤية (أدمن فقط)
router.patch(
  '/:id/toggle-visibility',
  authMiddleware(['admin']),
  async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);

      const updatedCompetition = await CompetitionsService.toggleVisibility(id);
      if (!updatedCompetition) {
        return res.status(404).json({
          success: false,
          message: 'المسابقة غير موجودة',
        });
      }

      res.json({
        success: true,
        message: `تم ${updatedCompetition.is_visible ? 'إظهار' : 'إخفاء'} المسابقة بنجاح`,
        data: updatedCompetition,
      });
    } catch (error: any) {
      console.error('Error toggling competition visibility:', error);
      res.status(500).json({
        success: false,
        message: 'فشل في تغيير حالة الرؤية',
        error: error.message,
      });
    }
  },
);

// تغيير حالة النشاط (أدمن فقط)
router.patch(
  '/:id/toggle-active',
  authMiddleware(['admin']),
  async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);

      const updatedCompetition = await CompetitionsService.toggleActive(id);
      if (!updatedCompetition) {
        return res.status(404).json({
          success: false,
          message: 'المسابقة غير موجودة',
        });
      }

      res.json({
        success: true,
        message: `تم ${updatedCompetition.is_active ? 'تفعيل' : 'إلغاء تفعيل'} المسابقة بنجاح`,
        data: updatedCompetition,
      });
    } catch (error: any) {
      console.error('Error toggling competition active status:', error);
      res.status(500).json({
        success: false,
        message: 'فشل في تغيير حالة النشاط',
        error: error.message,
      });
    }
  },
);

// اشتراك الطالب في مسابقة (طالب فقط)
router.post('/:id/join', authMiddleware(['student']), async (req: Request, res: Response) => {
  try {
    const competitionId = parseInt(req.params.id);
    const studentId = req.user!.id;

    if (isNaN(competitionId)) {
      return res.status(400).json({
        success: false,
        message: 'معرف المسابقة غير صحيح',
      });
    }

    const enrolled = await CompetitionsService.enrollStudent(competitionId, studentId);

    res.json({
      success: true,
      message: 'تم الاشتراك في المسابقة بنجاح',
      data: { joined: enrolled },
    });
  } catch (error: any) {
    console.error('Error enrolling student in competition:', error);

    if (error.message === 'المسابقة غير موجودة') {
      return res.status(404).json({
        success: false,
        message: error.message,
      });
    }

    res.status(500).json({
      success: false,
      message: 'فشل في الاشتراك في المسابقة',
      error: error.message,
    });
  }
});

// تفاصيل المسابقة للطالب المشترك (طالب فقط)
router.get(
  '/:id/student-details',
  authMiddleware(['student']),
  async (req: Request, res: Response) => {
    try {
      const competitionId = parseInt(req.params.id);
      const studentId = req.user!.id;

      if (isNaN(competitionId)) {
        return res.status(400).json({
          success: false,
          message: 'معرف المسابقة غير صحيح',
        });
      }

      const details = await CompetitionsService.getStudentCompetitionDetails(
        competitionId,
        studentId,
      );

      res.json({
        success: true,
        data: details,
      });
    } catch (error: any) {
      console.error('Error getting student competition details:', error);

      if (error.message === 'يجب الاشتراك في المسابقة لعرض التفاصيل') {
        return res.status(403).json({
          success: false,
          message: error.message,
        });
      }

      if (error.message === 'المسابقة غير موجودة') {
        return res.status(404).json({
          success: false,
          message: error.message,
        });
      }

      res.status(500).json({
        success: false,
        message: 'فشل في جلب تفاصيل المسابقة',
        error: error.message,
      });
    }
  },
);

// حل المسابقة وإرسال الإجابات
router.post('/:id/solve', authMiddleware(['student']), async (req: Request, res: Response) => {
  try {
    const competitionId = parseInt(req.params.id);
    const studentId = req.user!.id;

    if (isNaN(competitionId)) {
      return res.status(400).json({
        success: false,
        message: 'معرف المسابقة غير صحيح',
      });
    }

    const { answers } = req.body;

    if (!answers || !Array.isArray(answers) || answers.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'يجب إرسال إجابات صحيحة',
      });
    }

    const result = await CompetitionsService.solveCompetition(competitionId, studentId, answers);

    res.json({
      success: true,
      message: 'تم حل المسابقة بنجاح',
      data: result,
    });
  } catch (error: any) {
    console.error('Error solving competition:', error);

    if (error.message === 'يجب الاشتراك في المسابقة لحلها') {
      return res.status(403).json({
        success: false,
        message: error.message,
      });
    }

    if (error.message === 'لقد قمت بحل هذه المسابقة مسبقاً') {
      return res.status(409).json({
        success: false,
        message: error.message,
      });
    }

    if (error.message === 'المسابقة غير موجودة') {
      return res.status(404).json({
        success: false,
        message: error.message,
      });
    }

    res.status(500).json({
      success: false,
      message: 'فشل في حل المسابقة',
      error: error.message,
    });
  }
});

// عرض نتيجة الطالب في المسابقة
router.get(
  '/:id/student-result',
  authMiddleware(['student']),
  async (req: Request, res: Response) => {
    try {
      const competitionId = parseInt(req.params.id);
      const studentId = req.user!.id;

      if (isNaN(competitionId)) {
        return res.status(400).json({
          success: false,
          message: 'معرف المسابقة غير صحيح',
        });
      }

      const result = await CompetitionsService.getStudentResult(competitionId, studentId);

      res.json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      console.error('Error getting student result:', error);

      if (error.message === 'لم تقم بحل هذه المسابقة بعد') {
        return res.status(404).json({
          success: false,
          message: error.message,
        });
      }

      res.status(500).json({
        success: false,
        message: 'فشل في جلب نتيجة الطالب',
        error: error.message,
      });
    }
  },
);

// ترتيب الطلاب في مسابقة معينة (للطالب والأدمن)
router.get(
  '/:id/leaderboard',
  authMiddleware(['student', 'admin']),
  async (req: Request, res: Response) => {
    try {
      const competitionId = parseInt(req.params.id);
      const userId = req.user!.id;
      const userRole = req.user!.role;

      if (isNaN(competitionId)) {
        return res.status(400).json({
          success: false,
          message: 'معرف المسابقة غير صحيح',
        });
      }

      // إذا كان المستخدم طالب، التحقق من اشتراكه في المسابقة
      if (userRole === 'student') {
        const isEnrolled = await CompetitionsService.isStudentEnrolled(competitionId, userId);
        if (!isEnrolled) {
          return res.status(403).json({
            success: false,
            message: 'يجب الاشتراك في المسابقة لعرض الترتيب',
          });
        }
      }

      const limit = parseInt(req.query.limit as string) || 10;
      const offset = parseInt(req.query.offset as string) || 0;
      const gradeId = req.query.grade_id ? parseInt(req.query.grade_id as string) : null;

      // للأدمن، يمكنه تصفية النتائج حسب الصف
      if (userRole === 'admin') {
        const leaderboard = await CompetitionsService.getCompetitionLeaderboardForAdmin(
          competitionId,
          gradeId,
          limit,
          offset,
        );
        res.json({
          success: true,
          data: leaderboard,
        });
      } else {
        // للطالب، النتائج العادية
        const leaderboard = await CompetitionsService.getCompetitionLeaderboard(
          competitionId,
          limit,
          offset,
        );
        res.json({
          success: true,
          data: leaderboard,
        });
      }
    } catch (error: any) {
      console.error('Error getting competition leaderboard:', error);

      if (error.message === 'المسابقة غير موجودة') {
        return res.status(404).json({
          success: false,
          message: 'المسابقة غير موجودة',
        });
      }

      res.status(500).json({
        success: false,
        message: 'فشل في جلب ترتيب الطلاب',
        error: error.message,
      });
    }
  },
);

export { router };
