-- Teacher platform orchestrator agent — command history

CREATE TABLE IF NOT EXISTS teacher_orchestrator_commands (
  id SERIAL PRIMARY KEY,
  teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  command TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'execute' CHECK (mode IN ('plan', 'execute')),
  success BOOLEAN NOT NULL DEFAULT FALSE,
  actions JSONB NOT NULL DEFAULT '[]'::jsonb,
  results JSONB NOT NULL DEFAULT '[]'::jsonb,
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_teacher_orchestrator_commands_teacher_created
  ON teacher_orchestrator_commands(teacher_id, created_at DESC);
