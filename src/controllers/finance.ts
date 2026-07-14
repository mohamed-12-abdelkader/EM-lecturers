import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/authentication';
import { adminOrFinanceManager } from '../middleware/financeAuth';
import { requireDefaultTenantMiddleware } from '../middleware/tenantContext';
import { validate } from '../middleware/validateReq';
import { asyncWrapper, HttpError } from '../utils';
import { AccountingService } from '../services/accounting';
import { FinancialAuditService } from '../services/financialAudit';
import { FinancialDashboardService } from '../services/financialDashboard';
import { TeacherCustomPricingService } from '../services/teacherCustomPricing';
import { TeacherPlatformSubscriptionsService } from '../services/teacherPlatformSubscriptions';
import { TeacherSubscriptionInvoicesService } from '../services/teacherSubscriptionInvoices';
import { TeacherSubscriptionPlansService } from '../services/teacherSubscriptionPlans';

export const router = Router();

router.use(requireDefaultTenantMiddleware());
router.use(authMiddleware(['admin', 'employee']));
router.use(adminOrFinanceManager);

const UpdatePlanSchema = z.object({
  name_ar: z.string().min(1).optional(),
  name_en: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  default_price: z.coerce.number().nonnegative().optional(),
  duration_days: z.coerce.number().int().positive().optional(),
  features: z.array(z.any()).optional(),
  is_active: z.boolean().optional(),
  sort_order: z.coerce.number().int().optional(),
});

const CustomPriceSchema = z.object({
  teacher_id: z.coerce.number().int().positive(),
  plan_id: z.coerce.number().int().positive(),
  custom_price: z.coerce.number().nonnegative(),
  discount_reason: z.string().optional().nullable(),
  valid_from: z.string().optional().nullable(),
  valid_until: z.string().optional().nullable(),
});

const CreateSubscriptionSchema = z
  .object({
    teacher_id: z.coerce.number().int().positive(),
    plan_id: z.coerce.number().int().positive(),
    starts_at: z.string().optional(),
    ends_at: z.string().optional(),
    payment_method: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
    actual_price: z.coerce.number().nonnegative().optional(),
    paid_amount: z.coerce.number().nonnegative().optional(),
  })
  .refine(
    (data) => {
      if (data.starts_at && data.ends_at && data.ends_at < data.starts_at) return false;
      return true;
    },
    { message: 'تاريخ النهاية يجب أن يكون بعد تاريخ البداية أو مساوياً له' },
  );

const RenewSubscriptionSchema = z.object({
  payment_method: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  actual_price: z.coerce.number().nonnegative().optional(),
  paid_amount: z.coerce.number().nonnegative().optional(),
  plan_id: z.coerce.number().int().positive().optional(),
});

const RecordSubscriptionPaymentSchema = z.object({
  amount: z.coerce.number().positive(),
  payment_method: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  payment_date: z.string().optional(),
});

const UpgradeSubscriptionSchema = z.object({
  plan_id: z.coerce.number().int().positive(),
  actual_price: z.coerce.number().nonnegative().optional(),
  paid_amount: z.coerce.number().nonnegative().optional(),
  payment_method: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

const CancelSubscriptionSchema = z.object({
  notes: z.string().optional().nullable(),
  reason: z.string().optional().nullable(),
});

const UpdateSubscriptionStatusSchema = z.object({
  status: z.enum(['active', 'expired', 'suspended', 'cancelled']),
  notes: z.string().optional().nullable(),
});

const ExpenseSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  amount: z.coerce.number().positive(),
  category: z.enum([
    'salaries',
    'marketing',
    'hosting',
    'development',
    'support',
    'operational',
    'maintenance',
    'other',
  ]),
  expense_type: z.enum(['monthly', 'one_time', 'recurring']),
  payment_method: z.enum(['cash', 'bank_transfer', 'check']).optional(),
  transaction_date: z.string().min(1),
});

// Dashboard
router.get(
  '/dashboard',
  asyncWrapper(async (req, res) => {
    const period = (req.query.period as string) || 'month';
    const data = await FinancialDashboardService.getDashboard(period);
    res.json({ success: true, data });
  }),
);

// Plans
router.get(
  '/plans',
  asyncWrapper(async (_req, res) => {
    const plans = await TeacherSubscriptionPlansService.list(false);
    res.json({ success: true, data: plans });
  }),
);

