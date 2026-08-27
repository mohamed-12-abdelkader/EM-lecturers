import pool from '../../../db/pool';
import { HttpError, logger } from '../../../utils';
import { EmployeeService } from '../../../services/employees';
import { platformToday, platformTimezone } from '../utils/time';
import { EmployeeWorkSessionService, serializeWorkSession } from './workSession.service';
import { EmployeeDailyTaskService } from './dailyTask.service';
import { StaffConversationService } from '../../staffChat/services/conversation.service';

export type EmployeeProfile = {
  id: number;
  user_id: number;
  name: string;
  email: string;
  phone: string | null;
  avatar: string | null;
  employee_code: string | null;
  department: string | null;
  job_title: string | null;
  work_start_time: string;
  work_end_time: string;
  is_active: boolean;
  permissions: unknown;
  created_at: Date;
  updated_at: Date;
};

function fmtTime(value: string | null | undefined): string {
  if (!value) return '09:00';
  const m = String(value).match(/^(\d{1,2}):(\d{2})/);
  if (!m) return String(value).slice(0, 5);
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

export function serializeEmployee(row: Record<string, unknown>) {
  return {
    id: row.id,
    user_id: row.user_id,
    name: row.name,
    email: row.email,
    phone: row.phone ?? null,
    avatar: row.avatar ?? null,
    employee_code: row.employee_code ?? null,
    department: row.department ?? null,
    job_title: row.job_title ?? null,
    work_start_time: fmtTime(String(row.work_start_time ?? '09:00')),
    work_end_time: fmtTime(String(row.work_end_time ?? '17:00')),
    status: row.is_active === false ? 'inactive' : 'active',
    is_active: row.is_active !== false,
    permissions: row.permissions ?? {},
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export class EmployeeWorkFacade {
  static async ensureEmployeeColumns() {
    await EmployeeWorkSessionService.ensureSchema();
    await EmployeeDailyTaskService.ensureSchema();
    await pool.query(`CREATE SEQUENCE IF NOT EXISTS employee_code_seq START WITH 1001`);
  }

  /** مزامنة التسلسل مع أعلى كود EMP##### موجود لتفادي التعارض */
  static async syncEmployeeCodeSequence() {
    await this.ensureEmployeeColumns();
    await pool.query(`
      SELECT setval(
        'employee_code_seq',
        GREATEST(
          COALESCE(
            (
              SELECT MAX(SUBSTRING(employee_code FROM 4)::bigint)
              FROM employees
              WHERE employee_code ~ '^EMP[0-9]+$'
            ),
            1000
          ),
          1000
        )
      )
    `);
  }

  static async nextEmployeeCode(): Promise<string> {
    await this.syncEmployeeCodeSequence();
    for (let attempt = 0; attempt < 25; attempt++) {
      const r = await pool.query<{ code: string }>(
        `SELECT 'EMP' || LPAD(nextval('employee_code_seq')::text, 5, '0') AS code`,
      );
      const code = r.rows[0].code;
      const exists = await pool.query(
        `SELECT 1 FROM employees WHERE employee_code = $1 LIMIT 1`,
        [code],
      );
      if (!exists.rowCount) return code;
    }
    throw new HttpError(500, 'تعذر توليد كود موظف فريد');
  }

  static async assertEmployeeCodeAvailable(code: string, excludeEmployeeId?: number) {
    const r = await pool.query(
      `SELECT id FROM employees
       WHERE employee_code = $1
         AND ($2::int IS NULL OR id <> $2)
       LIMIT 1`,
      [code, excludeEmployeeId ?? null],
    );
    if (r.rowCount) {
      throw new HttpError(409, 'كود الموظف مستخدم بالفعل');
    }
  }

  static async getEmployeeRecord(employeeId: number, { activeOnly = false } = {}) {
    await this.ensureEmployeeColumns();
    const r = await pool.query(
      `SELECT e.*, u.account_status
       FROM employees e
       JOIN users u ON u.id = e.user_id
       WHERE e.id = $1 ${activeOnly ? 'AND e.is_active = TRUE' : ''}`,
      [employeeId],
    );
    if (!r.rowCount) throw new HttpError(404, 'الموظف غير موجود');
    return r.rows[0];
  }

  static async getEmployeeByUserId(userId: number, { activeOnly = true } = {}) {
    await this.ensureEmployeeColumns();
    const r = await pool.query(
      `SELECT e.* FROM employees e WHERE e.user_id = $1 ${activeOnly ? 'AND e.is_active = TRUE' : ''}`,
      [userId],
    );
    if (!r.rowCount) throw new HttpError(404, 'سجل الموظف غير موجود');
    return r.rows[0];
  }

  static async requireEmployeeUser(userId: number) {
    const emp = await this.getEmployeeByUserId(userId, { activeOnly: true });
    return emp;
  }

  static async createEmployeeExtended(
    input: {
      name: string;
      email: string;
      password: string;
      phone?: string | null;
      permissions?: string[] | Record<string, unknown>;
      department?: string | null;
      jobTitle?: string | null;
      employeeCode?: string | null;
      workStartTime?: string;
      workEndTime?: string;
    },
    createdBy: number,
    tenantId: number,
  ) {
    await this.ensureEmployeeColumns();
    const permissions = Array.isArray(input.permissions)
      ? input.permissions
      : input.permissions
        ? Object.keys(input.permissions).filter((k) => (input.permissions as any)[k])
        : [];

    const email = input.email.trim().toLowerCase();
    const requestedCode = input.employeeCode?.trim() || null;
    if (requestedCode) {
      await this.assertEmployeeCodeAvailable(requestedCode);
    }

    const existingEmail = await pool.query(
      `SELECT id FROM users
       WHERE tenant_id = $1 AND lower(trim(email)) = $2
       LIMIT 1`,
      [tenantId, email],
    );
    if (existingEmail.rowCount) {
      throw new HttpError(409, 'البريد الإلكتروني مستخدم بالفعل');
    }

    const existingEmpEmail = await pool.query(
      `SELECT id FROM employees WHERE lower(trim(email)) = $1 LIMIT 1`,
      [email],
    );
    if (existingEmpEmail.rowCount) {
      throw new HttpError(409, 'البريد الإلكتروني مستخدم بالفعل لموظف آخر');
    }

    let result;
    try {
      result = await EmployeeService.createEmployee(
        {
          name: input.name,
          email,
          password: input.password,
          phone: input.phone ?? undefined,
          permissions,
        },
        createdBy,
        tenantId,
      );
    } catch (err) {
      const pgCode = (err as { code?: string })?.code;
      const constraint = (err as { constraint?: string })?.constraint || '';
      if (pgCode === '23505') {
        if (constraint.includes('email') || constraint.includes('users_tenant_email')) {
          throw new HttpError(409, 'البريد الإلكتروني مستخدم بالفعل');
        }
        throw new HttpError(409, 'بيانات الموظف متعارضة مع سجل موجود');
      }
      throw err;
    }

    let code = requestedCode || (await this.nextEmployeeCode());
    let updated;
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        updated = await pool.query(
          `UPDATE employees
           SET employee_code = $2,
               department = $3,
               job_title = $4,
               work_start_time = $5::time,
               work_end_time = $6::time,
               updated_at = NOW()
           WHERE id = $1
           RETURNING *`,
          [
            result.employee.id,
            code,
            input.department ?? null,
            input.jobTitle ?? null,
            input.workStartTime || '09:00',
            input.workEndTime || '17:00',
          ],
        );
        break;
      } catch (err) {
        const pgCode = (err as { code?: string })?.code;
        if (pgCode === '23505' && !requestedCode) {
          code = await this.nextEmployeeCode();
          continue;
        }
        if (pgCode === '23505') {
          throw new HttpError(409, 'كود الموظف مستخدم بالفعل');
        }
        throw err;
      }
    }
    if (!updated?.rowCount) {
      throw new HttpError(500, 'تعذر تعيين كود الموظف');
    }

    logger.info({ employee_id: result.employee.id, created_by: createdBy }, 'employee_created');
    try {
      await StaffConversationService.addEmployeeToGroup(result.user.id);
    } catch (err) {
      logger.warn({ err, user_id: result.user.id }, 'staff_chat_add_member_failed');
    }
    return {
      user: result.user,
      employee: serializeEmployee(updated.rows[0]),
    };
  }

  static async updateEmployeeExtended(
    employeeId: number,
    patch: {
      name?: string;
      phone?: string | null;
      permissions?: string[];
      is_active?: boolean;
      department?: string | null;
      job_title?: string | null;
      work_start_time?: string;
      work_end_time?: string;
      employee_code?: string;
    },
  ) {
    await this.ensureEmployeeColumns();
    await this.getEmployeeRecord(employeeId);

    if (patch.employee_code !== undefined) {
      await this.assertEmployeeCodeAvailable(patch.employee_code.trim(), employeeId);
      patch.employee_code = patch.employee_code.trim();
    }

    if (
      patch.name !== undefined ||
      patch.phone !== undefined ||
      patch.permissions !== undefined ||
      patch.is_active !== undefined
    ) {
      await EmployeeService.updateEmployee(employeeId, {
        name: patch.name,
        phone: patch.phone ?? undefined,
        permissions: patch.permissions,
        is_active: patch.is_active,
      });
    }

    const updates: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    const set = (col: string, val: unknown) => {
      updates.push(`${col} = $${i++}`);
      values.push(val);
    };
    if (patch.department !== undefined) set('department', patch.department);
    if (patch.job_title !== undefined) set('job_title', patch.job_title);
    if (patch.work_start_time !== undefined) set('work_start_time', patch.work_start_time);
    if (patch.work_end_time !== undefined) set('work_end_time', patch.work_end_time);
    if (patch.employee_code !== undefined) set('employee_code', patch.employee_code);
    if (patch.name !== undefined) {
      await pool.query(`UPDATE users SET name = $1 WHERE id = (SELECT user_id FROM employees WHERE id = $2)`, [
        patch.name,
        employeeId,
      ]);
    }

    if (updates.length) {
      updates.push('updated_at = NOW()');
      values.push(employeeId);
      await pool.query(
        `UPDATE employees SET ${updates.join(', ')} WHERE id = $${i}`,
        values,
      );
    }

    if (patch.is_active === false) {
      logger.info({ employee_id: employeeId }, 'employee_deactivated');
      try {
        const emp = await this.getEmployeeRecord(employeeId);
        await StaffConversationService.deactivateEmployeeInGroup(emp.user_id);
      } catch (err) {
        logger.warn({ err, employee_id: employeeId }, 'staff_chat_deactivate_failed');
      }
    } else if (patch.is_active === true) {
      logger.info({ employee_id: employeeId }, 'employee_activated');
      try {
        const emp = await this.getEmployeeRecord(employeeId);
        await StaffConversationService.addEmployeeToGroup(emp.user_id);
      } catch (err) {
        logger.warn({ err, employee_id: employeeId }, 'staff_chat_reactivate_failed');
      }
    } else {
      logger.info({ employee_id: employeeId }, 'employee_updated');
    }

    return serializeEmployee(await this.getEmployeeRecord(employeeId));
  }

  static async listEmployees(opts: {
    search?: string;
    status?: 'active' | 'inactive' | 'all';
    page?: number;
    limit?: number;
  } = {}) {
    await this.ensureEmployeeColumns();
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(100, Math.max(1, opts.limit ?? 20));
    const offset = (page - 1) * limit;
    const params: unknown[] = [];
    let where = 'TRUE';
    if (opts.status === 'active' || !opts.status) {
      where += ' AND e.is_active = TRUE';
    } else if (opts.status === 'inactive') {
      where += ' AND e.is_active = FALSE';
    }
    if (opts.search?.trim()) {
      params.push(`%${opts.search.trim()}%`);
      where += ` AND (e.name ILIKE $${params.length} OR e.email ILIKE $${params.length} OR e.employee_code ILIKE $${params.length})`;
    }
    const count = await pool.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM employees e WHERE ${where}`,
      params,
    );
    params.push(limit, offset);
    const rows = await pool.query(
      `SELECT e.* FROM employees e
       WHERE ${where}
       ORDER BY e.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return {
      items: rows.rows.map(serializeEmployee),
      pagination: {
        page,
        limit,
        total: Number(count.rows[0]?.c ?? 0),
        total_pages: Math.ceil(Number(count.rows[0]?.c ?? 0) / limit) || 1,
      },
    };
  }

  static async getTodayDashboard(employeeId: number) {
    const emp = serializeEmployee(await this.getEmployeeRecord(employeeId));
    const today = platformToday();
    const session = await EmployeeWorkSessionService.getByEmployeeAndDate(employeeId, today);
    const tasksResult = await EmployeeDailyTaskService.listTasks(employeeId, {
      taskDate: today,
      page: 1,
      limit: 200,
    });
    const tasks = tasksResult.items;
    const stats = EmployeeDailyTaskService.buildTaskStats(tasks);
    const inProgress = tasks.find((t) => t.status === 'in_progress') ?? null;

    return {
      employee: emp,
      work_session: serializeWorkSession(session),
      tasks,
      statistics: {
        total: stats.total,
        completed: stats.completed,
        in_progress: stats.in_progress,
        pending: stats.pending,
        cancelled: stats.cancelled,
        completion_percentage: stats.completion_percentage,
      },
      in_progress_task: inProgress,
      date: today,
    };
  }

  static async startWorkDay(employeeId: number) {
    const workSession = await EmployeeWorkSessionService.startWork(employeeId);
    const today = platformToday();
    const tasks = await EmployeeDailyTaskService.listTasks(employeeId, {
      taskDate: today,
      page: 1,
      limit: 200,
    });
    return {
      work_session: workSession,
      tasks: tasks.items,
    };
  }

  static async adminWorkStatus(date?: string) {
    await this.ensureEmployeeColumns();
    const workDate = date || platformToday();
    const employees = await pool.query(
      `SELECT e.* FROM employees e WHERE e.is_active = TRUE ORDER BY e.name`,
    );

    const items = [];
    for (const emp of employees.rows) {
      const session = await EmployeeWorkSessionService.getByEmployeeAndDate(emp.id, workDate);
      const tasks = await EmployeeDailyTaskService.listTasks(emp.id, {
        taskDate: workDate,
        page: 1,
        limit: 500,
      });
      const stats = EmployeeDailyTaskService.buildTaskStats(tasks.items);
      let presence: string = 'not_started';
      if (session?.status === 'working') presence = 'working';
      else if (session?.status === 'completed') presence = 'completed';
      else if (session?.start_status === 'late') presence = 'late';
      else if (!session) presence = 'absent_or_not_started';

      items.push({
        employee: serializeEmployee(emp),
        work_session: serializeWorkSession(session),
        presence,
        tasks_statistics: stats,
      });
    }

    return {
      date: workDate,
      summary: {
        total_employees: items.length,
        working: items.filter((i) => i.presence === 'working').length,
        completed: items.filter((i) => i.presence === 'completed').length,
        not_started: items.filter((i) => i.presence === 'absent_or_not_started' || i.presence === 'not_started')
          .length,
        late: items.filter((i) => i.work_session?.start_status === 'late').length,
      },
      employees: items,
    };
  }

  /**
   * تقرير أداء جميع الموظفين لفترة زمنية:
   * نسب التأخير، الحضور، اكتمال وتسليم المهام.
   */
  static async performanceReport(opts: {
    startDate: string;
    endDate: string;
    status?: 'active' | 'inactive' | 'all';
    search?: string;
  }) {
    await this.ensureEmployeeColumns();
    const { startDate, endDate } = opts;
    if (startDate > endDate) {
      throw new HttpError(400, 'startDate يجب أن يكون قبل أو يساوي endDate');
    }

    const params: unknown[] = [];
    let where = 'TRUE';
    if (opts.status === 'active' || !opts.status) {
      where += ' AND e.is_active = TRUE';
    } else if (opts.status === 'inactive') {
      where += ' AND e.is_active = FALSE';
    }
    if (opts.search?.trim()) {
      params.push(`%${opts.search.trim()}%`);
      where += ` AND (e.name ILIKE $${params.length} OR e.email ILIKE $${params.length} OR e.employee_code ILIKE $${params.length})`;
    }

    const employees = await pool.query(`SELECT e.* FROM employees e WHERE ${where} ORDER BY e.name`, params);

    const attendanceAgg = await pool.query<{
      employee_id: number;
      sessions_count: string;
      completed_days: string;
      late_days: string;
      on_time_days: string;
      early_days: string;
      early_leave_days: string;
      overtime_days: string;
      avg_worked_minutes: string | null;
    }>(
      `SELECT
         employee_id,
         COUNT(*)::text AS sessions_count,
         COUNT(*) FILTER (WHERE status = 'completed')::text AS completed_days,
         COUNT(*) FILTER (WHERE start_status = 'late')::text AS late_days,
         COUNT(*) FILTER (WHERE start_status = 'on_time')::text AS on_time_days,
         COUNT(*) FILTER (WHERE start_status = 'early')::text AS early_days,
         COUNT(*) FILTER (WHERE end_status = 'early_leave')::text AS early_leave_days,
         COUNT(*) FILTER (WHERE end_status = 'overtime')::text AS overtime_days,
         ROUND(AVG(worked_minutes) FILTER (WHERE worked_minutes IS NOT NULL))::text AS avg_worked_minutes
       FROM employee_work_sessions
       WHERE work_date >= $1::date AND work_date <= $2::date
       GROUP BY employee_id`,
      [startDate, endDate],
    );
    const attMap = new Map(attendanceAgg.rows.map((r) => [r.employee_id, r]));

    const tz = platformTimezone();
    const tasksAgg = await pool.query<{
      employee_id: number;
      total: string;
      completed: string;
      pending: string;
      in_progress: string;
      cancelled: string;
      delivered_on_time: string;
      avg_completion_minutes: string | null;
    }>(
      `SELECT
         employee_id,
         COUNT(*)::text AS total,
         COUNT(*) FILTER (WHERE status = 'completed')::text AS completed,
         COUNT(*) FILTER (WHERE status = 'pending')::text AS pending,
         COUNT(*) FILTER (WHERE status = 'in_progress')::text AS in_progress,
         COUNT(*) FILTER (WHERE status = 'cancelled')::text AS cancelled,
         COUNT(*) FILTER (
           WHERE status = 'completed'
             AND completed_at IS NOT NULL
             AND (timezone($3, completed_at))::date <= task_date
         )::text AS delivered_on_time,
         ROUND(
           AVG(
             EXTRACT(EPOCH FROM (completed_at - started_at)) / 60.0
           ) FILTER (WHERE status = 'completed' AND started_at IS NOT NULL AND completed_at IS NOT NULL)
         )::text AS avg_completion_minutes
       FROM employee_daily_tasks
       WHERE task_date >= $1::date AND task_date <= $2::date
       GROUP BY employee_id`,
      [startDate, endDate, tz],
    );
    const taskMap = new Map(tasksAgg.rows.map((r) => [r.employee_id, r]));

    const pct = (part: number, whole: number) =>
      whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;

    const employeesReport = employees.rows.map((emp) => {
      const att = attMap.get(emp.id);
      const task = taskMap.get(emp.id);

      const sessions = Number(att?.sessions_count ?? 0);
      const lateDays = Number(att?.late_days ?? 0);
      const onTimeDays = Number(att?.on_time_days ?? 0);
      const earlyDays = Number(att?.early_days ?? 0);
      const earlyLeaveDays = Number(att?.early_leave_days ?? 0);
      const overtimeDays = Number(att?.overtime_days ?? 0);
      const completedDays = Number(att?.completed_days ?? 0);

      const totalTasks = Number(task?.total ?? 0);
      const completedTasks = Number(task?.completed ?? 0);
      const pendingTasks = Number(task?.pending ?? 0);
      const inProgressTasks = Number(task?.in_progress ?? 0);
      const cancelledTasks = Number(task?.cancelled ?? 0);
      const deliveredOnTime = Number(task?.delivered_on_time ?? 0);
      const actionableTasks = totalTasks - cancelledTasks;

      return {
        employee: serializeEmployee(emp),
        attendance: {
          sessions_count: sessions,
          completed_days: completedDays,
          late_days: lateDays,
          on_time_days: onTimeDays,
          early_days: earlyDays,
          early_leave_days: earlyLeaveDays,
          overtime_days: overtimeDays,
          late_percentage: pct(lateDays, sessions),
          on_time_percentage: pct(onTimeDays, sessions),
          early_percentage: pct(earlyDays, sessions),
          early_leave_percentage: pct(earlyLeaveDays, sessions),
          overtime_percentage: pct(overtimeDays, sessions),
          avg_worked_minutes: att?.avg_worked_minutes != null ? Number(att.avg_worked_minutes) : null,
        },
        tasks: {
          total: totalTasks,
          completed: completedTasks,
          pending: pendingTasks,
          in_progress: inProgressTasks,
          cancelled: cancelledTasks,
          delivered_on_time: deliveredOnTime,
          completion_percentage: pct(completedTasks, actionableTasks || totalTasks),
          delivery_percentage: pct(deliveredOnTime, completedTasks),
          pending_percentage: pct(pendingTasks, totalTasks),
          avg_completion_minutes:
            task?.avg_completion_minutes != null ? Number(task.avg_completion_minutes) : null,
        },
      };
    });

    const n = employeesReport.length || 1;
    const summary = {
      employees_count: employeesReport.length,
      avg_late_percentage:
        Math.round(
          (employeesReport.reduce((s, e) => s + e.attendance.late_percentage, 0) / n) * 10,
        ) / 10,
      avg_completion_percentage:
        Math.round(
          (employeesReport.reduce((s, e) => s + e.tasks.completion_percentage, 0) / n) * 10,
        ) / 10,
      avg_delivery_percentage:
        Math.round(
          (employeesReport.reduce((s, e) => s + e.tasks.delivery_percentage, 0) / n) * 10,
        ) / 10,
      total_tasks: employeesReport.reduce((s, e) => s + e.tasks.total, 0),
      total_completed_tasks: employeesReport.reduce((s, e) => s + e.tasks.completed, 0),
      total_late_days: employeesReport.reduce((s, e) => s + e.attendance.late_days, 0),
    };

    return {
      period: { start_date: startDate, end_date: endDate },
      summary,
      employees: employeesReport,
    };
  }

  static async dailyReport(employeeId: number, date: string) {
    const emp = serializeEmployee(await this.getEmployeeRecord(employeeId));
    const session = await EmployeeWorkSessionService.getByEmployeeAndDate(employeeId, date);
    const tasks = await EmployeeDailyTaskService.listTasks(employeeId, {
      taskDate: date,
      page: 1,
      limit: 500,
    });
    const stats = EmployeeDailyTaskService.buildTaskStats(tasks.items);
    const serialized = serializeWorkSession(session);

    return {
      date,
      employee: emp,
      attendance: serialized
        ? {
            scheduled_start: serialized.scheduled_start_time,
            actual_start: serialized.actual_start_time,
            scheduled_end: serialized.scheduled_end_time,
            actual_end: serialized.actual_end_time,
            worked_duration: serialized.worked_duration,
            worked_minutes: serialized.worked_minutes,
            lateness_minutes: serialized.lateness_minutes,
            early_leave_minutes: serialized.early_leave_minutes,
            overtime_minutes: serialized.overtime_minutes,
            start_status: serialized.start_status,
            end_status: serialized.end_status,
            status: serialized.status,
          }
        : null,
      tasks: {
        ...stats,
        details: tasks.items,
      },
      overall: {
        completion_percentage: stats.completion_percentage,
      },
    };
  }
}
