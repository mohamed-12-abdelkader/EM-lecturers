-- Link exam questions to teacher private question library (teacher_questions)

BEGIN;

ALTER TABLE exam_questions
  ADD COLUMN IF NOT EXISTS teacher_question_id INTEGER
  REFERENCES teacher_questions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_exam_questions_teacher_question_id
  ON exam_questions(teacher_question_id)
  WHERE teacher_question_id IS NOT NULL;

ALTER TABLE course_level_exam_questions
  ADD COLUMN IF NOT EXISTS teacher_question_id INTEGER
  REFERENCES teacher_questions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_course_level_exam_questions_teacher_question_id
  ON course_level_exam_questions(teacher_question_id)
  WHERE teacher_question_id IS NOT NULL;

COMMIT;
