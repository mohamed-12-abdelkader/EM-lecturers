import pool from '../db/pool';
import { NotificationPushQueue, QueuedPushPayload } from './notificationPushQueue';
import { scheduleWebPushForUser, scheduleWebPushForUsers } from './webPushSender';
import * as ExpoPushService from './expoPushService';
import { sendPushNotification } from '../utils';
import { logger } from '../utils';

export interface DispatchNotificationInput {
  title: string;
  body: string;
  type: string;
  icon?: string;
  image?: string;
  url?: string;
  user_id: number;
  course_id?: number;
  lecture_id?: number;
  exam_id?: number;
  metadata?: Record<string, unknown>;
  skipLegacyPush?: boolean;
}

export interface SendNotificationPayload {
  title: string;
  body: string;
  icon?: string;
  image?: string;
  url?: string;
  type: string;
}

let getIOInstance: (() => import('socket.io').Server | null) | null = null;

export function setNotificationDispatchIO(getter: () => import('socket.io').Server | null) {
  getIOInstance = getter;
}

function broadcastNotification(userId: number, notification: Record<string, unknown>) {
  const io = getIOInstance?.();
  if (io) {
    io.to(`user:${userId}`).emit('notification:new', notification);
  }
}

function toApiRow(row: Record<string, unknown>) {
  return {
    id: row.id,
    user_id: row.user_id,
    title: row.title,
    body: row.message,
    message: row.message,
    type: row.type,
    icon: row.icon,
    image: row.image,
    url: row.url,
    is_read: row.is_read,
    course_id: row.course_id,
    lecture_id: row.lecture_id,
    exam_id: row.exam_id,
    metadata: row.metadata,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export class NotificationDispatchService {
  static async dispatchToUser(input: DispatchNotificationInput) {
    const result = await pool.query(
      `INSERT INTO notifications (user_id, title, message, type, icon, image, url, course_id, lecture_id, exam_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
       RETURNING *`,
      [
        input.user_id,
        input.title,
        input.body,
        input.type,
        input.icon || null,
        input.image || null,
        input.url || null,
        input.course_id || null,
        input.lecture_id || null,
        input.exam_id || null,
        input.metadata ? JSON.stringify(input.metadata) : null,
      ],
    );

    const row = result.rows[0];
    const apiRow = toApiRow(row);

    broadcastNotification(input.user_id, {
      id: `notification_${row.id}`,
      type: 'notification',
      notification_type: input.type,
      title: row.title,
      message: row.message,
      body: row.message,
      icon: row.icon,
      image: row.image,
      url: row.url,
      course_id: row.course_id,
      lecture_id: row.lecture_id,
      exam_id: row.exam_id,
      is_read: row.is_read,
      created_at: row.created_at,
    });

    const pushPayload: QueuedPushPayload = {
      title: input.title,
      body: input.body,
      icon: input.icon,
      image: input.image,
      url: input.url,
      type: input.type,
      notification_id: row.id,
      data: {
        course_id: input.course_id,
        lecture_id: input.lecture_id,
        exam_id: input.exam_id,
        ...(input.metadata || {}),
      },
    };

    scheduleWebPushForUser(input.user_id, pushPayload, row.id);

    if (!input.skipLegacyPush) {
      sendPushNotification([input.user_id], input.title, input.body, {
        type: input.type,
        course_id: input.course_id,
        lecture_id: input.lecture_id,
        exam_id: input.exam_id,
        url: input.url,
      }).catch((e) => logger.warn({ e }, 'OneSignal push failed'));

      ExpoPushService.sendPushNotification(input.user_id, input.title, input.body, {
        type: input.type,
        course_id: input.course_id,
        lecture_id: input.lecture_id,
        exam_id: input.exam_id,
        url: input.url,
      }).catch((e) => logger.warn({ e }, 'Expo push failed'));
    }

    return { success: true, notification: apiRow, notification_id: row.id };
  }

  static async dispatchToUsers(userIds: number[], payload: SendNotificationPayload & { course_id?: number }) {
    const uniqueIds = [...new Set(userIds.filter((id) => Number.isInteger(id) && id > 0))];
    if (uniqueIds.length === 0) return { success: true, notifiedCount: 0, notification_ids: [] as number[] };

    const notificationIds: number[] = [];
    for (const userId of uniqueIds) {
      const res = await this.dispatchToUser({
        user_id: userId,
        title: payload.title,
        body: payload.body,
        type: payload.type,
        icon: payload.icon,
        image: payload.image,
        url: payload.url,
        course_id: payload.course_id,
      });
      if (res.notification_id) notificationIds.push(res.notification_id);
    }

    return { success: true, notifiedCount: notificationIds.length, notification_ids: notificationIds };
  }

  static async broadcastToAllUsers(payload: SendNotificationPayload) {
    const users = await pool.query<{ id: number }>(
      `SELECT id FROM users WHERE role IN ('student', 'teacher', 'admin') AND account_status IS DISTINCT FROM 'suspended'`,
    );
    const userIds = users.rows.map((r) => r.id);
    return this.dispatchToUsers(userIds, { ...payload, type: payload.type || 'broadcast' });
  }

  static async getUnreadNotifications(userId: number, limit = 20, offset = 0) {
    const result = await pool.query(
      `SELECT id, user_id, title, message, type, icon, image, url, is_read, course_id, lecture_id, exam_id, metadata, created_at, updated_at
       FROM notifications
       WHERE user_id = $1 AND is_read = FALSE
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset],
    );
    const count = await pool.query(
      `SELECT COUNT(*)::int AS total FROM notifications WHERE user_id = $1 AND is_read = FALSE`,
      [userId],
    );
    return {
      notifications: result.rows.map(toApiRow),
      total: count.rows[0]?.total || 0,
    };
  }

  static async deleteNotification(notificationId: number, userId: number) {
    const result = await pool.query(
      `DELETE FROM notifications WHERE id = $1 AND user_id = $2 RETURNING id`,
      [notificationId, userId],
    );
    return (result.rowCount || 0) > 0;
  }

  static async assertTeacherCanNotifyUsers(teacherId: number, userIds: number[]): Promise<boolean> {
    if (userIds.length === 0) return true;
    const result = await pool.query(
      `SELECT COUNT(DISTINCT e.user_id)::int AS cnt
       FROM enrollments e
       INNER JOIN courses c ON c.id = e.course_id AND c.teacher_id = $1
       WHERE e.user_id = ANY($2::int[])`,
      [teacherId, userIds],
    );
    return (result.rows[0]?.cnt || 0) === userIds.length;
  }
}

export { scheduleWebPushForUser, scheduleWebPushForUsers, NotificationPushQueue };
