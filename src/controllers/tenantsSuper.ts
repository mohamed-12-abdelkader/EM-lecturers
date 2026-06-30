import { Request, Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/authentication';
import { requireDefaultTenantMiddleware } from '../middleware/tenantContext';
import { validate } from '../middleware/validateReq';
import { asyncWrapper, HttpError, uploadTeacherAvatar, uploadToCloudinary } from '../utils';
import { TenantService, type CreateTenantInput } from '../services/tenants';
import {
  buildPatchTenantFromMultipart,
  isMultipartRequest,
  PatchTenantBodySchema,
  uploadTenantFiles,
} from '../utils/tenantFormPayload';

export const router = Router();

router.use(requireDefaultTenantMiddleware());
router.use(authMiddleware(['admin']));

const OwnerSchema = z
  .object({
    name: z.string().min(1),
    email: z.string().email(),
    password: z.string().min(6),
    description: z.string().optional(),
    subject: z.string().optional(),
    grade_ids: z.array(z.number().int().positive()).optional(),
  })
  .optional();

function parseGradeIdsInput(v: unknown): number[] | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  if (Array.isArray(v)) {
    const arr = v.map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0);
    return arr.length ? arr : undefined;
  }
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return undefined;
    if (s.startsWith('[')) {
      try {
        const parsed = JSON.parse(s) as unknown[];
        const arr = parsed.map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0);
        return arr.length ? arr : undefined;
      } catch {
        return undefined;
      }
    }
    const arr = s
      .split(',')
      .map((x) => Number(x.trim()))
      .filter((n) => Number.isInteger(n) && n > 0);
    return arr.length ? arr : undefined;
  }
  return undefined;
}

/** Flatten common API shapes (wrapped payload + camelCase aliases) before Zod. */
function normalizeCreateTenantJsonBody(input: unknown): unknown {
  if (input == null || typeof input !== 'object' || Array.isArray(input)) return input;
  let o: Record<string, unknown> = { ...(input as Record<string, unknown>) };
  const wrapped = o.tenant ?? o.data ?? o.payload;
  if (wrapped && typeof wrapped === 'object' && !Array.isArray(wrapped)) {
    o = { ...(wrapped as Record<string, unknown>), ...o };
  }
  if (o.subdomain == null && o.subDomain != null) o.subdomain = o.subDomain;
  if (o.display_name == null && o.displayName != null) o.display_name = o.displayName;
  return o;
}

const CreateTenantBody = z.preprocess(
  normalizeCreateTenantJsonBody,
  z.object({
    subdomain: z
      .string()
      .min(2)
      .max(63)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    display_name: z.string().min(1),
    specialty: z.string().optional().nullable(),
    bio: z.string().optional().nullable(),
    avatar_url: z.string().optional().nullable(),
    is_active: z.boolean().optional(),
    seo_title: z.string().optional().nullable(),
    seo_meta_description: z.string().optional().nullable(),
    favicon_url: z.string().optional().nullable(),
    og_image_url: z.string().optional().nullable(),
    settings: z.record(z.string(), z.any()).optional(),
    landing: z.record(z.string(), z.any()).optional(),
    owner: OwnerSchema,
  }),
);

const subdomainRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function isMultipartCreate(req: Request): boolean {
  const ct = (req.headers['content-type'] || '').toLowerCase();
  if (ct.includes('multipart/form-data')) return true;
  if (typeof req.is === 'function' && req.is('multipart/form-data')) return true;
  return false;
}

function formStr(v: unknown): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  return s === '' ? undefined : s;
}

