-- جلسات الأجهزة (Device Sessions) لنظام Refresh Tokens
-- كل تسجيل دخول = جهاز/جلسة جديدة، وكل Refresh يعمل Rotation للتوكن

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS user_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  tenant_id INTEGER REFERENCES tenants (id) ON DELETE SET NULL,
  refresh_token_hash TEXT NOT NULL,
  previous_token_hash TEXT,
  browser TEXT,
  platform TEXT,
  ip TEXT,
  remember_me BOOLEAN NOT NULL DEFAULT FALSE,
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  revoked_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_devices_user_id
  ON user_devices (user_id);

CREATE INDEX IF NOT EXISTS idx_user_devices_active
  ON user_devices (user_id, expires_at)
  WHERE revoked_at IS NULL;

COMMIT;
