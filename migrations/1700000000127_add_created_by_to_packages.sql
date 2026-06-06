-- Add created_by column to packages table
ALTER TABLE packages
  ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id) ON DELETE SET NULL;

-- Update existing packages to set created_by to admin users if exists
-- This is a safe default - you may want to update manually
UPDATE packages
SET created_by = (SELECT id FROM users WHERE role = 'admin' LIMIT 1)
WHERE created_by IS NULL;
































