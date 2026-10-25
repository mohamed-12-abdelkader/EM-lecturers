import { AsyncLocalStorage } from 'node:async_hooks';
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import pool from '../../../../db/pool';
import { HttpError } from '../../../../utils';
import { WhatsAppOutboundQueue } from '../../queue/whatsappOutboundQueue';
import { SessionPoolService } from '../../routing/sessionPool.service';
import { PARENTS_EXAM_NOTIFY_KEY, PARENTS_EXAM_PACE_LOCK, type ExamCohort } from './constants';
import { parseParentsExamConfig, parseTeacherExamPrefs, type ParentsExamConfig, type TeacherExamPrefs } from './settings';
import type {
  ExamState,
  NotificationState,
  ParentsExamStore,
  ServiceState,
  StudentState,
  UpcomingSend,
} from './store';

const als = new AsyncLocalStorage<PoolClient>();

function db() {
  return als.getStore() ?? pool;
}

async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<QueryResult<T>> {
  return db().query<T>(text, params);
}

const EXAM_SELECT = `
  SELECT e.id,
         e.title,
         COALESCE(e.exam_scope, 'course') AS exam_scope,
         e.is_active,
         e.visibility_end_date,
         e.course_id,
         e.grade_id,
         COALESCE(e.teacher_id, c.teacher_id) AS teacher_id,
         c.title AS course_title,
         COALESCE(st.enabled, TRUE) AS enabled,
         COALESCE(st.paused, FALSE) AS paused,
         st.absent_swept_at,
         COALESCE(nq.scheduled_count, 0) AS scheduled_count,
         COALESCE(nq.sent_count, 0) AS sent_count,
         COALESCE(nq.skipped_count, 0) AS skipped_count
  FROM course_level_exams e
  LEFT JOIN courses c ON c.id = e.course_id
  LEFT JOIN wa_parent_exam_settings st ON st.exam_id = e.id
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*) FILTER (WHERE n.status = 'scheduled')::int AS scheduled_count,
      COUNT(*) FILTER (WHERE n.status = 'sent')::int AS sent_count,
      COUNT(*) FILTER (WHERE n.status = 'skipped')::int AS skipped_count
    FROM wa_parent_exam_notifications n
    WHERE n.exam_id = e.id
  ) nq ON TRUE
`;

function mapExam(row: QueryResultRow): ExamState {
  return {
    id: Number(row.id),
    title: String(row.title ?? ''),
    scope: row.exam_scope === 'public' ? 'public' : 'course',
    isActive: row.is_active !== false,
    visibilityEnd: row.visibility_end_date ? new Date(row.visibility_end_date) : null,
    enabled: row.enabled !== false,
    paused: row.paused === true,
    absentSweptAt: row.absent_swept_at ? new Date(row.absent_swept_at) : null,
    courseTitle: row.course_title ? String(row.course_title) : null,
    teacherId: Number(row.teacher_id || 0),
    scheduledCount: row.scheduled_count == null ? undefined : Number(row.scheduled_count),
    sentCount: row.sent_count == null ? undefined : Number(row.sent_count),
    skippedCount: row.skipped_count == null ? undefined : Number(row.skipped_count),
  };
}

function attemptStatusOf(raw: string | null | undefined): StudentState['attemptStatus'] {
  if (raw === 'submitted') return 'submitted';
  if (raw === 'in_progress') return 'in_progress';
  return 'none';
}

function mapStudent(row: QueryResultRow): StudentState {
  return {
    studentId: Number(row.student_id),
    studentName: String(row.student_name ?? ''),
    parentPhone: row.parent_phone ? String(row.parent_phone) : null,
    attemptStatus: attemptStatusOf(row.attempt_status),
    obtained: row.obtained_grade == null ? null : Number(row.obtained_grade),
    total: row.total_grade == null ? null : Number(row.total_grade),
  };
}

