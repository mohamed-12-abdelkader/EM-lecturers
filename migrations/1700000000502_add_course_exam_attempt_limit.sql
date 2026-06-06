-- Up Migration
ALTER TABLE course_exams
  ADD COLUMN IF NOT EXISTS attempt_limit INTEGER;

ALTER TABLE course_exam_submissions
  ADD COLUMN IF NOT EXISTS attempts_count INTEGER DEFAULT 1;

UPDATE course_exam_submissions
SET attempts_count = COALESCE(attempts_count, 1);

-- Down Migration
ALTER TABLE course_exam_submissions
  DROP COLUMN IF EXISTS attempts_count;

ALTER TABLE course_exams
  DROP COLUMN IF EXISTS attempt_limit;

