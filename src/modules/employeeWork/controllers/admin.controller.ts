import { Router } from 'express';
import { authMiddleware } from '../../../middleware/authentication';
import { asyncWrapper, HttpError } from '../../../utils';
import { EmployeeWorkFacade } from '../services/employeeWork.facade';
import { EmployeeWorkSessionService } from '../services/workSession.service';
import { EmployeeDailyTaskService } from '../services/dailyTask.service';
import {
  CompleteTaskSchema,
  CreateDailyTaskSchema,
  CreateEmployeeSchema,
  DateRangeQuerySchema,
  ReorderTasksSchema,
  UpdateDailyTaskSchema,
  UpdateEmployeeSchema,
} from '../validators';

export const adminEmployeeWorkRouter = Router();

function parseId(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'معرف غير صالح');
  return n;
}

function rangeFromQuery(query: Record<string, unknown>) {
  const parsed = DateRangeQuerySchema.safeParse(query);
  if (!parsed.success) {
    throw new HttpError(400, 'معاملات البحث غير صالحة');
  }
  return {
    startDate: parsed.data.startDate || parsed.data.start_date,
    endDate: parsed.data.endDate || parsed.data.end_date,
    page: parsed.data.page,
    limit: parsed.data.limit,
    status: parsed.data.status,
    priority: parsed.data.priority,
    date: parsed.data.date,
    search: parsed.data.search,
  };
}

adminEmployeeWorkRouter.use(authMiddleware(['admin']));

/** حالة دوام كل الموظفين اليوم */
adminEmployeeWorkRouter.get(
  '/work-status',
  asyncWrapper(async (req, res) => {
    const date =
      typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
        ? req.query.date
        : undefined;
    const data = await EmployeeWorkFacade.adminWorkStatus(date);
    res.json({ success: true, data });
  }),
);

/**
 * تقرير أداء الموظفين لفترة زمنية
 * نسب التأخير / الحضور / اكتمال وتسليم المهام
 * Query: startDate, endDate (مطلوبان), status=active|inactive|all, search
 */
adminEmployeeWorkRouter.get(
  '/performance-report',
  asyncWrapper(async (req, res) => {
    const startDate =
      typeof req.query.startDate === 'string'
        ? req.query.startDate
        : typeof req.query.start_date === 'string'
          ? req.query.start_date
          : null;
    const endDate =
      typeof req.query.endDate === 'string'
        ? req.query.endDate
        : typeof req.query.end_date === 'string'
          ? req.query.end_date
          : null;
    if (!startDate || !endDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      throw new HttpError(400, 'startDate و endDate مطلوبان بصيغة YYYY-MM-DD');
    }
    const status =
      req.query.status === 'inactive'
        ? 'inactive'
        : req.query.status === 'all'
          ? 'all'
          : 'active';
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    const data = await EmployeeWorkFacade.performanceReport({
      startDate,
      endDate,
      status,
      search,
    });
    res.json({ success: true, data });
  }),
);

/** قائمة موظفين مع pagination */
adminEmployeeWorkRouter.get(
  '/',
  asyncWrapper(async (req, res) => {
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    const page = Number(req.query.page) > 0 ? Number(req.query.page) : 1;
    const limit = Number(req.query.limit) > 0 ? Number(req.query.limit) : 20;
    const status =
      req.query.status === 'inactive'
        ? 'inactive'
        : req.query.status === 'all'
          ? 'all'
          : 'active';
    const data = await EmployeeWorkFacade.listEmployees({
      search,
      status,
      page,
      limit,
    });
    res.json({ success: true, data });
  }),
);

/** إنشاء موظف */
adminEmployeeWorkRouter.post(
  '/',
  asyncWrapper(async (req, res) => {
    const parsed = CreateEmployeeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, errors: parsed.error.errors });
    }
    const tenantId = req.tenant?.id;
    if (!tenantId) throw new HttpError(400, 'تعذر تحديد المنصة');

    const data = await EmployeeWorkFacade.createEmployeeExtended(
      {
        name: parsed.data.name,
        email: parsed.data.email,
        password: parsed.data.password,
        phone: parsed.data.phone,
        permissions: parsed.data.permissions,
        department: parsed.data.department,
        jobTitle: parsed.data.job_title,
        employeeCode: parsed.data.employee_code,
        workStartTime: parsed.data.work_start_time,
        workEndTime: parsed.data.work_end_time,
      },
      req.user!.id,
      tenantId,
    );
    res.status(201).json({ success: true, message: 'تم إنشاء الموظف بنجاح', data });
  }),
);

