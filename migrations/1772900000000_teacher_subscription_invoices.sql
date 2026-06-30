-- Up Migration
-- فواتير اشتراكات المدرسين (اشتراك جديد + تجديد)

CREATE TABLE IF NOT EXISTS teacher_subscription_invoices (
  id SERIAL PRIMARY KEY,
  invoice_number VARCHAR(32) NOT NULL UNIQUE,
  teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subscription_id INTEGER REFERENCES teacher_platform_subscriptions(id) ON DELETE SET NULL,
  renewal_id INTEGER REFERENCES teacher_subscription_renewals(id) ON DELETE SET NULL,
  invoice_type VARCHAR(20) NOT NULL,
  plan_id INTEGER NOT NULL REFERENCES teacher_subscription_plans(id),
  subscription_number VARCHAR(32),
  plan_code VARCHAR(20),
  plan_name_ar TEXT,
  amount DECIMAL(12, 2) NOT NULL,
  payment_method VARCHAR(50),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'paid',
  notes TEXT,
  income_id INTEGER REFERENCES platform_income(id) ON DELETE SET NULL,
  issued_at DATE NOT NULL DEFAULT CURRENT_DATE,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT teacher_subscription_invoices_type_check CHECK (
    invoice_type IN ('subscription', 'renewal')
  ),
  CONSTRAINT teacher_subscription_invoices_status_check CHECK (
    status IN ('paid', 'cancelled')
  )
);

CREATE INDEX IF NOT EXISTS idx_teacher_subscription_invoices_teacher
  ON teacher_subscription_invoices (teacher_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS idx_teacher_subscription_invoices_subscription
  ON teacher_subscription_invoices (subscription_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_teacher_subscription_invoices_number
  ON teacher_subscription_invoices (invoice_number);

-- Backfill فواتير للاشتراكات والتجديدات الموجودة
INSERT INTO teacher_subscription_invoices (
  invoice_number, teacher_id, subscription_id, invoice_type, plan_id,
  subscription_number, plan_code, plan_name_ar, amount, payment_method,
  period_start, period_end, status, notes, income_id, issued_at, created_by, created_at
)
SELECT
  'INV-BF-SUB-' || s.id::text,
  s.teacher_id,
  s.id,
  'subscription',
  s.plan_id,
  s.subscription_number,
  p.code,
  p.name_ar,
  s.actual_price,
  s.payment_method,
  s.starts_at,
  s.ends_at,
  'paid',
  s.notes,
  s.income_id,
  s.starts_at,
  s.created_by,
  s.created_at
FROM teacher_platform_subscriptions s
JOIN teacher_subscription_plans p ON p.id = s.plan_id
WHERE NOT EXISTS (
  SELECT 1 FROM teacher_subscription_invoices i
  WHERE i.subscription_id = s.id AND i.invoice_type = 'subscription'
);

INSERT INTO teacher_subscription_invoices (
  invoice_number, teacher_id, subscription_id, renewal_id, invoice_type, plan_id,
  subscription_number, plan_code, plan_name_ar, amount, payment_method,
  period_start, period_end, status, notes, income_id, issued_at, created_by, created_at
)
SELECT
  'INV-BF-REN-' || r.id::text,
  s.teacher_id,
  s.id,
  r.id,
  'renewal',
  r.plan_id,
  s.subscription_number,
  p.code,
  p.name_ar,
  r.actual_price,
  r.payment_method,
  r.period_start,
  r.period_end,
  'paid',
  r.notes,
  r.income_id,
  r.period_start,
  r.renewed_by,
  r.created_at
FROM teacher_subscription_renewals r
JOIN teacher_platform_subscriptions s ON s.id = r.subscription_id
JOIN teacher_subscription_plans p ON p.id = r.plan_id
WHERE NOT EXISTS (
  SELECT 1 FROM teacher_subscription_invoices i WHERE i.renewal_id = r.id
);

-- Down Migration
DROP TABLE IF EXISTS teacher_subscription_invoices;
