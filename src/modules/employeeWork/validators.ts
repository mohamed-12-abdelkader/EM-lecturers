import { z } from 'zod';

const timeRegex = /^([01]?\d|2[0-3]):[0-5]\d$/;
const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

export const TimeSchema = z.string().regex(timeRegex, 'صيغة الوقت HH:mm');
export const DateSchema = z.string().regex(dateRegex, 'صيغة التاريخ YYYY-MM-DD');

export const CreateEmployeeSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email(),
  password: z.string().min(6).max(100),
  phone: z.string().min(8).max(20).optional().nullable(),
  permissions: z.union([z.array(z.string()), z.record(z.string(), z.any())]).optional(),
  department: z.string().max(120).optional().nullable(),
  job_title: z.string().max(120).optional().nullable(),
  employee_code: z.string().max(32).optional().nullable(),
  work_start_time: TimeSchema.optional(),
  work_end_time: TimeSchema.optional(),
});

export const UpdateEmployeeSchema = z
  .object({
    name: z.string().min(2).max(120).optional(),
    phone: z.string().min(8).max(20).optional().nullable(),
    permissions: z.array(z.string()).optional(),
    is_active: z.boolean().optional(),
    status: z.enum(['active', 'inactive']).optional(),
    department: z.string().max(120).optional().nullable(),
    job_title: z.string().max(120).optional().nullable(),
    employee_code: z.string().max(32).optional(),
    work_start_time: TimeSchema.optional(),
    work_end_time: TimeSchema.optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'أرسل حقلًا واحدًا على الأقل' });

export const CreateDailyTaskSchema = z.object({
  title: z.string().min(2).max(300),
  description: z.string().max(5000).optional().nullable(),
  task_date: DateSchema,
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  order: z.coerce.number().int().positive().optional(),
});

export const UpdateDailyTaskSchema = z
  .object({
    title: z.string().min(2).max(300).optional(),
    description: z.string().max(5000).optional().nullable(),
    task_date: DateSchema.optional(),
    priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
    order: z.coerce.number().int().positive().optional(),
    status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'أرسل حقلًا واحدًا على الأقل' });

export const ReorderTasksSchema = z.object({
  task_date: DateSchema,
  ordered_ids: z.array(z.coerce.number().int().positive()).min(1),
});

export const CompleteTaskSchema = z.object({
  completionReport: z.string().min(2).max(5000).optional(),
  completion_report: z.string().min(2).max(5000).optional(),
}).refine((d) => Boolean((d.completionReport || d.completion_report || '').trim()), {
  message: 'completion_report مطلوب',
});

export const DateRangeQuerySchema = z.object({
  startDate: DateSchema.optional(),
  endDate: DateSchema.optional(),
  start_date: DateSchema.optional(),
  end_date: DateSchema.optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']).optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  date: DateSchema.optional(),
  search: z.string().optional(),
});
