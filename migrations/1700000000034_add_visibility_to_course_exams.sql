-- Up Migration
ALTER TABLE course_exams ADD COLUMN IF NOT EXISTS is_visible BOOLEAN DEFAULT FALSE;

-- Down Migration
ALTER TABLE course_exams DROP COLUMN IF EXISTS is_visible; 