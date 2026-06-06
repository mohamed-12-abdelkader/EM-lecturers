-- Up Migration
ALTER TABLE exams ADD COLUMN IF NOT EXISTS is_visible BOOLEAN DEFAULT FALSE;
UPDATE exams SET is_visible = FALSE WHERE is_visible IS NULL;

-- Down Migration
ALTER TABLE exams DROP COLUMN IF EXISTS is_visible; 