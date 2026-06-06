-- Up Migration
ALTER TABLE course_exams
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();

UPDATE course_exams
SET updated_at = NOW()
WHERE updated_at IS NULL;

-- Down Migration
ALTER TABLE course_exams
DROP COLUMN IF EXISTS updated_at;

