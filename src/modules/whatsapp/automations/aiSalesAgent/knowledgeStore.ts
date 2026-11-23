import pool from '../../../../db/pool';
import type { SalesKbDocumentRow, SalesKbKind } from './types';

function mapDoc(row: any): SalesKbDocumentRow {
  const metadata =
    typeof row.metadata === 'string'
      ? JSON.parse(row.metadata || '{}')
      : row.metadata || {};
  return {
    id: Number(row.id),
    session_id: Number(row.session_id),
    kind: row.kind,
    title: String(row.title || ''),
    content: String(row.content || ''),
    source_url: row.source_url ?? null,
    file_path: row.file_path ?? null,
    mime_type: row.mime_type ?? null,
    file_size: row.file_size != null ? Number(row.file_size) : null,
    metadata,
    is_active: row.is_active !== false,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export class SalesKnowledgeStore {
  static async list(
    sessionId: number,
    opts: { kind?: string; activeOnly?: boolean; limit?: number } = {},
  ): Promise<SalesKbDocumentRow[]> {
    const limit = Math.min(200, Math.max(1, opts.limit ?? 100));
    const clauses = [`session_id = $1`];
    const values: unknown[] = [sessionId];
    let i = 2;
    if (opts.activeOnly !== false) {
      clauses.push(`is_active = TRUE`);
    }
    if (opts.kind) {
      clauses.push(`kind = $${i++}`);
      values.push(opts.kind);
    }
    const res = await pool.query(
      `SELECT * FROM wa_sales_kb_documents
       WHERE ${clauses.join(' AND ')}
       ORDER BY updated_at DESC
       LIMIT $${i}`,
      [...values, limit],
    );
    return res.rows.map(mapDoc);
  }

  static async create(input: {
    sessionId: number;
    kind?: SalesKbKind;
    title?: string;
    content?: string;
    source_url?: string | null;
    file_path?: string | null;
    mime_type?: string | null;
    file_size?: number | null;
    metadata?: Record<string, unknown>;
  }): Promise<SalesKbDocumentRow> {
    const res = await pool.query(
      `INSERT INTO wa_sales_kb_documents
         (session_id, kind, title, content, source_url, file_path, mime_type, file_size, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
       RETURNING *`,
      [
        input.sessionId,
        input.kind || 'note',
        input.title || '',
        input.content || '',
        input.source_url ?? null,
        input.file_path ?? null,
        input.mime_type ?? null,
        input.file_size ?? null,
        JSON.stringify(input.metadata || {}),
      ],
    );
    return mapDoc(res.rows[0]);
  }

  static async update(
    id: number,
    sessionId: number,
    patch: Partial<{
      kind: SalesKbKind;
      title: string;
      content: string;
      source_url: string | null;
      is_active: boolean;
      metadata: Record<string, unknown>;
    }>,
  ): Promise<SalesKbDocumentRow | null> {
    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    for (const [key, val] of Object.entries(patch)) {
      if (val === undefined) continue;
      if (key === 'metadata') {
        fields.push(`metadata = $${i++}::jsonb`);
        values.push(JSON.stringify(val));
      } else {
        fields.push(`${key} = $${i++}`);
        values.push(val);
      }
    }
    if (!fields.length) {
      const cur = await pool.query(
        `SELECT * FROM wa_sales_kb_documents WHERE id = $1 AND session_id = $2`,
        [id, sessionId],
      );
      return cur.rowCount ? mapDoc(cur.rows[0]) : null;
    }
    fields.push(`updated_at = NOW()`);
    values.push(id, sessionId);
    const res = await pool.query(
      `UPDATE wa_sales_kb_documents SET ${fields.join(', ')}
       WHERE id = $${i++} AND session_id = $${i}
       RETURNING *`,
      values,
    );
    return res.rowCount ? mapDoc(res.rows[0]) : null;
  }

  static async remove(id: number, sessionId: number): Promise<boolean> {
    const res = await pool.query(
      `DELETE FROM wa_sales_kb_documents WHERE id = $1 AND session_id = $2`,
      [id, sessionId],
    );
    return (res.rowCount || 0) > 0;
  }

  /** Session-isolated keyword / FTS search — never crosses sessions. */
  static async search(
    sessionId: number,
    query: string,
    limit = 6,
  ): Promise<Array<{ id: number; kind: string; title: string; excerpt: string }>> {
    const q = String(query || '').trim();
    if (!q) return [];
    const res = await pool.query(
      `SELECT id, kind, title, content,
              ts_rank(
                to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(content,'')),
                plainto_tsquery('simple', $2)
              ) AS rank
       FROM wa_sales_kb_documents
       WHERE session_id = $1
         AND is_active = TRUE
         AND (
           to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(content,''))
             @@ plainto_tsquery('simple', $2)
           OR title ILIKE $3
           OR content ILIKE $3
         )
       ORDER BY rank DESC NULLS LAST, updated_at DESC
       LIMIT $4`,
      [sessionId, q, `%${q.slice(0, 80)}%`, Math.min(12, Math.max(1, limit))],
    );
    return res.rows.map((row) => ({
      id: Number(row.id),
      kind: String(row.kind),
      title: String(row.title || row.kind),
      excerpt: String(row.content || '').slice(0, 700),
    }));
  }

  static async buildContextBrief(sessionId: number, maxChars = 3500): Promise<string> {
    const docs = await this.list(sessionId, { limit: 40 });
    if (!docs.length) return 'لا توجد معلومات في قاعدة المعرفة لهذه الجلسة بعد.';
    const parts: string[] = [];
    let used = 0;
    for (const doc of docs) {
      const block = `[${doc.kind}] ${doc.title || 'بدون عنوان'}\n${doc.content}`.trim();
      if (!block) continue;
      if (used + block.length > maxChars) {
        const remain = maxChars - used;
        if (remain > 120) parts.push(block.slice(0, remain) + '…');
        break;
      }
      parts.push(block);
      used += block.length + 2;
    }
    return parts.join('\n\n---\n\n');
  }
}
