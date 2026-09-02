-- Lecture exams / assignments: server-side attempt expiry, autosave uniqueness,
-- one in-progress attempt per student. Duration NULL/0 = unlimited.

ALTER TABLE exam_submissions
  ADD COLUMN IF NOT EXISTS timed_out BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS last_autosave_at TIMESTAMPTZ;

COMMENT ON COLUMN exam_submissions.timed_out IS
  'True when the attempt was auto-submitted because attempt_expire_at elapsed.';
COMMENT ON COLUMN exam_submissions.last_autosave_at IS
  'Last successful in-progress answer autosave.';

-- Keep the newest in-progress row if duplicates exist (partial unique index).
UPDATE exam_submissions a
SET status = 'expired'
WHERE a.status = 'in_progress'
  AND a.id NOT IN (
    SELECT DISTINCT ON (exam_id, student_id) id
    FROM exam_submissions
    WHERE status = 'in_progress'
    ORDER BY exam_id, student_id, attempt_start_time DESC NULLS LAST, id DESC
  );

CREATE UNIQUE INDEX IF NOT EXISTS exam_submissions_one_in_progress
  ON exam_submissions (exam_id, student_id)
  WHERE status = 'in_progress';

-- Deduplicate answers then enforce unique (submission_id, question_id) for UPSERT.
DELETE FROM exam_answers a
USING exam_answers b
WHERE a.submission_id = b.submission_id
  AND a.question_id = b.question_id
  AND a.id < b.id;

CREATE UNIQUE INDEX IF NOT EXISTS exam_answers_submission_question_uidx
  ON exam_answers (submission_id, question_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'exam_answers_submission_question_key'
  ) THEN
    ALTER TABLE exam_answers
      ADD CONSTRAINT exam_answers_submission_question_key
      UNIQUE USING INDEX exam_answers_submission_question_uidx;
  END IF;
END $$;

-- Backfill expire_at for open attempts: earlier of duration end and hide_at/end_window
UPDATE exam_submissions s
SET attempt_expire_at = CASE
  WHEN e.duration IS NOT NULL AND e.duration > 0
    AND COALESCE(e.hide_at, e.end_window) IS NOT NULL
    THEN LEAST(
      COALESCE(s.attempt_start_time, NOW()) + make_interval(mins => e.duration),
      COALESCE(e.hide_at, e.end_window)
    )
  WHEN e.duration IS NOT NULL AND e.duration > 0
    THEN COALESCE(s.attempt_start_time, NOW()) + make_interval(mins => e.duration)
  ELSE COALESCE(e.hide_at, e.end_window)
END
FROM exams e
WHERE e.id = s.exam_id
  AND s.status = 'in_progress'
  AND s.attempt_expire_at IS NULL;
