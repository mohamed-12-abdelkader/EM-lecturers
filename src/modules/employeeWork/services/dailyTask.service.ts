import pool from '../../../db/pool';
import { HttpError, logger } from '../../../utils';
import { platformToday, toDateString } from '../utils/time';

export type DailyTaskPriority = 'low' | 'medium' | 'high' | 'urgent';
export type DailyTaskStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

export type DailyTaskRow = {
  id: number;
  employee_id: number;
  title: string;
  description: string | null;
  task_date: string;
  priority: DailyTaskPriority;
  sort_order: number;
  status: DailyTaskStatus;
  started_at: Date | string | null;
  completed_at: Date | string | null;
  completion_report: string | null;
  created_by: number;
  created_at: Date;
  updated_at: Date;
  created_by_name?: string;
};

export function serializeDailyTask(row: DailyTaskRow) {
  const started = row.started_at ? new Date(row.started_at) : null;
  const completed = row.completed_at ? new Date(row.completed_at) : null;
  const durationMinutes =
    started && completed
      ? Math.max(0, Math.round((completed.getTime() - started.getTime()) / 60000))
      : null;
  return {
    id: row.id,
    employee_id: row.employee_id,
    title: row.title,
    description: row.description,
    task_date: toDateString(row.task_date),
    priority: row.priority,
    order: row.sort_order,
    status: row.status,
    started_at: row.started_at,
    completed_at: row.completed_at,
    duration_minutes: durationMinutes,
    completion_report: row.completion_report,
    created_by: row.created_by,
    created_by_name: row.created_by_name ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export class EmployeeDailyTaskService {
  static async ensureSchema() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS employee_daily_tasks (
        id SERIAL PRIMARY KEY,
        employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT,
        task_date DATE NOT NULL,
        priority VARCHAR(20) NOT NULL DEFAULT 'medium',
        sort_order INTEGER NOT NULL DEFAULT 1,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        started_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ,
        completion_report TEXT,
        created_by INTEGER NOT NULL REFERENCES users(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  }

  static async assertEmployeeActive(employeeId: number) {
    const r = await pool.query(`SELECT id, is_active FROM employees WHERE id = $1`, [employeeId]);
    if (!r.rowCount) throw new HttpError(404, 'الموظف غير موجود');
    if (!r.rows[0].is_active) throw new HttpError(400, 'لا يمكن إنشاء مهمة لموظف غير نشط');
    return r.rows[0];
  }

  static async createTask(input: {
    employeeId: number;
    title: string;
    description?: string | null;
    taskDate: string;
    priority?: DailyTaskPriority;
    order?: number;
    createdBy: number;
  }) {
    await this.ensureSchema();
    await this.assertEmployeeActive(input.employeeId);

    let sortOrder = input.order;
    if (sortOrder == null) {
      const max = await pool.query<{ m: number }>(
        `SELECT COALESCE(MAX(sort_order), 0)::int AS m
         FROM employee_daily_tasks WHERE employee_id = $1 AND task_date = $2`,
        [input.employeeId, input.taskDate],
      );
      sortOrder = Number(max.rows[0]?.m ?? 0) + 1;
    }

    const r = await pool.query<DailyTaskRow>(
      `INSERT INTO employee_daily_tasks
         (employee_id, title, description, task_date, priority, sort_order, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [
        input.employeeId,
        input.title.trim(),
        input.description ?? null,
        input.taskDate,
        input.priority ?? 'medium',
        sortOrder,
        input.createdBy,
      ],
    );
    logger.info(
      { employee_id: input.employeeId, task_id: r.rows[0].id, created_by: input.createdBy },
      'employee_daily_task_created',
    );
    return serializeDailyTask(r.rows[0]);
  }

  static async updateTask(
    taskId: number,
    employeeId: number,
    patch: {
      title?: string;
      description?: string | null;
      taskDate?: string;
      priority?: DailyTaskPriority;
      order?: number;
      status?: DailyTaskStatus;
    },
  ) {
    await this.ensureSchema();
    const existing = await this.getTask(taskId);
    if (!existing || existing.employee_id !== employeeId) {
      throw new HttpError(404, 'المهمة غير موجودة');
    }
    if (existing.status === 'completed' && patch.status && patch.status !== 'completed') {
      // admin may reopen
    }

    const updates: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    const set = (col: string, val: unknown) => {
      updates.push(`${col} = $${i++}`);
      values.push(val);
    };
    if (patch.title !== undefined) set('title', patch.title.trim());
    if (patch.description !== undefined) set('description', patch.description);
    if (patch.taskDate !== undefined) set('task_date', patch.taskDate);
    if (patch.priority !== undefined) set('priority', patch.priority);
    if (patch.order !== undefined) set('sort_order', patch.order);
    if (patch.status !== undefined) set('status', patch.status);
    if (!updates.length) throw new HttpError(400, 'لا توجد بيانات للتحديث');
    updates.push('updated_at = NOW()');
    values.push(taskId, employeeId);
    const r = await pool.query<DailyTaskRow>(
      `UPDATE employee_daily_tasks SET ${updates.join(', ')}
       WHERE id = $${i++} AND employee_id = $${i}
       RETURNING *`,
      values,
    );
    return serializeDailyTask(r.rows[0]);
  }

  static async deleteTask(taskId: number, employeeId: number) {
    await this.ensureSchema();
    const r = await pool.query(
      `DELETE FROM employee_daily_tasks WHERE id = $1 AND employee_id = $2 RETURNING id`,
      [taskId, employeeId],
    );
    if (!r.rowCount) throw new HttpError(404, 'المهمة غير موجودة');
    return { success: true };
  }

  static async cancelTask(taskId: number, employeeId: number) {
    return this.updateTask(taskId, employeeId, { status: 'cancelled' });
  }

  static async reorderTasks(employeeId: number, taskDate: string, orderedIds: number[]) {
    await this.ensureSchema();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (let idx = 0; idx < orderedIds.length; idx++) {
        const id = orderedIds[idx];
        const r = await client.query(
          `UPDATE employee_daily_tasks
           SET sort_order = $1, updated_at = NOW()
           WHERE id = $2 AND employee_id = $3 AND task_date = $4
           RETURNING id`,
          [idx + 1, id, employeeId, taskDate],
        );
        if (!r.rowCount) {
          throw new HttpError(400, `المهمة ${id} غير موجودة لهذا الموظف/اليوم`);
        }
      }
      await client.query('COMMIT');
      return this.listTasks(employeeId, { taskDate });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  static async getTask(taskId: number): Promise<DailyTaskRow | null> {
    await this.ensureSchema();
    const r = await pool.query<DailyTaskRow>(
      `SELECT t.*, u.name AS created_by_name
       FROM employee_daily_tasks t
       LEFT JOIN users u ON u.id = t.created_by
       WHERE t.id = $1`,
      [taskId],
    );
    return r.rows[0] ?? null;
  }

  /** تفاصيل مهمة كاملة — مع التقرير إن كانت مكتملة */
  static async getTaskDetail(taskId: number, employeeId?: number) {
    const task = await this.getTask(taskId);
    if (!task) throw new HttpError(404, 'المهمة غير موجودة');
    if (employeeId != null && task.employee_id !== employeeId) {
      throw new HttpError(404, 'المهمة غير موجودة');
    }

    const serialized = serializeDailyTask(task);
    const emp = await pool.query(
      `SELECT e.id, e.name, e.email, e.employee_code, e.job_title, e.department
       FROM employees e WHERE e.id = $1`,
      [task.employee_id],
    );

    const isCompleted = task.status === 'completed';
    return {
      ...serialized,
      employee: emp.rows[0]
        ? {
            id: emp.rows[0].id,
            name: emp.rows[0].name,
            email: emp.rows[0].email,
            employee_code: emp.rows[0].employee_code ?? null,
            job_title: emp.rows[0].job_title ?? null,
            department: emp.rows[0].department ?? null,
          }
        : null,
      execution: {
        started_at: serialized.started_at,
        completed_at: serialized.completed_at,
        duration_minutes: serialized.duration_minutes,
        duration:
          serialized.duration_minutes != null
            ? `${Math.floor(serialized.duration_minutes / 60)}h ${serialized.duration_minutes % 60}m`
            : null,
        completion_report: isCompleted ? serialized.completion_report : null,
        has_report: isCompleted && !!serialized.completion_report,
      },
      created_by_admin: {
        id: serialized.created_by,
        name: serialized.created_by_name,
      },
    };
  }

  static async listTasks(
    employeeId: number,
    opts: {
      taskDate?: string;
      startDate?: string;
      endDate?: string;
      status?: DailyTaskStatus;
      priority?: DailyTaskPriority;
      page?: number;
      limit?: number;
    } = {},
  ) {
    await this.ensureSchema();
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(100, Math.max(1, opts.limit ?? 50));
    const offset = (page - 1) * limit;
    const params: unknown[] = [employeeId];
    let where = 't.employee_id = $1';
    if (opts.taskDate) {
      params.push(opts.taskDate);
      where += ` AND t.task_date = $${params.length}`;
    }
    if (opts.startDate) {
      params.push(opts.startDate);
      where += ` AND t.task_date >= $${params.length}`;
    }
    if (opts.endDate) {
      params.push(opts.endDate);
      where += ` AND t.task_date <= $${params.length}`;
    }
    if (opts.status) {
      params.push(opts.status);
      where += ` AND t.status = $${params.length}`;
    }
    if (opts.priority) {
      params.push(opts.priority);
      where += ` AND t.priority = $${params.length}`;
    }

    const count = await pool.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM employee_daily_tasks t WHERE ${where}`,
      params,
    );
    params.push(limit, offset);
    const rows = await pool.query<DailyTaskRow>(
      `SELECT t.*, u.name AS created_by_name
       FROM employee_daily_tasks t
       LEFT JOIN users u ON u.id = t.created_by
       WHERE ${where}
       ORDER BY t.task_date DESC, t.sort_order ASC, t.id ASC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return {
      items: rows.rows.map(serializeDailyTask),
      pagination: {
        page,
        limit,
        total: Number(count.rows[0]?.c ?? 0),
        total_pages: Math.ceil(Number(count.rows[0]?.c ?? 0) / limit) || 1,
      },
    };
  }

  static async startTask(taskId: number, employeeId: number) {
    await this.ensureSchema();
    const today = platformToday();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const r = await client.query<DailyTaskRow & { task_date_text: string }>(
        `SELECT t.*,
                to_char(t.task_date, 'YYYY-MM-DD') AS task_date_text
         FROM employee_daily_tasks t
         WHERE t.id = $1
         FOR UPDATE OF t`,
        [taskId],
      );
      const task = r.rows[0];
      if (!task || task.employee_id !== employeeId) {
        throw new HttpError(404, 'المهمة غير موجودة');
      }
      // to_char من Postgres هو المصدر الصحيح لتاريخ المهمة (بدون تحويل Date في Node)
      const taskDate = task.task_date_text || toDateString(task.task_date);
      if (taskDate !== today) {
        throw new HttpError(
          400,
          `يمكن بدء مهام اليوم الحالي فقط (مهمة: ${taskDate}، اليوم: ${today})`,
        );
      }
      if (task.status === 'cancelled') throw new HttpError(400, 'المهمة ملغاة');
      if (task.status === 'completed') throw new HttpError(409, 'المهمة مكتملة بالفعل');
      if (task.status === 'in_progress' && task.started_at) {
        await client.query('COMMIT');
        return serializeDailyTask({ ...task, task_date: task.task_date_text || task.task_date });
      }

      const updated = await client.query<DailyTaskRow & { task_date_text: string }>(
        `UPDATE employee_daily_tasks
         SET status = 'in_progress', started_at = COALESCE(started_at, NOW()), updated_at = NOW()
         WHERE id = $1
         RETURNING *, to_char(task_date, 'YYYY-MM-DD') AS task_date_text`,
        [taskId],
      );
      await client.query('COMMIT');
      logger.info({ employee_id: employeeId, task_id: taskId }, 'employee_daily_task_started');
      const row = updated.rows[0];
      return serializeDailyTask({ ...row, task_date: row.task_date_text || row.task_date });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  static async completeTask(taskId: number, employeeId: number, completionReport: string) {
    await this.ensureSchema();
    const report = completionReport?.trim();
    if (!report) throw new HttpError(400, 'تقرير إنجاز المهمة مطلوب');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const r = await client.query<DailyTaskRow>(
        `SELECT * FROM employee_daily_tasks WHERE id = $1 FOR UPDATE`,
        [taskId],
      );
      const task = r.rows[0];
      if (!task || task.employee_id !== employeeId) {
        throw new HttpError(404, 'المهمة غير موجودة');
      }
      if (task.status === 'cancelled') throw new HttpError(400, 'المهمة ملغاة');
      if (task.status === 'completed') throw new HttpError(409, 'المهمة مكتملة بالفعل');
      if (task.status !== 'in_progress' && !task.started_at) {
        throw new HttpError(400, 'يجب بدء المهمة قبل إكمالها');
      }

      const updated = await client.query<DailyTaskRow>(
        `UPDATE employee_daily_tasks
         SET status = 'completed',
             started_at = COALESCE(started_at, NOW()),
             completed_at = NOW(),
             completion_report = $2,
             updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [taskId, report],
      );
      await client.query('COMMIT');
      logger.info({ employee_id: employeeId, task_id: taskId }, 'employee_daily_task_completed');
      return serializeDailyTask(updated.rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  static buildTaskStats(tasks: ReturnType<typeof serializeDailyTask>[]) {
    const total = tasks.length;
    const completed = tasks.filter((t) => t.status === 'completed').length;
    const pending = tasks.filter((t) => t.status === 'pending').length;
    const inProgress = tasks.filter((t) => t.status === 'in_progress').length;
    const cancelled = tasks.filter((t) => t.status === 'cancelled').length;
    return {
      total,
      completed,
      pending,
      in_progress: inProgress,
      cancelled,
      completion_percentage: total ? Math.round((completed / total) * 100) : 0,
    };
  }

  static async tasksReport(
    employeeId: number,
    opts: {
      startDate?: string;
      endDate?: string;
      status?: DailyTaskStatus;
      priority?: DailyTaskPriority;
    },
  ) {
    const list = await this.listTasks(employeeId, { ...opts, page: 1, limit: 1000 });
    const tasks = list.items;
    const completedWithDuration = tasks.filter(
      (t) => t.status === 'completed' && t.duration_minutes != null,
    );
    const avgDuration =
      completedWithDuration.length > 0
        ? Math.round(
            completedWithDuration.reduce((s, t) => s + (t.duration_minutes ?? 0), 0) /
              completedWithDuration.length,
          )
        : null;
    const stats = this.buildTaskStats(tasks);
    return {
      ...stats,
      overdue: 0,
      average_completion_minutes: avgDuration,
      tasks,
    };
  }
}
