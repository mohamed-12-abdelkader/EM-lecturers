import pool from '../../../db/pool';
import { platformToday, platformTimezone } from '../../employeeWork/utils/time';
import { addDays, isDateInRange, weekEndDate, weekStartDate } from '../utils/period';
import { TaskActivityService } from './activity.service';
import { TaskManagementNotificationService } from './notification.service';

const TZ = () => platformTimezone();

export class TaskInstanceScheduler {
  /** إنشاء instances لليوم والأسبوع الحاليين لكل التعيينات النشطة */
  static async ensureCurrentPeriodInstances() {
    const today = platformToday();
    await this.ensureDailyInstancesForDate(today);
    await this.ensureWeeklyInstancesForWeek(weekStartDate(today));
  }

  static async ensureDailyInstancesForDate(dateStr: string) {
    const assignments = await pool.query<{
      assignment_id: number;
      template_id: number;
      employee_id: number;
      start_date: string;
      end_date: string | null;
      scheduled_time: string | null;
      template_status: string;
      assignment_status: string;
    }>(
      `SELECT a.id AS assignment_id, a.template_id, a.employee_id,
              t.start_date, t.end_date, t.scheduled_time, t.status AS template_status, a.status AS assignment_status
       FROM task_assignments a
       JOIN task_templates t ON t.id = a.template_id
       WHERE t.task_type = 'daily' AND t.status = 'active' AND a.status = 'active'`,
    );

    for (const row of assignments.rows) {
      if (!isDateInRange(dateStr, String(row.start_date).slice(0, 10), row.end_date ? String(row.end_date).slice(0, 10) : null)) {
        continue;
      }
      await this.createInstanceIfMissing({
        assignmentId: row.assignment_id,
        templateId: row.template_id,
        employeeId: row.employee_id,
        instanceType: 'daily',
        periodStart: dateStr,
        periodEnd: dateStr,
        scheduledTime: row.scheduled_time,
      });
    }
  }

  static async ensureWeeklyInstancesForWeek(weekStart: string) {
    const weekEnd = weekEndDate(weekStart);
    const assignments = await pool.query<{
      assignment_id: number;
      template_id: number;
      employee_id: number;
      start_date: string;
      end_date: string | null;
      scheduled_time: string | null;
    }>(
      `SELECT a.id AS assignment_id, a.template_id, a.employee_id,
              t.start_date, t.end_date, t.scheduled_time
       FROM task_assignments a
       JOIN task_templates t ON t.id = a.template_id
       WHERE t.task_type = 'weekly' AND t.status = 'active' AND a.status = 'active'`,
    );

    for (const row of assignments.rows) {
      const start = String(row.start_date).slice(0, 10);
      const end = row.end_date ? String(row.end_date).slice(0, 10) : null;
      if (!isDateInRange(weekStart, start, end) && !(end && weekStart <= end && weekEnd >= start)) {
        if (weekEnd < start || (end && weekStart > end)) continue;
      }
      if (weekEnd < start) continue;
      if (end && weekStart > end) continue;

      await this.createInstanceIfMissing({
        assignmentId: row.assignment_id,
        templateId: row.template_id,
        employeeId: row.employee_id,
        instanceType: 'weekly',
        periodStart: weekStart,
        periodEnd: weekEnd,
        scheduledTime: row.scheduled_time,
      });
    }
  }

  private static async createInstanceIfMissing(input: {
    assignmentId: number;
    templateId: number;
    employeeId: number;
    instanceType: 'daily' | 'weekly';
    periodStart: string;
    periodEnd: string;
    scheduledTime: string | null;
  }) {
    const exists = await pool.query(
      `SELECT id FROM task_instances
       WHERE assignment_id = $1 AND period_start = $2 AND instance_type = $3`,
      [input.assignmentId, input.periodStart, input.instanceType],
    );
    if (exists.rowCount) return;

    await pool.query(
      `INSERT INTO task_instances
         (assignment_id, template_id, employee_id, instance_type, period_start, period_end, status, due_at)
       VALUES (
         $1, $2, $3, $4, $5, $6, 'pending',
         CASE WHEN $7::time IS NOT NULL THEN
           (($6::date + $7::time) AT TIME ZONE $8)
         ELSE NULL END
       )
       ON CONFLICT (assignment_id, period_start, instance_type) DO NOTHING`,
      [
        input.assignmentId,
        input.templateId,
        input.employeeId,
        input.instanceType,
        input.periodStart,
        input.periodEnd,
        input.scheduledTime,
        TZ(),
      ],
    );
  }

