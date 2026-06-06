-- Up Migration
ALTER TABLE grades
ADD COLUMN IF NOT EXISTS slug TEXT;

ALTER TABLE grades
ADD COLUMN IF NOT EXISTS stage VARCHAR(20);

ALTER TABLE grades
ADD COLUMN IF NOT EXISTS status VARCHAR(20);

-- Backfill grade status from legacy boolean flag
UPDATE grades
SET status = CASE
  WHEN COALESCE(is_active, TRUE) = TRUE THEN 'active'
  ELSE 'inactive'
END
WHERE status IS NULL;

-- Backfill stage from existing names/levels when possible
UPDATE grades
SET stage = CASE
  WHEN name LIKE '%الإعدادي%' THEN 'prep'
  WHEN name LIKE '%الثانوي%' THEN 'secondary'
  WHEN name LIKE '%الجامعي%' OR name LIKE '%الفرقة%' THEN 'university'
  WHEN name = 'كورسات عامة' THEN 'general'
  ELSE CASE
    WHEN level BETWEEN 1 AND 3 THEN 'prep'
    WHEN level BETWEEN 4 AND 6 THEN 'secondary'
    WHEN level BETWEEN 7 AND 10 THEN 'university'
    ELSE 'general'
  END
END
WHERE stage IS NULL;

-- Backfill slugs for known names
UPDATE grades
SET slug = CASE
  WHEN name = 'الصف الأول الإعدادي' THEN 'prep-1'
  WHEN name = 'الصف الثاني الإعدادي' THEN 'prep-2'
  WHEN name = 'الصف الثالث الإعدادي' THEN 'prep-3'
  WHEN name = 'الصف الأول الثانوي' THEN 'secondary-1'
  WHEN name = 'الصف الثاني الثانوي' THEN 'secondary-2'
  WHEN name = 'الصف الثالث الثانوي' THEN 'secondary-3'
  WHEN name = 'الصف الأول الجامعي' THEN 'university-1'
  WHEN name = 'الصف الثاني الجامعي' THEN 'university-2'
  WHEN name = 'الصف الثالث الجامعي' THEN 'university-3'
  WHEN name = 'الصف الرابع الجامعي' THEN 'university-4'
  WHEN name = 'الفرقة الأولى' THEN 'legacy-university-1'
  WHEN name = 'الفرقة الثانية' THEN 'legacy-university-2'
  WHEN name = 'الفرقة الثالثة' THEN 'legacy-university-3'
  WHEN name = 'الفرقة الرابعة' THEN 'legacy-university-4'
  WHEN name = 'كورسات عامة' THEN 'general-courses'
  ELSE COALESCE(slug, CONCAT('grade-', id))
END
WHERE slug IS NULL;

ALTER TABLE grades
ALTER COLUMN slug SET NOT NULL;

ALTER TABLE grades
ALTER COLUMN stage SET NOT NULL;

ALTER TABLE grades
ALTER COLUMN status SET NOT NULL;

ALTER TABLE grades
ALTER COLUMN status SET DEFAULT 'active';

ALTER TABLE grades
DROP CONSTRAINT IF EXISTS grades_status_check;

ALTER TABLE grades
ADD CONSTRAINT grades_status_check CHECK (status IN ('active', 'inactive'));

ALTER TABLE grades
DROP CONSTRAINT IF EXISTS grades_stage_check;

ALTER TABLE grades
ADD CONSTRAINT grades_stage_check CHECK (stage IN ('prep', 'secondary', 'university', 'general'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_grades_slug_unique ON grades(slug);
CREATE INDEX IF NOT EXISTS idx_grades_stage_status ON grades(stage, status);

-- Ensure canonical grade set exists
INSERT INTO grades (name, slug, stage, status, is_active)
VALUES
  ('الصف الأول الإعدادي', 'prep-1', 'prep', 'active', TRUE),
  ('الصف الثاني الإعدادي', 'prep-2', 'prep', 'active', TRUE),
  ('الصف الثالث الإعدادي', 'prep-3', 'prep', 'active', TRUE),
  ('الصف الأول الثانوي', 'secondary-1', 'secondary', 'active', TRUE),
  ('الصف الثاني الثانوي', 'secondary-2', 'secondary', 'active', TRUE),
  ('الصف الثالث الثانوي', 'secondary-3', 'secondary', 'active', TRUE),
  ('الصف الأول الجامعي', 'university-1', 'university', 'active', TRUE),
  ('الصف الثاني الجامعي', 'university-2', 'university', 'active', TRUE),
  ('الصف الثالث الجامعي', 'university-3', 'university', 'active', TRUE),
  ('الصف الرابع الجامعي', 'university-4', 'university', 'active', TRUE),
  ('كورسات عامة', 'general-courses', 'general', 'active', TRUE)
ON CONFLICT (slug)
DO UPDATE SET
  name = EXCLUDED.name,
  stage = EXCLUDED.stage,
  status = EXCLUDED.status,
  is_active = EXCLUDED.is_active,
  updated_at = NOW();

-- Teacher account status management
ALTER TABLE users
ADD COLUMN IF NOT EXISTS account_status VARCHAR(20);

UPDATE users
SET account_status = 'active'
WHERE account_status IS NULL;

ALTER TABLE users
ALTER COLUMN account_status SET NOT NULL;

ALTER TABLE users
ALTER COLUMN account_status SET DEFAULT 'active';

ALTER TABLE users
DROP CONSTRAINT IF EXISTS users_account_status_check;

ALTER TABLE users
ADD CONSTRAINT users_account_status_check
CHECK (account_status IN ('active', 'inactive', 'suspended'));

CREATE INDEX IF NOT EXISTS idx_users_role_account_status
ON users(role, account_status);

-- Down Migration
DROP INDEX IF EXISTS idx_users_role_account_status;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_account_status_check;
ALTER TABLE users DROP COLUMN IF EXISTS account_status;

DROP INDEX IF EXISTS idx_grades_stage_status;
DROP INDEX IF EXISTS idx_grades_slug_unique;
ALTER TABLE grades DROP CONSTRAINT IF EXISTS grades_status_check;
ALTER TABLE grades DROP CONSTRAINT IF EXISTS grades_stage_check;
ALTER TABLE grades DROP COLUMN IF EXISTS status;
ALTER TABLE grades DROP COLUMN IF EXISTS stage;
ALTER TABLE grades DROP COLUMN IF EXISTS slug;
