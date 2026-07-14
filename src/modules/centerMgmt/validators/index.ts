import { z } from 'zod';

const daySchema = z.string().min(1).max(30);

export const CreateGroupSchema = z.object({
  name: z.string().min(1).max(200),
  grade_id: z.coerce.number().int().positive().optional().nullable(),
  subject_id: z.coerce.number().int().positive().optional().nullable(),
  days: z.array(daySchema).min(1),
  start_time: z.string().max(20).optional().nullable(),
  end_time: z.string().max(20).optional().nullable(),
  monthly_fee: z.coerce.number().min(0),
  study_start_date: z.string().optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
  status: z.enum(['active', 'paused']).optional(),
});

export const UpdateGroupSchema = CreateGroupSchema.partial();

export const CreateStudentSchema = z.object({
  full_name: z.string().min(1).max(200),
  phone: z.string().min(5).max(30),
  parent_phone: z.string().min(5).max(30).optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
  /** حالة الاشتراك للشهر الحالي عند الإنشاء */
  payment_status: z.enum(['paid', 'unpaid', 'partial', 'exempt']).optional(),
  amount_paid: z.coerce.number().min(0).optional(),
  exemption_reason: z.string().max(1000).optional().nullable(),
});

export const UpdateStudentSchema = z.object({
  full_name: z.string().min(1).max(200).optional(),
  phone: z.string().min(5).max(30).optional().nullable(),
  parent_phone: z.string().min(5).max(30).optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
  is_active: z.boolean().optional(),
});

export const OpenBillingMonthSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
  notes: z.string().max(2000).optional().nullable(),
  /** الطلاب اللي جددوا — الباقي unpaid */
  renewed_student_ids: z.array(z.coerce.number().int().positive()).optional(),
  /** تعيين حالة افتراضية لكل الاشتراكات الجديدة */
  default_status: z.enum(['paid', 'unpaid', 'partial', 'exempt']).optional(),
});

export const UpdateSubscriptionSchema = z.object({
  status: z.enum(['paid', 'unpaid', 'partial', 'exempt']),
  amount_paid: z.coerce.number().min(0).optional(),
  exemption_reason: z.string().max(1000).optional().nullable(),
});

export const BulkUpdateSubscriptionsSchema = z.object({
  updates: z
    .array(
      z.object({
        subscription_id: z.coerce.number().int().positive(),
        status: z.enum(['paid', 'unpaid', 'partial', 'exempt']),
        amount_paid: z.coerce.number().min(0).optional(),
        exemption_reason: z.string().max(1000).optional().nullable(),
      }),
    )
    .min(1)
    .max(500),
});

export const CreatePaymentSchema = z.object({
  student_id: z.coerce.number().int().positive(),
  group_id: z.coerce.number().int().positive().optional().nullable(),
  subscription_id: z.coerce.number().int().positive().optional().nullable(),
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
  amount: z.coerce.number().positive(),
  method: z.enum(['cash', 'transfer', 'vodafone_cash', 'other']).optional(),
  notes: z.string().max(2000).optional().nullable(),
  paid_at: z.string().optional().nullable(),
});

export const ManualAttendanceSchema = z.object({
  group_id: z.coerce.number().int().positive(),
  student_id: z.coerce.number().int().positive(),
  attendance_date: z.string().min(8).max(20),
  status: z.enum(['present', 'absent', 'late', 'excused']),
  notes: z.string().max(1000).optional().nullable(),
});

export const BulkAttendanceSchema = z.object({
  group_id: z.coerce.number().int().positive(),
  attendance_date: z.string().min(8).max(20),
  records: z
    .array(
      z.object({
        student_id: z.coerce.number().int().positive(),
        status: z.enum(['present', 'absent', 'late', 'excused']),
        notes: z.string().max(1000).optional().nullable(),
      }),
    )
    .min(1)
    .max(500),
});

export const ScanAttendanceSchema = z.object({
  qr_token: z.string().uuid().optional(),
  qr_payload: z.string().min(1).optional(),
  group_id: z.coerce.number().int().positive(),
  attendance_date: z.string().min(8).max(20).optional(),
  status: z.enum(['present', 'late']).optional(),
  notes: z.string().max(1000).optional().nullable(),
}).refine((d) => Boolean(d.qr_token || d.qr_payload), {
  message: 'qr_token or qr_payload is required',
});
