-- Up Migration
-- ربط chat_groups بمجموعات مادة الباقة (package_subject_item_groups) لدعم شات خاص بكل مجموعة

ALTER TABLE chat_groups
ADD COLUMN IF NOT EXISTS package_subject_group_id INTEGER;

-- Foreign key (if not exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_chat_groups_package_subject_group'
  ) THEN
    ALTER TABLE chat_groups
      ADD CONSTRAINT fk_chat_groups_package_subject_group
      FOREIGN KEY (package_subject_group_id)
      REFERENCES package_subject_item_groups(id)
      ON DELETE CASCADE;
  END IF;
END $$;

-- Unique per package_subject_group_id (NULL allowed multiple times)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chat_groups_package_subject_group_id_key'
  ) THEN
    ALTER TABLE chat_groups
      ADD CONSTRAINT chat_groups_package_subject_group_id_key UNIQUE (package_subject_group_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_chat_groups_package_subject_group_id ON chat_groups(package_subject_group_id);

-- Down Migration (best-effort)
-- Note: dropping constraints conditionally
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_chat_groups_package_subject_group') THEN
    ALTER TABLE chat_groups DROP CONSTRAINT fk_chat_groups_package_subject_group;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chat_groups_package_subject_group_id_key') THEN
    ALTER TABLE chat_groups DROP CONSTRAINT chat_groups_package_subject_group_id_key;
  END IF;
END $$;

DROP INDEX IF EXISTS idx_chat_groups_package_subject_group_id;
ALTER TABLE chat_groups DROP COLUMN IF EXISTS package_subject_group_id;







