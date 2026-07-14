import pool from '../db/pool';
import { HttpError } from '../utils';
import { AccountingService } from './accounting';
import { FinancialAuditService, recordFinancialTransaction, recordFinancialTransactionWithClient } from './financialAudit';
import { TeacherCustomPricingService } from './teacherCustomPricing';
import { TeacherSubscriptionInvoicesService } from './teacherSubscriptionInvoices';
import { TeacherSubscriptionPlansService } from './teacherSubscriptionPlans';
import { packageLevel, TEACHER_BILLING_SUBSCRIPTION_ORDER, type TeacherPackage } from './teacherPlanPolicy';

export type SubscriptionStatus = 'active' | 'expired' | 'suspended' | 'cancelled';
export type PaymentStatus = 'paid' | 'partial' | 'unpaid';

const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  paid: 'مدفوع بالكامل',
  partial: 'مدفوع جزئياً',
  unpaid: 'غير مدفوع',
};

function roundMoney(amount: number): number {
  return Math.round(amount * 100) / 100;
}

function resolvePaymentAmounts(actualPrice: number, paidAmountInput?: number) {
  const paid = roundMoney(paidAmountInput ?? actualPrice);
  if (paid < 0) {
    throw new HttpError(400, 'المبلغ المدفوع لا يمكن أن يكون سالباً');
  }
  if (paid > actualPrice + 0.001) {
    throw new HttpError(400, 'المبلغ المدفوع لا يمكن أن يتجاوز قيمة الاشتراك');
  }
  const remaining = roundMoney(Math.max(0, actualPrice - paid));
  const payment_status: PaymentStatus =
    remaining <= 0 ? 'paid' : paid > 0 ? 'partial' : 'unpaid';
  return { paid_amount: paid, remaining_amount: remaining, payment_status };
}

function enrichSubscriptionRow(row: Record<string, unknown>) {
  const paymentStatus = row.payment_status as PaymentStatus;
  return {
    ...row,
    payment_status_label: PAYMENT_STATUS_LABELS[paymentStatus] ?? paymentStatus,
  };
}

async function insertSubscriptionPayment(
  client: import('pg').PoolClient,
  input: {
    subscription_id: number;
    teacher_id: number;
    renewal_id?: number | null;
    upgrade_id?: number | null;
    amount: number;
    payment_method?: string | null;
    notes?: string | null;
    income_id?: number | null;
    payment_date: string;
    created_by: number;
  },
) {
  const result = await client.query(
    `INSERT INTO teacher_subscription_payments (
       subscription_id, teacher_id, renewal_id, upgrade_id, amount, payment_method, notes,
       income_id, payment_date, created_by
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      input.subscription_id,
      input.teacher_id,
      input.renewal_id ?? null,
      input.upgrade_id ?? null,
      input.amount,
      input.payment_method ?? null,
      input.notes ?? null,
      input.income_id ?? null,
      input.payment_date,
      input.created_by,
    ],
  );
  return result.rows[0];
}

async function applyPaymentToOpenInvoice(
  client: import('pg').PoolClient,
  subscriptionId: number,
  paymentAmount: number,
  paymentMethod?: string | null,
  incomeId?: number | null,
) {
  await client.query(
    `UPDATE teacher_subscription_invoices i
     SET paid_amount = i.paid_amount + $1,
         remaining_amount = GREATEST(0, i.remaining_amount - $1),
         status = CASE
           WHEN i.remaining_amount - $1 <= 0.001 THEN 'paid'
           WHEN i.paid_amount + $1 > 0 THEN 'partial'
           ELSE 'unpaid'
         END,
         payment_method = COALESCE($2, i.payment_method),
         income_id = COALESCE(i.income_id, $3)
     FROM (
       SELECT id
       FROM teacher_subscription_invoices
       WHERE subscription_id = $4 AND status IN ('partial', 'unpaid')
       ORDER BY created_at DESC
       LIMIT 1
     ) latest
     WHERE i.id = latest.id`,
    [paymentAmount, paymentMethod ?? null, incomeId ?? null, subscriptionId],
  );
}

export const DEFAULT_EXPIRY_ALERT_DAYS = 3;
export const DEFAULT_GRACE_PERIOD_DAYS = 3;

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function generateSubscriptionNumber(client: import('pg').PoolClient): Promise<string> {
  const year = new Date().getFullYear();
  const result = await client.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM teacher_platform_subscriptions
     WHERE EXTRACT(YEAR FROM created_at) = $1`,
    [year],
  );
  const seq = Number(result.rows[0]?.n ?? 0) + 1;
  return `SUB-${year}-${String(seq).padStart(6, '0')}`;
}

function arabicDayCount(n: number): string {
  if (n === 0) return 'اليوم';
  if (n === 1) return 'يوم واحد';
  if (n === 2) return 'يومين';
  if (n >= 3 && n <= 10) return `${n} أيام`;
  return `${n} يوماً`;
}

async function reactivateTeacherPlatform(
  client: import('pg').PoolClient,
  teacherId: number,
): Promise<void> {
  await client.query(
    `UPDATE tenants SET is_active = true, updated_at = NOW()
     WHERE owner_user_id = $1`,
    [teacherId],
  );
}

async function deactivateTeacherPlatformIfNoActiveSubscription(
  client: import('pg').PoolClient,
  teacherId: number,
): Promise<void> {
  const active = await client.query(
    `SELECT 1 FROM teacher_platform_subscriptions
     WHERE teacher_id = $1 AND status = 'active' AND ends_at >= CURRENT_DATE
     LIMIT 1`,
    [teacherId],
  );
  if (!active.rowCount) {
    await client.query(
      `UPDATE tenants SET is_active = false, updated_at = NOW() WHERE owner_user_id = $1`,
      [teacherId],
    );
  }
}

async function syncTeacherPackageFromBilling(
  client: import('pg').PoolClient,
  teacherId: number,
): Promise<void> {
  const billing = await client.query<{ code: string; starts_at: string | Date | null }>(
    `SELECT p.code, s.starts_at
     FROM teacher_platform_subscriptions s
     JOIN teacher_subscription_plans p ON p.id = s.plan_id
     WHERE s.teacher_id = $1 AND s.status <> 'cancelled'
     ORDER BY ${TEACHER_BILLING_SUBSCRIPTION_ORDER}
     LIMIT 1`,
    [teacherId],
  );

  if (billing.rowCount) {
    await client.query(
      `UPDATE users
       SET subscription_package = $1,
           subscription_package_assigned_at = COALESCE($2::date, subscription_package_assigned_at, NOW())
       WHERE id = $3 AND role = 'teacher'`,
      [billing.rows[0].code, billing.rows[0].starts_at, teacherId],
    );
    return;
  }

  await client.query(
    `UPDATE users SET subscription_package = 'bronze' WHERE id = $1 AND role = 'teacher'`,
    [teacherId],
  );
}

