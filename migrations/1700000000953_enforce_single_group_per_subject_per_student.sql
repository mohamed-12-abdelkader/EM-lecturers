-- Up Migration
-- منع الطالب من الانضمام لأكثر من مجموعة داخل نفس المادة (package_subject_item)
-- الفكرة: إضافة package_subject_item_id إلى جدول ربط الطلاب بالمجموعة ثم عمل UNIQUE(student_id, package_subject_item_id)

ALTER TABLE package_subject_item_group_students
  ADD COLUMN IF NOT EXISTS package_subject_item_id INTEGER;

-- Backfill existing rows (إن وجدت)
UPDATE package_subject_item_group_students gs
SET package_subject_item_id = g.package_subject_item_id
FROM package_subject_item_groups g
WHERE g.id = gs.group_id
  AND gs.package_subject_item_id IS NULL;

-- FK to subject items
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_psigs_subject_item'
  ) THEN
    ALTER TABLE package_subject_item_group_students
      ADD CONSTRAINT fk_psigs_subject_item
      FOREIGN KEY (package_subject_item_id) REFERENCES package_subject_items(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Ensure not null after backfill
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM package_subject_item_group_students WHERE package_subject_item_id IS NULL LIMIT 1
  ) THEN
    -- leave nullable if old data is inconsistent; app logic + trigger will set it for new inserts
  ELSE
    ALTER TABLE package_subject_item_group_students
      ALTER COLUMN package_subject_item_id SET NOT NULL;
  END IF;
END $$;

-- Unique: one group per subject per student
-- تنظيف أي بيانات قديمة مخالفة (طالب في أكثر من مجموعة لنفس المادة)
-- نحتفظ بآخر سجل (الأكبر id) ونحذف الباقي
DELETE FROM package_subject_item_group_students a
USING package_subject_item_group_students b
WHERE a.student_id = b.student_id
  AND a.package_subject_item_id = b.package_subject_item_id
  AND a.id < b.id;

CREATE UNIQUE INDEX IF NOT EXISTS uq_psigs_student_subject
  ON package_subject_item_group_students(student_id, package_subject_item_id);

-- Trigger to auto-set package_subject_item_id from group_id on insert/update
CREATE OR REPLACE FUNCTION set_psigs_subject_item_id()
RETURNS TRIGGER AS $$
DECLARE
  sid INTEGER;
BEGIN
  SELECT package_subject_item_id INTO sid
  FROM package_subject_item_groups
  WHERE id = NEW.group_id;

  IF sid IS NULL THEN
    RAISE EXCEPTION 'Invalid group_id: %', NEW.group_id;
  END IF;

  NEW.package_subject_item_id := sid;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_psigs_set_subject_item_id ON package_subject_item_group_students;
CREATE TRIGGER trg_psigs_set_subject_item_id
BEFORE INSERT OR UPDATE OF group_id
ON package_subject_item_group_students
FOR EACH ROW
EXECUTE FUNCTION set_psigs_subject_item_id();

-- Down Migration
DROP TRIGGER IF EXISTS trg_psigs_set_subject_item_id ON package_subject_item_group_students;
DROP FUNCTION IF EXISTS set_psigs_subject_item_id();
DROP INDEX IF EXISTS uq_psigs_student_subject;
ALTER TABLE package_subject_item_group_students DROP CONSTRAINT IF EXISTS fk_psigs_subject_item;
ALTER TABLE package_subject_item_group_students DROP COLUMN IF EXISTS package_subject_item_id;


