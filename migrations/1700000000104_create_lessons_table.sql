-- -- Create lessons table (chapter-scoped)

-- CREATE TABLE IF NOT EXISTS lessons (
--   id SERIAL PRIMARY KEY,
--   chapter_id INTEGER NOT NULL,
--   name TEXT NOT NULL,
--   description TEXT,
--   image_url TEXT,
--   created_by INTEGER,
--   created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
--   updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
-- );

-- -- FKs
-- DO $$
-- BEGIN
--   IF NOT EXISTS (
--     SELECT 1 FROM information_schema.table_constraints
--     WHERE constraint_type = 'FOREIGN KEY'
--       AND table_name = 'lessons'
--       AND constraint_name = 'fk_lessons_chapter_id'
--   ) THEN
--     ALTER TABLE lessons
--       ADD CONSTRAINT fk_lessons_chapter_id
--       FOREIGN KEY (chapter_id)
--       REFERENCES chapters(id)
--       ON DELETE CASCADE;
--   END IF;
-- END $$;

-- DO $$
-- BEGIN
--   IF NOT EXISTS (
--     SELECT 1 FROM information_schema.table_constraints
--     WHERE constraint_type = 'FOREIGN KEY'
--       AND table_name = 'lessons'
--       AND constraint_name = 'fk_lessons_created_by'
--   ) THEN
--     ALTER TABLE lessons
--       ADD CONSTRAINT fk_lessons_created_by
--       FOREIGN KEY (created_by)
--       REFERENCES users(id)
--       ON DELETE SET NULL;
--   END IF;
-- END $$;

-- -- Unique per chapter: (chapter_id, lower(name))
-- DO $$
-- BEGIN
--   IF NOT EXISTS (
--     SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'uniq_lessons_chapter_name'
--   ) THEN
--     CREATE UNIQUE INDEX uniq_lessons_chapter_name ON lessons (chapter_id, LOWER(name));
--   END IF;
-- END $$;

-- -- updated_at trigger
-- CREATE OR REPLACE FUNCTION trg_set_lessons_updated_at() RETURNS TRIGGER AS $$
-- BEGIN
--   NEW.updated_at = CURRENT_TIMESTAMP;
--   RETURN NEW;
-- END;
-- $$ LANGUAGE plpgsql;

-- DO $$
-- BEGIN
--   IF NOT EXISTS (
--     SELECT 1 FROM information_schema.triggers WHERE event_object_table = 'lessons' AND trigger_name = 'set_lessons_updated_at'
--   ) THEN
--     CREATE TRIGGER set_lessons_updated_at BEFORE UPDATE ON lessons FOR EACH ROW EXECUTE FUNCTION trg_set_lessons_updated_at();
--   END IF;
-- END $$;


