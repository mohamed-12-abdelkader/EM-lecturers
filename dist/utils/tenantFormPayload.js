"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PatchTenantBodySchema = exports.uploadTenantFiles = exports.SUBDOMAIN_REGEX = void 0;
exports.isMultipartRequest = isMultipartRequest;
exports.formStr = formStr;
exports.parseGradeIdsInput = parseGradeIdsInput;
exports.parseBooleanField = parseBooleanField;
exports.normalizeTenantJsonBody = normalizeTenantJsonBody;
exports.buildPatchTenantFromMultipart = buildPatchTenantFromMultipart;
const zod_1 = require("zod");
const utils_1 = require("../utils");
exports.SUBDOMAIN_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
exports.uploadTenantFiles = utils_1.uploadTeacherAvatar.fields([
    { name: 'avatar', maxCount: 1 },
    { name: 'favicon', maxCount: 1 },
    { name: 'og_image', maxCount: 1 },
    { name: 'hero_image', maxCount: 1 },
]);
function isMultipartRequest(req) {
    const ct = (req.headers['content-type'] || '').toLowerCase();
    if (ct.includes('multipart/form-data'))
        return true;
    if (typeof req.is === 'function' && req.is('multipart/form-data'))
        return true;
    return false;
}
function formStr(v) {
    if (v == null)
        return undefined;
    const s = String(v).trim();
    return s === '' ? undefined : s;
}
function parseGradeIdsInput(v) {
    if (v === undefined || v === null || v === '')
        return undefined;
    if (Array.isArray(v)) {
        const arr = v.map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0);
        return arr.length ? arr : undefined;
    }
    if (typeof v === 'string') {
        const s = v.trim();
        if (!s)
            return undefined;
        if (s.startsWith('[')) {
            try {
                const parsed = JSON.parse(s);
                const arr = parsed.map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0);
                return arr.length ? arr : undefined;
            }
            catch {
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
function parseBooleanField(v) {
    if (v === undefined || v === null || String(v).trim() === '')
        return undefined;
    return v === true || v === 'true' || v === '1';
}
function normalizeTenantJsonBody(input) {
    if (input == null || typeof input !== 'object' || Array.isArray(input))
        return input;
    let o = { ...input };
    const wrapped = o.tenant ?? o.data ?? o.payload;
    if (wrapped && typeof wrapped === 'object' && !Array.isArray(wrapped)) {
        o = { ...wrapped, ...o };
    }
    if (o.subdomain == null && o.subDomain != null)
        o.subdomain = o.subDomain;
    if (o.display_name == null && o.displayName != null)
        o.display_name = o.displayName;
    return o;
}
const OwnerPatchSchema = zod_1.z
    .object({
    name: zod_1.z.string().min(1).optional(),
    email: zod_1.z.string().email().optional(),
    password: zod_1.z.string().min(6).optional(),
    description: zod_1.z.string().optional().nullable(),
    subject: zod_1.z.string().optional().nullable(),
    phone: zod_1.z.string().optional().nullable(),
    facebook_url: zod_1.z.string().optional().nullable(),
    youtube_url: zod_1.z.string().optional().nullable(),
    tiktok_url: zod_1.z.string().optional().nullable(),
    whatsapp_number: zod_1.z.string().optional().nullable(),
    account_status: zod_1.z.enum(['active', 'inactive', 'suspended']).optional().nullable(),
    grade_ids: zod_1.z.array(zod_1.z.number().int().positive()).optional(),
})
    .optional();
exports.PatchTenantBodySchema = zod_1.z.preprocess(normalizeTenantJsonBody, zod_1.z.object({
    subdomain: zod_1.z
        .string()
        .min(2)
        .max(63)
        .regex(exports.SUBDOMAIN_REGEX)
        .optional(),
    display_name: zod_1.z.string().min(1).optional(),
    specialty: zod_1.z.string().optional().nullable(),
    bio: zod_1.z.string().optional().nullable(),
    avatar_url: zod_1.z.string().optional().nullable(),
    is_active: zod_1.z.boolean().optional(),
    seo_title: zod_1.z.string().optional().nullable(),
    seo_meta_description: zod_1.z.string().optional().nullable(),
    favicon_url: zod_1.z.string().optional().nullable(),
    og_image_url: zod_1.z.string().optional().nullable(),
    settings: zod_1.z.record(zod_1.z.string(), zod_1.z.any()).optional(),
    landing: zod_1.z.record(zod_1.z.string(), zod_1.z.any()).optional(),
    merge_settings: zod_1.z.boolean().optional(),
    merge_landing: zod_1.z.boolean().optional(),
    owner: OwnerPatchSchema,
}));
function parseJsonObject(raw, field) {
    if (!raw)
        return null;
    try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parsed;
        }
        return { error: `${field} must be a JSON object` };
    }
    catch {
        return { error: `Invalid JSON in ${field}` };
    }
}
async function uploadFileField(files, field) {
    const f = files?.[field]?.[0];
    if (!f)
        return null;
    const r = await (0, utils_1.uploadToCloudinary)(f.path);
    return r.secure_url;
}
function isPayloadError(value) {
    return (typeof value === 'object' &&
        value !== null &&
        'error' in value &&
        typeof value.error === 'string');
}
function parseOwnerFromBody(b) {
    const ownerRaw = formStr(b.owner);
    if (ownerRaw) {
        const parsed = parseJsonObject(ownerRaw, 'owner');
        if (isPayloadError(parsed))
            return parsed;
        if (!parsed)
            return { error: 'Invalid owner JSON' };
        const o = OwnerPatchSchema.safeParse(parsed);
        if (!o.success)
            return { error: 'Invalid owner JSON' };
        return o.data;
    }
    const owner = {};
    const name = formStr(b.owner_name);
    const email = formStr(b.owner_email);
    const password = formStr(b.owner_password);
    if (name)
        owner.name = name;
    if (email)
        owner.email = email;
    if (password)
        owner.password = password;
    if (b.owner_description !== undefined)
        owner.description = formStr(b.owner_description) ?? null;
    if (b.owner_subject !== undefined)
        owner.subject = formStr(b.owner_subject) ?? null;
    if (b.owner_phone !== undefined)
        owner.phone = formStr(b.owner_phone) ?? null;
    if (b.owner_facebook_url !== undefined)
        owner.facebook_url = formStr(b.owner_facebook_url) ?? null;
    if (b.owner_youtube_url !== undefined)
        owner.youtube_url = formStr(b.owner_youtube_url) ?? null;
    if (b.owner_tiktok_url !== undefined)
        owner.tiktok_url = formStr(b.owner_tiktok_url) ?? null;
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
    if (gradeIds)
        owner.grade_ids = gradeIds;
    return Object.keys(owner).length ? owner : undefined;
}
async function buildPatchTenantFromMultipart(req) {
    const b = req.body;
    const files = req.files;
    const data = {};
    const subdomain = formStr(b.subdomain)?.toLowerCase() ?? formStr(b.subDomain)?.toLowerCase();
    if (subdomain !== undefined) {
        if (subdomain.length < 2 || subdomain.length > 63 || !exports.SUBDOMAIN_REGEX.test(subdomain)) {
            return { error: 'Invalid subdomain' };
        }
        data.subdomain = subdomain;
    }
    const displayName = formStr(b.display_name) ?? formStr(b.displayName);
    if (displayName !== undefined)
        data.display_name = displayName;
    if (b.specialty !== undefined)
        data.specialty = formStr(b.specialty) ?? null;
    if (b.bio !== undefined)
        data.bio = formStr(b.bio) ?? null;
    if (b.seo_title !== undefined)
        data.seo_title = formStr(b.seo_title) ?? null;
    if (b.seo_meta_description !== undefined) {
        data.seo_meta_description = formStr(b.seo_meta_description) ?? null;
    }
    const isActive = parseBooleanField(b.is_active);
    if (isActive !== undefined)
        data.is_active = isActive;
    const avatarUrl = await uploadFileField(files, 'avatar');
    if (avatarUrl)
        data.avatar_url = avatarUrl;
    else if (b.avatar_url !== undefined)
        data.avatar_url = formStr(b.avatar_url) ?? null;
    const faviconUrl = await uploadFileField(files, 'favicon');
    if (faviconUrl)
        data.favicon_url = faviconUrl;
    else if (b.favicon_url !== undefined)
        data.favicon_url = formStr(b.favicon_url) ?? null;
    const ogImageUrl = await uploadFileField(files, 'og_image');
    if (ogImageUrl)
        data.og_image_url = ogImageUrl;
    else if (b.og_image_url !== undefined)
        data.og_image_url = formStr(b.og_image_url) ?? null;
    const landingRaw = formStr(b.landing);
    if (landingRaw) {
        const landing = parseJsonObject(landingRaw, 'landing');
        if (isPayloadError(landing))
            return landing;
        if (landing)
            data.landing = landing;
    }
    const heroImageUrl = await uploadFileField(files, 'hero_image');
    if (heroImageUrl) {
        data.landing = {
            ...(data.landing ?? {}),
            hero: {
                ...(data.landing?.hero && typeof data.landing.hero === 'object' && !Array.isArray(data.landing.hero)
                    ? data.landing.hero
                    : {}),
                image_url: heroImageUrl,
            },
        };
    }
    const settingsRaw = formStr(b.settings);
    if (settingsRaw) {
        const settings = parseJsonObject(settingsRaw, 'settings');
        if (isPayloadError(settings))
            return settings;
        if (settings)
            data.settings = settings;
    }
    const mergeLanding = parseBooleanField(b.merge_landing);
    if (mergeLanding !== undefined)
        data.merge_landing = mergeLanding;
    const mergeSettings = parseBooleanField(b.merge_settings);
    if (mergeSettings !== undefined)
        data.merge_settings = mergeSettings;
    const owner = parseOwnerFromBody(b);
    if (isPayloadError(owner))
        return owner;
    if (owner)
        data.owner = owner;
    if (Object.keys(data).length === 0) {
        return { error: 'No fields to update' };
    }
    return { data };
}
