import { randomUUID } from 'crypto';
import pool from '../db/pool';
import { HttpError } from '../utils';

export type PointsEventType =
  | 'VIDEO_WATCH'
  | 'EXAM_START'
  | 'EXAM_SCORE'
  | 'ASSIGNMENT_START'
  | 'ASSIGNMENT_SCORE'
  | 'MANUAL_REWARD';

export interface TeacherPointsSettings {
  teacher_id: number;
  video_watch_enabled: boolean;
  video_watch_points: number;
  exam_start_enabled: boolean;
  exam_start_points: number;
  assignment_start_enabled: boolean;
  assignment_start_points: number;
  exam_score_enabled: boolean;
  assignment_score_enabled: boolean;
  created_at?: Date;
  updated_at?: Date;
}

export interface AwardResult {
  awarded: boolean;
  points: number;
  totalPoints: number | null;
  reason?: string;
  transactionId?: number;
}

export interface AwardInput {
  studentId: number;
  teacherId: number;
  gradeId?: number | null;
  eventType: PointsEventType;
  points: number;
  referenceKey: string;
  referenceType?: string | null;
  referenceId?: number | null;
  metadata?: Record<string, unknown>;
  /** When true, ignore teacher settings enable flags (manual reward). */
  force?: boolean;
}

const DEFAULT_SETTINGS: Omit<TeacherPointsSettings, 'teacher_id'> = {
  video_watch_enabled: true,
  video_watch_points: 5,
  exam_start_enabled: true,
  exam_start_points: 5,
  assignment_start_enabled: true,
  assignment_start_points: 3,
  exam_score_enabled: true,
  assignment_score_enabled: true,
};

