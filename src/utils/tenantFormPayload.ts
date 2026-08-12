import type { NextFunction, Request, Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { z } from 'zod';
import { uploadToCloudinary } from '../utils';
import type { CreateTenantInput, PatchTenantInput } from '../services/tenants';

export const SUBDOMAIN_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Max tenant platform image size in bytes.
 * Env: TENANT_IMAGE_MAX_FILE_SIZE_MB — default 0 = unlimited.
 */
export function getTenantImageMaxBytes(): number {
  const raw = process.env.TENANT_IMAGE_MAX_FILE_SIZE_MB;
  if (raw === undefined || raw === '') return Number.POSITIVE_INFINITY;
  const mb = Number(raw);
  if (!Number.isFinite(mb) || mb < 0) return Number.POSITIVE_INFINITY;
  if (mb === 0) return Number.POSITIVE_INFINITY;
  return Math.trunc(mb) * 1024 * 1024;
}

const tenantImageStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const dir = path.join(process.cwd(), 'uploads');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    cb(null, `tenant-${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname || '')}`);
  },
});

function buildTenantImageUpload() {
  const maxBytes = getTenantImageMaxBytes();
  return multer({
    storage: tenantImageStorage,
    fileFilter: (_req, file, cb) => {
      if (file.mimetype?.startsWith('image/')) cb(null, true);
      else cb(new Error('يسمح برفع صور فقط'));
    },
    limits: {
      ...(Number.isFinite(maxBytes) ? { fileSize: maxBytes } : {}),
      files: 4,
    },
  });
}

const tenantImageFields = [
  { name: 'avatar', maxCount: 1 },
  { name: 'favicon', maxCount: 1 },
  { name: 'og_image', maxCount: 1 },
  { name: 'hero_image', maxCount: 1 },
] as const;

/** Raw multer fields handler (prefer uploadTenantFilesSafe). */
export const uploadTenantFiles = buildTenantImageUpload().fields([...tenantImageFields]);

/** Multer with Arabic 413 when over TENANT_IMAGE_MAX_FILE_SIZE_MB (if set). */
export function uploadTenantFilesSafe(req: Request, res: Response, next: NextFunction) {
  uploadTenantFiles(req, res, (err: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        const maxBytes = getTenantImageMaxBytes();
        const label = Number.isFinite(maxBytes)
          ? `${Math.round(maxBytes / (1024 * 1024))} MB`
          : 'غير محدود';
        return res.status(413).json({
          success: false,
          message: `حجم الصورة أكبر من الحد المسموح (${label}). زد TENANT_IMAGE_MAX_FILE_SIZE_MB أو ضع 0 بلا حد`,
        });
      }
      return res.status(400).json({ success: false, message: err.message });
    }
    const msg = err instanceof Error ? err.message : 'خطأ في رفع الصورة';
    return res.status(400).json({ success: false, message: msg });
  });
}

export function isMultipartRequest(req: Request): boolean {
  const ct = (req.headers['content-type'] || '').toLowerCase();
  if (ct.includes('multipart/form-data')) return true;
  if (typeof req.is === 'function' && req.is('multipart/form-data')) return true;
  return false;
}

export function formStr(v: unknown): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  return s === '' ? undefined : s;
}

export function parseGradeIdsInput(v: unknown): number[] | undefined {
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

export function parseBooleanField(v: unknown): boolean | undefined {
  if (v === undefined || v === null || String(v).trim() === '') return undefined;
  return v === true || v === 'true' || v === '1';
}

export function normalizeTenantJsonBody(input: unknown): unknown {
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

/** Owner عند إنشاء منصة — نفس شكل /api/super/tenants */
export const CreateOwnerSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(6),
  description: z.string().optional(),
  subject: z.string().optional(),
  grade_ids: z.array(z.number().int().positive()).optional(),
  facebook_url: z.string().optional().nullable(),
  instagram_url: z.string().optional().nullable(),
  youtube_url: z.string().optional().nullable(),
  tiktok_url: z.string().optional().nullable(),
  whatsapp_number: z.string().optional().nullable(),
});

