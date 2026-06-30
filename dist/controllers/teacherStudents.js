"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const zod_1 = require("zod");
const authentication_1 = require("../middleware/authentication");
const utils_1 = require("../utils");
const teacherManagedStudents_1 = require("../services/teacherManagedStudents");
exports.router = (0, express_1.Router)();
const uploadCsv = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        const ok = file.mimetype === 'text/csv' ||
            file.mimetype === 'application/vnd.ms-excel' ||
            file.originalname.toLowerCase().endsWith('.csv');
        if (ok)
            cb(null, true);
        else
            cb(new Error('يُقبل ملف CSV فقط'));
    },
});
const RegistrationSettingsSchema = zod_1.z.object({
    registration_mode: zod_1.z.enum(['self_registration', 'teacher_registration']).optional(),
    default_password_from_phone: zod_1.z.boolean().optional(),
});
const CreateStudentSchema = zod_1.z.object({
    name: zod_1.z.string().min(2),
    grade_id: zod_1.z.number().int().positive(),
    phone: zod_1.z.string().min(8).max(20).optional().nullable(),
    parent_phone: zod_1.z.string().min(8).max(20).optional().nullable(),
    group_id: zod_1.z.number().int().positive().optional().nullable(),
    password: zod_1.z.string().min(6).optional().nullable(),
    use_phone_as_password: zod_1.z.boolean().optional(),
});
const UpdateStudentSchema = zod_1.z.object({
    name: zod_1.z.string().min(2).optional(),
    grade_id: zod_1.z.number().int().positive().optional(),
    phone: zod_1.z.string().min(8).max(20).optional().nullable(),
    parent_phone: zod_1.z.string().min(8).max(20).optional().nullable(),
    group_id: zod_1.z.number().int().positive().optional().nullable(),
    account_status: zod_1.z.enum(['active', 'inactive', 'suspended']).optional(),
});
const ResetPasswordSchema = zod_1.z.object({
    new_password: zod_1.z.string().min(6).optional(),
    use_phone_as_password: zod_1.z.boolean().optional(),
});
const StatusSchema = zod_1.z.object({
    account_status: zod_1.z.enum(['active', 'inactive', 'suspended']),
});
function resolveTenantId(req) {
    const tenantId = req.tenant?.id;
    if (!tenantId)
        throw new utils_1.HttpError(400, 'تعذر تحديد المنصة');
    return tenantId;
}
exports.router.use((0, authentication_1.authMiddleware)(['teacher']));
/** إعدادات طريقة تسجيل الطلاب */
exports.router.get('/registration-settings', (0, utils_1.asyncWrapper)(async (req, res) => {
    const settings = await teacherManagedStudents_1.TeacherManagedStudentsService.getRegistrationSettings(resolveTenantId(req));
    res.json({ success: true, data: settings });
}));
exports.router.put('/registration-settings', (0, utils_1.asyncWrapper)(async (req, res) => {
    const parsed = RegistrationSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ success: false, errors: parsed.error.errors });
    }
    const settings = await teacherManagedStudents_1.TeacherManagedStudentsService.setRegistrationSettings(resolveTenantId(req), parsed.data);
    res.json({ success: true, data: settings });
}));
/** قائمة الطلاب المُدارين بواسطة المدرس */
exports.router.get('/', (0, utils_1.asyncWrapper)(async (req, res) => {
    const page = req.query.page ? Number(req.query.page) : 1;
    const limit = req.query.limit ? Number(req.query.limit) : 20;
    const sort = req.query.sort;
    const order = req.query.order === 'asc' ? 'asc' : 'desc';
    const data = await teacherManagedStudents_1.TeacherManagedStudentsService.listStudents(req.user.id, resolveTenantId(req), {
        search: typeof req.query.search === 'string' ? req.query.search : undefined,
        grade_id: req.query.grade_id ? Number(req.query.grade_id) : undefined,
        group_id: req.query.group_id ? Number(req.query.group_id) : undefined,
        account_status: req.query.account_status,
        page,
        limit,
        sort,
        order,
    });
    res.json({ success: true, data });
}));
/** إضافة طالب جديد */
exports.router.post('/', (0, utils_1.asyncWrapper)(async (req, res) => {
    const parsed = CreateStudentSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ success: false, errors: parsed.error.errors });
    }
    const result = await teacherManagedStudents_1.TeacherManagedStudentsService.createStudent(req.user.id, resolveTenantId(req), parsed.data);
    res.status(201).json({ success: true, data: result });
}));
/** استيراد طلاب من CSV */
exports.router.post('/import', uploadCsv.single('file'), (0, utils_1.asyncWrapper)(async (req, res) => {
    let csvText = '';
    if (req.file?.buffer) {
        csvText = req.file.buffer.toString('utf-8');
    }
    else if (typeof req.body?.csv === 'string') {
        csvText = req.body.csv;
    }
    else {
        return res.status(400).json({
            success: false,
            message: 'أرسل ملف CSV في الحقل file أو نص CSV في الحقل csv',
        });
    }
    const report = await teacherManagedStudents_1.TeacherManagedStudentsService.importStudents(req.user.id, resolveTenantId(req), csvText);
    res.json({ success: true, data: report });
}));
/** عرض بيانات طالب */
exports.router.get('/:studentId', (0, utils_1.asyncWrapper)(async (req, res) => {
    const studentId = Number(req.params.studentId);
    if (!Number.isInteger(studentId) || studentId <= 0) {
        return res.status(400).json({ success: false, message: 'معرف الطالب غير صالح' });
    }
    const student = await teacherManagedStudents_1.TeacherManagedStudentsService.getStudentById(req.user.id, resolveTenantId(req), studentId);
    res.json({ success: true, data: student });
}));
/** تعديل بيانات طالب */
exports.router.put('/:studentId', (0, utils_1.asyncWrapper)(async (req, res) => {
    const studentId = Number(req.params.studentId);
    const parsed = UpdateStudentSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ success: false, errors: parsed.error.errors });
    }
    const student = await teacherManagedStudents_1.TeacherManagedStudentsService.updateStudent(req.user.id, resolveTenantId(req), studentId, parsed.data);
    res.json({ success: true, data: student });
}));
/** نقل الطالب لمجموعة أخرى */
exports.router.patch('/:studentId/group', (0, utils_1.asyncWrapper)(async (req, res) => {
    const studentId = Number(req.params.studentId);
    const groupId = req.body?.group_id != null ? Number(req.body.group_id) : null;
    if (groupId != null && (!Number.isInteger(groupId) || groupId <= 0)) {
        return res.status(400).json({ success: false, message: 'group_id غير صالح' });
    }
    const student = await teacherManagedStudents_1.TeacherManagedStudentsService.updateStudent(req.user.id, resolveTenantId(req), studentId, { group_id: groupId });
    res.json({ success: true, data: student });
}));
/** إعادة تعيين كلمة المرور */
exports.router.post('/:studentId/reset-password', (0, utils_1.asyncWrapper)(async (req, res) => {
    const studentId = Number(req.params.studentId);
    const parsed = ResetPasswordSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
        return res.status(400).json({ success: false, errors: parsed.error.errors });
    }
    const result = await teacherManagedStudents_1.TeacherManagedStudentsService.resetPassword(req.user.id, resolveTenantId(req), studentId, parsed.data);
    res.json({ success: true, data: result });
}));
/** تفعيل / إيقاف الحساب */
exports.router.patch('/:studentId/status', (0, utils_1.asyncWrapper)(async (req, res) => {
    const studentId = Number(req.params.studentId);
    const parsed = StatusSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ success: false, errors: parsed.error.errors });
    }
    const student = await teacherManagedStudents_1.TeacherManagedStudentsService.setAccountStatus(req.user.id, resolveTenantId(req), studentId, parsed.data.account_status);
    res.json({ success: true, data: student });
}));
/** حذف طالب */
exports.router.delete('/:studentId', (0, utils_1.asyncWrapper)(async (req, res) => {
    const studentId = Number(req.params.studentId);
    const result = await teacherManagedStudents_1.TeacherManagedStudentsService.deleteStudent(req.user.id, resolveTenantId(req), studentId);
    res.json({ success: true, data: result });
}));
