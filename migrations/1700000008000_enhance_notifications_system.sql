-- Up Migration
-- Enhance notifications system for comprehensive event-based notifications

-- Ensure all notification columns exist
ALTER TABLE notifications 
ADD COLUMN IF NOT EXISTS description TEXT,
ADD COLUMN IF NOT EXISTS general_course_id INTEGER REFERENCES general_courses(id) ON DELETE CASCADE;

-- Update type constraint to include all notification types
ALTER TABLE notifications 
DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE notifications 
ADD CONSTRAINT notifications_type_check 
CHECK (type IN (
  'lecture_added',
  'video_added',
  'file_added',
  'social_comment',
  'social_reply',
  'social_like',
  'social_reaction',
  'group_message',
  'direct_message',
  'essay_exam_created',
  'exam_graded',
  'exam_added',
  'exam_updated',
  'quiz_added',
  'quiz_updated',
  'package_lesson_added',
  'package_video_added',
  'package_assignment_added',
  'package_exam_added',
  'package_file_added',
  'course_update',
  'course_content_update',
  'live_stream_started'
));

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_notifications_user_id_created_at ON notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id_is_read ON notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_general_course_id ON notifications(general_course_id);
CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);

-- Down Migration
-- ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
-- ALTER TABLE notifications DROP COLUMN IF EXISTS description;
-- ALTER TABLE notifications DROP COLUMN IF EXISTS general_course_id;
-- DROP INDEX IF EXISTS idx_notifications_user_id_created_at;
-- DROP INDEX IF EXISTS idx_notifications_user_id_is_read;
-- DROP INDEX IF EXISTS idx_notifications_general_course_id;
-- DROP INDEX IF EXISTS idx_notifications_type;
