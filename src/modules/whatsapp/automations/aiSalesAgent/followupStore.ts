import pool from '../../../../db/pool';
import type { SalesFollowupRow, SalesFollowupStatus } from './types';

function mapFollowup(row: any): SalesFollowupRow {
  return {
    id: Number(row.id),
    session_id: Number(row.session_id),
    lead_id: Number(row.lead_id),
    scheduled_at: row.scheduled_at,
    status: row.status as SalesFollowupStatus,
    reason: row.reason ?? null,
    instructions: row.instructions ?? null,
    message_preview: row.message_preview ?? null,
    outbound_job_id: row.outbound_job_id != null ? Number(row.outbound_job_id) : null,
    attempts: Number(row.attempts || 0),
    last_error: row.last_error ?? null,
    sent_at: row.sent_at ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export class SalesFollowupStore {
  static async create(opts: {
    sessionId: number;
    leadId: number;
    scheduledAt: Date;
    reason?: string | null;
    instructions?: string | null;
  }): Promise<SalesFollowupRow> {
    // Cancel older pending followups for same lead to avoid spam
    await pool.query(
      `UPDATE wa_sales_followups
       SET status = 'cancelled', updated_at = NOW()
       WHERE lead_id = $1 AND status = 'pending'`,
      [opts.leadId],
    );

    const res = await pool.query(
      `INSERT INTO wa_sales_followups
         (session_id, lead_id, scheduled_at, reason, instructions)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING *`,
      [
        opts.sessionId,
        opts.leadId,
        opts.scheduledAt.toISOString(),
        opts.reason ?? null,
        opts.instructions ?? null,
      ],
    );

    await pool.query(
      `UPDATE wa_sales_leads
       SET next_followup_at = $1, updated_at = NOW()
       WHERE id = $2 AND session_id = $3`,
      [opts.scheduledAt.toISOString(), opts.leadId, opts.sessionId],
    );

    return mapFollowup(res.rows[0]);
  }

  static async cancelPendingForLead(leadId: number, reason?: string) {
    await pool.query(
      `UPDATE wa_sales_followups
       SET status = 'cancelled',
           last_error = COALESCE($2, last_error),
           updated_at = NOW()
       WHERE lead_id = $1 AND status = 'pending'`,
      [leadId, reason ?? null],
    );
    await pool.query(
      `UPDATE wa_sales_leads
       SET next_followup_at = NULL, updated_at = NOW()
       WHERE id = $1`,
      [leadId],
    );
  }

  static async listDue(limit = 20): Promise<
    Array<
      SalesFollowupRow & {
        contact_phone: string;
        wa_session_slug: string | null;
        ai_enabled: boolean;
        followups_stopped: boolean;
        lead_status: string;
        session_status: string;
        followup_settings: any;
        context_summary: string | null;
        dialect: string | null;
        tone: string | null;
        product_name: string;
        sales_instructions: string | null;
        service_id: number | null;
      }
    >
  > {
    const res = await pool.query(
      `SELECT f.*,
              l.contact_phone, l.ai_enabled, l.followups_stopped, l.status AS lead_status,
              l.context_summary, l.followup_count,
              s.wa_session_slug, s.status AS session_status, s.followup_settings,
              s.dialect, s.tone, s.product_name, s.sales_instructions,
              svc.id AS service_id
       FROM wa_sales_followups f
       JOIN wa_sales_leads l ON l.id = f.lead_id
       JOIN wa_sales_agent_sessions s ON s.id = f.session_id
       LEFT JOIN wa_services svc ON svc.key = 'ai_sales_agent'
       WHERE f.status = 'pending'
         AND f.scheduled_at <= NOW()
         AND s.status = 'active'
         AND l.status = 'open'
         AND l.followups_stopped = FALSE
         AND l.ai_enabled = TRUE
       ORDER BY f.scheduled_at ASC
       LIMIT $1`,
      [Math.min(50, Math.max(1, limit))],
    );
    return res.rows.map((row) => ({
      ...mapFollowup(row),
      contact_phone: row.contact_phone,
      wa_session_slug: row.wa_session_slug,
      ai_enabled: row.ai_enabled !== false,
      followups_stopped: Boolean(row.followups_stopped),
      lead_status: row.lead_status,
      session_status: row.session_status,
      followup_settings:
        typeof row.followup_settings === 'string'
          ? JSON.parse(row.followup_settings)
          : row.followup_settings || {},
      context_summary: row.context_summary,
      dialect: row.dialect,
      tone: row.tone,
      product_name: row.product_name,
      sales_instructions: row.sales_instructions,
      service_id: row.service_id != null ? Number(row.service_id) : null,
    }));
  }

  static async mark(
    id: number,
    patch: {
      status: SalesFollowupStatus;
      outboundJobId?: number | null;
      lastError?: string | null;
      messagePreview?: string | null;
    },
  ) {
    await pool.query(
      `UPDATE wa_sales_followups
       SET status = $2,
           outbound_job_id = COALESCE($3, outbound_job_id),
           last_error = $4,
           message_preview = COALESCE($5, message_preview),
           sent_at = CASE WHEN $2 = 'sent' THEN NOW() ELSE sent_at END,
           attempts = attempts + 1,
           updated_at = NOW()
       WHERE id = $1`,
      [
        id,
        patch.status,
        patch.outboundJobId ?? null,
        patch.lastError ?? null,
        patch.messagePreview ?? null,
      ],
    );
  }

  static async listForLead(sessionId: number, leadId: number) {
    const res = await pool.query(
      `SELECT * FROM wa_sales_followups
       WHERE session_id = $1 AND lead_id = $2
       ORDER BY scheduled_at DESC
       LIMIT 50`,
      [sessionId, leadId],
    );
    return res.rows.map(mapFollowup);
  }
}
