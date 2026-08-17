import { z } from 'zod';

const RESERVED_TENANT_SLUGS = new Set(['www', 'api', 'app', 'admin', 'default', 'mail', 'ftp', 'cdn']);

const tenantSlugField = z
  .string()
  .trim()
  .min(2)
  .max(63)
  .transform((s) => s.toLowerCase())
  .optional();

export const RegisterStudent = z
  .object({
    phone: z
      .string()
      .regex(/^\+?[0-9]{8,15}$/, 'Invalid phone number')
      .transform((s) => s.trim()),
    password: z.string().min(6),
    name: z.string().min(1),
    parent_phone: z
      .string()
      .regex(/^\+?[0-9]{8,15}$/, 'Invalid parent phone number')
      .transform((s) => s.trim()),
    grade_id: z.number().optional(),
    student_level_id: z.number().optional(),
    course_group_id: z.coerce.number().int().positive().optional(),
    device_ip: z.string().optional(),
    deviceIp: z.string().optional(),
    registered_ip: z.string().optional(),
    ip: z.string().optional(),
    course_category: z.enum(['برمجة', 'لغات', 'إدارة وتسويق', 'بيزنس', 'مهارات متنوعة']).optional(),
    /** عند استدعاء API من host افتراضي (مثل 127.0.0.1) يحدد منصة المدرّس؛ نفس الرقم على منصة أخرى = حساب جديد (tenant_id مختلف). */
    subdomain: tenantSlugField,
    tenant_subdomain: tenantSlugField,
  })
  .transform((data) => ({
    ...data,
    grade_id: data.grade_id || data.student_level_id,
  }))
  .refine(
    (data) => {
      // لا يمكن إرسال grade_id و course_category معاً
      const hasGrade = data.grade_id !== undefined && data.grade_id !== null;
      const hasCategory = data.course_category !== undefined && data.course_category !== null;
      return !(hasGrade && hasCategory);
    },
    {
      message: 'لا يمكن إرسال grade_id و course_category معاً. اختر إما صف دراسي أو تخصص',
      path: ['grade_id'], // يظهر الخطأ على grade_id
    },
  )
  .refine(
    (data) => {
      if (data.subdomain && data.tenant_subdomain && data.subdomain !== data.tenant_subdomain) {
        return false;
      }
      return true;
    },
    { message: 'subdomain و tenant_subdomain يجب أن يكونا متطابقين إذا أُرسل الاثنان', path: ['subdomain'] },
  )
  .refine(
    (data) => {
      const slug = data.subdomain ?? data.tenant_subdomain;
      if (!slug) return true;
      return !RESERVED_TENANT_SLUGS.has(slug);
    },
    { message: 'Invalid subdomain', path: ['subdomain'] },
  );

export const RegisterAdminOrTeacher = z
  .object({
    email: z.string().email().optional(),
    phone: z
      .string()
      .regex(/^\+?[0-9]{8,15}$/, 'Invalid phone number')
      .optional(),
    password: z.string().min(6),
    name: z.string().min(1),
    role: z.enum(['admin', 'teacher']),
  })
  .refine((data) => data.email || data.phone, {
    message: 'Either email or phone must be provided',
  });

const booleanish = z.preprocess((value) => {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    return ['1', 'true', 'yes', 'y', 'on'].includes(value.trim().toLowerCase());
  }
  return value;
}, z.boolean().optional());

export const Login = z
  .object({
    email: z.string().email().optional(),
    phone: z
      .string()
      .regex(/^\+?[0-9]{8,15}$/, 'Invalid phone number')
      .optional(),
    student_code: z
      .string()
      .min(4)
      .max(20)
      .transform((s) => s.replace(/\D/g, ''))
      .optional(),
    password: z.string().optional(),
    device_ip: z.string().optional(),
    deviceIp: z.string().optional(),
    registered_ip: z.string().optional(),
    ip: z.string().optional(),
    /** إبقاء الجلسة سنة كاملة (Refresh Cookie). الافتراضي: 7 أيام */
    remember_me: booleanish,
    /** للطالب عند تسجيل الدخول من host افتراضي (localhost / ngrok). المدرس لا يحتاجه — يُكتشف تلقائياً. */
    subdomain: z.string().min(2).max(63).optional(),
    tenant_subdomain: z.string().min(2).max(63).optional(),
  })
  .refine((data) => data.email || data.phone || data.student_code, {
    message: 'Either email, phone, or student_code must be provided',
  })
  .refine((data) => {
    if (data.email || data.phone) return !!data.password?.length;
    return true;
  }, {
    message: 'password is required when logging in with email or phone',
    path: ['password'],
  })
  .refine((data) => !data.student_code || data.student_code.length >= 4, {
    message: 'student_code must be at least 4 digits',
    path: ['student_code'],
  });

export const ForgotPassword = z.object({
  email: z.string().email(),
});

export const ResetPassword = z.object({
  token: z.string(),
  password: z.string().min(6),
});

export const ChangePassword = z
  .object({
    email: z.string().email().optional(),
    phone: z.string().min(8).optional(),
    new_password: z.string().min(6),
  })
  .refine((data) => data.email || data.phone, {
    message: 'Either email or phone is required',
  });

export const StudentChangePassword = z.object({
  phone: z.string().regex(/^\+?[0-9]{8,15}$/, 'Invalid phone number'),
  new_password: z.string().min(6, 'Password must be at least 6 characters'),
});
