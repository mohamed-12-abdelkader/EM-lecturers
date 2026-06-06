"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const authentication_1 = require("../middleware/authentication");
const validateReq_1 = require("../middleware/validateReq");
const utils_1 = require("../utils");
const adminTeachers_1 = require("../services/adminTeachers");
exports.router = (0, express_1.Router)();
function adminTenantScope(req) {
    const t = req.tenant;
    if (!t)
        return undefined;
    return t.subdomain === 'default' ? undefined : t.id;
}
const TeacherStatusSchema = zod_1.z.object({
    status: zod_1.z.enum(['active', 'inactive', 'suspended']),
});
const TeacherPackageSchema = zod_1.z.object({
    subscription_package: zod_1.z.enum(['bronze', 'silver', 'gold', 'diamond']),
});
const UpdateTeacherSchema = zod_1.z.object({
    name: zod_1.z.string().min(2).optional(),
    email: zod_1.z.string().email().optional().or(zod_1.z.literal('')),
    phone: zod_1.z.string().regex(/^\+?[0-9]{8,15}$/).optional().or(zod_1.z.literal('')),
    password: zod_1.z.string().min(6).optional(),
    subject: zod_1.z.string().optional().or(zod_1.z.literal('')),
    description: zod_1.z.string().optional().or(zod_1.z.literal('')),
    account_status: zod_1.z.enum(['active', 'inactive', 'suspended']).optional(),
    subscription_package: zod_1.z.enum(['bronze', 'silver', 'gold', 'diamond']).optional(),
    grade_ids: zod_1.z.array(zod_1.z.coerce.number().int().positive()).optional(),
});
function parseGradeIds(raw) {
    if (raw === undefined || raw === null || raw === '')
        return undefined;
    if (Array.isArray(raw))
        return raw.map((v) => Number(v)).filter((v) => Number.isFinite(v));
    if (typeof raw === 'string') {
        const s = raw.trim();
        if (!s)
            return undefined;
        if (s.startsWith('[')) {
            try {
                const arr = JSON.parse(s);
                return arr.map((v) => Number(v)).filter((v) => Number.isFinite(v));
            }
            catch {
                throw new utils_1.HttpError(400, 'Invalid grade_ids format');
            }
        }
        return s
            .split(',')
            .map((v) => Number(v.trim()))
            .filter((v) => Number.isFinite(v));
    }
    return undefined;
}
exports.router.get('/:id', (0, authentication_1.authMiddleware)(['admin']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const tenantId = adminTenantScope(req);
    const teacherId = Number(req.params.id);
    if (!teacherId || Number.isNaN(teacherId))
        throw new utils_1.HttpError(400, 'Invalid teacher id');
    const teacher = await adminTeachers_1.AdminTeachersService.getTeacherWithGrades(teacherId, tenantId);
    if (!teacher)
        throw new utils_1.HttpError(404, 'Teacher not found');
    res.json({ success: true, data: teacher });
}));
exports.router.put('/:id', (0, authentication_1.authMiddleware)(['admin']), utils_1.uploadTeacherAvatar.single('avatar'), (0, utils_1.asyncWrapper)(async (req, res) => {
    const tenantId = adminTenantScope(req);
    const teacherId = Number(req.params.id);
    if (!teacherId || Number.isNaN(teacherId))
        throw new utils_1.HttpError(400, 'Invalid teacher id');
    const parsed = UpdateTeacherSchema.safeParse({
        ...req.body,
        grade_ids: parseGradeIds(req.body.grade_ids),
    });
    if (!parsed.success)
        return res.status(400).json({ message: 'Validation failed', errors: parsed.error });
    const body = parsed.data;
    let newAvatarUrl;
    if (req.file) {
        const uploaded = await (0, utils_1.uploadToCloudinary)(req.file.path);
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
        account_status: body.account_status,
        subscription_package: body.subscription_package,
        grade_ids: body.grade_ids,
    };
    const { previousAvatar } = await adminTeachers_1.AdminTeachersService.updateTeacher(teacherId, tenantId, payload);
    if (newAvatarUrl && previousAvatar && previousAvatar !== newAvatarUrl) {
        await (0, utils_1.deleteCloudinaryAssetByUrl)(previousAvatar);
    }
    const teacher = await adminTeachers_1.AdminTeachersService.getTeacherWithGrades(teacherId, tenantId);
    res.json({ success: true, message: 'Teacher updated successfully', data: teacher });
}));
exports.router.patch('/:id/status', (0, authentication_1.authMiddleware)(['admin']), (0, validateReq_1.validate)(TeacherStatusSchema), (0, utils_1.asyncWrapper)(async (req, res) => {
    const tenantId = adminTenantScope(req);
    const teacherId = Number(req.params.id);
    if (!teacherId || Number.isNaN(teacherId))
        throw new utils_1.HttpError(400, 'Invalid teacher id');
    await adminTeachers_1.AdminTeachersService.setTeacherStatus(teacherId, tenantId, req.body.status);
    res.json({ success: true, message: 'Teacher status updated' });
}));
exports.router.patch('/:id/package', (0, authentication_1.authMiddleware)(['admin']), (0, validateReq_1.validate)(TeacherPackageSchema), (0, utils_1.asyncWrapper)(async (req, res) => {
    const tenantId = adminTenantScope(req);
    const teacherId = Number(req.params.id);
    if (!teacherId || Number.isNaN(teacherId))
        throw new utils_1.HttpError(400, 'Invalid teacher id');
    await adminTeachers_1.AdminTeachersService.setTeacherPackage(teacherId, tenantId, req.body.subscription_package);
    res.json({ success: true, message: 'Teacher package updated' });
}));
exports.router.delete('/:id', (0, authentication_1.authMiddleware)(['admin']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const tenantId = adminTenantScope(req);
    const teacherId = Number(req.params.id);
    if (!teacherId || Number.isNaN(teacherId))
        throw new utils_1.HttpError(400, 'Invalid teacher id');
    const result = await adminTeachers_1.AdminTeachersService.deleteTeacher(teacherId, tenantId);
    await (0, utils_1.deleteCloudinaryAssetByUrl)(result.avatar);
    res.json({ success: true, message: 'Teacher deleted successfully' });
}));
