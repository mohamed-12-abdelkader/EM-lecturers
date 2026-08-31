import pool from '../../../db/pool';
import { HttpError } from '../../../utils';
import { platformToday } from '../../employeeWork/utils/time';
import type { InstanceStatus } from '../types';
import { safeDateStr, weekEndDate, weekStartDate } from '../utils/period';
import { TaskActivityService } from './activity.service';
import { TaskInstanceScheduler } from './scheduler.service';
import { TaskManagementNotificationService } from './notification.service';

export class TaskInstanceService {
  static async assertEmployeeOwnsInstance(instanceId: number, employeeId: number) {
    const r = await pool.query(
      `SELECT i.*, t.title, t.description, t.priority, t.allow_attachments, t.admin_notes,
              t.scheduled_time, t.task_type AS template_task_type
       FROM task_instances i
       JOIN task_templates t ON t.id = i.template_id
       WHERE i.id = $1 AND i.employee_id = $2`,
      [instanceId, employeeId],
    );
    if (!r.rowCount) throw new HttpError(404, 'المهمة غير موجودة');
    return r.rows[0];
  }

  static async getEmployeeDashboard(employeeId: number) {
    await TaskInstanceScheduler.ensureCurrentPeriodInstances();

    const today = platformToday();
    const weekStart = weekStartDate(today);
    const weekEnd = weekEndDate(today);

    const statsRes = await pool.query<{
      total: string;
      completed: string;
      overdue: string;
      in_progress: string;
      pending: string;
    }>(
      `SELECT
         COUNT(*)::text AS total,
         COUNT(*) FILTER (WHERE status = 'completed')::text AS completed,
         COUNT(*) FILTER (WHERE status IN ('overdue', 'missed'))::text AS overdue,
         COUNT(*) FILTER (WHERE status = 'in_progress')::text AS in_progress,
         COUNT(*) FILTER (WHERE status = 'pending')::text AS pending
       FROM task_instances
       WHERE employee_id = $1
         AND (
           (instance_type = 'daily' AND period_start = $2)
           OR (instance_type = 'weekly' AND period_start = $3)
         )`,
      [employeeId, today, weekStart],
    );

    const daily = await this.listForEmployee(employeeId, {
      instanceType: 'daily',
      periodStart: today,
    });
    const weekly = await this.listForEmployee(employeeId, {
      instanceType: 'weekly',
      periodStart: weekStart,
    });
    const overdue = await this.listForEmployee(employeeId, { status: 'overdue', limit: 50 });
    const completedToday = await pool.query(
      `SELECT i.*, t.title, t.priority
       FROM task_instances i
       JOIN task_templates t ON t.id = i.template_id
       WHERE i.employee_id = $1 AND i.status = 'completed'
         AND i.completed_at::date = $2::date
       ORDER BY i.completed_at DESC LIMIT 20`,
      [employeeId, today],
    );

    const s = statsRes.rows[0];
    const total = Number(s?.total ?? 0);
    const completed = Number(s?.completed ?? 0);

    return {
      today,
      week: { start: weekStart, end: weekEnd },
      stats: {
        total,
        completed,
        overdue: Number(s?.overdue ?? 0),
        in_progress: Number(s?.in_progress ?? 0),
        pending: Number(s?.pending ?? 0),
        completion_rate: total ? Math.round((completed / total) * 100) : 0,
      },
      daily_tasks: daily,
      weekly_tasks: weekly,
      overdue_tasks: overdue,
      completed_today: completedToday.rows.map((r) => this.serializeInstance(r)),
    };
  }

  static async listForEmployee(
    employeeId: number,
    filters: {
      instanceType?: 'daily' | 'weekly';
      periodStart?: string;
      status?: InstanceStatus | 'overdue_group';
      startDate?: string;
      endDate?: string;
      limit?: number;
    } = {},
  ) {
    await TaskInstanceScheduler.ensureCurrentPeriodInstances();

    const conditions = ['i.employee_id = $1'];
    const values: unknown[] = [employeeId];
    let p = 2;

    if (filters.instanceType) {
      conditions.push(`i.instance_type = $${p++}`);
      values.push(filters.instanceType);
    }
    if (filters.periodStart) {
      conditions.push(`i.period_start = $${p++}`);
      values.push(filters.periodStart);
    }
    if (filters.status === 'overdue_group') {
      conditions.push(`i.status IN ('overdue', 'missed')`);
    } else if (filters.status) {
      conditions.push(`i.status = $${p++}`);
      values.push(filters.status);
    }
    if (filters.startDate) {
      conditions.push(`i.period_start >= $${p++}`);
      values.push(filters.startDate);
    }
    if (filters.endDate) {
      conditions.push(`i.period_end <= $${p++}`);
      values.push(filters.endDate);
    }

    const limit = Math.min(filters.limit ?? 100, 200);
    const r = await pool.query(
      `SELECT i.*, t.title, t.description, t.priority, t.task_type AS template_task_type
       FROM task_instances i
       JOIN task_templates t ON t.id = i.template_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY
         CASE i.status
           WHEN 'overdue' THEN 0 WHEN 'missed' THEN 1 WHEN 'in_progress' THEN 2
           WHEN 'pending' THEN 3 WHEN 'completed' THEN 4 ELSE 5
         END,
         i.period_start DESC,
         t.priority DESC,
         i.id ASC
       LIMIT ${limit}`,
      values,
    );
    return r.rows.map((row) => this.serializeInstance(row));
  }

