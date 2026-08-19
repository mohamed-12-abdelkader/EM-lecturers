-- Student device/IP restriction: per-tenant setting lives in tenant_settings.data.student_device_limit
-- Values: multiple_devices | single_device (unset = multiple_devices; teacher can change anytime)

BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS registered_ip TEXT,
  ADD COLUMN IF NOT EXISTS ip_registered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ip_reset_at TIMESTAMPTZ;

UPDATE users
SET registered_ip = device_ip
WHERE registered_ip IS NULL
  AND device_ip IS NOT NULL
  AND role = 'student';

CREATE TABLE IF NOT EXISTS student_ip_logs (
  id            SERIAL PRIMARY KEY,
  student_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id     INTEGER REFERENCES tenants(id) ON DELETE SET NULL,
  old_ip        TEXT,
  new_ip        TEXT,
  action        VARCHAR(40) NOT NULL,
  performed_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT student_ip_logs_action_check
    CHECK (action IN ('bind', 'rebind', 'mismatch', 'reset'))
);

CREATE INDEX IF NOT EXISTS idx_student_ip_logs_student_id
  ON student_ip_logs (student_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_student_ip_logs_tenant_id
  ON student_ip_logs (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_users_registered_ip
  ON users (registered_ip)
  WHERE registered_ip IS NOT NULL;

COMMIT;
