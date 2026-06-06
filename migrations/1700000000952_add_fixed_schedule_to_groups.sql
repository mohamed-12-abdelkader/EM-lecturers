-- Up Migration
-- تحويل معاد المجموعة إلى معاد ثابت (أيام + وقت) بدلاً من قائمة تواريخ

ALTER TABLE package_subject_item_groups
  ADD COLUMN IF NOT EXISTS schedule_days TEXT[] DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS schedule_time TEXT DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_psig_schedule_days ON package_subject_item_groups USING GIN (schedule_days);

-- Down Migration
DROP INDEX IF EXISTS idx_psig_schedule_days;
ALTER TABLE package_subject_item_groups
  DROP COLUMN IF EXISTS schedule_days,
  DROP COLUMN IF EXISTS schedule_time;













