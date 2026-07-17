import { Router } from 'express';
import { authMiddleware } from '../middleware/authentication';
import { requireDefaultTenantMiddleware } from '../middleware/tenantContext';
import { validate } from '../middleware/validateReq';
import { asyncWrapper, HttpError } from '../utils';
import { TenantService } from '../services/tenants';
import { AdminPlatformStudentsService } from '../services/adminPlatformStudents';
import { TenantSeoSettingsService } from '../services/seo/tenantSeoSettings';
import { TenantSitemapService } from '../services/seo/sitemap';
import { seoCacheDeletePrefix } from '../services/seo/cache';
import { z } from 'zod';
import {
  buildPatchTenantFromMultipart,
  isMultipartRequest,
  PatchTenantBodySchema,
  uploadTenantFilesSafe,
} from '../utils/tenantFormPayload';

export const router = Router();

router.use(requireDefaultTenantMiddleware());
router.use(authMiddleware(['admin']));

function parseBooleanQuery(value: unknown): boolean | null {
  if (value === undefined || value === null || value === '') return null;
  if (value === true || value === 'true' || value === '1') return true;
  if (value === false || value === 'false' || value === '0') return false;
  return null;
}

function parseTenantId(raw: string): number {
  const id = Number(raw);
  if (!id || Number.isNaN(id)) throw new HttpError(400, 'معرف المنصة غير صحيح');
  return id;
}

router.get(
  '/',
  asyncWrapper(async (req, res) => {
    const limit = Number(req.query.limit ?? 50);
    const offset = Number(req.query.offset ?? 0);
    const includeDeleted = req.query.include_deleted === 'true' || req.query.include_deleted === '1';
    const isActive = parseBooleanQuery(req.query.is_active);
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;

    const { tenants, total } = await TenantService.listTeacherTenantsForAdmin({
      limit: Number.isFinite(limit) ? limit : 50,
      offset: Number.isFinite(offset) ? offset : 0,
      includeDeleted,
      isActive,
      search,
    });

    res.json({
      success: true,
      data: {
        tenants,
        total,
        limit: Math.min(Math.max(Number.isFinite(limit) ? limit : 50, 1), 200),
        offset: Math.max(Number.isFinite(offset) ? offset : 0, 0),
      },
    });
  }),
);

router.get(
  '/:id',
  asyncWrapper(async (req, res) => {
    const tenant = await TenantService.getTenantForAdmin(parseTenantId(req.params.id));
    if (!tenant) throw new HttpError(404, 'المنصة غير موجودة');
    res.json({ success: true, data: tenant });
  }),
);

/**
 * طلاب منصة معينة (مستر / tenant)
 * GET /api/admin/tenants/:id/students
 */
router.get(
  '/:id/students',
  asyncWrapper(async (req, res) => {
    const tenantId = parseTenantId(req.params.id);
    const limit = Number(req.query.limit ?? 50);
    const offset = Number(req.query.offset ?? 0);
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    const accountStatus =
      typeof req.query.account_status === 'string' ? req.query.account_status : undefined;
    const isSubscribed = parseBooleanQuery(req.query.is_subscribed);

    const result = await AdminPlatformStudentsService.listStudentsByTenant(tenantId, {
      limit: Number.isFinite(limit) ? limit : 50,
      offset: Number.isFinite(offset) ? offset : 0,
      search,
      account_status: accountStatus,
      is_subscribed: isSubscribed,
    });

    res.json({
      success: true,
      data: result,
    });
  }),
);

/**
 * تغيير كلمة سر طالب على منصة معينة
 * PATCH /api/admin/tenants/:id/students/:studentId/password
 */
