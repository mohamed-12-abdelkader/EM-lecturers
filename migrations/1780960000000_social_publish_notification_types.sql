-- Up Migration: notification types for social auto-publishing

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
  'custom', 'broadcast',
  'teacher_social_publish_success',
  'teacher_social_publish_failed',
  'teacher_social_needs_reauth',
  'teacher_social_pending_approval'
));

-- Down Migration
-- (re-apply previous constraint without the four teacher_social_* types)
