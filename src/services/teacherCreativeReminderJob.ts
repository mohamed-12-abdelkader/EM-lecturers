import pool from '../db/pool';
import { logger } from '../utils';
import { NotificationService } from './notifications';

let teacherCreativeReminderLastRunDate = '';

export function isTeacherCreativeReminderTime(): boolean {
  const d = new Date();
  return d.getHours() === 8 && d.getMinutes() === 0;
}

async function hasReminderToday(teacherId: number): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1
     FROM notifications
     WHERE user_id = $1
       AND type = 'teacher_creative_reminder'
       AND created_at::date = CURRENT_DATE
     LIMIT 1`,
    [teacherId],
  );
  return (result.rowCount || 0) > 0;
}

export async function runTeacherCreativeReminderJob(): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  if (teacherCreativeReminderLastRunDate === today) return;
  teacherCreativeReminderLastRunDate = today;

  try {
    const teachersRes = await pool.query<{ id: number }>(
      `SELECT id FROM users WHERE role = 'teacher'`,
    );

    let sent = 0;
    for (const row of teachersRes.rows) {
      try {
        if (await hasReminderToday(row.id)) continue;
        const result = await NotificationService.notifyTeacherCreativeReminder(row.id);
        if (result.success) sent++;
      } catch (error) {
        logger.error({ error, teacher_id: row.id }, '[TeacherCreativeReminder] Failed for teacher');
      }
    }

    logger.info(`[TeacherCreativeReminder] Sent to ${sent} teachers.`);
  } catch (error) {
    teacherCreativeReminderLastRunDate = '';
    logger.error({ error }, '[TeacherCreativeReminder] Job failed');
  }
}
