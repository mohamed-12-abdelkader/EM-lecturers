"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const authentication_1 = require("../middleware/authentication");
const tenantContext_1 = require("../middleware/tenantContext");
const validateReq_1 = require("../middleware/validateReq");
const utils_1 = require("../utils");
const tenants_1 = require("../services/tenants");
exports.router = (0, express_1.Router)();
exports.router.use((0, tenantContext_1.requireDefaultTenantMiddleware)());
exports.router.use((0, authentication_1.authMiddleware)(['admin']));
const OwnerSchema = zod_1.z
    .object({
    name: zod_1.z.string().min(1),
    email: zod_1.z.string().email(),
    password: zod_1.z.string().min(6),
    description: zod_1.z.string().optional(),
    subject: zod_1.z.string().optional(),
    grade_ids: zod_1.z.array(zod_1.z.number().int().positive()).optional(),
})
    .optional();
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
/** Flatten common API shapes (wrapped payload + camelCase aliases) before Zod. */
function normalizeCreateTenantJsonBody(input) {
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
const CreateTenantBody = zod_1.z.preprocess(normalizeCreateTenantJsonBody, zod_1.z.object({
    subdomain: zod_1.z
        .string()
        .min(2)
        .max(63)
        .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    display_name: zod_1.z.string().min(1),
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
    owner: OwnerSchema,
}));
const subdomainRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
function isMultipartCreate(req) {
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
async function buildCreateTenantFromMultipart(req) {
    const b = req.body;
    const subdomain = formStr(b.subdomain)?.toLowerCase() ?? formStr(b.subDomain)?.toLowerCase();
    const display_name = formStr(b.display_name) ?? formStr(b.displayName);
    if (!subdomain)
        return { error: 'subdomain is required' };
    if (!display_name)
        return { error: 'display_name is required' };
    if (subdomain.length < 2 || subdomain.length > 63 || !subdomainRegex.test(subdomain)) {
        return { error: 'Invalid subdomain' };
    }
    const files = req.files;
    const uploadField = async (field) => {
        const f = files?.[field]?.[0];
        if (!f)
            return null;
        const r = await (0, utils_1.uploadToCloudinary)(f.path);
        return r.secure_url;
    };
    const avatar_url = (await uploadField('avatar')) ?? formStr(b.avatar_url) ?? null;
    const favicon_url = (await uploadField('favicon')) ?? formStr(b.favicon_url) ?? null;
    const og_image_url = (await uploadField('og_image')) ?? formStr(b.og_image_url) ?? null;
    let landing;
    const landingRaw = formStr(b.landing);
    if (landingRaw) {
        try {
            const parsed = JSON.parse(landingRaw);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                landing = parsed;
            }
            else {
                return { error: 'landing must be a JSON object' };
            }
        }
        catch {
            return { error: 'Invalid JSON in landing' };
        }
    }
    const heroImageUrl = await uploadField('hero_image');
    if (heroImageUrl) {
        landing = landing ?? {};
        const hero = (landing.hero && typeof landing.hero === 'object' && !Array.isArray(landing.hero)
            ? landing.hero
            : {});
        landing.hero = { ...hero, image_url: heroImageUrl };
    }
    let settings;
    const settingsRaw = formStr(b.settings);
    if (settingsRaw) {
        try {
            const parsed = JSON.parse(settingsRaw);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                settings = parsed;
            }
            else {
                return { error: 'settings must be a JSON object' };
            }
        }
        catch {
            return { error: 'Invalid JSON in settings' };
        }
    }
    let owner;
    const ownerRaw = formStr(b.owner);
    if (ownerRaw) {
        try {
            const parsed = JSON.parse(ownerRaw);
            const o = zod_1.z
                .object({
                name: zod_1.z.string().min(1),
                email: zod_1.z.string().email(),
                password: zod_1.z.string().min(6),
                description: zod_1.z.string().optional(),
                subject: zod_1.z.string().optional(),
                grade_ids: zod_1.z.array(zod_1.z.number().int().positive()).optional(),
            })
                .safeParse(parsed);
            if (!o.success)
                return { error: 'Invalid owner JSON' };
            owner = o.data;
        }
        catch {
            return { error: 'Invalid JSON in owner' };
        }
    }
    else {
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
    let is_active;
    if (ia !== undefined && ia !== null && String(ia).trim() !== '') {
        is_active = ia === true || ia === 'true' || ia === '1';
    }
    const data = {
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
const uploadTenantCreateFiles = utils_1.uploadTeacherAvatar.fields([
    { name: 'avatar', maxCount: 1 },
    { name: 'favicon', maxCount: 1 },
    { name: 'og_image', maxCount: 1 },
    { name: 'hero_image', maxCount: 1 },
]);
const PatchTenantBody = zod_1.z.object({
    subdomain: zod_1.z
        .string()
        .min(2)
        .max(63)
        .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
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
    owner: zod_1.z
        .object({
        name: zod_1.z.string().min(1).optional(),
        email: zod_1.z.string().email().optional(),
        password: zod_1.z.string().min(6).optional(),
        description: zod_1.z.string().optional().nullable(),
        subject: zod_1.z.string().optional().nullable(),
        grade_ids: zod_1.z.array(zod_1.z.number().int().positive()).optional(),
    })
        .optional(),
});
exports.router.get('/', (0, utils_1.asyncWrapper)(async (_req, res) => {
    const rows = await tenants_1.TenantService.listAll(200, 0);
    res.json({ success: true, tenants: rows });
}));
exports.router.post('/', (req, res, next) => {
    if (isMultipartCreate(req)) {
        return uploadTenantCreateFiles(req, res, next);
    }
    next();
}, (req, res, next) => {
    if (!isMultipartCreate(req)) {
        return (0, validateReq_1.validate)(CreateTenantBody)(req, res, next);
    }
    next();
}, (0, utils_1.asyncWrapper)(async (req, res) => {
    try {
        let payload;
        if (isMultipartCreate(req)) {
            const built = await buildCreateTenantFromMultipart(req);
            if ('error' in built) {
                return res.status(400).json({ success: false, message: built.error });
            }
            payload = built.data;
        }
        else {
            payload = req.body;
        }
        const row = await tenants_1.TenantService.createTenantTransaction(payload);
        res.status(201).json({ success: true, tenant: row });
    }
    catch (e) {
        const err = e;
        if (err.code === '23505') {
            return res.status(409).json({ success: false, message: 'Subdomain already taken' });
        }
        throw e;
    }
}));
exports.router.patch('/:id', (0, validateReq_1.validate)(PatchTenantBody), (0, utils_1.asyncWrapper)(async (req, res) => {
    const id = Number(req.params.id);
    if (!id || Number.isNaN(id))
        return res.status(400).json({ message: 'Invalid id' });
    await tenants_1.TenantService.patchTenant(id, req.body);
    res.json({ success: true });
}));
