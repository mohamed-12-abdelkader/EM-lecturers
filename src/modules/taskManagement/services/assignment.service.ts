import pool from '../../../db/pool';
import { HttpError } from '../../../utils';
import { TaskActivityService } from './activity.service';
import { TaskTemplateService } from './template.service';
import { TaskInstanceScheduler } from './scheduler.service';
import { TaskManagementNotificationService } from './notification.service';

export class TaskAssignmentService {
  static async assign(
    templateId: number,
    input: {
      employeeIds?: number[];
      assignAll?: boolean;
      assignedBy: number;
    },
  ) {
    const template = await TaskTemplateService.getById(templateId);
    if (template.status !== 'active') {
      throw new HttpError(400, 'لا يمكن توزيع مهمة غير نشطة');
    }

    let employeeIds = input.employeeIds ?? [];
    if (input.assignAll) {
      const all = await pool.query<{ id: number }>(
        `SELECT id FROM employees WHERE is_active = TRUE ORDER BY id`,
      );
      employeeIds = all.rows.map((r) => r.id);
    }

    if (!employeeIds.length) {
      throw new HttpError(400, 'حدد موظفاً واحداً على الأقل أو assign_all=true');
    }

    const created: number[] = [];
    const skipped: number[] = [];

    for (const employeeId of employeeIds) {
      const emp = await pool.query(
        `SELECT id, user_id, name FROM employees WHERE id = $1 AND is_active = TRUE`,
        [employeeId],
      );
      if (!emp.rowCount) {
        skipped.push(employeeId);
        continue;
      }

      const ins = await pool.query(
        `INSERT INTO task_assignments (template_id, employee_id, assigned_by)
         VALUES ($1, $2, $3)
         ON CONFLICT (template_id, employee_id) DO UPDATE
           SET status = 'active', assigned_by = EXCLUDED.assigned_by, assigned_at = NOW(), cancelled_at = NULL
         RETURNING id`,
        [templateId, employeeId, input.assignedBy],
      );
      created.push(Number(ins.rows[0].id));

      await TaskActivityService.log({
        templateId,
        assignmentId: ins.rows[0].id,
        actorUserId: input.assignedBy,
        action: 'assignment_created',
        details: { employee_id: employeeId },
      });

      if (emp.rows[0].user_id) {
        await TaskManagementNotificationService.notifyEmployee(
          Number(emp.rows[0].user_id),
          'مهمة جديدة',
          `تم تعيين مهمة "${template.title}" لك`,
          'task_template_assigned',
          { template_id: templateId, assignment_id: ins.rows[0].id },
        );
      }
    }

    await TaskInstanceScheduler.ensureCurrentPeriodInstances();

    return {
      template_id: templateId,
      assigned_count: created.length,
      assignment_ids: created,
      skipped_employee_ids: skipped,
    };
  }

  static async listForTemplate(templateId: number) {
    const r = await pool.query(
      `SELECT a.*,
              e.name AS employee_name,
              e.user_id AS employee_user_id,
              u.name AS assigned_by_name,
              (SELECT status FROM task_instances i
               WHERE i.assignment_id = a.id
               ORDER BY i.period_start DESC LIMIT 1) AS latest_instance_status,
              (SELECT completed_at FROM task_instances i
               WHERE i.assignment_id = a.id AND i.status = 'completed'
               ORDER BY i.completed_at DESC LIMIT 1) AS last_completed_at
       FROM task_assignments a
       JOIN employees e ON e.id = a.employee_id
       LEFT JOIN users u ON u.id = a.assigned_by
       WHERE a.template_id = $1
       ORDER BY a.assigned_at DESC`,
      [templateId],
    );
    return r.rows;
  }

  static async cancelAssignment(assignmentId: number, actorUserId: number) {
    const r = await pool.query(
      `UPDATE task_assignments SET status = 'cancelled', cancelled_at = NOW()
       WHERE id = $1 RETURNING *`,
      [assignmentId],
    );
    if (!r.rowCount) throw new HttpError(404, 'التعيين غير موجود');

    await pool.query(
      `UPDATE task_instances SET status = 'cancelled', updated_at = NOW()
       WHERE assignment_id = $1 AND status IN ('pending', 'in_progress')`,
      [assignmentId],
    );

    await TaskActivityService.log({
      templateId: r.rows[0].template_id,
      assignmentId,
      actorUserId,
      action: 'assignment_cancelled',
    });

    return r.rows[0];
  }
}
