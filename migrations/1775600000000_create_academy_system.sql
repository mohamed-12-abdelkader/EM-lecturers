-- Academy tables + tenant platform_type
-- Note: enum values for academy / academy_teacher are added in 1775500000000

BEGIN;

-- Teacher platform (default) vs Academy platform
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS platform_type TEXT NOT NULL DEFAULT 'teacher';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenants_platform_type_check'
  ) THEN
    ALTER TABLE tenants
      ADD CONSTRAINT tenants_platform_type_check
      CHECK (platform_type IN ('teacher', 'academy'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tenants_platform_type ON tenants(platform_type);

-- Optional subject label on courses (academy + teacher)
ALTER TABLE courses
  ADD COLUMN IF NOT EXISTS subject TEXT;

ALTER TABLE courses
  ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_courses_tenant_id ON courses(tenant_id);

-- Academy membership: academy_teacher users belonging to an academy tenant
CREATE TABLE IF NOT EXISTS academy_teachers (
  id              SERIAL PRIMARY KEY,
  tenant_id       INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive', 'suspended')),
  subject         TEXT,
  created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_academy_teachers_user UNIQUE (user_id),
  CONSTRAINT uq_academy_teachers_tenant_user UNIQUE (tenant_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_academy_teachers_tenant ON academy_teachers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_academy_teachers_status ON academy_teachers(tenant_id, status);

COMMENT ON TABLE academy_teachers IS 'مدرسو الأكاديمية — role=academy_teacher مرتبط بمنصة academy';

-- Course managers: assign academy_teacher (or future roles) to courses (many-to-many)
CREATE TABLE IF NOT EXISTS course_managers (
  id              SERIAL PRIMARY KEY,
  course_id       INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id       INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  assigned_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  is_primary      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_course_managers_course_user UNIQUE (course_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_course_managers_user ON course_managers(user_id);
CREATE INDEX IF NOT EXISTS idx_course_managers_course ON course_managers(course_id);
CREATE INDEX IF NOT EXISTS idx_course_managers_tenant ON course_managers(tenant_id);

COMMENT ON TABLE course_managers IS 'إسناد إدارة كورس لمدرس أكاديمية (قابل لتعدد المدرسين لاحقاً)';

-- Touch updated_at
CREATE OR REPLACE FUNCTION academy_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_academy_teachers_updated ON academy_teachers;
CREATE TRIGGER trg_academy_teachers_updated
  BEFORE UPDATE ON academy_teachers
  FOR EACH ROW EXECUTE FUNCTION academy_touch_updated_at();

DROP TRIGGER IF EXISTS trg_course_managers_updated ON course_managers;
CREATE TRIGGER trg_course_managers_updated
  BEFORE UPDATE ON course_managers
  FOR EACH ROW EXECUTE FUNCTION academy_touch_updated_at();

COMMIT;
