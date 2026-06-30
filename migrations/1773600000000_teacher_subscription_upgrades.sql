-- Up Migration
-- ترقية باقة المدرس خلال فترة الاشتراك + دفع فرق السعر

CREATE TABLE IF NOT EXISTS teacher_subscription_upgrades (
  id SERIAL PRIMARY KEY,
  subscription_id INTEGER NOT NULL REFERENCES teacher_platform_subscriptions(id) ON DELETE CASCADE,
  from_plan_id INTEGER NOT NULL REFERENCES teacher_subscription_plans(id),
  to_plan_id INTEGER NOT NULL REFERENCES teacher_subscription_plans(id),
  old_actual_price DECIMAL(12, 2) NOT NULL,
  new_actual_price DECIMAL(12, 2) NOT NULL,
  upgrade_amount DECIMAL(12, 2) NOT NULL,
  paid_amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
  remaining_amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
  payment_status VARCHAR(20) NOT NULL DEFAULT 'paid',
  payment_method VARCHAR(50),
  notes TEXT,
  income_id INTEGER REFERENCES platform_income(id) ON DELETE SET NULL,
  upgraded_by INTEGER NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT teacher_subscription_upgrades_payment_status_check CHECK (
    payment_status IN ('paid', 'partial', 'unpaid')
  ),
  CONSTRAINT teacher_subscription_upgrades_amount_check CHECK (upgrade_amount > 0)
);

CREATE INDEX IF NOT EXISTS idx_teacher_subscription_upgrades_subscription
  ON teacher_subscription_upgrades (subscription_id, created_at DESC);

ALTER TABLE teacher_subscription_invoices
  ADD COLUMN IF NOT EXISTS upgrade_id INTEGER REFERENCES teacher_subscription_upgrades(id) ON DELETE SET NULL;

ALTER TABLE teacher_subscription_payments
  ADD COLUMN IF NOT EXISTS upgrade_id INTEGER REFERENCES teacher_subscription_upgrades(id) ON DELETE SET NULL;

ALTER TABLE teacher_subscription_invoices
  DROP CONSTRAINT IF EXISTS teacher_subscription_invoices_type_check;

ALTER TABLE teacher_subscription_invoices
  ADD CONSTRAINT teacher_subscription_invoices_type_check CHECK (
    invoice_type IN ('subscription', 'renewal', 'upgrade')
  );

-- Down Migration
ALTER TABLE teacher_subscription_payments DROP COLUMN IF EXISTS upgrade_id;
ALTER TABLE teacher_subscription_invoices DROP COLUMN IF EXISTS upgrade_id;

ALTER TABLE teacher_subscription_invoices
  DROP CONSTRAINT IF EXISTS teacher_subscription_invoices_type_check;

ALTER TABLE teacher_subscription_invoices
  ADD CONSTRAINT teacher_subscription_invoices_type_check CHECK (
    invoice_type IN ('subscription', 'renewal')
  );

DROP TABLE IF EXISTS teacher_subscription_upgrades;
