-- Up Migration
-- إضافة عمود image لجدول questions
ALTER TABLE questions ADD COLUMN IF NOT EXISTS image TEXT;

-- Down Migration
ALTER TABLE questions DROP COLUMN IF EXISTS image; 