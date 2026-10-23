-- Up Migration
-- Parents/guardians notifications for comprehensive exams (paced, no-reply)

INSERT INTO wa_services (key, name, description, type, scope, is_enabled, config)
VALUES (
  'parents_exam_notify',
  'إشعارات أولياء الأمور — الامتحانات الشاملة',
  'رسائل لأولياء الأمور عن نتيجة الامتحان الشامل أو عدم الدخول. إرسال متباعد بدون رد تلقائي.',
  'transactional',
  'platform',
  FALSE,
  '{
    "no_reply": true,
    "language": "ar-EG",
    "auto_send": false,
    "notify_passed": false,
    "notify_failed": false,
    "notify_absent": false,
    "pass_percentage": 50,
    "interval_seconds": 30,
    "jitter_seconds": 10,
    "daily_cap": 400,
    "quiet_hours": { "enabled": true, "start": "23:00", "end": "08:00", "tz": "Africa/Cairo" }
  }'::jsonb
)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS wa_parent_exam_settings (
  exam_id INTEGER PRIMARY KEY REFERENCES course_level_exams(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  paused BOOLEAN NOT NULL DEFAULT FALSE,
  absent_swept_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wa_parent_exam_notifications (
  id SERIAL PRIMARY KEY,
  exam_id INTEGER NOT NULL REFERENCES course_level_exams(id) ON DELETE CASCADE,
  student_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cohort TEXT NOT NULL CHECK (cohort IN ('passed', 'failed', 'absent')),
  parent_phone VARCHAR(32),
  body TEXT NOT NULL DEFAULT '',
  job_id INTEGER REFERENCES wa_outbound_jobs(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'sent', 'skipped', 'cancelled')),
  scheduled_at TIMESTAMPTZ,
  skip_reason TEXT,
  ready_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  immediate BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (exam_id, student_user_id, cohort)
);

CREATE INDEX IF NOT EXISTS idx_wa_parent_exam_notifications_ready
  ON wa_parent_exam_notifications (ready_at, id)
  WHERE status = 'scheduled' AND job_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_wa_parent_exam_notifications_exam
  ON wa_parent_exam_notifications (exam_id, status);

CREATE INDEX IF NOT EXISTS idx_wa_parent_exam_notifications_job
  ON wa_parent_exam_notifications (job_id)
  WHERE job_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_wa_outbound_jobs_session_processed
  ON wa_outbound_jobs (session_slug, processed_at DESC)
  WHERE status = 'sent';

-- Down Migration
DROP INDEX IF EXISTS idx_wa_outbound_jobs_session_processed;
DROP TABLE IF EXISTS wa_parent_exam_notifications;
DROP TABLE IF EXISTS wa_parent_exam_settings;
DELETE FROM wa_services WHERE key = 'parents_exam_notify';
