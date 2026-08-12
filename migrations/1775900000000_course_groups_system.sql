-- Course Groups: independent from centerMgmt / study_groups / attendance
-- Backward compatible: course_group_access_enabled defaults to false, lectures.access_type defaults to 'all'

BEGIN;

-- Teacher-level toggle for course group targeting
CREATE TABLE IF NOT EXISTS teacher_course_settings (
  id                           SERIAL PRIMARY KEY,
  teacher_id                   INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  course_group_access_enabled  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_teacher_course_settings_teacher
  ON teacher_course_settings(teacher_id);

-- Groups scoped to teacher + grade (course platform only)
CREATE TABLE IF NOT EXISTS course_groups (
  id          SERIAL PRIMARY KEY,
  teacher_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  grade_id    INTEGER NOT NULL REFERENCES grades(id) ON DELETE RESTRICT,
  name        TEXT NOT NULL,
  description TEXT,
  status      TEXT NOT NULL DEFAULT 'active',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT course_groups_status_check CHECK (status IN ('active', 'inactive'))
);

CREATE INDEX IF NOT EXISTS idx_course_groups_teacher ON course_groups(teacher_id);
CREATE INDEX IF NOT EXISTS idx_course_groups_grade ON course_groups(grade_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_course_groups_teacher_grade_name
  ON course_groups(teacher_id, grade_id, lower(name))
  WHERE status = 'active';

-- Student membership in a course group (one active group per teacher enforced in service layer)
CREATE TABLE IF NOT EXISTS student_course_group_memberships (
  id          SERIAL PRIMARY KEY,
  student_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id    INTEGER NOT NULL REFERENCES course_groups(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_student_course_group_membership UNIQUE (student_id, group_id)
);

CREATE INDEX IF NOT EXISTS idx_scgm_student ON student_course_group_memberships(student_id);
CREATE INDEX IF NOT EXISTS idx_scgm_group ON student_course_group_memberships(group_id);

-- Lecture audience targeting
ALTER TABLE lectures
  ADD COLUMN IF NOT EXISTS access_type TEXT NOT NULL DEFAULT 'all';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'lectures_access_type_check'
  ) THEN
    ALTER TABLE lectures
      ADD CONSTRAINT lectures_access_type_check
      CHECK (access_type IN ('all', 'groups'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS lecture_course_groups (
  lecture_id  INTEGER NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
  group_id    INTEGER NOT NULL REFERENCES course_groups(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (lecture_id, group_id)
);

CREATE INDEX IF NOT EXISTS idx_lecture_course_groups_group ON lecture_course_groups(group_id);

COMMENT ON TABLE teacher_course_settings IS 'إعدادات المدرس لنظام مجموعات الكورسات (مستقل عن السنتر)';
COMMENT ON TABLE course_groups IS 'مجموعات طلاب الكورسات — مرتبطة بالمدرس والصف';
COMMENT ON TABLE student_course_group_memberships IS 'عضوية الطالب في مجموعة كورسات';
COMMENT ON TABLE lecture_course_groups IS 'ربط المحاضرة بمجموعات مستهدفة عند access_type=groups';

COMMIT;
