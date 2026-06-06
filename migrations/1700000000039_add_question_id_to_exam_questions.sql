-- Up Migration
-- إضافة عمود question_id لجدول exam_questions
ALTER TABLE exam_questions ADD COLUMN IF NOT EXISTS question_id INTEGER REFERENCES questions(id);

-- Down Migration
ALTER TABLE exam_questions DROP COLUMN IF EXISTS question_id; 