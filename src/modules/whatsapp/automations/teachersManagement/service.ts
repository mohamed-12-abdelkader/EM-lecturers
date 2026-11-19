import pool from '../../../../db/pool';
import { HttpError, logger } from '../../../../utils';
import { normalizePhone } from '../../gateway/whatsappGatewayClient';
import { WhatsAppOutboundQueue } from '../../queue/whatsappOutboundQueue';
import { SessionPoolService } from '../../routing/sessionPool.service';
import {
  DEFAULT_SUBSCRIPTION_ALERT_MESSAGE,
  TEACHERS_MANAGEMENT_BROADCAST_TRIGGER,
  TEACHERS_MANAGEMENT_KEY,
  TEACHERS_MANAGEMENT_SUBSCRIPTION_TRIGGER,
  TEACHERS_MANAGEMENT_TRIGGER,
  TEACHERS_MANAGEMENT_TZ,
} from './constants';
import {
  buildSubscriptionExpiredMessage,
  buildTeacherDailyReminderMessage,
} from './templates';

export type TeachersManagementSettings = {
  enabled: boolean;
  sendHour: number;
  sendMinute: number;
  teacherIds: number[] | null;
  subscriptionAlertEnabled: boolean;
  subscriptionAlertHour: number;
  subscriptionAlertMinute: number;
  subscriptionAlertMessage: string;
  serviceEnabled: boolean;
  serviceId: number | null;
  sessions: Array<{
    sessionSlug: string;
    status: string | null;
    isEnabled: boolean;
    role: string | null;
  }>;
};

function cairoNowParts() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TEACHERS_MANAGEMENT_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value || '00';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    hour: Number(get('hour')),
    minute: Number(get('minute')),
  };
}

function resolveTeacherPhone(row: {
  whatsapp_number?: string | null;
  phone?: string | null;
}): string | null {
  const raw = String(row.whatsapp_number || row.phone || '').trim();
  if (!raw) return null;
  try {
    return normalizePhone(raw);
  } catch {
    return null;
  }
}

export class TeachersManagementService {
  static async getSettings(): Promise<TeachersManagementSettings> {
    const settingsRes = await pool.query(
      `SELECT enabled, send_hour, send_minute, teacher_ids,
              subscription_alert_enabled, subscription_alert_hour,
              subscription_alert_minute, subscription_alert_message
       FROM teacher_schedule_reminder_settings WHERE id = 1`,
    );
    const settings = settingsRes.rows[0] || {
      enabled: false,
      send_hour: 7,
      send_minute: 0,
      teacher_ids: null,
      subscription_alert_enabled: false,
      subscription_alert_hour: 10,
      subscription_alert_minute: 0,
      subscription_alert_message: DEFAULT_SUBSCRIPTION_ALERT_MESSAGE,
    };

    const serviceRes = await pool.query(
      `SELECT id, is_enabled FROM wa_services WHERE key = $1`,
      [TEACHERS_MANAGEMENT_KEY],
    );
    const service = serviceRes.rows[0] || null;

    let sessions: TeachersManagementSettings['sessions'] = [];
    if (service) {
      const sessRes = await pool.query(
        `SELECT ss.session_slug, ss.role, s.status, s.is_enabled
         FROM wa_service_sessions ss
         LEFT JOIN wa_sessions s ON s.slug = ss.session_slug
         WHERE ss.service_id = $1
         ORDER BY ss.priority ASC, ss.id ASC`,
        [service.id],
      );
      sessions = sessRes.rows.map((row) => ({
        sessionSlug: row.session_slug,
        status: row.status,
        isEnabled: row.is_enabled !== false,
        role: row.role,
      }));
    }

    return {
      enabled: settings.enabled === true,
      sendHour: Number(settings.send_hour ?? 7),
      sendMinute: Number(settings.send_minute ?? 0),
      teacherIds: Array.isArray(settings.teacher_ids)
        ? settings.teacher_ids.map(Number)
        : null,
      subscriptionAlertEnabled: settings.subscription_alert_enabled === true,
      subscriptionAlertHour: Number(settings.subscription_alert_hour ?? 10),
      subscriptionAlertMinute: Number(settings.subscription_alert_minute ?? 0),
      subscriptionAlertMessage:
        String(settings.subscription_alert_message || '').trim() ||
        DEFAULT_SUBSCRIPTION_ALERT_MESSAGE,
      serviceEnabled: service?.is_enabled === true,
      serviceId: service ? Number(service.id) : null,
      sessions,
    };
  }

