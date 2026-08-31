import pool from '../../../db/pool';
import { logger } from '../../../utils';

export class TaskActivityService {
  static async log(input: {
    templateId?: number | null;
    assignmentId?: number | null;
    instanceId?: number | null;
    actorUserId?: number | null;
    action: string;
    details?: Record<string, unknown>;
  }) {
    try {
      await pool.query(
        `INSERT INTO task_activity_logs
           (template_id, assignment_id, instance_id, actor_user_id, action, details)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
        [
          input.templateId ?? null,
          input.assignmentId ?? null,
          input.instanceId ?? null,
          input.actorUserId ?? null,
          input.action,
          JSON.stringify(input.details ?? {}),
        ],
      );
    } catch (e) {
      logger.warn({ err: e, action: input.action }, 'task activity log failed');
    }
  }

  static async listForTemplate(templateId: number, limit = 100) {
    const r = await pool.query(
      `SELECT l.*, u.name AS actor_name
       FROM task_activity_logs l
       LEFT JOIN users u ON u.id = l.actor_user_id
       WHERE l.template_id = $1
       ORDER BY l.created_at DESC
       LIMIT $2`,
      [templateId, limit],
    );
    return r.rows;
  }

  static async listForInstance(instanceId: number, limit = 50) {
    const r = await pool.query(
      `SELECT l.*, u.name AS actor_name
       FROM task_activity_logs l
       LEFT JOIN users u ON u.id = l.actor_user_id
       WHERE l.instance_id = $1
       ORDER BY l.created_at DESC
       LIMIT $2`,
      [instanceId, limit],
    );
    return r.rows;
  }
}
