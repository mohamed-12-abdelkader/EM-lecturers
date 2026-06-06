-- Up Migration
-- إضافة حقل is_visible لجدول الامتحانات (الجدول القديم)

ALTER TABLE exams ADD COLUMN IF NOT EXISTS is_visible BOOLEAN DEFAULT FALSE;

-- Down Migration
ALTER TABLE exams DROP COLUMN IF EXISTS is_visible; 