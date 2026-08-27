-- Per-lecture access mode (بدل إعدادات الكورس lecture_access_mode)
-- open | activation_code | groups

ALTER TABLE lectures
  ADD COLUMN IF NOT EXISTS access_mode TEXT;

-- Backfill from previous course-level mode + lecture access_type
UPDATE lectures l
SET access_mode = CASE
  WHEN COALESCE(l.access_type, 'all') = 'groups' THEN 'groups'
  WHEN COALESCE(c.lecture_access_mode, 'always_open') = 'activation_code' THEN 'activation_code'
  ELSE 'open'
END
FROM courses c
WHERE c.id = l.course_id
  AND (l.access_mode IS NULL OR l.access_mode = '');

UPDATE lectures
SET access_mode = 'open'
WHERE access_mode IS NULL OR access_mode = '';

ALTER TABLE lectures
  ALTER COLUMN access_mode SET DEFAULT 'open';

ALTER TABLE lectures
  ALTER COLUMN access_mode SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'lectures_access_mode_check'
  ) THEN
    ALTER TABLE lectures
      ADD CONSTRAINT lectures_access_mode_check
      CHECK (access_mode IN ('open', 'activation_code', 'groups'));
  END IF;
END $$;

-- Keep access_type in sync for older group helpers
UPDATE lectures SET access_type = 'groups' WHERE access_mode = 'groups';
UPDATE lectures SET access_type = 'all' WHERE access_mode IN ('open', 'activation_code');

CREATE INDEX IF NOT EXISTS idx_lectures_access_mode ON lectures (access_mode);

COMMENT ON COLUMN lectures.access_mode IS
  'open = متاحة للكل | activation_code = مقفولة بكود | groups = مفتوحة لمجموعات محددة فقط';