function mapNotification(row: QueryResultRow): NotificationState {
  return {
    id: Number(row.id),
    examId: Number(row.exam_id),
    teacherId: Number(row.teacher_id || 0),
    studentId: Number(row.student_user_id),
    cohort: row.cohort as ExamCohort,
    parentPhone: row.parent_phone ? String(row.parent_phone) : null,
    body: String(row.body ?? ''),
    jobId: row.job_id == null ? null : Number(row.job_id),
    status: row.status,
    scheduledAt: row.scheduled_at ? new Date(row.scheduled_at) : null,
    skipReason: row.skip_reason ? String(row.skip_reason) : null,
    readyAt: new Date(row.ready_at),
    immediate: row.immediate === true,
  };
}

const ATTEMPT_LATERAL = `
  LEFT JOIN LATERAL (
    SELECT a.status, a.obtained_grade, a.total_grade
    FROM course_level_exam_attempts a
    WHERE a.exam_id = $1 AND a.student_id = u.id
    ORDER BY CASE WHEN a.status = 'submitted' THEN 0 ELSE 1 END,
             a.submitted_at DESC NULLS LAST,
             a.id DESC
    LIMIT 1
  ) att ON TRUE
`;

async function loadExamRow(examId: number): Promise<QueryResultRow | null> {
  const res = await query(`${EXAM_SELECT} WHERE e.id = $1`, [examId]);
  return res.rows[0] ?? null;
}

async function audienceFromExam(exam: QueryResultRow): Promise<StudentState[]> {
  if (exam.exam_scope === 'public') {
    const res = await query(
      `SELECT u.id AS student_id, u.name AS student_name, u.parent_phone,
              att.status AS attempt_status, att.obtained_grade, att.total_grade
       FROM user_grades ug
       JOIN users u ON u.id = ug.user_id
       ${ATTEMPT_LATERAL}
       WHERE ug.grade_id = $2
         AND u.role = 'student'
         AND u.deleted_at IS NULL
         AND (
           u.managed_by_teacher_id = $3
           OR EXISTS (
             SELECT 1 FROM tenants t
             WHERE t.id = u.tenant_id AND t.owner_user_id = $3
           )
         )
       ORDER BY u.name ASC`,
      [exam.id, exam.grade_id, exam.teacher_id],
    );
    return res.rows.map(mapStudent);
  }

  const res = await query(
    `SELECT u.id AS student_id, u.name AS student_name, u.parent_phone,
            att.status AS attempt_status, att.obtained_grade, att.total_grade
     FROM enrollments en
     JOIN users u ON u.id = en.user_id
     ${ATTEMPT_LATERAL}
     WHERE en.course_id = $2 AND u.role = 'student'
     ORDER BY u.name ASC`,
    [exam.id, exam.course_id],
  );
  return res.rows.map(mapStudent);
}