router.put(
  '/plans/:id',
  validate(UpdatePlanSchema),
  asyncWrapper(async (req, res) => {
    const id = Number(req.params.id);
    if (!id) throw new HttpError(400, 'معرف الباقة غير صحيح');
    const plan = await TeacherSubscriptionPlansService.update(id, req.body, (req as any).user.id);
    res.json({ success: true, message: 'تم تحديث الباقة', data: plan });
  }),
);

// Custom pricing
router.get(
  '/custom-prices/teacher/:teacherId',
  asyncWrapper(async (req, res) => {
    const teacherId = Number(req.params.teacherId);
    const includeInactive = req.query.include_inactive === 'true';
    const prices = await TeacherCustomPricingService.listForTeacher(teacherId, includeInactive);
    res.json({ success: true, data: prices });
  }),
);

router.get(
  '/custom-prices/resolve',
  asyncWrapper(async (req, res) => {
    const teacherId = Number(req.query.teacher_id);
    const planId = Number(req.query.plan_id);
    if (!teacherId || !planId) throw new HttpError(400, 'teacher_id و plan_id مطلوبان');
    const resolved = await TeacherCustomPricingService.resolvePrice(teacherId, planId);
    res.json({ success: true, data: resolved });
  }),
);

router.post(
  '/custom-prices',
  validate(CustomPriceSchema),
  asyncWrapper(async (req, res) => {
    const row = await TeacherCustomPricingService.setCustomPrice(req.body, (req as any).user.id);
    res.status(201).json({ success: true, message: 'تم تعيين السعر المخصص', data: row });
  }),
);

router.delete(
  '/custom-prices/:id',
  asyncWrapper(async (req, res) => {
    const id = Number(req.params.id);
    const row = await TeacherCustomPricingService.deactivate(id, (req as any).user.id);
    res.json({ success: true, message: 'تم إلغاء السعر المخصص', data: row });
  }),
);

// Subscriptions
router.get(
  '/subscriptions/outstanding-balances',
  asyncWrapper(async (req, res) => {
    const data = await TeacherPlatformSubscriptionsService.listOutstandingBalances({
      teacher_id: req.query.teacher_id ? Number(req.query.teacher_id) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      offset: req.query.offset ? Number(req.query.offset) : undefined,
    });
    res.json({ success: true, data });
  }),
);

router.get(
  '/subscriptions/expiring-soon',
  asyncWrapper(async (req, res) => {
    const days = req.query.days ? Number(req.query.days) : undefined;
    const data = await TeacherPlatformSubscriptionsService.listExpiringSoon(days, {
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      offset: req.query.offset ? Number(req.query.offset) : undefined,
    });
    res.json({ success: true, data });
  }),
);

router.get(
  '/subscriptions',
  asyncWrapper(async (req, res) => {
    const data = await TeacherPlatformSubscriptionsService.list({
      status: req.query.status as any,
      teacher_id: req.query.teacher_id ? Number(req.query.teacher_id) : undefined,
      plan_id: req.query.plan_id ? Number(req.query.plan_id) : undefined,
      search: req.query.search as string,
      payment_status: req.query.payment_status as any,
      has_remaining:
        req.query.has_remaining === 'true'
          ? true
          : req.query.has_remaining === 'false'
            ? false
            : undefined,
      expiring_within_days: req.query.expiring_within_days
        ? Number(req.query.expiring_within_days)
        : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      offset: req.query.offset ? Number(req.query.offset) : undefined,
    });
    res.json({ success: true, data });
  }),
);

router.get(
  '/subscriptions/:id',
  asyncWrapper(async (req, res) => {
    const sub = await TeacherPlatformSubscriptionsService.getById(Number(req.params.id));
    if (!sub) throw new HttpError(404, 'الاشتراك غير موجود');
    res.json({ success: true, data: sub });
  }),
);

router.post(
  '/subscriptions',
  validate(CreateSubscriptionSchema),
  asyncWrapper(async (req, res) => {
    const sub = await TeacherPlatformSubscriptionsService.create(req.body, (req as any).user.id);
    res.status(201).json({ success: true, message: 'تم إنشاء الاشتراك', data: sub });
  }),
);

