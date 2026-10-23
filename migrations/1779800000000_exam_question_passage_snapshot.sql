-- Snapshot passage text onto exam question rows so passage content survives
-- even when library/bank links are missing or partial updates omit the field.

ALTER TABLE exam_questions
  ADD COLUMN IF NOT EXISTS passage_text TEXT,
  ADD COLUMN IF NOT EXISTS passage_title TEXT;

ALTER TABLE course_level_exam_questions
  ADD COLUMN IF NOT EXISTS passage_text TEXT,
  ADD COLUMN IF NOT EXISTS passage_title TEXT;

COMMENT ON COLUMN exam_questions.passage_text IS
  'Durable copy of reading-passage content for passage-based exam questions';
COMMENT ON COLUMN course_level_exam_questions.passage_text IS
  'Durable copy of reading-passage content for passage-based exam questions';
