-- إخفاء/إظهار سؤال في امتحان المحاضرة (بدون حذفه من الامتحان)
-- Up
ALTER TABLE exam_questions
  ADD COLUMN IF NOT EXISTS is_visible BOOLEAN DEFAULT true;

COMMENT ON COLUMN exam_questions.is_visible IS 'false = مخفي من الامتحان (لا يظهر للطالب)، true = يظهر';

-- Down
ALTER TABLE exam_questions DROP COLUMN IF EXISTS is_visible;
