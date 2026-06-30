import pool from '../db/pool';

export interface IncomeData {
  title: string;
  description?: string;
  amount: number;
  source_type: 'course_payment' | 'subscription' | 'other';
  source_id?: number;
  payment_method?: 'cash' | 'bank_transfer' | 'online_payment';
  transaction_date: string;
}

export interface ExpenseData {
  title: string;
  description?: string;
  amount: number;
  category: 'hosting' | 'marketing' | 'salaries' | 'maintenance' | 'other';
  expense_type: 'monthly' | 'one_time' | 'recurring';
  payment_method?: 'cash' | 'bank_transfer' | 'check';
  transaction_date: string;
}

export interface BudgetData {
  month_year: string; // '2024-01'
  planned_income?: number;
  planned_expenses?: number;
  notes?: string;
}

export class AccountingService {
  // إضافة مدخول جديد
  static async addIncome(incomeData: IncomeData, createdBy: number) {
    const result = await pool.query(
      `INSERT INTO platform_income 
       (title, description, amount, source_type, source_id, payment_method, transaction_date, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        incomeData.title,
        incomeData.description,
        incomeData.amount,
        incomeData.source_type,
        incomeData.source_id,
        incomeData.payment_method,
        incomeData.transaction_date,
        createdBy,
      ],
    );
    return result.rows[0];
  }

  static async addIncomeWithClient(
    client: import('pg').PoolClient,
    incomeData: IncomeData,
    createdBy: number,
  ) {
    const result = await client.query(
      `INSERT INTO platform_income 
       (title, description, amount, source_type, source_id, payment_method, transaction_date, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        incomeData.title,
        incomeData.description,
        incomeData.amount,
        incomeData.source_type,
        incomeData.source_id,
        incomeData.payment_method,
        incomeData.transaction_date,
        createdBy,
      ],
    );
    return result.rows[0];
  }

