import pool from '../../../db/pool';
import { HttpError } from '../../../utils';
import {
  createSession,
  deleteSession,
  getSession,
  isWhatsAppConfigured,
  reconnectSession,
  type GatewaySession,
} from '../gateway/whatsappGatewayClient';
import type { WaServiceRow, WaSessionRow } from '../automations/types';
import { TeacherReportsService } from '../../../services/teacherReports';
import { TeacherWhatsAppSend } from './teacherWhatsAppSend';

const TEACHER_SERVICE_KEYS = ['teacher_student_notify', 'teacher_parent_report'] as const;
const MAX_SESSIONS_PER_TEACHER = 2;
const MAX_NOTIFY_RECIPIENTS = 50;
const MAX_NOTIFY_CHARS = 1000;
const MAX_REPORT_CHARS = 1500;

export type TeacherMergedSession = GatewaySession & {
  label: string | null;
  is_enabled: boolean;
  teacher_id: number;
  last_ready_at: Date | null;
  last_error: string | null;
  local_id: number | null;
};

function parseConfig(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return raw as Record<string, unknown>;
}

function nextTeacherSlug(teacherId: number, existingSlugs: string[]): string {
  for (let n = 1; n <= MAX_SESSIONS_PER_TEACHER; n++) {
    const slug = `t${teacherId}-${String(n).padStart(2, '0')}`;
    if (!existingSlugs.includes(slug)) return slug;
  }
  throw new HttpError(400, `يمكنك ربط ${MAX_SESSIONS_PER_TEACHER} أرقام كحد أقصى`);
}

