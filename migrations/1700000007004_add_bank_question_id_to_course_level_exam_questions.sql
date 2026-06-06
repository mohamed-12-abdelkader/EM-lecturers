-- ربط سؤال امتحان الكورس بمعرّف السؤال في البنك (لتمكين الحذف والتحديث بمعرّف البنك إن لزم)
-- Up
ALTER TABLE course_level_exam_questions
  ADD COLUMN IF NOT EXISTS question_id_v2 INTEGER NULL REFERENCES questions_v2(id) ON DELETE SET NULL;

ALTER TABLE course_level_exam_questions
  ADD COLUMN IF NOT EXISTS question_id INTEGER NULL REFERENCES questions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_course_level_exam_questions_question_id_v2
  ON course_level_exam_questions(question_id_v2) WHERE question_id_v2 IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_course_level_exam_questions_question_id
  ON course_level_exam_questions(question_id) WHERE question_id IS NOT NULL;

-- Down
DROP INDEX IF EXISTS idx_course_level_exam_questions_question_id;
DROP INDEX IF EXISTS idx_course_level_exam_questions_question_id_v2;
ALTER TABLE course_level_exam_questions DROP COLUMN IF EXISTS question_id_v2;
ALTER TABLE course_level_exam_questions DROP COLUMN IF EXISTS question_id;
