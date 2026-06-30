-- Up Migration
-- Teacher-managed student registration: student codes & account flags

CREATE SEQUENCE IF NOT EXISTS student_code_seq START WITH 10001;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS student_code VARCHAR(20),
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS managed_by_teacher_id INTEGER REFERENCES users(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_student_code_unique
  ON users (student_code)
  WHERE student_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_tenant_managed_students
  ON users (tenant_id, managed_by_teacher_id)
  WHERE role = 'student';

-- Down Migration
DROP INDEX IF EXISTS idx_users_tenant_managed_students;
DROP INDEX IF EXISTS idx_users_student_code_unique;
ALTER TABLE users
  DROP COLUMN IF EXISTS managed_by_teacher_id,
  DROP COLUMN IF EXISTS must_change_password,
  DROP COLUMN IF EXISTS student_code;
DROP SEQUENCE IF EXISTS student_code_seq;
