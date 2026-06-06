-- Up Migration
CREATE TABLE IF NOT EXISTS course_exams (
    id SERIAL PRIMARY KEY,
    course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    image TEXT,
    questions_count INTEGER NOT NULL,
    duration INTEGER NOT NULL, -- بالدقائق
    total_grade INTEGER NOT NULL,
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Down Migration
DROP TABLE IF EXISTS course_exams; 