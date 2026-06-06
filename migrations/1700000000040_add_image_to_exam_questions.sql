-- Up Migration
-- إضافة عمود image لجدول exam_questions
ALTER TABLE exam_questions ADD COLUMN IF NOT EXISTS image TEXT;

-- Down Migration
ALTER TABLE exam_questions DROP COLUMN IF EXISTS image; 