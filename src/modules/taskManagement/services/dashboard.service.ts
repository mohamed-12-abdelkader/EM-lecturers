import pool from '../../../db/pool';
import { platformToday } from '../../employeeWork/utils/time';
import { weekStartDate } from '../utils/period';

export class TaskDashboardService {
  static async adminOverview(filters: {
    startDate?: string;
    endDate?: string;
    taskType?: string;
    status?: string;
    employeeId?: number;
  } = {}) {
    const today = platformToday();
    const weekStart = weekStartDate(today);

    const templateStats = await pool.query<{
      total: string;
      daily: string;
      weekly: string;
      active: string;
      cancelled: string;
    }>(
      `SELECT
         COUNT(*)::text AS total,
         COUNT(*) FILTER (WHERE task_type = 'daily')::text AS daily,
         COUNT(*) FILTER (WHERE task_type = 'weekly')::text AS weekly,
         COUNT(*) FILTER (WHERE status = 'active')::text AS active,
         COUNT(*) FILTER (WHERE status = 'cancelled')::text AS cancelled
       FROM task_templates`,
    );

    let instanceWhere = '1=1';
    const vals: unknown[] = [];
    let p = 1;
    if (filters.startDate) {
      instanceWhere += ` AND i.period_start >= $${p++}`;
      vals.push(filters.startDate);
    }
    if (filters.endDate) {
      instanceWhere += ` AND i.period_end <= $${p++}`;
      vals.push(filters.endDate);
    }
    if (filters.taskType) {
      instanceWhere += ` AND i.instance_type = $${p++}`;
      vals.push(filters.taskType);
    }
    if (filters.status) {
      instanceWhere += ` AND i.status = $${p++}`;
      vals.push(filters.status);
    }
    if (filters.employeeId) {
      instanceWhere += ` AND i.employee_id = $${p++}`;
      vals.push(filters.employeeId);
    }

    const instanceStats = await pool.query<{
      total: string;
      completed: string;
      in_progress: string;
      pending: string;
      overdue: string;
      missed: string;
    }>(
      `SELECT
         COUNT(*)::text AS total,
         COUNT(*) FILTER (WHERE status = 'completed')::text AS completed,
         COUNT(*) FILTER (WHERE status = 'in_progress')::text AS in_progress,
         COUNT(*) FILTER (WHERE status = 'pending')::text AS pending,
         COUNT(*) FILTER (WHERE status = 'overdue')::text AS overdue,
         COUNT(*) FILTER (WHERE status = 'missed')::text AS missed
       FROM task_instances i WHERE ${instanceWhere}`,
      vals,
    );

    const todayStats = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE instance_type = 'daily' AND period_start = $1)::int AS daily_today,
         COUNT(*) FILTER (WHERE instance_type = 'weekly' AND period_start = $2)::int AS weekly_this_week
       FROM task_instances`,
      [today, weekStart],
    );

    const ts = templateStats.rows[0];
    const is = instanceStats.rows[0];
    const totalInstances = Number(is?.total ?? 0);
    const completed = Number(is?.completed ?? 0);

    return {
      templates: {
        total: Number(ts?.total ?? 0),
        daily: Number(ts?.daily ?? 0),
        weekly: Number(ts?.weekly ?? 0),
        active: Number(ts?.active ?? 0),
        cancelled: Number(ts?.cancelled ?? 0),
      },
      instances: {
        total: totalInstances,
        completed,
        in_progress: Number(is?.in_progress ?? 0),
        pending: Number(is?.pending ?? 0),
        overdue: Number(is?.overdue ?? 0),
        missed: Number(is?.missed ?? 0),
        completion_rate: totalInstances ? Math.round((completed / totalInstances) * 100) : 0,
      },
      today: {
        date: today,
        daily_instances: todayStats.rows[0]?.daily_today ?? 0,
        weekly_instances: todayStats.rows[0]?.weekly_this_week ?? 0,
      },
    };
  }

  static async employeePerformance(filters: {
    startDate: string;
    endDate: string;
    employeeId?: number;
    taskType?: string;
  }) {
    const conditions = [`i.period_start >= $1`, `i.period_end <= $2`];
    const values: unknown[] = [filters.startDate, filters.endDate];
    let p = 3;

    if (filters.employeeId) {
      conditions.push(`i.employee_id = $${p++}`);
      values.push(filters.employeeId);
    }
    if (filters.taskType) {
      conditions.push(`i.instance_type = $${p++}`);
      values.push(filters.taskType);
    }

    const where = conditions.join(' AND ');
    const r = await pool.query(
      `SELECT
         e.id AS employee_id,
         e.name AS employee_name,
         COUNT(*)::int AS total_tasks,
         COUNT(*) FILTER (WHERE i.status = 'completed')::int AS completed,
         COUNT(*) FILTER (WHERE i.status = 'in_progress')::int AS in_progress,
         COUNT(*) FILTER (WHERE i.status IN ('overdue', 'missed'))::int AS overdue,
         COUNT(*) FILTER (WHERE i.status = 'pending')::int AS pending,
         ROUND(
           100.0 * COUNT(*) FILTER (WHERE i.status = 'completed') / NULLIF(COUNT(*), 0),
           1
         ) AS completion_rate
       FROM task_instances i
       JOIN employees e ON e.id = i.employee_id
       WHERE ${where}
       GROUP BY e.id, e.name
       ORDER BY completion_rate DESC NULLS LAST, e.name ASC`,
      values,
    );

    return r.rows;
  }

  static async templateDetailWithAssignments(templateId: number) {
    const template = await pool.query(
      `SELECT t.*, u.name AS created_by_name FROM task_templates t
       LEFT JOIN users u ON u.id = t.created_by WHERE t.id = $1`,
      [templateId],
    );
    if (!template.rowCount) return null;

    const assignments = await pool.query(
      `SELECT a.id AS assignment_id, a.status AS assignment_status, a.assigned_at,
              e.id AS employee_id, e.name AS employee_name,
              inst.id AS latest_instance_id,
              inst.status AS instance_status,
              inst.period_start,
              inst.completed_at
       FROM task_assignments a
       JOIN employees e ON e.id = a.employee_id
       LEFT JOIN LATERAL (
         SELECT id, status, period_start, completed_at
         FROM task_instances
         WHERE assignment_id = a.id
         ORDER BY period_start DESC, id DESC
         LIMIT 1
       ) inst ON TRUE
       WHERE a.template_id = $1
       ORDER BY e.name`,
      [templateId],
    );

    return {
      template: template.rows[0],
      assignments: assignments.rows,
    };
  }
}
