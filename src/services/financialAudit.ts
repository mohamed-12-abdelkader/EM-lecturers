import pool from '../db/pool';

export type FinancialAuditAction = 'create' | 'update' | 'delete';

export class FinancialAuditService {
  static async log(input: {
    entity_type: string;
    entity_id?: number | null;
    action: FinancialAuditAction;
    actor_id: number;
    before_data?: Record<string, unknown> | null;
    after_data?: Record<string, unknown> | null;
    notes?: string | null;
  }) {
    const result = await pool.query(
      `INSERT INTO platform_financial_audit_logs
         (entity_type, entity_id, action, actor_id, before_data, after_data, notes)
       VALUES ($1, $2, $3, $4, $5::JSONB, $6::JSONB, $7)
       RETURNING *`,
      [
        input.entity_type,
        input.entity_id ?? null,
        input.action,
        input.actor_id,
        input.before_data ? JSON.stringify(input.before_data) : null,
        input.after_data ? JSON.stringify(input.after_data) : null,
        input.notes ?? null,
      ],
    );
    return result.rows[0];
  }

  static async list(filters: {
    entity_type?: string;
    entity_id?: number;
    action?: string;
    actor_id?: number;
    start_date?: string;
    end_date?: string;
    limit?: number;
    offset?: number;
  } = {}) {
    const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
    const offset = Math.max(filters.offset ?? 0, 0);
    const conditions: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (filters.entity_type) {
      conditions.push(`a.entity_type = $${i++}`);
      values.push(filters.entity_type);
    }
    if (filters.entity_id) {
      conditions.push(`a.entity_id = $${i++}`);
      values.push(filters.entity_id);
    }
    if (filters.action) {
      conditions.push(`a.action = $${i++}`);
      values.push(filters.action);
    }
    if (filters.actor_id) {
      conditions.push(`a.actor_id = $${i++}`);
      values.push(filters.actor_id);
    }
    if (filters.start_date) {
      conditions.push(`a.created_at::date >= $${i++}::date`);
      values.push(filters.start_date);
    }
    if (filters.end_date) {
      conditions.push(`a.created_at::date <= $${i++}::date`);
      values.push(filters.end_date);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const countResult = await pool.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM platform_financial_audit_logs a ${where}`,
      values,
    );

    const listResult = await pool.query(
      `SELECT a.*, u.name AS actor_name
       FROM platform_financial_audit_logs a
       LEFT JOIN users u ON u.id = a.actor_id
       ${where}
       ORDER BY a.created_at DESC
       LIMIT $${i++} OFFSET $${i}`,
      [...values, limit, offset],
    );

    return {
      logs: listResult.rows,
      total: Number(countResult.rows[0]?.total ?? 0),
      limit,
      offset,
    };
  }
}

export async function recordFinancialTransaction(input: {
  transaction_kind: string;
  reference_table: string;
  reference_id: number;
  amount: number;
  direction: 'in' | 'out';
  teacher_id?: number | null;
  plan_code?: string | null;
  category?: string | null;
  transaction_date: string;
  description?: string | null;
  created_by: number;
}) {
  await pool.query(
    `INSERT INTO platform_financial_transactions (
       transaction_kind, reference_table, reference_id, amount, direction,
       teacher_id, plan_code, category, transaction_date, description, created_by
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      input.transaction_kind,
      input.reference_table,
      input.reference_id,
      input.amount,
      input.direction,
      input.teacher_id ?? null,
      input.plan_code ?? null,
      input.category ?? null,
      input.transaction_date,
      input.description ?? null,
      input.created_by,
    ],
  );
}