/** إزالة إيرادات الاشتراك من platform_income وسجل المعاملات عند الإلغاء */
async function reverseSubscriptionRevenue(
  client: import('pg').PoolClient,
  subscriptionId: number,
  sub: {
    teacher_id: number;
    subscription_number: string;
    plan_id: number;
  },
  actorId: number,
): Promise<{ reversed_total: number; income_ids_removed: number[] }> {
  const cancelDate = new Date().toISOString().slice(0, 10);

  const planRes = await client.query<{ code: string }>(
    `SELECT code FROM teacher_subscription_plans WHERE id = $1`,
    [sub.plan_id],
  );
  const planCode = planRes.rows[0]?.code ?? null;

  const incomeRes = await client.query<{ income_id: number }>(
    `SELECT DISTINCT income_id
     FROM (
       SELECT income_id FROM teacher_subscription_payments
       WHERE subscription_id = $1 AND income_id IS NOT NULL
       UNION
       SELECT income_id FROM teacher_platform_subscriptions
       WHERE id = $1 AND income_id IS NOT NULL
     ) incomes`,
    [subscriptionId],
  );

  const incomeIds = incomeRes.rows.map((row) => Number(row.income_id));
  let reversedTotal = 0;

  for (const incomeId of incomeIds) {
    const incomeRow = await client.query<{ amount: string }>(
      `SELECT amount FROM platform_income WHERE id = $1`,
      [incomeId],
    );
    if (!incomeRow.rowCount) continue;
    reversedTotal = roundMoney(reversedTotal + Number(incomeRow.rows[0].amount));
    await client.query(`DELETE FROM platform_income WHERE id = $1`, [incomeId]);
  }

  await client.query(
    `DELETE FROM platform_financial_transactions
     WHERE direction = 'in'
       AND (
         (reference_table = 'teacher_platform_subscriptions' AND reference_id = $1)
         OR (reference_table = 'teacher_subscription_payments' AND reference_id IN (
           SELECT id FROM teacher_subscription_payments WHERE subscription_id = $1
         ))
         OR (reference_table = 'teacher_subscription_renewals' AND reference_id IN (
           SELECT id FROM teacher_subscription_renewals WHERE subscription_id = $1
         ))
         OR (reference_table = 'teacher_subscription_upgrades' AND reference_id IN (
           SELECT id FROM teacher_subscription_upgrades WHERE subscription_id = $1
         ))
       )`,
    [subscriptionId],
  );

  if (reversedTotal > 0) {
    await recordFinancialTransactionWithClient(client, {
      transaction_kind: 'subscription_cancellation',
      reference_table: 'teacher_platform_subscriptions',
      reference_id: subscriptionId,
      amount: reversedTotal,
      direction: 'out',
      teacher_id: sub.teacher_id,
      plan_code: planCode,
      transaction_date: cancelDate,
      description: `إلغاء اشتراك ${sub.subscription_number}`,
      created_by: actorId,
    });
  }

  await client.query(`UPDATE teacher_platform_subscriptions SET income_id = NULL WHERE id = $1`, [
    subscriptionId,
  ]);
  await client.query(
    `UPDATE teacher_subscription_payments SET income_id = NULL WHERE subscription_id = $1`,
    [subscriptionId],
  );
  await client.query(
    `UPDATE teacher_subscription_renewals SET income_id = NULL WHERE subscription_id = $1`,
    [subscriptionId],
  );
  await client.query(
    `UPDATE teacher_subscription_upgrades SET income_id = NULL WHERE subscription_id = $1`,
    [subscriptionId],
  );
  await client.query(
    `UPDATE teacher_subscription_invoices SET income_id = NULL WHERE subscription_id = $1`,
    [subscriptionId],
  );

  return { reversed_total: reversedTotal, income_ids_removed: incomeIds };
}