router.patch(
  '/:id/students/:studentId/password',
  asyncWrapper(async (req, res) => {
    const tenantId = parseTenantId(req.params.id);
    const studentId = Number(req.params.studentId);
    if (!studentId || Number.isNaN(studentId)) {
      throw new HttpError(400, 'معرف الطالب غير صحيح');
    }

    const body = z
      .object({
        new_password: z.string().min(6).optional(),
        password: z.string().min(6).optional(),
        must_change_password: z.boolean().optional(),
      })
      .refine((d) => Boolean(d.new_password || d.password), {
        message: 'new_password مطلوب (6 أحرف على الأقل)',
        path: ['new_password'],
      })
      .safeParse(req.body);

    if (!body.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: body.error.errors,
      });
    }

    const newPassword = (body.data.new_password || body.data.password)!.trim();

    const data = await AdminPlatformStudentsService.changeStudentPassword(
      tenantId,
      studentId,
      {
        new_password: newPassword,
        must_change_password: body.data.must_change_password,
      },
    );

    res.json({
      success: true,
      message: 'تم تغيير كلمة سر الطالب بنجاح',
      data,
    });
  }),
);

router.patch(
  '/:id',
  (req, res, next) => {
    if (isMultipartRequest(req)) {
      return uploadTenantFilesSafe(req, res, next);
    }
    next();
  },
  (req, res, next) => {
    if (!isMultipartRequest(req)) {
      return validate(PatchTenantBodySchema)(req, res, next);
    }
    next();
  },
  asyncWrapper(async (req, res) => {
    const id = parseTenantId(req.params.id);

    let payload;
    if (isMultipartRequest(req)) {
      const built = await buildPatchTenantFromMultipart(req);
      if ('error' in built) {
        return res.status(400).json({ success: false, message: built.error });
      }
      payload = built.data;
    } else {
      payload = PatchTenantBodySchema.parse(req.body);
    }

    try {
      const tenant = await TenantService.patchTenant(id, payload);
      res.json({
        success: true,
        message: 'تم تحديث بيانات المنصة',
        data: tenant,
      });
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string };
      if (err.code === '23505') {
        return res.status(409).json({ success: false, message: 'Subdomain already taken' });
      }
      if (err.message === 'Tenant not found') {
        throw new HttpError(404, 'المنصة غير موجودة');
      }
      throw e;
    }
  }),
);

const PatchTenantSeoSchema = z.object({
  seo_title: z.string().max(200).optional(),
  seo_meta_description: z.string().max(500).optional(),
  seo_keywords: z.array(z.string()).optional(),
  canonical_url: z.string().url().optional(),
  og_title: z.string().max(200).optional(),
  og_description: z.string().max(500).optional(),
  og_image: z.string().optional(),
  twitter_title: z.string().max(200).optional(),
  twitter_description: z.string().max(300).optional(),
  twitter_image: z.string().optional(),
  favicon_url: z.string().optional(),
  robots_index: z.boolean().optional(),
  robots_follow: z.boolean().optional(),
  auto_generate: z.boolean().optional(),
});

router.patch(
  '/:id/seo',
  asyncWrapper(async (req, res) => {
    const id = parseTenantId(req.params.id);
    const parsed = PatchTenantSeoSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, errors: parsed.error.errors });
    }

    const patch = { ...parsed.data };
    if (patch.auto_generate === undefined && Object.keys(patch).length > 0) {
      patch.auto_generate = false;
    }

    const seo = await TenantSeoSettingsService.patchSettings(id, patch);
    if (!seo) throw new HttpError(404, 'المنصة غير موجودة');

    TenantSitemapService.invalidate(id);
    seoCacheDeletePrefix('teacher-page:');
    seoCacheDeletePrefix('metadata:');

    res.json({
      success: true,
      message: 'تم تحديث إعدادات SEO',
      data: seo,
    });
  }),
);

router.delete(
  '/:id',
  asyncWrapper(async (req, res) => {
    const id = parseTenantId(req.params.id);
    const confirmSubdomain =
      typeof req.body?.confirm_subdomain === 'string'
        ? req.body.confirm_subdomain
        : typeof req.query.confirm_subdomain === 'string'
          ? req.query.confirm_subdomain
          : undefined;

    const result = await TenantService.deleteTenantForAdmin(id, { confirmSubdomain });

    res.json({
      success: true,
      message: 'تم حذف المنصة بنجاح',
      data: result,
    });
  }),
);
