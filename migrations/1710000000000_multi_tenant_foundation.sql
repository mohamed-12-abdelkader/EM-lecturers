-- Up Migration

BEGIN;

-- Core tenant registry (one row per teacher / school instance on a subdomain)
CREATE TABLE IF NOT EXISTS tenants (
  id SERIAL PRIMARY KEY,
  subdomain TEXT NOT NULL,
  display_name TEXT NOT NULL,
  specialty TEXT,
  bio TEXT,
  avatar_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  seo_title TEXT,
  seo_meta_description TEXT,
  favicon_url TEXT,
  og_image_url TEXT,
  owner_user_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tenants_subdomain_unique UNIQUE (subdomain),
  CONSTRAINT tenants_subdomain_format CHECK (
    subdomain ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'
  ),
  CONSTRAINT tenants_subdomain_lowercase CHECK (subdomain = lower(subdomain))
);

CREATE INDEX IF NOT EXISTS idx_tenants_is_active ON tenants (is_active);

-- Operational / feature flags per tenant (rate limits, toggles, etc.)
CREATE TABLE IF NOT EXISTS tenant_settings (
  tenant_id INTEGER PRIMARY KEY REFERENCES tenants (id) ON DELETE CASCADE,
  data JSONB NOT NULL DEFAULT '{}'::JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Landing page builder payload (sections as JSON for flexibility)
CREATE TABLE IF NOT EXISTS tenant_landing_pages (
  tenant_id INTEGER PRIMARY KEY REFERENCES tenants (id) ON DELETE CASCADE,
  page JSONB NOT NULL DEFAULT '{}'::JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Bootstrap default tenant for existing single-tenant data
INSERT INTO tenants (subdomain, display_name, is_active, seo_title)
SELECT 'default', 'Default Platform', TRUE, 'EM Online'
WHERE NOT EXISTS (SELECT 1 FROM tenants WHERE subdomain = 'default');

-- Link existing users to default tenant
ALTER TABLE users
ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants (id);

UPDATE users u
SET tenant_id = t.id
FROM tenants t
WHERE u.tenant_id IS NULL
  AND t.subdomain = 'default';

ALTER TABLE users
ALTER COLUMN tenant_id SET NOT NULL;

-- Legacy INSERT paths without explicit tenant_id attach to default tenant (id = 1)
ALTER TABLE users ALTER COLUMN tenant_id SET DEFAULT 1;

-- Replace global email/phone uniqueness with per-tenant uniqueness
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_phone_key;

CREATE UNIQUE INDEX IF NOT EXISTS users_tenant_email_uidx ON users (
  tenant_id,
  lower(trim(email))
)
WHERE email IS NOT NULL AND length(trim(email)) > 0;

CREATE UNIQUE INDEX IF NOT EXISTS users_tenant_phone_uidx ON users (tenant_id, phone)
WHERE phone IS NOT NULL AND length(trim(phone)) > 0;

CREATE INDEX IF NOT EXISTS idx_users_tenant_id ON users (tenant_id);

-- Owner FK after users.tenant_id exists
ALTER TABLE tenants
DROP CONSTRAINT IF EXISTS tenants_owner_user_id_fkey;

ALTER TABLE tenants
ADD CONSTRAINT tenants_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES users (id) ON DELETE SET NULL;

COMMIT;

-- Down Migration

BEGIN;

ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_owner_user_id_fkey;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_tenant_id_fkey;

DROP INDEX IF EXISTS users_tenant_email_uidx;
DROP INDEX IF EXISTS users_tenant_phone_uidx;
DROP INDEX IF EXISTS idx_users_tenant_id;

ALTER TABLE users ALTER COLUMN tenant_id DROP DEFAULT;
ALTER TABLE users DROP COLUMN IF EXISTS tenant_id;

DROP TABLE IF EXISTS tenant_landing_pages;
DROP TABLE IF EXISTS tenant_settings;
DROP TABLE IF EXISTS tenants;

ALTER TABLE users ADD CONSTRAINT users_email_key UNIQUE (email);
ALTER TABLE users ADD CONSTRAINT users_phone_key UNIQUE (phone);

COMMIT;