const CreateTenantFieldsSchema = z.object({
  subdomain: z.string().min(2).max(63).regex(SUBDOMAIN_REGEX),
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
  platform_type: z.enum(['teacher', 'academy']).optional().default('teacher'),
  owner: CreateOwnerSchema.optional(),
  /** جلسة طويلة بعد التسجيل العام فقط — يُتجاهل في super */
  remember_me: z.boolean().optional(),
});

/** Body إنشاء منصة للأدمن (owner اختياري) — مطابق /api/super/tenants */
export const CreateTenantBodySchema = z.preprocess(
  normalizeTenantJsonBody,
  CreateTenantFieldsSchema,
);

/** Body إنشاء منصة عام (owner إلزامي) — نفس الحقول + owner مطلوب */
export const PublicCreateTenantBodySchema = z.preprocess(
  normalizeTenantJsonBody,
  CreateTenantFieldsSchema.extend({
    owner: CreateOwnerSchema,
  }),
);

const OwnerPatchSchema = z
  .object({
    name: z.string().min(1).optional(),
    email: z.string().email().optional(),
    password: z.string().min(6).optional(),
    description: z.string().optional().nullable(),
    subject: z.string().optional().nullable(),
    phone: z.string().optional().nullable(),
    facebook_url: z.string().optional().nullable(),
    instagram_url: z.string().optional().nullable(),
    youtube_url: z.string().optional().nullable(),
    tiktok_url: z.string().optional().nullable(),
    whatsapp_number: z.string().optional().nullable(),
    account_status: z.enum(['active', 'inactive', 'suspended']).optional().nullable(),
    grade_ids: z.array(z.number().int().positive()).optional(),
  })
  .optional();

export const PatchTenantBodySchema = z.preprocess(
  normalizeTenantJsonBody,
  z.object({
    subdomain: z
      .string()
      .min(2)
      .max(63)
      .regex(SUBDOMAIN_REGEX)
      .optional(),
    display_name: z.string().min(1).optional(),
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
    merge_settings: z.boolean().optional(),
    merge_landing: z.boolean().optional(),
    owner: OwnerPatchSchema,
  }),
);

function parseJsonObject(
  raw: string | undefined,
  field: string,
): Record<string, unknown> | { error: string } | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return { error: `${field} must be a JSON object` };
  } catch {
    return { error: `Invalid JSON in ${field}` };
  }
}

async function uploadFileField(
  files: { [field: string]: Express.Multer.File[] } | undefined,
  field: string,
): Promise<string | null> {
  const f = files?.[field]?.[0];
  if (!f) return null;
  const r = await uploadToCloudinary(f.path);
  return r.secure_url;
}

function isPayloadError(value: unknown): value is { error: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof (value as { error?: unknown }).error === 'string'
  );
}

function parseOwnerFromBody(b: Record<string, unknown>): PatchTenantInput['owner'] | { error: string } | undefined {
  const ownerRaw = formStr(b.owner);
  if (ownerRaw) {
    const parsed = parseJsonObject(ownerRaw, 'owner');
    if (isPayloadError(parsed)) return parsed;
    if (!parsed) return { error: 'Invalid owner JSON' };
    const o = OwnerPatchSchema.safeParse(parsed);
    if (!o.success) return { error: 'Invalid owner JSON' };
    return o.data;
  }

  const owner: NonNullable<PatchTenantInput['owner']> = {};
  const name = formStr(b.owner_name);
  const email = formStr(b.owner_email);
  const password = formStr(b.owner_password);
  if (name) owner.name = name;
  if (email) owner.email = email;
  if (password) owner.password = password;
  if (b.owner_description !== undefined) owner.description = formStr(b.owner_description) ?? null;
  if (b.owner_subject !== undefined) owner.subject = formStr(b.owner_subject) ?? null;
  if (b.owner_phone !== undefined) owner.phone = formStr(b.owner_phone) ?? null;
  if (b.owner_facebook_url !== undefined) owner.facebook_url = formStr(b.owner_facebook_url) ?? null;
  if (b.owner_instagram_url !== undefined) {
    owner.instagram_url = formStr(b.owner_instagram_url) ?? null;
  }
  if (b.owner_youtube_url !== undefined) owner.youtube_url = formStr(b.owner_youtube_url) ?? null;
  if (b.owner_tiktok_url !== undefined) owner.tiktok_url = formStr(b.owner_tiktok_url) ?? null;
  if (b.owner_whatsapp_number !== undefined) {
    owner.whatsapp_number = formStr(b.owner_whatsapp_number) ?? null;
  }
  if (b.owner_account_status !== undefined) {
    const status = formStr(b.owner_account_status);
    if (status === 'active' || status === 'inactive' || status === 'suspended') {
      owner.account_status = status;
    }
  }
  const gradeIds = parseGradeIdsInput(b.owner_grade_ids);
  if (gradeIds) owner.grade_ids = gradeIds;

  return Object.keys(owner).length ? owner : undefined;
}

