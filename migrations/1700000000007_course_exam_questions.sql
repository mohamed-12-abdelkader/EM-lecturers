-- Up Migration
CREATE TABLE IF NOT EXISTS course_exam_questions (
    id SERIAL PRIMARY KEY,
    course_exam_id INTEGER NOT NULL REFERENCES course_exams(id) ON DELETE CASCADE,
    question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    position INTEGER NOT NULL
);

-- Down Migration
DROP TABLE IF EXISTS course_exam_questions; 