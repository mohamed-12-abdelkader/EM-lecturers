-- Archive teacher point balances/transactions on reset so history can be restored later.

CREATE TABLE IF NOT EXISTS teacher_points_seasons (
  id SERIAL PRIMARY KEY,
  teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  grade_id INTEGER NULL REFERENCES grades(id) ON DELETE SET NULL,
  label TEXT,
  reason TEXT,
  archived_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  students_count INTEGER NOT NULL DEFAULT 0 CHECK (students_count >= 0),
  total_points_sum INTEGER NOT NULL DEFAULT 0 CHECK (total_points_sum >= 0),
  transactions_count INTEGER NOT NULL DEFAULT 0 CHECK (transactions_count >= 0),
  source VARCHAR(40) NOT NULL DEFAULT 'reset'
    CHECK (source IN ('reset', 'pre_restore_backup')),
  archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_teacher_points_seasons_teacher
  ON teacher_points_seasons(teacher_id, archived_at DESC);

CREATE INDEX IF NOT EXISTS idx_teacher_points_seasons_teacher_grade
  ON teacher_points_seasons(teacher_id, grade_id, archived_at DESC);

CREATE TABLE IF NOT EXISTS student_point_balance_archives (
  id SERIAL PRIMARY KEY,
  season_id INTEGER NOT NULL REFERENCES teacher_points_seasons(id) ON DELETE CASCADE,
  original_balance_id INTEGER,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  grade_id INTEGER NOT NULL REFERENCES grades(id) ON DELETE CASCADE,
  total_points INTEGER NOT NULL DEFAULT 0 CHECK (total_points >= 0),
  balance_created_at TIMESTAMPTZ,
  balance_updated_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_student_point_balance_archives_season
  ON student_point_balance_archives(season_id);

CREATE INDEX IF NOT EXISTS idx_student_point_balance_archives_student
  ON student_point_balance_archives(season_id, student_id);

CREATE TABLE IF NOT EXISTS point_transaction_archives (
  id SERIAL PRIMARY KEY,
  season_id INTEGER NOT NULL REFERENCES teacher_points_seasons(id) ON DELETE CASCADE,
  original_transaction_id INTEGER,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  grade_id INTEGER NOT NULL REFERENCES grades(id) ON DELETE CASCADE,
  points INTEGER NOT NULL CHECK (points >= 0),
  event_type VARCHAR(40) NOT NULL,
  reference_type VARCHAR(40),
  reference_id INTEGER,
  reference_key TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  transaction_created_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_point_transaction_archives_season
  ON point_transaction_archives(season_id);

CREATE INDEX IF NOT EXISTS idx_point_transaction_archives_student
  ON point_transaction_archives(season_id, student_id, transaction_created_at DESC);

CREATE INDEX IF NOT EXISTS idx_point_transaction_archives_ref
  ON point_transaction_archives(season_id, reference_key);
