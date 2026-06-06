-- Up Migration
-- إضافة حقل grade_id لجدول المجموعات الدراسية

ALTER TABLE study_groups ADD COLUMN IF NOT EXISTS grade_id INTEGER REFERENCES grades(id) ON DELETE SET NULL;

-- Down Migration
ALTER TABLE study_groups DROP COLUMN IF EXISTS grade_id; 