-- Up Migration
ALTER TABLE scientific_chat_history ADD COLUMN images JSONB;

-- Down Migration
ALTER TABLE scientific_chat_history DROP COLUMN images;
