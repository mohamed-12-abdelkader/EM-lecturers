-- Up Migration
-- دفع جزئي لاشتراكات المدرسين + سجل الدفعات

ALTER TABLE teacher_platform_subscriptions
  ADD COLUMN IF NOT EXISTS paid_amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS remaining_amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_status VARCHAR(20) NOT NULL DEFAULT 'paid';

UPDATE teacher_platform_subscriptions
SET paid_amount = actual_price,
    remaining_amount = 0,
    payment_status = 'paid';

ALTER TABLE teacher_platform_subscriptions
  DROP CONSTRAINT IF EXISTS teacher_platform_subscriptions_payment_status_check;

ALTER TABLE teacher_platform_subscriptions
  ADD CONSTRAINT teacher_platform_subscriptions_payment_status_check CHECK (
    payment_status IN ('paid', 'partial', 'unpaid')
  );

CREATE INDEX IF NOT EXISTS idx_teacher_platform_subscriptions_payment_status
  ON teacher_platform_subscriptions (payment_status, remaining_amount DESC)
  WHERE remaining_amount > 0;

ALTER TABLE teacher_subscription_renewals
  ADD COLUMN IF NOT EXISTS paid_amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS remaining_amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_status VARCHAR(20) NOT NULL DEFAULT 'paid';

UPDATE teacher_subscription_renewals
SET paid_amount = actual_price,
    remaining_amount = 0,
    payment_status = 'paid';

ALTER TABLE teacher_subscription_renewals
  DROP CONSTRAINT IF EXISTS teacher_subscription_renewals_payment_status_check;

ALTER TABLE teacher_subscription_renewals
  ADD CONSTRAINT teacher_subscription_renewals_payment_status_check CHECK (
    payment_status IN ('paid', 'partial', 'unpaid')
  );

ALTER TABLE teacher_subscription_invoices
  ADD COLUMN IF NOT EXISTS paid_amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS remaining_amount DECIMAL(12, 2) NOT NULL DEFAULT 0;

UPDATE teacher_subscription_invoices
SET paid_amount = amount,
    remaining_amount = 0;

ALTER TABLE teacher_subscription_invoices
  DROP CONSTRAINT IF EXISTS teacher_subscription_invoices_status_check;

ALTER TABLE teacher_subscription_invoices
  ADD CONSTRAINT teacher_subscription_invoices_status_check CHECK (
    status IN ('paid', 'partial', 'unpaid', 'cancelled')
  );

CREATE TABLE IF NOT EXISTS teacher_subscription_payments (
  id SERIAL PRIMARY KEY,
  subscription_id INTEGER NOT NULL REFERENCES teacher_platform_subscriptions(id) ON DELETE CASCADE,
  teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  renewal_id INTEGER REFERENCES teacher_subscription_renewals(id) ON DELETE SET NULL,
  amount DECIMAL(12, 2) NOT NULL,
  payment_method VARCHAR(50),
  notes TEXT,
  income_id INTEGER REFERENCES platform_income(id) ON DELETE SET NULL,
  payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT teacher_subscription_payments_amount_check CHECK (amount > 0)
);

CREATE INDEX IF NOT EXISTS idx_teacher_subscription_payments_subscription
  ON teacher_subscription_payments (subscription_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_teacher_subscription_payments_teacher
  ON teacher_subscription_payments (teacher_id, created_at DESC);

-- Down Migration
DROP TABLE IF EXISTS teacher_subscription_payments;

ALTER TABLE teacher_subscription_invoices
  DROP CONSTRAINT IF EXISTS teacher_subscription_invoices_status_check;

ALTER TABLE teacher_subscription_invoices
  ADD CONSTRAINT teacher_subscription_invoices_status_check CHECK (
    status IN ('paid', 'cancelled')
  );

ALTER TABLE teacher_subscription_invoices
  DROP COLUMN IF EXISTS paid_amount,
  DROP COLUMN IF EXISTS remaining_amount;

ALTER TABLE teacher_subscription_renewals
  DROP CONSTRAINT IF EXISTS teacher_subscription_renewals_payment_status_check;

ALTER TABLE teacher_subscription_renewals
  DROP COLUMN IF EXISTS paid_amount,
  DROP COLUMN IF EXISTS remaining_amount,
  DROP COLUMN IF EXISTS payment_status;

ALTER TABLE teacher_platform_subscriptions
  DROP CONSTRAINT IF EXISTS teacher_platform_subscriptions_payment_status_check;

ALTER TABLE teacher_platform_subscriptions
  DROP COLUMN IF EXISTS paid_amount,
  DROP COLUMN IF EXISTS remaining_amount,
  DROP COLUMN IF EXISTS payment_status;

DROP INDEX IF EXISTS idx_teacher_platform_subscriptions_payment_status;
