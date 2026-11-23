import pool from '../../../../db/pool';
import {
  DEFAULT_ENABLED_TOOLS,
  DEFAULT_FOLLOWUP_SETTINGS,
  DEFAULT_STAGES,
} from './constants';
import type {
  SalesAgentSessionRow,
  SalesFollowupSettings,
  SalesPackage,
  SalesSessionStatus,
  SalesStage,
  SalesToolName,
} from './types';

function asJsonArray<T>(value: unknown, fallback: T[]): T[] {
  if (Array.isArray(value)) return value as T[];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? (parsed as T[]) : fallback;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

function asJsonObject<T extends Record<string, unknown>>(value: unknown, fallback: T): T {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as T;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as T;
    } catch {
      /* ignore */
    }
  }
  return fallback;
}

export function mapSalesSession(row: any): SalesAgentSessionRow {
  return {
    id: Number(row.id),
    name: String(row.name || ''),
    description: row.description ?? null,
    product_name: String(row.product_name || ''),
    product_description: row.product_description ?? null,
    goal: row.goal ?? null,
    target_audience: row.target_audience ?? null,
    language: String(row.language || 'ar'),
    dialect: row.dialect ?? null,
    tone: row.tone ?? null,
    persona: row.persona ?? null,
    formality: (row.formality || 'casual') as SalesAgentSessionRow['formality'],
    sales_instructions: row.sales_instructions ?? null,
    general_instructions: row.general_instructions ?? null,
    wa_session_slug: row.wa_session_slug ?? null,
    status: row.status as SalesSessionStatus,
    enabled_tools: asJsonArray<SalesToolName>(row.enabled_tools, [...DEFAULT_ENABLED_TOOLS]),
    followup_settings: {
      ...DEFAULT_FOLLOWUP_SETTINGS,
      ...asJsonObject<Partial<SalesFollowupSettings>>(row.followup_settings, {}),
    },
    packages: asJsonArray<SalesPackage>(row.packages, []),
    demo_url: row.demo_url ?? null,
    signup_url: row.signup_url ?? null,
    media_urls: asJsonArray<string>(row.media_urls, []),
    custom_stages: asJsonArray<SalesStage>(row.custom_stages, [...DEFAULT_STAGES]),
    stats_cache: asJsonObject(row.stats_cache, {}),
    last_error: row.last_error ?? null,
    created_by: row.created_by != null ? Number(row.created_by) : null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export class SalesAgentSessionStore {
  static async getById(id: number): Promise<SalesAgentSessionRow | null> {
    const res = await pool.query(`SELECT * FROM wa_sales_agent_sessions WHERE id = $1`, [id]);
    return res.rowCount ? mapSalesSession(res.rows[0]) : null;
  }

  static async getByWaSessionSlug(slug: string): Promise<SalesAgentSessionRow | null> {
    const res = await pool.query(
      `SELECT * FROM wa_sales_agent_sessions
       WHERE wa_session_slug = $1
         AND status IN ('active', 'paused')
       ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, id ASC
       LIMIT 1`,
      [slug],
    );
    return res.rowCount ? mapSalesSession(res.rows[0]) : null;
  }

  /**
   * Resolve Sales Session for an inbound WhatsApp session slug.
   * Also heals common admin mistakes (saving phone / label instead of slug).
   */
  static async resolveForInbound(sessionSlug: string): Promise<SalesAgentSessionRow | null> {
    const direct = await this.getByWaSessionSlug(sessionSlug);
    if (direct) return direct;

    const wa = await pool.query<{ slug: string; phone_number: string | null }>(
      `SELECT slug, phone_number FROM wa_sessions WHERE slug = $1 LIMIT 1`,
      [sessionSlug],
    );
    const phoneRaw = wa.rows[0]?.phone_number ? String(wa.rows[0].phone_number) : null;
    const phoneDigits = phoneRaw ? phoneRaw.replace(/\D/g, '') : null;
    const phoneTail =
      phoneDigits && phoneDigits.length >= 8 ? phoneDigits.slice(-9) : phoneDigits;

    const fuzzy = await pool.query(
      `SELECT * FROM wa_sales_agent_sessions
       WHERE status IN ('active', 'paused')
         AND wa_session_slug IS NOT NULL
         AND (
           wa_session_slug = $1
           OR wa_session_slug ILIKE '%' || $1 || '%'
           OR ($2::text IS NOT NULL AND (
             regexp_replace(wa_session_slug, '\\D', '', 'g') = $2
             OR regexp_replace(wa_session_slug, '\\D', '', 'g') LIKE '%' || $3 || '%'
           ))
         )
       ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END,
                CASE WHEN wa_session_slug = $1 THEN 0 ELSE 1 END,
                id ASC
       LIMIT 1`,
      [sessionSlug, phoneDigits, phoneTail],
    );

    if (!fuzzy.rowCount) return null;
    const row = mapSalesSession(fuzzy.rows[0]);
    if (row.wa_session_slug !== sessionSlug) {
      await this.update(row.id, { wa_session_slug: sessionSlug });
      row.wa_session_slug = sessionSlug;
    }
    return row;
  }

  static async list(opts: {
    status?: string;
    search?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<{ rows: SalesAgentSessionRow[]; total: number }> {
    const limit = Math.min(100, Math.max(1, opts.limit ?? 50));
    const offset = Math.max(0, opts.offset ?? 0);
    const clauses: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    if (opts.status) {
      clauses.push(`status = $${i++}`);
      values.push(opts.status);
    }
    if (opts.search?.trim()) {
      clauses.push(
        `(name ILIKE $${i} OR product_name ILIKE $${i} OR description ILIKE $${i} OR wa_session_slug ILIKE $${i})`,
      );
      values.push(`%${opts.search.trim()}%`);
      i += 1;
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS total FROM wa_sales_agent_sessions ${where}`,
      values,
    );
    const listRes = await pool.query(
      `SELECT * FROM wa_sales_agent_sessions ${where}
       ORDER BY updated_at DESC
       LIMIT $${i++} OFFSET $${i}`,
      [...values, limit, offset],
    );
    return {
      total: Number(countRes.rows[0]?.total || 0),
      rows: listRes.rows.map(mapSalesSession),
    };
  }

  static async create(input: {
    name: string;
    description?: string | null;
    product_name?: string;
    product_description?: string | null;
    goal?: string | null;
    target_audience?: string | null;
    language?: string;
    dialect?: string | null;
    tone?: string | null;
    persona?: string | null;
    formality?: string;
    sales_instructions?: string | null;
    general_instructions?: string | null;
    wa_session_slug?: string | null;
    status?: SalesSessionStatus;
    enabled_tools?: SalesToolName[];
    followup_settings?: Partial<SalesFollowupSettings>;
    packages?: SalesPackage[];
    demo_url?: string | null;
    signup_url?: string | null;
    media_urls?: string[];
    custom_stages?: SalesStage[];
    created_by?: number | null;
  }): Promise<SalesAgentSessionRow> {
    const res = await pool.query(
      `INSERT INTO wa_sales_agent_sessions (
         name, description, product_name, product_description, goal, target_audience,
         language, dialect, tone, persona, formality, sales_instructions, general_instructions,
         wa_session_slug, status, enabled_tools, followup_settings, packages, demo_url,
         signup_url, media_urls, custom_stages, created_by
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17::jsonb,$18::jsonb,
         $19,$20,$21::jsonb,$22::jsonb,$23
       ) RETURNING *`,
      [
        input.name.trim(),
        input.description ?? null,
        input.product_name?.trim() || input.name.trim(),
        input.product_description ?? null,
        input.goal ?? null,
        input.target_audience ?? null,
        input.language || 'ar',
        input.dialect ?? 'egyptian',
        input.tone ?? 'friendly',
        input.persona ?? null,
        input.formality || 'casual',
        input.sales_instructions ?? null,
        input.general_instructions ?? null,
        input.wa_session_slug || null,
        input.status || 'draft',
        JSON.stringify(input.enabled_tools || DEFAULT_ENABLED_TOOLS),
        JSON.stringify({ ...DEFAULT_FOLLOWUP_SETTINGS, ...(input.followup_settings || {}) }),
        JSON.stringify(input.packages || []),
        input.demo_url ?? null,
        input.signup_url ?? null,
        JSON.stringify(input.media_urls || []),
        JSON.stringify(input.custom_stages || DEFAULT_STAGES),
        input.created_by ?? null,
      ],
    );
    return mapSalesSession(res.rows[0]);
  }

  static async update(
    id: number,
    patch: Record<string, unknown>,
  ): Promise<SalesAgentSessionRow | null> {
    const allowed = [
      'name',
      'description',
      'product_name',
      'product_description',
      'goal',
      'target_audience',
      'language',
      'dialect',
      'tone',
      'persona',
      'formality',
      'sales_instructions',
      'general_instructions',
      'wa_session_slug',
      'status',
      'enabled_tools',
      'followup_settings',
      'packages',
      'demo_url',
      'signup_url',
      'media_urls',
      'custom_stages',
      'stats_cache',
      'last_error',
    ] as const;

    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    for (const key of allowed) {
      if (patch[key] === undefined) continue;
      let val = patch[key];
      if (
        key === 'enabled_tools' ||
        key === 'followup_settings' ||
        key === 'packages' ||
        key === 'media_urls' ||
        key === 'custom_stages' ||
        key === 'stats_cache'
      ) {
        val = JSON.stringify(val);
        fields.push(`${key} = $${i++}::jsonb`);
      } else {
        fields.push(`${key} = $${i++}`);
      }
      values.push(val);
    }
    if (!fields.length) return this.getById(id);
    fields.push(`updated_at = NOW()`);
    values.push(id);
    const res = await pool.query(
      `UPDATE wa_sales_agent_sessions SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`,
      values,
    );
    return res.rowCount ? mapSalesSession(res.rows[0]) : null;
  }

  static async setStatus(id: number, status: SalesSessionStatus, lastError?: string | null) {
    return this.update(id, { status, last_error: lastError ?? null });
  }

  static async archive(id: number) {
    return this.setStatus(id, 'archived');
  }

  static async getOverview() {
    const [sessions, leads, followups] = await Promise.all([
      pool.query(
        `SELECT
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE status = 'active')::int AS active,
           COUNT(*) FILTER (WHERE status = 'paused')::int AS paused,
           COUNT(*) FILTER (WHERE status = 'draft')::int AS draft,
           COUNT(*) FILTER (WHERE status = 'error')::int AS error
         FROM wa_sales_agent_sessions
         WHERE status <> 'archived'`,
      ),
      pool.query(
        `SELECT
           COUNT(*)::int AS total_leads,
           COUNT(*) FILTER (WHERE status = 'open')::int AS open_leads,
           COUNT(*) FILTER (WHERE stage = 'interested')::int AS interested,
           COUNT(*) FILTER (WHERE stage IN ('qualified','demo_requested','demo_completed','negotiation'))::int AS qualified,
           COUNT(*) FILTER (WHERE status = 'won' OR stage = 'won')::int AS won,
           COUNT(*) FILTER (WHERE next_followup_at IS NOT NULL AND next_followup_at <= NOW() AND followups_stopped = FALSE AND status = 'open')::int AS followups_due
         FROM wa_sales_leads`,
      ),
      pool.query(
        `SELECT COUNT(*)::int AS pending_followups
         FROM wa_sales_followups WHERE status = 'pending'`,
      ),
    ]);
    const s = sessions.rows[0] || {};
    const l = leads.rows[0] || {};
    const totalLeads = Number(l.total_leads || 0);
    const won = Number(l.won || 0);
    return {
      sessions: s,
      leads: l,
      pending_followups: Number(followups.rows[0]?.pending_followups || 0),
      conversion_rate: totalLeads > 0 ? Math.round((won / totalLeads) * 1000) / 10 : 0,
    };
  }

  static async getSessionStats(sessionId: number) {
    const res = await pool.query(
      `SELECT
         COUNT(*)::int AS total_leads,
         COUNT(*) FILTER (WHERE status = 'open')::int AS open_leads,
         COUNT(*) FILTER (WHERE stage = 'interested')::int AS interested,
         COUNT(*) FILTER (WHERE stage IN ('qualified','demo_requested','demo_completed','negotiation'))::int AS qualified,
         COUNT(*) FILTER (WHERE status = 'won' OR stage = 'won')::int AS won,
         COUNT(*) FILTER (WHERE status = 'lost' OR stage IN ('lost','not_interested'))::int AS lost,
         COUNT(*) FILTER (WHERE next_followup_at IS NOT NULL AND next_followup_at <= NOW() AND followups_stopped = FALSE AND status = 'open')::int AS followups_due,
         COUNT(*) FILTER (WHERE ai_enabled = FALSE)::int AS human_owned
       FROM wa_sales_leads
       WHERE session_id = $1`,
      [sessionId],
    );
    const row = res.rows[0] || {};
    const total = Number(row.total_leads || 0);
    const won = Number(row.won || 0);
    const convRes = await pool.query(
      `SELECT COUNT(DISTINCT conversation_id)::int AS conversations
       FROM wa_sales_leads
       WHERE session_id = $1 AND conversation_id IS NOT NULL`,
      [sessionId],
    );
    return {
      ...row,
      conversations: Number(convRes.rows[0]?.conversations || 0),
      conversion_rate: total > 0 ? Math.round((won / total) * 1000) / 10 : 0,
    };
  }
}
