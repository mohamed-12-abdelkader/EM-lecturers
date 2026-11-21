-- Up Migration: WhatsApp Exam Assistant persistent workflow sessions

UPDATE wa_services
SET
  name = 'مساعد الامتحانات',
  description = 'إنشاء امتحانات من بنك الأسئلة أو من الملفات/الصور عبر واتساب، مراجعة المسودة، ثم النشر بعد موافقة المدرس',
  updated_at = NOW()
WHERE key = 'teacher_exam_builder_bot';

CREATE TABLE IF NOT EXISTS wa_exam_assistant_sessions (
  id SERIAL PRIMARY KEY,
  teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id INTEGER NULL REFERENCES tenants(id) ON DELETE SET NULL,
  conversation_id INTEGER NULL REFERENCES wa_conversations(id) ON DELETE SET NULL,
  contact_phone TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'IDLE'
    CHECK (state IN (
      'IDLE',
      'CHECK_TEACHER_TASK',
      'ASK_SOURCE',
      'SELECT_LESSON',
      'ASK_EXAM_SETTINGS',
      'WAITING_FOR_FILES',
      'PROCESSING_FILES',
      'EXTRACTING_QUESTIONS',
      'GENERATING_EXAM',
      'EXAM_REVIEW',
      'MODIFYING_EXAM',
      'SELECT_EXAM_TYPE',
      'SELECT_TARGET',
      'READY_TO_PUBLISH',
      'PUBLISHED',
      'FAILED',
      'CANCELLED'
    )),
  source_type TEXT NULL CHECK (source_type IN ('question_bank', 'files')),
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  exam_builder_session_id UUID NULL,
  draft_exam_id INTEGER NULL,
  draft_exam_kind TEXT NULL CHECK (draft_exam_kind IN ('lecture-exam', 'course-exam')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'completed', 'cancelled', 'failed')),
  last_error TEXT NULL,
  last_interaction_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wa_exam_assistant_sessions_teacher_active
  ON wa_exam_assistant_sessions (teacher_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_wa_exam_assistant_sessions_conversation
  ON wa_exam_assistant_sessions (conversation_id);

CREATE INDEX IF NOT EXISTS idx_wa_exam_assistant_sessions_state
  ON wa_exam_assistant_sessions (state, status);

CREATE TABLE IF NOT EXISTS wa_exam_assistant_files (
  id SERIAL PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES wa_exam_assistant_sessions(id) ON DELETE CASCADE,
  teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wa_message_id TEXT NULL,
  original_name TEXT NULL,
  mime_type TEXT NULL,
  file_path TEXT NOT NULL,
  file_size INTEGER NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wa_exam_assistant_files_session
  ON wa_exam_assistant_files (session_id, created_at);

-- Down Migration
-- DROP TABLE IF EXISTS wa_exam_assistant_files;
-- DROP TABLE IF EXISTS wa_exam_assistant_sessions;
