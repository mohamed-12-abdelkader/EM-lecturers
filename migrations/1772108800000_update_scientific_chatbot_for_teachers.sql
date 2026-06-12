-- Up Migration
ALTER TABLE course_content_files ALTER COLUMN course_id DROP NOT NULL;

ALTER TABLE scientific_chat_history ALTER COLUMN course_id DROP NOT NULL;
ALTER TABLE scientific_chat_history ADD COLUMN teacher_id INTEGER REFERENCES users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_scientific_chat_history_teacher_id ON scientific_chat_history(teacher_id);

-- Down Migration
DROP INDEX IF EXISTS idx_scientific_chat_history_teacher_id;
ALTER TABLE scientific_chat_history DROP COLUMN teacher_id;
DELETE FROM course_content_files WHERE course_id IS NULL;
ALTER TABLE course_content_files ALTER COLUMN course_id SET NOT NULL;
DELETE FROM scientific_chat_history WHERE course_id IS NULL;
ALTER TABLE scientific_chat_history ALTER COLUMN course_id SET NOT NULL;