  static async saveSettings(patch: {
    enabled?: boolean;
    sendHour?: number;
    sendMinute?: number;
    teacherIds?: number[] | null;
    subscriptionAlertEnabled?: boolean;
    subscriptionAlertHour?: number;
    subscriptionAlertMinute?: number;
    subscriptionAlertMessage?: string;
    updatedBy?: number | null;
  }) {
    const current = await this.getSettings();
    const enabled =
      patch.enabled !== undefined ? Boolean(patch.enabled) : current.enabled;
    const sendHour =
      patch.sendHour !== undefined ? Number(patch.sendHour) : current.sendHour;
    const sendMinute =
      patch.sendMinute !== undefined
        ? Number(patch.sendMinute)
        : current.sendMinute;
    if (!Number.isInteger(sendHour) || sendHour < 0 || sendHour > 23) {
      throw new HttpError(400, 'sendHour must be 0-23');
    }
    if (!Number.isInteger(sendMinute) || sendMinute < 0 || sendMinute > 59) {
      throw new HttpError(400, 'sendMinute must be 0-59');
    }

    let teacherIds: number[] | null = current.teacherIds;
    if (patch.teacherIds !== undefined) {
      teacherIds =
        patch.teacherIds == null
          ? null
          : [...new Set(patch.teacherIds.map(Number).filter((n) => n > 0))];
    }

    const subscriptionAlertEnabled =
      patch.subscriptionAlertEnabled !== undefined
        ? Boolean(patch.subscriptionAlertEnabled)
        : current.subscriptionAlertEnabled;
    const subscriptionAlertHour =
      patch.subscriptionAlertHour !== undefined
        ? Number(patch.subscriptionAlertHour)
        : current.subscriptionAlertHour;
    const subscriptionAlertMinute =
      patch.subscriptionAlertMinute !== undefined
        ? Number(patch.subscriptionAlertMinute)
        : current.subscriptionAlertMinute;
    if (
      !Number.isInteger(subscriptionAlertHour) ||
      subscriptionAlertHour < 0 ||
      subscriptionAlertHour > 23
    ) {
      throw new HttpError(400, 'subscriptionAlertHour must be 0-23');
    }
    if (
      !Number.isInteger(subscriptionAlertMinute) ||
      subscriptionAlertMinute < 0 ||
      subscriptionAlertMinute > 59
    ) {
      throw new HttpError(400, 'subscriptionAlertMinute must be 0-59');
    }
    const subscriptionAlertMessage =
      patch.subscriptionAlertMessage !== undefined
        ? String(patch.subscriptionAlertMessage || '').trim() ||
          DEFAULT_SUBSCRIPTION_ALERT_MESSAGE
        : current.subscriptionAlertMessage;

    await pool.query(
      `INSERT INTO teacher_schedule_reminder_settings
         (id, enabled, send_hour, send_minute, teacher_ids,
          subscription_alert_enabled, subscription_alert_hour,
          subscription_alert_minute, subscription_alert_message,
          updated_at, updated_by)
       VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9)
       ON CONFLICT (id) DO UPDATE SET
         enabled = EXCLUDED.enabled,
         send_hour = EXCLUDED.send_hour,
         send_minute = EXCLUDED.send_minute,
         teacher_ids = EXCLUDED.teacher_ids,
         subscription_alert_enabled = EXCLUDED.subscription_alert_enabled,
         subscription_alert_hour = EXCLUDED.subscription_alert_hour,
         subscription_alert_minute = EXCLUDED.subscription_alert_minute,
         subscription_alert_message = EXCLUDED.subscription_alert_message,
         updated_at = NOW(),
         updated_by = EXCLUDED.updated_by`,
      [
        enabled,
        sendHour,
        sendMinute,
        teacherIds,
        subscriptionAlertEnabled,
        subscriptionAlertHour,
        subscriptionAlertMinute,
        subscriptionAlertMessage,
        patch.updatedBy ?? null,
      ],
    );

    return this.getSettings();
  }

