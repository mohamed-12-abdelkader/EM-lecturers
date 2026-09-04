import pool from '../../../../db/pool';

export const POLICY_STYLE_MODES = ['normal', 'summary', 'shorter'] as const;
export type PolicyStyleMode = (typeof POLICY_STYLE_MODES)[number];

export type PolicyStyle = {
  mode: PolicyStyleMode;
  tone_notes?: string;
};

export type SupportPolicyPack = {
  enabled: boolean;
  style: PolicyStyle;
  rewrite_prompt: string | null;
  updated_at: Date | null;
  updated_by_phone: string | null;
};

function parseJson(raw: unknown): unknown {
  if (raw == null) return null;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return raw;
}

export function normalizeStyle(raw: unknown): PolicyStyle {
  const obj = (parseJson(raw) || raw || {}) as Record<string, unknown>;
  const modeRaw = typeof obj.mode === 'string' ? obj.mode : 'normal';
  const mode = (POLICY_STYLE_MODES as readonly string[]).includes(modeRaw)
    ? (modeRaw as PolicyStyleMode)
    : 'normal';
  const tone =
    typeof obj.tone_notes === 'string' && obj.tone_notes.trim()
      ? obj.tone_notes.trim().slice(0, 500)
      : undefined;
  return tone ? { mode, tone_notes: tone } : { mode };
}

function rowToPack(row: {
  enabled: boolean;
  style: unknown;
  rewrite_prompt: string | null;
  updated_at: Date | null;
  updated_by_phone: string | null;
}): SupportPolicyPack {
  return {
    enabled: row.enabled !== false,
    style: normalizeStyle(row.style),
    rewrite_prompt: row.rewrite_prompt?.trim() || null,
    updated_at: row.updated_at ?? null,
    updated_by_phone: row.updated_by_phone ?? null,
  };
}

export async function loadPolicyPack(): Promise<SupportPolicyPack> {
  const result = await pool.query<{
    enabled: boolean;
    style: unknown;
    rewrite_prompt: string | null;
    updated_at: Date | null;
    updated_by_phone: string | null;
  }>(
    `SELECT enabled, style, rewrite_prompt, updated_at, updated_by_phone
     FROM wa_support_policy_pack
     WHERE id = 1`,
  );
  if (!result.rowCount) {
    return {
      enabled: true,
      style: { mode: 'normal' },
      rewrite_prompt: null,
      updated_at: null,
      updated_by_phone: null,
    };
  }
  return rowToPack(result.rows[0]);
}

export async function savePolicyPack(
  pack: Pick<SupportPolicyPack, 'enabled' | 'style' | 'rewrite_prompt'>,
  updatedByPhone?: string | null,
): Promise<SupportPolicyPack> {
  const result = await pool.query<{
    enabled: boolean;
    style: unknown;
    rewrite_prompt: string | null;
    updated_at: Date | null;
    updated_by_phone: string | null;
  }>(
    `INSERT INTO wa_support_policy_pack
       (id, enabled, style, rewrite_prompt, rules, updated_at, updated_by_phone)
     VALUES (1, $1, $2::jsonb, $3, '[]'::jsonb, NOW(), $4)
     ON CONFLICT (id) DO UPDATE SET
       enabled = EXCLUDED.enabled,
       style = EXCLUDED.style,
       rewrite_prompt = EXCLUDED.rewrite_prompt,
       updated_at = NOW(),
       updated_by_phone = EXCLUDED.updated_by_phone
     RETURNING enabled, style, rewrite_prompt, updated_at, updated_by_phone`,
    [
      pack.enabled,
      JSON.stringify(normalizeStyle(pack.style)),
      pack.rewrite_prompt?.trim() || null,
      updatedByPhone?.trim() || null,
    ],
  );
  return rowToPack(result.rows[0]);
}

export function summarizePack(pack: SupportPolicyPack): Record<string, unknown> {
  return {
    enabled: pack.enabled,
    style: pack.style,
    rewrite_prompt: pack.rewrite_prompt,
    updated_at: pack.updated_at,
    updated_by_phone: pack.updated_by_phone,
  };
}
