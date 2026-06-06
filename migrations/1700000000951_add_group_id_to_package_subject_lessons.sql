-- Up Migration
-- ربط الدروس بالمجموعات داخل المادة

ALTER TABLE package_subject_item_lessons
  ADD COLUMN IF NOT EXISTS group_id INTEGER REFERENCES package_subject_item_groups(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_psil_group_id ON package_subject_item_lessons(group_id);

-- Down Migration
DROP INDEX IF EXISTS idx_psil_group_id;
ALTER TABLE package_subject_item_lessons
  DROP COLUMN IF EXISTS group_id;


