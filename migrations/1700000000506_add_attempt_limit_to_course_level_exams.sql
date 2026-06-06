-- Up Migration
ALTER TABLE course_level_exams
  ADD COLUMN IF NOT EXISTS attempt_limit INTEGER CHECK (attempt_limit IS NULL OR attempt_limit > 0);

COMMENT ON COLUMN course_level_exams.attempt_limit IS 'Maximum number of attempts allowed for students. NULL means unlimited attempts.';

-- Down Migration
ALTER TABLE course_level_exams
  DROP COLUMN IF EXISTS attempt_limit;

