-- Comprehensive exam: fixed schedule timing mode + course-group audience targeting.
-- Existing exams keep NULL timing_mode (= legacy min(duration, visibility_end)).

ALTER TABLE course_level_exams
  ADD COLUMN IF NOT EXISTS timing_mode TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'course_level_exams_timing_mode_check'
  ) THEN
    ALTER TABLE course_level_exams
      ADD CONSTRAINT course_level_exams_timing_mode_check
      CHECK (timing_mode IS NULL OR timing_mode IN ('relative', 'fixed'));
  END IF;
END $$;

COMMENT ON COLUMN course_level_exams.timing_mode IS
  'NULL=legacy (min of duration and window end). relative=full duration from student start. fixed=shared schedule_end.';

ALTER TABLE course_level_exams
  ADD COLUMN IF NOT EXISTS audience_type TEXT NOT NULL DEFAULT 'all';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'course_level_exams_audience_type_check'
  ) THEN
    ALTER TABLE course_level_exams
      ADD CONSTRAINT course_level_exams_audience_type_check
      CHECK (audience_type IN ('all', 'groups'));
  END IF;
END $$;

COMMENT ON COLUMN course_level_exams.audience_type IS
  'all=every enrolled student. groups=only students in course_level_exam_groups.';

CREATE TABLE IF NOT EXISTS course_level_exam_groups (
  exam_id INTEGER NOT NULL REFERENCES course_level_exams(id) ON DELETE CASCADE,
  group_id INTEGER NOT NULL REFERENCES course_groups(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (exam_id, group_id)
);

CREATE INDEX IF NOT EXISTS idx_course_level_exam_groups_group
  ON course_level_exam_groups(group_id);

COMMENT ON TABLE course_level_exam_groups IS
  'مجموعات الكورس المسموح لها بدخول امتحان شامل عند audience_type=groups';
