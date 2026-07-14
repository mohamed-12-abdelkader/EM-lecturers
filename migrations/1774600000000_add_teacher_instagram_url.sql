-- Up Migration
-- Add Instagram link for teacher social / platform contact links

ALTER TABLE users ADD COLUMN IF NOT EXISTS instagram_url TEXT;

COMMENT ON COLUMN users.instagram_url IS 'رابط حساب/بيدج إنستجرام للمدرس';

-- Down Migration
ALTER TABLE users DROP COLUMN IF EXISTS instagram_url;
