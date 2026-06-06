-- Up Migration
ALTER TABLE IF EXISTS course_exam_submissions
  ADD COLUMN IF NOT EXISTS attempts_count INTEGER DEFAULT 1;

UPDATE course_exam_submissions
SET attempts_count = 1
WHERE attempts_count IS NULL;

-- Down Migration
ALTER TABLE IF EXISTS course_exam_submissions
  DROP COLUMN IF EXISTS attempts_count;



