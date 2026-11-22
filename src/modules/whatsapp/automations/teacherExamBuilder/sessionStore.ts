import pool from '../../../../db/pool';
import type {
  ExamAssistantSessionContext,
  ExamAssistantSessionRow,
  ExamAssistantSourceType,
  ExamAssistantState,
} from './types';

function mapRow(row: any): ExamAssistantSessionRow {
  const ctx =
    typeof row.context === 'string'
      ? JSON.parse(row.context || '{}')
      : row.context || {};
  return {
    id: Number(row.id),
    teacher_id: Number(row.teacher_id),
    tenant_id: row.tenant_id != null ? Number(row.tenant_id) : null,
    conversation_id: row.conversation_id != null ? Number(row.conversation_id) : null,
    contact_phone: String(row.contact_phone || ''),
    state: row.state,
    source_type: row.source_type,
    context: ctx,
    exam_builder_session_id: row.exam_builder_session_id || null,
    draft_exam_id: row.draft_exam_id != null ? Number(row.draft_exam_id) : null,
    draft_exam_kind: row.draft_exam_kind || null,
    status: row.status,
    last_error: row.last_error || null,
    last_interaction_at: row.last_interaction_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export class ExamAssistantSessionStore {
  static async getActiveForTeacher(teacherId: number): Promise<ExamAssistantSessionRow | null> {
    const res = await pool.query(
      `SELECT * FROM wa_exam_assistant_sessions
       WHERE teacher_id = $1 AND status = 'active'
       ORDER BY updated_at DESC
       LIMIT 1`,
      [teacherId],
    );
    return res.rowCount ? mapRow(res.rows[0]) : null;
  }

  static async getById(sessionId: number, teacherId: number): Promise<ExamAssistantSessionRow | null> {
    const res = await pool.query(
      `SELECT * FROM wa_exam_assistant_sessions WHERE id = $1 AND teacher_id = $2`,
      [sessionId, teacherId],
    );
    return res.rowCount ? mapRow(res.rows[0]) : null;
  }

  static async create(opts: {
    teacherId: number;
    tenantId?: number | null;
    conversationId?: number | null;
    contactPhone: string;
    state?: ExamAssistantState;
    context?: ExamAssistantSessionContext;
  }): Promise<ExamAssistantSessionRow> {
    const res = await pool.query(
      `INSERT INTO wa_exam_assistant_sessions
         (teacher_id, tenant_id, conversation_id, contact_phone, state, context, status)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'active')
       RETURNING *`,
      [
        opts.teacherId,
        opts.tenantId ?? null,
        opts.conversationId ?? null,
        opts.contactPhone,
        opts.state || 'IDLE',
        JSON.stringify(opts.context || {}),
      ],
    );
    return mapRow(res.rows[0]);
  }

  static async update(
    sessionId: number,
    teacherId: number,
    patch: {
      state?: ExamAssistantState;
      source_type?: ExamAssistantSourceType | null;
      context?: ExamAssistantSessionContext;
      exam_builder_session_id?: string | null;
      draft_exam_id?: number | null;
      draft_exam_kind?: 'lecture-exam' | 'course-exam' | null;
      status?: 'active' | 'completed' | 'cancelled' | 'failed';
      last_error?: string | null;
      conversation_id?: number | null;
    },
  ): Promise<ExamAssistantSessionRow> {
    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    const map: Record<string, unknown> = {
      state: patch.state,
      source_type: patch.source_type,
      context: patch.context != null ? JSON.stringify(patch.context) : undefined,
      exam_builder_session_id: patch.exam_builder_session_id,
      draft_exam_id: patch.draft_exam_id,
      draft_exam_kind: patch.draft_exam_kind,
      status: patch.status,
      last_error: patch.last_error,
      conversation_id: patch.conversation_id,
    };
    for (const [key, val] of Object.entries(map)) {
      if (val === undefined) continue;
      fields.push(`${key} = $${i++}`);
      values.push(val);
    }
    fields.push(`last_interaction_at = NOW()`);
    fields.push(`updated_at = NOW()`);
    values.push(sessionId, teacherId);
    const res = await pool.query(
      `UPDATE wa_exam_assistant_sessions
       SET ${fields.join(', ')}
       WHERE id = $${i++} AND teacher_id = $${i}
       RETURNING *`,
      values,
    );
    if (!res.rowCount) throw new Error('exam assistant session not found');
    return mapRow(res.rows[0]);
  }

  static async mergeContext(
    sessionId: number,
    teacherId: number,
    patch: ExamAssistantSessionContext,
  ): Promise<ExamAssistantSessionRow> {
    const current = await this.getById(sessionId, teacherId);
    if (!current) throw new Error('exam assistant session not found');
    return this.update(sessionId, teacherId, {
      context: { ...current.context, ...patch },
    });
  }

  static async addFile(opts: {
    sessionId: number;
    teacherId: number;
    waMessageId?: string | null;
    originalName?: string | null;
    mimeType?: string | null;
    filePath: string;
    fileSize?: number | null;
  }) {
    const res = await pool.query(
      `INSERT INTO wa_exam_assistant_files
         (session_id, teacher_id, wa_message_id, original_name, mime_type, file_path, file_size)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        opts.sessionId,
        opts.teacherId,
        opts.waMessageId ?? null,
        opts.originalName ?? null,
        opts.mimeType ?? null,
        opts.filePath,
        opts.fileSize ?? null,
      ],
    );
    return res.rows[0];
  }

  static async listFiles(sessionId: number, teacherId: number) {
    const res = await pool.query(
      `SELECT * FROM wa_exam_assistant_files
       WHERE session_id = $1 AND teacher_id = $2
       ORDER BY id ASC`,
      [sessionId, teacherId],
    );
    return res.rows;
  }

  static async listForAdmin(opts: {
    limit?: number;
    offset?: number;
    status?: string;
    state?: string;
    teacherId?: number;
    search?: string;
  } = {}) {
    const limit = Math.min(Math.max(opts.limit || 50, 1), 200);
    const offset = Math.max(opts.offset || 0, 0);
    const params: unknown[] = [];
    const where: string[] = [];
    if (opts.status) {
      params.push(opts.status);
      where.push(`s.status = $${params.length}`);
    }
    if (opts.state) {
      params.push(opts.state);
      where.push(`s.state = $${params.length}`);
    }
    if (opts.teacherId) {
      params.push(opts.teacherId);
      where.push(`s.teacher_id = $${params.length}`);
    }
    if (opts.search?.trim()) {
      params.push(`%${opts.search.trim()}%`);
      where.push(
        `(u.name ILIKE $${params.length} OR s.contact_phone ILIKE $${params.length} OR CAST(s.id AS TEXT) ILIKE $${params.length})`,
      );
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    params.push(limit, offset);
    const res = await pool.query(
      `SELECT s.*, u.name AS teacher_name,
              (SELECT COUNT(*)::int FROM wa_exam_assistant_files f WHERE f.session_id = s.id) AS files_count
       FROM wa_exam_assistant_sessions s
       JOIN users u ON u.id = s.teacher_id
       ${whereSql}
       ORDER BY s.updated_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM wa_exam_assistant_sessions s
       JOIN users u ON u.id = s.teacher_id
       ${whereSql}`,
      params.slice(0, params.length - 2),
    );
    return {
      total: countRes.rows[0]?.count || 0,
      sessions: res.rows.map((row) => ({
        ...mapRow(row),
        teacher_name: row.teacher_name,
        files_count: Number(row.files_count || 0),
      })),
    };
  }

  static async getForAdmin(sessionId: number) {
    const res = await pool.query(
      `SELECT s.*, u.name AS teacher_name, u.email AS teacher_email
       FROM wa_exam_assistant_sessions s
       JOIN users u ON u.id = s.teacher_id
       WHERE s.id = $1`,
      [sessionId],
    );
    if (!res.rowCount) return null;
    const session = {
      ...mapRow(res.rows[0]),
      teacher_name: res.rows[0].teacher_name,
      teacher_email: res.rows[0].teacher_email,
    };
    const files = await pool.query(
      `SELECT id, original_name, mime_type, file_size, wa_message_id, created_at
       FROM wa_exam_assistant_files
       WHERE session_id = $1
       ORDER BY id ASC`,
      [sessionId],
    );
    return { session, files: files.rows };
  }

  static async getOverview() {
    const [byStatus, byState, totals] = await Promise.all([
      pool.query(
        `SELECT status, COUNT(*)::int AS count
         FROM wa_exam_assistant_sessions
         GROUP BY status`,
      ),
      pool.query(
        `SELECT state, COUNT(*)::int AS count
         FROM wa_exam_assistant_sessions
         WHERE status = 'active'
         GROUP BY state`,
      ),
      pool.query(
        `SELECT
           COUNT(*)::int AS total_sessions,
           COUNT(*) FILTER (WHERE status = 'active')::int AS active_sessions,
           COUNT(*) FILTER (WHERE status = 'completed')::int AS completed_sessions,
           COUNT(*) FILTER (WHERE status = 'failed')::int AS failed_sessions,
           COUNT(*) FILTER (WHERE draft_exam_id IS NOT NULL)::int AS drafts_created,
           COUNT(*) FILTER (WHERE state = 'PUBLISHED')::int AS published_exams,
           COUNT(DISTINCT teacher_id)::int AS teachers_count
         FROM wa_exam_assistant_sessions`,
      ),
    ]);
    return {
      ...totals.rows[0],
      by_status: Object.fromEntries(byStatus.rows.map((r) => [r.status, r.count])),
      by_state: Object.fromEntries(byState.rows.map((r) => [r.state, r.count])),
    };
  }

  static async cancelFailedForTeacher(teacherId: number): Promise<number> {
    const res = await pool.query(
      `UPDATE wa_exam_assistant_sessions
       SET status = 'cancelled', state = 'CANCELLED', updated_at = NOW()
       WHERE teacher_id = $1 AND status = 'failed'`,
      [teacherId],
    );
    return res.rowCount || 0;
  }

  static async adminCancel(sessionId: number) {
    const res = await pool.query(
      `UPDATE wa_exam_assistant_sessions
       SET status = 'cancelled', state = 'CANCELLED', updated_at = NOW(),
           last_error = COALESCE(last_error, 'cancelled_by_admin')
       WHERE id = $1 AND status = 'active'
       RETURNING *`,
      [sessionId],
    );
    return res.rowCount ? mapRow(res.rows[0]) : null;
  }

  static async adminReopen(sessionId: number) {
    const res = await pool.query(
      `UPDATE wa_exam_assistant_sessions
       SET status = 'active',
           state = CASE
             WHEN draft_exam_id IS NOT NULL THEN 'READY_TO_PUBLISH'
             WHEN exam_builder_session_id IS NOT NULL THEN 'EXAM_REVIEW'
             ELSE 'IDLE'
           END,
           last_error = NULL,
           updated_at = NOW(),
           last_interaction_at = NOW()
       WHERE id = $1 AND status IN ('failed', 'cancelled')
       RETURNING *`,
      [sessionId],
    );
    return res.rowCount ? mapRow(res.rows[0]) : null;
  }
}
