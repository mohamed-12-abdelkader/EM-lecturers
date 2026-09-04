import pool from '../../../../db/pool';

export type PolicyChatRole = 'user' | 'assistant';

export type PolicyChatMessage = {
  id: number;
  role: PolicyChatRole;
  body: string;
  admin_user_id: number | null;
  created_at: Date;
};

const MAX_HISTORY = 80;

export async function listPolicyChatMessages(
  limit = MAX_HISTORY,
): Promise<PolicyChatMessage[]> {
  const result = await pool.query<PolicyChatMessage>(
    `SELECT id, role, body, admin_user_id, created_at
     FROM wa_support_policy_messages
     ORDER BY id DESC
     LIMIT $1`,
    [Math.min(200, Math.max(1, limit))],
  );
  return result.rows.reverse();
}

export async function appendPolicyChatMessage(params: {
  role: PolicyChatRole;
  body: string;
  adminUserId?: number | null;
}): Promise<PolicyChatMessage> {
  const result = await pool.query<PolicyChatMessage>(
    `INSERT INTO wa_support_policy_messages (role, body, admin_user_id)
     VALUES ($1, $2, $3)
     RETURNING id, role, body, admin_user_id, created_at`,
    [params.role, params.body, params.adminUserId ?? null],
  );
  return result.rows[0];
}
