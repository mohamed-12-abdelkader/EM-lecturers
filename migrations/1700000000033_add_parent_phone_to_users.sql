-- Up Migration
-- إضافة حقل رقم ولي الأمر للمستخدمين (الطلاب)

ALTER TABLE users ADD COLUMN IF NOT EXISTS parent_phone TEXT;

-- Down Migration
ALTER TABLE users DROP COLUMN IF EXISTS parent_phone; 