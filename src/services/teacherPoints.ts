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
    return this.award({
      studentId: opts.studentId,
      teacherId: opts.teacherId,
      gradeId,
      eventType,
      points,
      referenceKey: `${eventType}:attempt:${opts.attemptId}`,
      referenceType: opts.isAssignment ? 'assignment_attempt' : 'exam_attempt',
      referenceId: opts.attemptId,
      metadata: { examId: opts.examId, title: opts.title ?? null },
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
    return this.award({
      studentId: opts.studentId,
      teacherId: opts.teacherId,
      gradeId,
      eventType,
      points,
      referenceKey: `${eventType}:attempt:${opts.attemptId}`,
      referenceType: opts.isAssignment ? 'assignment_attempt' : 'exam_attempt',
      referenceId: opts.attemptId,
      metadata: {
        examId: opts.examId,
        obtainedGrade: opts.obtainedGrade,
        totalGrade: opts.totalGrade,
        title: opts.title ?? null,
      },
    });
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
         RANK() OVER (PARTITION BY b.grade_id ORDER BY b.total_points DESC, b.student_id ASC) AS rank
       FROM student_point_balances b
       JOIN users u ON u.id = b.student_id
       LEFT JOIN grades g ON g.id = b.grade_id
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
