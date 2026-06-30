import pool from '../db/pool';
import { FinancialAuditService } from './financialAudit';
import { TeacherSubscriptionPlansService } from './teacherSubscriptionPlans';

export class TeacherCustomPricingService {
  static async resolvePrice(teacherId: number, planId: number) {
    const plan = await TeacherSubscriptionPlansService.getById(planId);
    if (!plan) throw new Error('Plan not found');

    const custom = await pool.query(
      `SELECT *
       FROM teacher_custom_prices
       WHERE teacher_id = $1
         AND plan_id = $2
         AND is_active = TRUE
         AND (valid_from IS NULL OR valid_from <= CURRENT_DATE)
         AND (valid_until IS NULL OR valid_until >= CURRENT_DATE)
       ORDER BY created_at DESC
       LIMIT 1`,
      [teacherId, planId],
    );

    if (custom.rowCount) {
      return {
        price: Number(custom.rows[0].custom_price),
        custom_price_id: custom.rows[0].id as number,
        discount_reason: custom.rows[0].discount_reason as string | null,
        is_custom: true,
        plan,
      };
    }

    return {
      price: Number(plan.default_price),
      custom_price_id: null,
      discount_reason: null,
      is_custom: false,
      plan,
    };
  }

  static async setCustomPrice(
    input: {
      teacher_id: number;
      plan_id: number;
      custom_price: number;
      discount_reason?: string | null;
      valid_from?: string | null;
      valid_until?: string | null;
    },
    actorId: number,
  ) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const teacherCheck = await client.query(
        `SELECT id FROM users WHERE id = $1 AND role = 'teacher' LIMIT 1`,
        [input.teacher_id],
      );
      if (!teacherCheck.rowCount) throw new Error('Teacher not found');

      await client.query(
        `UPDATE teacher_custom_prices
         SET is_active = FALSE, updated_at = NOW()
         WHERE teacher_id = $1 AND plan_id = $2 AND is_active = TRUE`,
        [input.teacher_id, input.plan_id],
      );

      const result = await client.query(
        `INSERT INTO teacher_custom_prices (
           teacher_id, plan_id, custom_price, discount_reason,
           valid_from, valid_until, is_active, created_by
         ) VALUES ($1, $2, $3, $4, $5, $6, TRUE, $7)
         RETURNING *`,
        [
          input.teacher_id,
          input.plan_id,
          input.custom_price,
          input.discount_reason ?? null,
          input.valid_from ?? null,
          input.valid_until ?? null,
          actorId,
        ],
      );

      await FinancialAuditService.log({
        entity_type: 'teacher_custom_price',
        entity_id: result.rows[0].id,
        action: 'create',
        actor_id: actorId,
        after_data: result.rows[0],
        notes: input.discount_reason ?? undefined,
      });

      await client.query('COMMIT');
      return result.rows[0];
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  static async listForTeacher(teacherId: number, includeInactive = false) {
    const result = await pool.query(
      `SELECT cp.*, p.code AS plan_code, p.name_ar AS plan_name, u.name AS created_by_name
       FROM teacher_custom_prices cp
       JOIN teacher_subscription_plans p ON p.id = cp.plan_id
       LEFT JOIN users u ON u.id = cp.created_by
       WHERE cp.teacher_id = $1
         ${includeInactive ? '' : 'AND cp.is_active = TRUE'}
       ORDER BY cp.created_at DESC`,
      [teacherId],
    );
    return result.rows;
  }

  static async deactivate(id: number, actorId: number) {
    const existing = await pool.query(`SELECT * FROM teacher_custom_prices WHERE id = $1`, [id]);
    if (!existing.rowCount) throw new Error('Custom price not found');

    const result = await pool.query(
      `UPDATE teacher_custom_prices SET is_active = FALSE, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [id],
    );

    await FinancialAuditService.log({
      entity_type: 'teacher_custom_price',
      entity_id: id,
      action: 'update',
      actor_id: actorId,
      before_data: existing.rows[0],
      after_data: result.rows[0],
      notes: 'deactivated',
    });

    return result.rows[0];
  }
}
