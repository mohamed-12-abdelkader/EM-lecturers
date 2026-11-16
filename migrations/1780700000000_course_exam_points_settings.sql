-- Per comprehensive exam: whether to award points + which attempt counts.

ALTER TABLE course_level_exams
  ADD COLUMN IF NOT EXISTS points_enabled BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE course_level_exams
  ADD COLUMN IF NOT EXISTS points_attempt_mode TEXT NOT NULL DEFAULT 'first';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'course_level_exams_points_attempt_mode_check'
  ) THEN
    ALTER TABLE course_level_exams
      ADD CONSTRAINT course_level_exams_points_attempt_mode_check
      CHECK (points_attempt_mode IN ('first', 'last', 'highest', 'second'));
  END IF;
END $$;

COMMENT ON COLUMN course_level_exams.points_enabled IS
  'When false, this comprehensive exam does not award start/score points.';

COMMENT ON COLUMN course_level_exams.points_attempt_mode IS
  'Which submitted attempt feeds EXAM_SCORE: first | last | highest | second (fallback: last available).';

-- Down
-- ALTER TABLE course_level_exams DROP CONSTRAINT IF EXISTS course_level_exams_points_attempt_mode_check;
-- ALTER TABLE course_level_exams DROP COLUMN IF EXISTS points_attempt_mode;
-- ALTER TABLE course_level_exams DROP COLUMN IF EXISTS points_enabled;
