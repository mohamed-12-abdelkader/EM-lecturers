import { HttpError } from '../../../utils';
import { ActivityLogsRepository } from '../repositories/activityLogs.repository';
import { PaymentsRepository } from '../repositories/payments.repository';
import { StudentsRepository } from '../repositories/students.repository';
import { SubscriptionsRepository } from '../repositories/subscriptions.repository';
import type { PaymentMethod, SubscriptionStatus } from '../types';

export class SubscriptionsService {
  /**
   * فتح شهر مالي جديد وإنشاء اشتراكات لكل الطلاب النشطين.
   * يمكن تمرير renewed_student_ids لتحديد مين جدد (paid) والباقي unpaid.
   */
  static async openMonth(
    teacherId: number,
    actorUserId: number,
    input: {
      year: number;
      month: number;
      notes?: string | null;
      renewed_student_ids?: number[];
      default_status?: SubscriptionStatus;
    },
  ) {
    const billingMonth = await SubscriptionsRepository.openMonth({
      teacherId,
      year: input.year,
      month: input.month,
      openedBy: actorUserId,
      notes: input.notes,
    });

    const enrollments = await StudentsRepository.listActiveEnrollments(teacherId);
    const renewed = new Set(input.renewed_student_ids ?? []);
    const defaultStatus = input.default_status ?? 'unpaid';

    const created = [];
    for (const en of enrollments) {
      const isRenewed = renewed.has(en.student_id);
      const status: SubscriptionStatus = isRenewed ? 'paid' : defaultStatus;
      const amountDue = Number(en.monthly_fee);
      const amountPaid = status === 'paid' ? amountDue : 0;

      const sub = await SubscriptionsRepository.upsertSubscription({
        teacherId,
        studentId: en.student_id,
        groupId: en.group_id,
        year: input.year,
        month: input.month,
        status,
        amountDue,
        amountPaid,
      });
      created.push(sub);
    }

    await ActivityLogsRepository.log({
      teacherId,
      actorUserId,
      action: 'billing.open_month',
      entityType: 'tc_billing_months',
      entityId: billingMonth.id,
      meta: {
        year: input.year,
        month: input.month,
        subscriptions_count: created.length,
        renewed_count: renewed.size,
      },
    });

    const summary = await SubscriptionsRepository.monthSummary(
      teacherId,
      input.year,
      input.month,
    );

    return {
      billing_month: billingMonth,
      subscriptions_count: created.length,
      summary,
    };
  }

  static listMonths(teacherId: number) {
    return SubscriptionsRepository.listMonths(teacherId);
  }

  static async getMonth(
    teacherId: number,
    year: number,
    month: number,
    opts: { groupId?: number; status?: SubscriptionStatus; search?: string } = {},
  ) {
    const billingMonth = await SubscriptionsRepository.findMonth(teacherId, year, month);
    const subscriptions = await SubscriptionsRepository.listByMonth(teacherId, year, month, opts);
    const summary = await SubscriptionsRepository.monthSummary(teacherId, year, month);
    return { billing_month: billingMonth, subscriptions, summary };
  }

  static async updateSubscription(
    teacherId: number,
    actorUserId: number,
    subscriptionId: number,
    input: {
      status: SubscriptionStatus;
      amount_paid?: number;
      exemption_reason?: string | null;
    },
  ) {
    const updated = await SubscriptionsRepository.updateStatus(subscriptionId, teacherId, {
      status: input.status,
      amountPaid: input.amount_paid,
      exemptionReason: input.exemption_reason,
    });
    if (!updated) throw new HttpError(404, 'الاشتراك غير موجود');

    await ActivityLogsRepository.log({
      teacherId,
      actorUserId,
      action: 'subscription.update',
      entityType: 'tc_monthly_subscriptions',
      entityId: subscriptionId,
      meta: { status: updated.status },
    });

    return SubscriptionsRepository.findById(subscriptionId, teacherId);
  }

  static async bulkUpdate(
    teacherId: number,
    actorUserId: number,
    updates: Array<{
      subscription_id: number;
      status: SubscriptionStatus;
      amount_paid?: number;
      exemption_reason?: string | null;
    }>,
  ) {
    const results = [];
    for (const u of updates) {
      const updated = await SubscriptionsRepository.updateStatus(u.subscription_id, teacherId, {
        status: u.status,
        amountPaid: u.amount_paid,
        exemptionReason: u.exemption_reason,
      });
      if (updated) results.push(updated);
    }

    await ActivityLogsRepository.log({
      teacherId,
      actorUserId,
      action: 'subscription.bulk_update',
      entityType: 'tc_monthly_subscriptions',
      meta: { count: results.length },
    });

    return { updated_count: results.length, items: results };
  }
}

export class PaymentsService {
  static async record(
    teacherId: number,
    actorUserId: number,
    input: {
      student_id: number;
      group_id?: number | null;
      subscription_id?: number | null;
      year: number;
      month: number;
      amount: number;
      method?: PaymentMethod;
      notes?: string | null;
      paid_at?: string | null;
    },
  ) {
    const student = await StudentsRepository.findById(input.student_id, teacherId);
    if (!student) throw new HttpError(404, 'الطالب غير موجود');

    let subscriptionId = input.subscription_id ?? null;
    let remainingAfter = 0;

    if (subscriptionId) {
      const sub = await SubscriptionsRepository.findById(subscriptionId, teacherId);
      if (!sub) throw new HttpError(404, 'الاشتراك غير موجود');
      if (sub.status === 'exempt') {
        throw new HttpError(400, 'الطالب معفي من المصاريف لهذا الشهر');
      }
      const updated = await SubscriptionsRepository.applyPayment(
        subscriptionId,
        teacherId,
        input.amount,
      );
      remainingAfter = Number(updated?.remaining ?? 0);
    } else if (input.group_id) {
      let sub = await SubscriptionsRepository.findForStudentMonth(
        teacherId,
        input.student_id,
        input.group_id,
        input.year,
        input.month,
      );
      if (!sub) {
        const amountDue = 0;
        sub = await SubscriptionsRepository.upsertSubscription({
          teacherId,
          studentId: input.student_id,
          groupId: input.group_id,
          year: input.year,
          month: input.month,
          status: 'unpaid',
          amountDue,
        });
      }
      subscriptionId = sub.id;
      const updated = await SubscriptionsRepository.applyPayment(
        sub.id,
        teacherId,
        input.amount,
      );
      remainingAfter = Number(updated?.remaining ?? 0);
    }

    const payment = await PaymentsRepository.create({
      teacherId,
      studentId: input.student_id,
      groupId: input.group_id,
      subscriptionId,
      year: input.year,
      month: input.month,
      amount: input.amount,
      remainingAfter,
      method: input.method,
      notes: input.notes,
      recordedBy: actorUserId,
      paidAt: input.paid_at,
    });

    await ActivityLogsRepository.log({
      teacherId,
      actorUserId,
      action: 'payment.create',
      entityType: 'tc_payments',
      entityId: payment.id,
      meta: { amount: input.amount, student_id: input.student_id },
    });

    return payment;
  }

  static list(teacherId: number, opts: Parameters<typeof PaymentsRepository.list>[1]) {
    return PaymentsRepository.list(teacherId, opts);
  }
}
