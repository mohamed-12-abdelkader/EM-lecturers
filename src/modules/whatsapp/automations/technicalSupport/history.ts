import pool from '../../../../db/pool';

export type HistoryMessage = {
  role: 'user' | 'assistant';
  content: string;
  at: Date;
};

const MAX_MESSAGES = 40;
const MAX_CHARS = 20_000;

/**
 * Load full WhatsApp conversation transcript (inbound + outbound) for LLM context.
 */
export async function loadConversationHistory(
  conversationId: number | null,
): Promise<HistoryMessage[]> {
  if (!conversationId) return [];

  const inbound = await pool.query<{
    body: string | null;
    processed_at: Date;
    metadata: Record<string, unknown> | string | null;
  }>(
    `SELECT body, processed_at, metadata
     FROM wa_inbound_events
     WHERE conversation_id = $1
     ORDER BY processed_at ASC`,
    [conversationId],
  );

  const outbound = await pool.query<{
    body: string;
    created_at: Date;
    status: string;
  }>(
    `SELECT body, created_at, status
     FROM wa_outbound_jobs
     WHERE conversation_id = $1
       AND status IN ('pending', 'processing', 'sent')
     ORDER BY created_at ASC`,
    [conversationId],
  );

  const merged: HistoryMessage[] = [];

  for (const row of inbound.rows) {
    let text = (row.body || '').trim();
    const meta =
      typeof row.metadata === 'string'
        ? (() => {
            try {
              return JSON.parse(row.metadata);
            } catch {
              return {};
            }
          })()
        : row.metadata || {};
    if (meta && typeof meta === 'object') {
      const m = meta as Record<string, unknown>;
      if (m.image_description && typeof m.image_description === 'string') {
        text = text
          ? `${text}\n[وصف صورة سابقة: ${m.image_description}]`
          : `[وصف صورة: ${m.image_description}]`;
      } else if (m.has_media) {
        text = text || '[أرسل الطالب صورة/مرفقاً]';
      }
      if (m.media_error) {
        text = `${text}\n[تعذر قراءة المرفق: ${m.media_error}]`.trim();
      }
    }
    if (!text) continue;
    merged.push({ role: 'user', content: text, at: row.processed_at });
  }

  for (const row of outbound.rows) {
    const text = (row.body || '').trim();
    if (!text) continue;
    merged.push({ role: 'assistant', content: text, at: row.created_at });
  }

  merged.sort((a, b) => a.at.getTime() - b.at.getTime());

  // Keep last N messages and enforce char budget from the end
  let slice = merged.slice(-MAX_MESSAGES);
  let total = slice.reduce((n, m) => n + m.content.length, 0);
  while (slice.length > 1 && total > MAX_CHARS) {
    total -= slice[0]!.content.length;
    slice = slice.slice(1);
  }

  return slice;
}
