-- Teacher data analyst chatbot message history

CREATE TABLE IF NOT EXISTS teacher_data_analyst_messages (
  id SERIAL PRIMARY KEY,
  teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('teacher', 'assistant')),
  message TEXT NOT NULL,
  report_type TEXT CHECK (report_type IN ('student', 'course', 'general', 'other')),
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_teacher_data_analyst_messages_teacher_created
  ON teacher_data_analyst_messages(teacher_id, created_at DESC);
