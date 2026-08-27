import { Router } from 'express';
import { authMiddleware } from '../../../middleware/authentication';
import { asyncWrapper, HttpError } from '../../../utils';
import { EmployeeWorkFacade } from '../services/employeeWork.facade';
import { EmployeeWorkSessionService } from '../services/workSession.service';
import { EmployeeDailyTaskService } from '../services/dailyTask.service';
import { CompleteTaskSchema, DateRangeQuerySchema } from '../validators';

export const employeePortalRouter = Router();

employeePortalRouter.use(authMiddleware(['employee']));

async function currentEmployee(req: { user?: { id: number } }) {
  if (!req.user?.id) throw new HttpError(401, 'غير مصرح');
  return EmployeeWorkFacade.requireEmployeeUser(req.user.id);
}

function parseId(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'معرف غير صالح');
  return n;
}

/** لوحة اليوم */
employeePortalRouter.get(
  '/today',
  asyncWrapper(async (req, res) => {
    const emp = await currentEmployee(req);
    const data = await EmployeeWorkFacade.getTodayDashboard(emp.id);
    res.json({ success: true, data });
  }),
);

/** بياناتي */
employeePortalRouter.get(
  '/me',
  asyncWrapper(async (req, res) => {
    const emp = await currentEmployee(req);
    const data = await EmployeeWorkFacade.getTodayDashboard(emp.id);
    res.json({
      success: true,
      data: {
        employee: data.employee,
        work_schedule: {
          work_start_time: data.employee.work_start_time,
          work_end_time: data.employee.work_end_time,
        },
      },
    });
  }),
);

/** بدء العمل */
employeePortalRouter.post(
  '/work/start',
  asyncWrapper(async (req, res) => {
    const emp = await currentEmployee(req);
    const data = await EmployeeWorkFacade.startWorkDay(emp.id);
    res.json({ success: true, message: 'تم بدء يوم العمل', data });
  }),
);

/** إنهاء العمل */
employeePortalRouter.post(
  '/work/end',
  asyncWrapper(async (req, res) => {
    const emp = await currentEmployee(req);
    const workSession = await EmployeeWorkSessionService.endWork(emp.id);
    res.json({ success: true, message: 'تم إنهاء يوم العمل', data: { work_session: workSession } });
  }),
);

/** مهامي */
employeePortalRouter.get(
  '/tasks',
  asyncWrapper(async (req, res) => {
    const emp = await currentEmployee(req);
    const parsed = DateRangeQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ success: false, errors: parsed.error.errors });
    }
    const data = await EmployeeDailyTaskService.listTasks(emp.id, {
      taskDate: parsed.data.date,
      startDate: parsed.data.startDate || parsed.data.start_date,
      endDate: parsed.data.endDate || parsed.data.end_date,
      status: parsed.data.status,
      priority: parsed.data.priority,
      page: parsed.data.page,
      limit: parsed.data.limit,
    });
    res.json({ success: true, data });
  }),
);

/** تفاصيل مهمة (مع التقرير إن أُنجزت) */
employeePortalRouter.get(
  '/tasks/:taskId',
  asyncWrapper(async (req, res) => {
    const emp = await currentEmployee(req);
    const taskId = parseId(req.params.taskId);
    const data = await EmployeeDailyTaskService.getTaskDetail(taskId, emp.id);
    res.json({ success: true, data });
  }),
);

/** بدء مهمة */
employeePortalRouter.post(
  '/tasks/:taskId/start',
  asyncWrapper(async (req, res) => {
    const emp = await currentEmployee(req);
    const taskId = parseId(req.params.taskId);
    const data = await EmployeeDailyTaskService.startTask(taskId, emp.id);
    res.json({ success: true, message: 'تم بدء المهمة', data });
  }),
);

/** إكمال مهمة */
employeePortalRouter.post(
  '/tasks/:taskId/complete',
  asyncWrapper(async (req, res) => {
    const emp = await currentEmployee(req);
    const taskId = parseId(req.params.taskId);
    const parsed = CompleteTaskSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, errors: parsed.error.errors });
    }
    const report = (parsed.data.completion_report || parsed.data.completionReport || '').trim();
    const data = await EmployeeDailyTaskService.completeTask(taskId, emp.id, report);
    res.json({ success: true, message: 'تم إكمال المهمة', data });
  }),
);

/** سجل حضوري */
employeePortalRouter.get(
  '/attendance',
  asyncWrapper(async (req, res) => {
    const emp = await currentEmployee(req);
    const parsed = DateRangeQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ success: false, errors: parsed.error.errors });
    }
    const data = await EmployeeWorkSessionService.listAttendance(emp.id, {
      startDate: parsed.data.startDate || parsed.data.start_date,
      endDate: parsed.data.endDate || parsed.data.end_date,
      page: parsed.data.page,
      limit: parsed.data.limit,
    });
    res.json({ success: true, data });
  }),
);
