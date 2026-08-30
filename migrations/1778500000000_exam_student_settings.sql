-- Exam student settings: required question count, display mode, answer-release mode,
-- show/expire windows, and per-attempt selected questions.

-- Lecture MCQ + assignment (`exams`)
ALTER TABLE exams
  ADD COLUMN IF NOT EXISTS questions_count INTEGER,
  ADD COLUMN IF NOT EXISTS question_display_mode VARCHAR(20) DEFAULT 'ordered',
  ADD COLUMN IF NOT EXISTS answers_release_mode VARCHAR(20);

ALTER TABLE exam_submissions
  ADD COLUMN IF NOT EXISTS selected_question_ids INTEGER[];

-- Course-level exams
ALTER TABLE course_level_exams
  ADD COLUMN IF NOT EXISTS available_from TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS question_display_mode VARCHAR(20) DEFAULT 'ordered',
  ADD COLUMN IF NOT EXISTS answers_release_mode VARCHAR(20),
  ADD COLUMN IF NOT EXISTS show_answers_after_hours INTEGER DEFAULT 0;

ALTER TABLE course_level_exam_attempts
  ADD COLUMN IF NOT EXISTS selected_question_ids INTEGER[];

-- Constraints (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'exams_question_display_mode_check'
  ) THEN
    ALTER TABLE exams
      ADD CONSTRAINT exams_question_display_mode_check
      CHECK (question_display_mode IS NULL OR question_display_mode IN ('ordered', 'random'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'exams_answers_release_mode_check'
  ) THEN
    ALTER TABLE exams
      ADD CONSTRAINT exams_answers_release_mode_check
      CHECK (
        answers_release_mode IS NULL
        OR answers_release_mode IN ('immediate', 'after_end', 'after_hours', 'scheduled')
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'course_level_exams_question_display_mode_check'
  ) THEN
    ALTER TABLE course_level_exams
      ADD CONSTRAINT course_level_exams_question_display_mode_check
      CHECK (question_display_mode IS NULL OR question_display_mode IN ('ordered', 'random'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'course_level_exams_answers_release_mode_check'
  ) THEN
    ALTER TABLE course_level_exams
      ADD CONSTRAINT course_level_exams_answers_release_mode_check
      CHECK (
        answers_release_mode IS NULL
        OR answers_release_mode IN ('immediate', 'after_end', 'after_hours', 'scheduled')
      );
  END IF;
END $$;

-- Backfill lecture/assignment answer modes from existing flags
UPDATE exams
SET answers_release_mode = CASE
  WHEN COALESCE(show_answers_immediately, FALSE) THEN 'immediate'
  WHEN COALESCE(show_answers_later, FALSE) AND answers_release_date IS NOT NULL THEN 'scheduled'
  WHEN COALESCE(show_answers_after_hours, 0) > 0 THEN 'after_hours'
  ELSE 'immediate'
END
WHERE answers_release_mode IS NULL;

-- Backfill course-level answer modes
UPDATE course_level_exams
SET answers_release_mode = CASE
  WHEN COALESCE(show_answers_immediately, FALSE) THEN 'immediate'
  WHEN answers_visible_at IS NOT NULL THEN 'scheduled'
  ELSE 'immediate'
END
WHERE answers_release_mode IS NULL;

UPDATE exams
SET question_display_mode = 'ordered'
WHERE question_display_mode IS NULL OR question_display_mode = '';

UPDATE course_level_exams
SET question_display_mode = 'ordered'
WHERE question_display_mode IS NULL OR question_display_mode = '';
