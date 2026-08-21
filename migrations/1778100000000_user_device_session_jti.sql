-- ربط Access Token (jti) بجلسة الجهاز للتحقق Server-Side
-- الطالب: جلسة نشطة واحدة (exclusive)
-- المدرس/الأدمن: جلسات متعددة
-- التوكنات القديمة بدون jti في الجدول تظل تعمل (legacy) حتى أول Login جديد

BEGIN;

ALTER TABLE user_devices
  ADD COLUMN IF NOT EXISTS jti UUID,
  ADD COLUMN IF NOT EXISTS role TEXT,
  ADD COLUMN IF NOT EXISTS exclusive BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS client_device_id TEXT,
  ADD COLUMN IF NOT EXISTS device_info TEXT;

UPDATE user_devices
SET jti = gen_random_uuid()
WHERE jti IS NULL;

UPDATE user_devices d
SET role = u.role
FROM users u
WHERE u.id = d.user_id AND d.role IS NULL;

UPDATE user_devices d
SET exclusive = TRUE
FROM users u
WHERE u.id = d.user_id AND u.role = 'student';

-- إبقاء أحدث جلسة نشطة لكل طالب في الجدول (بدون logout جماعي للتوكينات القديمة)
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY last_used_at DESC, created_at DESC) AS rn
  FROM user_devices
  WHERE exclusive IS TRUE AND revoked_at IS NULL
)
UPDATE user_devices d
SET revoked_at = NOW(),
    revoked_reason = 'migration_single_session',
    updated_at = NOW()
FROM ranked r
WHERE d.id = r.id AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_user_devices_jti
  ON user_devices (jti)
  WHERE jti IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_user_devices_one_exclusive_active
  ON user_devices (user_id)
  WHERE revoked_at IS NULL AND exclusive IS TRUE;

CREATE INDEX IF NOT EXISTS idx_user_devices_jti_lookup
  ON user_devices (jti);

CREATE INDEX IF NOT EXISTS idx_user_devices_user_active
  ON user_devices (user_id, revoked_at, expires_at);

COMMIT;