  static async listLogs(opts: {
    q?: string;
    status?: string;
    limit?: number;
    page?: number;
  }) {
    const limit = Math.min(200, Math.max(1, Number(opts.limit) || 50));
    const page = Math.max(1, Number(opts.page) || 1);
    const offset = (page - 1) * limit;
    const values: unknown[] = [];
    const where: string[] = [];

    if (opts.status) {
      values.push(String(opts.status));
      where.push(`l.status = $${values.length}`);
    }
    if (opts.q?.trim()) {
      values.push(`%${opts.q.trim()}%`);
      where.push(
        `(u.name ILIKE $${values.length} OR COALESCE(l.phone,'') ILIKE $${values.length})`,
      );
    }

    values.push(limit);
    const limitIdx = values.length;
    values.push(offset);
    const offsetIdx = values.length;

    const res = await pool.query(
      `SELECT l.*, u.name AS teacher_name,
              j.status AS job_status, j.last_error AS job_error
       FROM teacher_schedule_reminder_logs l
       JOIN users u ON u.id = l.teacher_id
       LEFT JOIN wa_outbound_jobs j ON j.id = l.job_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY l.schedule_date DESC, l.id DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      values,
    );

    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS total
       FROM teacher_schedule_reminder_logs l
       JOIN users u ON u.id = l.teacher_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`,
      values.slice(0, values.length - 2),
    );

    return {
      rows: res.rows.map((row) => ({
        id: Number(row.id),
        teacherId: Number(row.teacher_id),
        teacherName: row.teacher_name,
        scheduleDate: row.schedule_date,
        status: row.status,
        phone: row.phone,
        body: row.body,
        error: row.error || row.job_error || null,
        taskCount: Number(row.task_count || 0),
        jobId: row.job_id,
        jobStatus: row.job_status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
      total: Number(countRes.rows[0]?.total || 0),
      page,
      limit,
    };
  }

  static async retryFailed(logIds?: number[]) {
    const values: unknown[] = [];
    let where = `l.status = 'failed'`;
    if (Array.isArray(logIds) && logIds.length) {
      values.push(logIds.map(Number));
      where += ` AND l.id = ANY($${values.length}::int[])`;
    }
    const res = await pool.query(
      `SELECT l.id, l.teacher_id, l.schedule_date, l.body, l.phone
       FROM teacher_schedule_reminder_logs l
       WHERE ${where}
       ORDER BY l.id ASC
       LIMIT 100`,
      values,
    );

    let retried = 0;
    for (const row of res.rows) {
      try {
        await this.enqueueForTeacher({
          teacherId: Number(row.teacher_id),
          scheduleDate: String(row.schedule_date).slice(0, 10),
          body: row.body,
          phone: row.phone,
          force: true,
          logId: Number(row.id),
        });
        retried += 1;
      } catch (err: any) {
        logger.warn(
          { err, logId: row.id },
          'Teachers management retry failed',
        );
      }
    }
    return { retried };
  }

  static async testSend(teacherId: number) {
    const teacher = await this.loadTeacher(teacherId);
    const phone = resolveTeacherPhone(teacher);
    if (!phone) {
      throw new HttpError(400, 'لا يوجد رقم واتساب/هاتف مسجل لهذا المدرس');
    }
    const { date } = cairoNowParts();
    const tasks = await this.loadTasksForDate(teacherId, date);
    if (!tasks.length) {
      throw new HttpError(400, 'لا توجد مهام لهذا المدرس اليوم لإرسال تذكير تجريبي');
    }
    const body = buildTeacherDailyReminderMessage(teacher.name || 'مستر', tasks);
    const result = await this.enqueueForTeacher({
      teacherId,
      scheduleDate: date,
      body,
      phone,
      force: true,
      taskCount: tasks.length,
      test: true,
    });
    return { ...result, body, taskCount: tasks.length, scheduleDate: date };
  }

  static async runDailySweep(): Promise<{ sent: number; skipped: number }> {
    const settings = await this.getSettings();
    if (!settings.enabled || !settings.serviceEnabled) {
      return { sent: 0, skipped: 0 };
    }

    const now = cairoNowParts();
    // Send once the Cairo clock reaches/exceeds the configured time (idempotent via logs).
    const nowMinutes = now.hour * 60 + now.minute;
    const targetMinutes = settings.sendHour * 60 + settings.sendMinute;
    if (nowMinutes < targetMinutes) {
      return { sent: 0, skipped: 0 };
    }

    const teachers = await this.listEligibleTeachers(settings.teacherIds);
    let sent = 0;
    let skipped = 0;

    for (const teacher of teachers) {
      const teacherId = Number(teacher.id);
      const existing = await pool.query(
        `SELECT id, status FROM teacher_schedule_reminder_logs
         WHERE teacher_id = $1 AND schedule_date = $2`,
        [teacherId, now.date],
      );
      if ((existing.rowCount ?? 0) > 0 && existing.rows[0].status !== 'failed') {
        skipped += 1;
        continue;
      }

      const tasks = await this.loadTasksForDate(teacherId, now.date);
      if (!tasks.length) {
        skipped += 1;
        continue;
      }

      const phone = resolveTeacherPhone(teacher);
      if (!phone) {
        await pool.query(
          `INSERT INTO teacher_schedule_reminder_logs
             (teacher_id, schedule_date, status, body, error, task_count)
           VALUES ($1,$2,'skipped','','لا يوجد رقم واتساب/هاتف', $3)
           ON CONFLICT (teacher_id, schedule_date) DO UPDATE SET
             status = 'skipped',
             error = EXCLUDED.error,
             task_count = EXCLUDED.task_count,
             updated_at = NOW()`,
          [teacherId, now.date, tasks.length],
        );
        skipped += 1;
        continue;
      }

      try {
        const body = buildTeacherDailyReminderMessage(
          teacher.name || 'مستر',
          tasks,
        );
        await this.enqueueForTeacher({
          teacherId,
          scheduleDate: now.date,
          body,
          phone,
          taskCount: tasks.length,
          force: (existing.rowCount ?? 0) > 0,
          logId: (existing.rowCount ?? 0) > 0 ? Number(existing.rows[0].id) : undefined,
        });
        sent += 1;
      } catch (err: any) {
        logger.error(
          { err, teacherId },
          'Teachers management daily send failed',
        );
        await pool.query(
          `INSERT INTO teacher_schedule_reminder_logs
             (teacher_id, schedule_date, status, body, phone, error, task_count)
           VALUES ($1,$2,'failed','',$3,$4,$5)
           ON CONFLICT (teacher_id, schedule_date) DO UPDATE SET
             status = 'failed',
             phone = EXCLUDED.phone,
             error = EXCLUDED.error,
             task_count = EXCLUDED.task_count,
             updated_at = NOW()`,
          [
            teacherId,
            now.date,
            phone,
            err?.message || 'send failed',
            tasks.length,
          ],
        );
      }
    }

    return { sent, skipped };
  }

  private static async loadTeacher(teacherId: number) {
    const res = await pool.query(
      `SELECT id, name, phone, whatsapp_number
       FROM users WHERE id = $1 AND role = 'teacher'`,
      [teacherId],
    );
    if (!res.rowCount) throw new HttpError(404, 'المدرس غير موجود');
    return res.rows[0];
  }

  private static async listEligibleTeachers(teacherIds: number[] | null) {
    if (Array.isArray(teacherIds) && teacherIds.length) {
      const res = await pool.query(
        `SELECT id, name, phone, whatsapp_number
         FROM users
         WHERE role = 'teacher' AND id = ANY($1::int[])
         ORDER BY id ASC`,
        [teacherIds],
      );
      return res.rows;
    }
    const res = await pool.query(
      `SELECT id, name, phone, whatsapp_number
       FROM users
       WHERE role = 'teacher'
         AND COALESCE(account_status, 'active') = 'active'
       ORDER BY id ASC`,
    );
    return res.rows;
  }

  private static async loadTasksForDate(teacherId: number, date: string) {
    const res = await pool.query(
      `SELECT task_type, title, course_name, start_time, end_time, due_at, meeting_url, notes
       FROM teacher_schedule_tasks
       WHERE teacher_id = $1 AND task_date = $2
       ORDER BY COALESCE(start_time, due_at::time, TIME '23:59:59') ASC, id ASC`,
      [teacherId, date],
    );
    return res.rows;
  }

  private static async enqueueForTeacher(opts: {
    teacherId: number;
    scheduleDate: string;
    body: string;
    phone: string;
    taskCount?: number;
    force?: boolean;
    test?: boolean;
    logId?: number;
  }) {
    const picked = await SessionPoolService.pickSession(
      TEACHERS_MANAGEMENT_KEY,
      opts.phone,
    );

    const jobId = await WhatsAppOutboundQueue.enqueue({
      sessionSlug: picked.sessionSlug,
      to: opts.phone,
      body: opts.body,
      serviceId: picked.serviceId,
      triggerType: opts.test
        ? `${TEACHERS_MANAGEMENT_TRIGGER}_test`
        : TEACHERS_MANAGEMENT_TRIGGER,
      triggerRef: `${opts.teacherId}:${opts.scheduleDate}`,
      metadata: {
        teacherId: opts.teacherId,
        scheduleDate: opts.scheduleDate,
        test: Boolean(opts.test),
      },
    });

    if (opts.logId) {
      await pool.query(
        `UPDATE teacher_schedule_reminder_logs
         SET job_id = $2,
             status = 'pending',
             body = $3,
             phone = $4,
             error = NULL,
             task_count = COALESCE($5, task_count),
             updated_at = NOW()
         WHERE id = $1`,
        [
          opts.logId,
          jobId,
          opts.body,
          opts.phone,
          opts.taskCount ?? null,
        ],
      );
    } else {
      await pool.query(
        `INSERT INTO teacher_schedule_reminder_logs
           (teacher_id, schedule_date, job_id, status, body, phone, task_count)
         VALUES ($1,$2,$3,'pending',$4,$5,$6)
         ON CONFLICT (teacher_id, schedule_date) DO UPDATE SET
           job_id = EXCLUDED.job_id,
           status = 'pending',
           body = EXCLUDED.body,
           phone = EXCLUDED.phone,
           error = NULL,
           task_count = EXCLUDED.task_count,
           updated_at = NOW()`,
        [
          opts.teacherId,
          opts.scheduleDate,
          jobId,
          opts.body,
          opts.phone,
          opts.taskCount ?? 0,
        ],
      );
    }

    return { jobId, sessionSlug: picked.sessionSlug };
  }

  /** Broadcast text / image / video (WhatsApp-style parts) to teachers. */
  static async broadcast(input: {
    body?: string | null;
    imageUrl?: string | null;
    videoUrl?: string | null;
    teacherIds?: number[] | null;
    createdBy?: number | null;
  }) {
    const body = String(input.body || '').trim();
    const imageUrl = String(input.imageUrl || '').trim() || null;
    const videoUrl = String(input.videoUrl || '').trim() || null;
    if (!body && !imageUrl && !videoUrl) {
      throw new HttpError(400, 'أدخل نصًا أو صورة أو فيديو على الأقل');
    }
    for (const url of [imageUrl, videoUrl]) {
      if (url && !/^https?:\/\//i.test(url)) {
        throw new HttpError(400, 'روابط الوسائط يجب أن تبدأ بـ http أو https');
      }
    }

    const teachers = await this.listBroadcastTeachers(
      Array.isArray(input.teacherIds) && input.teacherIds.length
        ? input.teacherIds
        : null,
    );
    if (!teachers.length) {
      throw new HttpError(400, 'لا يوجد مدرسون لإرسال الرسالة');
    }

    const targetMode =
      Array.isArray(input.teacherIds) && input.teacherIds.length
        ? 'selected'
        : 'all';

    const broadcastRes = await pool.query(
      `INSERT INTO teacher_wa_broadcasts
         (body, image_url, video_url, target_mode, teacher_ids, status,
          target_count, created_by)
       VALUES ($1,$2,$3,$4,$5,'sending',$6,$7)
       RETURNING id`,
      [
        body,
        imageUrl,
        videoUrl,
        targetMode,
        targetMode === 'selected' ? input.teacherIds : null,
        teachers.length,
        input.createdBy ?? null,
      ],
    );
    const broadcastId = Number(broadcastRes.rows[0].id);

    const parts: Array<{ kind: 'text' | 'image' | 'video'; body: string; mediaUrl: string | null }> =
      [];
    if (imageUrl) {
      parts.push({ kind: 'image', body, mediaUrl: imageUrl });
      if (videoUrl) parts.push({ kind: 'video', body: '', mediaUrl: videoUrl });
    } else if (videoUrl) {
      parts.push({ kind: 'video', body, mediaUrl: videoUrl });
    } else {
      parts.push({ kind: 'text', body, mediaUrl: null });
    }

    let enqueued = 0;
    for (const teacher of teachers) {
      const teacherId = Number(teacher.id);
      const phone = resolveTeacherPhone(teacher);
      if (!phone) {
        await pool.query(
          `INSERT INTO teacher_wa_broadcast_recipients
             (broadcast_id, teacher_id, phone, part_kind, status, error)
           VALUES ($1,$2,NULL,'text','skipped','لا يوجد رقم واتساب/هاتف')`,
          [broadcastId, teacherId],
        );
        continue;
      }

      for (const part of parts) {
        try {
          const picked = await SessionPoolService.pickSession(
            TEACHERS_MANAGEMENT_KEY,
            phone,
          );
          const jobId = await WhatsAppOutboundQueue.enqueue({
            sessionSlug: picked.sessionSlug,
            to: phone,
            body: part.body || '',
            mediaUrl: part.mediaUrl,
            serviceId: picked.serviceId,
            triggerType: TEACHERS_MANAGEMENT_BROADCAST_TRIGGER,
            triggerRef: `${broadcastId}:${teacherId}:${part.kind}`,
            metadata: {
              broadcastId,
              teacherId,
              partKind: part.kind,
            },
          });
          await pool.query(
            `INSERT INTO teacher_wa_broadcast_recipients
               (broadcast_id, teacher_id, phone, part_kind, job_id, status)
             VALUES ($1,$2,$3,$4,$5,'pending')`,
            [broadcastId, teacherId, phone, part.kind, jobId],
          );
          enqueued += 1;
        } catch (err: any) {
          await pool.query(
            `INSERT INTO teacher_wa_broadcast_recipients
               (broadcast_id, teacher_id, phone, part_kind, status, error)
             VALUES ($1,$2,$3,$4,'failed',$5)`,
            [
              broadcastId,
              teacherId,
              phone,
              part.kind,
              err?.message || 'enqueue failed',
            ],
          );
        }
      }
    }

    await pool.query(
      `UPDATE teacher_wa_broadcasts
       SET enqueued_count = $2,
           status = 'done',
           updated_at = NOW()
       WHERE id = $1`,
      [broadcastId, enqueued],
    );

    return {
      broadcastId,
      targetCount: teachers.length,
      enqueuedCount: enqueued,
      parts: parts.map((p) => p.kind),
    };
  }

  static async listBroadcasts(opts: { limit?: number; page?: number } = {}) {
    const limit = Math.min(100, Math.max(1, Number(opts.limit) || 20));
    const page = Math.max(1, Number(opts.page) || 1);
    const offset = (page - 1) * limit;
    const res = await pool.query(
      `SELECT b.*,
              (SELECT COUNT(*)::int FROM teacher_wa_broadcast_recipients r
               WHERE r.broadcast_id = b.id AND r.status = 'sent') AS sent_count,
              (SELECT COUNT(*)::int FROM teacher_wa_broadcast_recipients r
               WHERE r.broadcast_id = b.id AND r.status = 'failed') AS failed_count,
              (SELECT COUNT(*)::int FROM teacher_wa_broadcast_recipients r
               WHERE r.broadcast_id = b.id AND r.status = 'skipped') AS skipped_count
       FROM teacher_wa_broadcasts b
       ORDER BY b.id DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS total FROM teacher_wa_broadcasts`,
    );
    return {
      rows: res.rows.map((row) => ({
        id: Number(row.id),
        body: row.body,
        imageUrl: row.image_url,
        videoUrl: row.video_url,
        targetMode: row.target_mode,
        status: row.status,
        targetCount: Number(row.target_count || 0),
        enqueuedCount: Number(row.enqueued_count || 0),
        sentCount: Number(row.sent_count || 0),
        failedCount: Number(row.failed_count || 0),
        skippedCount: Number(row.skipped_count || 0),
        createdAt: row.created_at,
      })),
      total: Number(countRes.rows[0]?.total || 0),
      page,
      limit,
    };
  }

  static async listSubscriptionAlertLogs(opts: {
    q?: string;
    status?: string;
    limit?: number;
    page?: number;
  }) {
    const limit = Math.min(200, Math.max(1, Number(opts.limit) || 50));
    const page = Math.max(1, Number(opts.page) || 1);
    const offset = (page - 1) * limit;
    const values: unknown[] = [];
    const where: string[] = [];
    if (opts.status) {
      values.push(String(opts.status));
      where.push(`l.status = $${values.length}`);
    }
    if (opts.q?.trim()) {
      values.push(`%${opts.q.trim()}%`);
      where.push(
        `(u.name ILIKE $${values.length} OR COALESCE(l.phone,'') ILIKE $${values.length})`,
      );
    }
    values.push(limit);
    const limitIdx = values.length;
    values.push(offset);
    const offsetIdx = values.length;

    const res = await pool.query(
      `SELECT l.*, u.name AS teacher_name,
              j.status AS job_status, j.last_error AS job_error
       FROM teacher_subscription_alert_logs l
       JOIN users u ON u.id = l.teacher_id
       LEFT JOIN wa_outbound_jobs j ON j.id = l.job_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY l.schedule_date DESC, l.id DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      values,
    );
    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS total
       FROM teacher_subscription_alert_logs l
       JOIN users u ON u.id = l.teacher_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`,
      values.slice(0, values.length - 2),
    );
    return {
      rows: res.rows.map((row) => ({
        id: Number(row.id),
        teacherId: Number(row.teacher_id),
        teacherName: row.teacher_name,
        scheduleDate: row.schedule_date,
        endsAt: row.ends_at,
        status: row.status,
        phone: row.phone,
        body: row.body,
        error: row.error || row.job_error || null,
        jobId: row.job_id,
        createdAt: row.created_at,
      })),
      total: Number(countRes.rows[0]?.total || 0),
      page,
      limit,
    };
  }

  static async runSubscriptionAlertSweep(): Promise<{
    sent: number;
    skipped: number;
  }> {
    const settings = await this.getSettings();
    if (!settings.subscriptionAlertEnabled || !settings.serviceEnabled) {
      return { sent: 0, skipped: 0 };
    }

    const now = cairoNowParts();
    const nowMinutes = now.hour * 60 + now.minute;
    const targetMinutes =
      settings.subscriptionAlertHour * 60 + settings.subscriptionAlertMinute;
    if (nowMinutes < targetMinutes) {
      return { sent: 0, skipped: 0 };
    }

    const teachers = await this.listExpiredSubscriptionTeachers();
    let sent = 0;
    let skipped = 0;

    for (const teacher of teachers) {
      const teacherId = Number(teacher.id);
      const existing = await pool.query(
        `SELECT id, status FROM teacher_subscription_alert_logs
         WHERE teacher_id = $1 AND schedule_date = $2`,
        [teacherId, now.date],
      );
      if ((existing.rowCount ?? 0) > 0 && existing.rows[0].status !== 'failed') {
        skipped += 1;
        continue;
      }

      const phone = resolveTeacherPhone(teacher);
      const endsAt = teacher.ends_at
        ? String(teacher.ends_at).slice(0, 10)
        : null;
      const body = buildSubscriptionExpiredMessage(
        teacher.name || 'مستر',
        settings.subscriptionAlertMessage,
        endsAt,
      );

      if (!phone) {
        await pool.query(
          `INSERT INTO teacher_subscription_alert_logs
             (teacher_id, schedule_date, ends_at, status, body, error)
           VALUES ($1,$2,$3,'skipped',$4,'لا يوجد رقم واتساب/هاتف')
           ON CONFLICT (teacher_id, schedule_date) DO UPDATE SET
             status = 'skipped',
             error = EXCLUDED.error,
             ends_at = EXCLUDED.ends_at,
             updated_at = NOW()`,
          [teacherId, now.date, endsAt, body],
        );
        skipped += 1;
        continue;
      }

      try {
        const picked = await SessionPoolService.pickSession(
          TEACHERS_MANAGEMENT_KEY,
          phone,
        );
        const jobId = await WhatsAppOutboundQueue.enqueue({
          sessionSlug: picked.sessionSlug,
          to: phone,
          body,
          serviceId: picked.serviceId,
          triggerType: TEACHERS_MANAGEMENT_SUBSCRIPTION_TRIGGER,
          triggerRef: `${teacherId}:${now.date}`,
          metadata: { teacherId, scheduleDate: now.date, endsAt },
        });

        if ((existing.rowCount ?? 0) > 0) {
          await pool.query(
            `UPDATE teacher_subscription_alert_logs
             SET job_id = $2, status = 'pending', body = $3, phone = $4,
                 ends_at = $5, error = NULL, updated_at = NOW()
             WHERE id = $1`,
            [existing.rows[0].id, jobId, body, phone, endsAt],
          );
        } else {
          await pool.query(
            `INSERT INTO teacher_subscription_alert_logs
               (teacher_id, schedule_date, ends_at, job_id, status, body, phone)
             VALUES ($1,$2,$3,$4,'pending',$5,$6)`,
            [teacherId, now.date, endsAt, jobId, body, phone],
          );
        }
        sent += 1;
      } catch (err: any) {
        logger.error(
          { err, teacherId },
          'Teachers management subscription alert failed',
        );
        await pool.query(
          `INSERT INTO teacher_subscription_alert_logs
             (teacher_id, schedule_date, ends_at, status, body, phone, error)
           VALUES ($1,$2,$3,'failed',$4,$5,$6)
           ON CONFLICT (teacher_id, schedule_date) DO UPDATE SET
             status = 'failed',
             body = EXCLUDED.body,
             phone = EXCLUDED.phone,
             error = EXCLUDED.error,
             ends_at = EXCLUDED.ends_at,
             updated_at = NOW()`,
          [
            teacherId,
            now.date,
            endsAt,
            body,
            phone,
            err?.message || 'send failed',
          ],
        );
      }
    }

    return { sent, skipped };
  }

  private static async listBroadcastTeachers(teacherIds: number[] | null) {
    if (Array.isArray(teacherIds) && teacherIds.length) {
      const res = await pool.query(
        `SELECT id, name, phone, whatsapp_number
         FROM users
         WHERE role = 'teacher' AND id = ANY($1::int[])
         ORDER BY id ASC`,
        [teacherIds],
      );
      return res.rows;
    }
    const res = await pool.query(
      `SELECT id, name, phone, whatsapp_number
       FROM users
       WHERE role = 'teacher'
       ORDER BY id ASC`,
    );
    return res.rows;
  }

  private static async listExpiredSubscriptionTeachers() {
    const res = await pool.query(
      `WITH latest AS (
         SELECT DISTINCT ON (s.teacher_id)
           s.teacher_id, s.ends_at, s.status
         FROM teacher_platform_subscriptions s
         WHERE s.status <> 'cancelled'
         ORDER BY s.teacher_id, s.ends_at DESC, s.id DESC
       )
       SELECT u.id, u.name, u.phone, u.whatsapp_number, l.ends_at, l.status AS sub_status
       FROM users u
       JOIN latest l ON l.teacher_id = u.id
       WHERE u.role = 'teacher'
         AND l.ends_at < (NOW() AT TIME ZONE 'Africa/Cairo')::date
         AND NOT EXISTS (
           SELECT 1
           FROM teacher_platform_subscriptions a
           WHERE a.teacher_id = u.id
             AND a.status = 'active'
             AND a.ends_at >= (NOW() AT TIME ZONE 'Africa/Cairo')::date
         )
       ORDER BY u.id ASC`,
    );
    return res.rows;
  }
}

/** Sync reminder / broadcast / subscription log statuses from outbound jobs. */
export async function syncTeachersManagementLogStatuses() {
  await pool.query(
    `UPDATE teacher_schedule_reminder_logs l
     SET status = CASE
           WHEN j.status = 'sent' THEN 'sent'
           WHEN j.status IN ('failed', 'dead') THEN 'failed'
           ELSE l.status
         END,
         error = CASE
           WHEN j.status IN ('failed', 'dead') THEN COALESCE(j.last_error, l.error)
           WHEN j.status = 'sent' THEN NULL
           ELSE l.error
         END,
         updated_at = NOW()
     FROM wa_outbound_jobs j
     WHERE l.job_id = j.id
       AND l.status IN ('pending', 'failed')
       AND j.status IN ('sent', 'failed', 'dead')`,
  );

  await pool.query(
    `UPDATE teacher_wa_broadcast_recipients r
     SET status = CASE
           WHEN j.status = 'sent' THEN 'sent'
           WHEN j.status IN ('failed', 'dead') THEN 'failed'
           ELSE r.status
         END,
         error = CASE
           WHEN j.status IN ('failed', 'dead') THEN COALESCE(j.last_error, r.error)
           WHEN j.status = 'sent' THEN NULL
           ELSE r.error
         END,
         updated_at = NOW()
     FROM wa_outbound_jobs j
     WHERE r.job_id = j.id
       AND r.status IN ('pending', 'failed')
       AND j.status IN ('sent', 'failed', 'dead')`,
  );

  await pool.query(
    `UPDATE teacher_subscription_alert_logs l
     SET status = CASE
           WHEN j.status = 'sent' THEN 'sent'
           WHEN j.status IN ('failed', 'dead') THEN 'failed'
           ELSE l.status
         END,
         error = CASE
           WHEN j.status IN ('failed', 'dead') THEN COALESCE(j.last_error, l.error)
           WHEN j.status = 'sent' THEN NULL
           ELSE l.error
         END,
         updated_at = NOW()
     FROM wa_outbound_jobs j
     WHERE l.job_id = j.id
       AND l.status IN ('pending', 'failed')
       AND j.status IN ('sent', 'failed', 'dead')`,
  );
}
