-- Up Migration
ALTER TABLE users
ADD COLUMN IF NOT EXISTS subscription_package_assigned_at TIMESTAMPTZ;

UPDATE users
SET subscription_package_assigned_at = NOW()
WHERE role = 'teacher'
  AND subscription_package_assigned_at IS NULL;

ALTER TABLE users
ALTER COLUMN subscription_package_assigned_at SET DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_users_teacher_package_assigned_at
ON users(role, subscription_package_assigned_at);

-- Down Migration
DROP INDEX IF EXISTS idx_users_teacher_package_assigned_at;
ALTER TABLE users DROP COLUMN IF EXISTS subscription_package_assigned_at;