router.patch(
  '/subscriptions/:id/status',
  validate(UpdateSubscriptionStatusSchema),
  asyncWrapper(async (req, res) => {
    const sub = await TeacherPlatformSubscriptionsService.updateStatus(
      Number(req.params.id),
      req.body.status,
      (req as any).user.id,
      req.body.notes,
    );
    const message =
      req.body.status === 'cancelled' ? 'تم إلغاء الاشتراك' : 'تم تحديث حالة الاشتراك';
    res.json({ success: true, message, data: sub });
  }),
);

router.post(
  '/subscriptions/:id/cancel',
  validate(CancelSubscriptionSchema),
  asyncWrapper(async (req, res) => {
    const sub = await TeacherPlatformSubscriptionsService.cancel(
      Number(req.params.id),
      (req as any).user.id,
      req.body,
    );
    res.json({ success: true, message: 'تم إلغاء الاشتراك', data: sub });
  }),
);

router.delete(
  '/subscriptions/:id',
  asyncWrapper(async (req, res) => {
    const force = req.query.force === 'true';
    const result = await TeacherPlatformSubscriptionsService.deleteSubscription(
      Number(req.params.id),
      (req as any).user.id,
      { force },
    );
    res.json({
      success: true,
      message: 'تم حذف الاشتراك من السجل',
      data: result,
    });
  }),
);

router.post(
  '/subscriptions/:id/payments',
  validate(RecordSubscriptionPaymentSchema),
  asyncWrapper(async (req, res) => {
    const sub = await TeacherPlatformSubscriptionsService.recordPayment(
      Number(req.params.id),
      req.body,
      (req as any).user.id,
    );
    res.json({ success: true, message: 'تم تسجيل الدفعة', data: sub });
  }),
);

router.get(
  '/subscriptions/:id/upgrade-quote',
  asyncWrapper(async (req, res) => {
    const subscriptionId = Number(req.params.id);
    const planId = Number(req.query.plan_id);
    if (!subscriptionId || !planId) {
      throw new HttpError(400, 'subscription id و plan_id مطلوبان');
    }
    const actualPrice = req.query.actual_price
      ? Number(req.query.actual_price)
      : undefined;
    const quote = await TeacherPlatformSubscriptionsService.getUpgradeQuote(
      subscriptionId,
      planId,
      actualPrice,
    );
    res.json({ success: true, data: quote });
  }),
);

router.post(
  '/subscriptions/:id/upgrade',
  validate(UpgradeSubscriptionSchema),
  asyncWrapper(async (req, res) => {
    const sub = await TeacherPlatformSubscriptionsService.upgrade(
      Number(req.params.id),
      req.body,
      (req as any).user.id,
    );
    res.json({ success: true, message: 'تم ترقية الباقة', data: sub });
  }),
);

router.post(
  '/subscriptions/:id/renew',
  validate(RenewSubscriptionSchema),
  asyncWrapper(async (req, res) => {
    const sub = await TeacherPlatformSubscriptionsService.renew(
      Number(req.params.id),
      req.body,
      (req as any).user.id,
    );
    res.json({ success: true, message: 'تم تجديد الاشتراك', data: sub });
  }),
);

// Invoices (فواتير اشتراكات المدرسين)
router.get(
  '/invoices',
  asyncWrapper(async (req, res) => {
    const data = await TeacherSubscriptionInvoicesService.list({
      teacher_id: req.query.teacher_id ? Number(req.query.teacher_id) : undefined,
      subscription_id: req.query.subscription_id
        ? Number(req.query.subscription_id)
        : undefined,
      invoice_type: req.query.invoice_type as any,
      status: req.query.status as any,
      search: req.query.search as string,
      start_date: req.query.start_date as string,
      end_date: req.query.end_date as string,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      offset: req.query.offset ? Number(req.query.offset) : undefined,
    });
    res.json({ success: true, data });
  }),
);

router.get(
  '/invoices/:id',
  asyncWrapper(async (req, res) => {
    const invoice = await TeacherSubscriptionInvoicesService.getById(Number(req.params.id));
    if (!invoice) throw new HttpError(404, 'الفاتورة غير موجودة');
    res.json({ success: true, data: invoice });
  }),
);

// Expenses (enhanced with audit)
router.post(
  '/expenses',
  validate(ExpenseSchema),
  asyncWrapper(async (req, res) => {
    const expense = await FinancialDashboardService.addExpenseWithAudit(
      req.body,
      (req as any).user.id,
    );
    res.status(201).json({ success: true, message: 'تم إضافة المصروف', data: expense });
  }),
);

