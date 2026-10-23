-- Up Migration: soft-delete for platform student accounts (restore keeps all related data)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_users_tenant_deleted_at
  ON users (tenant_id, deleted_at)
  WHERE deleted_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_role_deleted_at
  ON users (role, deleted_at)
  WHERE deleted_at IS NOT NULL;

COMMENT ON COLUMN users.deleted_at IS 'Soft-delete timestamp — platform students appear in teacher trash and can be fully restored';

-- Down Migration
DROP INDEX IF EXISTS idx_users_role_deleted_at;
DROP INDEX IF EXISTS idx_users_tenant_deleted_at;
ALTER TABLE users DROP COLUMN IF EXISTS deleted_at;
