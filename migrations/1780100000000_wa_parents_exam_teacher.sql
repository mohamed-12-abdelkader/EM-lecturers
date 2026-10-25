-- Up Migration
-- Parent exam auto-send is per teacher. Pace limits stay on the platform service.

CREATE TABLE IF NOT EXISTS wa_parent_exam_teacher_settings (
  teacher_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  auto_send BOOLEAN NOT NULL DEFAULT FALSE,
  notify_passed BOOLEAN NOT NULL DEFAULT FALSE,
  notify_failed BOOLEAN NOT NULL DEFAULT FALSE,
  notify_absent BOOLEAN NOT NULL DEFAULT FALSE,
  pass_percentage INTEGER NOT NULL DEFAULT 50 CHECK (pass_percentage >= 0 AND pass_percentage <= 100),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE wa_parent_exam_notifications
  ADD COLUMN IF NOT EXISTS teacher_id INTEGER REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_wa_parent_exam_notifications_teacher_day
  ON wa_parent_exam_notifications (teacher_id, scheduled_at)
  WHERE status IN ('scheduled', 'sent');

UPDATE wa_services
SET config = config
  - 'auto_send'
  - 'notify_passed'
  - 'notify_failed'
  - 'notify_absent'
  - 'pass_percentage'
WHERE key = 'parents_exam_notify';

-- Down Migration
ALTER TABLE wa_parent_exam_notifications DROP COLUMN IF EXISTS teacher_id;
DROP TABLE IF EXISTS wa_parent_exam_teacher_settings;
