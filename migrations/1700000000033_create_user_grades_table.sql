-- Up Migration
CREATE TABLE IF NOT EXISTS user_grades (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    grade_id INTEGER NOT NULL REFERENCES grades(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, grade_id)
);

-- Down Migration
DROP TABLE IF EXISTS user_grades; 