function toDateString(val: unknown): string | null {
  if (val == null) return null;
  if (typeof val === 'string') {
    const m = val.match(/^(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : null;
  }
  if (val instanceof Date) {
    const y = val.getUTCFullYear();
    const mo = String(val.getUTCMonth() + 1).padStart(2, '0');
    const d = String(val.getUTCDate()).padStart(2, '0');
    return `${y}-${mo}-${d}`;
  }
  return null;
}

function pgBool(val: unknown): boolean {
  return val === true || val === 't' || val === 1 || val === '1';
}

/** Latest subscription that has actually ended (ignores future-dated stale rows). */
const LAST_LAPSED_SUBSCRIPTION_CTE = `
  last_lapsed AS (
    SELECT DISTINCT ON (teacher_id)
      teacher_id,
      id AS subscription_id,
      ends_at AS lapsed_ends_at
    FROM teacher_platform_subscriptions
    WHERE status <> 'cancelled' AND ends_at < CURRENT_DATE
    ORDER BY teacher_id, ends_at DESC, id DESC
  )`;

const VALID_ACTIVE_SUBSCRIPTION_EXISTS = `
  NOT EXISTS (
    SELECT 1 FROM teacher_platform_subscriptions a
    WHERE a.teacher_id = l.teacher_id
      AND a.status = 'active'
      AND a.ends_at >= CURRENT_DATE
  )`;

export type TeacherPlatformAccessPhase =
  | 'none'
  | 'active'
  | 'expiring'
  | 'grace'
  | 'suspended';

export class TeacherPlatformSubscriptionsService {
  static async syncExpiredStatuses() {
    await pool.query(
      `UPDATE teacher_platform_subscriptions
       SET status = 'expired', updated_at = NOW()
       WHERE status = 'active' AND ends_at < CURRENT_DATE`,
    );
  }

  /** Mark expired → restore grace → suspend past grace & deactivate tenant */
  static async syncSubscriptionLifecycle(
    graceDays: number = DEFAULT_GRACE_PERIOD_DAYS,
  ) {
    await this.syncExpiredStatuses();
    await this.restoreTeachersInGracePeriod(graceDays);
    await this.suspendTeachersPastGracePeriod(graceDays);
  }

  private static async restoreTeachersInGracePeriod(graceDays: number) {
    const grace = Math.min(Math.max(graceDays, 1), 30);
    await pool.query(
      `WITH ${LAST_LAPSED_SUBSCRIPTION_CTE},
       teachers_in_grace AS (
         SELECT l.teacher_id, l.subscription_id
         FROM last_lapsed l
         WHERE ${VALID_ACTIVE_SUBSCRIPTION_EXISTS}
           AND l.lapsed_ends_at + $1::int >= CURRENT_DATE
       )
       UPDATE teacher_platform_subscriptions s
       SET status = 'expired', updated_at = NOW()
       FROM teachers_in_grace t
       WHERE s.id = t.subscription_id
         AND s.status = 'suspended'`,
      [grace],
    );
    await pool.query(
      `WITH ${LAST_LAPSED_SUBSCRIPTION_CTE},
       teachers_in_grace AS (
         SELECT l.teacher_id
         FROM last_lapsed l
         WHERE ${VALID_ACTIVE_SUBSCRIPTION_EXISTS}
           AND l.lapsed_ends_at + $1::int >= CURRENT_DATE
       )
       UPDATE tenants tn
       SET is_active = true, updated_at = NOW()
       FROM teachers_in_grace t
       WHERE tn.owner_user_id = t.teacher_id
         AND tn.is_active = false`,
      [grace],
    );
  }

  private static async suspendTeachersPastGracePeriod(graceDays: number) {
    const grace = Math.min(Math.max(graceDays, 1), 30);
    await pool.query(
      `WITH ${LAST_LAPSED_SUBSCRIPTION_CTE},
       teachers_past_grace AS (
         SELECT l.teacher_id, l.subscription_id
         FROM last_lapsed l
         WHERE ${VALID_ACTIVE_SUBSCRIPTION_EXISTS}
           AND l.lapsed_ends_at + $1::int < CURRENT_DATE
       ),
       suspended_subs AS (
         UPDATE teacher_platform_subscriptions s
         SET status = 'suspended', updated_at = NOW()
         FROM teachers_past_grace t
         WHERE s.id = t.subscription_id
           AND s.status IN ('expired', 'active')
         RETURNING s.teacher_id
       )
       UPDATE tenants tn
       SET is_active = false, updated_at = NOW()
       FROM teachers_past_grace t
       WHERE tn.owner_user_id = t.teacher_id
         AND tn.is_active = true`,
      [grace],
    );
  }

  static async create(
    input: {
      teacher_id: number;
      plan_id: number;
      starts_at?: string;
      ends_at?: string;
      payment_method?: string | null;
      notes?: string | null;
      actual_price?: number;
      paid_amount?: number;
    },
    actorId: number,
  ) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const pricing = await TeacherCustomPricingService.resolvePrice(
        input.teacher_id,
        input.plan_id,
      );
      const actualPrice = input.actual_price ?? pricing.price;
      const payment = resolvePaymentAmounts(actualPrice, input.paid_amount);
      const startsAt = input.starts_at ?? new Date().toISOString().slice(0, 10);
      const endsAt =
        input.ends_at ?? addDays(startsAt, Number(pricing.plan.duration_days));
      if (endsAt < startsAt) {
        throw new Error('تاريخ النهاية يجب أن يكون بعد تاريخ البداية أو مساوياً له');
      }
      const subNumber = await generateSubscriptionNumber(client);

      await client.query(
        `UPDATE teacher_platform_subscriptions
         SET status = 'cancelled', updated_at = NOW()
         WHERE teacher_id = $1 AND status <> 'cancelled'`,
        [input.teacher_id],
      );

      const subResult = await client.query(
        `INSERT INTO teacher_platform_subscriptions (
           subscription_number, teacher_id, plan_id, actual_price, custom_price_id,
           paid_amount, remaining_amount, payment_status,
           starts_at, ends_at, status, payment_method, notes, created_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'active', $11, $12, $13)
         RETURNING *`,
        [
          subNumber,
          input.teacher_id,
          input.plan_id,
          actualPrice,
          pricing.custom_price_id,
          payment.paid_amount,
          payment.remaining_amount,
          payment.payment_status,
          startsAt,
          endsAt,
          input.payment_method ?? null,
          input.notes ?? null,
          actorId,
        ],
      );
      const subscription = subResult.rows[0];

      let incomeId: number | null = null;
      if (payment.paid_amount > 0) {
        const income = await AccountingService.addIncomeWithClient(
          client,
          {
            title: `اشتراك مدرس - ${pricing.plan.name_ar}`,
            description: `اشتراك #${subNumber}`,
            amount: payment.paid_amount,
            source_type: 'subscription',
            source_id: subscription.id,
            payment_method: (input.payment_method as any) ?? undefined,
            transaction_date: startsAt,
          },
          actorId,
        );

        incomeId = income.id;

        await client.query(
          `UPDATE teacher_platform_subscriptions SET income_id = $1 WHERE id = $2`,
          [income.id, subscription.id],
        );

        await insertSubscriptionPayment(client, {
          subscription_id: subscription.id,
          teacher_id: input.teacher_id,
          amount: payment.paid_amount,
          payment_method: input.payment_method ?? null,
          notes: input.notes ?? 'دفعة عند إنشاء الاشتراك',
          income_id: income.id,
          payment_date: startsAt,
          created_by: actorId,
        });
      }

      await TeacherSubscriptionInvoicesService.createInTransaction(client, {
        teacher_id: input.teacher_id,
        subscription_id: subscription.id,
        invoice_type: 'subscription',
        plan_id: input.plan_id,
        plan_code: pricing.plan.code,
        plan_name_ar: pricing.plan.name_ar,
        subscription_number: subNumber,
        amount: actualPrice,
        paid_amount: payment.paid_amount,
        remaining_amount: payment.remaining_amount,
        status: payment.payment_status,
        payment_method: input.payment_method ?? null,
        period_start: startsAt,
        period_end: endsAt,
        notes: input.notes ?? null,
        income_id: incomeId,
        issued_at: startsAt,
        created_by: actorId,
      });

      await client.query(
        `UPDATE users
         SET subscription_package = $1, subscription_package_assigned_at = $2::date
         WHERE id = $3 AND role = 'teacher'`,
        [pricing.plan.code, startsAt, input.teacher_id],
      );

      await reactivateTeacherPlatform(client, input.teacher_id);

      if (payment.paid_amount > 0) {
        await recordFinancialTransaction({
          transaction_kind: 'subscription',
          reference_table: 'teacher_platform_subscriptions',
          reference_id: subscription.id,
          amount: payment.paid_amount,
          direction: 'in',
          teacher_id: input.teacher_id,
          plan_code: pricing.plan.code,
          transaction_date: startsAt,
          description: `اشتراك جديد ${subNumber}`,
          created_by: actorId,
        });
      }

      await FinancialAuditService.log({
        entity_type: 'teacher_platform_subscription',
        entity_id: subscription.id,
        action: 'create',
        actor_id: actorId,
        after_data: { ...subscription, income_id: incomeId, ...payment },
      });

      await client.query('COMMIT');
      return this.getById(subscription.id);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  static async renew(
    subscriptionId: number,
    input: {
      payment_method?: string | null;
      notes?: string | null;
      actual_price?: number;
      paid_amount?: number;
      plan_id?: number;
    },
    actorId: number,
  ) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const subRes = await client.query(`SELECT * FROM teacher_platform_subscriptions WHERE id = $1`, [
        subscriptionId,
      ]);
      if (!subRes.rowCount) throw new Error('Subscription not found');
      const sub = subRes.rows[0];

      const planId = input.plan_id ?? sub.plan_id;
      const pricing = await TeacherCustomPricingService.resolvePrice(sub.teacher_id, planId);
      const actualPrice = input.actual_price ?? pricing.price;
      const payment = resolvePaymentAmounts(actualPrice, input.paid_amount);

      const periodStart =
        sub.status === 'active' && sub.ends_at >= new Date().toISOString().slice(0, 10)
          ? addDays(sub.ends_at, 1)
          : new Date().toISOString().slice(0, 10);
      const periodEnd = addDays(periodStart, Number(pricing.plan.duration_days));

      const renewalResult = await client.query(
        `INSERT INTO teacher_subscription_renewals (
           subscription_id, plan_id, actual_price, custom_price_id,
           paid_amount, remaining_amount, payment_status,
           period_start, period_end, payment_method, notes, renewed_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING *`,
        [
          subscriptionId,
          planId,
          actualPrice,
          pricing.custom_price_id,
          payment.paid_amount,
          payment.remaining_amount,
          payment.payment_status,
          periodStart,
          periodEnd,
          input.payment_method ?? null,
          input.notes ?? null,
          actorId,
        ],
      );
      const renewal = renewalResult.rows[0];

      let renewalIncomeId: number | null = null;
      if (payment.paid_amount > 0) {
        const income = await AccountingService.addIncomeWithClient(
          client,
          {
            title: `تجديد اشتراك - ${pricing.plan.name_ar}`,
            description: `تجديد اشتراك #${sub.subscription_number}`,
            amount: payment.paid_amount,
            source_type: 'subscription',
            source_id: renewal.id,
            payment_method: (input.payment_method as any) ?? undefined,
            transaction_date: periodStart,
          },
          actorId,
        );

        renewalIncomeId = income.id;

        await client.query(
          `UPDATE teacher_subscription_renewals SET income_id = $1 WHERE id = $2`,
          [income.id, renewal.id],
        );

        await insertSubscriptionPayment(client, {
          subscription_id: subscriptionId,
          teacher_id: sub.teacher_id,
          renewal_id: renewal.id,
          amount: payment.paid_amount,
          payment_method: input.payment_method ?? null,
          notes: input.notes ?? 'دفعة عند تجديد الاشتراك',
          income_id: income.id,
          payment_date: periodStart,
          created_by: actorId,
        });
      }

      await TeacherSubscriptionInvoicesService.createInTransaction(client, {
        teacher_id: sub.teacher_id,
        subscription_id: subscriptionId,
        renewal_id: renewal.id,
        invoice_type: 'renewal',
        plan_id: planId,
        plan_code: pricing.plan.code,
        plan_name_ar: pricing.plan.name_ar,
        subscription_number: sub.subscription_number,
        amount: actualPrice,
        paid_amount: payment.paid_amount,
        remaining_amount: payment.remaining_amount,
        status: payment.payment_status,
        payment_method: input.payment_method ?? null,
        period_start: periodStart,
        period_end: periodEnd,
        notes: input.notes ?? null,
        income_id: renewalIncomeId,
        issued_at: periodStart,
        created_by: actorId,
      });

      await client.query(
        `UPDATE teacher_platform_subscriptions
         SET plan_id = $1, actual_price = $2, custom_price_id = $3,
             paid_amount = $4, remaining_amount = $5, payment_status = $6,
             starts_at = $7, ends_at = $8, status = 'active',
             payment_method = COALESCE($9, payment_method),
             notes = COALESCE($10, notes), updated_at = NOW()
         WHERE id = $11`,
        [
          planId,
          actualPrice,
          pricing.custom_price_id,
          payment.paid_amount,
          payment.remaining_amount,
          payment.payment_status,
          periodStart,
          periodEnd,
          input.payment_method ?? null,
          input.notes ?? null,
          subscriptionId,
        ],
      );

      await client.query(
        `UPDATE users
         SET subscription_package = $1, subscription_package_assigned_at = $2::date
         WHERE id = $3 AND role = 'teacher'`,
        [pricing.plan.code, periodStart, sub.teacher_id],
      );

      await reactivateTeacherPlatform(client, sub.teacher_id);

      if (payment.paid_amount > 0) {
        await recordFinancialTransaction({
          transaction_kind: 'subscription_renewal',
          reference_table: 'teacher_subscription_renewals',
          reference_id: renewal.id,
          amount: payment.paid_amount,
          direction: 'in',
          teacher_id: sub.teacher_id,
          plan_code: pricing.plan.code,
          transaction_date: periodStart,
          description: `تجديد ${sub.subscription_number}`,
          created_by: actorId,
        });
      }

      await FinancialAuditService.log({
        entity_type: 'teacher_subscription_renewal',
        entity_id: renewal.id,
        action: 'create',
        actor_id: actorId,
        after_data: { ...renewal, income_id: renewalIncomeId, ...payment },
      });

      await client.query('COMMIT');
      return this.getById(subscriptionId);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  private static async loadSubscriptionForUpgrade(subscriptionId: number) {
    const subRes = await pool.query(
      `SELECT s.*, p.code AS plan_code, p.name_ar AS plan_name, p.sort_order AS plan_sort_order
       FROM teacher_platform_subscriptions s
       JOIN teacher_subscription_plans p ON p.id = s.plan_id
       WHERE s.id = $1`,
      [subscriptionId],
    );
    if (!subRes.rowCount) throw new HttpError(404, 'الاشتراك غير موجود');
    const sub = subRes.rows[0];
    if (sub.status !== 'active') {
      throw new HttpError(400, 'يمكن ترقية الاشتراك النشط فقط');
    }
    const today = new Date().toISOString().slice(0, 10);
    const endsAt =
      typeof sub.ends_at === 'string'
        ? sub.ends_at.slice(0, 10)
        : toDateString(sub.ends_at);
    if (endsAt && endsAt < today) {
      throw new HttpError(400, 'انتهت فترة الاشتراك — استخدم التجديد بدلاً من الترقية');
    }
    return sub;
  }

  private static assertHigherPlan(
    fromCode: string,
    toCode: string,
    fromSort: number,
    toSort: number,
  ) {
    const fromPkg = fromCode as TeacherPackage;
    const toPkg = toCode as TeacherPackage;
    const byCode =
      packageLevel(fromPkg) >= 0 &&
      packageLevel(toPkg) >= 0 &&
      packageLevel(toPkg) > packageLevel(fromPkg);
    if (byCode) return;
    if (toSort > fromSort) return;
    throw new HttpError(400, 'يمكن الترقية إلى باقة أعلى فقط');
  }

  static async getUpgradeQuote(
    subscriptionId: number,
    planId: number,
    actualPrice?: number,
  ) {
    const sub = await this.loadSubscriptionForUpgrade(subscriptionId);
    if (sub.plan_id === planId) {
      throw new HttpError(400, 'المدرس مشترك بالفعل في هذه الباقة');
    }

    const newPricing = await TeacherCustomPricingService.resolvePrice(sub.teacher_id, planId);
    this.assertHigherPlan(
      sub.plan_code,
      newPricing.plan.code,
      Number(sub.plan_sort_order),
      Number(newPricing.plan.sort_order),
    );

    const oldActual = roundMoney(Number(sub.actual_price));
    const newActual = roundMoney(actualPrice ?? newPricing.price);
    const upgradeAmount = roundMoney(newActual - oldActual);
    if (upgradeAmount <= 0) {
      throw new HttpError(
        400,
        'قيمة الباقة الجديدة يجب أن تكون أعلى من قيمة الاشتراك الحالي',
      );
    }

    const currentPaid = roundMoney(Number(sub.paid_amount ?? 0));
    const afterPaid = currentPaid;
    const afterRemaining = roundMoney(Math.max(0, newActual - afterPaid));

    const today = new Date().toISOString().slice(0, 10);
    const startsAt = toDateString(sub.starts_at) ?? today;
    const endsAt = toDateString(sub.ends_at) ?? today;

    return {
      subscription_id: subscriptionId,
      subscription_number: sub.subscription_number,
      period: { starts_at: startsAt, ends_at: endsAt },
      from_plan: {
        id: sub.plan_id,
        code: sub.plan_code,
        name_ar: sub.plan_name,
        actual_price: oldActual,
      },
      to_plan: {
        id: planId,
        code: newPricing.plan.code,
        name_ar: newPricing.plan.name_ar,
        actual_price: newActual,
        is_custom_price: newPricing.is_custom,
      },
      upgrade_amount: upgradeAmount,
      current_paid_amount: currentPaid,
      current_remaining_amount: roundMoney(Number(sub.remaining_amount ?? 0)),
      after_upgrade: {
        actual_price: newActual,
        paid_amount: afterPaid,
        remaining_amount: afterRemaining,
        payment_status:
          afterRemaining <= 0 ? 'paid' : afterPaid > 0 ? 'partial' : 'unpaid',
      },
    };
  }

  static async upgrade(
    subscriptionId: number,
    input: {
      plan_id: number;
      actual_price?: number;
      paid_amount?: number;
      payment_method?: string | null;
      notes?: string | null;
    },
    actorId: number,
  ) {
    const quote = await this.getUpgradeQuote(
      subscriptionId,
      input.plan_id,
      input.actual_price,
    );

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const subRes = await client.query(
        `SELECT * FROM teacher_platform_subscriptions WHERE id = $1 FOR UPDATE`,
        [subscriptionId],
      );
      const sub = subRes.rows[0];
      const newPricing = await TeacherCustomPricingService.resolvePrice(
        sub.teacher_id,
        input.plan_id,
      );

      const oldActual = quote.from_plan.actual_price;
      const newActual = quote.to_plan.actual_price;
      const upgradeAmount = quote.upgrade_amount;
      const upgradePayment = resolvePaymentAmounts(upgradeAmount, input.paid_amount);

      const newPaidTotal = roundMoney(Number(sub.paid_amount ?? 0) + upgradePayment.paid_amount);
      const newRemainingTotal = roundMoney(Math.max(0, newActual - newPaidTotal));
      const newStatus: PaymentStatus =
        newRemainingTotal <= 0 ? 'paid' : newPaidTotal > 0 ? 'partial' : 'unpaid';

      const upgradeDate = new Date().toISOString().slice(0, 10);
      const startsAt = quote.period.starts_at;
      const endsAt = quote.period.ends_at;

      const upgradeResult = await client.query(
        `INSERT INTO teacher_subscription_upgrades (
           subscription_id, from_plan_id, to_plan_id,
           old_actual_price, new_actual_price, upgrade_amount,
           paid_amount, remaining_amount, payment_status,
           payment_method, notes, upgraded_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING *`,
        [
          subscriptionId,
          sub.plan_id,
          input.plan_id,
          oldActual,
          newActual,
          upgradeAmount,
          upgradePayment.paid_amount,
          upgradePayment.remaining_amount,
          upgradePayment.payment_status,
          input.payment_method ?? null,
          input.notes ?? null,
          actorId,
        ],
      );
      const upgrade = upgradeResult.rows[0];

      let incomeId: number | null = null;
      if (upgradePayment.paid_amount > 0) {
        const income = await AccountingService.addIncomeWithClient(
          client,
          {
            title: `ترقية اشتراك - ${newPricing.plan.name_ar}`,
            description: `ترقية ${quote.from_plan.name_ar} → ${newPricing.plan.name_ar} (#${sub.subscription_number})`,
            amount: upgradePayment.paid_amount,
            source_type: 'subscription',
            source_id: upgrade.id,
            payment_method: (input.payment_method as any) ?? undefined,
            transaction_date: upgradeDate,
          },
          actorId,
        );
        incomeId = income.id;

        await client.query(
          `UPDATE teacher_subscription_upgrades SET income_id = $1 WHERE id = $2`,
          [income.id, upgrade.id],
        );

        await insertSubscriptionPayment(client, {
          subscription_id: subscriptionId,
          teacher_id: sub.teacher_id,
          upgrade_id: upgrade.id,
          amount: upgradePayment.paid_amount,
          payment_method: input.payment_method ?? null,
          notes: input.notes ?? 'دفعة ترقية الباقة',
          income_id: income.id,
          payment_date: upgradeDate,
          created_by: actorId,
        });
      }

      await client.query(
        `UPDATE teacher_platform_subscriptions
         SET plan_id = $1, actual_price = $2, custom_price_id = $3,
             paid_amount = $4, remaining_amount = $5, payment_status = $6,
             payment_method = COALESCE($7, payment_method),
             notes = COALESCE($8, notes), updated_at = NOW()
         WHERE id = $9`,
        [
          input.plan_id,
          newActual,
          newPricing.custom_price_id,
          newPaidTotal,
          newRemainingTotal,
          newStatus,
          input.payment_method ?? null,
          input.notes ?? null,
          subscriptionId,
        ],
      );

      await client.query(
        `UPDATE users
         SET subscription_package = $1
         WHERE id = $2 AND role = 'teacher'`,
        [newPricing.plan.code, sub.teacher_id],
      );

      await TeacherSubscriptionInvoicesService.createInTransaction(client, {
        teacher_id: sub.teacher_id,
        subscription_id: subscriptionId,
        upgrade_id: upgrade.id,
        invoice_type: 'upgrade',
        plan_id: input.plan_id,
        plan_code: newPricing.plan.code,
        plan_name_ar: newPricing.plan.name_ar,
        subscription_number: sub.subscription_number,
        amount: upgradeAmount,
        paid_amount: upgradePayment.paid_amount,
        remaining_amount: upgradePayment.remaining_amount,
        status: upgradePayment.payment_status,
        payment_method: input.payment_method ?? null,
        period_start: startsAt,
        period_end: endsAt,
        notes: input.notes ?? `ترقية من ${quote.from_plan.name_ar} إلى ${newPricing.plan.name_ar}`,
        income_id: incomeId,
        issued_at: upgradeDate,
        created_by: actorId,
      });

      if (upgradePayment.paid_amount > 0) {
        await recordFinancialTransaction({
          transaction_kind: 'subscription_upgrade',
          reference_table: 'teacher_subscription_upgrades',
          reference_id: upgrade.id,
          amount: upgradePayment.paid_amount,
          direction: 'in',
          teacher_id: sub.teacher_id,
          plan_code: newPricing.plan.code,
          transaction_date: upgradeDate,
          description: `ترقية ${sub.subscription_number}`,
          created_by: actorId,
        });
      }

      await FinancialAuditService.log({
        entity_type: 'teacher_subscription_upgrade',
        entity_id: upgrade.id,
        action: 'create',
        actor_id: actorId,
        before_data: {
          plan_id: sub.plan_id,
          actual_price: oldActual,
          paid_amount: sub.paid_amount,
        },
        after_data: {
          plan_id: input.plan_id,
          actual_price: newActual,
          paid_amount: newPaidTotal,
          remaining_amount: newRemainingTotal,
          upgrade_amount: upgradeAmount,
          income_id: incomeId,
        },
      });

      await client.query('COMMIT');
      return this.getById(subscriptionId);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  static async recordPayment(
    subscriptionId: number,
    input: {
      amount: number;
      payment_method?: string | null;
      notes?: string | null;
      payment_date?: string;
    },
    actorId: number,
  ) {
    if (input.amount <= 0) {
      throw new HttpError(400, 'مبلغ الدفع يجب أن يكون أكبر من صفر');
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const subRes = await client.query(
        `SELECT s.*, p.code AS plan_code, p.name_ar AS plan_name
         FROM teacher_platform_subscriptions s
         JOIN teacher_subscription_plans p ON p.id = s.plan_id
         WHERE s.id = $1
         FOR UPDATE`,
        [subscriptionId],
      );
      if (!subRes.rowCount) throw new HttpError(404, 'الاشتراك غير موجود');
      const sub = subRes.rows[0];
      const remaining = Number(sub.remaining_amount);
      if (remaining <= 0) {
        throw new HttpError(400, 'لا يوجد مبلغ متبقي على هذا الاشتراك');
      }

      const paymentAmount = roundMoney(Math.min(input.amount, remaining));
      const paymentDate = input.payment_date ?? new Date().toISOString().slice(0, 10);

      const income = await AccountingService.addIncomeWithClient(
        client,
        {
          title: `دفعة اشتراك - ${sub.plan_name}`,
          description: `دفعة على اشتراك #${sub.subscription_number}`,
          amount: paymentAmount,
          source_type: 'subscription',
          source_id: subscriptionId,
          payment_method: (input.payment_method as any) ?? undefined,
          transaction_date: paymentDate,
        },
        actorId,
      );

      const paymentRow = await insertSubscriptionPayment(client, {
        subscription_id: subscriptionId,
        teacher_id: sub.teacher_id,
        amount: paymentAmount,
        payment_method: input.payment_method ?? null,
        notes: input.notes ?? null,
        income_id: income.id,
        payment_date: paymentDate,
        created_by: actorId,
      });

      const newPaid = roundMoney(Number(sub.paid_amount) + paymentAmount);
      const newRemaining = roundMoney(remaining - paymentAmount);
      const newStatus: PaymentStatus = newRemaining <= 0 ? 'paid' : 'partial';

      await client.query(
        `UPDATE teacher_platform_subscriptions
         SET paid_amount = $1, remaining_amount = $2, payment_status = $3,
             payment_method = COALESCE($4, payment_method), updated_at = NOW()
         WHERE id = $5`,
        [
          newPaid,
          newRemaining,
          newStatus,
          input.payment_method ?? null,
          subscriptionId,
        ],
      );

      await applyPaymentToOpenInvoice(
        client,
        subscriptionId,
        paymentAmount,
        input.payment_method ?? null,
        income.id,
      );

      await recordFinancialTransaction({
        transaction_kind: 'subscription_payment',
        reference_table: 'teacher_subscription_payments',
        reference_id: paymentRow.id,
        amount: paymentAmount,
        direction: 'in',
        teacher_id: sub.teacher_id,
        plan_code: sub.plan_code,
        transaction_date: paymentDate,
        description: `دفعة على ${sub.subscription_number}`,
        created_by: actorId,
      });

      await FinancialAuditService.log({
        entity_type: 'teacher_subscription_payment',
        entity_id: paymentRow.id,
        action: 'create',
        actor_id: actorId,
        after_data: {
          subscription_id: subscriptionId,
          amount: paymentAmount,
          paid_amount: newPaid,
          remaining_amount: newRemaining,
          payment_status: newStatus,
          income_id: income.id,
        },
      });

      await client.query('COMMIT');
      return this.getById(subscriptionId);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  static async listOutstandingBalances(
    pagination: { limit?: number; offset?: number; teacher_id?: number } = {},
  ) {
    await this.syncExpiredStatuses();

    const limit = Math.min(Math.max(pagination.limit ?? 50, 1), 200);
    const offset = Math.max(pagination.offset ?? 0, 0);
    const conditions = [`s.remaining_amount > 0`, `s.status <> 'cancelled'`];
    const values: unknown[] = [];
    let i = 1;

    if (pagination.teacher_id) {
      conditions.push(`s.teacher_id = $${i++}`);
      values.push(pagination.teacher_id);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;

    const summaryResult = await pool.query<{ total_outstanding: string; count: string }>(
      `SELECT COALESCE(SUM(s.remaining_amount), 0)::text AS total_outstanding,
              COUNT(*)::text AS count
       FROM teacher_platform_subscriptions s
       ${where}`,
      values,
    );

    const listResult = await pool.query(
      `SELECT s.*, p.code AS plan_code, p.name_ar AS plan_name,
              t.name AS teacher_name, t.email AS teacher_email, t.phone AS teacher_phone
       FROM teacher_platform_subscriptions s
       JOIN teacher_subscription_plans p ON p.id = s.plan_id
       JOIN users t ON t.id = s.teacher_id
       ${where}
       ORDER BY s.remaining_amount DESC, s.ends_at ASC
       LIMIT $${i++} OFFSET $${i}`,
      [...values, limit, offset],
    );

    return {
      balances: listResult.rows.map((row) => enrichSubscriptionRow(row)),
      total_outstanding: Number(summaryResult.rows[0]?.total_outstanding ?? 0),
      count: Number(summaryResult.rows[0]?.count ?? 0),
      limit,
      offset,
    };
  }

  static async updateStatus(
    id: number,
    status: SubscriptionStatus,
    actorId: number,
    notes?: string,
  ) {
    if (status === 'cancelled') {
      return this.cancel(id, actorId, { notes });
    }

    const existing = await pool.query(`SELECT * FROM teacher_platform_subscriptions WHERE id = $1`, [
      id,
    ]);
    if (!existing.rowCount) throw new HttpError(404, 'الاشتراك غير موجود');

    const result = await pool.query(
      `UPDATE teacher_platform_subscriptions
       SET status = $1, notes = COALESCE($2, notes), updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [status, notes ?? null, id],
    );

    await FinancialAuditService.log({
      entity_type: 'teacher_platform_subscription',
      entity_id: id,
      action: 'update',
      actor_id: actorId,
      before_data: existing.rows[0],
      after_data: result.rows[0],
    });

    return this.getById(id);
  }

  /** إلغاء اشتراك: تعطيل المنصة عند الحاجة + إلغاء الفواتير المفتوحة + مزامنة الباقة */
  static async cancel(
    id: number,
    actorId: number,
    options?: { notes?: string | null; reason?: string | null },
  ) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const existing = await client.query(`SELECT * FROM teacher_platform_subscriptions WHERE id = $1 FOR UPDATE`, [
        id,
      ]);
      if (!existing.rowCount) throw new HttpError(404, 'الاشتراك غير موجود');

      const sub = existing.rows[0];
      if (sub.status === 'cancelled') {
        throw new HttpError(400, 'الاشتراك ملغي مسبقاً');
      }

      const noteParts = [options?.notes, options?.reason ? `سبب الإلغاء: ${options.reason}` : null].filter(
        Boolean,
      );
      const mergedNotes = [sub.notes, ...noteParts].filter(Boolean).join('\n') || null;

      const result = await client.query(
        `UPDATE teacher_platform_subscriptions
         SET status = 'cancelled',
             remaining_amount = 0,
             payment_status = CASE WHEN paid_amount > 0 THEN 'paid' ELSE 'unpaid' END,
             notes = $2,
             updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [id, mergedNotes],
      );

      await client.query(
        `UPDATE teacher_subscription_invoices
         SET status = 'cancelled',
             remaining_amount = 0
         WHERE subscription_id = $1 AND status IN ('unpaid', 'partial')`,
        [id],
      );

      const revenueReversal = await reverseSubscriptionRevenue(client, id, {
        teacher_id: Number(sub.teacher_id),
        subscription_number: String(sub.subscription_number),
        plan_id: Number(sub.plan_id),
      }, actorId);

      await deactivateTeacherPlatformIfNoActiveSubscription(client, Number(sub.teacher_id));
      await syncTeacherPackageFromBilling(client, Number(sub.teacher_id));

      await FinancialAuditService.log({
        entity_type: 'teacher_platform_subscription',
        entity_id: id,
        action: 'update',
        actor_id: actorId,
        before_data: sub,
        after_data: { ...result.rows[0], revenue_reversal: revenueReversal },
        notes: options?.reason ? `إلغاء اشتراك: ${options.reason}` : 'إلغاء اشتراك',
      });

      await client.query('COMMIT');
      return this.getById(id);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  /** حذف اشتراك من السجل (بعد الإلغاء أو إن كان منتهياً/معلقاً) */
  static async deleteSubscription(
    id: number,
    actorId: number,
    options?: { force?: boolean },
  ): Promise<{ id: number; subscription_number: string }> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const existing = await client.query(
        `SELECT * FROM teacher_platform_subscriptions WHERE id = $1 FOR UPDATE`,
        [id],
      );
      if (!existing.rowCount) throw new HttpError(404, 'الاشتراك غير موجود');

      const sub = existing.rows[0];
      const isActive =
        sub.status === 'active' && String(sub.ends_at).slice(0, 10) >= new Date().toISOString().slice(0, 10);

      if (isActive && !options?.force) {
        throw new HttpError(400, 'لا يمكن حذف اشتراك فعال. قم بإلغائه أولاً عبر POST /subscriptions/:id/cancel');
      }

      if (Number(sub.remaining_amount) > 0 && !options?.force) {
        throw new HttpError(
          400,
          'لا يمكن حذف اشتراك عليه مبلغ متبقي. سجّل الدفعات أو ألغِ الاشتراك أولاً، أو استخدم force=true',
        );
      }

      await client.query(
        `UPDATE teacher_subscription_invoices
         SET status = 'cancelled', remaining_amount = 0
         WHERE subscription_id = $1 AND status IN ('unpaid', 'partial')`,
        [id],
      );

      await client.query(`DELETE FROM teacher_platform_subscriptions WHERE id = $1`, [id]);

      await deactivateTeacherPlatformIfNoActiveSubscription(client, Number(sub.teacher_id));
      await syncTeacherPackageFromBilling(client, Number(sub.teacher_id));

      await FinancialAuditService.log({
        entity_type: 'teacher_platform_subscription',
        entity_id: id,
        action: 'delete',
        actor_id: actorId,
        before_data: sub,
        after_data: null,
      });

      await client.query('COMMIT');
      return {
        id: Number(sub.id),
        subscription_number: String(sub.subscription_number),
      };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  static async getById(id: number) {
    const result = await pool.query(
      `SELECT s.*,
              p.code AS plan_code, p.name_ar AS plan_name, p.default_price,
              t.name AS teacher_name, t.email AS teacher_email,
              cb.name AS created_by_name
       FROM teacher_platform_subscriptions s
       JOIN teacher_subscription_plans p ON p.id = s.plan_id
       JOIN users t ON t.id = s.teacher_id
       LEFT JOIN users cb ON cb.id = s.created_by
       WHERE s.id = $1`,
      [id],
    );
    if (!result.rowCount) return null;

    const renewals = await pool.query(
      `SELECT r.*, p.code AS plan_code, p.name_ar AS plan_name, u.name AS renewed_by_name
       FROM teacher_subscription_renewals r
       JOIN teacher_subscription_plans p ON p.id = r.plan_id
       LEFT JOIN users u ON u.id = r.renewed_by
       WHERE r.subscription_id = $1
       ORDER BY r.created_at DESC`,
      [id],
    );

    const invoices = await TeacherSubscriptionInvoicesService.list({
      subscription_id: id,
      limit: 100,
      offset: 0,
    });

    const payments = await pool.query(
      `SELECT p.*, u.name AS created_by_name
       FROM teacher_subscription_payments p
       LEFT JOIN users u ON u.id = p.created_by
       WHERE p.subscription_id = $1
       ORDER BY p.payment_date DESC, p.id DESC`,
      [id],
    );

    const upgrades = await pool.query(
      `SELECT u.*,
              fp.code AS from_plan_code, fp.name_ar AS from_plan_name,
              tp.code AS to_plan_code, tp.name_ar AS to_plan_name,
              usr.name AS upgraded_by_name
       FROM teacher_subscription_upgrades u
       JOIN teacher_subscription_plans fp ON fp.id = u.from_plan_id
       JOIN teacher_subscription_plans tp ON tp.id = u.to_plan_id
       LEFT JOIN users usr ON usr.id = u.upgraded_by
       WHERE u.subscription_id = $1
       ORDER BY u.created_at DESC`,
      [id],
    );

    return {
      ...enrichSubscriptionRow(result.rows[0]),
      renewals: renewals.rows,
      upgrades: upgrades.rows,
      invoices: invoices.invoices,
      payments: payments.rows,
    };
  }

  static async list(filters: {
    status?: SubscriptionStatus;
    teacher_id?: number;
    plan_id?: number;
    search?: string;
    expiring_within_days?: number;
    payment_status?: PaymentStatus;
    has_remaining?: boolean;
    limit?: number;
    offset?: number;
  } = {}) {
    await this.syncExpiredStatuses();

    const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
    const offset = Math.max(filters.offset ?? 0, 0);
    const conditions: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (filters.status) {
      conditions.push(`s.status = $${i++}`);
      values.push(filters.status);
    }
    if (filters.teacher_id) {
      conditions.push(`s.teacher_id = $${i++}`);
      values.push(filters.teacher_id);
    }
    if (filters.plan_id) {
      conditions.push(`s.plan_id = $${i++}`);
      values.push(filters.plan_id);
    }
    if (filters.search) {
      conditions.push(
        `(s.subscription_number ILIKE $${i} OR t.name ILIKE $${i} OR t.email ILIKE $${i})`,
      );
      values.push(`%${filters.search}%`);
      i++;
    }
    if (filters.expiring_within_days != null) {
      conditions.push(`s.status = 'active'`);
      conditions.push(`s.ends_at BETWEEN CURRENT_DATE AND CURRENT_DATE + $${i++}::int`);
      values.push(filters.expiring_within_days);
    }
    if (filters.payment_status) {
      conditions.push(`s.payment_status = $${i++}`);
      values.push(filters.payment_status);
    }
    if (filters.has_remaining === true) {
      conditions.push(`s.remaining_amount > 0`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const countResult = await pool.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total
       FROM teacher_platform_subscriptions s
       JOIN users t ON t.id = s.teacher_id
       ${where}`,
      values,
    );

    const listResult = await pool.query(
      `SELECT s.*, p.code AS plan_code, p.name_ar AS plan_name,
              t.name AS teacher_name, t.email AS teacher_email
       FROM teacher_platform_subscriptions s
       JOIN teacher_subscription_plans p ON p.id = s.plan_id
       JOIN users t ON t.id = s.teacher_id
       ${where}
       ORDER BY s.created_at DESC
       LIMIT $${i++} OFFSET $${i}`,
      [...values, limit, offset],
    );

    return {
      subscriptions: listResult.rows.map((row) => enrichSubscriptionRow(row)),
      total: Number(countResult.rows[0]?.total ?? 0),
      limit,
      offset,
    };
  }

  /** Active subscriptions ending within N days (inclusive), ordered by nearest expiry first */
  static async listExpiringSoon(
    days: number = DEFAULT_EXPIRY_ALERT_DAYS,
    pagination: { limit?: number; offset?: number } = {},
  ) {
    await this.syncExpiredStatuses();

    const withinDays = Math.min(Math.max(days, 1), 90);
    const limit = Math.min(Math.max(pagination.limit ?? 50, 1), 200);
    const offset = Math.max(pagination.offset ?? 0, 0);

    const countResult = await pool.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total
       FROM teacher_platform_subscriptions s
       WHERE s.status = 'active'
         AND s.ends_at BETWEEN CURRENT_DATE AND CURRENT_DATE + $1::int`,
      [withinDays],
    );

    const listResult = await pool.query(
      `SELECT s.*, p.code AS plan_code, p.name_ar AS plan_name,
              t.name AS teacher_name, t.email AS teacher_email,
              (s.ends_at - CURRENT_DATE)::int AS days_remaining
       FROM teacher_platform_subscriptions s
       JOIN teacher_subscription_plans p ON p.id = s.plan_id
       JOIN users t ON t.id = s.teacher_id
       WHERE s.status = 'active'
         AND s.ends_at BETWEEN CURRENT_DATE AND CURRENT_DATE + $1::int
       ORDER BY s.ends_at ASC, s.id ASC
       LIMIT $2 OFFSET $3`,
      [withinDays, limit, offset],
    );

    return {
      days: withinDays,
      as_of: new Date().toISOString().slice(0, 10),
      subscriptions: listResult.rows,
      total: Number(countResult.rows[0]?.total ?? 0),
      limit,
      offset,
    };
  }

  /** Subscription-based access for teacher tenant (active subscription or grace period). */
  static async getPlatformAccessState(
    teacherId: number,
    graceDays: number = DEFAULT_GRACE_PERIOD_DAYS,
  ): Promise<{
    allowed: boolean;
    phase: TeacherPlatformAccessPhase;
    grace_days_remaining: number | null;
    ends_at: string | null;
  }> {
    const grace = Math.min(Math.max(graceDays, 1), 30);
    const result = await pool.query<{
      has_active: boolean;
      ends_at: string | Date | null;
      ends_at_date: string | null;
      grace_days_remaining: number | null;
      is_past_grace: boolean | null;
      is_past_end: boolean | null;
    }>(
      `WITH active_sub AS (
         SELECT 1 AS ok
         FROM teacher_platform_subscriptions
         WHERE teacher_id = $1
           AND status = 'active'
           AND ends_at >= CURRENT_DATE
         LIMIT 1
       ),
       ${LAST_LAPSED_SUBSCRIPTION_CTE},
       lapsed AS (
         SELECT lapsed_ends_at AS ends_at
         FROM last_lapsed
         WHERE teacher_id = $1
         LIMIT 1
       )
       SELECT
         EXISTS (SELECT 1 FROM active_sub) AS has_active,
         l.ends_at,
         to_char(l.ends_at, 'YYYY-MM-DD') AS ends_at_date,
         (l.ends_at + $2::int - CURRENT_DATE)::int AS grace_days_remaining,
         (CURRENT_DATE > l.ends_at + $2::int) AS is_past_grace,
         (l.ends_at < CURRENT_DATE) AS is_past_end
       FROM lapsed l`,
      [teacherId, grace],
    );

    if (!result.rowCount || result.rows[0].ends_at == null) {
      return { allowed: true, phase: 'none', grace_days_remaining: null, ends_at: null };
    }

    const row = result.rows[0];
    const endsAt = row.ends_at_date ?? toDateString(row.ends_at);
    const graceDaysRemaining =
      row.grace_days_remaining == null ? null : Number(row.grace_days_remaining);

    if (row.has_active) {
      return {
        allowed: true,
        phase: 'active',
        grace_days_remaining: graceDaysRemaining,
        ends_at: endsAt,
      };
    }

    if (pgBool(row.is_past_grace)) {
      return {
        allowed: false,
        phase: 'suspended',
        grace_days_remaining: graceDaysRemaining,
        ends_at: endsAt,
      };
    }

    if (pgBool(row.is_past_end)) {
      return {
        allowed: true,
        phase: 'grace',
        grace_days_remaining: graceDaysRemaining,
        ends_at: endsAt,
      };
    }

    return {
      allowed: true,
      phase: 'active',
      grace_days_remaining: graceDaysRemaining,
      ends_at: endsAt,
    };
  }

  /** Returns expiry alert for teacher UI; disappears automatically after renewal extends ends_at */
  static async getTeacherExpiryAlert(
    teacherId: number,
    days: number = DEFAULT_EXPIRY_ALERT_DAYS,
    graceDays: number = DEFAULT_GRACE_PERIOD_DAYS,
  ) {
    const withinDays = Math.min(Math.max(days, 1), 90);
    const grace = Math.min(Math.max(graceDays, 1), 30);
    await this.syncSubscriptionLifecycle(grace);

    const expiringResult = await pool.query(
      `SELECT s.id, s.subscription_number, s.plan_id,
              to_char(s.starts_at, 'YYYY-MM-DD') AS starts_at,
              to_char(s.ends_at, 'YYYY-MM-DD') AS ends_at,
              s.status,
              p.code AS plan_code, p.name_ar AS plan_name,
              (s.ends_at - CURRENT_DATE)::int AS days_remaining
       FROM teacher_platform_subscriptions s
       JOIN teacher_subscription_plans p ON p.id = s.plan_id
       WHERE s.teacher_id = $1
         AND s.status = 'active'
         AND s.ends_at BETWEEN CURRENT_DATE AND CURRENT_DATE + $2::int
       ORDER BY s.ends_at ASC
       LIMIT 1`,
      [teacherId, withinDays],
    );

    if (expiringResult.rowCount) {
      const sub = expiringResult.rows[0];
      const daysRemaining = Number(sub.days_remaining);
      const dayWord = arabicDayCount(daysRemaining);

      return {
        show_alert: true,
        alert: {
          type: 'subscription_expiring',
          subscription_id: sub.id,
          subscription_number: sub.subscription_number,
          plan_id: sub.plan_id,
          plan_code: sub.plan_code,
          plan_name: sub.plan_name,
          starts_at: sub.starts_at,
          ends_at: sub.ends_at,
          days_remaining: daysRemaining,
          platform_active: true,
          message:
            daysRemaining === 0
              ? 'باقتك تنتهي اليوم. يرجى التجديد للاستمرار في استخدام المنصة.'
              : `باقتك على وشك الانتهاء خلال ${dayWord}. يرجى التجديد للاستمرار في استخدام المنصة.`,
        },
      };
    }

    const lapsedResult = await pool.query(
      `WITH ${LAST_LAPSED_SUBSCRIPTION_CTE}
       SELECT s.id, s.subscription_number, s.plan_id,
              to_char(s.starts_at, 'YYYY-MM-DD') AS starts_at,
              to_char(s.ends_at, 'YYYY-MM-DD') AS ends_at,
              s.status,
              p.code AS plan_code, p.name_ar AS plan_name,
              (s.ends_at + $2::int - CURRENT_DATE)::int AS grace_days_remaining,
              (CURRENT_DATE > s.ends_at + $2::int) AS is_past_grace
       FROM last_lapsed l
       JOIN teacher_platform_subscriptions s ON s.id = l.subscription_id
       JOIN teacher_subscription_plans p ON p.id = s.plan_id
       WHERE l.teacher_id = $1
         AND NOT EXISTS (
           SELECT 1 FROM teacher_platform_subscriptions a
           WHERE a.teacher_id = l.teacher_id
             AND a.status = 'active'
             AND a.ends_at >= CURRENT_DATE
         )`,
      [teacherId, grace],
    );

    if (!lapsedResult.rowCount) {
      return { show_alert: false, alert: null };
    }

    const sub = lapsedResult.rows[0];
    const graceDaysRemaining = Number(sub.grace_days_remaining);
    const isPastGrace = pgBool(sub.is_past_grace);

    if (!isPastGrace) {
      const dayWord = arabicDayCount(graceDaysRemaining);
      return {
        show_alert: true,
        alert: {
          type: 'subscription_grace_period',
          subscription_id: sub.id,
          subscription_number: sub.subscription_number,
          plan_id: sub.plan_id,
          plan_code: sub.plan_code,
          plan_name: sub.plan_name,
          starts_at: sub.starts_at,
          ends_at: sub.ends_at,
          grace_days_remaining: graceDaysRemaining,
          grace_period_days: grace,
          platform_active: true,
          message:
            graceDaysRemaining === 0
              ? `باقتك انتهت بالفعل وأنت الآن في الوضع الاستثنائي. في حالة عدم التجديد ${dayWord} سيتم إيقاف منصتك بشكل نهائي.`
              : `باقتك انتهت بالفعل وأنت الآن في الوضع الاستثنائي. في حالة عدم التجديد خلال ${dayWord} سيتم إيقاف منصتك بشكل نهائي.`,
        },
      };
    }

    if (isPastGrace) {
      return {
        show_alert: true,
        alert: {
          type: 'platform_suspended',
          subscription_id: sub.id,
          subscription_number: sub.subscription_number,
          plan_id: sub.plan_id,
          plan_code: sub.plan_code,
          plan_name: sub.plan_name,
          ends_at: sub.ends_at,
          grace_period_days: grace,
          platform_active: false,
          message:
            'تم إيقاف تنشيط منصتك بشكل نهائي لعدم تجديد الاشتراك. يرجى التواصل مع الإدارة لتجديد الباقة وإعادة التفعيل.',
        },
      };
    }

    return { show_alert: false, alert: null };
  }
}
