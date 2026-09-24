-- Teacher-scoped points & ranking (replaces global award logic for video/exams)

CREATE TABLE IF NOT EXISTS teacher_points_settings (
  id SERIAL PRIMARY KEY,
  teacher_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  video_watch_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  video_watch_points INTEGER NOT NULL DEFAULT 5 CHECK (video_watch_points >= 0),
  exam_start_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  exam_start_points INTEGER NOT NULL DEFAULT 5 CHECK (exam_start_points >= 0),
  assignment_start_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  assignment_start_points INTEGER NOT NULL DEFAULT 3 CHECK (assignment_start_points >= 0),
  exam_score_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  assignment_score_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_teacher_points_settings_teacher
  ON teacher_points_settings(teacher_id);

CREATE TABLE IF NOT EXISTS student_point_balances (
  id SERIAL PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  grade_id INTEGER NOT NULL REFERENCES grades(id) ON DELETE CASCADE,
  total_points INTEGER NOT NULL DEFAULT 0 CHECK (total_points >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (student_id, teacher_id, grade_id)
);

CREATE INDEX IF NOT EXISTS idx_student_point_balances_leaderboard
  ON student_point_balances(teacher_id, grade_id, total_points DESC);

CREATE INDEX IF NOT EXISTS idx_student_point_balances_student
  ON student_point_balances(student_id);

CREATE TABLE IF NOT EXISTS point_transactions (
  id SERIAL PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  grade_id INTEGER NOT NULL REFERENCES grades(id) ON DELETE CASCADE,
  points INTEGER NOT NULL CHECK (points >= 0),
  event_type VARCHAR(40) NOT NULL,
  reference_type VARCHAR(40),
  reference_id INTEGER,
  reference_key TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT point_transactions_event_type_check CHECK (
    event_type IN (
      'VIDEO_WATCH',
      'EXAM_START',
      'EXAM_SCORE',
      'ASSIGNMENT_START',
      'ASSIGNMENT_SCORE',
      'MANUAL_REWARD',
      'LIVE_ATTENDANCE',
      'COURSE_COMPLETION',
      'DAILY_LOGIN',
      'CONTEST_WIN'
    )
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_point_transactions_reference_key
  ON point_transactions(reference_key);

CREATE INDEX IF NOT EXISTS idx_point_transactions_student
  ON point_transactions(student_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_point_transactions_teacher_grade
  ON point_transactions(teacher_id, grade_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_point_transactions_event
  ON point_transactions(event_type, reference_id);