function truncate(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function buildParentReportText(
  report: Awaited<ReturnType<typeof TeacherReportsService.getStudentDetailedReport>>,
): string {
  const studentName = report.student?.name || 'الطالب';
  const lines: string[] = [
    `تقرير ولي الأمر — ${studentName}`,
    '',
  ];

  const courses = Array.isArray(report.courses) ? report.courses : [];
  if (courses.length === 0) {
    lines.push('لا توجد كورسات مسجّلة حالياً.');
  } else {
    lines.push(`الكورسات (${courses.length}):`);
    for (const c of courses.slice(0, 6)) {
      const title = c.courseTitle || 'كورس';
      const watch = c.statistics?.watch_percentage ?? c.watch_percentage ?? 0;
      const avg = c.statistics?.averageGrade ?? 0;
      const submitted = c.statistics?.submittedExams ?? 0;
      const totalExams = c.statistics?.totalExams ?? 0;
      lines.push(
        `• ${title}: مشاهدة ${watch}% | امتحانات ${submitted}/${totalExams} | متوسط ${avg}%`,
      );
    }
  }

  if (report.overallStatistics) {
    const o = report.overallStatistics;
    lines.push('');
    lines.push(
      `ملخص عام: مشاهدة ${o.watch_percentage ?? 0}% — امتحانات ${o.submittedExams ?? 0}/${o.totalExams ?? 0} — متوسط ${o.overallAverageGrade ?? 0}%`,
    );
  }

  lines.push('');
  lines.push('هذه رسالة تلقائية من منصة المدرس عبر واتساب.');
  return truncate(lines.join('\n'), MAX_REPORT_CHARS);
}

export class TeacherWhatsAppService {
  static isConfigured(): boolean {
    return isWhatsAppConfigured();
  }

  static async assertOwnedSession(teacherId: number, slug: string): Promise<WaSessionRow> {
    const result = await pool.query<WaSessionRow>(
      `SELECT * FROM wa_sessions WHERE slug = $1 AND teacher_id = $2`,
      [slug, teacherId],
    );
    if (!result.rowCount) {
      throw new HttpError(403, 'هذه الجلسة غير تابعة لك');
    }
    return result.rows[0];
  }

  static async getStatus(teacherId: number) {
    const counts = await pool.query<{ status: string; cnt: string }>(
      `SELECT status, COUNT(*)::text AS cnt
       FROM wa_sessions
       WHERE teacher_id = $1
       GROUP BY status`,
      [teacherId],
    );
    const byStatus: Record<string, number> = {};
    let total = 0;
    for (const row of counts.rows) {
      const n = Number(row.cnt) || 0;
      byStatus[row.status] = n;
      total += n;
    }
    return {
      configured: isWhatsAppConfigured(),
      total,
      ready: byStatus.ready || 0,
      pending: (byStatus.pending || 0) + (byStatus.qr || 0) + (byStatus.authenticated || 0),
      by_status: byStatus,
      max_sessions: MAX_SESSIONS_PER_TEACHER,
    };
  }

  static async listServices(teacherId: number) {
    const services = await pool.query<WaServiceRow>(
      `SELECT * FROM wa_services
       WHERE key = ANY($1::text[])
       ORDER BY id ASC`,
      [TEACHER_SERVICE_KEYS as unknown as string[]],
    );

    const assigned = await pool.query<{
      service_key: string;
      session_slug: string;
      weight: number;
      priority: number;
      role: string;
      is_enabled: boolean;
      status: string;
      phone_number: string | null;
    }>(
      `SELECT sv.key AS service_key, ps.session_slug, ps.weight, ps.priority, ps.role,
              ps.is_enabled, s.status, s.phone_number
       FROM wa_service_sessions ps
       JOIN wa_services sv ON sv.id = ps.service_id
       JOIN wa_sessions s ON s.slug = ps.session_slug
       WHERE sv.key = ANY($1::text[])
         AND s.teacher_id = $2
       ORDER BY ps.priority DESC, ps.session_slug ASC`,
      [TEACHER_SERVICE_KEYS as unknown as string[], teacherId],
    );

    const byKey = new Map<string, typeof assigned.rows>();
    for (const row of assigned.rows) {
      const list = byKey.get(row.service_key) || [];
      list.push(row);
      byKey.set(row.service_key, list);
    }

    return services.rows.map((svc) => ({
      ...svc,
      config: parseConfig(svc.config),
      assigned_sessions: byKey.get(svc.key) || [],
    }));
  }

  static async replaceServiceSessions(
    teacherId: number,
    serviceKey: string,
    sessionSlugs: string[],
  ) {
    if (!(TEACHER_SERVICE_KEYS as readonly string[]).includes(serviceKey)) {
      throw new HttpError(400, 'خدمة غير مسموحة للمدرس');
    }

    const serviceRes = await pool.query<{ id: number }>(
      `SELECT id FROM wa_services WHERE key = $1`,
      [serviceKey],
    );
    if (!serviceRes.rowCount) throw new HttpError(404, 'الخدمة غير موجودة');
    const serviceId = serviceRes.rows[0].id;

    const uniqueSlugs = [...new Set(sessionSlugs.map((s) => String(s || '').trim()).filter(Boolean))];

    if (uniqueSlugs.length) {
      const owned = await pool.query<{ slug: string }>(
        `SELECT slug FROM wa_sessions
         WHERE teacher_id = $1 AND slug = ANY($2::text[])`,
        [teacherId, uniqueSlugs],
      );
      if (owned.rowCount !== uniqueSlugs.length) {
        throw new HttpError(400, 'يمكن تعيين جلساتك فقط لهذه الخدمة');
      }
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `DELETE FROM wa_service_sessions ps
         USING wa_sessions s
         WHERE ps.service_id = $1
           AND ps.session_slug = s.slug
           AND s.teacher_id = $2`,
        [serviceId, teacherId],
      );

      for (const slug of uniqueSlugs) {
        await client.query(
          `INSERT INTO wa_service_sessions
             (service_id, session_slug, weight, priority, role, is_enabled)
           VALUES ($1, $2, 1, 0, 'primary', TRUE)
           ON CONFLICT (service_id, session_slug) DO UPDATE SET
             is_enabled = TRUE`,
          [serviceId, slug],
        );
      }

      if (uniqueSlugs.length > 0) {
        await client.query(
          `UPDATE wa_services SET is_enabled = TRUE, updated_at = NOW() WHERE id = $1`,
          [serviceId],
        );
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    return this.listServices(teacherId);
  }

  static async listSessions(teacherId: number): Promise<TeacherMergedSession[]> {
    const local = await pool.query<WaSessionRow>(
      `SELECT * FROM wa_sessions WHERE teacher_id = $1 ORDER BY slug ASC`,
      [teacherId],
    );

    const merged: TeacherMergedSession[] = [];
    for (const loc of local.rows) {
      let gw: GatewaySession | null = null;
      if (isWhatsAppConfigured()) {
        try {
          gw = await getSession(loc.slug);
          await pool.query(
            `UPDATE wa_sessions SET
               phone_number = COALESCE($2::varchar, phone_number),
               status = $3::varchar,
               last_ready_at = CASE
                 WHEN $3::varchar = 'ready' THEN COALESCE(last_ready_at, NOW())
                 ELSE last_ready_at
               END,
               last_error = CASE WHEN $3::varchar = 'ready' THEN NULL ELSE last_error END,
               updated_at = NOW()
             WHERE slug = $1`,
            [loc.slug, gw.phone_number ?? null, gw.status || loc.status],
          );
        } catch {
          gw = null;
        }
      }

      const refreshed = gw
        ? (
            await pool.query<WaSessionRow>(`SELECT * FROM wa_sessions WHERE slug = $1`, [loc.slug])
          ).rows[0]
        : loc;

      merged.push({
        id: refreshed.slug,
        status: gw?.status || refreshed.status,
        phone_number: gw?.phone_number ?? refreshed.phone_number,
        qr: gw?.qr ?? null,
        label: refreshed.label,
        is_enabled: refreshed.is_enabled,
        teacher_id: teacherId,
        last_ready_at: refreshed.last_ready_at,
        last_error: refreshed.last_error,
        local_id: refreshed.id,
      });
    }
    return merged;
  }

  static async createSession(teacherId: number, label?: string | null): Promise<TeacherMergedSession> {
    if (!isWhatsAppConfigured()) {
      throw new HttpError(503, 'بوابة واتساب غير مُعدّة حالياً');
    }

    const existing = await pool.query<{ slug: string }>(
      `SELECT slug FROM wa_sessions WHERE teacher_id = $1`,
      [teacherId],
    );
    if ((existing.rowCount ?? 0) >= MAX_SESSIONS_PER_TEACHER) {
      throw new HttpError(400, `يمكنك ربط ${MAX_SESSIONS_PER_TEACHER} أرقام كحد أقصى`);
    }

    const slug = nextTeacherSlug(
      teacherId,
      existing.rows.map((r) => r.slug),
    );

    const gw = await createSession(slug);
    await pool.query(
      `INSERT INTO wa_sessions (slug, label, phone_number, status, teacher_id, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (slug) DO UPDATE SET
         label = COALESCE(EXCLUDED.label, wa_sessions.label),
         phone_number = COALESCE(EXCLUDED.phone_number, wa_sessions.phone_number),
         status = EXCLUDED.status,
         teacher_id = COALESCE(wa_sessions.teacher_id, EXCLUDED.teacher_id),
         updated_at = NOW()`,
      [slug, label || null, gw.phone_number ?? null, gw.status || 'pending', teacherId],
    );

    const sessions = await this.listSessions(teacherId);
    const created = sessions.find((s) => s.id === slug);
    if (!created) throw new HttpError(500, 'تعذّر إنشاء الجلسة');
    return created;
  }

  static async getSession(teacherId: number, slug: string): Promise<TeacherMergedSession> {
    await this.assertOwnedSession(teacherId, slug);
    if (!isWhatsAppConfigured()) {
      throw new HttpError(503, 'بوابة واتساب غير مُعدّة حالياً');
    }
    const gw = await getSession(slug);
    await pool.query(
      `UPDATE wa_sessions SET
         phone_number = COALESCE($2::varchar, phone_number),
         status = $3::varchar,
         last_ready_at = CASE
           WHEN $3::varchar = 'ready' THEN COALESCE(last_ready_at, NOW())
           ELSE last_ready_at
         END,
         updated_at = NOW()
       WHERE slug = $1 AND teacher_id = $4`,
      [slug, gw.phone_number ?? null, gw.status || 'pending', teacherId],
    );
    const sessions = await this.listSessions(teacherId);
    const found = sessions.find((s) => s.id === slug);
    if (!found) throw new HttpError(404, 'الجلسة غير موجودة');
    return { ...found, qr: gw.qr ?? found.qr };
  }

  static async reconnectSession(teacherId: number, slug: string): Promise<TeacherMergedSession> {
    await this.assertOwnedSession(teacherId, slug);
    if (!isWhatsAppConfigured()) {
      throw new HttpError(503, 'بوابة واتساب غير مُعدّة حالياً');
    }
    await reconnectSession(slug);
    return this.getSession(teacherId, slug);
  }

  static async deleteSession(teacherId: number, slug: string): Promise<void> {
    await this.assertOwnedSession(teacherId, slug);
    if (isWhatsAppConfigured()) {
      try {
        await deleteSession(slug);
      } catch (err: unknown) {
        const status = (err as { response?: { status?: number } })?.response?.status;
        if (status !== 404) throw err;
      }
    }
    await pool.query(`DELETE FROM wa_service_sessions WHERE session_slug = $1`, [slug]);
    await pool.query(`DELETE FROM wa_sessions WHERE slug = $1 AND teacher_id = $2`, [
      slug,
      teacherId,
    ]);
  }

  static async notifyStudents(
    teacherId: number,
    message: string,
    studentIds: number[],
  ): Promise<{
    sent: { student_id: number; phone: string; job_id: number }[];
    skipped: { student_id: number; reason: string }[];
    failed: { student_id: number; reason: string }[];
  }> {
    const body = String(message || '').trim();
    if (body.length < 1 || body.length > MAX_NOTIFY_CHARS) {
      throw new HttpError(400, `نص الرسالة يجب أن يكون بين 1 و ${MAX_NOTIFY_CHARS} حرفاً`);
    }

    const ids = [...new Set(studentIds.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0))];
    if (!ids.length) throw new HttpError(400, 'اختر طالباً واحداً على الأقل');
    if (ids.length > MAX_NOTIFY_RECIPIENTS) {
      throw new HttpError(400, `الحد الأقصى ${MAX_NOTIFY_RECIPIENTS} مستلماً في الطلب الواحد`);
    }

    const students = await pool.query<{ id: number; phone: string | null; name: string }>(
      `SELECT DISTINCT u.id, u.phone, u.name
       FROM users u
       JOIN enrollments e ON e.user_id = u.id
       JOIN courses c ON c.id = e.course_id
       WHERE c.teacher_id = $1
         AND u.role = 'student'
         AND u.id = ANY($2::int[])`,
      [teacherId, ids],
    );
    const byId = new Map(students.rows.map((s) => [s.id, s]));

    const sent: { student_id: number; phone: string; job_id: number }[] = [];
    const skipped: { student_id: number; reason: string }[] = [];
    const failed: { student_id: number; reason: string }[] = [];

    for (const id of ids) {
      const student = byId.get(id);
      if (!student) {
        skipped.push({ student_id: id, reason: 'الطالب غير مشترك في كورساتك' });
        continue;
      }
      const phone = (student.phone || '').trim();
      if (!phone) {
        skipped.push({ student_id: id, reason: 'لا يوجد رقم هاتف للطالب' });
        continue;
      }
      try {
        const result = await TeacherWhatsAppSend.enqueue(
          teacherId,
          'teacher_student_notify',
          phone,
          body,
          { student_id: id, kind: 'student_notify' },
        );
        sent.push({ student_id: id, phone: result.toPhone, job_id: result.jobId });
      } catch (err: unknown) {
        failed.push({
          student_id: id,
          reason: err instanceof HttpError ? err.message : 'فشل الإرسال',
        });
      }
    }

    return { sent, skipped, failed };
  }

  static async sendParentReports(
    teacherId: number,
    studentIds: number[],
  ): Promise<{
    sent: { student_id: number; phone: string; job_id: number }[];
    skipped: { student_id: number; reason: string }[];
    failed: { student_id: number; reason: string }[];
  }> {
    const ids = [...new Set(studentIds.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0))];
    if (!ids.length) throw new HttpError(400, 'اختر طالباً واحداً على الأقل');
    if (ids.length > MAX_NOTIFY_RECIPIENTS) {
      throw new HttpError(400, `الحد الأقصى ${MAX_NOTIFY_RECIPIENTS} مستلماً في الطلب الواحد`);
    }

    const students = await pool.query<{
      id: number;
      phone: string | null;
      parent_phone: string | null;
      name: string;
    }>(
      `SELECT DISTINCT u.id, u.phone, u.parent_phone, u.name
       FROM users u
       JOIN enrollments e ON e.user_id = u.id
       JOIN courses c ON c.id = e.course_id
       WHERE c.teacher_id = $1
         AND u.role = 'student'
         AND u.id = ANY($2::int[])`,
      [teacherId, ids],
    );
    const byId = new Map(students.rows.map((s) => [s.id, s]));

    const sent: { student_id: number; phone: string; job_id: number }[] = [];
    const skipped: { student_id: number; reason: string }[] = [];
    const failed: { student_id: number; reason: string }[] = [];

    for (const id of ids) {
      const student = byId.get(id);
      if (!student) {
        skipped.push({ student_id: id, reason: 'الطالب غير مشترك في كورساتك' });
        continue;
      }
      const phone = (student.parent_phone || student.phone || '').trim();
      if (!phone) {
        skipped.push({ student_id: id, reason: 'لا يوجد رقم ولي أمر ولا رقم طالب' });
        continue;
      }

      try {
        const report = await TeacherReportsService.getStudentDetailedReport(teacherId, id);
        const body = buildParentReportText(report);
        const result = await TeacherWhatsAppSend.enqueue(
          teacherId,
          'teacher_parent_report',
          phone,
          body,
          { student_id: id, kind: 'parent_report' },
        );
        sent.push({ student_id: id, phone: result.toPhone, job_id: result.jobId });
      } catch (err: unknown) {
        failed.push({
          student_id: id,
          reason: err instanceof HttpError ? err.message : 'فشل إرسال التقرير',
        });
      }
    }

    return { sent, skipped, failed };
  }
}
