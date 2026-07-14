import pool from '../../../db/pool';
import type {
  SubscriptionStatus,
  TcBillingMonthRow,
  TcSubscriptionListItem,
  TcSubscriptionRow,
} from '../types';

export class SubscriptionsRepository {
  static async openMonth(input: {
    teacherId: number;
    year: number;
    month: number;
    openedBy?: number | null;
    notes?: string | null;
  }): Promise<TcBillingMonthRow> {
    const result = await pool.query<TcBillingMonthRow>(
      `INSERT INTO tc_billing_months (teacher_id, year, month, opened_by, notes)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (teacher_id, year, month)
       DO UPDATE SET notes = COALESCE(EXCLUDED.notes, tc_billing_months.notes)
       RETURNING *`,
      [input.teacherId, input.year, input.month, input.openedBy ?? null, input.notes ?? null],
    );
    return result.rows[0];
  }

  static async listMonths(teacherId: number): Promise<TcBillingMonthRow[]> {
    const result = await pool.query<TcBillingMonthRow>(
      `SELECT * FROM tc_billing_months
       WHERE teacher_id = $1
       ORDER BY year DESC, month DESC`,
      [teacherId],
    );
    return result.rows;
  }

  static async findMonth(
    teacherId: number,
    year: number,
    month: number,
  ): Promise<TcBillingMonthRow | null> {
    const result = await pool.query<TcBillingMonthRow>(
      `SELECT * FROM tc_billing_months
       WHERE teacher_id = $1 AND year = $2 AND month = $3`,
      [teacherId, year, month],
    );
    return result.rows[0] ?? null;
  }

  static async upsertSubscription(input: {
    teacherId: number;
    studentId: number;
    groupId: number;
    year: number;
    month: number;
    status: SubscriptionStatus;
    amountDue: number;
    amountPaid?: number;
    remaining?: number;
    exemptionReason?: string | null;
  }): Promise<TcSubscriptionRow> {
    const amountPaid = input.amountPaid ?? 0;
    const remaining =
      input.remaining ??
      (input.status === 'exempt' || input.status === 'paid'
        ? 0
        : Math.max(0, input.amountDue - amountPaid));

    const result = await pool.query<TcSubscriptionRow>(
      `INSERT INTO tc_monthly_subscriptions (
         teacher_id, student_id, group_id, year, month,
         status, amount_due, amount_paid, remaining, exemption_reason
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (student_id, group_id, year, month)
       DO UPDATE SET
         status = EXCLUDED.status,
         amount_due = EXCLUDED.amount_due,
         amount_paid = EXCLUDED.amount_paid,
         remaining = EXCLUDED.remaining,
         exemption_reason = EXCLUDED.exemption_reason,
         deleted_at = NULL,
         updated_at = NOW()
       RETURNING *`,
      [
        input.teacherId,
        input.studentId,
        input.groupId,
        input.year,
        input.month,
        input.status,
        input.amountDue,
        amountPaid,
        remaining,
        input.exemptionReason ?? null,
      ],
    );
    return result.rows[0];
  }

  static async findById(id: number, teacherId: number): Promise<TcSubscriptionListItem | null> {
    const result = await pool.query<TcSubscriptionListItem>(
      `SELECT sub.*,
              st.full_name AS student_name,
              st.student_code,
              st.phone AS student_phone,
              g.name AS group_name
       FROM tc_monthly_subscriptions sub
       JOIN tc_students st ON st.id = sub.student_id
       JOIN tc_groups g ON g.id = sub.group_id
       WHERE sub.id = $1 AND sub.teacher_id = $2 AND sub.deleted_at IS NULL`,
      [id, teacherId],
    );
    return result.rows[0] ?? null;
  }

  static async updateStatus(
    id: number,
    teacherId: number,
    input: {
      status: SubscriptionStatus;
      amountPaid?: number;
      exemptionReason?: string | null;
    },
  ): Promise<TcSubscriptionRow | null> {
    const current = await this.findById(id, teacherId);
    if (!current) return null;

    const amountDue = Number(current.amount_due);
    let amountPaid = input.amountPaid ?? Number(current.amount_paid);
    let remaining = Math.max(0, amountDue - amountPaid);
    let status = input.status;

    if (status === 'exempt') {
      amountPaid = 0;
      remaining = 0;
    } else if (status === 'paid') {
      amountPaid = amountDue;
      remaining = 0;
    } else if (status === 'unpaid') {
      amountPaid = input.amountPaid ?? 0;
      remaining = Math.max(0, amountDue - amountPaid);
    } else if (status === 'partial') {
      amountPaid = input.amountPaid ?? amountPaid;
      remaining = Math.max(0, amountDue - amountPaid);
      if (amountPaid <= 0) status = 'unpaid';
      if (amountPaid >= amountDue) {
        status = 'paid';
        remaining = 0;
        amountPaid = amountDue;
      }
    }

    const result = await pool.query<TcSubscriptionRow>(
      `UPDATE tc_monthly_subscriptions
       SET status = $1,
           amount_paid = $2,
           remaining = $3,
           exemption_reason = $4,
           updated_at = NOW()
       WHERE id = $5 AND teacher_id = $6 AND deleted_at IS NULL
       RETURNING *`,
      [
        status,
        amountPaid,
        remaining,
        status === 'exempt' ? (input.exemptionReason ?? current.exemption_reason) : null,
        id,
        teacherId,
      ],
    );
    return result.rows[0] ?? null;
  }

