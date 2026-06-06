import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/authentication';
import { employeeHasAnyPermission } from '../middleware/permissions';
import { AccountingService, IncomeData, ExpenseData, BudgetData } from '../services/accounting';
import { logger } from '../utils';

const router = Router();
const ACCOUNTING_PERMISSIONS = [
  'can_manage_accounting',
  'manage_accounting',
  'accounting_management',
  'financial_management',
];

const adminOrAccountingManager = async (req: Request, res: Response, next: any) => {
  try {
    const user = (req as any).user;
    if (!user) {
      return res.status(401).json({ success: false, message: 'غير مصرح' });
    }

    if (user.role === 'admin') {
      return next();
    }

    if (user.role === 'employee') {
      const hasPermission = await employeeHasAnyPermission(user.id, ACCOUNTING_PERMISSIONS);
      if (hasPermission) {
        return next();
      }
    }

    return res.status(403).json({
      success: false,
      message: 'لا تملك صلاحية إدارة الحسابات',
    });
  } catch (error) {
    logger.error('Accounting permission check failed:', error);
    return res.status(500).json({
      success: false,
      message: 'خطأ أثناء التحقق من صلاحيات الحسابات',
    });
  }
};

// إضافة مدخول جديد
router.post('/income', authMiddleware(['admin', 'employee']), adminOrAccountingManager, async (req: Request, res: Response) => {
  try {
    const { title, description, amount, source_type, source_id, payment_method, transaction_date } =
      req.body;
    const createdBy = (req as any).user.id;

    if (!title || !amount || !source_type || !transaction_date) {
      return res.status(400).json({
        error: 'العنوان والمبلغ ونوع المصدر والتاريخ مطلوبة',
      });
    }

    const incomeData: IncomeData = {
      title,
      description,
      amount: parseFloat(amount),
      source_type,
      source_id: source_id ? parseInt(source_id) : undefined,
      payment_method,
      transaction_date,
    };

    const income = await AccountingService.addIncome(incomeData, createdBy);

    res.status(201).json({
      message: 'تم إضافة المدخول بنجاح',
      income,
    });
  } catch (error) {
    logger.error('Error adding income:', error);
    res.status(500).json({
      error: 'خطأ في إضافة المدخول',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// إضافة مصروف جديد
router.post('/expenses', authMiddleware(['admin', 'employee']), adminOrAccountingManager, async (req: Request, res: Response) => {
  try {
    const { title, description, amount, category, expense_type, payment_method, transaction_date } =
      req.body;
    const createdBy = (req as any).user.id;

    if (!title || !amount || !category || !expense_type || !transaction_date) {
      return res.status(400).json({
        error: 'العنوان والمبلغ والفئة ونوع المصروف والتاريخ مطلوبة',
      });
    }

    const expenseData: ExpenseData = {
      title,
      description,
      amount: parseFloat(amount),
      category,
      expense_type,
      payment_method,
      transaction_date,
    };

    const expense = await AccountingService.addExpense(expenseData, createdBy);

    res.status(201).json({
      message: 'تم إضافة المصروف بنجاح',
      expense,
    });
  } catch (error) {
    logger.error('Error adding expense:', error);
    res.status(500).json({
      error: 'خطأ في إضافة المصروف',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// جلب المدخلات
router.get('/income', authMiddleware(['admin', 'employee']), adminOrAccountingManager, async (req: Request, res: Response) => {
  try {
    const { start_date, end_date, source_type, limit, offset } = req.query;

    const filters = {
      start_date: start_date as string,
      end_date: end_date as string,
      source_type: source_type as string,
      limit: limit ? parseInt(limit as string) : undefined,
      offset: offset ? parseInt(offset as string) : undefined,
    };

    const income = await AccountingService.getIncome(filters);

    res.json({ income });
  } catch (error) {
    logger.error('Error fetching income:', error);
    res.status(500).json({
      error: 'خطأ في جلب المدخلات',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// جلب المصروفات
router.get('/expenses', authMiddleware(['admin', 'employee']), adminOrAccountingManager, async (req: Request, res: Response) => {
  try {
    const { start_date, end_date, category, limit, offset } = req.query;

    const filters = {
      start_date: start_date as string,
      end_date: end_date as string,
      category: category as string,
      limit: limit ? parseInt(limit as string) : undefined,
      offset: offset ? parseInt(offset as string) : undefined,
    };

    const expenses = await AccountingService.getExpenses(filters);

    res.json({ expenses });
  } catch (error) {
    logger.error('Error fetching expenses:', error);
    res.status(500).json({
      error: 'خطأ في جلب المصروفات',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// جلب الإحصائيات المالية
router.get('/stats', authMiddleware(['admin', 'employee']), adminOrAccountingManager, async (req: Request, res: Response) => {
  try {
    const { start_date, end_date } = req.query;

    const filters = {
      start_date: start_date as string,
      end_date: end_date as string,
    };

    const stats = await AccountingService.getFinancialStats(filters);

    res.json({ stats });
  } catch (error) {
    logger.error('Error fetching financial stats:', error);
    res.status(500).json({
      error: 'خطأ في جلب الإحصائيات المالية',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// إنشاء أو تحديث ميزانية شهرية
router.post('/budget', authMiddleware(['admin', 'employee']), adminOrAccountingManager, async (req: Request, res: Response) => {
  try {
    const { month_year, planned_income, planned_expenses, notes } = req.body;
    const createdBy = (req as any).user.id;

    if (!month_year) {
      return res.status(400).json({
        error: 'الشهر والسنة مطلوبة (مثال: 2024-01)',
      });
    }

    const budgetData: BudgetData = {
      month_year,
      planned_income: planned_income ? parseFloat(planned_income) : undefined,
      planned_expenses: planned_expenses ? parseFloat(planned_expenses) : undefined,
      notes,
    };

    const budget = await AccountingService.setMonthlyBudget(budgetData, createdBy);

    res.json({
      message: 'تم حفظ الميزانية بنجاح',
      budget,
    });
  } catch (error) {
    logger.error('Error setting budget:', error);
    res.status(500).json({
      error: 'خطأ في حفظ الميزانية',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// جلب ميزانية شهرية
router.get('/budget/:monthYear', authMiddleware(['admin', 'employee']), adminOrAccountingManager, async (req: Request, res: Response) => {
  try {
    const { monthYear } = req.params;

    const budget = await AccountingService.getMonthlyBudget(monthYear);

    if (!budget) {
      return res.status(404).json({ error: 'الميزانية غير موجودة' });
    }

    // تحديث القيم الفعلية
    const updatedBudget = await AccountingService.updateActualBudget(monthYear);

    res.json({ budget: updatedBudget });
  } catch (error) {
    logger.error('Error fetching budget:', error);
    res.status(500).json({
      error: 'خطأ في جلب الميزانية',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// حذف مدخول
router.delete('/income/:id', authMiddleware(['admin', 'employee']), adminOrAccountingManager, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const income = await AccountingService.deleteIncome(parseInt(id));

    if (!income) {
      return res.status(404).json({ error: 'المدخول غير موجود' });
    }

    res.json({
      message: 'تم حذف المدخول بنجاح',
      income,
    });
  } catch (error) {
    logger.error('Error deleting income:', error);
    res.status(500).json({
      error: 'خطأ في حذف المدخول',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// حذف مصروف
router.delete('/expenses/:id', authMiddleware(['admin', 'employee']), adminOrAccountingManager, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const expense = await AccountingService.deleteExpense(parseInt(id));

    if (!expense) {
      return res.status(404).json({ error: 'المصروف غير موجود' });
    }

    res.json({
      message: 'تم حذف المصروف بنجاح',
      expense,
    });
  } catch (error) {
    logger.error('Error deleting expense:', error);
    res.status(500).json({
      error: 'خطأ في حذف المصروف',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export { router };
