import { Router, Request } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { authMiddleware } from '../middleware/authentication';
import { asyncWrapper, HttpError } from '../utils';
import {
  TeacherManagedStudentsService,
  type ManagedStudentAccountStatus,
} from '../services/teacherManagedStudents';

export const router = Router();

const uploadCsv = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok =
      file.mimetype === 'text/csv' ||
      file.mimetype === 'application/vnd.ms-excel' ||
      file.originalname.toLowerCase().endsWith('.csv');
    if (ok) cb(null, true);
    else cb(new Error('يُقبل ملف CSV فقط'));
  },
});

const RegistrationSettingsSchema = z.object({
  registration_mode: z.enum(['self_registration', 'teacher_registration']).optional(),
  default_password_from_phone: z.boolean().optional(),
});

const CreateStudentSchema = z.object({
  name: z.string().min(2),
  grade_id: z.number().int().positive(),
  phone: z.string().min(8).max(20).optional().nullable(),
  parent_phone: z.string().min(8).max(20).optional().nullable(),
  group_id: z.number().int().positive().optional().nullable(),
  password: z.string().min(6).optional().nullable(),
  use_phone_as_password: z.boolean().optional(),
});

const UpdateStudentSchema = z.object({
  name: z.string().min(2).optional(),
  grade_id: z.number().int().positive().optional(),
  phone: z.string().min(8).max(20).optional().nullable(),
  parent_phone: z.string().min(8).max(20).optional().nullable(),
  group_id: z.number().int().positive().optional().nullable(),
  account_status: z.enum(['active', 'inactive', 'suspended']).optional(),
});

const ResetPasswordSchema = z.object({
  new_password: z.string().min(6).optional(),
  use_phone_as_password: z.boolean().optional(),
});

const StatusSchema = z.object({
  account_status: z.enum(['active', 'inactive', 'suspended']),
});

function resolveTenantId(req: Request): number {
  const tenantId = req.tenant?.id;
  if (!tenantId) throw new HttpError(400, 'تعذر تحديد المنصة');
  return tenantId;
}

router.use(authMiddleware(['teacher']));

/** إعدادات طريقة تسجيل الطلاب */
router.get(
  '/registration-settings',
  asyncWrapper(async (req, res) => {
    const settings = await TeacherManagedStudentsService.getRegistrationSettings(
      resolveTenantId(req),
    );
    res.json({ success: true, data: settings });
  }),
);

router.put(
  '/registration-settings',
  asyncWrapper(async (req, res) => {
    const parsed = RegistrationSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, errors: parsed.error.errors });
    }
    const settings = await TeacherManagedStudentsService.setRegistrationSettings(
      resolveTenantId(req),
      parsed.data,
    );
    res.json({ success: true, data: settings });
  }),
);

/** قائمة الطلاب المُدارين بواسطة المدرس */
router.get(
  '/',
  asyncWrapper(async (req, res) => {
    const page = req.query.page ? Number(req.query.page) : 1;
    const limit = req.query.limit ? Number(req.query.limit) : 20;
    const sort = req.query.sort as 'name' | 'created_at' | 'student_code' | undefined;
    const order = req.query.order === 'asc' ? 'asc' : 'desc';

    const data = await TeacherManagedStudentsService.listStudents(
      req.user!.id,
      resolveTenantId(req),
      {
        search: typeof req.query.search === 'string' ? req.query.search : undefined,
        grade_id: req.query.grade_id ? Number(req.query.grade_id) : undefined,
        group_id: req.query.group_id ? Number(req.query.group_id) : undefined,
        account_status: req.query.account_status as ManagedStudentAccountStatus | undefined,
        page,
        limit,
        sort,
        order,
      },
    );

    res.json({ success: true, data });
  }),
);

