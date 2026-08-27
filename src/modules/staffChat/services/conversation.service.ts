import type { PoolClient } from 'pg';
import pool from '../../../db/pool';
import { HttpError, logger } from '../../../utils';
import { staffChatConfig } from '../config';
import type { StaffConversationRow, StaffConversationType, StaffUser } from '../types';

export class StaffConversationService {
  static async ensureSchema() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS staff_conversations (
        id SERIAL PRIMARY KEY,
        type VARCHAR(20) NOT NULL,
        name TEXT,
        created_by INTEGER,
        direct_admin_id INTEGER,
        direct_employee_id INTEGER,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  }

  static async assertStaffRole(user: StaffUser) {
    if (user.role !== 'admin' && user.role !== 'employee') {
      throw new HttpError(403, 'غير مصرح');
    }
    if (user.role === 'employee') {
      const r = await pool.query(
        `SELECT e.is_active FROM employees e WHERE e.user_id = $1`,
        [user.id],
      );
      if (!r.rowCount || !r.rows[0].is_active) {
        throw new HttpError(403, 'حساب الموظف غير نشط');
      }
    }
  }

  static async isActiveMember(conversationId: number, userId: number, client: PoolClient | typeof pool = pool) {
    const r = await client.query(
      `SELECT 1 FROM staff_conversation_members
       WHERE conversation_id = $1 AND user_id = $2 AND is_active = TRUE`,
      [conversationId, userId],
    );
    return !!r.rowCount;
  }

  static async requireActiveMember(conversationId: number, userId: number) {
    const ok = await this.isActiveMember(conversationId, userId);
    if (!ok) throw new HttpError(403, 'NOT_CONVERSATION_MEMBER');
  }

  static async getGroupConversation(): Promise<StaffConversationRow> {
    await this.ensureSchema();
    const r = await pool.query<StaffConversationRow>(
      `SELECT * FROM staff_conversations
       WHERE type = 'group' AND name = $1
       ORDER BY id ASC LIMIT 1`,
      [staffChatConfig.groupName],
    );
    if (r.rowCount) return r.rows[0];
    const created = await pool.query<StaffConversationRow>(
      `INSERT INTO staff_conversations (type, name) VALUES ('group', $1) RETURNING *`,
      [staffChatConfig.groupName],
    );
    return created.rows[0];
  }

  static async syncGroupMembers() {
    const group = await this.getGroupConversation();
    await pool.query(
      `INSERT INTO staff_conversation_members (conversation_id, user_id)
       SELECT $1, u.id FROM users u
       LEFT JOIN employees e ON e.user_id = u.id
       WHERE u.role = 'admin'
          OR (u.role = 'employee' AND COALESCE(e.is_active, TRUE) = TRUE)
       ON CONFLICT (conversation_id, user_id) DO NOTHING`,
      [group.id],
    );
    return group;
  }

  static async addEmployeeToGroup(employeeUserId: number) {
    const group = await this.getGroupConversation();
    await pool.query(
      `INSERT INTO staff_conversation_members (conversation_id, user_id, is_active)
       VALUES ($1, $2, TRUE)
       ON CONFLICT (conversation_id, user_id)
       DO UPDATE SET is_active = TRUE, updated_at = NOW()`,
      [group.id, employeeUserId],
    );
    logger.info({ user_id: employeeUserId, conversation_id: group.id }, 'staff_chat_member_added');
  }

  static async deactivateEmployeeInGroup(employeeUserId: number) {
    const group = await this.getGroupConversation();
    await pool.query(
      `UPDATE staff_conversation_members
       SET is_active = FALSE, updated_at = NOW()
       WHERE conversation_id = $1 AND user_id = $2`,
      [group.id, employeeUserId],
    );
  }

  static async resolveEmployeeUserId(employeeId: number) {
    const r = await pool.query<{ user_id: number; is_active: boolean }>(
      `SELECT user_id, is_active FROM employees WHERE id = $1`,
      [employeeId],
    );
    if (!r.rowCount) throw new HttpError(404, 'الموظف غير موجود');
    if (!r.rows[0].is_active) throw new HttpError(400, 'الموظف غير نشط');
    return r.rows[0].user_id;
  }

  static async findDirectForEmployee(employeeUserId: number) {
    const r = await pool.query<StaffConversationRow>(
      `SELECT * FROM staff_conversations
       WHERE type = 'direct' AND direct_employee_id = $1
       ORDER BY updated_at DESC LIMIT 1`,
      [employeeUserId],
    );
    return r.rows[0] ?? null;
  }

  static async resolveDefaultAdminUserId() {
    const r = await pool.query<{ id: number }>(
      `SELECT id FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1`,
    );
    if (!r.rowCount) throw new HttpError(404, 'لا يوجد أدمن على المنصة');
    return r.rows[0].id;
  }

  static async getOrCreateDirectForEmployee(employeeUserId: number) {
    const existing = await this.findDirectForEmployee(employeeUserId);
    if (existing) {
      await pool.query(
        `UPDATE staff_conversation_members SET is_active = TRUE, updated_at = NOW()
         WHERE conversation_id = $1`,
        [existing.id],
      );
      return existing;
    }
    const adminUserId = await this.resolveDefaultAdminUserId();
    return this.getOrCreateDirect(adminUserId, employeeUserId);
  }

