BEGIN;

-- Expand attachment_type to include 'audio' and add optional duration
ALTER TABLE chat_messages DROP CONSTRAINT IF EXISTS chat_messages_attachment_type_check;
ALTER TABLE chat_messages ADD CONSTRAINT chat_messages_attachment_type_check CHECK (attachment_type IN ('image','file','audio'));

ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS attachment_duration_ms INTEGER;

COMMIT;



