import pool from '../db/pool';

export type QbEntityType = 'question_bank' | 'subject' | 'chapter' | 'lesson';
export type QbAction = 'update' | 'delete';

export async function createQuestionBankChangeRequest(params: {
  entityType: QbEntityType;
  entityId: number;
  action: QbAction;
  payload?: Record<string, any>;
  requestedBy: number;
}) {
  const result = await pool.query(
    `INSERT INTO question_bank_change_requests (entity_type, entity_id, action, payload, requested_by)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      params.entityType,
      params.entityId,
      params.action,
      JSON.stringify(params.payload || {}),
      params.requestedBy,
    ],
  );
  return result.rows[0];
}

