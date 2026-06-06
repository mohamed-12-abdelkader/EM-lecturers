-- نظام المحاسبة البسيط للمنصة

-- جدول المدخلات (الإيرادات)
CREATE TABLE IF NOT EXISTS platform_income (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    amount DECIMAL(10,2) NOT NULL,
    source_type VARCHAR(50) NOT NULL, -- 'course_payment', 'subscription', 'other'
    source_id INTEGER, -- ID للكورس أو الاشتراك أو غيره
    payment_method VARCHAR(50), -- 'cash', 'bank_transfer', 'online_payment'
    transaction_date DATE NOT NULL,
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- جدول المصروفات
CREATE TABLE IF NOT EXISTS platform_expenses (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    amount DECIMAL(10,2) NOT NULL,
    category VARCHAR(50) NOT NULL, -- 'hosting', 'marketing', 'salaries', 'maintenance', 'other'
    expense_type VARCHAR(50) NOT NULL, -- 'monthly', 'one_time', 'recurring'
    payment_method VARCHAR(50), -- 'cash', 'bank_transfer', 'check'
    transaction_date DATE NOT NULL,
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- جدول الميزانية الشهرية
CREATE TABLE IF NOT EXISTS monthly_budget (
    id SERIAL PRIMARY KEY,
    month_year VARCHAR(7) NOT NULL, -- '2024-01'
    planned_income DECIMAL(10,2) DEFAULT 0,
    planned_expenses DECIMAL(10,2) DEFAULT 0,
    actual_income DECIMAL(10,2) DEFAULT 0,
    actual_expenses DECIMAL(10,2) DEFAULT 0,
    notes TEXT,
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(month_year)
);

-- إنشاء indexes لتحسين الأداء (إذا لم تكن موجودة)
CREATE INDEX IF NOT EXISTS idx_platform_income_date ON platform_income(transaction_date);
CREATE INDEX IF NOT EXISTS idx_platform_income_source ON platform_income(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_platform_expenses_date ON platform_expenses(transaction_date);
CREATE INDEX IF NOT EXISTS idx_platform_expenses_category ON platform_expenses(category);
CREATE INDEX IF NOT EXISTS idx_monthly_budget_month ON monthly_budget(month_year); 