  static async getOrCreateDirect(adminUserId: number, employeeUserId: number) {
    await this.ensureSchema();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query<StaffConversationRow>(
        `SELECT * FROM staff_conversations
         WHERE type = 'direct'
           AND direct_admin_id = $1
           AND direct_employee_id = $2`,
        [adminUserId, employeeUserId],
      );
      let conv = existing.rows[0];
      if (!conv) {
        const ins = await client.query<StaffConversationRow>(
          `INSERT INTO staff_conversations (type, name, created_by, direct_admin_id, direct_employee_id)
           VALUES ('direct', NULL, $1, $2, $3)
           RETURNING *`,
          [adminUserId, adminUserId, employeeUserId],
        );
        conv = ins.rows[0];
        await client.query(
          `INSERT INTO staff_conversation_members (conversation_id, user_id) VALUES ($1, $2), ($1, $3)
           ON CONFLICT DO NOTHING`,
          [conv.id, adminUserId, employeeUserId],
        );
        logger.info({ conversation_id: conv.id, admin_id: adminUserId, employee_id: employeeUserId }, 'staff_direct_created');
      } else {
        await client.query(
          `UPDATE staff_conversation_members SET is_active = TRUE, updated_at = NOW()
           WHERE conversation_id = $1`,
          [conv.id],
        );
      }
      await client.query('COMMIT');
      return conv;
    } catch (err) {
      await client.query('ROLLBACK');
      const code = (err as { code?: string })?.code;
      if (code === '23505') {
        const retry = await pool.query<StaffConversationRow>(
          `SELECT * FROM staff_conversations
           WHERE type = 'direct' AND direct_admin_id = $1 AND direct_employee_id = $2`,
          [adminUserId, employeeUserId],
        );
        if (retry.rowCount) return retry.rows[0];
      }
      throw err;
    } finally {
      client.release();
    }
  }

  static async listForUser(userId: number) {
    await this.syncGroupMembers();
    const rows = await pool.query<StaffConversationRow & { last_message_at: Date | null }>(
      `SELECT c.*,
              (SELECT MAX(m.created_at) FROM staff_messages m WHERE m.conversation_id = c.id AND m.deleted_at IS NULL) AS last_message_at
       FROM staff_conversations c
       JOIN staff_conversation_members m ON m.conversation_id = c.id
       WHERE m.user_id = $1 AND m.is_active = TRUE
       ORDER BY last_message_at DESC NULLS LAST, c.updated_at DESC`,
      [userId],
    );
    return rows.rows;
  }

  static async getById(conversationId: number) {
    const r = await pool.query<StaffConversationRow>(
      `SELECT * FROM staff_conversations WHERE id = $1`,
      [conversationId],
    );
    if (!r.rowCount) throw new HttpError(404, 'المحادثة غير موجودة');
    return r.rows[0];
  }

  static async getMembers(conversationId: number) {
    const r = await pool.query(
      `SELECT m.*, u.name, u.role, u.email
       FROM staff_conversation_members m
       JOIN users u ON u.id = m.user_id
       WHERE m.conversation_id = $1 AND m.is_active = TRUE
       ORDER BY u.role, u.name`,
      [conversationId],
    );
    return r.rows;
  }

  static async addMember(conversationId: number, userId: number, actor: StaffUser) {
    if (actor.role !== 'admin') throw new HttpError(403, 'Admin only');
    const conv = await this.getById(conversationId);
    if (conv.type !== 'group') throw new HttpError(400, 'يمكن إدارة أعضاء المجموعة فقط');
    await pool.query(
      `INSERT INTO staff_conversation_members (conversation_id, user_id, is_active)
       VALUES ($1, $2, TRUE)
       ON CONFLICT (conversation_id, user_id)
       DO UPDATE SET is_active = TRUE, updated_at = NOW()`,
      [conversationId, userId],
    );
    logger.info({ conversation_id: conversationId, user_id: userId }, 'staff_chat_member_added');
  }

  static async removeMember(conversationId: number, userId: number, actor: StaffUser) {
    if (actor.role !== 'admin') throw new HttpError(403, 'Admin only');
    const conv = await this.getById(conversationId);
    if (conv.type !== 'group') throw new HttpError(400, 'يمكن إدارة أعضاء المجموعة فقط');
    await pool.query(
      `UPDATE staff_conversation_members SET is_active = FALSE, updated_at = NOW()
       WHERE conversation_id = $1 AND user_id = $2`,
      [conversationId, userId],
    );
    logger.info({ conversation_id: conversationId, user_id: userId }, 'staff_chat_member_removed');
  }

  static async employeeCanAccessDirect(conversation: StaffConversationRow, userId: number, role: string) {
    if (conversation.type !== 'direct') return true;
    if (role === 'admin') return conversation.direct_admin_id === userId;
    if (role === 'employee') return conversation.direct_employee_id === userId;
    return false;
  }

  static async unreadCount(conversationId: number, userId: number) {
    const member = await pool.query<{ last_read_message_id: number | null }>(
      `SELECT last_read_message_id FROM staff_conversation_members
       WHERE conversation_id = $1 AND user_id = $2 AND is_active = TRUE`,
      [conversationId, userId],
    );
    if (!member.rowCount) return 0;
    const lastId = member.rows[0].last_read_message_id ?? 0;
    const r = await pool.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM staff_messages
       WHERE conversation_id = $1 AND id > $2 AND sender_id <> $3 AND deleted_at IS NULL`,
      [conversationId, lastId, userId],
    );
    return Number(r.rows[0]?.c ?? 0);
  }
}
