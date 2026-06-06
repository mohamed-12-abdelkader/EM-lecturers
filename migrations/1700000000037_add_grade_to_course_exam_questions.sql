-- Up Migration
-- إضافة عمود grade لجدول course_exam_questions
ALTER TABLE course_exam_questions ADD COLUMN IF NOT EXISTS grade INTEGER DEFAULT 1;
UPDATE course_exam_questions SET grade = 1 WHERE grade IS NULL;

-- Down Migration
ALTER TABLE course_exam_questions DROP COLUMN IF EXISTS grade; 