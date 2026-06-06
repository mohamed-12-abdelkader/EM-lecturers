-- Up Migration
CREATE TABLE IF NOT EXISTS course_level_exams (
    id SERIAL PRIMARY KEY,
    course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
    questions_count INTEGER NOT NULL CHECK (questions_count > 0),
    is_visible_to_students BOOLEAN NOT NULL DEFAULT TRUE,
    visibility_end_date TIMESTAMP,
    show_answers_immediately BOOLEAN NOT NULL DEFAULT TRUE,
    answers_visible_at TIMESTAMP,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_course_level_exams_course_id ON course_level_exams(course_id);

-- Down Migration
DROP TABLE IF EXISTS course_level_exams;

