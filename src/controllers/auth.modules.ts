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
    device_ip: z.string().optional(),
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

export const Login = z
  .object({
    email: z.string().email().optional(),
    phone: z
      .string()
      .regex(/^\+?[0-9]{8,15}$/, 'Invalid phone number')
      .optional(),
    password: z.string(),
    device_ip: z.string().optional(),
    /** When Host resolves to tenant `default`, pass the teacher platform subdomain (same as URL subdomain). */
    subdomain: z.string().min(2).max(63).optional(),
    tenant_subdomain: z.string().min(2).max(63).optional(),
  })
  .refine((data) => data.email || data.phone, {
    message: 'Either email or phone must be provided',
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
