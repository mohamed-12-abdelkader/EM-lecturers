-- Exam builder chatbot: sessions + message history

CREATE TABLE IF NOT EXISTS exam_builder_chatbot_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed', 'approved', 'cancelled')),
  user_message TEXT NOT NULL,
  parsed_filters JSONB NOT NULL DEFAULT '{}'::jsonb,
  selected_questions JSONB NOT NULL DEFAULT '[]'::jsonb,
  shown_question_ids INTEGER[] NOT NULL DEFAULT '{}',
  available_count INTEGER NOT NULL DEFAULT 0,
  requested_count INTEGER NOT NULL DEFAULT 0,
  exam_id INTEGER NULL,
  exam_type TEXT NULL CHECK (exam_type IS NULL OR exam_type IN ('lecture-exam', 'course-exam')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_exam_builder_sessions_teacher_created
  ON exam_builder_chatbot_sessions(teacher_id, created_at DESC);

CREATE TABLE IF NOT EXISTS exam_builder_chatbot_messages (
  id SERIAL PRIMARY KEY,
  teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id UUID NULL REFERENCES exam_builder_chatbot_sessions(id) ON DELETE SET NULL,
  role TEXT NOT NULL CHECK (role IN ('teacher', 'assistant')),
  message TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_exam_builder_messages_teacher_created
  ON exam_builder_chatbot_messages(teacher_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_exam_builder_messages_session
  ON exam_builder_chatbot_messages(session_id, created_at ASC);
