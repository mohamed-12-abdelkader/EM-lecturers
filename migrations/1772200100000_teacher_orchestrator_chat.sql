-- Orchestrator conversational sessions + chat messages

CREATE TABLE IF NOT EXISTS teacher_orchestrator_sessions (
  id SERIAL PRIMARY KEY,
  teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
  pending JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS teacher_orchestrator_messages (
  id SERIAL PRIMARY KEY,
  session_id INTEGER REFERENCES teacher_orchestrator_sessions(id) ON DELETE SET NULL,
  teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('teacher', 'assistant')),
  message TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orchestrator_sessions_teacher_active
  ON teacher_orchestrator_sessions(teacher_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_orchestrator_messages_teacher_created
  ON teacher_orchestrator_messages(teacher_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_orchestrator_messages_session
  ON teacher_orchestrator_messages(session_id, created_at ASC);
