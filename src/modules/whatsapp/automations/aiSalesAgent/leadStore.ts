import pool from '../../../../db/pool';
import type { SalesLeadRow, SalesLeadStatus } from './types';

function asJsonArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function asJsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {
      /* ignore */
    }
  }
  return {};
}

export function mapSalesLead(row: any): SalesLeadRow {
  return {
    id: Number(row.id),
    session_id: Number(row.session_id),
    conversation_id: row.conversation_id != null ? Number(row.conversation_id) : null,
    contact_phone: String(row.contact_phone || ''),
    contact_name: row.contact_name ?? null,
    source: row.source ?? null,
    campaign_id: row.campaign_id ?? null,
    campaign_name: row.campaign_name ?? null,
    ad_id: row.ad_id ?? null,
    ad_name: row.ad_name ?? null,
    adset: row.adset ?? null,
    referral_data: asJsonObject(row.referral_data),
    stage: String(row.stage || 'new'),
    interest_score: Number(row.interest_score || 0),
    product_interest: row.product_interest ?? null,
    needs: row.needs ?? null,
    business_size: row.business_size ?? null,
    budget: row.budget ?? null,
    objections: asJsonArray(row.objections),
    ai_notes: row.ai_notes ?? null,
    human_notes: row.human_notes ?? null,
    last_action: row.last_action ?? null,
    next_followup_at: row.next_followup_at ?? null,
    followup_count: Number(row.followup_count || 0),
    followups_stopped: Boolean(row.followups_stopped),
    followup_stop_reason: row.followup_stop_reason ?? null,
    ai_enabled: row.ai_enabled !== false,
    status: (row.status || 'open') as SalesLeadStatus,
    context_summary: row.context_summary ?? null,
    memory: asJsonObject(row.memory),
    first_contact_at: row.first_contact_at,
    last_contact_at: row.last_contact_at,
    won_at: row.won_at ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export class SalesLeadStore {
  static async getById(id: number, sessionId?: number): Promise<SalesLeadRow | null> {
    const res = sessionId
      ? await pool.query(
          `SELECT * FROM wa_sales_leads WHERE id = $1 AND session_id = $2`,
          [id, sessionId],
        )
      : await pool.query(`SELECT * FROM wa_sales_leads WHERE id = $1`, [id]);
    return res.rowCount ? mapSalesLead(res.rows[0]) : null;
  }

  static async getByPhone(sessionId: number, phone: string): Promise<SalesLeadRow | null> {
    const res = await pool.query(
      `SELECT * FROM wa_sales_leads WHERE session_id = $1 AND contact_phone = $2`,
      [sessionId, phone],
    );
    return res.rowCount ? mapSalesLead(res.rows[0]) : null;
  }

  static async upsertFromInbound(opts: {
    sessionId: number;
    phone: string;
    conversationId?: number | null;
    contactName?: string | null;
    referral?: Record<string, unknown> | null;
  }): Promise<SalesLeadRow> {
    const referral = opts.referral || {};
    const res = await pool.query(
      `INSERT INTO wa_sales_leads (
         session_id, contact_phone, conversation_id, contact_name, source,
         campaign_id, campaign_name, ad_id, ad_name, adset, referral_data,
         stage, last_contact_at
       ) VALUES (
         $1,$2,$3,$4,'whatsapp',$5,$6,$7,$8,$9,$10::jsonb,'new', NOW()
       )
       ON CONFLICT (session_id, contact_phone) DO UPDATE SET
         conversation_id = COALESCE(EXCLUDED.conversation_id, wa_sales_leads.conversation_id),
         contact_name = COALESCE(EXCLUDED.contact_name, wa_sales_leads.contact_name),
         campaign_id = COALESCE(EXCLUDED.campaign_id, wa_sales_leads.campaign_id),
         campaign_name = COALESCE(EXCLUDED.campaign_name, wa_sales_leads.campaign_name),
         ad_id = COALESCE(EXCLUDED.ad_id, wa_sales_leads.ad_id),
         ad_name = COALESCE(EXCLUDED.ad_name, wa_sales_leads.ad_name),
         adset = COALESCE(EXCLUDED.adset, wa_sales_leads.adset),
         referral_data = CASE
           WHEN EXCLUDED.referral_data = '{}'::jsonb THEN wa_sales_leads.referral_data
           ELSE wa_sales_leads.referral_data || EXCLUDED.referral_data
         END,
         last_contact_at = NOW(),
         updated_at = NOW()
       RETURNING *`,
      [
        opts.sessionId,
        opts.phone,
        opts.conversationId ?? null,
        opts.contactName ?? null,
        (referral.campaign_id as string) || null,
        (referral.campaign_name as string) || null,
        (referral.ad_id as string) || null,
        (referral.ad_name as string) || null,
        (referral.adset as string) || null,
        JSON.stringify(referral),
      ],
    );
    return mapSalesLead(res.rows[0]);
  }

  static async update(
    id: number,
    sessionId: number,
    patch: Record<string, unknown>,
  ): Promise<SalesLeadRow | null> {
    const allowed = [
      'contact_name',
      'stage',
      'interest_score',
      'product_interest',
      'needs',
      'business_size',
      'budget',
      'objections',
      'ai_notes',
      'human_notes',
      'last_action',
      'next_followup_at',
      'followup_count',
      'followups_stopped',
      'followup_stop_reason',
      'ai_enabled',
      'status',
      'context_summary',
      'memory',
      'conversation_id',
      'won_at',
      'campaign_id',
      'campaign_name',
      'ad_id',
      'ad_name',
      'adset',
      'referral_data',
    ] as const;

    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    for (const key of allowed) {
      if (patch[key] === undefined) continue;
      let val = patch[key];
      if (key === 'objections' || key === 'memory' || key === 'referral_data') {
        val = JSON.stringify(val);
        fields.push(`${key} = $${i++}::jsonb`);
      } else {
        fields.push(`${key} = $${i++}`);
      }
      values.push(val);
    }
    if (!fields.length) return this.getById(id, sessionId);
    fields.push(`updated_at = NOW()`);
    values.push(id, sessionId);
    const res = await pool.query(
      `UPDATE wa_sales_leads SET ${fields.join(', ')}
       WHERE id = $${i++} AND session_id = $${i}
       RETURNING *`,
      values,
    );
    return res.rowCount ? mapSalesLead(res.rows[0]) : null;
  }

  static async list(
    sessionId: number,
    opts: {
      stage?: string;
      status?: string;
      search?: string;
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<{ rows: SalesLeadRow[]; total: number }> {
    const limit = Math.min(200, Math.max(1, opts.limit ?? 50));
    const offset = Math.max(0, opts.offset ?? 0);
    const clauses = [`session_id = $1`];
    const values: unknown[] = [sessionId];
    let i = 2;
    if (opts.stage) {
      clauses.push(`stage = $${i++}`);
      values.push(opts.stage);
    }
    if (opts.status) {
      clauses.push(`status = $${i++}`);
      values.push(opts.status);
    }
    if (opts.search?.trim()) {
      clauses.push(
        `(contact_phone ILIKE $${i} OR contact_name ILIKE $${i} OR needs ILIKE $${i} OR product_interest ILIKE $${i})`,
      );
      values.push(`%${opts.search.trim()}%`);
      i += 1;
    }
    const where = clauses.join(' AND ');
    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS total FROM wa_sales_leads WHERE ${where}`,
      values,
    );
    const listRes = await pool.query(
      `SELECT * FROM wa_sales_leads WHERE ${where}
       ORDER BY last_contact_at DESC
       LIMIT $${i++} OFFSET $${i}`,
      [...values, limit, offset],
    );
    return {
      total: Number(countRes.rows[0]?.total || 0),
      rows: listRes.rows.map(mapSalesLead),
    };
  }

  static async logAction(opts: {
    sessionId: number;
    leadId?: number | null;
    conversationId?: number | null;
    actionType: string;
    payload?: Record<string, unknown>;
    result?: Record<string, unknown>;
    success?: boolean;
  }) {
    await pool.query(
      `INSERT INTO wa_sales_agent_actions
         (session_id, lead_id, conversation_id, action_type, payload, result, success)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)`,
      [
        opts.sessionId,
        opts.leadId ?? null,
        opts.conversationId ?? null,
        opts.actionType,
        JSON.stringify(opts.payload || {}),
        JSON.stringify(opts.result || {}),
        opts.success !== false,
      ],
    );
  }

  static async listActions(sessionId: number, leadId?: number, limit = 50) {
    const res = leadId
      ? await pool.query(
          `SELECT * FROM wa_sales_agent_actions
           WHERE session_id = $1 AND lead_id = $2
           ORDER BY created_at DESC LIMIT $3`,
          [sessionId, leadId, limit],
        )
      : await pool.query(
          `SELECT * FROM wa_sales_agent_actions
           WHERE session_id = $1
           ORDER BY created_at DESC LIMIT $2`,
          [sessionId, limit],
        );
    return res.rows;
  }
}
