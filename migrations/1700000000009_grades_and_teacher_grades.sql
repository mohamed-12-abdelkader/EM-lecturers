-- Up Migration
CREATE TABLE IF NOT EXISTS grades (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    level INTEGER,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_grades_name ON grades(name);
CREATE INDEX IF NOT EXISTS idx_grades_level ON grades(level);
CREATE INDEX IF NOT EXISTS idx_grades_is_active ON grades(is_active);

CREATE TABLE IF NOT EXISTS teacher_grades (
    id SERIAL PRIMARY KEY,
    teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    grade_id INTEGER NOT NULL REFERENCES grades(id) ON DELETE CASCADE,
    UNIQUE (teacher_id, grade_id)
);

-- Down Migration
DROP TABLE IF EXISTS teacher_grades;
DROP TABLE IF EXISTS grades; 