-- Up Migration
CREATE TABLE IF NOT EXISTS course_exam_submissions (
    id SERIAL PRIMARY KEY,
    exam_id INTEGER NOT NULL REFERENCES course_exams(id) ON DELETE CASCADE,
    student_id INTEGER NOT NULL REFERENCES users(id),
    submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    total_grade INTEGER,
    passed BOOLEAN DEFAULT FALSE
);

-- Down Migration
DROP TABLE IF EXISTS course_exam_submissions; 