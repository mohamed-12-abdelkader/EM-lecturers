import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/authentication';
import { asyncWrapper, HttpError } from '../utils';
import { GradesAdminService, type GradeStage, type GradeStatus } from '../services/gradesAdmin';

export const router = Router();

const STAGE = z.enum(['prep', 'secondary', 'university', 'general']);
const STATUS = z.enum(['active', 'inactive']);

const CreateGradeSchema = z.object({
  name: z.string().min(2).max(200),
  stage: STAGE,
  slug: z.string().min(1).max(100).optional(),
  level: z.number().int().min(0).max(20).nullable().optional(),
  status: STATUS.optional(),
});

const UpdateGradeSchema = z.object({
  name: z.string().min(2).max(200).optional(),
  stage: STAGE.optional(),
  slug: z.string().min(1).max(100).optional(),
  level: z.number().int().min(0).max(20).nullable().optional(),
  status: STATUS.optional(),
});

const StatusSchema = z.object({
  status: STATUS,
});

router.use(authMiddleware(['admin']));

/** GET /api/admin/grades — قائمة الصفوف */
router.get(
  '/',
  asyncWrapper(async (req, res) => {
    const statusRaw = typeof req.query.status === 'string' ? req.query.status : undefined;
    const stageRaw = typeof req.query.stage === 'string' ? req.query.stage : undefined;
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;

    const status =
      statusRaw === 'all' || statusRaw === 'active' || statusRaw === 'inactive'
        ? (statusRaw as GradeStatus | 'all')
        : 'all';
    const stage =
      stageRaw === 'prep' ||
      stageRaw === 'secondary' ||
      stageRaw === 'university' ||
      stageRaw === 'general'
        ? (stageRaw as GradeStage)
        : undefined;

    const grades = await GradesAdminService.list({ status, stage, search });
    res.json({ success: true, data: { grades, total: grades.length } });
  }),
);

/** GET /api/admin/grades/:id */
router.get(
  '/:id',
  asyncWrapper(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'معرّف الصف غير صالح');
    const grade = await GradesAdminService.getById(id);
    const usage = await GradesAdminService.getUsage(id);
    res.json({ success: true, data: { grade, usage } });
  }),
);

/** POST /api/admin/grades — إضافة صف جديد */
router.post(
  '/',
  asyncWrapper(async (req, res) => {
    const parsed = CreateGradeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: parsed.error.errors,
      });
    }
    const grade = await GradesAdminService.create(parsed.data);
    res.status(201).json({
      success: true,
      message: 'تم إضافة الصف الدراسي بنجاح',
      data: { grade },
    });
  }),
);

/** PATCH /api/admin/grades/:id — تعديل صف */
router.patch(
  '/:id',
  asyncWrapper(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'معرّف الصف غير صالح');

    const parsed = UpdateGradeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: parsed.error.errors,
      });
    }
    if (Object.keys(parsed.data).length === 0) {
      return res.status(400).json({ success: false, message: 'أرسل حقلًا واحدًا على الأقل للتعديل' });
    }

    const grade = await GradesAdminService.update(id, parsed.data);
    res.json({
      success: true,
      message: 'تم تحديث الصف الدراسي بنجاح',
      data: { grade },
    });
  }),
);

/** PUT /api/admin/grades/:id — تعديل كامل (نفس PATCH) */
router.put(
  '/:id',
  asyncWrapper(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'معرّف الصف غير صالح');

    const parsed = UpdateGradeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: parsed.error.errors,
      });
    }

    const grade = await GradesAdminService.update(id, parsed.data);
    res.json({
      success: true,
      message: 'تم تحديث الصف الدراسي بنجاح',
      data: { grade },
    });
  }),
);

/** PATCH /api/admin/grades/:id/status — تفعيل / تعطيل */
router.patch(
  '/:id/status',
  asyncWrapper(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'معرّف الصف غير صالح');

    const parsed = StatusSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: 'status يجب أن يكون active أو inactive',
        errors: parsed.error.errors,
      });
    }

    const grade = await GradesAdminService.setStatus(id, parsed.data.status);
    res.json({
      success: true,
      message: parsed.data.status === 'active' ? 'تم تفعيل الصف' : 'تم تعطيل الصف',
      data: { grade },
    });
  }),
);

/** DELETE /api/admin/grades/:id — حذف نهائي (فقط إن لم يكن مستخدمًا) */
router.delete(
  '/:id',
  asyncWrapper(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'معرّف الصف غير صالح');

    const result = await GradesAdminService.remove(id);
    res.json({
      success: true,
      message: 'تم حذف الصف الدراسي بنجاح',
      data: result,
    });
  }),
);