function mapSettings(row: any, teacherId: number): TeacherPointsSettings {
  return {
    teacher_id: teacherId,
    video_watch_enabled: row.video_watch_enabled !== false,
    video_watch_points: Number(row.video_watch_points ?? 5),
    exam_start_enabled: row.exam_start_enabled !== false,
    exam_start_points: Number(row.exam_start_points ?? 5),
    assignment_start_enabled: row.assignment_start_enabled !== false,
    assignment_start_points: Number(row.assignment_start_points ?? 3),
    exam_score_enabled: row.exam_score_enabled !== false,
    assignment_score_enabled: row.assignment_score_enabled !== false,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export class TeacherPointsService {
  static async getOrCreateSettings(teacherId: number): Promise<TeacherPointsSettings> {
    const existing = await pool.query(`SELECT * FROM teacher_points_settings WHERE teacher_id = $1`, [
      teacherId,
    ]);
    if (existing.rowCount) {
      return mapSettings(existing.rows[0], teacherId);
    }
    const inserted = await pool.query(
      `INSERT INTO teacher_points_settings (teacher_id)
       VALUES ($1)
       ON CONFLICT (teacher_id) DO UPDATE SET updated_at = teacher_points_settings.updated_at
       RETURNING *`,
      [teacherId],
    );
    return mapSettings(inserted.rows[0] || DEFAULT_SETTINGS, teacherId);
  }

  static async updateSettings(
    teacherId: number,
    patch: Partial<{
      video_watch_enabled: boolean;
      video_watch_points: number;
      exam_start_enabled: boolean;
      exam_start_points: number;
      assignment_start_enabled: boolean;
      assignment_start_points: number;
      exam_score_enabled: boolean;
      assignment_score_enabled: boolean;
    }>,
  ): Promise<TeacherPointsSettings> {
    await this.getOrCreateSettings(teacherId);
    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    const add = (col: string, val: unknown) => {
      fields.push(`${col} = $${i++}`);
      values.push(val);
    };

    if (patch.video_watch_enabled !== undefined) add('video_watch_enabled', !!patch.video_watch_enabled);
    if (patch.video_watch_points !== undefined) {
      const n = Math.max(0, Math.floor(Number(patch.video_watch_points)));
      if (!Number.isFinite(n)) throw new HttpError(400, 'Invalid video_watch_points');
      add('video_watch_points', n);
    }
    if (patch.exam_start_enabled !== undefined) add('exam_start_enabled', !!patch.exam_start_enabled);
    if (patch.exam_start_points !== undefined) {
      const n = Math.max(0, Math.floor(Number(patch.exam_start_points)));
      if (!Number.isFinite(n)) throw new HttpError(400, 'Invalid exam_start_points');
      add('exam_start_points', n);
    }
    if (patch.assignment_start_enabled !== undefined) {
      add('assignment_start_enabled', !!patch.assignment_start_enabled);
    }
    if (patch.assignment_start_points !== undefined) {
      const n = Math.max(0, Math.floor(Number(patch.assignment_start_points)));
      if (!Number.isFinite(n)) throw new HttpError(400, 'Invalid assignment_start_points');
      add('assignment_start_points', n);
    }
    if (patch.exam_score_enabled !== undefined) add('exam_score_enabled', !!patch.exam_score_enabled);
    if (patch.assignment_score_enabled !== undefined) {
      add('assignment_score_enabled', !!patch.assignment_score_enabled);
    }

    if (!fields.length) {
      return this.getOrCreateSettings(teacherId);
    }

    fields.push('updated_at = NOW()');
    values.push(teacherId);
    const res = await pool.query(
      `UPDATE teacher_points_settings SET ${fields.join(', ')} WHERE teacher_id = $${i} RETURNING *`,
      values,
    );
    return mapSettings(res.rows[0], teacherId);
  }

  /** Resolve teacher id for a course. */
  static async resolveTeacherIdForCourse(courseId: number): Promise<number | null> {
    const res = await pool.query<{ teacher_id: number }>(
      `SELECT teacher_id FROM courses WHERE id = $1`,
      [courseId],
    );
    return res.rowCount ? Number(res.rows[0].teacher_id) : null;
  }

  /** Prefer student grade that belongs to this teacher; fallback to course.grade_id. */
  static async resolveGradeId(opts: {
    studentId: number;
    teacherId: number;
    courseId?: number | null;
    preferredGradeId?: number | null;
  }): Promise<number | null> {
    if (opts.preferredGradeId) {
      const ok = await pool.query(
        `SELECT 1 FROM teacher_grades WHERE teacher_id = $1 AND grade_id = $2`,
        [opts.teacherId, opts.preferredGradeId],
      );
      if (ok.rowCount) return Number(opts.preferredGradeId);
    }

    const studentGrade = await pool.query<{ grade_id: number }>(
      `SELECT ug.grade_id
       FROM user_grades ug
       JOIN teacher_grades tg ON tg.grade_id = ug.grade_id AND tg.teacher_id = $2
       WHERE ug.user_id = $1
       ORDER BY ug.grade_id ASC
       LIMIT 1`,
      [opts.studentId, opts.teacherId],
    );
    if (studentGrade.rowCount) return Number(studentGrade.rows[0].grade_id);

    if (opts.courseId) {
      const courseGrade = await pool.query<{ grade_id: number | null }>(
        `SELECT grade_id FROM courses WHERE id = $1 AND teacher_id = $2`,
        [opts.courseId, opts.teacherId],
      );
      if (courseGrade.rowCount && courseGrade.rows[0].grade_id != null) {
        return Number(courseGrade.rows[0].grade_id);
      }
    }

    return null;
  }

  /** Platform teacher for a student (managed_by or tenant owner). */
  static async resolveTeacherIdForStudent(studentId: number): Promise<number | null> {
    const userRes = await pool.query<{ managed_by_teacher_id: number | null; tenant_id: number | null }>(
      `SELECT managed_by_teacher_id, tenant_id FROM users WHERE id = $1`,
      [studentId],
    );
    if (!userRes.rowCount) return null;
    const row = userRes.rows[0];
    if (row.managed_by_teacher_id) return Number(row.managed_by_teacher_id);

    if (row.tenant_id) {
      const owner = await pool.query<{ owner_user_id: number | null }>(
        `SELECT owner_user_id FROM tenants WHERE id = $1`,
        [row.tenant_id],
      );
      if (owner.rowCount && owner.rows[0].owner_user_id) {
        return Number(owner.rows[0].owner_user_id);
      }
    }
    return null;
  }

  private static isEventEnabled(settings: TeacherPointsSettings, eventType: PointsEventType): boolean {
    switch (eventType) {
      case 'VIDEO_WATCH':
        return settings.video_watch_enabled;
      case 'EXAM_START':
        return settings.exam_start_enabled;
      case 'ASSIGNMENT_START':
        return settings.assignment_start_enabled;
      case 'EXAM_SCORE':
        return settings.exam_score_enabled;
      case 'ASSIGNMENT_SCORE':
        return settings.assignment_score_enabled;
      case 'MANUAL_REWARD':
        return true;
      default:
        return false;
    }
  }

  /**
   * Idempotent award. Safe to call on refresh / retries.
   * Returns awarded=false when duplicate, disabled, or zero points.
   */
  static async award(input: AwardInput): Promise<AwardResult> {
    const points = Math.max(0, Math.floor(Number(input.points) || 0));
    if (points <= 0) {
      return { awarded: false, points: 0, totalPoints: null, reason: 'zero_points' };
    }

    const settings = await this.getOrCreateSettings(input.teacherId);
    if (!input.force && !this.isEventEnabled(settings, input.eventType)) {
      return { awarded: false, points: 0, totalPoints: null, reason: 'disabled' };
    }

    let gradeId = input.gradeId ?? null;
    if (!gradeId) {
      gradeId = await this.resolveGradeId({
        studentId: input.studentId,
        teacherId: input.teacherId,
      });
    }
    if (!gradeId) {
      return { awarded: false, points: 0, totalPoints: null, reason: 'missing_grade' };
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const insertTx = await client.query(
        `INSERT INTO point_transactions (
           student_id, teacher_id, grade_id, points, event_type,
           reference_type, reference_id, reference_key, metadata
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
         ON CONFLICT (reference_key) DO NOTHING
         RETURNING id`,
        [
          input.studentId,
          input.teacherId,
          gradeId,
          points,
          input.eventType,
          input.referenceType ?? null,
          input.referenceId ?? null,
          input.referenceKey,
          JSON.stringify(input.metadata || {}),
        ],
      );

      if (!insertTx.rowCount) {
        await client.query('ROLLBACK');
        const bal = await this.getBalance(input.studentId, input.teacherId, gradeId);
        return {
          awarded: false,
          points: 0,
          totalPoints: bal,
          reason: 'duplicate',
        };
      }

      const balRes = await client.query(
        `INSERT INTO student_point_balances (student_id, teacher_id, grade_id, total_points)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (student_id, teacher_id, grade_id)
         DO UPDATE SET
           total_points = student_point_balances.total_points + EXCLUDED.total_points,
           updated_at = NOW()
         RETURNING total_points`,
        [input.studentId, input.teacherId, gradeId, points],
      );

      await client.query('COMMIT');
      return {
        awarded: true,
        points,
        totalPoints: Number(balRes.rows[0].total_points),
        transactionId: Number(insertTx.rows[0].id),
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  static async getBalance(
    studentId: number,
    teacherId: number,
    gradeId: number,
  ): Promise<number> {
    const res = await pool.query<{ total_points: number }>(
      `SELECT total_points FROM student_point_balances
       WHERE student_id = $1 AND teacher_id = $2 AND grade_id = $3`,
      [studentId, teacherId, gradeId],
    );
    return res.rowCount ? Number(res.rows[0].total_points) : 0;
  }

  // ─── Convenience award helpers ───────────────────────────────────────────

  /**
   * مفتاح فريد مرة واحدة لكل طالب + امتحان/واجب (وليس لكل محاولة).
   * يمنع منح نقاط البدء/الدرجة مرتين عند إعادة دخول نفس الامتحان.
   */
  static examPointsReferenceKey(opts: {
    eventType: PointsEventType;
    teacherId: number;
    studentId: number;
    examId: number;
    isAssignment: boolean;
    /** lecture = امتحان محاضرة، course = امتحان شامل — لتجنب تصادم IDs */
    examKind?: 'lecture' | 'course';
  }): string {
    const kind = opts.isAssignment
      ? 'assignment'
      : opts.examKind === 'course'
        ? 'course_exam'
        : 'lecture_exam';
    return `${opts.eventType}:teacher:${opts.teacherId}:${kind}:${opts.examId}:student:${opts.studentId}`;
  }

  static async awardVideoWatch(opts: {
    studentId: number;
    teacherId: number;
    courseId: number;
    videoId: number;
    lectureId: number;
    lectureTitle?: string | null;
  }): Promise<AwardResult> {
    const settings = await this.getOrCreateSettings(opts.teacherId);
    if (!settings.video_watch_enabled) {
      return { awarded: false, points: 0, totalPoints: null, reason: 'disabled' };
    }
    const gradeId = await this.resolveGradeId({
      studentId: opts.studentId,
      teacherId: opts.teacherId,
      courseId: opts.courseId,
    });
    return this.award({
      studentId: opts.studentId,
      teacherId: opts.teacherId,
      gradeId,
      eventType: 'VIDEO_WATCH',
      points: settings.video_watch_points,
      referenceKey: `VIDEO_WATCH:teacher:${opts.teacherId}:video:${opts.videoId}:student:${opts.studentId}`,
      referenceType: 'video',
      referenceId: opts.videoId,
      metadata: {
        lectureId: opts.lectureId,
        courseId: opts.courseId,
        lectureTitle: opts.lectureTitle ?? null,
      },
    });
  }

  static async awardExamOrAssignmentStart(opts: {
    studentId: number;
    teacherId: number;
    courseId?: number | null;
    attemptId: number;
    examId: number;
    isAssignment: boolean;
    title?: string | null;
    examKind?: 'lecture' | 'course';
  }): Promise<AwardResult> {
    const settings = await this.getOrCreateSettings(opts.teacherId);
    const enabled = opts.isAssignment
      ? settings.assignment_start_enabled
      : settings.exam_start_enabled;
    if (!enabled) {
      return { awarded: false, points: 0, totalPoints: null, reason: 'disabled' };
    }
    const points = opts.isAssignment
      ? settings.assignment_start_points
      : settings.exam_start_points;
    const eventType: PointsEventType = opts.isAssignment ? 'ASSIGNMENT_START' : 'EXAM_START';
    const gradeId = await this.resolveGradeId({
      studentId: opts.studentId,
      teacherId: opts.teacherId,
      courseId: opts.courseId,
    });
    const referenceKey = this.examPointsReferenceKey({
      eventType,
      teacherId: opts.teacherId,
      studentId: opts.studentId,
      examId: opts.examId,
      isAssignment: opts.isAssignment,
      examKind: opts.examKind,
    });
    return this.award({
      studentId: opts.studentId,
      teacherId: opts.teacherId,
      gradeId,
      eventType,
      points,
      referenceKey,
      referenceType: opts.isAssignment
        ? 'assignment'
        : opts.examKind === 'course'
          ? 'course_exam'
          : 'lecture_exam',
      referenceId: opts.examId,
      metadata: {
        examId: opts.examId,
        attemptId: opts.attemptId,
        title: opts.title ?? null,
      },
    });
  }

  static async awardExamOrAssignmentScore(opts: {
    studentId: number;
    teacherId: number;
    courseId?: number | null;
    attemptId: number;
    examId: number;
    isAssignment: boolean;
    obtainedGrade: number;
    totalGrade: number;
    title?: string | null;
    examKind?: 'lecture' | 'course';
  }): Promise<AwardResult> {
    const settings = await this.getOrCreateSettings(opts.teacherId);
    const enabled = opts.isAssignment
      ? settings.assignment_score_enabled
      : settings.exam_score_enabled;
    if (!enabled) {
      return { awarded: false, points: 0, totalPoints: null, reason: 'disabled' };
    }
    const points = Math.max(0, Math.floor(Number(opts.obtainedGrade) || 0));
    const eventType: PointsEventType = opts.isAssignment ? 'ASSIGNMENT_SCORE' : 'EXAM_SCORE';
    const gradeId = await this.resolveGradeId({
      studentId: opts.studentId,
      teacherId: opts.teacherId,
      courseId: opts.courseId,
    });
    const referenceKey = this.examPointsReferenceKey({
      eventType,
      teacherId: opts.teacherId,
      studentId: opts.studentId,
      examId: opts.examId,
      isAssignment: opts.isAssignment,
      examKind: opts.examKind,
    });
    return this.award({
      studentId: opts.studentId,
      teacherId: opts.teacherId,
      gradeId,
      eventType,
      points,
      referenceKey,
      referenceType: opts.isAssignment
        ? 'assignment'
        : opts.examKind === 'course'
          ? 'course_exam'
          : 'lecture_exam',
      referenceId: opts.examId,
      metadata: {
        examId: opts.examId,
        attemptId: opts.attemptId,
        obtainedGrade: opts.obtainedGrade,
        totalGrade: opts.totalGrade,
        title: opts.title ?? null,
      },
    });
  }

  /**
   * Sync EXAM_SCORE / ASSIGNMENT_SCORE after regrade.
   * Adjusts an existing transaction only — never creates a new one (avoids resurrecting points after reset).
   */
  static async syncExamOrAssignmentScore(opts: {
    studentId: number;
    teacherId: number;
    courseId?: number | null;
    attemptId: number;
    examId: number;
    isAssignment: boolean;
    obtainedGrade: number;
    totalGrade: number;
    title?: string | null;
    examKind?: 'lecture' | 'course';
  }): Promise<AwardResult> {
    const settings = await this.getOrCreateSettings(opts.teacherId);
    const enabled = opts.isAssignment
      ? settings.assignment_score_enabled
      : settings.exam_score_enabled;
    if (!enabled) {
      return { awarded: false, points: 0, totalPoints: null, reason: 'disabled' };
    }

    const newPoints = Math.max(0, Math.floor(Number(opts.obtainedGrade) || 0));
    const eventType: PointsEventType = opts.isAssignment ? 'ASSIGNMENT_SCORE' : 'EXAM_SCORE';
    const referenceKey = this.examPointsReferenceKey({
      eventType,
      teacherId: opts.teacherId,
      studentId: opts.studentId,
      examId: opts.examId,
      isAssignment: opts.isAssignment,
      examKind: opts.examKind,
    });
    const gradeId = await this.resolveGradeId({
      studentId: opts.studentId,
      teacherId: opts.teacherId,
      courseId: opts.courseId,
    });
    if (!gradeId) {
      return { awarded: false, points: 0, totalPoints: null, reason: 'missing_grade' };
    }

    const existing = await pool.query<{ id: number; points: number }>(
      `SELECT id, points FROM point_transactions WHERE reference_key = $1 LIMIT 1`,
      [referenceKey],
    );

    // لا تُنشئ نقاطًا جديدة عند المزامنة بعد إعادة التصحيح — وإلا ستعود نقاط امتحانات قديمة بعد التصفير
    if (!existing.rowCount) {
      return {
        awarded: false,
        points: 0,
        totalPoints: await this.getBalance(opts.studentId, opts.teacherId, gradeId),
        reason: newPoints > 0 ? 'no_existing_transaction' : 'zero_points',
      };
    }

    const oldPoints = Math.max(0, Math.floor(Number(existing.rows[0].points) || 0));
    const delta = newPoints - oldPoints;
    if (delta === 0) {
      const bal = await this.getBalance(opts.studentId, opts.teacherId, gradeId);
      return { awarded: false, points: 0, totalPoints: bal, reason: 'duplicate' };
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE point_transactions
         SET points = $1,
             metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb
         WHERE id = $3`,
        [
          newPoints,
          JSON.stringify({
            examId: opts.examId,
            obtainedGrade: opts.obtainedGrade,
            totalGrade: opts.totalGrade,
            title: opts.title ?? null,
            regraded: true,
          }),
          existing.rows[0].id,
        ],
      );

      const balRes = await client.query(
        `INSERT INTO student_point_balances (student_id, teacher_id, grade_id, total_points)
         VALUES ($1, $2, $3, GREATEST(0, $4))
         ON CONFLICT (student_id, teacher_id, grade_id)
         DO UPDATE SET
           total_points = GREATEST(0, student_point_balances.total_points + $4),
           updated_at = NOW()
         RETURNING total_points`,
        [opts.studentId, opts.teacherId, gradeId, delta],
      );

      await client.query('COMMIT');
      return {
        awarded: delta > 0,
        points: Math.max(0, delta),
        totalPoints: Number(balRes.rows[0]?.total_points ?? 0),
        reason: delta > 0 ? undefined : 'adjusted_down',
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  static async addManualReward(opts: {
    teacherId: number;
    studentId: number;
    points: number;
    reason: string;
    gradeId?: number | null;
  }): Promise<AwardResult> {
    const points = Math.floor(Number(opts.points));
    if (!Number.isFinite(points) || points <= 0) {
      throw new HttpError(400, 'points must be a positive integer');
    }
    if (!opts.reason?.trim()) {
      throw new HttpError(400, 'reason is required');
    }

    const gradeId = await this.resolveGradeId({
      studentId: opts.studentId,
      teacherId: opts.teacherId,
      preferredGradeId: opts.gradeId,
    });
    if (!gradeId) {
      throw new HttpError(400, 'Could not resolve student grade for this teacher');
    }

    // Ensure student is related to teacher (managed or enrolled in teacher courses)
    const related = await pool.query(
      `SELECT 1 FROM users WHERE id = $1 AND managed_by_teacher_id = $2
       UNION
       SELECT 1 FROM enrollments e
       JOIN courses c ON c.id = e.course_id
       WHERE e.user_id = $1 AND c.teacher_id = $2
       LIMIT 1`,
      [opts.studentId, opts.teacherId],
    );
    if (!related.rowCount) {
      throw new HttpError(403, 'Student is not linked to this teacher');
    }

    const result = await this.award({
      studentId: opts.studentId,
      teacherId: opts.teacherId,
      gradeId,
      eventType: 'MANUAL_REWARD',
      points,
      referenceKey: `MANUAL_REWARD:teacher:${opts.teacherId}:uuid:${randomUUID()}`,
      referenceType: 'manual',
      referenceId: null,
      metadata: { reason: opts.reason.trim() },
      force: true,
    });

    if (!result.awarded) {
      throw new HttpError(500, 'Failed to award manual points');
    }
    return result;
  }

  /**
   * توحيد نقاط الامتحان/الواجب القديمة (كانت لكل محاولة) إلى مرة واحدة لكل امتحان.
   * يبقي نقاط أول محاولة ويحذف تكرار المحاولات التالية مع تعديل الرصيد.
   * آمن لإعادة التشغيل (idempotent).
   */
  static async consolidateLegacyOncePerExamPoints(opts: {
    teacherId?: number | null;
  } = {}): Promise<{
    groupsProcessed: number;
    transactionsDeleted: number;
    transactionsUpdated: number;
    pointsRemovedFromBalances: number;
  }> {
    const teacherFilter =
      opts.teacherId != null && Number.isFinite(Number(opts.teacherId))
        ? Number(opts.teacherId)
        : null;

    const legacyRes = await pool.query<{
      id: number;
      student_id: number;
      teacher_id: number;
      grade_id: number;
      points: number;
      event_type: string;
      reference_key: string;
      reference_id: number | null;
      metadata: Record<string, unknown> | null;
      created_at: Date;
      exam_id: number | null;
      exam_kind: string;
      attempt_number: number;
      is_new_format: number;
    }>(
      `SELECT
         pt.id,
         pt.student_id,
         pt.teacher_id,
         pt.grade_id,
         pt.points,
         pt.event_type,
         pt.reference_key,
         pt.reference_id,
         pt.metadata,
         pt.created_at,
         COALESCE(
           NULLIF(pt.metadata->>'examId', '')::int,
           NULLIF(pt.metadata->>'exam_id', '')::int,
           CASE WHEN pt.reference_key LIKE '%:attempt:%' THEN es.exam_id END,
           CASE WHEN pt.reference_key LIKE '%:attempt:%' THEN clea.exam_id END,
           CASE WHEN pt.reference_key LIKE '%:attempt:%' THEN ces.exam_id END,
           CASE
             WHEN pt.reference_key ~ ':(lecture_exam|course_exam|assignment):[0-9]+:student:'
             THEN (regexp_match(
               pt.reference_key,
               ':(?:lecture_exam|course_exam|assignment):([0-9]+):student:'
             ))[1]::int
           END
         ) AS exam_id,
         CASE
           WHEN pt.event_type IN ('ASSIGNMENT_START', 'ASSIGNMENT_SCORE') THEN 'assignment'
           WHEN pt.reference_key LIKE '%:course_exam:%' THEN 'course_exam'
           WHEN pt.reference_key LIKE '%:assignment:%' THEN 'assignment'
           WHEN pt.reference_key LIKE '%:lecture_exam:%' THEN 'lecture_exam'
           WHEN clea.id IS NOT NULL THEN 'course_exam'
           WHEN ces.id IS NOT NULL THEN 'course_exam'
           WHEN e.type IS NOT NULL AND lower(e.type::text) = 'assignment' THEN 'assignment'
           ELSE 'lecture_exam'
         END AS exam_kind,
         COALESCE(
           CASE WHEN pt.reference_key LIKE '%:attempt:%' THEN es.attempt_number END,
           CASE WHEN pt.reference_key LIKE '%:attempt:%' THEN clea.attempt_number END,
           NULLIF(pt.metadata->>'kept_attempt_number', '')::int,
           CASE WHEN pt.reference_key LIKE '%:attempt:%' THEN 1 ELSE 1 END
         ) AS attempt_number,
         CASE WHEN pt.reference_key LIKE '%:attempt:%' THEN 0 ELSE 1 END AS is_new_format
       FROM point_transactions pt
       LEFT JOIN exam_submissions es
         ON pt.reference_key LIKE '%:attempt:%' AND es.id = pt.reference_id
       LEFT JOIN exams e ON e.id = es.exam_id
       LEFT JOIN course_level_exam_attempts clea
         ON pt.reference_key LIKE '%:attempt:%' AND clea.id = pt.reference_id
       LEFT JOIN course_exam_submissions ces
         ON pt.reference_key LIKE '%:attempt:%' AND ces.id = pt.reference_id
       WHERE pt.event_type IN ('EXAM_START', 'EXAM_SCORE', 'ASSIGNMENT_START', 'ASSIGNMENT_SCORE')
         AND (
           pt.reference_key ~ '^(EXAM_START|EXAM_SCORE|ASSIGNMENT_START|ASSIGNMENT_SCORE):attempt:[0-9]+$'
           OR pt.reference_key ~ '^(EXAM_START|EXAM_SCORE|ASSIGNMENT_START|ASSIGNMENT_SCORE):teacher:[0-9]+:(lecture_exam|course_exam|assignment):[0-9]+:student:[0-9]+$'
         )
         AND ($1::int IS NULL OR pt.teacher_id = $1)`,
      [teacherFilter],
    );

    type Row = (typeof legacyRes.rows)[number];
    const groups = new Map<string, Row[]>();

    for (const row of legacyRes.rows) {
      if (row.exam_id == null || !Number.isInteger(Number(row.exam_id))) continue;
      const key = [
        row.student_id,
        row.teacher_id,
        row.event_type,
        row.exam_kind,
        row.exam_id,
      ].join(':');
      const list = groups.get(key) ?? [];
      list.push(row);
      groups.set(key, list);
    }

    let groupsProcessed = 0;
    let transactionsDeleted = 0;
    let transactionsUpdated = 0;
    let pointsRemovedFromBalances = 0;

    for (const [, rows] of groups) {
      if (rows.length === 0) continue;

      // أول محاولة حقيقية (مفاتيح :attempt:) لها أولوية على الصفوف الجديدة بنفس الرقم
      const sorted = [...rows].sort((a, b) => {
        const an = Number(a.attempt_number) || 1;
        const bn = Number(b.attempt_number) || 1;
        if (an !== bn) return an - bn;
        const aLegacy = Number(a.is_new_format) === 0 ? 0 : 1;
        const bLegacy = Number(b.is_new_format) === 0 ? 0 : 1;
        if (aLegacy !== bLegacy) return aLegacy - bLegacy;
        const at = new Date(a.created_at).getTime();
        const bt = new Date(b.created_at).getTime();
        if (at !== bt) return at - bt;
        return Number(a.id) - Number(b.id);
      });

      const first = sorted[0]!;
      const examId = Number(first.exam_id);
      const isAssignment =
        first.event_type.startsWith('ASSIGNMENT_') || first.exam_kind === 'assignment';
      const examKind: 'lecture' | 'course' =
        first.exam_kind === 'course_exam' ? 'course' : 'lecture';
      const newKey = this.examPointsReferenceKey({
        eventType: first.event_type as PointsEventType,
        teacherId: Number(first.teacher_id),
        studentId: Number(first.student_id),
        examId,
        isAssignment,
        examKind: isAssignment ? 'lecture' : examKind,
      });

      const keepPoints = Math.max(0, Math.floor(Number(first.points) || 0));
      const totalPointsInGroup = sorted.reduce(
        (sum, r) => sum + Math.max(0, Math.floor(Number(r.points) || 0)),
        0,
      );
      const removeFromBalance = Math.max(0, totalPointsInGroup - keepPoints);

      // صف واحد بالمفتاح الجديد فقط ولا زيادة → لا شيء
      if (
        sorted.length === 1 &&
        sorted[0]!.reference_key === newKey &&
        Number(sorted[0]!.points) === keepPoints
      ) {
        continue;
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const keepId = Number(first.id);
        const deleteIds = sorted.map((r) => Number(r.id)).filter((id) => id !== keepId);

        if (deleteIds.length) {
          const del = await client.query(
            `DELETE FROM point_transactions WHERE id = ANY($1::int[])`,
            [deleteIds],
          );
          transactionsDeleted += del.rowCount ?? 0;
        }

        // إن كان يوجد صف آخر بنفس المفتاح الجديد (نادر) احذفه بعد نقل النقاط
        const conflict = await client.query<{ id: number; points: number }>(
          `SELECT id, points FROM point_transactions
           WHERE reference_key = $1 AND id <> $2
           FOR UPDATE`,
          [newKey, keepId],
        );
        if (conflict.rowCount) {
          for (const c of conflict.rows) {
            await client.query(`DELETE FROM point_transactions WHERE id = $1`, [c.id]);
            transactionsDeleted += 1;
            // النقاط دي كانت ضمن المجموعة أو إضافية — إن لم تُحسب في totalPointsInGroup أزلها
            if (!sorted.some((r) => Number(r.id) === Number(c.id))) {
              const extra = Math.max(0, Math.floor(Number(c.points) || 0));
              if (extra > 0) {
                await client.query(
                  `UPDATE student_point_balances
                   SET total_points = GREATEST(0, total_points - $1), updated_at = NOW()
                   WHERE student_id = $2 AND teacher_id = $3 AND grade_id = $4`,
                  [extra, first.student_id, first.teacher_id, first.grade_id],
                );
                pointsRemovedFromBalances += extra;
              }
            }
          }
        }

        const refType = isAssignment
          ? 'assignment'
          : examKind === 'course'
            ? 'course_exam'
            : 'lecture_exam';

        await client.query(
          `UPDATE point_transactions
           SET points = $1,
               reference_key = $2,
               reference_type = $3,
               reference_id = $4,
               metadata = COALESCE(metadata, '{}'::jsonb) || $5::jsonb
           WHERE id = $6`,
          [
            keepPoints,
            newKey,
            refType,
            examId,
            JSON.stringify({
              examId,
              attemptId: first.reference_id,
              consolidated: true,
              consolidated_from_attempts: sorted.length,
              kept_attempt_number: Number(first.attempt_number) || 1,
            }),
            keepId,
          ],
        );
        transactionsUpdated += 1;

        if (removeFromBalance > 0) {
          await client.query(
            `UPDATE student_point_balances
             SET total_points = GREATEST(0, total_points - $1),
                 updated_at = NOW()
             WHERE student_id = $2 AND teacher_id = $3 AND grade_id = $4`,
            [removeFromBalance, first.student_id, first.teacher_id, first.grade_id],
          );
          pointsRemovedFromBalances += removeFromBalance;
        }

        await client.query('COMMIT');
        groupsProcessed += 1;
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(
          '[TeacherPoints] consolidate group failed',
          {
            studentId: first.student_id,
            teacherId: first.teacher_id,
            eventType: first.event_type,
            examId,
          },
          err,
        );
      } finally {
        client.release();
      }
    }

    return {
      groupsProcessed,
      transactionsDeleted,
      transactionsUpdated,
      pointsRemovedFromBalances,
    };
  }

  private static async assertTeacherOwnsGrade(
    teacherId: number,
    gradeId: number | null,
  ): Promise<number | null> {
    const resolved =
      gradeId != null && Number.isFinite(Number(gradeId)) && Number(gradeId) > 0
        ? Number(gradeId)
        : null;
    if (resolved != null) {
      const ownsGrade = await pool.query(
        `SELECT 1 FROM teacher_grades WHERE teacher_id = $1 AND grade_id = $2 LIMIT 1`,
        [teacherId, resolved],
      );
      if (!ownsGrade.rowCount) {
        throw new HttpError(403, 'هذا الصف غير مرتبط بالمدرس');
      }
    }
    return resolved;
  }

  /**
   * أرشفة الأرصدة والمعاملات الحية داخل موسم، ثم حذفها من الجداول الحية.
   * يُستخدم عند التصفير وعند النسخ الاحتياطي قبل الاسترجاع.
   */
  private static async archiveLivePointsInClient(
    client: import('pg').PoolClient,
    opts: {
      teacherId: number;
      gradeId: number | null;
      archivedBy: number;
      label?: string | null;
      reason?: string | null;
      source: 'reset' | 'pre_restore_backup';
    },
  ): Promise<{
    seasonId: number;
    balancesArchived: number;
    transactionsArchived: number;
    studentsCount: number;
    totalPointsSum: number;
  }> {
    const seasonRes = await client.query<{ id: number }>(
      `INSERT INTO teacher_points_seasons (
         teacher_id, grade_id, label, reason, archived_by, source
       ) VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        opts.teacherId,
        opts.gradeId,
        opts.label?.trim() || null,
        opts.reason?.trim() || null,
        opts.archivedBy,
        opts.source,
      ],
    );
    const seasonId = seasonRes.rows[0].id;

    const balArchive =
      opts.gradeId != null
        ? await client.query(
            `INSERT INTO student_point_balance_archives (
               season_id, original_balance_id, student_id, teacher_id, grade_id,
               total_points, balance_created_at, balance_updated_at
             )
             SELECT $1, b.id, b.student_id, b.teacher_id, b.grade_id,
                    b.total_points, b.created_at, b.updated_at
             FROM student_point_balances b
             WHERE b.teacher_id = $2 AND b.grade_id = $3`,
            [seasonId, opts.teacherId, opts.gradeId],
          )
        : await client.query(
            `INSERT INTO student_point_balance_archives (
               season_id, original_balance_id, student_id, teacher_id, grade_id,
               total_points, balance_created_at, balance_updated_at
             )
             SELECT $1, b.id, b.student_id, b.teacher_id, b.grade_id,
                    b.total_points, b.created_at, b.updated_at
             FROM student_point_balances b
             WHERE b.teacher_id = $2`,
            [seasonId, opts.teacherId],
          );

    const txArchive =
      opts.gradeId != null
        ? await client.query(
            `INSERT INTO point_transaction_archives (
               season_id, original_transaction_id, student_id, teacher_id, grade_id,
               points, event_type, reference_type, reference_id, reference_key,
               metadata, transaction_created_at
             )
             SELECT $1, t.id, t.student_id, t.teacher_id, t.grade_id,
                    t.points, t.event_type, t.reference_type, t.reference_id, t.reference_key,
                    t.metadata, t.created_at
             FROM point_transactions t
             WHERE t.teacher_id = $2 AND t.grade_id = $3`,
            [seasonId, opts.teacherId, opts.gradeId],
          )
        : await client.query(
            `INSERT INTO point_transaction_archives (
               season_id, original_transaction_id, student_id, teacher_id, grade_id,
               points, event_type, reference_type, reference_id, reference_key,
               metadata, transaction_created_at
             )
             SELECT $1, t.id, t.student_id, t.teacher_id, t.grade_id,
                    t.points, t.event_type, t.reference_type, t.reference_id, t.reference_key,
                    t.metadata, t.created_at
             FROM point_transactions t
             WHERE t.teacher_id = $2`,
            [seasonId, opts.teacherId],
          );

    const statsRes = await client.query<{
      students_count: string;
      total_points_sum: string;
    }>(
      `SELECT COUNT(*)::text AS students_count,
              COALESCE(SUM(total_points), 0)::text AS total_points_sum
       FROM student_point_balance_archives
       WHERE season_id = $1`,
      [seasonId],
    );

    const studentsCount = Number(statsRes.rows[0]?.students_count ?? 0);
    const totalPointsSum = Number(statsRes.rows[0]?.total_points_sum ?? 0);
    const transactionsArchived = txArchive.rowCount ?? 0;
    const balancesArchived = balArchive.rowCount ?? 0;

    await client.query(
      `UPDATE teacher_points_seasons
       SET students_count = $2,
           total_points_sum = $3,
           transactions_count = $4
       WHERE id = $1`,
      [seasonId, studentsCount, totalPointsSum, transactionsArchived],
    );

    if (opts.gradeId != null) {
      await client.query(
        `DELETE FROM point_transactions WHERE teacher_id = $1 AND grade_id = $2`,
        [opts.teacherId, opts.gradeId],
      );
      await client.query(
        `DELETE FROM student_point_balances WHERE teacher_id = $1 AND grade_id = $2`,
        [opts.teacherId, opts.gradeId],
      );
    } else {
      await client.query(`DELETE FROM point_transactions WHERE teacher_id = $1`, [
        opts.teacherId,
      ]);
      await client.query(`DELETE FROM student_point_balances WHERE teacher_id = $1`, [
        opts.teacherId,
      ]);
    }

    return {
      seasonId,
      balancesArchived,
      transactionsArchived,
      studentsCount,
      totalPointsSum,
    };
  }

  /**
   * تصفير نقاط طلاب المدرس والبدء من جديد مع حفظ سجل الموسم السابق للاسترجاع لاحقًا.
   * يتطلب confirm = "RESET_ALL_POINTS".
   */
  static async resetAllStudentsPoints(opts: {
    teacherId: number;
    confirm: string;
    gradeId?: number | null;
    label?: string | null;
    reason?: string | null;
  }): Promise<{
    reset: true;
    teacherId: number;
    gradeId: number | null;
    seasonId: number;
    balancesCleared: number;
    transactionsDeleted: number;
    studentsCount: number;
    totalPointsSum: number;
  }> {
    if (opts.confirm !== 'RESET_ALL_POINTS') {
      throw new HttpError(
        400,
        'للتأكيد أرسل confirm: "RESET_ALL_POINTS"',
      );
    }

    const gradeId = await this.assertTeacherOwnsGrade(opts.teacherId, opts.gradeId ?? null);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const archived = await this.archiveLivePointsInClient(client, {
        teacherId: opts.teacherId,
        gradeId,
        archivedBy: opts.teacherId,
        label: opts.label ?? null,
        reason: opts.reason ?? null,
        source: 'reset',
      });
      await client.query('COMMIT');
      return {
        reset: true,
        teacherId: opts.teacherId,
        gradeId,
        seasonId: archived.seasonId,
        balancesCleared: archived.balancesArchived,
        transactionsDeleted: archived.transactionsArchived,
        studentsCount: archived.studentsCount,
        totalPointsSum: archived.totalPointsSum,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * تصفير كل نقاط طلاب المدرس ثم منح نقاط بدء + درجة آخر امتحان شامل فقط لكل صف.
   * يختار أحدث امتحان حسب تاريخ إنشائه (ليس آخر تسليم فردي)، ثم يحذف أي نقاط امتحان أخرى.
   */
  static async resetAndRebuildFromLastExam(opts: {
    teacherId: number;
    confirm: string;
    gradeId?: number | null;
    label?: string | null;
    reason?: string | null;
  }): Promise<{
    reset: true;
    rebuilt: true;
    teacherId: number;
    seasonId: number;
    gradesProcessed: number;
    studentsAwarded: number;
    startAwards: number;
    scoreAwards: number;
    purgedOtherExamTransactions: number;
    examsUsed: Array<{
      gradeId: number;
      examId: number;
      examTitle: string | null;
      students: number;
    }>;
  }> {
    if (opts.confirm !== 'RESET_AND_REBUILD_LAST_EXAM') {
      throw new HttpError(400, 'للتأكيد أرسل confirm: "RESET_AND_REBUILD_LAST_EXAM"');
    }

    const gradeFilter = await this.assertTeacherOwnsGrade(opts.teacherId, opts.gradeId ?? null);

    // 1) تصفير كامل لكل نقاط المدرس دائمًا (حتى لو طُلب صف واحد) لمنع بقاء امتحانات قديمة
    const reset = await this.resetAllStudentsPoints({
      teacherId: opts.teacherId,
      confirm: 'RESET_ALL_POINTS',
      gradeId: null,
      label: opts.label ?? 'إعادة بناء من آخر امتحان فقط',
      reason: opts.reason ?? 'wipe_and_rebuild_last_exam',
    });

    const gradesRes =
      gradeFilter != null
        ? { rows: [{ grade_id: gradeFilter }] }
        : await pool.query<{ grade_id: number }>(
            `SELECT grade_id FROM teacher_grades WHERE teacher_id = $1 ORDER BY grade_id`,
            [opts.teacherId],
          );

    let studentsAwarded = 0;
    let startAwards = 0;
    let scoreAwards = 0;
    const allowedExamIds = new Set<number>();
    const examsUsed: Array<{
      gradeId: number;
      examId: number;
      examTitle: string | null;
      students: number;
    }> = [];

    for (const g of gradesRes.rows) {
      const gradeId = Number(g.grade_id);
      const lastExam = await this.findLastCourseExamForGrade(opts.teacherId, gradeId);
      if (!lastExam) continue;
      allowedExamIds.add(lastExam.id);

      // لكل طالب: آخر محاولة مُسلَّمة على هذا الامتحان فقط
      const attemptsRes = await pool.query<{
        id: number;
        student_id: number;
        obtained_grade: number | null;
        total_grade: number | null;
      }>(
        `SELECT DISTINCT ON (a.student_id)
           a.id, a.student_id, a.obtained_grade, a.total_grade
         FROM course_level_exam_attempts a
         WHERE a.exam_id = $1 AND a.status = 'submitted'
         ORDER BY a.student_id, a.submitted_at DESC NULLS LAST, a.attempt_number DESC, a.id DESC`,
        [lastExam.id],
      );

      let gradeStudents = 0;
      for (const attempt of attemptsRes.rows) {
        const studentId = Number(attempt.student_id);
        const attemptId = Number(attempt.id);
        const obtained = Math.max(0, Math.floor(Number(attempt.obtained_grade ?? 0)));
        const total = Math.max(obtained, Math.floor(Number(attempt.total_grade ?? 0)));

        const start = await this.awardExamOrAssignmentStart({
          studentId,
          teacherId: opts.teacherId,
          courseId: lastExam.course_id,
          attemptId,
          examId: lastExam.id,
          isAssignment: false,
          examKind: 'course',
          title: lastExam.title,
        });
        if (start.awarded) startAwards += 1;

        const score = await this.awardExamOrAssignmentScore({
          studentId,
          teacherId: opts.teacherId,
          courseId: lastExam.course_id,
          attemptId,
          examId: lastExam.id,
          isAssignment: false,
          examKind: 'course',
          obtainedGrade: obtained,
          totalGrade: total,
          title: lastExam.title,
        });
        if (score.awarded) scoreAwards += 1;

        if (start.awarded || score.awarded) {
          studentsAwarded += 1;
          gradeStudents += 1;
        }
      }

      examsUsed.push({
        gradeId,
        examId: lastExam.id,
        examTitle: lastExam.title,
        students: gradeStudents,
      });
    }

    // 3) احذف أي نقاط امتحان/واجب/فيديو تبقى خارج آخر امتحان مسموح فقط
    const purgedOtherExamTransactions = await this.purgePointsExceptAllowedCourseExams(
      opts.teacherId,
      [...allowedExamIds],
    );

    return {
      reset: true,
      rebuilt: true,
      teacherId: opts.teacherId,
      seasonId: reset.seasonId,
      gradesProcessed: examsUsed.length,
      studentsAwarded,
      startAwards,
      scoreAwards,
      purgedOtherExamTransactions,
      examsUsed,
    };
  }

  /**
   * يحذف كل معاملات النقاط للمدرس ما عدا EXAM_START/EXAM_SCORE لآخر امتحان/امتحانات مسموحة،
   * ثم يعيد بناء الأرصدة من المعاملات المتبقية فقط.
   */
  private static async purgePointsExceptAllowedCourseExams(
    teacherId: number,
    allowedExamIds: number[],
  ): Promise<number> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      let deleted = 0;
      if (!allowedExamIds.length) {
        // لا امتحان مسموح → امسح كل شيء وأعد الأرصدة لصفر
        const delAll = await client.query(
          `DELETE FROM point_transactions WHERE teacher_id = $1`,
          [teacherId],
        );
        deleted = delAll.rowCount ?? 0;
        await client.query(`DELETE FROM student_point_balances WHERE teacher_id = $1`, [
          teacherId,
        ]);
      } else {
        // احذف أي شيء ليس EXAM_START/SCORE لـ course_exam من القائمة المسموحة
        const del = await client.query(
          `DELETE FROM point_transactions pt
           WHERE pt.teacher_id = $1
             AND NOT (
               pt.event_type IN ('EXAM_START', 'EXAM_SCORE')
               AND pt.reference_type = 'course_exam'
               AND pt.reference_id = ANY($2::int[])
             )`,
          [teacherId, allowedExamIds],
        );
        deleted = del.rowCount ?? 0;

        // أعد بناء الأرصدة من المعاملات المتبقية فقط
        await client.query(`DELETE FROM student_point_balances WHERE teacher_id = $1`, [
          teacherId,
        ]);
        await client.query(
          `INSERT INTO student_point_balances (student_id, teacher_id, grade_id, total_points)
           SELECT student_id, teacher_id, grade_id, GREATEST(0, SUM(points)::int)
           FROM point_transactions
           WHERE teacher_id = $1
           GROUP BY student_id, teacher_id, grade_id`,
          [teacherId],
        );
      }

      await client.query('COMMIT');
      return deleted;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /** أحدث امتحان شامل/عام في الصف (حسب الإنشاء) وله محاولات مُسلَّمة */
  private static async findLastCourseExamForGrade(
    teacherId: number,
    gradeId: number,
  ): Promise<{
    id: number;
    title: string | null;
    course_id: number | null;
  } | null> {
    const orderBy = `ORDER BY e.created_at DESC NULLS LAST, e.id DESC LIMIT 1`;

    const sqlWithCourseGrades = `SELECT e.id, e.title, e.course_id
       FROM course_level_exams e
       LEFT JOIN courses c ON c.id = e.course_id
       WHERE COALESCE(e.teacher_id, c.teacher_id) = $1
         AND (
           e.grade_id = $2
           OR c.grade_id = $2
           OR EXISTS (
             SELECT 1 FROM course_grades cg
             WHERE cg.course_id = e.course_id AND cg.grade_id = $2
           )
         )
         AND EXISTS (
           SELECT 1 FROM course_level_exam_attempts a
           WHERE a.exam_id = e.id AND a.status = 'submitted'
         )
       ${orderBy}`;

    const sqlSimple = `SELECT e.id, e.title, e.course_id
       FROM course_level_exams e
       LEFT JOIN courses c ON c.id = e.course_id
       WHERE COALESCE(e.teacher_id, c.teacher_id) = $1
         AND (e.grade_id = $2 OR c.grade_id = $2)
         AND EXISTS (
           SELECT 1 FROM course_level_exam_attempts a
           WHERE a.exam_id = e.id AND a.status = 'submitted'
         )
       ${orderBy}`;

    try {
      const res = await pool.query<{ id: number; title: string | null; course_id: number | null }>(
        sqlWithCourseGrades,
        [teacherId, gradeId],
      );
      return res.rows[0] ?? null;
    } catch {
      try {
        const res = await pool.query<{ id: number; title: string | null; course_id: number | null }>(
          sqlSimple,
          [teacherId, gradeId],
        );
        return res.rows[0] ?? null;
      } catch {
        const fallback = await pool.query<{
          id: number;
          title: string | null;
          course_id: number | null;
        }>(
          `SELECT e.id, e.title, e.course_id
           FROM course_level_exams e
           LEFT JOIN courses c ON c.id = e.course_id
           WHERE COALESCE(e.teacher_id, c.teacher_id) = $1
             AND (e.grade_id = $2 OR c.grade_id = $2)
             AND EXISTS (
               SELECT 1 FROM course_level_exam_attempts a
               WHERE a.exam_id = e.id AND a.status = 'submitted'
             )
           ORDER BY e.id DESC
           LIMIT 1`,
          [teacherId, gradeId],
        );
        return fallback.rows[0] ?? null;
      }
    }
  }

  /** قائمة مواسم النقاط المؤرشفة للمدرس */
  static async listPointSeasons(opts: {
    teacherId: number;
    gradeId?: number | null;
    limit?: number;
  }) {
    const gradeId =
      opts.gradeId != null && Number.isFinite(Number(opts.gradeId)) && Number(opts.gradeId) > 0
        ? Number(opts.gradeId)
        : null;
    const limit = Math.min(Math.max(Number(opts.limit) || 50, 1), 200);

    const result =
      gradeId != null
        ? await pool.query(
            `SELECT id, teacher_id, grade_id, label, reason, archived_by, source,
                    students_count, total_points_sum, transactions_count, archived_at, created_at
             FROM teacher_points_seasons
             WHERE teacher_id = $1 AND (grade_id = $2 OR grade_id IS NULL)
             ORDER BY archived_at DESC
             LIMIT $3`,
            [opts.teacherId, gradeId, limit],
          )
        : await pool.query(
            `SELECT id, teacher_id, grade_id, label, reason, archived_by, source,
                    students_count, total_points_sum, transactions_count, archived_at, created_at
             FROM teacher_points_seasons
             WHERE teacher_id = $1
             ORDER BY archived_at DESC
             LIMIT $2`,
            [opts.teacherId, limit],
          );

    return result.rows.map((row) => ({
      id: row.id,
      teacherId: row.teacher_id,
      gradeId: row.grade_id,
      label: row.label,
      reason: row.reason,
      source: row.source,
      archivedBy: row.archived_by,
      studentsCount: Number(row.students_count ?? 0),
      totalPointsSum: Number(row.total_points_sum ?? 0),
      transactionsCount: Number(row.transactions_count ?? 0),
      archivedAt: row.archived_at,
      createdAt: row.created_at,
    }));
  }

  /** تفاصيل موسم مؤرشف + أرصدة الطلاب */
  static async getPointSeason(opts: {
    teacherId: number;
    seasonId: number;
    includeBalances?: boolean;
    balancesLimit?: number;
  }) {
    const seasonId = Number(opts.seasonId);
    if (!Number.isInteger(seasonId) || seasonId <= 0) {
      throw new HttpError(400, 'Invalid seasonId');
    }

    const seasonRes = await pool.query(
      `SELECT id, teacher_id, grade_id, label, reason, archived_by, source,
              students_count, total_points_sum, transactions_count, archived_at, created_at
       FROM teacher_points_seasons
       WHERE id = $1 AND teacher_id = $2`,
      [seasonId, opts.teacherId],
    );
    if (!seasonRes.rowCount) {
      throw new HttpError(404, 'موسم النقاط غير موجود');
    }
    const row = seasonRes.rows[0];
    const season = {
      id: row.id,
      teacherId: row.teacher_id,
      gradeId: row.grade_id,
      label: row.label,
      reason: row.reason,
      source: row.source,
      archivedBy: row.archived_by,
      studentsCount: Number(row.students_count ?? 0),
      totalPointsSum: Number(row.total_points_sum ?? 0),
      transactionsCount: Number(row.transactions_count ?? 0),
      archivedAt: row.archived_at,
      createdAt: row.created_at,
    };

    if (opts.includeBalances === false) {
      return { season, balances: [] as Array<Record<string, unknown>> };
    }

    const limit = Math.min(Math.max(Number(opts.balancesLimit) || 200, 1), 1000);
    const balancesRes = await pool.query(
      `SELECT a.student_id, a.grade_id, a.total_points,
              u.name AS student_name, u.phone AS student_phone
       FROM student_point_balance_archives a
       LEFT JOIN users u ON u.id = a.student_id
       WHERE a.season_id = $1
       ORDER BY a.total_points DESC, a.student_id ASC
       LIMIT $2`,
      [seasonId, limit],
    );

    return {
      season,
      balances: balancesRes.rows.map((b) => ({
        studentId: b.student_id,
        gradeId: b.grade_id,
        totalPoints: Number(b.total_points ?? 0),
        studentName: b.student_name ?? null,
        studentPhone: b.student_phone ?? null,
      })),
    };
  }

  /** سجل معاملات طالب داخل موسم مؤرشف */
  static async getSeasonStudentTransactions(opts: {
    teacherId: number;
    seasonId: number;
    studentId: number;
    limit?: number;
  }) {
    const seasonId = Number(opts.seasonId);
    const studentId = Number(opts.studentId);
    if (!Number.isInteger(seasonId) || seasonId <= 0) {
      throw new HttpError(400, 'Invalid seasonId');
    }
    if (!Number.isInteger(studentId) || studentId <= 0) {
      throw new HttpError(400, 'Invalid studentId');
    }

    const seasonRes = await pool.query(
      `SELECT id FROM teacher_points_seasons WHERE id = $1 AND teacher_id = $2`,
      [seasonId, opts.teacherId],
    );
    if (!seasonRes.rowCount) {
      throw new HttpError(404, 'موسم النقاط غير موجود');
    }

    const limit = Math.min(Math.max(Number(opts.limit) || 200, 1), 500);
    const txRes = await pool.query(
      `SELECT id, original_transaction_id, student_id, teacher_id, grade_id,
              points, event_type, reference_type, reference_id, reference_key,
              metadata, transaction_created_at
       FROM point_transaction_archives
       WHERE season_id = $1 AND student_id = $2 AND teacher_id = $3
       ORDER BY transaction_created_at DESC, id DESC
       LIMIT $4`,
      [seasonId, studentId, opts.teacherId, limit],
    );

    return {
      seasonId,
      studentId,
      transactions: txRes.rows.map((t) => ({
        id: t.id,
        originalTransactionId: t.original_transaction_id,
        studentId: t.student_id,
        teacherId: t.teacher_id,
        gradeId: t.grade_id,
        points: Number(t.points ?? 0),
        eventType: t.event_type,
        referenceType: t.reference_type,
        referenceId: t.reference_id,
        referenceKey: t.reference_key,
        metadata: t.metadata && typeof t.metadata === 'object' ? t.metadata : {},
        createdAt: t.transaction_created_at,
      })),
    };
  }

  /**
   * استرجاع موسم نقاط سابق ليصبح الرصيد الحالي.
   * يحفظ أولًا نسخة احتياطية من النقاط الحالية ثم يستبدلها بالموسم المطلوب.
   */
  static async restorePointSeason(opts: {
    teacherId: number;
    seasonId: number;
    confirm: string;
  }): Promise<{
    restored: true;
    seasonId: number;
    backupSeasonId: number | null;
    balancesRestored: number;
    transactionsRestored: number;
  }> {
    if (opts.confirm !== 'RESTORE_POINTS_SEASON') {
      throw new HttpError(400, 'للتأكيد أرسل confirm: "RESTORE_POINTS_SEASON"');
    }

    const seasonId = Number(opts.seasonId);
    if (!Number.isInteger(seasonId) || seasonId <= 0) {
      throw new HttpError(400, 'Invalid seasonId');
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const seasonRes = await client.query<{
        id: number;
        teacher_id: number;
        grade_id: number | null;
      }>(
        `SELECT id, teacher_id, grade_id
         FROM teacher_points_seasons
         WHERE id = $1 AND teacher_id = $2
         FOR UPDATE`,
        [seasonId, opts.teacherId],
      );
      if (!seasonRes.rowCount) {
        throw new HttpError(404, 'موسم النقاط غير موجود');
      }
      const season = seasonRes.rows[0];
      const gradeId = season.grade_id != null ? Number(season.grade_id) : null;

      // نسخ احتياطي للنقاط الحالية قبل الاستبدال
      const liveCount =
        gradeId != null
          ? await client.query(
              `SELECT
                 (SELECT COUNT(*)::int FROM student_point_balances WHERE teacher_id = $1 AND grade_id = $2) AS bal,
                 (SELECT COUNT(*)::int FROM point_transactions WHERE teacher_id = $1 AND grade_id = $2) AS tx`,
              [opts.teacherId, gradeId],
            )
          : await client.query(
              `SELECT
                 (SELECT COUNT(*)::int FROM student_point_balances WHERE teacher_id = $1) AS bal,
                 (SELECT COUNT(*)::int FROM point_transactions WHERE teacher_id = $1) AS tx`,
              [opts.teacherId],
            );

      let backupSeasonId: number | null = null;
      const hasLive =
        Number(liveCount.rows[0]?.bal ?? 0) > 0 || Number(liveCount.rows[0]?.tx ?? 0) > 0;
      if (hasLive) {
        const backup = await this.archiveLivePointsInClient(client, {
          teacherId: opts.teacherId,
          gradeId,
          archivedBy: opts.teacherId,
          label: `نسخة قبل استرجاع الموسم #${seasonId}`,
          reason: 'pre_restore_backup',
          source: 'pre_restore_backup',
        });
        backupSeasonId = backup.seasonId;
      } else if (gradeId != null) {
        await client.query(
          `DELETE FROM point_transactions WHERE teacher_id = $1 AND grade_id = $2`,
          [opts.teacherId, gradeId],
        );
        await client.query(
          `DELETE FROM student_point_balances WHERE teacher_id = $1 AND grade_id = $2`,
          [opts.teacherId, gradeId],
        );
      } else {
        await client.query(`DELETE FROM point_transactions WHERE teacher_id = $1`, [
          opts.teacherId,
        ]);
        await client.query(`DELETE FROM student_point_balances WHERE teacher_id = $1`, [
          opts.teacherId,
        ]);
      }

      const balRestore = await client.query(
        `INSERT INTO student_point_balances (
           student_id, teacher_id, grade_id, total_points, created_at, updated_at
         )
         SELECT student_id, teacher_id, grade_id, total_points,
                COALESCE(balance_created_at, NOW()), COALESCE(balance_updated_at, NOW())
         FROM student_point_balance_archives
         WHERE season_id = $1
         ON CONFLICT (student_id, teacher_id, grade_id) DO UPDATE
         SET total_points = EXCLUDED.total_points,
             updated_at = NOW()`,
        [seasonId],
      );

      const txRestore = await client.query(
        `INSERT INTO point_transactions (
           student_id, teacher_id, grade_id, points, event_type,
           reference_type, reference_id, reference_key, metadata, created_at
         )
         SELECT student_id, teacher_id, grade_id, points, event_type,
                reference_type, reference_id, reference_key, metadata,
                COALESCE(transaction_created_at, NOW())
         FROM point_transaction_archives
         WHERE season_id = $1
         ON CONFLICT (reference_key) DO NOTHING`,
        [seasonId],
      );

      await client.query('COMMIT');
      return {
        restored: true,
        seasonId,
        backupSeasonId,
        balancesRestored: balRestore.rowCount ?? 0,
        transactionsRestored: txRestore.rowCount ?? 0,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * حذف نقاط منحها المدرس يدوياً (MANUAL_REWARD) وخصمها من رصيد الطالب.
   */
  static async revokeManualReward(opts: {
    teacherId: number;
    transactionId: number;
  }): Promise<{
    deleted: true;
    transactionId: number;
    studentId: number;
    pointsRemoved: number;
    totalPoints: number;
  }> {
    const txId = Number(opts.transactionId);
    if (!Number.isInteger(txId) || txId <= 0) {
      throw new HttpError(400, 'Invalid transactionId');
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const txRes = await client.query<{
        id: number;
        student_id: number;
        teacher_id: number;
        grade_id: number;
        points: number;
        event_type: string;
      }>(
        `SELECT id, student_id, teacher_id, grade_id, points, event_type
         FROM point_transactions
         WHERE id = $1
         FOR UPDATE`,
        [txId],
      );

      if (!txRes.rowCount) {
        throw new HttpError(404, 'معاملة النقاط غير موجودة');
      }

      const tx = txRes.rows[0];
      if (Number(tx.teacher_id) !== opts.teacherId) {
        throw new HttpError(403, 'لا يمكنك حذف نقاط لا تخصك');
      }
      if (tx.event_type !== 'MANUAL_REWARD') {
        throw new HttpError(
          409,
          'يمكن حذف النقاط الممنوحة يدوياً فقط (MANUAL_REWARD)',
        );
      }

      const pointsRemoved = Math.max(0, Math.floor(Number(tx.points) || 0));
      const studentId = Number(tx.student_id);
      const gradeId = Number(tx.grade_id);

      await client.query(`DELETE FROM point_transactions WHERE id = $1`, [txId]);

      let totalPoints = 0;
      if (pointsRemoved > 0) {
        const balRes = await client.query<{ total_points: number }>(
          `UPDATE student_point_balances
           SET total_points = GREATEST(0, total_points - $1),
               updated_at = NOW()
           WHERE student_id = $2 AND teacher_id = $3 AND grade_id = $4
           RETURNING total_points`,
          [pointsRemoved, studentId, opts.teacherId, gradeId],
        );
        totalPoints = balRes.rowCount
          ? Number(balRes.rows[0].total_points)
          : 0;
      } else {
        totalPoints = await this.getBalance(studentId, opts.teacherId, gradeId);
      }

      await client.query('COMMIT');
      return {
        deleted: true,
        transactionId: txId,
        studentId,
        pointsRemoved,
        totalPoints,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // ─── Ranking ─────────────────────────────────────────────────────────────

  static async getStudentRankSummary(opts: {
    studentId: number;
    teacherId: number;
    gradeId: number;
  }) {
    const totalPoints = await this.getBalance(opts.studentId, opts.teacherId, opts.gradeId);

    const totalsRes = await pool.query<{ cnt: string }>(
      `SELECT COUNT(*)::text AS cnt
       FROM student_point_balances
       WHERE teacher_id = $1 AND grade_id = $2`,
      [opts.teacherId, opts.gradeId],
    );
    // Include students with 0 points who have a grade but no balance row:
    // count balances + ensure current student is counted.
    let totalStudents = Number(totalsRes.rows[0]?.cnt || 0);
    if (totalPoints === 0 && totalStudents === 0) {
      totalStudents = 1;
    } else if (totalPoints === 0) {
      const hasRow = await pool.query(
        `SELECT 1 FROM student_point_balances
         WHERE student_id = $1 AND teacher_id = $2 AND grade_id = $3`,
        [opts.studentId, opts.teacherId, opts.gradeId],
      );
      if (!hasRow.rowCount) {
        totalStudents += 1;
      }
    }

    const higherRes = await pool.query<{ cnt: string }>(
      `SELECT COUNT(*)::text AS cnt
       FROM student_point_balances
       WHERE teacher_id = $1 AND grade_id = $2 AND total_points > $3`,
      [opts.teacherId, opts.gradeId, totalPoints],
    );
    const rank = Number(higherRes.rows[0]?.cnt || 0) + 1;

    const nextRes = await pool.query<{ total_points: number }>(
      `SELECT total_points
       FROM student_point_balances
       WHERE teacher_id = $1 AND grade_id = $2 AND total_points > $3
       ORDER BY total_points ASC
       LIMIT 1`,
      [opts.teacherId, opts.gradeId, totalPoints],
    );
    const pointsToNextRank =
      rank === 1 || !nextRes.rowCount
        ? 0
        : Number(nextRes.rows[0].total_points) - totalPoints;

    return {
      totalPoints,
      rank,
      totalStudents: Math.max(totalStudents, rank),
      pointsToNextRank: Math.max(0, pointsToNextRank),
      gradeId: opts.gradeId,
      teacherId: opts.teacherId,
    };
  }

  static async getTopLeaderboard(opts: {
    teacherId: number;
    gradeId: number;
    limit?: number;
  }) {
    const limit = Math.min(Math.max(opts.limit ?? 10, 1), 50);
    const res = await pool.query(
      `SELECT
         b.student_id,
         b.total_points,
         u.name AS student_name,
         u.avatar AS student_avatar,
         RANK() OVER (ORDER BY b.total_points DESC, b.student_id ASC) AS rank
       FROM student_point_balances b
       JOIN users u ON u.id = b.student_id
       WHERE b.teacher_id = $1 AND b.grade_id = $2
       ORDER BY b.total_points DESC, b.student_id ASC
       LIMIT $3`,
      [opts.teacherId, opts.gradeId, limit],
    );

    return {
      classId: opts.gradeId,
      teacherId: opts.teacherId,
      topStudents: res.rows.map((row) => ({
        rank: Number(row.rank),
        studentId: Number(row.student_id),
        name: row.student_name,
        avatar: row.student_avatar ?? null,
        points: Number(row.total_points),
      })),
    };
  }

  static async getTeacherLeaderboard(opts: {
    teacherId: number;
    gradeId?: number | null;
    groupId?: number | null;
    search?: string | null;
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const offset = (page - 1) * limit;

    const params: unknown[] = [opts.teacherId];
    let where = `b.teacher_id = $1`;
    let i = 2;

    if (opts.gradeId) {
      where += ` AND b.grade_id = $${i++}`;
      params.push(opts.gradeId);
    }

    if (opts.groupId) {
      where += ` AND EXISTS (
        SELECT 1 FROM group_students gs
        JOIN study_groups sg ON sg.id = gs.group_id
        WHERE gs.student_id = b.student_id
          AND gs.group_id = $${i}
          AND sg.teacher_id = $1
      )`;
      params.push(opts.groupId);
      i++;
    }

    if (opts.search?.trim()) {
      where += ` AND (u.name ILIKE $${i} OR u.email ILIKE $${i} OR COALESCE(u.phone, '') ILIKE $${i})`;
      params.push(`%${opts.search.trim()}%`);
      i++;
    }

    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS cnt
       FROM student_point_balances b
       JOIN users u ON u.id = b.student_id
       WHERE ${where}`,
      params,
    );

    params.push(limit, offset);
    const res = await pool.query(
      `SELECT
         b.student_id,
         b.grade_id,
         b.total_points,
         u.name AS student_name,
         u.email AS student_email,
         u.avatar AS student_avatar,
         g.name AS grade_name,
         cg.id AS course_group_id,
         cg.name AS course_group_name,
         cg.grade_id AS course_group_grade_id,
         cg.status AS course_group_status,
         RANK() OVER (PARTITION BY b.grade_id ORDER BY b.total_points DESC, b.student_id ASC) AS rank
       FROM student_point_balances b
       JOIN users u ON u.id = b.student_id
       LEFT JOIN grades g ON g.id = b.grade_id
       LEFT JOIN LATERAL (
         SELECT m.group_id
         FROM student_course_group_memberships m
         JOIN course_groups cg0 ON cg0.id = m.group_id
         WHERE m.student_id = b.student_id
           AND cg0.teacher_id = $1
           AND cg0.status = 'active'
         ORDER BY m.updated_at DESC
         LIMIT 1
       ) cg_ref ON TRUE
       LEFT JOIN course_groups cg ON cg.id = cg_ref.group_id
       WHERE ${where}
       ORDER BY b.total_points DESC, b.student_id ASC
       LIMIT $${i++} OFFSET $${i}`,
      params,
    );

    return {
      page,
      limit,
      total: Number(countRes.rows[0]?.cnt || 0),
      students: res.rows.map((row) => ({
        rank: Number(row.rank),
        studentId: Number(row.student_id),
        name: row.student_name,
        email: row.student_email,
        avatar: row.student_avatar ?? null,
        gradeId: Number(row.grade_id),
        gradeName: row.grade_name ?? null,
        points: Number(row.total_points),
        courseGroup: row.course_group_id
          ? {
              id: Number(row.course_group_id),
              name: row.course_group_name ?? null,
              gradeId:
                row.course_group_grade_id != null
                  ? Number(row.course_group_grade_id)
                  : null,
              status: row.course_group_status ?? null,
            }
          : null,
      })),
    };
  }

  static async listStudentTransactions(opts: {
    teacherId: number;
    studentId: number;
    gradeId?: number | null;
    limit?: number;
  }) {
    const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
    const params: unknown[] = [opts.teacherId, opts.studentId];
    let where = `teacher_id = $1 AND student_id = $2`;
    if (opts.gradeId) {
      where += ` AND grade_id = $3`;
      params.push(opts.gradeId);
    }
    params.push(limit);
    const res = await pool.query(
      `SELECT id, points, event_type, reference_type, reference_id, reference_key, metadata, grade_id, created_at
       FROM point_transactions
       WHERE ${where}
       ORDER BY created_at DESC
       LIMIT $${params.length}`,
      params,
    );
    return res.rows.map((row) => ({
      id: Number(row.id),
      points: Number(row.points),
      eventType: row.event_type,
      referenceType: row.reference_type,
      referenceId: row.reference_id != null ? Number(row.reference_id) : null,
      referenceKey: row.reference_key,
      metadata: row.metadata,
      gradeId: Number(row.grade_id),
      createdAt: row.created_at,
    }));
  }

  /** Context for student-facing APIs: teacher + primary grade. */
  static async resolveStudentPointsContext(studentId: number): Promise<{
    teacherId: number;
    gradeId: number;
  } | null> {
    const teacherId = await this.resolveTeacherIdForStudent(studentId);
    if (!teacherId) return null;
    const gradeId = await this.resolveGradeId({ studentId, teacherId });
    if (!gradeId) return null;
    return { teacherId, gradeId };
  }
}
