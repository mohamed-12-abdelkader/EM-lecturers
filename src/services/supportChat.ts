import crypto from 'crypto';
import pool from '../db/pool';

export type SupportChatRow = {
  id: number;
  student_id: number | null;
  guest_token: string | null;
  status: 'open' | 'closed';
  current_intent: string | null;
  context_json: Record<string, unknown>;
  last_message_at: string | null;
  created_at: string;
  updated_at: string;
};

export type SupportMessageRow = {
  id: number;
  chat_id: number;
  sender_id: number | null;
  sender_role: 'student' | 'guest' | 'bot';
  text: string;
  intent: string | null;
  meta_json: Record<string, unknown>;
  created_at: string;
};

export type SupportContext = {
  teacher_name?: string | null;
  subject?: string | null;
  grade?: string | null;
  nickname?: string | null;
  last_intent?: string | null;
  pending_action?: string | null;
  candidate_teacher_ids?: number[];
};

function newGuestToken(): string {
  return crypto.randomBytes(24).toString('hex');
}

function asContext(raw: unknown): SupportContext {
  if (!raw || typeof raw !== 'object') return {};
  return raw as SupportContext;
}

export class SupportChatService {
  static async getOrCreateGuestChat(guestToken?: string | null): Promise<SupportChatRow> {
    const token = guestToken?.trim();
    if (token) {
      const existing = await pool.query(`SELECT * FROM support_chats WHERE guest_token = $1 LIMIT 1`, [
        token,
      ]);
      if (existing.rowCount) {
        return existing.rows[0] as SupportChatRow;
      }
    }

    const createdToken = newGuestToken();
    const res = await pool.query(
      `INSERT INTO support_chats (guest_token, status, context_json)
       VALUES ($1, 'open', '{}'::jsonb)
       RETURNING *`,
      [createdToken],
    );
    return res.rows[0] as SupportChatRow;
  }

  static async getChatByGuestToken(guestToken: string): Promise<SupportChatRow | null> {
    const res = await pool.query(`SELECT * FROM support_chats WHERE guest_token = $1 LIMIT 1`, [
      guestToken.trim(),
    ]);
    return res.rowCount ? (res.rows[0] as SupportChatRow) : null;
  }

  static async getOrCreateStudentChat(studentId: number): Promise<SupportChatRow> {
    const existing = await pool.query(
      `SELECT * FROM support_chats WHERE student_id = $1 LIMIT 1`,
      [studentId],
    );
    if (existing.rowCount) return existing.rows[0] as SupportChatRow;

    const res = await pool.query(
      `INSERT INTO support_chats (student_id, status, context_json)
       VALUES ($1, 'open', '{}'::jsonb)
       RETURNING *`,
      [studentId],
    );
    return res.rows[0] as SupportChatRow;
  }

  static async getChatById(chatId: number): Promise<SupportChatRow | null> {
    const res = await pool.query(`SELECT * FROM support_chats WHERE id = $1 LIMIT 1`, [chatId]);
    return res.rowCount ? (res.rows[0] as SupportChatRow) : null;
  }

  static async getChatMessages(chatId: number, limit = 50): Promise<SupportMessageRow[]> {
    const res = await pool.query(
      `SELECT * FROM support_messages
       WHERE chat_id = $1
       ORDER BY created_at ASC, id ASC
       LIMIT $2`,
      [chatId, Math.min(Math.max(limit, 1), 200)],
    );
    return res.rows as SupportMessageRow[];
  }

  static async addMessage(input: {
    chatId: number;
    senderId?: number | null;
    senderRole: 'student' | 'guest' | 'bot';
    text: string;
    intent?: string | null;
    meta?: Record<string, unknown>;
  }): Promise<SupportMessageRow> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const msg = await client.query(
        `INSERT INTO support_messages (chat_id, sender_id, sender_role, text, intent, meta_json)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)
         RETURNING *`,
        [
          input.chatId,
          input.senderId ?? null,
          input.senderRole,
          input.text,
          input.intent ?? null,
          JSON.stringify(input.meta ?? {}),
        ],
      );
      await client.query(
        `UPDATE support_chats
         SET last_message_at = NOW(),
             updated_at = NOW(),
             current_intent = COALESCE($2, current_intent)
         WHERE id = $1`,
        [input.chatId, input.intent ?? null],
      );
      await client.query('COMMIT');
      return msg.rows[0] as SupportMessageRow;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  static getContext(chat: SupportChatRow): SupportContext {
    return asContext(chat.context_json);
  }

  static async updateContext(chatId: number, patch: SupportContext): Promise<SupportContext> {
    const res = await pool.query(
      `UPDATE support_chats
       SET context_json = COALESCE(context_json, '{}'::jsonb) || $2::jsonb,
           updated_at = NOW()
       WHERE id = $1
       RETURNING context_json`,
      [chatId, JSON.stringify(patch)],
    );
    return asContext(res.rows[0]?.context_json);
  }
}