export class PgParentsExamStore implements ParentsExamStore {
  now(): Date {
    return new Date();
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    const existing = als.getStore();
    if (existing) return fn();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await als.run(client, fn);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* already aborted */
      }
      throw err;
    } finally {
      client.release();
    }
  }

  async lockPace(): Promise<void> {
    await query(`SELECT pg_advisory_xact_lock(${PARENTS_EXAM_PACE_LOCK})`);
  }

  async getService(): Promise<ServiceState | null> {
    const res = await query(
      `SELECT sv.id, sv.is_enabled, sv.config,
              COALESCE(sc.ready_cnt, 0)::int AS ready_sessions
       FROM wa_services sv
       LEFT JOIN LATERAL (
         SELECT COUNT(*) FILTER (
           WHERE s.status = 'ready' AND s.is_enabled AND ps.is_enabled
         )::int AS ready_cnt
         FROM wa_service_sessions ps
         JOIN wa_sessions s ON s.slug = ps.session_slug
         WHERE ps.service_id = sv.id
       ) sc ON TRUE
       WHERE sv.key = $1`,
      [PARENTS_EXAM_NOTIFY_KEY],
    );
    if (!res.rowCount) return null;
    const row = res.rows[0];
    return {
      id: Number(row.id),
      isEnabled: row.is_enabled === true,
      config: parseParentsExamConfig(row.config),
      readySessions: Number(row.ready_sessions || 0),
    };
  }

  async saveConfig(config: ParentsExamConfig): Promise<ServiceState> {
    await query(
      `UPDATE wa_services SET config = $2::jsonb, updated_at = NOW() WHERE key = $1`,
      [PARENTS_EXAM_NOTIFY_KEY, JSON.stringify(config)],
    );
    const service = await this.getService();
    if (!service) throw new Error('parents_exam_notify service missing');
    return service;
  }

  async getExam(examId: number): Promise<ExamState | null> {
    const row = await loadExamRow(examId);
    return row ? mapExam(row) : null;
  }

  async listExams(teacherId?: number): Promise<ExamState[]> {
    const res = teacherId
      ? await query(
          `${EXAM_SELECT} WHERE COALESCE(e.teacher_id, c.teacher_id) = $1 ORDER BY e.id DESC`,
          [teacherId],
        )
      : await query(`${EXAM_SELECT} ORDER BY e.id DESC LIMIT 50`);
    return res.rows.map(mapExam);
  }

  async getTeacherPrefs(teacherId: number): Promise<TeacherExamPrefs> {
    const res = await query(`SELECT * FROM wa_parent_exam_teacher_settings WHERE teacher_id = $1`, [
      teacherId,
    ]);
    if (!res.rowCount) return parseTeacherExamPrefs(null);
    const row = res.rows[0];
    return parseTeacherExamPrefs({
      auto_send: row.auto_send === true,
      notify_passed: row.notify_passed === true,
      notify_failed: row.notify_failed === true,
      notify_absent: row.notify_absent === true,
      pass_percentage: Number(row.pass_percentage),
    });
  }

  async saveTeacherPrefs(teacherId: number, prefs: TeacherExamPrefs): Promise<TeacherExamPrefs> {
    const parsed = parseTeacherExamPrefs(prefs);
    await query(
      `INSERT INTO wa_parent_exam_teacher_settings
         (teacher_id, auto_send, notify_passed, notify_failed, notify_absent, pass_percentage)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (teacher_id) DO UPDATE SET
         auto_send = EXCLUDED.auto_send,
         notify_passed = EXCLUDED.notify_passed,
         notify_failed = EXCLUDED.notify_failed,
         notify_absent = EXCLUDED.notify_absent,
         pass_percentage = EXCLUDED.pass_percentage,
         updated_at = NOW()`,
      [
        teacherId,
        parsed.auto_send,
        parsed.notify_passed,
        parsed.notify_failed,
        parsed.notify_absent,
        parsed.pass_percentage,
      ],
    );
    return parsed;
  }

  async setExamEnabled(examId: number, enabled: boolean): Promise<ExamState> {
    if (!(await this.getExam(examId))) throw new HttpError(404, 'الامتحان غير موجود');
    await query(
      `INSERT INTO wa_parent_exam_settings (exam_id, enabled)
       VALUES ($1, $2)
       ON CONFLICT (exam_id) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = NOW()`,
      [examId, enabled],
    );
    const exam = await this.getExam(examId);
    if (!exam) throw new HttpError(404, 'الامتحان غير موجود');
    return exam;
  }

  async setExamPaused(examId: number, paused: boolean): Promise<ExamState> {
    if (!(await this.getExam(examId))) throw new HttpError(404, 'الامتحان غير موجود');
    await query(
      `INSERT INTO wa_parent_exam_settings (exam_id, paused)
       VALUES ($1, $2)
       ON CONFLICT (exam_id) DO UPDATE SET paused = EXCLUDED.paused, updated_at = NOW()`,
      [examId, paused],
    );
    const exam = await this.getExam(examId);
    if (!exam) throw new HttpError(404, 'الامتحان غير موجود');
    return exam;
  }

  async markAbsentSwept(examId: number, at: Date): Promise<void> {
    await query(
      `INSERT INTO wa_parent_exam_settings (exam_id, absent_swept_at)
       VALUES ($1, $2)
       ON CONFLICT (exam_id) DO UPDATE SET absent_swept_at = EXCLUDED.absent_swept_at, updated_at = NOW()`,
      [examId, at],
    );
  }

  async listClosedUnswept(now: Date): Promise<ExamState[]> {
    const res = await query(
      `${EXAM_SELECT}
       WHERE st.absent_swept_at IS NULL
         AND COALESCE(st.enabled, TRUE) = TRUE
         AND EXISTS (
           SELECT 1 FROM wa_parent_exam_teacher_settings ts
           WHERE ts.teacher_id = COALESCE(e.teacher_id, c.teacher_id)
             AND ts.auto_send = TRUE
             AND ts.notify_absent = TRUE
         )
         AND (
           e.is_active = FALSE
           OR (e.visibility_end_date IS NOT NULL AND e.visibility_end_date <= $1)
         )
       ORDER BY e.id ASC`,
      [now],
    );
    return res.rows.map(mapExam);
  }

  async loadAudience(examId: number): Promise<StudentState[]> {
    const exam = await loadExamRow(examId);
    if (!exam) return [];
    return audienceFromExam(exam);
  }

  async getEligibleStudent(examId: number, studentId: number): Promise<StudentState | null> {
    const audience = await this.loadAudience(examId);
    return audience.find((s) => s.studentId === studentId) ?? null;
  }

  async findNotification(examId: number, studentId: number, cohort: ExamCohort) {
    const res = await query(
      `SELECT * FROM wa_parent_exam_notifications
       WHERE exam_id = $1 AND student_user_id = $2 AND cohort = $3`,
      [examId, studentId, cohort],
    );
    return res.rows[0] ? mapNotification(res.rows[0]) : null;
  }

  async listNotifications(examId: number) {
    const res = await query(
      `SELECT * FROM wa_parent_exam_notifications WHERE exam_id = $1 ORDER BY id ASC`,
      [examId],
    );
    return res.rows.map(mapNotification);
  }

  async reopenNotification(
    id: number,
    patch: { parentPhone: string; body: string; readyAt: Date; immediate: boolean },
  ) {
    await query(
      `UPDATE wa_parent_exam_notifications
       SET status = 'scheduled', job_id = NULL, scheduled_at = NULL, skip_reason = NULL,
           parent_phone = $2, body = $3, ready_at = $4, immediate = $5
       WHERE id = $1`,
      [id, patch.parentPhone, patch.body, patch.readyAt, patch.immediate],
    );
  }

  async insertNotification(row: {
    teacherId: number;
    examId: number;
    studentId: number;
    cohort: ExamCohort;
    parentPhone: string | null;
    body: string;
    status: NotificationState['status'];
    skipReason: string | null;
    readyAt: Date;
    immediate: boolean;
  }): Promise<NotificationState | null> {
    const res = await query(
      `INSERT INTO wa_parent_exam_notifications
         (exam_id, teacher_id, student_user_id, cohort, parent_phone, body, status, skip_reason, ready_at, immediate)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (exam_id, student_user_id, cohort) DO NOTHING
       RETURNING *`,
      [
        row.examId,
        row.teacherId,
        row.studentId,
        row.cohort,
        row.parentPhone,
        row.body,
        row.status,
        row.skipReason,
        row.readyAt,
        row.immediate,
      ],
    );
    return res.rows[0] ? mapNotification(res.rows[0]) : null;
  }

  async listUnqueued(now: Date, limit: number) {
    const res = await query(
      `SELECT * FROM wa_parent_exam_notifications
       WHERE status = 'scheduled' AND job_id IS NULL AND ready_at <= $1
       ORDER BY immediate DESC, id ASC
       LIMIT $2
       FOR UPDATE SKIP LOCKED`,
      [now, limit],
    );
    return res.rows.map(mapNotification);
  }

  async attachJob(id: number, jobId: number, scheduledAt: Date) {
    await query(
      `UPDATE wa_parent_exam_notifications
       SET job_id = $2, scheduled_at = $3
       WHERE id = $1`,
      [id, jobId, scheduledAt],
    );
  }

  async defer(id: number, readyAt: Date) {
    await query(`UPDATE wa_parent_exam_notifications SET ready_at = $2 WHERE id = $1`, [id, readyAt]);
  }

  async countPlacedOnDay(teacherId: number | null, dayStart: Date, dayEnd: Date) {
    const res = await query<{ n: number }>(
      `SELECT COUNT(*)::int AS n
       FROM wa_parent_exam_notifications
       WHERE status IN ('scheduled', 'sent')
         AND scheduled_at >= $1 AND scheduled_at < $2
         AND ($3::int IS NULL OR teacher_id = $3)`,
      [dayStart, dayEnd, teacherId],
    );
    return Number(res.rows[0]?.n || 0);
  }

  async lastSlot(teacherId: number) {
    const res = await query<{ slot: Date | null }>(
      `SELECT MAX(scheduled_at) AS slot
       FROM wa_parent_exam_notifications
       WHERE status IN ('scheduled', 'sent') AND scheduled_at IS NOT NULL
         AND teacher_id = $1`,
      [teacherId],
    );
    return res.rows[0]?.slot ? new Date(res.rows[0].slot) : null;
  }

  async pickSession(teacherId: number, phone: string | null) {
    return SessionPoolService.pickSessionForTeacher('teacher_student_notify', teacherId, phone);
  }

  async enqueueJob(input: {
    sessionSlug: string;
    serviceId: number;
    to: string;
    body: string;
    scheduledAt: Date;
    triggerType: string;
    examId: number;
    studentId: number;
    cohort: ExamCohort;
    notificationId: number;
    immediate: boolean;
  }) {
    return WhatsAppOutboundQueue.enqueue({
      sessionSlug: input.sessionSlug,
      serviceId: input.serviceId,
      to: input.to,
      body: input.body,
      scheduledAt: input.scheduledAt,
      triggerType: input.triggerType,
      triggerRef: `${input.examId}:${input.studentId}:${input.cohort}`,
      metadata: {
        exam_id: input.examId,
        student_id: input.studentId,
        cohort: input.cohort,
        notification_id: input.notificationId,
        immediate: input.immediate,
      },
    });
  }

  async cancelPending(examId: number) {
    const res = await query<{ job_id: number | null }>(
      `UPDATE wa_parent_exam_notifications
       SET status = 'cancelled'
       WHERE exam_id = $1 AND status = 'scheduled'
       RETURNING job_id`,
      [examId],
    );
    const jobIds = res.rows.map((r) => r.job_id).filter((id): id is number => id != null);
    if (jobIds.length) {
      await query(
        `UPDATE wa_outbound_jobs
         SET status = 'dead', processed_at = NOW(), last_error = 'cancelled'
         WHERE id = ANY($1::int[]) AND status IN ('pending', 'failed')`,
        [jobIds],
      );
    }
    return { notifications: res.rowCount ?? 0 };
  }

  async sentOnDay(dayStart: Date, dayEnd: Date) {
    const res = await query<{ n: number }>(
      `SELECT COUNT(*)::int AS n
       FROM wa_parent_exam_notifications
       WHERE status = 'sent' AND scheduled_at >= $1 AND scheduled_at < $2`,
      [dayStart, dayEnd],
    );
    return Number(res.rows[0]?.n || 0);
  }

  async upcoming(limit: number): Promise<UpcomingSend[]> {
    const res = await query(
      `SELECT n.id, n.exam_id, e.title AS exam_title, n.student_user_id, u.name AS student_name,
              n.cohort, n.parent_phone, n.scheduled_at, n.status, n.immediate
       FROM wa_parent_exam_notifications n
       JOIN course_level_exams e ON e.id = n.exam_id
       JOIN users u ON u.id = n.student_user_id
       WHERE n.status = 'scheduled' AND n.scheduled_at IS NOT NULL
       ORDER BY n.scheduled_at ASC
       LIMIT $1`,
      [limit],
    );
    return res.rows.map((row) => ({
      notificationId: Number(row.id),
      examId: Number(row.exam_id),
      examTitle: String(row.exam_title ?? ''),
      studentId: Number(row.student_user_id),
      studentName: String(row.student_name ?? ''),
      cohort: row.cohort as ExamCohort,
      parentPhone: row.parent_phone ? String(row.parent_phone) : null,
      scheduledAt: row.scheduled_at ? new Date(row.scheduled_at) : null,
      status: row.status,
      immediate: row.immediate === true,
    }));
  }
}

export const pgParentsExamStore = new PgParentsExamStore();
