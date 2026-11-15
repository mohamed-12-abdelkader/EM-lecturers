-- Multi-device host sessions + suspendable meeting recording metadata
ALTER TABLE meeting
  ADD COLUMN IF NOT EXISTS recording_status TEXT NOT NULL DEFAULT 'idle',
  ADD COLUMN IF NOT EXISTS active_egress_id TEXT,
  ADD COLUMN IF NOT EXISTS recording_segment_index INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS recording_segments JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE general_course_group_meeting
  ADD COLUMN IF NOT EXISTS recording_status TEXT NOT NULL DEFAULT 'idle',
  ADD COLUMN IF NOT EXISTS active_egress_id TEXT,
  ADD COLUMN IF NOT EXISTS recording_segment_index INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS recording_segments JSONB NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'meeting_recording_status_check'
  ) THEN
    ALTER TABLE meeting
      ADD CONSTRAINT meeting_recording_status_check
      CHECK (recording_status IN ('idle', 'recording', 'paused', 'finalized'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'general_course_group_meeting_recording_status_check'
  ) THEN
    ALTER TABLE general_course_group_meeting
      ADD CONSTRAINT general_course_group_meeting_recording_status_check
      CHECK (recording_status IN ('idle', 'recording', 'paused', 'finalized'));
  END IF;
END $$;

-- DOWN
-- ALTER TABLE meeting DROP CONSTRAINT IF EXISTS meeting_recording_status_check;
-- ALTER TABLE meeting DROP COLUMN IF EXISTS recording_status;
-- ALTER TABLE meeting DROP COLUMN IF EXISTS active_egress_id;
-- ALTER TABLE meeting DROP COLUMN IF EXISTS recording_segment_index;
-- ALTER TABLE meeting DROP COLUMN IF EXISTS recording_segments;
-- ALTER TABLE general_course_group_meeting DROP CONSTRAINT IF EXISTS general_course_group_meeting_recording_status_check;
-- ALTER TABLE general_course_group_meeting DROP COLUMN IF EXISTS recording_status;
-- ALTER TABLE general_course_group_meeting DROP COLUMN IF EXISTS active_egress_id;
-- ALTER TABLE general_course_group_meeting DROP COLUMN IF EXISTS recording_segment_index;
-- ALTER TABLE general_course_group_meeting DROP COLUMN IF EXISTS recording_segments;
