import type { PoolClient } from 'pg';
import pool from '../../../db/pool';
import { HttpError, logger } from '../../../utils';
import { staffChatConfig } from '../config';
import type { StaffMessageRow, StaffMessageType, StaffUser } from '../types';
import { StaffConversationService } from './conversation.service';

function sanitizeText(text: string) {
  return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim();
}

export function serializeStaffMessage(row: StaffMessageRow, viewerId?: number) {
  const deleted = !!row.deleted_at;
  return {
    id: row.id,
    conversation_id: row.conversation_id,
    sender: {
      id: row.sender_id,
      name: row.sender_name ?? null,
    },
    type: row.type,
    content: deleted ? 'تم حذف هذه الرسالة' : row.content,
    image_url: deleted ? null : row.image_url,
    edited_at: row.edited_at,
    deleted_at: row.deleted_at,
    is_deleted: deleted,
    is_own: viewerId != null && row.sender_id === viewerId,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export class StaffMessageService {
  static validateText(content: string) {
    const text = sanitizeText(content);
    if (!text) throw new HttpError(400, 'EMPTY_MESSAGE');
    if (text.length > staffChatConfig.maxMessageLength) {
      throw new HttpError(400, 'MESSAGE_TOO_LONG');
    }
    return text;
  }

  static async sendText(conversationId: number, sender: StaffUser, content: string) {
    await StaffConversationService.assertStaffRole(sender);
    await StaffConversationService.requireActiveMember(conversationId, sender.id);
    const conv = await StaffConversationService.getById(conversationId);
    const can = await StaffConversationService.employeeCanAccessDirect(conv, sender.id, sender.role);
    if (!can) throw new HttpError(403, 'NOT_CONVERSATION_MEMBER');

    const text = this.validateText(content);
    const r = await pool.query<StaffMessageRow>(
      `INSERT INTO staff_messages (conversation_id, sender_id, type, content)
       VALUES ($1, $2, 'text', $3)
       RETURNING *`,
      [conversationId, sender.id, text],
    );
    await pool.query(`UPDATE staff_conversations SET updated_at = NOW() WHERE id = $1`, [conversationId]);
    const msg = await this.loadMessage(r.rows[0].id);
    logger.info({ message_id: msg.id, conversation_id: conversationId, sender_id: sender.id }, 'staff_message_sent');
    return serializeStaffMessage(msg, sender.id);
  }

  static async sendImage(conversationId: number, sender: StaffUser, imageUrl: string) {
    await StaffConversationService.assertStaffRole(sender);
    await StaffConversationService.requireActiveMember(conversationId, sender.id);
    const conv = await StaffConversationService.getById(conversationId);
    const can = await StaffConversationService.employeeCanAccessDirect(conv, sender.id, sender.role);
    if (!can) throw new HttpError(403, 'NOT_CONVERSATION_MEMBER');

    const r = await pool.query<StaffMessageRow>(
      `INSERT INTO staff_messages (conversation_id, sender_id, type, image_url)
       VALUES ($1, $2, 'image', $3)
       RETURNING *`,
      [conversationId, sender.id, imageUrl],
    );
    await pool.query(`UPDATE staff_conversations SET updated_at = NOW() WHERE id = $1`, [conversationId]);
    const msg = await this.loadMessage(r.rows[0].id);
    logger.info({ message_id: msg.id, conversation_id: conversationId, sender_id: sender.id }, 'staff_image_sent');
    return serializeStaffMessage(msg, sender.id);
  }

  static async loadMessage(messageId: number): Promise<StaffMessageRow> {
    const r = await pool.query<StaffMessageRow>(
      `SELECT m.*, u.name AS sender_name
       FROM staff_messages m
       JOIN users u ON u.id = m.sender_id
       WHERE m.id = $1`,
      [messageId],
    );
    if (!r.rowCount) throw new HttpError(404, 'الرسالة غير موجودة');
    return r.rows[0];
  }

  static async listMessages(
    conversationId: number,
    userId: number,
    opts: { cursor?: number; limit?: number },
  ) {
    await StaffConversationService.requireActiveMember(conversationId, userId);
    const limit = Math.min(50, Math.max(1, opts.limit ?? 30));
    const params: unknown[] = [conversationId];
    let cursorSql = '';
    if (opts.cursor) {
      params.push(opts.cursor);
      cursorSql = ` AND m.id < $${params.length}`;
    }
    params.push(limit + 1);
    const rows = await pool.query<StaffMessageRow>(
      `SELECT m.*, u.name AS sender_name
       FROM staff_messages m
       JOIN users u ON u.id = m.sender_id
       WHERE m.conversation_id = $1 ${cursorSql}
       ORDER BY m.id DESC
       LIMIT $${params.length}`,
      params,
    );
    const hasMore = rows.rows.length > limit;
    const items = rows.rows.slice(0, limit).reverse().map((m) => serializeStaffMessage(m, userId));
    const nextCursor = hasMore ? items[0]?.id ?? null : null;
    return { items, nextCursor, hasMore };
  }

  static async markRead(conversationId: number, userId: number, messageId: number) {
    await StaffConversationService.requireActiveMember(conversationId, userId);
    const msg = await this.loadMessage(messageId);
    if (msg.conversation_id !== conversationId) {
      throw new HttpError(400, 'MESSAGE_NOT_IN_CONVERSATION');
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO staff_message_reads (message_id, user_id)
         VALUES ($1, $2)
         ON CONFLICT (message_id, user_id) DO NOTHING`,
        [messageId, userId],
      );
      await client.query(
        `UPDATE staff_conversation_members
         SET last_read_message_id = GREATEST(COALESCE(last_read_message_id, 0), $3),
             last_read_at = NOW(),
             updated_at = NOW()
         WHERE conversation_id = $1 AND user_id = $2`,
        [conversationId, userId, messageId],
      );
      await client.query('COMMIT');
      return { messageId, conversationId, userId, readAt: new Date().toISOString() };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  static async getReaders(messageId: number, requesterId: number) {
    const msg = await this.loadMessage(messageId);
    await StaffConversationService.requireActiveMember(msg.conversation_id, requesterId);
    const r = await pool.query(
      `SELECT r.user_id, u.name, u.role, r.read_at
       FROM staff_message_reads r
       JOIN users u ON u.id = r.user_id
       WHERE r.message_id = $1
       ORDER BY r.read_at ASC`,
      [messageId],
    );
    return {
      message_id: messageId,
      count: r.rowCount ?? 0,
      readers: r.rows,
    };
  }

  static async softDelete(messageId: number, actor: StaffUser) {
    const msg = await this.loadMessage(messageId);
    await StaffConversationService.requireActiveMember(msg.conversation_id, actor.id);
    if (msg.sender_id !== actor.id && actor.role !== 'admin') {
      throw new HttpError(403, 'FORBIDDEN');
    }
    if (msg.deleted_at) return serializeStaffMessage(msg, actor.id);
    const r = await pool.query<StaffMessageRow>(
      `UPDATE staff_messages
       SET deleted_at = NOW(), deleted_by = $2, content = NULL, image_url = NULL, updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [messageId, actor.id],
    );
    logger.info({ message_id: messageId, deleted_by: actor.id }, 'staff_message_deleted');
    const updated = await this.loadMessage(r.rows[0].id);
    return serializeStaffMessage(updated, actor.id);
  }

  static async editMessage(messageId: number, actor: StaffUser, content: string) {
    const msg = await this.loadMessage(messageId);
    if (msg.sender_id !== actor.id) throw new HttpError(403, 'FORBIDDEN');
    if (msg.type !== 'text') throw new HttpError(400, 'CANNOT_EDIT_IMAGE');
    if (msg.deleted_at) throw new HttpError(400, 'MESSAGE_DELETED');
    const windowMs = staffChatConfig.editWindowMinutes * 60 * 1000;
    if (Date.now() - new Date(msg.created_at).getTime() > windowMs) {
      throw new HttpError(400, 'EDIT_WINDOW_EXPIRED');
    }
    const text = this.validateText(content);
    const r = await pool.query<StaffMessageRow>(
      `UPDATE staff_messages SET content = $2, edited_at = NOW(), updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [messageId, text],
    );
    logger.info({ message_id: messageId }, 'staff_message_edited');
    const updated = await this.loadMessage(r.rows[0].id);
    return serializeStaffMessage(updated, actor.id);
  }

  static async lastMessage(conversationId: number) {
    const r = await pool.query<StaffMessageRow>(
      `SELECT m.*, u.name AS sender_name
       FROM staff_messages m
       JOIN users u ON u.id = m.sender_id
       WHERE m.conversation_id = $1 AND m.deleted_at IS NULL
       ORDER BY m.id DESC LIMIT 1`,
      [conversationId],
    );
    return r.rows[0] ? serializeStaffMessage(r.rows[0]) : null;
  }
}
