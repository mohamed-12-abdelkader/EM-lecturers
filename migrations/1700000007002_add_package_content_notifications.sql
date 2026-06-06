-- Up Migration
-- إضافة أنواع إشعارات جديدة لمحتوى الباقة

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
  'essay_exam_created',
  'exam_graded',
  'package_lesson_added',
  'package_video_added',
  'package_assignment_added',
  'package_exam_added',
  'package_file_added'
));

-- إضافة حقول جديدة للإشعارات المتعلقة بمحتوى الباقة
ALTER TABLE notifications 
ADD COLUMN IF NOT EXISTS package_id INTEGER REFERENCES packages(id) ON DELETE CASCADE,
ADD COLUMN IF NOT EXISTS subject_id INTEGER REFERENCES package_subject_items(id) ON DELETE CASCADE,
ADD COLUMN IF NOT EXISTS lesson_id INTEGER REFERENCES package_subject_item_lessons(id) ON DELETE CASCADE,
ADD COLUMN IF NOT EXISTS assignment_id INTEGER REFERENCES package_subject_item_lesson_assignments (id) ON DELETE CASCADE,
ADD COLUMN IF NOT EXISTS exam_id INTEGER REFERENCES package_subject_exams (id) ON DELETE CASCADE,
ADD COLUMN IF NOT EXISTS video_id INTEGER REFERENCES package_subject_item_lesson_videos (id) ON DELETE CASCADE;

-- إنشاء indexes
CREATE INDEX IF NOT EXISTS idx_notifications_package_id ON notifications(package_id);
CREATE INDEX IF NOT EXISTS idx_notifications_subject_id ON notifications(subject_id);
CREATE INDEX IF NOT EXISTS idx_notifications_lesson_id ON notifications(lesson_id);
CREATE INDEX IF NOT EXISTS idx_notifications_assignment_id ON notifications(assignment_id);
CREATE INDEX IF NOT EXISTS idx_notifications_exam_id ON notifications(exam_id);
CREATE INDEX IF NOT EXISTS idx_notifications_video_id ON notifications(video_id);

-- Down Migration
ALTER TABLE notifications 
DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE notifications 
DROP COLUMN IF EXISTS package_id,
DROP COLUMN IF EXISTS subject_id,
DROP COLUMN IF EXISTS lesson_id,
DROP COLUMN IF EXISTS assignment_id,
DROP COLUMN IF EXISTS exam_id,
DROP COLUMN IF EXISTS video_id;
