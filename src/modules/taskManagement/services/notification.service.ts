import pool from '../../../db/pool';
import * as ExpoPushService from '../../../services/expoPushService';

export class TaskManagementNotificationService {
  static async notifyEmployee(
    userId: number,
    title: string,
    message: string,
    type: 'task_template_assigned' | 'task_instance_reminder' | 'task_instance_overdue',
    metadata: Record<string, unknown>,
  ) {
    try {
      await pool.query(
        `INSERT INTO notifications (user_id, title, message, description, type, metadata)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
        [userId, title, message, message, type, JSON.stringify(metadata)],
      );
      await ExpoPushService.sendPushNotification(userId, title, message, { type, ...metadata });
    } catch {
      /* non-blocking */
    }
  }
}