  static async startInstance(instanceId: number, employeeId: number, userId: number) {
    const row = await this.assertEmployeeOwnsInstance(instanceId, employeeId);
    if (!['pending', 'overdue'].includes(row.status)) {
      throw new HttpError(400, 'لا يمكن بدء هذه المهمة في حالتها الحالية');
    }

    const today = platformToday();
    if (row.instance_type === 'daily' && safeDateStr(row.period_start) !== today) {
      throw new HttpError(400, 'يمكن بدء مهام اليوم فقط في يومها المحدد');
    }

    const r = await pool.query(
      `UPDATE task_instances SET status = 'in_progress', started_at = COALESCE(started_at, NOW()), updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [instanceId],
    );

    await TaskActivityService.log({
      templateId: row.template_id,
      assignmentId: row.assignment_id,
      instanceId,
      actorUserId: userId,
      action: 'instance_started',
    });

    return this.serializeInstance({ ...r.rows[0], title: row.title, priority: row.priority });
  }

  static async completeInstance(
    instanceId: number,
    employeeId: number,
    userId: number,
    employeeNotes?: string | null,
  ) {
    const row = await this.assertEmployeeOwnsInstance(instanceId, employeeId);
    if (!['pending', 'in_progress', 'overdue'].includes(row.status)) {
      throw new HttpError(400, 'لا يمكن إتمام هذه المهمة');
    }

    const today = platformToday();
    if (row.instance_type === 'daily' && safeDateStr(row.period_start) !== today) {
      throw new HttpError(400, 'يمكن إتمام مهام اليوم فقط في يومها المحدد');
    }

    const r = await pool.query(
      `UPDATE task_instances
       SET status = 'completed',
           completed_at = NOW(),
           employee_notes = COALESCE($2, employee_notes),
           updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [instanceId, employeeNotes?.trim() || null],
    );

    await TaskActivityService.log({
      templateId: row.template_id,
      assignmentId: row.assignment_id,
      instanceId,
      actorUserId: userId,
      action: 'instance_completed',
      details: { notes: employeeNotes ?? null },
    });

    return this.serializeInstance({ ...r.rows[0], title: row.title, priority: row.priority });
  }

  static async addNote(instanceId: number, employeeId: number, userId: number, note: string) {
    await this.assertEmployeeOwnsInstance(instanceId, employeeId);
    const r = await pool.query(
      `INSERT INTO task_instance_notes (instance_id, author_user_id, note)
       VALUES ($1, $2, $3) RETURNING *`,
      [instanceId, userId, note.trim()],
    );
    await TaskActivityService.log({
      instanceId,
      actorUserId: userId,
      action: 'instance_note_added',
    });
    return r.rows[0];
  }

  static async addAttachment(
    instanceId: number,
    employeeId: number,
    userId: number,
    file: { fileName: string; filePath: string; fileSize?: number },
  ) {
    const row = await this.assertEmployeeOwnsInstance(instanceId, employeeId);
    if (!row.allow_attachments) {
      throw new HttpError(403, 'غير مسموح برفع ملفات لهذه المهمة');
    }
    const r = await pool.query(
      `INSERT INTO task_instance_attachments (instance_id, file_name, file_path, file_size, uploaded_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [instanceId, file.fileName, file.filePath, file.fileSize ?? null, userId],
    );
    return r.rows[0];
  }

  static async getInstanceDetail(instanceId: number, employeeId: number) {
    const row = await this.assertEmployeeOwnsInstance(instanceId, employeeId);
    const notes = await pool.query(
      `SELECT n.*, u.name AS author_name FROM task_instance_notes n
       LEFT JOIN users u ON u.id = n.author_user_id
       WHERE n.instance_id = $1 ORDER BY n.created_at ASC`,
      [instanceId],
    );
    const attachments = await pool.query(
      `SELECT * FROM task_instance_attachments WHERE instance_id = $1 ORDER BY created_at DESC`,
      [instanceId],
    );
    const templateAttachments = await pool.query(
      `SELECT * FROM task_template_attachments WHERE template_id = $1`,
      [row.template_id],
    );
    const activity = await TaskActivityService.listForInstance(instanceId);

    return {
      instance: this.serializeInstance(row),
      template_attachments: templateAttachments.rows,
      employee_notes: notes.rows,
      employee_attachments: attachments.rows,
      activity,
    };
  }

  static serializeInstance(row: Record<string, unknown>) {
    return {
      id: row.id,
      assignment_id: row.assignment_id,
      template_id: row.template_id,
      employee_id: row.employee_id,
      instance_type: row.instance_type,
      period_start: safeDateStr(row.period_start),
      period_end: safeDateStr(row.period_end),
      status: row.status,
      due_at: row.due_at,
      started_at: row.started_at,
      completed_at: row.completed_at,
      employee_notes: row.employee_notes,
      title: row.title,
      description: row.description,
      priority: row.priority,
      template_task_type: row.template_task_type ?? row.task_type,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }
}
