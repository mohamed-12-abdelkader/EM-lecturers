-- Up Migration: Teacher schedules + Teachers Management WhatsApp reminders

INSERT INTO wa_services (key, name, description, type, scope, is_enabled, config)
VALUES (
  'teachers_management',
  'إدارة المدرسين',
  'تذكيرات واتساب يومية للمدرسين بمهامهم المجدولة. جلسة مستقلة بدون رد تلقائي.',
  'transactional',
  'platform',
  FALSE,
  '{
    "no_reply": true,
    "language": "ar-EG",
    "tz": "Africa/Cairo"
  }'::jsonb
)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS teacher_schedule_tasks (
  id SERIAL PRIMARY KEY,
  teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_type TEXT NOT NULL CHECK (task_type IN ('lecture', 'live', 'exam', 'homework')),
  title TEXT NOT NULL,
  course_name TEXT,
  related_course_id INTEGER,
  related_group_id INTEGER,
  task_date DATE NOT NULL,
  start_time TIME,
  end_time TIME,
  due_at TIMESTAMPTZ,
  meeting_url TEXT,
  notes TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_teacher_schedule_tasks_teacher_date
  ON teacher_schedule_tasks (teacher_id, task_date);

CREATE INDEX IF NOT EXISTS idx_teacher_schedule_tasks_date
  ON teacher_schedule_tasks (task_date);

CREATE TABLE IF NOT EXISTS teacher_schedule_reminder_settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  send_hour INTEGER NOT NULL DEFAULT 7 CHECK (send_hour BETWEEN 0 AND 23),
  send_minute INTEGER NOT NULL DEFAULT 0 CHECK (send_minute BETWEEN 0 AND 59),
  teacher_ids INTEGER[] NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);

INSERT INTO teacher_schedule_reminder_settings (id, enabled, send_hour, send_minute)
VALUES (1, FALSE, 7, 0)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS teacher_schedule_reminder_logs (
  id SERIAL PRIMARY KEY,
  teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  schedule_date DATE NOT NULL,
  job_id INTEGER REFERENCES wa_outbound_jobs(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  body TEXT NOT NULL DEFAULT '',
  phone VARCHAR(32),
  error TEXT,
  task_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (teacher_id, schedule_date)
);

CREATE INDEX IF NOT EXISTS idx_teacher_schedule_reminder_logs_date
  ON teacher_schedule_reminder_logs (schedule_date DESC, status);

CREATE INDEX IF NOT EXISTS idx_teacher_schedule_reminder_logs_job
  ON teacher_schedule_reminder_logs (job_id)
  WHERE job_id IS NOT NULL;

-- Down Migration
-- DROP TABLE IF EXISTS teacher_schedule_reminder_logs;
-- DROP TABLE IF EXISTS teacher_schedule_reminder_settings;
-- DROP TABLE IF EXISTS teacher_schedule_tasks;
-- DELETE FROM wa_services WHERE key = 'teachers_management';
