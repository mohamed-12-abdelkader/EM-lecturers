-- Web Push notifications: subscriptions, extended notification fields, delivery queue

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS icon TEXT,
  ADD COLUMN IF NOT EXISTS image TEXT,
  ADD COLUMN IF NOT EXISTS url TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();

UPDATE notifications SET updated_at = COALESCE(updated_at, created_at) WHERE updated_at IS NULL;

CREATE TABLE IF NOT EXISTS web_push_subscriptions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth_key TEXT NOT NULL,
  user_agent TEXT,
  browser TEXT,
  device_label TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, endpoint)
);

CREATE INDEX IF NOT EXISTS idx_web_push_subscriptions_user_id
  ON web_push_subscriptions(user_id) WHERE is_active = TRUE;

CREATE TABLE IF NOT EXISTS notification_push_queue (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notification_id INTEGER REFERENCES notifications(id) ON DELETE SET NULL,
  subscription_id INTEGER NOT NULL REFERENCES web_push_subscriptions(id) ON DELETE CASCADE,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'dead')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  last_error TEXT,
  scheduled_at TIMESTAMP NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notification_push_queue_pending
  ON notification_push_queue(status, scheduled_at)
  WHERE status IN ('pending', 'failed');

CREATE TABLE IF NOT EXISTS notification_push_delivery_logs (
  id SERIAL PRIMARY KEY,
  queue_id INTEGER REFERENCES notification_push_queue(id) ON DELETE SET NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subscription_id INTEGER REFERENCES web_push_subscriptions(id) ON DELETE SET NULL,
  notification_id INTEGER REFERENCES notifications(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'expired_subscription')),
  response_code INTEGER,
  error_message TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notification_push_delivery_logs_user
  ON notification_push_delivery_logs(user_id, created_at DESC);

-- Expand notification types for web push / marketing events
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (
  'lecture_added', 'video_added', 'file_added',
  'social_comment', 'social_reply', 'social_like', 'social_reaction',
  'group_message', 'direct_message',
  'essay_exam_created', 'exam_graded', 'exam_added', 'exam_updated',
  'quiz_added', 'quiz_updated',
  'package_lesson_added', 'package_video_added', 'package_assignment_added',
  'package_exam_added', 'package_file_added',
  'course_update', 'course_content_update', 'live_stream_started',
  'task_assigned', 'task_deadline_reminder', 'task_rejected', 'task_approved',
  'teacher_creative_reminder',
  'course', 'lesson', 'exam', 'announcement', 'course_purchase', 'course_opened',
  'payment_confirmed', 'coupon_generated', 'cashback_added', 'assignment_deadline',
  'custom', 'broadcast'
));

CREATE OR REPLACE FUNCTION update_notifications_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_notifications_updated_at ON notifications;
CREATE TRIGGER trigger_notifications_updated_at
  BEFORE UPDATE ON notifications
  FOR EACH ROW
  EXECUTE FUNCTION update_notifications_updated_at();

CREATE OR REPLACE FUNCTION update_web_push_subscriptions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_web_push_subscriptions_updated_at ON web_push_subscriptions;
CREATE TRIGGER trigger_web_push_subscriptions_updated_at
  BEFORE UPDATE ON web_push_subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION update_web_push_subscriptions_updated_at();
