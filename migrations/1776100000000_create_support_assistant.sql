-- نظام مساعد الدعم الفني (ضيف / طالب) — بعد حذف الجداول القديمة

BEGIN;

CREATE TABLE IF NOT EXISTS support_chats (
  id SERIAL PRIMARY KEY,
  student_id INTEGER REFERENCES users (id) ON DELETE SET NULL,
  guest_token VARCHAR(64) UNIQUE,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'closed')),
  current_intent VARCHAR(64),
  context_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_message_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_support_chats_student_id_unique
  ON support_chats (student_id)
  WHERE student_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_support_chats_guest_token
  ON support_chats (guest_token)
  WHERE guest_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_support_chats_last_message
  ON support_chats (last_message_at DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS support_messages (
  id SERIAL PRIMARY KEY,
  chat_id INTEGER NOT NULL REFERENCES support_chats (id) ON DELETE CASCADE,
  sender_id INTEGER REFERENCES users (id) ON DELETE SET NULL,
  sender_role TEXT NOT NULL
    CHECK (sender_role IN ('student', 'guest', 'bot')),
  text TEXT NOT NULL,
  intent VARCHAR(64),
  meta_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_support_messages_chat_created
  ON support_messages (chat_id, created_at ASC);

COMMIT;
