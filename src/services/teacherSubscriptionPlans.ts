import pool from '../db/pool';
import { FinancialAuditService } from './financialAudit';

export type PlanCode = 'bronze' | 'silver' | 'gold' | 'diamond';

export class TeacherSubscriptionPlansService {
  static async list(activeOnly = true) {
    const result = await pool.query(
      `SELECT * FROM teacher_subscription_plans
       ${activeOnly ? 'WHERE is_active = TRUE' : ''}
       ORDER BY sort_order ASC, id ASC`,
    );
    return result.rows;
  }

  static async getById(id: number) {
    const result = await pool.query(`SELECT * FROM teacher_subscription_plans WHERE id = $1`, [id]);
    return result.rows[0] ?? null;
  }

  static async getByCode(code: PlanCode) {
    const result = await pool.query(`SELECT * FROM teacher_subscription_plans WHERE code = $1`, [
      code,
    ]);
    return result.rows[0] ?? null;
  }

  static async update(
    id: number,
    patch: {
      name_ar?: string;
      name_en?: string | null;
      description?: string | null;
      default_price?: number;
      duration_days?: number;
      features?: unknown[];
      is_active?: boolean;
      sort_order?: number;
    },
    actorId: number,
  ) {
    const existing = await this.getById(id);
    if (!existing) throw new Error('Plan not found');

    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    const add = (col: string, val: unknown) => {
      fields.push(`${col} = $${i++}`);
      values.push(val);
    };

    if (patch.name_ar !== undefined) add('name_ar', patch.name_ar);
    if (patch.name_en !== undefined) add('name_en', patch.name_en);
    if (patch.description !== undefined) add('description', patch.description);
    if (patch.default_price !== undefined) add('default_price', patch.default_price);
    if (patch.duration_days !== undefined) add('duration_days', patch.duration_days);
    if (patch.features !== undefined) add('features', JSON.stringify(patch.features));
    if (patch.is_active !== undefined) add('is_active', patch.is_active);
    if (patch.sort_order !== undefined) add('sort_order', patch.sort_order);

    if (!fields.length) return existing;

    values.push(id);
    const result = await pool.query(
      `UPDATE teacher_subscription_plans
       SET ${fields.join(', ')}, updated_at = NOW()
       WHERE id = $${i}
       RETURNING *`,
      values,
    );

    await FinancialAuditService.log({
      entity_type: 'teacher_subscription_plan',
      entity_id: id,
      action: 'update',
      actor_id: actorId,
      before_data: existing,
      after_data: result.rows[0],
    });

    return result.rows[0];
  }
}
