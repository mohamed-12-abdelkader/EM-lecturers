import pool from '../db/pool';
import { AccountingService } from './accounting';
import { FinancialAuditService, recordFinancialTransaction } from './financialAudit';
import { TeacherPlatformSubscriptionsService } from './teacherPlatformSubscriptions';

export type ExpenseCategory =
  | 'salaries'
  | 'marketing'
  | 'hosting'
  | 'development'
  | 'support'
  | 'operational'
  | 'maintenance'
  | 'other';

function periodToDates(period?: string): { start_date?: string; end_date?: string } {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);

  if (!period || period === 'all') return {};

  if (period === 'today' || period === 'day') {
    return { start_date: today, end_date: today };
  }

  if (period === 'week') {
    const start = new Date(now);
    start.setUTCDate(start.getUTCDate() - start.getUTCDay());
    return { start_date: start.toISOString().slice(0, 10), end_date: today };
  }

  if (period === 'month') {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    return { start_date: start.toISOString().slice(0, 10), end_date: today };
  }

  if (period === 'year') {
    const start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    return { start_date: start.toISOString().slice(0, 10), end_date: today };
  }

  return {};
}

export class FinancialDashboardService {
  static async getDashboard(period?: string) {
    await TeacherPlatformSubscriptionsService.syncExpiredStatuses();
    const { start_date, end_date } = periodToDates(period);

    const stats = await AccountingService.getFinancialStats({ start_date, end_date });

    const [activeSubs, expiredSubs, recentRenewals, topPlans, topTeachers, expiringSoon, outstanding] =
      await Promise.all([
      pool.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c FROM teacher_platform_subscriptions WHERE status = 'active'`,
      ),
      pool.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c FROM teacher_platform_subscriptions WHERE status = 'expired'`,
      ),
      pool.query(
        `SELECT r.*, s.subscription_number, t.name AS teacher_name, p.name_ar AS plan_name
         FROM teacher_subscription_renewals r
         JOIN teacher_platform_subscriptions s ON s.id = r.subscription_id
         JOIN users t ON t.id = s.teacher_id
         JOIN teacher_subscription_plans p ON p.id = r.plan_id
         ORDER BY r.created_at DESC
         LIMIT 10`,
      ),
      pool.query(
        `SELECT p.code, p.name_ar, COALESCE(SUM(ft.amount), 0)::float AS total_revenue
         FROM platform_financial_transactions ft
         JOIN teacher_subscription_plans p ON p.code = ft.plan_code
         WHERE ft.direction = 'in'
           AND ft.transaction_kind IN ('subscription', 'subscription_renewal')
           ${start_date ? `AND ft.transaction_date >= $1` : ''}
           ${end_date ? `AND ft.transaction_date <= $${start_date ? 2 : 1}` : ''}
         GROUP BY p.code, p.name_ar
         ORDER BY total_revenue DESC`,
        start_date && end_date ? [start_date, end_date] : start_date ? [start_date] : end_date ? [end_date] : [],
      ),
      pool.query(
        `SELECT t.id, t.name, t.email, COALESCE(SUM(ft.amount), 0)::float AS total_revenue
         FROM platform_financial_transactions ft
         JOIN users t ON t.id = ft.teacher_id
         WHERE ft.direction = 'in'
           AND ft.teacher_id IS NOT NULL
           ${start_date ? `AND ft.transaction_date >= $1` : ''}
           ${end_date ? `AND ft.transaction_date <= $${start_date ? 2 : 1}` : ''}
         GROUP BY t.id, t.name, t.email
         ORDER BY total_revenue DESC
         LIMIT 10`,
        start_date && end_date ? [start_date, end_date] : start_date ? [start_date] : end_date ? [end_date] : [],
      ),
      TeacherPlatformSubscriptionsService.listExpiringSoon(3, { limit: 20, offset: 0 }),
      TeacherPlatformSubscriptionsService.listOutstandingBalances({ limit: 10, offset: 0 }),
    ]);

    const renewalRevenue = await pool.query<{ total: string }>(
      `SELECT COALESCE(SUM(amount), 0)::text AS total
       FROM platform_financial_transactions
       WHERE direction = 'in' AND transaction_kind = 'subscription_renewal'
       ${start_date ? 'AND transaction_date >= $1' : ''}
       ${end_date ? `AND transaction_date <= $${start_date ? 2 : 1}` : ''}`,
      start_date && end_date ? [start_date, end_date] : start_date ? [start_date] : end_date ? [end_date] : [],
    );

