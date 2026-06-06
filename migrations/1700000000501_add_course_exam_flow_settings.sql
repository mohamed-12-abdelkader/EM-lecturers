-- Up Migration
ALTER TABLE course_exams
  ADD COLUMN IF NOT EXISTS show_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS hide_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS lock_next_lectures BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS show_answers_immediately BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS show_answers_after_hours INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS allow_multiple_attempts BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS show_answers_later BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS answers_release_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS time_limit_enabled BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS time_limit_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS start_window TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS end_window TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_course_exams_show_at ON course_exams(show_at);
CREATE INDEX IF NOT EXISTS idx_course_exams_hide_at ON course_exams(hide_at);
CREATE INDEX IF NOT EXISTS idx_course_exams_answers_release_date ON course_exams(answers_release_date);
CREATE INDEX IF NOT EXISTS idx_course_exams_start_window ON course_exams(start_window);
CREATE INDEX IF NOT EXISTS idx_course_exams_end_window ON course_exams(end_window);

-- Down Migration
ALTER TABLE course_exams
  DROP COLUMN IF EXISTS end_window,
  DROP COLUMN IF EXISTS start_window,
  DROP COLUMN IF EXISTS time_limit_minutes,
  DROP COLUMN IF EXISTS time_limit_enabled,
  DROP COLUMN IF EXISTS answers_release_date,
  DROP COLUMN IF EXISTS show_answers_later,
  DROP COLUMN IF EXISTS allow_multiple_attempts,
  DROP COLUMN IF EXISTS show_answers_after_hours,
  DROP COLUMN IF EXISTS show_answers_immediately,
  DROP COLUMN IF EXISTS lock_next_lectures,
  DROP COLUMN IF EXISTS hide_at,
  DROP COLUMN IF EXISTS show_at;

DROP INDEX IF EXISTS idx_course_exams_end_window;
DROP INDEX IF EXISTS idx_course_exams_start_window;
DROP INDEX IF EXISTS idx_course_exams_answers_release_date;
DROP INDEX IF EXISTS idx_course_exams_hide_at;
DROP INDEX IF EXISTS idx_course_exams_show_at;

