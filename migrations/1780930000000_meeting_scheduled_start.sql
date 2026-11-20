-- Up Migration: allow scheduling live lectures with a start time
ALTER TABLE meeting
  ADD COLUMN IF NOT EXISTS scheduled_start_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_meeting_scheduled_start_at
  ON meeting (scheduled_start_at)
  WHERE scheduled_start_at IS NOT NULL AND status = 'idle';

ALTER TABLE general_course_group_meeting
  ADD COLUMN IF NOT EXISTS scheduled_start_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_gcg_meeting_scheduled_start_at
  ON general_course_group_meeting (scheduled_start_at)
  WHERE scheduled_start_at IS NOT NULL AND status = 'idle';

-- Down Migration
-- DROP INDEX IF EXISTS idx_gcg_meeting_scheduled_start_at;
-- ALTER TABLE general_course_group_meeting DROP COLUMN IF EXISTS scheduled_start_at;
-- DROP INDEX IF EXISTS idx_meeting_scheduled_start_at;
-- ALTER TABLE meeting DROP COLUMN IF EXISTS scheduled_start_at;
