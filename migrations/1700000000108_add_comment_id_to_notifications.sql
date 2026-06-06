-- Up Migration
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS comment_id INTEGER REFERENCES lecture_comments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_comment_id ON notifications(comment_id);

-- Down Migration
ALTER TABLE notifications DROP COLUMN IF EXISTS comment_id;




