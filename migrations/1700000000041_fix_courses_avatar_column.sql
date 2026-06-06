-- Up Migration
-- إضافة عمود avatar إلى جدول الكورسات إذا لم يكن موجودًا
ALTER TABLE courses ADD COLUMN IF NOT EXISTS avatar TEXT;

-- Down Migration
-- حذف عمود avatar من جدول الكورسات إذا كان موجودًا
ALTER TABLE courses DROP COLUMN IF EXISTS avatar; 