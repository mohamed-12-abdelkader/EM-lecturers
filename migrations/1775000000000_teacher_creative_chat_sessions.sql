-- Conversational sessions for teacher creative (social media) chatbot.
-- Discuss marketing ideas and drafts before executing post/image generation.

CREATE TABLE IF NOT EXISTS teacher_creative_chat_sessions (
  id SERIAL PRIMARY KEY,
  teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  preferred_output TEXT CHECK (
    preferred_output IS NULL OR preferred_output IN ('post', 'image', 'auto')
  ),
  platform TEXT,
  tone TEXT,
  aspect_ratio TEXT,
  language_mode TEXT,
  pending JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS teacher_creative_chat_messages (
  id SERIAL PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES teacher_creative_chat_sessions(id) ON DELETE CASCADE,
  teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  message TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_teacher_creative_chat_sessions_teacher_active
  ON teacher_creative_chat_sessions(teacher_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_teacher_creative_chat_messages_session
  ON teacher_creative_chat_messages(session_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_teacher_creative_chat_messages_teacher
  ON teacher_creative_chat_messages(teacher_id, created_at DESC);
