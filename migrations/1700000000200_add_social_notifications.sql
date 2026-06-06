-- إضافة أعمدة للإشعارات الاجتماعية
ALTER TABLE notifications 
ADD COLUMN IF NOT EXISTS post_id INTEGER,
ADD COLUMN IF NOT EXISTS comment_id INTEGER;

-- تحديث الإشعارات الموجودة لتتوافق مع الأنواع الجديدة
UPDATE notifications 
SET type = 'lecture_added' 
WHERE type NOT IN ('lecture_added', 'video_added', 'file_added', 'social_comment', 'social_reply', 'social_like', 'social_reaction');

-- تحديث نوع الإشعارات لتشمل الأنواع الاجتماعية
ALTER TABLE notifications 
DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE notifications 
ADD CONSTRAINT notifications_type_check 
CHECK (type IN ('lecture_added', 'video_added', 'file_added', 'social_comment', 'social_reply', 'social_like', 'social_reaction'));

-- إضافة فهارس للأعمدة الجديدة
CREATE INDEX IF NOT EXISTS idx_notifications_post_id ON notifications(post_id);
CREATE INDEX IF NOT EXISTS idx_notifications_comment_id ON notifications(comment_id);
