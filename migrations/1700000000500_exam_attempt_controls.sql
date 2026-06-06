-- Up Migration

-- Extend exams table with adaptive release & attempt controls
ALTER TABLE exams
  ADD COLUMN IF NOT EXISTS allow_multiple_attempts BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS show_answers_later BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS answers_release_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS time_limit_enabled BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS time_limit_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS start_window TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS end_window TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_exams_answers_release_date ON exams(answers_release_date);
CREATE INDEX IF NOT EXISTS idx_exams_start_window ON exams(start_window);
CREATE INDEX IF NOT EXISTS idx_exams_end_window ON exams(end_window);

-- Track detailed attempt lifecycle on exam_submissions
ALTER TABLE exam_submissions
  ADD COLUMN IF NOT EXISTS attempt_start_time TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS attempt_end_time TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'submitted',
  ADD COLUMN IF NOT EXISTS attempt_number INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS time_limit_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS attempt_expire_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_late BOOLEAN DEFAULT FALSE;

UPDATE exam_submissions
SET
  attempt_start_time = COALESCE(attempt_start_time, submitted_at),
  attempt_end_time = COALESCE(attempt_end_time, submitted_at),
  status = COALESCE(status, 'submitted'),
  attempt_number = COALESCE(attempt_number, 1),
  is_late = COALESCE(is_late, FALSE);

-- Persist per-question student selections for analytics & feedback
ALTER TABLE exam_answers
  ADD COLUMN IF NOT EXISTS selected_choice_id INTEGER REFERENCES question_choices(id),
  ADD COLUMN IF NOT EXISTS is_correct BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_exam_answers_submission ON exam_answers(submission_id);

-- Down Migration

ALTER TABLE exam_answers
  DROP COLUMN IF EXISTS is_correct,
  DROP COLUMN IF EXISTS selected_choice_id;

ALTER TABLE exam_submissions
  DROP COLUMN IF EXISTS is_late,
  DROP COLUMN IF EXISTS attempt_expire_at,
  DROP COLUMN IF EXISTS time_limit_minutes,
  DROP COLUMN IF EXISTS attempt_number,
  DROP COLUMN IF EXISTS status,
  DROP COLUMN IF EXISTS attempt_end_time,
  DROP COLUMN IF EXISTS attempt_start_time;

ALTER TABLE exams
  DROP COLUMN IF EXISTS end_window,
  DROP COLUMN IF EXISTS start_window,
  DROP COLUMN IF EXISTS time_limit_minutes,
  DROP COLUMN IF EXISTS time_limit_enabled,
  DROP COLUMN IF EXISTS answers_release_date,
  DROP COLUMN IF EXISTS show_answers_later,
  DROP COLUMN IF EXISTS allow_multiple_attempts;

DROP INDEX IF EXISTS idx_exam_answers_submission;
DROP INDEX IF EXISTS idx_exams_end_window;
DROP INDEX IF EXISTS idx_exams_start_window;
DROP INDEX IF EXISTS idx_exams_answers_release_date;