  static async listByMonth(
    teacherId: number,
    year: number,
    month: number,
    opts: { groupId?: number; status?: SubscriptionStatus; search?: string } = {},
  ): Promise<TcSubscriptionListItem[]> {
    const params: unknown[] = [teacherId, year, month];
    const where = [
      'sub.teacher_id = $1',
      'sub.year = $2',
      'sub.month = $3',
      'sub.deleted_at IS NULL',
    ];

    if (opts.groupId) {
      params.push(opts.groupId);
      where.push(`sub.group_id = $${params.length}`);
    }
    if (opts.status) {
      params.push(opts.status);
      where.push(`sub.status = $${params.length}`);
    }
    if (opts.search?.trim()) {
      params.push(`%${opts.search.trim()}%`);
      where.push(
        `(st.full_name ILIKE $${params.length} OR st.student_code ILIKE $${params.length} OR st.phone ILIKE $${params.length})`,
      );
    }

    const result = await pool.query<TcSubscriptionListItem>(
      `SELECT sub.*,
              st.full_name AS student_name,
              st.student_code,
              st.phone AS student_phone,
              g.name AS group_name
       FROM tc_monthly_subscriptions sub
       JOIN tc_students st ON st.id = sub.student_id
       JOIN tc_groups g ON g.id = sub.group_id
       WHERE ${where.join(' AND ')}
       ORDER BY g.name ASC, st.full_name ASC`,
      params,
    );
    return result.rows;
  }

  static async monthSummary(
    teacherId: number,
    year: number,
    month: number,
  ): Promise<{
    expected: number;
    collected: number;
    remaining: number;
    paid_count: number;
    unpaid_count: number;
    partial_count: number;
    exempt_count: number;
  }> {
    const result = await pool.query<{
      expected: string;
      collected: string;
      remaining: string;
      paid_count: string;
      unpaid_count: string;
      partial_count: string;
      exempt_count: string;
    }>(
      `SELECT
         COALESCE(SUM(amount_due) FILTER (WHERE status <> 'exempt'), 0)::text AS expected,
         COALESCE(SUM(amount_paid) FILTER (WHERE status <> 'exempt'), 0)::text AS collected,
         COALESCE(SUM(remaining) FILTER (WHERE status <> 'exempt'), 0)::text AS remaining,
         COUNT(*) FILTER (WHERE status = 'paid')::text AS paid_count,
         COUNT(*) FILTER (WHERE status = 'unpaid')::text AS unpaid_count,
         COUNT(*) FILTER (WHERE status = 'partial')::text AS partial_count,
         COUNT(*) FILTER (WHERE status = 'exempt')::text AS exempt_count
       FROM tc_monthly_subscriptions
       WHERE teacher_id = $1 AND year = $2 AND month = $3 AND deleted_at IS NULL`,
      [teacherId, year, month],
    );
    const row = result.rows[0];
    return {
      expected: Number(row?.expected ?? 0),
      collected: Number(row?.collected ?? 0),
      remaining: Number(row?.remaining ?? 0),
      paid_count: parseInt(row?.paid_count ?? '0', 10),
      unpaid_count: parseInt(row?.unpaid_count ?? '0', 10),
      partial_count: parseInt(row?.partial_count ?? '0', 10),
      exempt_count: parseInt(row?.exempt_count ?? '0', 10),
    };
  }

  static async findForStudentMonth(
    teacherId: number,
    studentId: number,
    groupId: number,
    year: number,
    month: number,
  ): Promise<TcSubscriptionRow | null> {
    const result = await pool.query<TcSubscriptionRow>(
      `SELECT * FROM tc_monthly_subscriptions
       WHERE teacher_id = $1 AND student_id = $2 AND group_id = $3
         AND year = $4 AND month = $5 AND deleted_at IS NULL`,
      [teacherId, studentId, groupId, year, month],
    );
    return result.rows[0] ?? null;
  }

  static async applyPayment(
    subscriptionId: number,
    teacherId: number,
    amount: number,
  ): Promise<TcSubscriptionRow | null> {
    const current = await this.findById(subscriptionId, teacherId);
    if (!current || current.status === 'exempt') return current;

    const amountDue = Number(current.amount_due);
    const amountPaid = Number(current.amount_paid) + amount;
    const remaining = Math.max(0, amountDue - amountPaid);
    const status: SubscriptionStatus =
      remaining <= 0 ? 'paid' : amountPaid > 0 ? 'partial' : 'unpaid';

    const result = await pool.query<TcSubscriptionRow>(
      `UPDATE tc_monthly_subscriptions
       SET amount_paid = $1, remaining = $2, status = $3, updated_at = NOW()
       WHERE id = $4 AND teacher_id = $5 AND deleted_at IS NULL
       RETURNING *`,
      [Math.min(amountPaid, amountDue), remaining, status, subscriptionId, teacherId],
    );
    return result.rows[0] ?? null;
  }
}