async function buildCreateTenantFromMultipart(
  req: Request,
): Promise<{ data: CreateTenantInput } | { error: string }> {
  const b = req.body as Record<string, unknown>;
  const subdomain =
    formStr(b.subdomain)?.toLowerCase() ?? formStr(b.subDomain)?.toLowerCase();
  const display_name = formStr(b.display_name) ?? formStr(b.displayName);
  if (!subdomain) return { error: 'subdomain is required' };
  if (!display_name) return { error: 'display_name is required' };
  if (subdomain.length < 2 || subdomain.length > 63 || !subdomainRegex.test(subdomain)) {
    return { error: 'Invalid subdomain' };
  }

  const files = req.files as { [field: string]: Express.Multer.File[] } | undefined;

  const uploadField = async (field: string): Promise<string | null> => {
    const f = files?.[field]?.[0];
    if (!f) return null;
    const r = await uploadToCloudinary(f.path);
    return r.secure_url;
  };

  const avatar_url =
    (await uploadField('avatar')) ?? (formStr(b.avatar_url) as string | null) ?? null;
  const favicon_url =
    (await uploadField('favicon')) ?? (formStr(b.favicon_url) as string | null) ?? null;
  const og_image_url =
    (await uploadField('og_image')) ?? (formStr(b.og_image_url) as string | null) ?? null;

  let landing: Record<string, unknown> | undefined;
  const landingRaw = formStr(b.landing);
  if (landingRaw) {
    try {
      const parsed = JSON.parse(landingRaw) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        landing = parsed as Record<string, unknown>;
      } else {
        return { error: 'landing must be a JSON object' };
      }
    } catch {
      return { error: 'Invalid JSON in landing' };
    }
  }

  const heroImageUrl = await uploadField('hero_image');
  if (heroImageUrl) {
    landing = landing ?? {};
    const hero = (landing.hero && typeof landing.hero === 'object' && !Array.isArray(landing.hero)
      ? (landing.hero as Record<string, unknown>)
      : {}) as Record<string, unknown>;
    landing.hero = { ...hero, image_url: heroImageUrl };
  }

  let settings: Record<string, unknown> | undefined;
  const settingsRaw = formStr(b.settings);
  if (settingsRaw) {
    try {
      const parsed = JSON.parse(settingsRaw) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        settings = parsed as Record<string, unknown>;
      } else {
        return { error: 'settings must be a JSON object' };
      }
    } catch {
      return { error: 'Invalid JSON in settings' };
    }
  }

  let owner: CreateTenantInput['owner'];
  const ownerRaw = formStr(b.owner);
  if (ownerRaw) {
    try {
      const parsed = JSON.parse(ownerRaw) as unknown;
      const o = z
        .object({
          name: z.string().min(1),
          email: z.string().email(),
          password: z.string().min(6),
          description: z.string().optional(),
          subject: z.string().optional(),
          grade_ids: z.array(z.number().int().positive()).optional(),
        })
        .safeParse(parsed);
      if (!o.success) return { error: 'Invalid owner JSON' };
      owner = o.data;
    } catch {
      return { error: 'Invalid JSON in owner' };
    }
  } else {
    const on = formStr(b.owner_name);
    const oe = formStr(b.owner_email);
    const op = formStr(b.owner_password);
    if (on && oe && op) {
      owner = {
        name: on,
        email: oe,
        password: op,
        description: formStr(b.owner_description),
        subject: formStr(b.owner_subject),
        grade_ids: parseGradeIdsInput(b.owner_grade_ids),
      };
    }
  }

  const ia = b.is_active;
  let is_active: boolean | undefined;
  if (ia !== undefined && ia !== null && String(ia).trim() !== '') {
    is_active = ia === true || ia === 'true' || ia === '1';
  }

  const data: CreateTenantInput = {
    subdomain,
    display_name,
    specialty: formStr(b.specialty) ?? null,
    bio: formStr(b.bio) ?? null,
    avatar_url,
    is_active,
    seo_title: formStr(b.seo_title) ?? null,
    seo_meta_description: formStr(b.seo_meta_description) ?? null,
    favicon_url,
    og_image_url,
    settings,
    landing,
    owner,
  };

  return { data };
}

const uploadTenantCreateFiles = uploadTeacherAvatar.fields([
  { name: 'avatar', maxCount: 1 },
  { name: 'favicon', maxCount: 1 },
  { name: 'og_image', maxCount: 1 },
  { name: 'hero_image', maxCount: 1 },
]);

router.get(
  '/',
  asyncWrapper(async (req, res) => {
    const limit = Number(req.query.limit ?? 200);
    const offset = Number(req.query.offset ?? 0);
    const detailed = req.query.detailed === 'true' || req.query.detailed === '1';

    if (detailed) {
      const { tenants, total } = await TenantService.listTeacherTenantsForAdmin({
        limit: Number.isFinite(limit) ? limit : 200,
        offset: Number.isFinite(offset) ? offset : 0,
        includeDefault: req.query.include_default === 'true',
      });
      return res.json({ success: true, tenants, total });
    }

    const rows = await TenantService.listAll(
      Number.isFinite(limit) ? limit : 200,
      Number.isFinite(offset) ? offset : 0,
    );
    res.json({ success: true, tenants: rows });
  }),
);

router.post(
  '/',
  (req, res, next) => {
    if (isMultipartCreate(req)) {
      return uploadTenantCreateFiles(req, res, next);
    }
    next();
  },
  (req, res, next) => {
    if (!isMultipartCreate(req)) {
      return validate(CreateTenantBody)(req, res, next);
    }
    next();
  },
  asyncWrapper(async (req, res) => {
    try {
      let payload: CreateTenantInput;
      if (isMultipartCreate(req)) {
        const built = await buildCreateTenantFromMultipart(req);
        if ('error' in built) {
          return res.status(400).json({ success: false, message: built.error });
        }
        payload = built.data;
      } else {
        payload = req.body as CreateTenantInput;
      }
      const row = await TenantService.createTenantTransaction(payload);
      res.status(201).json({ success: true, tenant: row });
    } catch (e: unknown) {
      const err = e as { code?: string };
      if (err.code === '23505') {
        return res.status(409).json({ success: false, message: 'Subdomain already taken' });
      }
      throw e;
    }
  }),
);

router.patch(
  '/:id',
  (req, res, next) => {
    if (isMultipartRequest(req)) {
      return uploadTenantFiles(req, res, next);
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
    const id = Number(req.params.id);
    if (!id || Number.isNaN(id)) return res.status(400).json({ message: 'Invalid id' });

    let payload;
    if (isMultipartRequest(req)) {
      const built = await buildPatchTenantFromMultipart(req);
      if ('error' in built) {
        return res.status(400).json({ success: false, message: built.error });
      }
      payload = built.data;
    } else {
      payload = req.body;
    }

    try {
      const tenant = await TenantService.patchTenant(id, payload);
      res.json({ success: true, tenant });
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string };
      if (err.code === '23505') {
        return res.status(409).json({ success: false, message: 'Subdomain already taken' });
      }
      if (err.message === 'Tenant not found') {
        throw new HttpError(404, 'Tenant not found');
      }
      throw e;
    }
  }),
);
