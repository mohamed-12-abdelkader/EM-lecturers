import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { authMiddleware } from '../../../middleware/authentication';
import { asyncWrapper, HttpError } from '../../../utils';
import { EmployeeWorkFacade } from '../../employeeWork/services/employeeWork.facade';
import { platformToday } from '../../employeeWork/utils/time';
import { weekStartDate } from '../utils/period';
import { TaskInstanceService } from '../services/instance.service';
import { AddNoteSchema, CompleteInstanceSchema } from '../validators';

export const employeeMyTasksRouter = Router();

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      const dir = 'uploads/task-instances';
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      cb(null, `inst-${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
});

employeeMyTasksRouter.use(authMiddleware(['employee']));

async function currentEmployee(req: { user?: { id: number } }) {
  if (!req.user?.id) throw new HttpError(401, 'غير مصرح');
  return EmployeeWorkFacade.requireEmployeeUser(req.user.id);
}

function parseId(v: string) {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'معرف غير صالح');
  return n;
}

/** My Tasks — لوحة مهامي */
employeeMyTasksRouter.get(
  '/',
  asyncWrapper(async (req, res) => {
    const emp = await currentEmployee(req);
    const data = await TaskInstanceService.getEmployeeDashboard(emp.id);
    res.json({ success: true, data });
  }),
);

/** مهام اليوم */
employeeMyTasksRouter.get(
  '/daily',
  asyncWrapper(async (req, res) => {
    const emp = await currentEmployee(req);
    const date =
      typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
        ? req.query.date
        : undefined;
    const data = await TaskInstanceService.listForEmployee(emp.id, {
      instanceType: 'daily',
      periodStart: date ?? platformToday(),
    });
    res.json({ success: true, data });
  }),
);

/** مهام الأسبوع */
employeeMyTasksRouter.get(
  '/weekly',
  asyncWrapper(async (req, res) => {
    const emp = await currentEmployee(req);
    const week =
      typeof req.query.week === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.week)
        ? req.query.week
        : weekStartDate(platformToday());
    const data = await TaskInstanceService.listForEmployee(emp.id, {
      instanceType: 'weekly',
      periodStart: week,
    });
    res.json({ success: true, data });
  }),
);

/** المهام المتأخرة */
employeeMyTasksRouter.get(
  '/overdue',
  asyncWrapper(async (req, res) => {
    const emp = await currentEmployee(req);
    const data = await TaskInstanceService.listForEmployee(emp.id, { status: 'overdue_group' });
    res.json({ success: true, data });
  }),
);

/** المهام المكتملة */
employeeMyTasksRouter.get(
  '/completed',
  asyncWrapper(async (req, res) => {
    const emp = await currentEmployee(req);
    const data = await TaskInstanceService.listForEmployee(emp.id, {
      status: 'completed',
      startDate: typeof req.query.startDate === 'string' ? req.query.startDate : undefined,
      endDate: typeof req.query.endDate === 'string' ? req.query.endDate : undefined,
    });
    res.json({ success: true, data });
  }),
);

/** تفاصيل instance */
employeeMyTasksRouter.get(
  '/instances/:instanceId',
  asyncWrapper(async (req, res) => {
    const emp = await currentEmployee(req);
    const data = await TaskInstanceService.getInstanceDetail(parseId(req.params.instanceId), emp.id);
    res.json({ success: true, data });
  }),
);

/** بدء المهمة */
employeeMyTasksRouter.post(
  '/instances/:instanceId/start',
  asyncWrapper(async (req, res) => {
    const emp = await currentEmployee(req);
    const data = await TaskInstanceService.startInstance(
      parseId(req.params.instanceId),
      emp.id,
      req.user!.id,
    );
    res.json({ success: true, data });
  }),
);

/** إتمام المهمة */
employeeMyTasksRouter.post(
  '/instances/:instanceId/complete',
  asyncWrapper(async (req, res) => {
    const emp = await currentEmployee(req);
    const parsed = CompleteInstanceSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ success: false, errors: parsed.error.errors });
    }
    const data = await TaskInstanceService.completeInstance(
      parseId(req.params.instanceId),
      emp.id,
      req.user!.id,
      parsed.data.employee_notes ?? parsed.data.employeeNotes,
    );
    res.json({ success: true, message: 'تم إتمام المهمة', data });
  }),
);

/** ملاحظة */
employeeMyTasksRouter.post(
  '/instances/:instanceId/notes',
  asyncWrapper(async (req, res) => {
    const emp = await currentEmployee(req);
    const parsed = AddNoteSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ success: false, errors: parsed.error.errors });
    }
    const data = await TaskInstanceService.addNote(
      parseId(req.params.instanceId),
      emp.id,
      req.user!.id,
      parsed.data.note,
    );
    res.status(201).json({ success: true, data });
  }),
);

/** مرفق */
employeeMyTasksRouter.post(
  '/instances/:instanceId/attachments',
  upload.single('file'),
  asyncWrapper(async (req, res) => {
    if (!req.file) throw new HttpError(400, 'file مطلوب');
    const emp = await currentEmployee(req);
    const data = await TaskInstanceService.addAttachment(
      parseId(req.params.instanceId),
      emp.id,
      req.user!.id,
      {
        fileName: req.file.originalname,
        filePath: `/uploads/task-instances/${req.file.filename}`,
        fileSize: req.file.size,
      },
    );
    res.status(201).json({ success: true, data });
  }),
);
