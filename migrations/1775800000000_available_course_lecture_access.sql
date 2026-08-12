-- Available Course: lecture access modes + assignment modes + lecture activation
-- Backward compatible defaults: always_open / lecture_based

BEGIN;

-- Course settings
ALTER TABLE courses
  ADD COLUMN IF NOT EXISTS lecture_access_mode TEXT NOT NULL DEFAULT 'always_open';

ALTER TABLE courses
  ADD COLUMN IF NOT EXISTS assignment_mode TEXT NOT NULL DEFAULT 'lecture_based';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'courses_lecture_access_mode_check'
  ) THEN
    ALTER TABLE courses
      ADD CONSTRAINT courses_lecture_access_mode_check
      CHECK (lecture_access_mode IN ('always_open', 'time_limited', 'activation_code'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'courses_assignment_mode_check'
  ) THEN
    ALTER TABLE courses
      ADD CONSTRAINT courses_assignment_mode_check
      CHECK (assignment_mode IN ('lecture_based', 'course_based'));
  END IF;
END $$;

-- Lecture expiration (used when course.lecture_access_mode = time_limited)
ALTER TABLE lectures
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- Course-level assignments: exams may belong to course without a lecture
ALTER TABLE exams
  ADD COLUMN IF NOT EXISTS course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE;

-- Backfill course_id from lecture for existing exams
UPDATE exams e
SET course_id = l.course_id
FROM lectures l
WHERE e.lecture_id = l.id
  AND e.course_id IS NULL;

-- Allow NULL lecture_id for course-based assignments
ALTER TABLE exams
  ALTER COLUMN lecture_id DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'exams_lecture_or_course_check'
  ) THEN
    ALTER TABLE exams
      ADD CONSTRAINT exams_lecture_or_course_check
      CHECK (lecture_id IS NOT NULL OR course_id IS NOT NULL);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_exams_course_id ON exams(course_id);
CREATE INDEX IF NOT EXISTS idx_exams_course_type ON exams(course_id, type) WHERE lecture_id IS NULL;

-- Lecture activation codes (when lecture_access_mode = activation_code)
CREATE TABLE IF NOT EXISTS lecture_activation_codes (
  id              SERIAL PRIMARY KEY,
  lecture_id      INTEGER NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
  course_id       INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  code            TEXT NOT NULL,
  duration_hours  NUMERIC(10, 2) NOT NULL CHECK (duration_hours > 0),
  max_uses        INTEGER NOT NULL DEFAULT 0 CHECK (max_uses >= 0), -- 0 = unlimited
  uses            INTEGER NOT NULL DEFAULT 0 CHECK (uses >= 0),
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_lecture_activation_codes_code UNIQUE (code)
);

CREATE INDEX IF NOT EXISTS idx_lecture_activation_codes_lecture
  ON lecture_activation_codes(lecture_id);
CREATE INDEX IF NOT EXISTS idx_lecture_activation_codes_course
  ON lecture_activation_codes(course_id);

-- Per-student activation window for a lecture
CREATE TABLE IF NOT EXISTS lecture_activations (
  id              SERIAL PRIMARY KEY,
  lecture_id      INTEGER NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
  course_id       INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_id         INTEGER REFERENCES lecture_activation_codes(id) ON DELETE SET NULL,
  activated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_lecture_activations_user_lecture UNIQUE (lecture_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_lecture_activations_user
  ON lecture_activations(user_id);
CREATE INDEX IF NOT EXISTS idx_lecture_activations_lecture
  ON lecture_activations(lecture_id);
CREATE INDEX IF NOT EXISTS idx_lecture_activations_expires
  ON lecture_activations(expires_at);

COMMENT ON COLUMN courses.lecture_access_mode IS 'always_open | time_limited | activation_code';
COMMENT ON COLUMN courses.assignment_mode IS 'lecture_based | course_based';
COMMENT ON TABLE lecture_activation_codes IS 'أكواد تفعيل محاضرة — مدة التفعيل تُحسب لكل طالب عند الاستخدام';
COMMENT ON TABLE lecture_activations IS 'نافذة وصول الطالب لمحاضرة بعد استخدام كود التفعيل';

COMMIT;
