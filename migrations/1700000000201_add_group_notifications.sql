-- إضافة أعمدة لإشعارات المجموعات
ALTER TABLE notifications 
ADD COLUMN IF NOT EXISTS group_id INTEGER,
ADD COLUMN IF NOT EXISTS sender_id INTEGER,
ADD COLUMN IF NOT EXISTS metadata JSONB;

-- تحديث نوع الإشعارات لتشمل إشعارات المجموعات
ALTER TABLE notifications 
DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE notifications 
ADD CONSTRAINT notifications_type_check 
CHECK (type IN ('lecture_added', 'video_added', 'file_added', 'social_comment', 'social_reply', 'social_like', 'social_reaction', 'group_message'));

-- إضافة فهارس للأعمدة الجديدة
CREATE INDEX IF NOT EXISTS idx_notifications_group_id ON notifications(group_id);
CREATE INDEX IF NOT EXISTS idx_notifications_sender_id ON notifications(sender_id);
CREATE INDEX IF NOT EXISTS idx_notifications_metadata ON notifications USING GIN(metadata);
