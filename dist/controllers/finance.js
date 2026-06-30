"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const authentication_1 = require("../middleware/authentication");
const financeAuth_1 = require("../middleware/financeAuth");
const tenantContext_1 = require("../middleware/tenantContext");
const validateReq_1 = require("../middleware/validateReq");
const utils_1 = require("../utils");
const accounting_1 = require("../services/accounting");
const financialAudit_1 = require("../services/financialAudit");
const financialDashboard_1 = require("../services/financialDashboard");
const teacherCustomPricing_1 = require("../services/teacherCustomPricing");
const teacherPlatformSubscriptions_1 = require("../services/teacherPlatformSubscriptions");
const teacherSubscriptionInvoices_1 = require("../services/teacherSubscriptionInvoices");
const teacherSubscriptionPlans_1 = require("../services/teacherSubscriptionPlans");
exports.router = (0, express_1.Router)();
exports.router.use((0, tenantContext_1.requireDefaultTenantMiddleware)());
exports.router.use((0, authentication_1.authMiddleware)(['admin', 'employee']));
exports.router.use(financeAuth_1.adminOrFinanceManager);
const UpdatePlanSchema = zod_1.z.object({
    name_ar: zod_1.z.string().min(1).optional(),
    name_en: zod_1.z.string().optional().nullable(),
    description: zod_1.z.string().optional().nullable(),
    default_price: zod_1.z.coerce.number().nonnegative().optional(),
    duration_days: zod_1.z.coerce.number().int().positive().optional(),
    features: zod_1.z.array(zod_1.z.any()).optional(),
    is_active: zod_1.z.boolean().optional(),
    sort_order: zod_1.z.coerce.number().int().optional(),
});
const CustomPriceSchema = zod_1.z.object({
    teacher_id: zod_1.z.coerce.number().int().positive(),
    plan_id: zod_1.z.coerce.number().int().positive(),
    custom_price: zod_1.z.coerce.number().nonnegative(),
    discount_reason: zod_1.z.string().optional().nullable(),
    valid_from: zod_1.z.string().optional().nullable(),
    valid_until: zod_1.z.string().optional().nullable(),
});
const CreateSubscriptionSchema = zod_1.z
    .object({
    teacher_id: zod_1.z.coerce.number().int().positive(),
    plan_id: zod_1.z.coerce.number().int().positive(),
    starts_at: zod_1.z.string().optional(),
    ends_at: zod_1.z.string().optional(),
    payment_method: zod_1.z.string().optional().nullable(),
    notes: zod_1.z.string().optional().nullable(),
    actual_price: zod_1.z.coerce.number().nonnegative().optional(),
    paid_amount: zod_1.z.coerce.number().nonnegative().optional(),
})
    .refine((data) => {
    if (data.starts_at && data.ends_at && data.ends_at < data.starts_at)
        return false;
    return true;
}, { message: 'تاريخ النهاية يجب أن يكون بعد تاريخ البداية أو مساوياً له' });
const RenewSubscriptionSchema = zod_1.z.object({
    payment_method: zod_1.z.string().optional().nullable(),
    notes: zod_1.z.string().optional().nullable(),
    actual_price: zod_1.z.coerce.number().nonnegative().optional(),
    paid_amount: zod_1.z.coerce.number().nonnegative().optional(),
    plan_id: zod_1.z.coerce.number().int().positive().optional(),
});
const RecordSubscriptionPaymentSchema = zod_1.z.object({
    amount: zod_1.z.coerce.number().positive(),
    payment_method: zod_1.z.string().optional().nullable(),
    notes: zod_1.z.string().optional().nullable(),
    payment_date: zod_1.z.string().optional(),
});
const UpgradeSubscriptionSchema = zod_1.z.object({
    plan_id: zod_1.z.coerce.number().int().positive(),
    actual_price: zod_1.z.coerce.number().nonnegative().optional(),
    paid_amount: zod_1.z.coerce.number().nonnegative().optional(),
    payment_method: zod_1.z.string().optional().nullable(),
    notes: zod_1.z.string().optional().nullable(),
});
const UpdateSubscriptionStatusSchema = zod_1.z.object({
    status: zod_1.z.enum(['active', 'expired', 'suspended', 'cancelled']),
    notes: zod_1.z.string().optional().nullable(),
});
const ExpenseSchema = zod_1.z.object({
    title: zod_1.z.string().min(1),
    description: zod_1.z.string().optional(),
    amount: zod_1.z.coerce.number().positive(),
    category: zod_1.z.enum([
        'salaries',
        'marketing',
        'hosting',
        'development',
        'support',
        'operational',
        'maintenance',
        'other',
    ]),
    expense_type: zod_1.z.enum(['monthly', 'one_time', 'recurring']),
    payment_method: zod_1.z.enum(['cash', 'bank_transfer', 'check']).optional(),
    transaction_date: zod_1.z.string().min(1),
});
// Dashboard
exports.router.get('/dashboard', (0, utils_1.asyncWrapper)(async (req, res) => {
    const period = req.query.period || 'month';
    const data = await financialDashboard_1.FinancialDashboardService.getDashboard(period);
    res.json({ success: true, data });
}));
// Plans
exports.router.get('/plans', (0, utils_1.asyncWrapper)(async (_req, res) => {
    const plans = await teacherSubscriptionPlans_1.TeacherSubscriptionPlansService.list(false);
    res.json({ success: true, data: plans });
}));
exports.router.put('/plans/:id', (0, validateReq_1.validate)(UpdatePlanSchema), (0, utils_1.asyncWrapper)(async (req, res) => {
    const id = Number(req.params.id);
    if (!id)
        throw new utils_1.HttpError(400, 'معرف الباقة غير صحيح');
    const plan = await teacherSubscriptionPlans_1.TeacherSubscriptionPlansService.update(id, req.body, req.user.id);
    res.json({ success: true, message: 'تم تحديث الباقة', data: plan });
}));
// Custom pricing
exports.router.get('/custom-prices/teacher/:teacherId', (0, utils_1.asyncWrapper)(async (req, res) => {
    const teacherId = Number(req.params.teacherId);
    const includeInactive = req.query.include_inactive === 'true';
    const prices = await teacherCustomPricing_1.TeacherCustomPricingService.listForTeacher(teacherId, includeInactive);
    res.json({ success: true, data: prices });
}));
exports.router.get('/custom-prices/resolve', (0, utils_1.asyncWrapper)(async (req, res) => {
    const teacherId = Number(req.query.teacher_id);
    const planId = Number(req.query.plan_id);
    if (!teacherId || !planId)
        throw new utils_1.HttpError(400, 'teacher_id و plan_id مطلوبان');
    const resolved = await teacherCustomPricing_1.TeacherCustomPricingService.resolvePrice(teacherId, planId);
    res.json({ success: true, data: resolved });
}));
exports.router.post('/custom-prices', (0, validateReq_1.validate)(CustomPriceSchema), (0, utils_1.asyncWrapper)(async (req, res) => {
    const row = await teacherCustomPricing_1.TeacherCustomPricingService.setCustomPrice(req.body, req.user.id);
    res.status(201).json({ success: true, message: 'تم تعيين السعر المخصص', data: row });
}));
exports.router.delete('/custom-prices/:id', (0, utils_1.asyncWrapper)(async (req, res) => {
    const id = Number(req.params.id);
    const row = await teacherCustomPricing_1.TeacherCustomPricingService.deactivate(id, req.user.id);
    res.json({ success: true, message: 'تم إلغاء السعر المخصص', data: row });
}));
// Subscriptions
exports.router.get('/subscriptions/outstanding-balances', (0, utils_1.asyncWrapper)(async (req, res) => {
    const data = await teacherPlatformSubscriptions_1.TeacherPlatformSubscriptionsService.listOutstandingBalances({
        teacher_id: req.query.teacher_id ? Number(req.query.teacher_id) : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
        offset: req.query.offset ? Number(req.query.offset) : undefined,
    });
    res.json({ success: true, data });
}));
exports.router.get('/subscriptions/expiring-soon', (0, utils_1.asyncWrapper)(async (req, res) => {
    const days = req.query.days ? Number(req.query.days) : undefined;
    const data = await teacherPlatformSubscriptions_1.TeacherPlatformSubscriptionsService.listExpiringSoon(days, {
        limit: req.query.limit ? Number(req.query.limit) : undefined,
        offset: req.query.offset ? Number(req.query.offset) : undefined,
    });
    res.json({ success: true, data });
}));
exports.router.get('/subscriptions', (0, utils_1.asyncWrapper)(async (req, res) => {
    const data = await teacherPlatformSubscriptions_1.TeacherPlatformSubscriptionsService.list({
        status: req.query.status,
        teacher_id: req.query.teacher_id ? Number(req.query.teacher_id) : undefined,
        plan_id: req.query.plan_id ? Number(req.query.plan_id) : undefined,
        search: req.query.search,
        payment_status: req.query.payment_status,
        has_remaining: req.query.has_remaining === 'true'
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
}));
exports.router.get('/subscriptions/:id', (0, utils_1.asyncWrapper)(async (req, res) => {
    const sub = await teacherPlatformSubscriptions_1.TeacherPlatformSubscriptionsService.getById(Number(req.params.id));
    if (!sub)
        throw new utils_1.HttpError(404, 'الاشتراك غير موجود');
    res.json({ success: true, data: sub });
}));
exports.router.post('/subscriptions', (0, validateReq_1.validate)(CreateSubscriptionSchema), (0, utils_1.asyncWrapper)(async (req, res) => {
    const sub = await teacherPlatformSubscriptions_1.TeacherPlatformSubscriptionsService.create(req.body, req.user.id);
    res.status(201).json({ success: true, message: 'تم إنشاء الاشتراك', data: sub });
}));
exports.router.patch('/subscriptions/:id/status', (0, validateReq_1.validate)(UpdateSubscriptionStatusSchema), (0, utils_1.asyncWrapper)(async (req, res) => {
    const sub = await teacherPlatformSubscriptions_1.TeacherPlatformSubscriptionsService.updateStatus(Number(req.params.id), req.body.status, req.user.id, req.body.notes);
    res.json({ success: true, message: 'تم تحديث حالة الاشتراك', data: sub });
}));
exports.router.post('/subscriptions/:id/payments', (0, validateReq_1.validate)(RecordSubscriptionPaymentSchema), (0, utils_1.asyncWrapper)(async (req, res) => {
    const sub = await teacherPlatformSubscriptions_1.TeacherPlatformSubscriptionsService.recordPayment(Number(req.params.id), req.body, req.user.id);
    res.json({ success: true, message: 'تم تسجيل الدفعة', data: sub });
}));
exports.router.get('/subscriptions/:id/upgrade-quote', (0, utils_1.asyncWrapper)(async (req, res) => {
    const subscriptionId = Number(req.params.id);
    const planId = Number(req.query.plan_id);
    if (!subscriptionId || !planId) {
        throw new utils_1.HttpError(400, 'subscription id و plan_id مطلوبان');
    }
    const actualPrice = req.query.actual_price
        ? Number(req.query.actual_price)
        : undefined;
    const quote = await teacherPlatformSubscriptions_1.TeacherPlatformSubscriptionsService.getUpgradeQuote(subscriptionId, planId, actualPrice);
    res.json({ success: true, data: quote });
}));
exports.router.post('/subscriptions/:id/upgrade', (0, validateReq_1.validate)(UpgradeSubscriptionSchema), (0, utils_1.asyncWrapper)(async (req, res) => {
    const sub = await teacherPlatformSubscriptions_1.TeacherPlatformSubscriptionsService.upgrade(Number(req.params.id), req.body, req.user.id);
    res.json({ success: true, message: 'تم ترقية الباقة', data: sub });
}));
exports.router.post('/subscriptions/:id/renew', (0, validateReq_1.validate)(RenewSubscriptionSchema), (0, utils_1.asyncWrapper)(async (req, res) => {
    const sub = await teacherPlatformSubscriptions_1.TeacherPlatformSubscriptionsService.renew(Number(req.params.id), req.body, req.user.id);
    res.json({ success: true, message: 'تم تجديد الاشتراك', data: sub });
}));
// Invoices (فواتير اشتراكات المدرسين)
exports.router.get('/invoices', (0, utils_1.asyncWrapper)(async (req, res) => {
    const data = await teacherSubscriptionInvoices_1.TeacherSubscriptionInvoicesService.list({
        teacher_id: req.query.teacher_id ? Number(req.query.teacher_id) : undefined,
        subscription_id: req.query.subscription_id
            ? Number(req.query.subscription_id)
            : undefined,
        invoice_type: req.query.invoice_type,
        status: req.query.status,
        search: req.query.search,
        start_date: req.query.start_date,
        end_date: req.query.end_date,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
        offset: req.query.offset ? Number(req.query.offset) : undefined,
    });
    res.json({ success: true, data });
}));
exports.router.get('/invoices/:id', (0, utils_1.asyncWrapper)(async (req, res) => {
    const invoice = await teacherSubscriptionInvoices_1.TeacherSubscriptionInvoicesService.getById(Number(req.params.id));
    if (!invoice)
        throw new utils_1.HttpError(404, 'الفاتورة غير موجودة');
    res.json({ success: true, data: invoice });
}));
// Expenses (enhanced with audit)
exports.router.post('/expenses', (0, validateReq_1.validate)(ExpenseSchema), (0, utils_1.asyncWrapper)(async (req, res) => {
    const expense = await financialDashboard_1.FinancialDashboardService.addExpenseWithAudit(req.body, req.user.id);
    res.status(201).json({ success: true, message: 'تم إضافة المصروف', data: expense });
}));
exports.router.put('/expenses/:id', (0, validateReq_1.validate)(ExpenseSchema.partial()), (0, utils_1.asyncWrapper)(async (req, res) => {
    const expense = await financialDashboard_1.FinancialDashboardService.updateExpenseWithAudit(Number(req.params.id), req.body, req.user.id);
    res.json({ success: true, message: 'تم تحديث المصروف', data: expense });
}));
exports.router.delete('/expenses/:id', (0, utils_1.asyncWrapper)(async (req, res) => {
    const expense = await financialDashboard_1.FinancialDashboardService.deleteExpenseWithAudit(Number(req.params.id), req.user.id);
    res.json({ success: true, message: 'تم حذف المصروف', data: expense });
}));
// Income (legacy compatible + list)
exports.router.get('/income', (0, utils_1.asyncWrapper)(async (req, res) => {
    const income = await accounting_1.AccountingService.getIncome({
        start_date: req.query.start_date,
        end_date: req.query.end_date,
        source_type: req.query.source_type,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
        offset: req.query.offset ? Number(req.query.offset) : undefined,
    });
    res.json({ success: true, data: income });
}));
exports.router.get('/expenses/list', (0, utils_1.asyncWrapper)(async (req, res) => {
    const expenses = await accounting_1.AccountingService.getExpenses({
        start_date: req.query.start_date,
        end_date: req.query.end_date,
        category: req.query.category,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
        offset: req.query.offset ? Number(req.query.offset) : undefined,
    });
    res.json({ success: true, data: expenses });
}));
// Reports
exports.router.get('/reports/revenue', (0, utils_1.asyncWrapper)(async (req, res) => {
    const data = await financialDashboard_1.FinancialDashboardService.reportRevenue({
        start_date: req.query.start_date,
        end_date: req.query.end_date,
        plan_code: req.query.plan_code,
        teacher_id: req.query.teacher_id ? Number(req.query.teacher_id) : undefined,
        group_by: req.query.group_by || 'plan',
    });
    res.json({ success: true, data });
}));
exports.router.get('/reports/expenses', (0, utils_1.asyncWrapper)(async (req, res) => {
    const data = await financialDashboard_1.FinancialDashboardService.reportExpenses({
        start_date: req.query.start_date,
        end_date: req.query.end_date,
        category: req.query.category,
    });
    res.json({ success: true, data });
}));
exports.router.get('/reports/profit', (0, utils_1.asyncWrapper)(async (req, res) => {
    const data = await financialDashboard_1.FinancialDashboardService.reportProfit(req.query.period);
    res.json({ success: true, data });
}));
exports.router.get('/reports/subscriptions', (0, utils_1.asyncWrapper)(async (req, res) => {
    const data = await financialDashboard_1.FinancialDashboardService.reportSubscriptions({
        status: req.query.status,
        expiring_within_days: req.query.expiring_within_days
            ? Number(req.query.expiring_within_days)
            : undefined,
    });
    res.json({ success: true, data });
}));
// Audit logs
exports.router.get('/audit-logs', (0, utils_1.asyncWrapper)(async (req, res) => {
    const data = await financialAudit_1.FinancialAuditService.list({
        entity_type: req.query.entity_type,
        entity_id: req.query.entity_id ? Number(req.query.entity_id) : undefined,
        action: req.query.action,
        actor_id: req.query.actor_id ? Number(req.query.actor_id) : undefined,
        start_date: req.query.start_date,
        end_date: req.query.end_date,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
        offset: req.query.offset ? Number(req.query.offset) : undefined,
    });
    res.json({ success: true, data });
}));
