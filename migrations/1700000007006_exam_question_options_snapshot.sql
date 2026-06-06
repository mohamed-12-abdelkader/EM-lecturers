-- نسخة الخيارات داخل امتحان المحاضرة (snapshot) لربط الأسئلة المضافة من البنك دون التأثير على البنك
-- Up
CREATE TABLE IF NOT EXISTS exam_question_options (
  id SERIAL PRIMARY KEY,
  exam_question_id INTEGER NOT NULL REFERENCES exam_questions(id) ON DELETE CASCADE,
  option_index INTEGER NOT NULL CHECK (option_index >= 0 AND option_index <= 3),
  text_content TEXT,
  UNIQUE(exam_question_id, option_index)
);

CREATE INDEX IF NOT EXISTS idx_exam_question_options_exam_question
  ON exam_question_options(exam_question_id);

COMMENT ON TABLE exam_question_options IS 'نسخة خيارات السؤال داخل الامتحان (مرجع السؤال الأصلي في exam_questions.question_id_v2 أو question_id)';

-- Down
DROP INDEX IF EXISTS idx_exam_question_options_exam_question;
DROP TABLE IF EXISTS exam_question_options;
