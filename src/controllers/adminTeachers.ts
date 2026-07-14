import { Request, Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/authentication';
import { validate } from '../middleware/validateReq';
import {
  asyncWrapper,
  deleteCloudinaryAssetByUrl,
  HttpError,
  uploadTeacherAvatar,
  uploadToCloudinary,
} from '../utils';
import {
  AdminTeachersService,
  type TeacherAccountStatus,
  type TeacherSubscriptionPackage,
} from '../services/adminTeachers';

export const router = Router();

function adminTenantScope(req: Request): number | undefined {
  const t = req.tenant;
  if (!t) return undefined;
  return t.subdomain === 'default' ? undefined : t.id;
}

const TeacherStatusSchema = z.object({
  status: z.enum(['active', 'inactive', 'suspended']),
});

const TeacherPackageSchema = z.object({
  subscription_package: z.enum(['bronze', 'silver', 'gold', 'diamond']),
});

const UpdateTeacherSchema = z.object({
  name: z.string().min(2).optional(),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().regex(/^\+?[0-9]{8,15}$/).optional().or(z.literal('')),
  password: z.string().min(6).optional(),
  subject: z.string().optional().or(z.literal('')),
  description: z.string().optional().or(z.literal('')),
  account_status: z.enum(['active', 'inactive', 'suspended']).optional(),
  subscription_package: z.enum(['bronze', 'silver', 'gold', 'diamond']).optional(),
  grade_ids: z.array(z.coerce.number().int().positive()).optional(),
  facebook_url: z.string().url().optional().or(z.literal('')).nullable(),
  instagram_url: z.string().url().optional().or(z.literal('')).nullable(),
  youtube_url: z.string().url().optional().or(z.literal('')).nullable(),
  tiktok_url: z.string().url().optional().or(z.literal('')).nullable(),
  whatsapp_number: z.string().optional().or(z.literal('')).nullable(),
});

function parseGradeIds(raw: unknown): number[] | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (Array.isArray(raw)) return raw.map((v) => Number(v)).filter((v) => Number.isFinite(v));
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (!s) return undefined;
    if (s.startsWith('[')) {
      try {
        const arr = JSON.parse(s) as unknown[];
        return arr.map((v) => Number(v)).filter((v) => Number.isFinite(v));
      } catch {
        throw new HttpError(400, 'Invalid grade_ids format');
      }
    }
    return s
      .split(',')
      .map((v) => Number(v.trim()))
      .filter((v) => Number.isFinite(v));
  }
  return undefined;
}

router.get(
  '/:id',
  authMiddleware(['admin']),
  asyncWrapper(async (req, res) => {
    const tenantId = adminTenantScope(req);
    const teacherId = Number(req.params.id);
    if (!teacherId || Number.isNaN(teacherId)) throw new HttpError(400, 'Invalid teacher id');
    const teacher = await AdminTeachersService.getTeacherWithGrades(teacherId, tenantId);
    if (!teacher) throw new HttpError(404, 'Teacher not found');
    res.json({ success: true, data: teacher });
  }),
);

router.put(
  '/:id',
  authMiddleware(['admin']),
  uploadTeacherAvatar.single('avatar'),
  asyncWrapper(async (req, res) => {
    const tenantId = adminTenantScope(req);
    const teacherId = Number(req.params.id);
    if (!teacherId || Number.isNaN(teacherId)) throw new HttpError(400, 'Invalid teacher id');

    const parsed = UpdateTeacherSchema.safeParse({
      ...req.body,
      grade_ids: parseGradeIds(req.body.grade_ids),
    });
    if (!parsed.success) return res.status(400).json({ message: 'Validation failed', errors: parsed.error });
    const body = parsed.data;

    let newAvatarUrl: string | undefined;
    if (req.file) {
      const uploaded = await uploadToCloudinary(req.file.path);
      newAvatarUrl = uploaded.secure_url;
    }

    const payload = {
      name: body.name,
      email: body.email === '' ? null : body.email,
      phone: body.phone === '' ? null : body.phone,
      password: body.password,
      subject: body.subject === '' ? null : body.subject,
      description: body.description === '' ? null : body.description,
      avatar: newAvatarUrl,
      account_status: body.account_status as TeacherAccountStatus | undefined,
      subscription_package: body.subscription_package as TeacherSubscriptionPackage | undefined,
      grade_ids: body.grade_ids,
      facebook_url: body.facebook_url === '' ? null : body.facebook_url,
      instagram_url: body.instagram_url === '' ? null : body.instagram_url,
      youtube_url: body.youtube_url === '' ? null : body.youtube_url,
      tiktok_url: body.tiktok_url === '' ? null : body.tiktok_url,
      whatsapp_number: body.whatsapp_number === '' ? null : body.whatsapp_number,
    };

    const { previousAvatar } = await AdminTeachersService.updateTeacher(teacherId, tenantId, payload);

    if (newAvatarUrl && previousAvatar && previousAvatar !== newAvatarUrl) {
      await deleteCloudinaryAssetByUrl(previousAvatar);
    }

    const teacher = await AdminTeachersService.getTeacherWithGrades(teacherId, tenantId);
    res.json({ success: true, message: 'Teacher updated successfully', data: teacher });
  }),
);

router.patch(
  '/:id/status',
  authMiddleware(['admin']),
  validate(TeacherStatusSchema),
  asyncWrapper(async (req, res) => {
    const tenantId = adminTenantScope(req);
    const teacherId = Number(req.params.id);
    if (!teacherId || Number.isNaN(teacherId)) throw new HttpError(400, 'Invalid teacher id');
    await AdminTeachersService.setTeacherStatus(teacherId, tenantId, req.body.status);
    res.json({ success: true, message: 'Teacher status updated' });
  }),
);

router.patch(
  '/:id/package',
  authMiddleware(['admin']),
  validate(TeacherPackageSchema),
  asyncWrapper(async (req, res) => {
    const tenantId = adminTenantScope(req);
    const teacherId = Number(req.params.id);
    if (!teacherId || Number.isNaN(teacherId)) throw new HttpError(400, 'Invalid teacher id');
    await AdminTeachersService.setTeacherPackage(
      teacherId,
      tenantId,
      req.body.subscription_package as TeacherSubscriptionPackage,
    );
    res.json({ success: true, message: 'Teacher package updated' });
  }),
);

router.delete(
  '/:id',
  authMiddleware(['admin']),
  asyncWrapper(async (req, res) => {
    const tenantId = adminTenantScope(req);
    const teacherId = Number(req.params.id);
    if (!teacherId || Number.isNaN(teacherId)) throw new HttpError(400, 'Invalid teacher id');

    const result = await AdminTeachersService.deleteTeacher(teacherId, tenantId);
    await deleteCloudinaryAssetByUrl(result.avatar);

    res.json({ success: true, message: 'Teacher deleted successfully' });
  }),
);