  // إضافة مصروف جديد
  static async addExpense(expenseData: ExpenseData, createdBy: number) {
    const result = await pool.query(
      `INSERT INTO platform_expenses 
       (title, description, amount, category, expense_type, payment_method, transaction_date, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        expenseData.title,
        expenseData.description,
        expenseData.amount,
        expenseData.category,
        expenseData.expense_type,
        expenseData.payment_method,
        expenseData.transaction_date,
        createdBy,
      ],
    );
    return result.rows[0];
  }

  // جلب المدخلات مع فلترة
  static async getIncome(
    filters: {
      start_date?: string;
      end_date?: string;
      source_type?: string;
      limit?: number;
      offset?: number;
    } = {},
  ) {
    const { start_date, end_date, source_type, limit = 50, offset = 0 } = filters;

    let whereClause = '';
    const values: any[] = [];
    let counter = 1;

    if (start_date) {
      whereClause += `transaction_date >= $${counter++}`;
      values.push(start_date);
    }
    if (end_date) {
      whereClause += whereClause ? ' AND ' : '';
      whereClause += `transaction_date <= $${counter++}`;
      values.push(end_date);
    }
    if (source_type) {
      whereClause += whereClause ? ' AND ' : '';
      whereClause += `source_type = $${counter++}`;
      values.push(source_type);
    }

    const whereSQL = whereClause ? `WHERE ${whereClause}` : '';
    values.push(limit, offset);

    const result = await pool.query(
      `SELECT pi.*, u.name as created_by_name
       FROM platform_income pi
       LEFT JOIN users u ON pi.created_by = u.id
       ${whereSQL}
       ORDER BY pi.transaction_date DESC, pi.created_at DESC
       LIMIT $${counter++} OFFSET $${counter++}`,
      values,
    );
    return result.rows;
  }

  // جلب المصروفات مع فلترة
  static async getExpenses(
    filters: {
      start_date?: string;
      end_date?: string;
      category?: string;
      limit?: number;
      offset?: number;
    } = {},
  ) {
    const { start_date, end_date, category, limit = 50, offset = 0 } = filters;

    let whereClause = '';
    const values: any[] = [];
    let counter = 1;

    if (start_date) {
      whereClause += `transaction_date >= $${counter++}`;
      values.push(start_date);
    }
    if (end_date) {
      whereClause += whereClause ? ' AND ' : '';
      whereClause += `transaction_date <= $${counter++}`;
      values.push(end_date);
    }
    if (category) {
      whereClause += whereClause ? ' AND ' : '';
      whereClause += `category = $${counter++}`;
      values.push(category);
    }

    const whereSQL = whereClause ? `WHERE ${whereClause}` : '';
    values.push(limit, offset);

    const result = await pool.query(
      `SELECT pe.*, u.name as created_by_name
       FROM platform_expenses pe
       LEFT JOIN users u ON pe.created_by = u.id
       ${whereSQL}
       ORDER BY pe.transaction_date DESC, pe.created_at DESC
       LIMIT $${counter++} OFFSET $${counter++}`,
      values,
    );
    return result.rows;
  }

  // جلب إحصائيات مالية
  static async getFinancialStats(
    filters: {
      start_date?: string;
      end_date?: string;
    } = {},
  ) {
    const { start_date, end_date } = filters;

    let whereClause = '';
    const values: any[] = [];
    let counter = 1;

    if (start_date) {
      whereClause += `transaction_date >= $${counter++}`;
      values.push(start_date);
    }
    if (end_date) {
      whereClause += whereClause ? ' AND ' : '';
      whereClause += `transaction_date <= $${counter++}`;
      values.push(end_date);
    }

    const whereSQL = whereClause ? `WHERE ${whereClause}` : '';

    // إجمالي المدخلات
    const incomeResult = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) as total_income
       FROM platform_income
       ${whereSQL}`,
      values,
    );

    // إجمالي المصروفات
    const expenseResult = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) as total_expenses
       FROM platform_expenses
       ${whereSQL}`,
      values,
    );

    // المدخلات حسب المصدر
    const incomeBySource = await pool.query(
      `SELECT source_type, COALESCE(SUM(amount), 0) as total
       FROM platform_income
       ${whereSQL}
       GROUP BY source_type
       ORDER BY total DESC`,
      values,
    );

    // المصروفات حسب الفئة
    const expensesByCategory = await pool.query(
      `SELECT category, COALESCE(SUM(amount), 0) as total
       FROM platform_expenses
       ${whereSQL}
       GROUP BY category
       ORDER BY total DESC`,
      values,
    );

    const totalIncome = parseFloat(incomeResult.rows[0].total_income);
    const totalExpenses = parseFloat(expenseResult.rows[0].total_expenses);

    return {
      total_income: totalIncome,
      total_expenses: totalExpenses,
      net_profit: totalIncome - totalExpenses,
      profit_margin: totalIncome > 0 ? ((totalIncome - totalExpenses) / totalIncome) * 100 : 0,
      income_by_source: incomeBySource.rows,
      expenses_by_category: expensesByCategory.rows,
    };
  }

  // إنشاء أو تحديث ميزانية شهرية
  static async setMonthlyBudget(budgetData: BudgetData, createdBy: number) {
    const result = await pool.query(
      `INSERT INTO monthly_budget 
       (month_year, planned_income, planned_expenses, notes, created_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (month_year) 
       DO UPDATE SET 
         planned_income = EXCLUDED.planned_income,
         planned_expenses = EXCLUDED.planned_expenses,
         notes = EXCLUDED.notes,
         updated_at = NOW()
       RETURNING *`,
      [
        budgetData.month_year,
        budgetData.planned_income || 0,
        budgetData.planned_expenses || 0,
        budgetData.notes,
        createdBy,
      ],
    );
    return result.rows[0];
  }

  // جلب الميزانية الشهرية
  static async getMonthlyBudget(monthYear: string) {
    const result = await pool.query(`SELECT * FROM monthly_budget WHERE month_year = $1`, [
      monthYear,
    ]);
    return result.rows[0];
  }

  // تحديث الميزانية الفعلية
  static async updateActualBudget(monthYear: string) {
    // حساب المدخلات الفعلية للشهر
    const incomeResult = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) as actual_income
       FROM platform_income 
       WHERE DATE_TRUNC('month', transaction_date) = DATE_TRUNC('month', $1::date)`,
      [monthYear + '-01'],
    );

    // حساب المصروفات الفعلية للشهر
    const expenseResult = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) as actual_expenses
       FROM platform_expenses 
       WHERE DATE_TRUNC('month', transaction_date) = DATE_TRUNC('month', $1::date)`,
      [monthYear + '-01'],
    );

    // تحديث الميزانية
    const result = await pool.query(
      `UPDATE monthly_budget 
       SET actual_income = $1, actual_expenses = $2, updated_at = NOW()
       WHERE month_year = $3
       RETURNING *`,
      [
        parseFloat(incomeResult.rows[0].actual_income),
        parseFloat(expenseResult.rows[0].actual_expenses),
        monthYear,
      ],
    );
    return result.rows[0];
  }

  // حذف مدخول
  static async deleteIncome(incomeId: number) {
    const result = await pool.query('DELETE FROM platform_income WHERE id = $1 RETURNING *', [
      incomeId,
    ]);
    return result.rows[0];
  }

  // حذف مصروف
  static async deleteExpense(expenseId: number) {
    const result = await pool.query('DELETE FROM platform_expenses WHERE id = $1 RETURNING *', [
      expenseId,
    ]);
    return result.rows[0];
  }
}
