-- Up Migration
CREATE TABLE IF NOT EXISTS general_course_lectures (
    id SERIAL PRIMARY KEY,
    general_course_id INTEGER NOT NULL REFERENCES general_courses(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS general_course_videos (
    id SERIAL PRIMARY KEY,
    lecture_id INTEGER NOT NULL REFERENCES general_course_lectures(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_general_course_lectures_course_id ON general_course_lectures(general_course_id);
CREATE INDEX IF NOT EXISTS idx_general_course_videos_lecture_id ON general_course_videos(lecture_id);

-- Down Migration
DROP TABLE IF EXISTS general_course_videos;
DROP TABLE IF EXISTS general_course_lectures;
