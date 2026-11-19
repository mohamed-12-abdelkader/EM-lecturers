-- Up Migration: Teachers WA broadcast + subscription expiry alerts

ALTER TABLE teacher_schedule_reminder_settings
  ADD COLUMN IF NOT EXISTS subscription_alert_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS subscription_alert_hour INTEGER NOT NULL DEFAULT 10
    CHECK (subscription_alert_hour BETWEEN 0 AND 23),
  ADD COLUMN IF NOT EXISTS subscription_alert_minute INTEGER NOT NULL DEFAULT 0
    CHECK (subscription_alert_minute BETWEEN 0 AND 59),
  ADD COLUMN IF NOT EXISTS subscription_alert_message TEXT;

UPDATE teacher_schedule_reminder_settings
SET subscription_alert_message = COALESCE(
  subscription_alert_message,
  E'⚠️ *تنبيه انتهاء الاشتراك*\n\nأهلًا {{name}} 👋\n\nاشتراكك في المنصة انتهى، ويحتاج إلى تجديد للاستمرار في استخدام الخدمات.\n\nبرجاء التواصل مع الإدارة لتجديد الاشتراك.\n\nشكرًا لك ❤️'
)
WHERE id = 1;

CREATE TABLE IF NOT EXISTS teacher_wa_broadcasts (
  id SERIAL PRIMARY KEY,
  body TEXT NOT NULL DEFAULT '',
  image_url TEXT,
  video_url TEXT,
  target_mode TEXT NOT NULL DEFAULT 'all'
    CHECK (target_mode IN ('all', 'selected')),
  teacher_ids INTEGER[],
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'sending', 'done', 'failed')),
  target_count INTEGER NOT NULL DEFAULT 0,
  enqueued_count INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS teacher_wa_broadcast_recipients (
  id SERIAL PRIMARY KEY,
  broadcast_id INTEGER NOT NULL REFERENCES teacher_wa_broadcasts(id) ON DELETE CASCADE,
  teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phone VARCHAR(32),
  part_kind TEXT NOT NULL DEFAULT 'text'
    CHECK (part_kind IN ('text', 'image', 'video')),
  job_id INTEGER REFERENCES wa_outbound_jobs(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_teacher_wa_broadcast_recipients_broadcast
  ON teacher_wa_broadcast_recipients (broadcast_id, status);

CREATE TABLE IF NOT EXISTS teacher_subscription_alert_logs (
  id SERIAL PRIMARY KEY,
  teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  schedule_date DATE NOT NULL,
  ends_at DATE,
  job_id INTEGER REFERENCES wa_outbound_jobs(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  body TEXT NOT NULL DEFAULT '',
  phone VARCHAR(32),
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (teacher_id, schedule_date)
);

CREATE INDEX IF NOT EXISTS idx_teacher_subscription_alert_logs_date
  ON teacher_subscription_alert_logs (schedule_date DESC, status);

-- Down Migration
-- DROP TABLE IF EXISTS teacher_subscription_alert_logs;
-- DROP TABLE IF EXISTS teacher_wa_broadcast_recipients;
-- DROP TABLE IF EXISTS teacher_wa_broadcasts;
-- ALTER TABLE teacher_schedule_reminder_settings
--   DROP COLUMN IF EXISTS subscription_alert_enabled,
--   DROP COLUMN IF EXISTS subscription_alert_hour,
--   DROP COLUMN IF EXISTS subscription_alert_minute,
--   DROP COLUMN IF EXISTS subscription_alert_message;
