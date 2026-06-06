-- Tasks workflow: notifications, reminders, comments/attachments authors, deadline reminder flag

-- إشعارات المهام + ربط الإشعار بمهمة
ALTER TABLE notifications
ADD COLUMN IF NOT EXISTS task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_notifications_task_id ON notifications(task_id);

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
  'live_stream_started',
  'task_assigned',
  'task_deadline_reminder',
  'task_rejected',
  'task_approved'
));

-- تذكير الموعد (مرة واحدة قبل يوم من التسليم)
ALTER TABLE tasks
ADD COLUMN IF NOT EXISTS deadline_reminder_sent_at TIMESTAMP;

-- تعليقات المهام: دعم الأدمن (user) وليس فقط employee
ALTER TABLE task_comments
ADD COLUMN IF NOT EXISTS author_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;

UPDATE task_comments tc
SET author_user_id = e.user_id
FROM employees e
WHERE tc.employee_id = e.id AND tc.author_user_id IS NULL;

ALTER TABLE task_comments
ALTER COLUMN employee_id DROP NOT NULL;

-- مرفقات المهام: رفع من الأدمن أو الموظف عبر user_id
ALTER TABLE task_attachments
ADD COLUMN IF NOT EXISTS uploaded_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;

UPDATE task_attachments ta
SET uploaded_by_user_id = e.user_id
FROM employees e
WHERE ta.uploaded_by = e.id AND ta.uploaded_by_user_id IS NULL;

ALTER TABLE task_attachments
ALTER COLUMN uploaded_by DROP NOT NULL;
