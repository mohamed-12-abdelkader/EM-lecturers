"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StudentChangePassword = exports.ChangePassword = exports.ResetPassword = exports.ForgotPassword = exports.Login = exports.RegisterAdminOrTeacher = exports.RegisterStudent = void 0;
const zod_1 = require("zod");
const RESERVED_TENANT_SLUGS = new Set(['www', 'api', 'app', 'admin', 'default', 'mail', 'ftp', 'cdn']);
const tenantSlugField = zod_1.z
    .string()
    .trim()
    .min(2)
    .max(63)
    .transform((s) => s.toLowerCase())
    .optional();
exports.RegisterStudent = zod_1.z
    .object({
    phone: zod_1.z
        .string()
        .regex(/^\+?[0-9]{8,15}$/, 'Invalid phone number')
        .transform((s) => s.trim()),
    password: zod_1.z.string().min(6),
    name: zod_1.z.string().min(1),
    parent_phone: zod_1.z
        .string()
        .regex(/^\+?[0-9]{8,15}$/, 'Invalid parent phone number')
        .transform((s) => s.trim()),
    grade_id: zod_1.z.number().optional(),
    student_level_id: zod_1.z.number().optional(),
    device_ip: zod_1.z.string().optional(),
    course_category: zod_1.z.enum(['برمجة', 'لغات', 'إدارة وتسويق', 'بيزنس', 'مهارات متنوعة']).optional(),
    /** عند استدعاء API من host افتراضي (مثل 127.0.0.1) يحدد منصة المدرّس؛ نفس الرقم على منصة أخرى = حساب جديد (tenant_id مختلف). */
    subdomain: tenantSlugField,
    tenant_subdomain: tenantSlugField,
})
    .transform((data) => ({
    ...data,
    grade_id: data.grade_id || data.student_level_id,
}))
    .refine((data) => {
    // لا يمكن إرسال grade_id و course_category معاً
    const hasGrade = data.grade_id !== undefined && data.grade_id !== null;
    const hasCategory = data.course_category !== undefined && data.course_category !== null;
    return !(hasGrade && hasCategory);
}, {
    message: 'لا يمكن إرسال grade_id و course_category معاً. اختر إما صف دراسي أو تخصص',
    path: ['grade_id'], // يظهر الخطأ على grade_id
})
    .refine((data) => {
    if (data.subdomain && data.tenant_subdomain && data.subdomain !== data.tenant_subdomain) {
        return false;
    }
    return true;
}, { message: 'subdomain و tenant_subdomain يجب أن يكونا متطابقين إذا أُرسل الاثنان', path: ['subdomain'] })
    .refine((data) => {
    const slug = data.subdomain ?? data.tenant_subdomain;
    if (!slug)
        return true;
    return !RESERVED_TENANT_SLUGS.has(slug);
}, { message: 'Invalid subdomain', path: ['subdomain'] });
exports.RegisterAdminOrTeacher = zod_1.z
    .object({
    email: zod_1.z.string().email().optional(),
    phone: zod_1.z
        .string()
        .regex(/^\+?[0-9]{8,15}$/, 'Invalid phone number')
        .optional(),
    password: zod_1.z.string().min(6),
    name: zod_1.z.string().min(1),
    role: zod_1.z.enum(['admin', 'teacher']),
})
    .refine((data) => data.email || data.phone, {
    message: 'Either email or phone must be provided',
});
exports.Login = zod_1.z
    .object({
    email: zod_1.z.string().email().optional(),
    phone: zod_1.z
        .string()
        .regex(/^\+?[0-9]{8,15}$/, 'Invalid phone number')
        .optional(),
    student_code: zod_1.z
        .string()
        .min(4)
        .max(20)
        .transform((s) => s.replace(/\D/g, ''))
        .optional(),
    password: zod_1.z.string().optional(),
    device_ip: zod_1.z.string().optional(),
    /** للطالب عند تسجيل الدخول من host افتراضي (localhost / ngrok). المدرس لا يحتاجه — يُكتشف تلقائياً. */
    subdomain: zod_1.z.string().min(2).max(63).optional(),
    tenant_subdomain: zod_1.z.string().min(2).max(63).optional(),
})
    .refine((data) => data.email || data.phone || data.student_code, {
    message: 'Either email, phone, or student_code must be provided',
})
    .refine((data) => {
    if (data.email || data.phone)
        return !!data.password?.length;
    return true;
}, {
    message: 'password is required when logging in with email or phone',
    path: ['password'],
})
    .refine((data) => !data.student_code || data.student_code.length >= 4, {
    message: 'student_code must be at least 4 digits',
    path: ['student_code'],
});
exports.ForgotPassword = zod_1.z.object({
    email: zod_1.z.string().email(),
});
exports.ResetPassword = zod_1.z.object({
    token: zod_1.z.string(),
    password: zod_1.z.string().min(6),
});
exports.ChangePassword = zod_1.z
    .object({
    email: zod_1.z.string().email().optional(),
    phone: zod_1.z.string().min(8).optional(),
    new_password: zod_1.z.string().min(6),
})
    .refine((data) => data.email || data.phone, {
    message: 'Either email or phone is required',
});
exports.StudentChangePassword = zod_1.z.object({
    phone: zod_1.z.string().regex(/^\+?[0-9]{8,15}$/, 'Invalid phone number'),
    new_password: zod_1.z.string().min(6, 'Password must be at least 6 characters'),
});
