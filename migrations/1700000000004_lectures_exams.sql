-- Up Migration

CREATE TABLE IF NOT EXISTS exams (
    id SERIAL PRIMARY KEY,
    lecture_id INTEGER NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
    type VARCHAR(20) NOT NULL, -- exam or assignment
    total_grade INTEGER NOT NULL,
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    title TEXT
);

CREATE TABLE IF NOT EXISTS exam_questions (
    id SERIAL PRIMARY KEY,
    exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
    question_text TEXT NOT NULL,
    grade INTEGER NOT NULL
    -- يمكن إضافة أعمدة أخرى مثل نوع السؤال لاحقاً
);

CREATE TABLE IF NOT EXISTS exam_submissions (
    id SERIAL PRIMARY KEY,
    exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
    student_id INTEGER NOT NULL REFERENCES users(id),
    submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    total_grade INTEGER,
    passed BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS exam_answers (
    id SERIAL PRIMARY KEY,
    submission_id INTEGER NOT NULL REFERENCES exam_submissions(id) ON DELETE CASCADE,
    question_id INTEGER NOT NULL REFERENCES exam_questions(id) ON DELETE CASCADE,
    answer_text TEXT,
    grade INTEGER
);

-- Down Migration

DROP TABLE IF EXISTS exam_answers;
DROP TABLE IF EXISTS exam_submissions;
DROP TABLE IF EXISTS exam_questions;
DROP TABLE IF EXISTS exams; 