    return {
      period: period ?? 'all',
      start_date: start_date ?? null,
      end_date: end_date ?? null,
      total_income: stats.total_income,
      total_expenses: stats.total_expenses,
      net_profit: stats.net_profit,
      profit_margin: stats.profit_margin,
      active_subscriptions: Number(activeSubs.rows[0]?.c ?? 0),
      expired_subscriptions: Number(expiredSubs.rows[0]?.c ?? 0),
      renewal_revenue: Number(renewalRevenue.rows[0]?.total ?? 0),
      income_by_source: stats.income_by_source,
      expenses_by_category: stats.expenses_by_category,
      recent_renewals: recentRenewals.rows,
      top_plans_by_revenue: topPlans.rows,
      top_teachers_by_revenue: topTeachers.rows,
      expiring_soon_subscriptions: expiringSoon.subscriptions,
      expiring_soon_total: expiringSoon.total,
      expiring_soon_days: expiringSoon.days,
      expiring_soon_as_of: expiringSoon.as_of,
      outstanding_balances_total: outstanding.total_outstanding,
      outstanding_balances_count: outstanding.count,
      outstanding_balances: outstanding.balances,
    };
  }

  static async reportRevenue(filters: {
    start_date?: string;
    end_date?: string;
    plan_code?: string;
    teacher_id?: number;
    group_by?: 'plan' | 'teacher' | 'day';
  }) {
    const groupBy = filters.group_by ?? 'plan';
    const conditions: string[] = [`ft.direction = 'in'`];
    const values: unknown[] = [];
    let i = 1;

    if (filters.start_date) {
      conditions.push(`ft.transaction_date >= $${i++}`);
      values.push(filters.start_date);
    }
    if (filters.end_date) {
      conditions.push(`ft.transaction_date <= $${i++}`);
      values.push(filters.end_date);
    }
    if (filters.plan_code) {
      conditions.push(`ft.plan_code = $${i++}`);
      values.push(filters.plan_code);
    }
    if (filters.teacher_id) {
      conditions.push(`ft.teacher_id = $${i++}`);
      values.push(filters.teacher_id);
    }

    const where = conditions.join(' AND ');
    let selectGroup = `ft.plan_code AS group_key, p.name_ar AS group_label`;
    let join = `LEFT JOIN teacher_subscription_plans p ON p.code = ft.plan_code`;
    let groupSql = `ft.plan_code, p.name_ar`;

    if (groupBy === 'teacher') {
      selectGroup = `ft.teacher_id AS group_key, t.name AS group_label`;
      join = `LEFT JOIN users t ON t.id = ft.teacher_id`;
      groupSql = `ft.teacher_id, t.name`;
    } else if (groupBy === 'day') {
      selectGroup = `ft.transaction_date::text AS group_key, ft.transaction_date::text AS group_label`;
      join = '';
      groupSql = `ft.transaction_date`;
    }

    const result = await pool.query(
      `SELECT ${selectGroup},
              COUNT(*)::int AS transactions_count,
              COALESCE(SUM(ft.amount), 0)::float AS total_amount
       FROM platform_financial_transactions ft
       ${join}
       WHERE ${where}
       GROUP BY ${groupSql}
       ORDER BY total_amount DESC`,
      values,
    );

    return { group_by: groupBy, rows: result.rows };
  }

  static async reportExpenses(filters: {
    start_date?: string;
    end_date?: string;
    category?: string;
  }) {
    const expenses = await AccountingService.getExpenses({
      start_date: filters.start_date,
      end_date: filters.end_date,
      category: filters.category,
      limit: 500,
      offset: 0,
    });

    const byCategory = await pool.query(
      `SELECT category, COALESCE(SUM(amount), 0)::float AS total, COUNT(*)::int AS count
       FROM platform_expenses
       WHERE ($1::date IS NULL OR transaction_date >= $1)
         AND ($2::date IS NULL OR transaction_date <= $2)
         AND ($3::text IS NULL OR category = $3)
       GROUP BY category
       ORDER BY total DESC`,
      [filters.start_date ?? null, filters.end_date ?? null, filters.category ?? null],
    );

    return { expenses, by_category: byCategory.rows };
  }

  static async reportProfit(period?: string) {
    const periods = ['day', 'week', 'month', 'year', 'all'] as const;
    const out: Record<string, { income: number; expenses: number; profit: number }> = {};

    for (const p of periods) {
      const { start_date, end_date } = periodToDates(p === 'day' ? 'today' : p);
      const stats = await AccountingService.getFinancialStats({ start_date, end_date });
      out[p] = {
        income: stats.total_income,
        expenses: stats.total_expenses,
        profit: stats.net_profit,
      };
    }

    if (period) {
      const { start_date, end_date } = periodToDates(period);
      const stats = await AccountingService.getFinancialStats({ start_date, end_date });
      return { period, start_date, end_date, ...stats, all_periods: out };
    }

    return { all_periods: out };
  }

  static async reportSubscriptions(filters: {
    status?: string;
    expiring_within_days?: number;
  }) {
    await TeacherPlatformSubscriptionsService.syncExpiredStatuses();
    const list = await TeacherPlatformSubscriptionsService.list({
      status: filters.status as any,
      expiring_within_days: filters.expiring_within_days,
      limit: 200,
      offset: 0,
    });
    return list;
  }

  static async addExpenseWithAudit(
    data: {
      title: string;
      description?: string;
      amount: number;
      category: ExpenseCategory;
      expense_type: 'monthly' | 'one_time' | 'recurring';
      payment_method?: string;
      transaction_date: string;
    },
    actorId: number,
  ) {
    const expense = await AccountingService.addExpense(data as any, actorId);
    await recordFinancialTransaction({
      transaction_kind: 'expense',
      reference_table: 'platform_expenses',
      reference_id: expense.id,
      amount: data.amount,
      direction: 'out',
      category: data.category,
      transaction_date: data.transaction_date,
      description: data.title,
      created_by: actorId,
    });
    await FinancialAuditService.log({
      entity_type: 'platform_expense',
      entity_id: expense.id,
      action: 'create',
      actor_id: actorId,
      after_data: expense,
    });
    return expense;
  }

  static async updateExpenseWithAudit(
    id: number,
    patch: Partial<{
      title: string;
      description: string | null;
      amount: number;
      category: ExpenseCategory;
      expense_type: string;
      payment_method: string | null;
      transaction_date: string;
    }>,
    actorId: number,
  ) {
    const existing = await pool.query(`SELECT * FROM platform_expenses WHERE id = $1`, [id]);
    if (!existing.rowCount) throw new Error('Expense not found');

    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    const add = (col: string, val: unknown) => {
      fields.push(`${col} = $${i++}`);
      values.push(val);
    };

    if (patch.title !== undefined) add('title', patch.title);
    if (patch.description !== undefined) add('description', patch.description);
    if (patch.amount !== undefined) add('amount', patch.amount);
    if (patch.category !== undefined) add('category', patch.category);
    if (patch.expense_type !== undefined) add('expense_type', patch.expense_type);
    if (patch.payment_method !== undefined) add('payment_method', patch.payment_method);
    if (patch.transaction_date !== undefined) add('transaction_date', patch.transaction_date);

    if (!fields.length) return existing.rows[0];

    values.push(id);
    const result = await pool.query(
      `UPDATE platform_expenses SET ${fields.join(', ')}, updated_at = NOW() WHERE id = $${i} RETURNING *`,
      values,
    );

    await FinancialAuditService.log({
      entity_type: 'platform_expense',
      entity_id: id,
      action: 'update',
      actor_id: actorId,
      before_data: existing.rows[0],
      after_data: result.rows[0],
    });

    return result.rows[0];
  }

  static async deleteExpenseWithAudit(id: number, actorId: number) {
    const existing = await pool.query(`SELECT * FROM platform_expenses WHERE id = $1`, [id]);
    if (!existing.rowCount) throw new Error('Expense not found');

    await AccountingService.deleteExpense(id);
    await FinancialAuditService.log({
      entity_type: 'platform_expense',
      entity_id: id,
      action: 'delete',
      actor_id: actorId,
      before_data: existing.rows[0],
    });
    return existing.rows[0];
  }
}
