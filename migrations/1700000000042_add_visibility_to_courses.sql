-- Up Migration
-- إضافة حقل is_visible لجدول الكورسات
ALTER TABLE courses ADD COLUMN IF NOT EXISTS is_visible BOOLEAN DEFAULT TRUE;

-- تحديث جميع الكورسات الموجودة لتكون مرئية افتراضياً
UPDATE courses SET is_visible = TRUE WHERE is_visible IS NULL;

-- Down Migration
ALTER TABLE courses DROP COLUMN IF EXISTS is_visible;