export async function buildPatchTenantFromMultipart(
  req: Request,
): Promise<{ data: PatchTenantInput } | { error: string }> {
  const b = req.body as Record<string, unknown>;
  const files = req.files as { [field: string]: Express.Multer.File[] } | undefined;
  const data: PatchTenantInput = {};

  const subdomain = formStr(b.subdomain)?.toLowerCase() ?? formStr(b.subDomain)?.toLowerCase();
  if (subdomain !== undefined) {
    if (subdomain.length < 2 || subdomain.length > 63 || !SUBDOMAIN_REGEX.test(subdomain)) {
      return { error: 'Invalid subdomain' };
    }
    data.subdomain = subdomain;
  }

  const displayName = formStr(b.display_name) ?? formStr(b.displayName);
  if (displayName !== undefined) data.display_name = displayName;
  if (b.specialty !== undefined) data.specialty = formStr(b.specialty) ?? null;
  if (b.bio !== undefined) data.bio = formStr(b.bio) ?? null;
  if (b.seo_title !== undefined) data.seo_title = formStr(b.seo_title) ?? null;
  if (b.seo_meta_description !== undefined) {
    data.seo_meta_description = formStr(b.seo_meta_description) ?? null;
  }

  const isActive = parseBooleanField(b.is_active);
  if (isActive !== undefined) data.is_active = isActive;

  const avatarUrl = await uploadFileField(files, 'avatar');
  if (avatarUrl) data.avatar_url = avatarUrl;
  else if (b.avatar_url !== undefined) data.avatar_url = formStr(b.avatar_url) ?? null;

  const faviconUrl = await uploadFileField(files, 'favicon');
  if (faviconUrl) data.favicon_url = faviconUrl;
  else if (b.favicon_url !== undefined) data.favicon_url = formStr(b.favicon_url) ?? null;

  const ogImageUrl = await uploadFileField(files, 'og_image');
  if (ogImageUrl) data.og_image_url = ogImageUrl;
  else if (b.og_image_url !== undefined) data.og_image_url = formStr(b.og_image_url) ?? null;

  const landingRaw = formStr(b.landing);
  if (landingRaw) {
    const landing = parseJsonObject(landingRaw, 'landing');
    if (isPayloadError(landing)) return landing;
    if (landing) data.landing = landing;
  }

  const heroImageUrl = await uploadFileField(files, 'hero_image');
  if (heroImageUrl) {
    data.landing = {
      ...(data.landing ?? {}),
      hero: {
        ...((data.landing?.hero && typeof data.landing.hero === 'object' && !Array.isArray(data.landing.hero)
          ? data.landing.hero
          : {}) as Record<string, unknown>),
        image_url: heroImageUrl,
      },
    };
  }

  const settingsRaw = formStr(b.settings);
  if (settingsRaw) {
    const settings = parseJsonObject(settingsRaw, 'settings');
    if (isPayloadError(settings)) return settings;
    if (settings) data.settings = settings;
  }

  const mergeLanding = parseBooleanField(b.merge_landing);
  if (mergeLanding !== undefined) data.merge_landing = mergeLanding;
  const mergeSettings = parseBooleanField(b.merge_settings);
  if (mergeSettings !== undefined) data.merge_settings = mergeSettings;

  const owner = parseOwnerFromBody(b);
  if (isPayloadError(owner)) return owner;
  if (owner) data.owner = owner;

  if (Object.keys(data).length === 0) {
    return { error: 'No fields to update' };
  }

  return { data };
}