  /** نهاية اليوم: تحويل المعلّقة إلى overdue/missed */
  static async closeDailyPeriod(dateStr: string) {
    const r = await pool.query(
      `UPDATE task_instances
       SET status = CASE WHEN status = 'in_progress' THEN 'overdue' ELSE 'missed' END,
           updated_at = NOW()
       WHERE instance_type = 'daily'
         AND period_end = $1
         AND status IN ('pending', 'in_progress')
       RETURNING id, employee_id, template_id, assignment_id`,
      [dateStr],
    );

    for (const row of r.rows) {
      await TaskActivityService.log({
        templateId: row.template_id,
        assignmentId: row.assignment_id,
        instanceId: row.id,
        action: 'instance_period_closed',
        details: { date: dateStr, new_status: 'missed_or_overdue' },
      });
    }

    return r.rowCount ?? 0;
  }

  /** نهاية الأسبوع */
  static async closeWeeklyPeriod(weekStart: string) {
    const weekEnd = weekEndDate(weekStart);
    const r = await pool.query(
      `UPDATE task_instances
       SET status = CASE WHEN status = 'in_progress' THEN 'overdue' ELSE 'missed' END,
           updated_at = NOW()
       WHERE instance_type = 'weekly'
         AND period_start = $1 AND period_end = $2
         AND status IN ('pending', 'in_progress')
       RETURNING id`,
      [weekStart, weekEnd],
    );
    return r.rowCount ?? 0;
  }

  /** تحديث overdue للمهام التي تجاوزت due_at */
  static async markDueOverdue() {
    await pool.query(
      `UPDATE task_instances
       SET status = 'overdue', updated_at = NOW()
       WHERE status IN ('pending', 'in_progress')
         AND due_at IS NOT NULL
         AND due_at < NOW()`,
    );
  }

  /** تذكير قبل الموعد بساعة */
  static async sendReminders() {
    const dueSoon = await pool.query<{
      id: number;
      employee_id: number;
      template_id: number;
      title: string;
      user_id: number;
    }>(
      `SELECT i.id, i.employee_id, i.template_id, t.title, e.user_id
       FROM task_instances i
       JOIN task_templates t ON t.id = i.template_id
       JOIN employees e ON e.id = i.employee_id
       WHERE i.status IN ('pending', 'in_progress')
         AND i.due_at IS NOT NULL
         AND i.reminder_sent_at IS NULL
         AND i.due_at > NOW()
         AND i.due_at <= NOW() + INTERVAL '1 hour'
         AND e.user_id IS NOT NULL`,
    );

    for (const row of dueSoon.rows) {
      await TaskManagementNotificationService.notifyEmployee(
        Number(row.user_id),
        'تذكير بمهمة',
        `موعد مهمة "${row.title}" يقترب`,
        'task_instance_reminder',
        { instance_id: row.id, template_id: row.template_id },
      );
      await pool.query(`UPDATE task_instances SET reminder_sent_at = NOW() WHERE id = $1`, [
        row.id,
      ]);
    }
  }

  /** Cron يومي: أغلق أمس + أنشئ اليوم */
  static async runDailyMaintenance() {
    const today = platformToday();
    const yesterday = addDays(today, -1);
    await this.closeDailyPeriod(yesterday);

    const yesterdayWeekStart = weekStartDate(yesterday);
    const todayWeekStart = weekStartDate(today);
    if (yesterdayWeekStart !== todayWeekStart) {
      await this.closeWeeklyPeriod(yesterdayWeekStart);
    }

    await this.ensureCurrentPeriodInstances();
    await this.markDueOverdue();
    await this.sendReminders();
  }
}
