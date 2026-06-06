-- Up Migration
CREATE TABLE IF NOT EXISTS teacher_activity_log (
    id SERIAL PRIMARY KEY,
    teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action TEXT NOT NULL, -- مثال: 'add_chapter', 'edit_question', 'delete_part', ...
    entity_type TEXT NOT NULL, -- مثال: 'chapter', 'lesson', 'part', 'question'
    entity_id INTEGER,
    description TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Down Migration
DROP TABLE IF EXISTS teacher_activity_log; 