/** نفس multipart builder المستخدم في /api/super/tenants */
export async function buildCreateTenantFromMultipart(
  req: Request,
  options?: { requireOwner?: boolean },
): Promise<{ data: CreateTenantInput & { remember_me?: boolean } } | { error: string }> {
  const b = req.body as Record<string, unknown>;
  const subdomain =
    formStr(b.subdomain)?.toLowerCase() ?? formStr(b.subDomain)?.toLowerCase();
  const display_name = formStr(b.display_name) ?? formStr(b.displayName);
  if (!subdomain) return { error: 'subdomain is required' };
  if (!display_name) return { error: 'display_name is required' };
  if (subdomain.length < 2 || subdomain.length > 63 || !SUBDOMAIN_REGEX.test(subdomain)) {
    return { error: 'Invalid subdomain' };
  }

  const files = req.files as { [field: string]: Express.Multer.File[] } | undefined;

  const avatar_url =
    (await uploadFileField(files, 'avatar')) ?? (formStr(b.avatar_url) as string | null) ?? null;
  const favicon_url =
    (await uploadFileField(files, 'favicon')) ?? (formStr(b.favicon_url) as string | null) ?? null;
  const og_image_url =
    (await uploadFileField(files, 'og_image')) ?? (formStr(b.og_image_url) as string | null) ?? null;

  let landing: Record<string, unknown> | undefined;
  const landingRaw = formStr(b.landing);
  if (landingRaw) {
    const parsed = parseJsonObject(landingRaw, 'landing');
    if (isPayloadError(parsed)) return parsed;
    if (parsed) landing = parsed;
  }

  const heroImageUrl = await uploadFileField(files, 'hero_image');
  if (heroImageUrl) {
    landing = landing ?? {};
    const hero =
      landing.hero && typeof landing.hero === 'object' && !Array.isArray(landing.hero)
        ? (landing.hero as Record<string, unknown>)
        : {};
    landing.hero = { ...hero, image_url: heroImageUrl };
  }

  let settings: Record<string, unknown> | undefined;
  const settingsRaw = formStr(b.settings);
  if (settingsRaw) {
    const parsed = parseJsonObject(settingsRaw, 'settings');
    if (isPayloadError(parsed)) return parsed;
    if (parsed) settings = parsed;
  }

  let owner: CreateTenantInput['owner'];
  const ownerRaw = formStr(b.owner);
  if (ownerRaw) {
    try {
      const parsed = JSON.parse(ownerRaw) as unknown;
      const o = CreateOwnerSchema.safeParse(parsed);
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
        facebook_url: formStr(b.owner_facebook_url) ?? null,
        instagram_url: formStr(b.owner_instagram_url) ?? null,
        youtube_url: formStr(b.owner_youtube_url) ?? null,
        tiktok_url: formStr(b.owner_tiktok_url) ?? null,
        whatsapp_number: formStr(b.owner_whatsapp_number) ?? null,
      };
    }
  }

  if (options?.requireOwner && !owner) {
    return { error: 'owner is required (name, email, password)' };
  }

  const data: CreateTenantInput & { remember_me?: boolean } = {
    subdomain,
    display_name,
    specialty: formStr(b.specialty) ?? null,
    bio: formStr(b.bio) ?? null,
    avatar_url,
    is_active: parseBooleanField(b.is_active),
    seo_title: formStr(b.seo_title) ?? null,
    seo_meta_description: formStr(b.seo_meta_description) ?? null,
    favicon_url,
    og_image_url,
    settings,
    landing,
    platform_type:
      formStr(b.platform_type) === 'academy'
        ? 'academy'
        : formStr(b.platform_type) === 'teacher'
          ? 'teacher'
          : undefined,
    owner,
    remember_me: parseBooleanField(b.remember_me),
  };

  return { data };
}
