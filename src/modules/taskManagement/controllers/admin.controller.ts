import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { authMiddleware } from '../../../middleware/authentication';
import { asyncWrapper, HttpError } from '../../../utils';
import { TaskTemplateService } from '../services/template.service';
import { TaskAssignmentService } from '../services/assignment.service';
import { TaskDashboardService } from '../services/dashboard.service';
import { TaskActivityService } from '../services/activity.service';
import {
  AssignTaskSchema,
  CreateTaskTemplateSchema,
  UpdateTaskTemplateSchema,
} from '../validators';
import type { TaskPriority, TaskType } from '../types';

export const adminTaskManagementRouter = Router();

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      const dir = 'uploads/task-templates';
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      cb(null, `tmpl-${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
});

adminTaskManagementRouter.use(authMiddleware(['admin']));

function parseId(v: string) {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'معرف غير صالح');
  return n;
}

/** Dashboard إحصائيات */
adminTaskManagementRouter.get(
  '/dashboard',
  asyncWrapper(async (req, res) => {
    const data = await TaskDashboardService.adminOverview({
      startDate: typeof req.query.startDate === 'string' ? req.query.startDate : undefined,
      endDate: typeof req.query.endDate === 'string' ? req.query.endDate : undefined,
      taskType: typeof req.query.taskType === 'string' ? req.query.taskType : undefined,
      status: typeof req.query.status === 'string' ? req.query.status : undefined,
      employeeId: req.query.employeeId ? Number(req.query.employeeId) : undefined,
    });
    res.json({ success: true, data });
  }),
);

/** Employee Performance */
adminTaskManagementRouter.get(
  '/performance',
  asyncWrapper(async (req, res) => {
    const startDate = String(req.query.startDate ?? req.query.start_date ?? '');
    const endDate = String(req.query.endDate ?? req.query.end_date ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      throw new HttpError(400, 'startDate و endDate مطلوبان YYYY-MM-DD');
    }
    const data = await TaskDashboardService.employeePerformance({
      startDate,
      endDate,
      employeeId: req.query.employeeId ? Number(req.query.employeeId) : undefined,
      taskType: typeof req.query.taskType === 'string' ? req.query.taskType : undefined,
    });
    res.json({ success: true, data });
  }),
);

/** قائمة المهام (Task Management) */
adminTaskManagementRouter.get(
  '/tasks',
  asyncWrapper(async (req, res) => {
    const data = await TaskTemplateService.list({
      search: typeof req.query.search === 'string' ? req.query.search : undefined,
      taskType: req.query.taskType as TaskType | undefined,
      status: req.query.status as any,
      priority: req.query.priority as TaskPriority | undefined,
      page: req.query.page ? Number(req.query.page) : 1,
      limit: req.query.limit ? Number(req.query.limit) : 20,
    });
    res.json({ success: true, data });
  }),
);

/** إنشاء مهمة */
adminTaskManagementRouter.post(
  '/tasks',
  asyncWrapper(async (req, res) => {
    const parsed = CreateTaskTemplateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, errors: parsed.error.errors });
    }
    const b = parsed.data;
    const taskType = (b.task_type ?? b.taskType) as TaskType;
    const startDate = b.start_date ?? b.startDate;
    if (!taskType || !startDate) {
      throw new HttpError(400, 'task_type و start_date مطلوبان');
    }
    const template = await TaskTemplateService.create({
      title: b.title,
      description: b.description,
      taskType,
      priority: b.priority,
      startDate,
      endDate: b.end_date ?? b.endDate ?? null,
      scheduledTime: b.scheduled_time ?? b.scheduledTime ?? null,
      adminNotes: b.admin_notes ?? b.adminNotes ?? null,
      allowAttachments: b.allow_attachments ?? b.allowAttachments,
      createdBy: req.user!.id,
    });
    res.status(201).json({ success: true, data: template });
  }),
);

/** تفاصيل مهمة */
adminTaskManagementRouter.get(
  '/tasks/:taskId',
  asyncWrapper(async (req, res) => {
    const taskId = parseId(req.params.taskId);
    const detail = await TaskDashboardService.templateDetailWithAssignments(taskId);
    if (!detail) throw new HttpError(404, 'المهمة غير موجودة');
    const attachments = await TaskTemplateService.listAttachments(taskId);
    const activity = await TaskActivityService.listForTemplate(taskId);
    res.json({
      success: true,
      data: {
        template: TaskTemplateService.serializeTemplate(detail.template),
        assignments: detail.assignments,
        attachments,
        activity,
      },
    });
  }),
);

/** تعديل مهمة */
adminTaskManagementRouter.patch(
  '/tasks/:taskId',
  asyncWrapper(async (req, res) => {
    const taskId = parseId(req.params.taskId);
    const parsed = UpdateTaskTemplateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, errors: parsed.error.errors });
    }
    const b = parsed.data;
    const template = await TaskTemplateService.update(
      taskId,
      {
        title: b.title,
        description: b.description ?? undefined,
        priority: b.priority,
        startDate: b.start_date ?? b.startDate,
        endDate: b.end_date ?? b.endDate,
        scheduledTime: b.scheduled_time ?? b.scheduledTime,
        adminNotes: b.admin_notes ?? b.adminNotes,
        allowAttachments: b.allow_attachments ?? b.allowAttachments,
        status: b.status,
      },
      req.user!.id,
    );
    res.json({ success: true, data: template });
  }),
);

/** إلغاء مهمة */
adminTaskManagementRouter.post(
  '/tasks/:taskId/cancel',
  asyncWrapper(async (req, res) => {
    const data = await TaskTemplateService.cancel(parseId(req.params.taskId), req.user!.id);
    res.json({ success: true, data });
  }),
);

/** نسخ مهمة */
adminTaskManagementRouter.post(
  '/tasks/:taskId/duplicate',
  asyncWrapper(async (req, res) => {
    const data = await TaskTemplateService.duplicate(parseId(req.params.taskId), req.user!.id);
    res.status(201).json({ success: true, data });
  }),
);

/** حذف مهمة */
adminTaskManagementRouter.delete(
  '/tasks/:taskId',
  asyncWrapper(async (req, res) => {
    const data = await TaskTemplateService.delete(parseId(req.params.taskId), req.user!.id);
    res.json({ success: true, data });
  }),
);

/** توزيع على موظفين */
adminTaskManagementRouter.post(
  '/tasks/:taskId/assign',
  asyncWrapper(async (req, res) => {
    const parsed = AssignTaskSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ success: false, errors: parsed.error.errors });
    }
    const data = await TaskAssignmentService.assign(parseId(req.params.taskId), {
      employeeIds: parsed.data.employee_ids ?? parsed.data.employeeIds,
      assignAll: parsed.data.assign_all ?? parsed.data.assignAll,
      assignedBy: req.user!.id,
    });
    res.json({ success: true, data });
  }),
);

/** قائمة التعيينات */
adminTaskManagementRouter.get(
  '/tasks/:taskId/assignments',
  asyncWrapper(async (req, res) => {
    const data = await TaskAssignmentService.listForTemplate(parseId(req.params.taskId));
    res.json({ success: true, data });
  }),
);

/** إلغاء تعيين */
adminTaskManagementRouter.delete(
  '/tasks/:taskId/assignments/:assignmentId',
  asyncWrapper(async (req, res) => {
    const data = await TaskAssignmentService.cancelAssignment(
      parseId(req.params.assignmentId),
      req.user!.id,
    );
    res.json({ success: true, data });
  }),
);

/** مرفقات القالب */
adminTaskManagementRouter.post(
  '/tasks/:taskId/attachments',
  upload.single('file'),
  asyncWrapper(async (req, res) => {
    if (!req.file) throw new HttpError(400, 'file مطلوب');
    const att = await TaskTemplateService.addAttachment(
      parseId(req.params.taskId),
      {
        fileName: req.file.originalname,
        filePath: `/uploads/task-templates/${req.file.filename}`,
        fileSize: req.file.size,
      },
      req.user!.id,
    );
    res.status(201).json({ success: true, data: att });
  }),
);

adminTaskManagementRouter.get(
  '/tasks/:taskId/attachments',
  asyncWrapper(async (req, res) => {
    const data = await TaskTemplateService.listAttachments(parseId(req.params.taskId));
    res.json({ success: true, data });
  }),
);

/** سجل النشاط */
adminTaskManagementRouter.get(
  '/tasks/:taskId/activity',
  asyncWrapper(async (req, res) => {
    const data = await TaskActivityService.listForTemplate(parseId(req.params.taskId));
    res.json({ success: true, data });
  }),
);
