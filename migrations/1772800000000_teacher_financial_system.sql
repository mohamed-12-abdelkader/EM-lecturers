-- Up Migration
-- Teacher subscription billing & platform financial management

-- ============================================
-- 1. باقات اشتراك المدرسين (كتالوج)
-- ============================================
CREATE TABLE IF NOT EXISTS teacher_subscription_plans (
  id SERIAL PRIMARY KEY,
  code VARCHAR(20) NOT NULL UNIQUE,
  name_ar TEXT NOT NULL,
  name_en TEXT,
  description TEXT,
  default_price DECIMAL(12, 2) NOT NULL DEFAULT 0,
  duration_days INTEGER NOT NULL DEFAULT 30,
  features JSONB NOT NULL DEFAULT '[]'::JSONB,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT teacher_subscription_plans_code_check CHECK (
    code IN ('bronze', 'silver', 'gold', 'diamond')
  )
);

INSERT INTO teacher_subscription_plans (code, name_ar, name_en, default_price, duration_days, features, sort_order)
VALUES
  ('bronze', 'الباقة الأساسية', 'Basic', 500, 30, '["بدون بث مباشر"]'::JSONB, 1),
  ('silver', 'الباقة الاحترافية', 'Professional', 1000, 30, '["4 بثوث مباشرة شهرياً"]'::JSONB, 2),
  ('gold', 'الباقة المتقدمة', 'Premium', 1500, 30, '["8 بثوث مباشرة شهرياً"]'::JSONB, 3),
  ('diamond', 'الباقة الماسية', 'Diamond', 2500, 30, '["بث مباشر غير محدود"]'::JSONB, 4)
ON CONFLICT (code) DO NOTHING;

-- ============================================
-- 2. أسعار مخصصة لكل مدرس
-- ============================================
CREATE TABLE IF NOT EXISTS teacher_custom_prices (
  id SERIAL PRIMARY KEY,
  teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id INTEGER NOT NULL REFERENCES teacher_subscription_plans(id) ON DELETE CASCADE,
  custom_price DECIMAL(12, 2) NOT NULL,
  discount_reason TEXT,
  valid_from DATE,
  valid_until DATE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_teacher_custom_prices_teacher_plan
  ON teacher_custom_prices (teacher_id, plan_id, is_active);

-- ============================================
-- 3. اشتراكات المدرسين
-- ============================================
CREATE TABLE IF NOT EXISTS teacher_platform_subscriptions (
  id SERIAL PRIMARY KEY,
  subscription_number VARCHAR(32) NOT NULL UNIQUE,
  teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id INTEGER NOT NULL REFERENCES teacher_subscription_plans(id),
  actual_price DECIMAL(12, 2) NOT NULL,
  custom_price_id INTEGER REFERENCES teacher_custom_prices(id) ON DELETE SET NULL,
  starts_at DATE NOT NULL,
  ends_at DATE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  payment_method VARCHAR(50),
  notes TEXT,
  income_id INTEGER REFERENCES platform_income(id) ON DELETE SET NULL,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT teacher_platform_subscriptions_status_check CHECK (
    status IN ('active', 'expired', 'suspended', 'cancelled')
  )
);

CREATE INDEX IF NOT EXISTS idx_teacher_platform_subscriptions_teacher
  ON teacher_platform_subscriptions (teacher_id, status);
CREATE INDEX IF NOT EXISTS idx_teacher_platform_subscriptions_ends_at
  ON teacher_platform_subscriptions (ends_at, status);

-- ============================================
-- 4. تجديدات الاشتراك
-- ============================================
CREATE TABLE IF NOT EXISTS teacher_subscription_renewals (
  id SERIAL PRIMARY KEY,
  subscription_id INTEGER NOT NULL REFERENCES teacher_platform_subscriptions(id) ON DELETE CASCADE,
  plan_id INTEGER NOT NULL REFERENCES teacher_subscription_plans(id),
  actual_price DECIMAL(12, 2) NOT NULL,
  custom_price_id INTEGER REFERENCES teacher_custom_prices(id) ON DELETE SET NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  payment_method VARCHAR(50),
  notes TEXT,
  income_id INTEGER REFERENCES platform_income(id) ON DELETE SET NULL,
  renewed_by INTEGER NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_teacher_subscription_renewals_subscription
  ON teacher_subscription_renewals (subscription_id, created_at DESC);

-- ============================================
-- 5. سجل العمليات المالية الموحد
-- ============================================
CREATE TABLE IF NOT EXISTS platform_financial_transactions (
  id SERIAL PRIMARY KEY,
  transaction_kind VARCHAR(30) NOT NULL,
  reference_table VARCHAR(60) NOT NULL,
  reference_id INTEGER NOT NULL,
  amount DECIMAL(12, 2) NOT NULL,
  direction VARCHAR(10) NOT NULL,
  teacher_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  plan_code VARCHAR(20),
  category VARCHAR(50),
  transaction_date DATE NOT NULL,
  description TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT platform_financial_transactions_direction_check CHECK (direction IN ('in', 'out'))
);

CREATE INDEX IF NOT EXISTS idx_platform_financial_transactions_date
  ON platform_financial_transactions (transaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_platform_financial_transactions_kind
  ON platform_financial_transactions (transaction_kind, reference_id);

-- ============================================
-- 6. سجل التدقيق المالي
-- ============================================
CREATE TABLE IF NOT EXISTS platform_financial_audit_logs (
  id SERIAL PRIMARY KEY,
  entity_type VARCHAR(60) NOT NULL,
  entity_id INTEGER,
  action VARCHAR(30) NOT NULL,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  before_data JSONB,
  after_data JSONB,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_platform_financial_audit_logs_entity
  ON platform_financial_audit_logs (entity_type, entity_id, created_at DESC);

-- Down Migration
DROP TABLE IF EXISTS platform_financial_audit_logs;
DROP TABLE IF EXISTS platform_financial_transactions;
DROP TABLE IF EXISTS teacher_subscription_renewals;
DROP TABLE IF EXISTS teacher_platform_subscriptions;
DROP TABLE IF EXISTS teacher_custom_prices;
DROP TABLE IF EXISTS teacher_subscription_plans;
