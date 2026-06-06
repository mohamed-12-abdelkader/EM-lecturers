-- Up Migration
-- إضافة حقول التواصل الاجتماعي للمدرسين

-- إضافة رابط الفيسبوك
ALTER TABLE users ADD COLUMN IF NOT EXISTS facebook_url TEXT;

-- إضافة رابط اليوتيوب
ALTER TABLE users ADD COLUMN IF NOT EXISTS youtube_url TEXT;

-- إضافة رابط التيك توك
ALTER TABLE users ADD COLUMN IF NOT EXISTS tiktok_url TEXT;

-- إضافة رقم الواتساب
ALTER TABLE users ADD COLUMN IF NOT EXISTS whatsapp_number TEXT;

-- Down Migration
ALTER TABLE users DROP COLUMN IF EXISTS facebook_url;
ALTER TABLE users DROP COLUMN IF EXISTS youtube_url;
ALTER TABLE users DROP COLUMN IF EXISTS tiktok_url;
ALTER TABLE users DROP COLUMN IF EXISTS whatsapp_number;

