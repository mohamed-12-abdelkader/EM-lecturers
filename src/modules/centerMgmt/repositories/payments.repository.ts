import pool from '../../../db/pool';
import type { PaymentMethod, TcPaymentRow } from '../types';

export class PaymentsRepository {
  static async create(input: {
    teacherId: number;
    studentId: number;
    groupId?: number | null;
    subscriptionId?: number | null;
    year: number;
    month: number;
    amount: number;
    remainingAfter: number;
    method?: PaymentMethod;
    notes?: string | null;
    recordedBy?: number | null;
    paidAt?: string | null;
  }): Promise<TcPaymentRow> {
    const result = await pool.query<TcPaymentRow>(
      `INSERT INTO tc_payments (
         teacher_id, student_id, group_id, subscription_id,
         year, month, amount, remaining_after, method, notes, recorded_by, paid_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, COALESCE($12::timestamptz, NOW()))
       RETURNING *`,
      [
        input.teacherId,
        input.studentId,
        input.groupId ?? null,
        input.subscriptionId ?? null,
        input.year,
        input.month,
        input.amount,
        input.remainingAfter,
        input.method ?? 'cash',
        input.notes ?? null,
        input.recordedBy ?? null,
        input.paidAt ?? null,
      ],
    );
    return result.rows[0];
  }

  static async list(
    teacherId: number,
    opts: {
      year?: number;
      month?: number;
      studentId?: number;
      groupId?: number;
      page?: number;
      limit?: number;
    } = {},
  ): Promise<{ items: TcPaymentRow[]; total: number }> {
    const page = opts.page ?? 1;
    const limit = opts.limit ?? 50;
    const params: unknown[] = [teacherId];
    const where = ['p.teacher_id = $1', 'p.deleted_at IS NULL'];

    if (opts.year) {
      params.push(opts.year);
      where.push(`p.year = $${params.length}`);
    }
    if (opts.month) {
      params.push(opts.month);
      where.push(`p.month = $${params.length}`);
    }
    if (opts.studentId) {
      params.push(opts.studentId);
      where.push(`p.student_id = $${params.length}`);
    }
    if (opts.groupId) {
      params.push(opts.groupId);
      where.push(`p.group_id = $${params.length}`);
    }

    const whereSql = where.join(' AND ');
    const countRes = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM tc_payments p WHERE ${whereSql}`,
      params,
    );
    const total = parseInt(countRes.rows[0]?.count ?? '0', 10);

    params.push(limit, (page - 1) * limit);
    const listRes = await pool.query<TcPaymentRow & { student_name?: string; group_name?: string }>(
      `SELECT p.*, st.full_name AS student_name, g.name AS group_name
       FROM tc_payments p
       JOIN tc_students st ON st.id = p.student_id
       LEFT JOIN tc_groups g ON g.id = p.group_id
       WHERE ${whereSql}
       ORDER BY p.paid_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    return { items: listRes.rows, total };
  }

  static async softDelete(id: number, teacherId: number): Promise<boolean> {
    const result = await pool.query(
      `UPDATE tc_payments
       SET deleted_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND teacher_id = $2 AND deleted_at IS NULL`,
      [id, teacherId],
    );
    return (result.rowCount ?? 0) > 0;
  }
}
