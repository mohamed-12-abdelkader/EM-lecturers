-- Course-level exam: nullable (unlimited) duration, server-side attempt expiry,
-- autosave-friendly unique answers, one in-progress attempt per student.

-- Unlimited timer: NULL duration_minutes
ALTER TABLE course_level_exams
  DROP CONSTRAINT IF EXISTS course_level_exams_duration_minutes_check;

ALTER TABLE course_level_exams
  ALTER COLUMN duration_minutes DROP NOT NULL;

ALTER TABLE course_level_exams
  ADD CONSTRAINT course_level_exams_duration_minutes_check
  CHECK (duration_minutes IS NULL OR duration_minutes > 0);

COMMENT ON COLUMN course_level_exams.duration_minutes IS
  'Per-attempt timer in minutes. NULL = unlimited (student may submit until visibility_end_date).';

ALTER TABLE course_level_exam_attempts
  ADD COLUMN IF NOT EXISTS attempt_expire_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS timed_out BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS last_autosave_at TIMESTAMPTZ;

COMMENT ON COLUMN course_level_exam_attempts.attempt_expire_at IS
  'Server deadline = earlier of started_at+duration and visibility_end_date. NULL = no auto-expire.';
COMMENT ON COLUMN course_level_exam_attempts.timed_out IS
  'True when the attempt was auto-submitted because attempt_expire_at elapsed.';

-- Keep the newest in-progress row if duplicates exist (partial unique index).
UPDATE course_level_exam_attempts a
SET status = 'expired'
WHERE a.status = 'in_progress'
  AND a.id NOT IN (
    SELECT DISTINCT ON (exam_id, student_id) id
    FROM course_level_exam_attempts
    WHERE status = 'in_progress'
    ORDER BY exam_id, student_id, started_at DESC, id DESC
  );

CREATE UNIQUE INDEX IF NOT EXISTS course_level_exam_one_in_progress
  ON course_level_exam_attempts (exam_id, student_id)
  WHERE status = 'in_progress';

-- Deduplicate answers then enforce unique (attempt_id, question_id) for UPSERT.
DELETE FROM course_level_exam_answers a
USING course_level_exam_answers b
WHERE a.attempt_id = b.attempt_id
  AND a.question_id = b.question_id
  AND a.id < b.id;

CREATE UNIQUE INDEX IF NOT EXISTS course_level_exam_answers_attempt_question_uidx
  ON course_level_exam_answers (attempt_id, question_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'course_level_exam_answers_attempt_question_key'
  ) THEN
    ALTER TABLE course_level_exam_answers
      ADD CONSTRAINT course_level_exam_answers_attempt_question_key
      UNIQUE USING INDEX course_level_exam_answers_attempt_question_uidx;
  END IF;
END $$;

-- Backfill expire_at for open attempts: earlier of duration end and visibility_end_date
UPDATE course_level_exam_attempts att
SET attempt_expire_at = CASE
  WHEN e.duration_minutes IS NOT NULL AND e.duration_minutes > 0 AND e.visibility_end_date IS NOT NULL
    THEN LEAST(
      att.started_at + make_interval(mins => e.duration_minutes),
      e.visibility_end_date
    )
  WHEN e.duration_minutes IS NOT NULL AND e.duration_minutes > 0
    THEN att.started_at + make_interval(mins => e.duration_minutes)
  ELSE e.visibility_end_date
END
FROM course_level_exams e
WHERE e.id = att.exam_id
  AND att.status = 'in_progress'
  AND att.attempt_expire_at IS NULL;