router.put(
  '/expenses/:id',
  validate(ExpenseSchema.partial()),
  asyncWrapper(async (req, res) => {
    const expense = await FinancialDashboardService.updateExpenseWithAudit(
      Number(req.params.id),
      req.body,
      (req as any).user.id,
    );
    res.json({ success: true, message: 'تم تحديث المصروف', data: expense });
  }),
);

router.delete(
  '/expenses/:id',
  asyncWrapper(async (req, res) => {
    const expense = await FinancialDashboardService.deleteExpenseWithAudit(
      Number(req.params.id),
      (req as any).user.id,
    );
    res.json({ success: true, message: 'تم حذف المصروف', data: expense });
  }),
);

// Income (legacy compatible + list)
router.get(
  '/income/details',
  asyncWrapper(async (req, res) => {
    const data = await FinancialDashboardService.listIncomeDetails({
      teacher_id: req.query.teacher_id ? Number(req.query.teacher_id) : undefined,
      subscription_id: req.query.subscription_id ? Number(req.query.subscription_id) : undefined,
      plan_code: req.query.plan_code as string,
      payment_type: req.query.payment_type as string,
      start_date: req.query.start_date as string,
      end_date: req.query.end_date as string,
      search: req.query.search as string,
      counted_only: req.query.counted_only === 'true',
      include_reversals: req.query.include_reversals !== 'false',
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      offset: req.query.offset ? Number(req.query.offset) : undefined,
    });
    res.json({ success: true, data });
  }),
);

router.get(
  '/income',
  asyncWrapper(async (req, res) => {
    const income = await AccountingService.getIncome({
      start_date: req.query.start_date as string,
      end_date: req.query.end_date as string,
      source_type: req.query.source_type as string,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      offset: req.query.offset ? Number(req.query.offset) : undefined,
    });
    res.json({ success: true, data: income });
  }),
);

router.get(
  '/expenses/list',
  asyncWrapper(async (req, res) => {
    const expenses = await AccountingService.getExpenses({
      start_date: req.query.start_date as string,
      end_date: req.query.end_date as string,
      category: req.query.category as string,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      offset: req.query.offset ? Number(req.query.offset) : undefined,
    });
    res.json({ success: true, data: expenses });
  }),
);

// Reports
router.get(
  '/reports/revenue',
  asyncWrapper(async (req, res) => {
    const data = await FinancialDashboardService.reportRevenue({
      start_date: req.query.start_date as string,
      end_date: req.query.end_date as string,
      plan_code: req.query.plan_code as string,
      teacher_id: req.query.teacher_id ? Number(req.query.teacher_id) : undefined,
      group_by: (req.query.group_by as 'plan' | 'teacher' | 'day') || 'plan',
    });
    res.json({ success: true, data });
  }),
);

router.get(
  '/reports/expenses',
  asyncWrapper(async (req, res) => {
    const data = await FinancialDashboardService.reportExpenses({
      start_date: req.query.start_date as string,
      end_date: req.query.end_date as string,
      category: req.query.category as string,
    });
    res.json({ success: true, data });
  }),
);

router.get(
  '/reports/profit',
  asyncWrapper(async (req, res) => {
    const data = await FinancialDashboardService.reportProfit(req.query.period as string);
    res.json({ success: true, data });
  }),
);

router.get(
  '/reports/subscriptions',
  asyncWrapper(async (req, res) => {
    const data = await FinancialDashboardService.reportSubscriptions({
      status: req.query.status as string,
      expiring_within_days: req.query.expiring_within_days
        ? Number(req.query.expiring_within_days)
        : undefined,
    });
    res.json({ success: true, data });
  }),
);

// Audit logs
router.get(
  '/audit-logs',
  asyncWrapper(async (req, res) => {
    const data = await FinancialAuditService.list({
      entity_type: req.query.entity_type as string,
      entity_id: req.query.entity_id ? Number(req.query.entity_id) : undefined,
      action: req.query.action as string,
      actor_id: req.query.actor_id ? Number(req.query.actor_id) : undefined,
      start_date: req.query.start_date as string,
      end_date: req.query.end_date as string,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      offset: req.query.offset ? Number(req.query.offset) : undefined,
    });
    res.json({ success: true, data });
  }),
);
