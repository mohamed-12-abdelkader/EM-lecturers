-- إضافة أعمدة لتثبيت البوستات
ALTER TABLE social_posts 
ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS pinned_order INTEGER DEFAULT NULL;

-- إضافة فهرس للأعمدة الجديدة
CREATE INDEX IF NOT EXISTS idx_social_posts_pinned ON social_posts(is_pinned, pinned_order);

