-- Up Migration
-- إضافة حقل device_ip لجدول users لربط الطلاب بأجهزتهم

ALTER TABLE users ADD COLUMN IF NOT EXISTS device_ip TEXT;

-- Down Migration
ALTER TABLE users DROP COLUMN IF EXISTS device_ip;





