/** إضافة طالب جديد */
router.post(
  '/',
  asyncWrapper(async (req, res) => {
    const parsed = CreateStudentSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, errors: parsed.error.errors });
    }

    const result = await TeacherManagedStudentsService.createStudent(
      req.user!.id,
      resolveTenantId(req),
      parsed.data,
    );

    res.status(201).json({ success: true, data: result });
  }),
);

/** استيراد طلاب من CSV */
router.post(
  '/import',
  uploadCsv.single('file'),
  asyncWrapper(async (req, res) => {
    let csvText = '';
    if (req.file?.buffer) {
      csvText = req.file.buffer.toString('utf-8');
    } else if (typeof req.body?.csv === 'string') {
      csvText = req.body.csv;
    } else {
      return res.status(400).json({
        success: false,
        message: 'أرسل ملف CSV في الحقل file أو نص CSV في الحقل csv',
      });
    }

    const report = await TeacherManagedStudentsService.importStudents(
      req.user!.id,
      resolveTenantId(req),
      csvText,
    );

    res.json({ success: true, data: report });
  }),
);

/** عرض بيانات طالب */
router.get(
  '/:studentId',
  asyncWrapper(async (req, res) => {
    const studentId = Number(req.params.studentId);
    if (!Number.isInteger(studentId) || studentId <= 0) {
      return res.status(400).json({ success: false, message: 'معرف الطالب غير صالح' });
    }

    const student = await TeacherManagedStudentsService.getStudentById(
      req.user!.id,
      resolveTenantId(req),
      studentId,
    );
    res.json({ success: true, data: student });
  }),
);

/** تعديل بيانات طالب */
router.put(
  '/:studentId',
  asyncWrapper(async (req, res) => {
    const studentId = Number(req.params.studentId);
    const parsed = UpdateStudentSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, errors: parsed.error.errors });
    }

    const student = await TeacherManagedStudentsService.updateStudent(
      req.user!.id,
      resolveTenantId(req),
      studentId,
      parsed.data,
    );
    res.json({ success: true, data: student });
  }),
);

/** نقل الطالب لمجموعة أخرى */
router.patch(
  '/:studentId/group',
  asyncWrapper(async (req, res) => {
    const studentId = Number(req.params.studentId);
    const groupId = req.body?.group_id != null ? Number(req.body.group_id) : null;
    if (groupId != null && (!Number.isInteger(groupId) || groupId <= 0)) {
      return res.status(400).json({ success: false, message: 'group_id غير صالح' });
    }

    const student = await TeacherManagedStudentsService.updateStudent(
      req.user!.id,
      resolveTenantId(req),
      studentId,
      { group_id: groupId },
    );
    res.json({ success: true, data: student });
  }),
);

/** إعادة تعيين كلمة المرور */
router.post(
  '/:studentId/reset-password',
  asyncWrapper(async (req, res) => {
    const studentId = Number(req.params.studentId);
    const parsed = ResetPasswordSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ success: false, errors: parsed.error.errors });
    }

    const result = await TeacherManagedStudentsService.resetPassword(
      req.user!.id,
      resolveTenantId(req),
      studentId,
      parsed.data,
    );
    res.json({ success: true, data: result });
  }),
);

/** تفعيل / إيقاف الحساب */
router.patch(
  '/:studentId/status',
  asyncWrapper(async (req, res) => {
    const studentId = Number(req.params.studentId);
    const parsed = StatusSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, errors: parsed.error.errors });
    }

    const student = await TeacherManagedStudentsService.setAccountStatus(
      req.user!.id,
      resolveTenantId(req),
      studentId,
      parsed.data.account_status,
    );
    res.json({ success: true, data: student });
  }),
);

/** حذف طالب */
router.delete(
  '/:studentId',
  asyncWrapper(async (req, res) => {
    const studentId = Number(req.params.studentId);
    const result = await TeacherManagedStudentsService.deleteStudent(
      req.user!.id,
      resolveTenantId(req),
      studentId,
    );
    res.json({ success: true, data: result });
  }),
);
