-- Up Migration
-- إضافة عمود start_time إلى جدول study_groups

ALTER TABLE study_groups ADD COLUMN IF NOT EXISTS start_time TIME;
 
-- Down Migration
ALTER TABLE study_groups DROP COLUMN IF EXISTS start_time; 