/** تفاصيل موظف */
adminEmployeeWorkRouter.get(
  '/:employeeId',
  asyncWrapper(async (req, res) => {
    const employeeId = parseId(req.params.employeeId);
    const q = rangeFromQuery(req.query as Record<string, unknown>);
    const employee = await EmployeeWorkFacade.getEmployeeRecord(employeeId);
    const today = await EmployeeWorkFacade.getTodayDashboard(employeeId);
    const attendance = await EmployeeWorkSessionService.listAttendance(employeeId, {
      page: q.page ?? 1,
      limit: q.limit ?? 14,
    });
    const tasks = await EmployeeDailyTaskService.listTasks(employeeId, {
      page: 1,
      limit: 30,
    });
    res.json({
      success: true,
      data: {
        employee: today.employee,
        work_schedule: {
          work_start_time: today.employee.work_start_time,
          work_end_time: today.employee.work_end_time,
        },
        today: {
          work_session: today.work_session,
          tasks: today.tasks,
          statistics: today.statistics,
        },
        recent_tasks: tasks.items,
        attendance_history: attendance,
        raw_permissions: employee.permissions,
      },
    });
  }),
);

/** تعديل موظف */
adminEmployeeWorkRouter.put(
  '/:employeeId',
  asyncWrapper(async (req, res) => {
    const employeeId = parseId(req.params.employeeId);
    const parsed = UpdateEmployeeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, errors: parsed.error.errors });
    }
    const isActive =
      parsed.data.is_active ??
      (parsed.data.status === 'active' ? true : parsed.data.status === 'inactive' ? false : undefined);
    const data = await EmployeeWorkFacade.updateEmployeeExtended(employeeId, {
      ...parsed.data,
      is_active: isActive,
    });
    res.json({ success: true, message: 'تم تحديث الموظف', data });
  }),
);

adminEmployeeWorkRouter.patch(
  '/:employeeId',
  asyncWrapper(async (req, res) => {
    const employeeId = parseId(req.params.employeeId);
    const parsed = UpdateEmployeeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, errors: parsed.error.errors });
    }
    const isActive =
      parsed.data.is_active ??
      (parsed.data.status === 'active' ? true : parsed.data.status === 'inactive' ? false : undefined);
    const data = await EmployeeWorkFacade.updateEmployeeExtended(employeeId, {
      ...parsed.data,
      is_active: isActive,
    });
    res.json({ success: true, message: 'تم تحديث الموظف', data });
  }),
);

/** تعطيل موظف */
adminEmployeeWorkRouter.delete(
  '/:employeeId',
  asyncWrapper(async (req, res) => {
    const employeeId = parseId(req.params.employeeId);
    const data = await EmployeeWorkFacade.updateEmployeeExtended(employeeId, { is_active: false });
    res.json({ success: true, message: 'تم تعطيل الموظف', data });
  }),
);

/** مهام موظف — قائمة / إنشاء */
adminEmployeeWorkRouter.get(
  '/:employeeId/tasks',
  asyncWrapper(async (req, res) => {
    const employeeId = parseId(req.params.employeeId);
    const q = rangeFromQuery(req.query as Record<string, unknown>);
    const data = await EmployeeDailyTaskService.listTasks(employeeId, {
      taskDate: q.date,
      startDate: q.startDate,
      endDate: q.endDate,
      status: q.status,
      priority: q.priority,
      page: q.page,
      limit: q.limit,
    });
    res.json({ success: true, data });
  }),
);

adminEmployeeWorkRouter.post(
  '/:employeeId/tasks',
  asyncWrapper(async (req, res) => {
    const employeeId = parseId(req.params.employeeId);
    const parsed = CreateDailyTaskSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, errors: parsed.error.errors });
    }
    const data = await EmployeeDailyTaskService.createTask({
      employeeId,
      title: parsed.data.title,
      description: parsed.data.description,
      taskDate: parsed.data.task_date,
      priority: parsed.data.priority,
      order: parsed.data.order,
      createdBy: req.user!.id,
    });
    res.status(201).json({ success: true, message: 'تم إنشاء المهمة', data });
  }),
);

