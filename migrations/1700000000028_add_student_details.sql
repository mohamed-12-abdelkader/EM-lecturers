-- Up Migration
-- إضافة تفاصيل الطالب

-- إضافة عمود رقم ولي الأمر
ALTER TABLE users ADD COLUMN IF NOT EXISTS parent_phone TEXT;

-- إضافة عمود حالة الدفع
ALTER TABLE users ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'unpaid';

-- إضافة عمود مبلغ الدفع
ALTER TABLE users ADD COLUMN IF NOT EXISTS payment_amount NUMERIC(10, 2) DEFAULT 0.00;

-- إضافة عمود تاريخ الدفع
ALTER TABLE users ADD COLUMN IF NOT EXISTS payment_date TIMESTAMP;

-- Down Migration
ALTER TABLE users DROP COLUMN IF EXISTS parent_phone;
ALTER TABLE users DROP COLUMN IF EXISTS payment_status;
ALTER TABLE users DROP COLUMN IF EXISTS payment_amount;
ALTER TABLE users DROP COLUMN IF EXISTS payment_date; 