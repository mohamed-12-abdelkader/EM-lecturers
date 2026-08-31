import { z } from 'zod';

export const CreateTaskTemplateSchema = z.object({
  title: z.string().min(2),
  description: z.string().optional().nullable(),
  task_type: z.enum(['daily', 'weekly']).optional(),
  taskType: z.enum(['daily', 'weekly']).optional(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  scheduled_time: z.string().optional().nullable(),
  scheduledTime: z.string().optional().nullable(),
  admin_notes: z.string().optional().nullable(),
  adminNotes: z.string().optional().nullable(),
  allow_attachments: z.boolean().optional(),
  allowAttachments: z.boolean().optional(),
});

export const UpdateTaskTemplateSchema = CreateTaskTemplateSchema.partial().extend({
  status: z.enum(['active', 'cancelled', 'archived']).optional(),
});

export const AssignTaskSchema = z.object({
  employee_ids: z.array(z.number().int().positive()).optional(),
  employeeIds: z.array(z.number().int().positive()).optional(),
  assign_all: z.boolean().optional(),
  assignAll: z.boolean().optional(),
});

export const CompleteInstanceSchema = z.object({
  employee_notes: z.string().optional().nullable(),
  employeeNotes: z.string().optional().nullable(),
});

export const AddNoteSchema = z.object({
  note: z.string().min(1),
});
