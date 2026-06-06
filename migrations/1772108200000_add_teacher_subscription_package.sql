-- Up Migration
ALTER TABLE users
ADD COLUMN IF NOT EXISTS subscription_package VARCHAR(20);

UPDATE users
SET subscription_package = 'bronze'
WHERE role = 'teacher'
  AND subscription_package IS NULL;

ALTER TABLE users
ALTER COLUMN subscription_package SET DEFAULT 'bronze';

ALTER TABLE users
DROP CONSTRAINT IF EXISTS users_subscription_package_check;

ALTER TABLE users
ADD CONSTRAINT users_subscription_package_check
CHECK (
  subscription_package IS NULL
  OR subscription_package IN ('bronze', 'silver', 'gold', 'diamond')
);

CREATE INDEX IF NOT EXISTS idx_users_role_subscription_package
ON users(role, subscription_package);

-- Down Migration
DROP INDEX IF EXISTS idx_users_role_subscription_package;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_subscription_package_check;
ALTER TABLE users DROP COLUMN IF EXISTS subscription_package;