adminEmployeeWorkRouter.patch(
  '/:employeeId/tasks/reorder',
  asyncWrapper(async (req, res) => {
    const employeeId = parseId(req.params.employeeId);
    const parsed = ReorderTasksSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, errors: parsed.error.errors });
    }
    const data = await EmployeeDailyTaskService.reorderTasks(
      employeeId,
      parsed.data.task_date,
      parsed.data.ordered_ids,
    );
    res.json({ success: true, message: 'تم إعادة ترتيب المهام', data });
  }),
);

/** تقرير المهام — قبل :taskId لتفادي التعارض */
adminEmployeeWorkRouter.get(
  '/:employeeId/tasks/report',
  asyncWrapper(async (req, res) => {
    const employeeId = parseId(req.params.employeeId);
    const q = rangeFromQuery(req.query as Record<string, unknown>);
    const data = await EmployeeDailyTaskService.tasksReport(employeeId, {
      startDate: q.startDate,
      endDate: q.endDate,
      status: q.status,
      priority: q.priority,
    });
    res.json({ success: true, data });
  }),
);

/** تفاصيل مهمة (مع التقرير إن أُنجزت) */
adminEmployeeWorkRouter.get(
  '/:employeeId/tasks/:taskId',
  asyncWrapper(async (req, res) => {
    const employeeId = parseId(req.params.employeeId);
    const taskId = parseId(req.params.taskId);
    const data = await EmployeeDailyTaskService.getTaskDetail(taskId, employeeId);
    res.json({ success: true, data });
  }),
);

adminEmployeeWorkRouter.patch(
  '/:employeeId/tasks/:taskId',
  asyncWrapper(async (req, res) => {
    const employeeId = parseId(req.params.employeeId);
    const taskId = parseId(req.params.taskId);
    const parsed = UpdateDailyTaskSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, errors: parsed.error.errors });
    }
    const data = await EmployeeDailyTaskService.updateTask(taskId, employeeId, {
      title: parsed.data.title,
      description: parsed.data.description,
      taskDate: parsed.data.task_date,
      priority: parsed.data.priority,
      order: parsed.data.order,
      status: parsed.data.status,
    });
    res.json({ success: true, message: 'تم تحديث المهمة', data });
  }),
);

adminEmployeeWorkRouter.delete(
  '/:employeeId/tasks/:taskId',
  asyncWrapper(async (req, res) => {
    const employeeId = parseId(req.params.employeeId);
    const taskId = parseId(req.params.taskId);
    await EmployeeDailyTaskService.deleteTask(taskId, employeeId);
    res.json({ success: true, message: 'تم حذف المهمة' });
  }),
);

adminEmployeeWorkRouter.get(
  '/:employeeId/attendance',
  asyncWrapper(async (req, res) => {
    const employeeId = parseId(req.params.employeeId);
    const q = rangeFromQuery(req.query as Record<string, unknown>);
    const data = await EmployeeWorkSessionService.listAttendance(employeeId, {
      startDate: q.startDate,
      endDate: q.endDate,
      page: q.page,
      limit: q.limit,
    });
    res.json({ success: true, data });
  }),
);

adminEmployeeWorkRouter.get(
  '/:employeeId/daily-report',
  asyncWrapper(async (req, res) => {
    const employeeId = parseId(req.params.employeeId);
    const date =
      typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
        ? req.query.date
        : null;
    if (!date) throw new HttpError(400, 'date مطلوب بصيغة YYYY-MM-DD');
    const data = await EmployeeWorkFacade.dailyReport(employeeId, date);
    res.json({ success: true, data });
  }),
);

adminEmployeeWorkRouter.get(
  '/:employeeId/reports',
  asyncWrapper(async (req, res) => {
    const employeeId = parseId(req.params.employeeId);
    const q = rangeFromQuery(req.query as Record<string, unknown>);
    const attendance = await EmployeeWorkSessionService.listAttendance(employeeId, {
      startDate: q.startDate,
      endDate: q.endDate,
      page: 1,
      limit: 100,
    });
    const tasks = await EmployeeDailyTaskService.tasksReport(employeeId, {
      startDate: q.startDate,
      endDate: q.endDate,
    });
    res.json({
      success: true,
      data: {
        attendance: attendance.items,
        tasks,
      },
    });
  }),
);
