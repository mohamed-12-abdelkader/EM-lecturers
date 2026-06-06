"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const express_1 = require("express");
const authentication_1 = require("../middleware/authentication");
const permissions_1 = require("../middleware/permissions");
const accounting_1 = require("../services/accounting");
const utils_1 = require("../utils");
const router = (0, express_1.Router)();
exports.router = router;
const ACCOUNTING_PERMISSIONS = [
    'can_manage_accounting',
    'manage_accounting',
    'accounting_management',
    'financial_management',
];
const adminOrAccountingManager = async (req, res, next) => {
    try {
        const user = req.user;
        if (!user) {
            return res.status(401).json({ success: false, message: 'غير مصرح' });
        }
        if (user.role === 'admin') {
            return next();
        }
        if (user.role === 'employee') {
            const hasPermission = await (0, permissions_1.employeeHasAnyPermission)(user.id, ACCOUNTING_PERMISSIONS);
            if (hasPermission) {
                return next();
            }
        }
        return res.status(403).json({
            success: false,
            message: 'لا تملك صلاحية إدارة الحسابات',
        });
    }
    catch (error) {
        utils_1.logger.error('Accounting permission check failed:', error);
        return res.status(500).json({
            success: false,
            message: 'خطأ أثناء التحقق من صلاحيات الحسابات',
        });
    }
};
// إضافة مدخول جديد
router.post('/income', (0, authentication_1.authMiddleware)(['admin', 'employee']), adminOrAccountingManager, async (req, res) => {
    try {
        const { title, description, amount, source_type, source_id, payment_method, transaction_date } = req.body;
        const createdBy = req.user.id;
        if (!title || !amount || !source_type || !transaction_date) {
            return res.status(400).json({
                error: 'العنوان والمبلغ ونوع المصدر والتاريخ مطلوبة',
            });
        }
        const incomeData = {
            title,
            description,
            amount: parseFloat(amount),
            source_type,
            source_id: source_id ? parseInt(source_id) : undefined,
            payment_method,
            transaction_date,
        };
        const income = await accounting_1.AccountingService.addIncome(incomeData, createdBy);
        res.status(201).json({
            message: 'تم إضافة المدخول بنجاح',
            income,
        });
    }
    catch (error) {
        utils_1.logger.error('Error adding income:', error);
        res.status(500).json({
            error: 'خطأ في إضافة المدخول',
            details: error instanceof Error ? error.message : 'Unknown error',
        });
    }
});
// إضافة مصروف جديد
router.post('/expenses', (0, authentication_1.authMiddleware)(['admin', 'employee']), adminOrAccountingManager, async (req, res) => {
    try {
        const { title, description, amount, category, expense_type, payment_method, transaction_date } = req.body;
        const createdBy = req.user.id;
        if (!title || !amount || !category || !expense_type || !transaction_date) {
            return res.status(400).json({
                error: 'العنوان والمبلغ والفئة ونوع المصروف والتاريخ مطلوبة',
            });
        }
        const expenseData = {
            title,
            description,
            amount: parseFloat(amount),
            category,
            expense_type,
            payment_method,
            transaction_date,
        };
        const expense = await accounting_1.AccountingService.addExpense(expenseData, createdBy);
        res.status(201).json({
            message: 'تم إضافة المصروف بنجاح',
            expense,
        });
    }
    catch (error) {
        utils_1.logger.error('Error adding expense:', error);
        res.status(500).json({
            error: 'خطأ في إضافة المصروف',
            details: error instanceof Error ? error.message : 'Unknown error',
        });
    }
});
// جلب المدخلات
router.get('/income', (0, authentication_1.authMiddleware)(['admin', 'employee']), adminOrAccountingManager, async (req, res) => {
    try {
        const { start_date, end_date, source_type, limit, offset } = req.query;
        const filters = {
            start_date: start_date,
            end_date: end_date,
            source_type: source_type,
            limit: limit ? parseInt(limit) : undefined,
            offset: offset ? parseInt(offset) : undefined,
        };
        const income = await accounting_1.AccountingService.getIncome(filters);
        res.json({ income });
    }
    catch (error) {
        utils_1.logger.error('Error fetching income:', error);
        res.status(500).json({
            error: 'خطأ في جلب المدخلات',
            details: error instanceof Error ? error.message : 'Unknown error',
        });
    }
});
// جلب المصروفات
router.get('/expenses', (0, authentication_1.authMiddleware)(['admin', 'employee']), adminOrAccountingManager, async (req, res) => {
    try {
        const { start_date, end_date, category, limit, offset } = req.query;
        const filters = {
            start_date: start_date,
            end_date: end_date,
            category: category,
            limit: limit ? parseInt(limit) : undefined,
            offset: offset ? parseInt(offset) : undefined,
        };
        const expenses = await accounting_1.AccountingService.getExpenses(filters);
        res.json({ expenses });
    }
    catch (error) {
        utils_1.logger.error('Error fetching expenses:', error);
        res.status(500).json({
            error: 'خطأ في جلب المصروفات',
            details: error instanceof Error ? error.message : 'Unknown error',
        });
    }
});
// جلب الإحصائيات المالية
router.get('/stats', (0, authentication_1.authMiddleware)(['admin', 'employee']), adminOrAccountingManager, async (req, res) => {
    try {
        const { start_date, end_date } = req.query;
        const filters = {
            start_date: start_date,
            end_date: end_date,
        };
        const stats = await accounting_1.AccountingService.getFinancialStats(filters);
        res.json({ stats });
    }
    catch (error) {
        utils_1.logger.error('Error fetching financial stats:', error);
        res.status(500).json({
            error: 'خطأ في جلب الإحصائيات المالية',
            details: error instanceof Error ? error.message : 'Unknown error',
        });
    }
});
// إنشاء أو تحديث ميزانية شهرية
router.post('/budget', (0, authentication_1.authMiddleware)(['admin', 'employee']), adminOrAccountingManager, async (req, res) => {
    try {
        const { month_year, planned_income, planned_expenses, notes } = req.body;
        const createdBy = req.user.id;
        if (!month_year) {
            return res.status(400).json({
                error: 'الشهر والسنة مطلوبة (مثال: 2024-01)',
            });
        }
        const budgetData = {
            month_year,
            planned_income: planned_income ? parseFloat(planned_income) : undefined,
            planned_expenses: planned_expenses ? parseFloat(planned_expenses) : undefined,
            notes,
        };
        const budget = await accounting_1.AccountingService.setMonthlyBudget(budgetData, createdBy);
        res.json({
            message: 'تم حفظ الميزانية بنجاح',
            budget,
        });
    }
    catch (error) {
        utils_1.logger.error('Error setting budget:', error);
        res.status(500).json({
            error: 'خطأ في حفظ الميزانية',
            details: error instanceof Error ? error.message : 'Unknown error',
        });
    }
});
// جلب ميزانية شهرية
router.get('/budget/:monthYear', (0, authentication_1.authMiddleware)(['admin', 'employee']), adminOrAccountingManager, async (req, res) => {
    try {
        const { monthYear } = req.params;
        const budget = await accounting_1.AccountingService.getMonthlyBudget(monthYear);
        if (!budget) {
            return res.status(404).json({ error: 'الميزانية غير موجودة' });
        }
        // تحديث القيم الفعلية
        const updatedBudget = await accounting_1.AccountingService.updateActualBudget(monthYear);
        res.json({ budget: updatedBudget });
    }
    catch (error) {
        utils_1.logger.error('Error fetching budget:', error);
        res.status(500).json({
            error: 'خطأ في جلب الميزانية',
            details: error instanceof Error ? error.message : 'Unknown error',
        });
    }
});
// حذف مدخول
router.delete('/income/:id', (0, authentication_1.authMiddleware)(['admin', 'employee']), adminOrAccountingManager, async (req, res) => {
    try {
        const { id } = req.params;
        const income = await accounting_1.AccountingService.deleteIncome(parseInt(id));
        if (!income) {
            return res.status(404).json({ error: 'المدخول غير موجود' });
        }
        res.json({
            message: 'تم حذف المدخول بنجاح',
            income,
        });
    }
    catch (error) {
        utils_1.logger.error('Error deleting income:', error);
        res.status(500).json({
            error: 'خطأ في حذف المدخول',
            details: error instanceof Error ? error.message : 'Unknown error',
        });
    }
});
// حذف مصروف
router.delete('/expenses/:id', (0, authentication_1.authMiddleware)(['admin', 'employee']), adminOrAccountingManager, async (req, res) => {
    try {
        const { id } = req.params;
        const expense = await accounting_1.AccountingService.deleteExpense(parseInt(id));
        if (!expense) {
            return res.status(404).json({ error: 'المصروف غير موجود' });
        }
        res.json({
            message: 'تم حذف المصروف بنجاح',
            expense,
        });
    }
    catch (error) {
        utils_1.logger.error('Error deleting expense:', error);
        res.status(500).json({
            error: 'خطأ في حذف المصروف',
            details: error instanceof Error ? error.message : 'Unknown error',
        });
    }
});
