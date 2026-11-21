-- Up Migration: teacher Meta social publishing (Facebook Pages + Instagram)

CREATE TABLE IF NOT EXISTS teacher_meta_connections (
  id SERIAL PRIMARY KEY,
  teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id INTEGER NULL REFERENCES tenants(id) ON DELETE SET NULL,
  meta_user_id TEXT NOT NULL,
  meta_user_name TEXT NULL,
  user_access_token_enc TEXT NOT NULL,
  token_expires_at TIMESTAMPTZ NULL,
  scopes TEXT NULL,
  status TEXT NOT NULL DEFAULT 'connected'
    CHECK (status IN ('connected', 'needs_reauth', 'disconnected')),
  connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (teacher_id, meta_user_id)
);

CREATE INDEX IF NOT EXISTS idx_teacher_meta_connections_teacher
  ON teacher_meta_connections (teacher_id, status);

CREATE TABLE IF NOT EXISTS teacher_meta_targets (
  id SERIAL PRIMARY KEY,
  connection_id INTEGER NOT NULL REFERENCES teacher_meta_connections(id) ON DELETE CASCADE,
  teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('facebook_page', 'instagram_business')),
  page_id TEXT NULL,
  page_name TEXT NULL,
  page_access_token_enc TEXT NULL,
  page_picture_url TEXT NULL,
  ig_user_id TEXT NULL,
  ig_username TEXT NULL,
  ig_picture_url TEXT NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_teacher_meta_targets_fb_page
  ON teacher_meta_targets (teacher_id, page_id)
  WHERE platform = 'facebook_page' AND page_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_teacher_meta_targets_ig_user
  ON teacher_meta_targets (teacher_id, ig_user_id)
  WHERE platform = 'instagram_business' AND ig_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_teacher_meta_targets_teacher
  ON teacher_meta_targets (teacher_id, is_enabled);

CREATE TABLE IF NOT EXISTS teacher_social_settings (
  teacher_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  auto_publish_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  approval_mode TEXT NOT NULL DEFAULT 'approval'
    CHECK (approval_mode IN ('manual', 'approval', 'auto')),
  posts_per_day INTEGER NOT NULL DEFAULT 1 CHECK (posts_per_day >= 0 AND posts_per_day <= 10),
  publish_times JSONB NOT NULL DEFAULT '["20:00"]'::jsonb,
  publish_days JSONB NOT NULL DEFAULT '[0,1,2,3,4,5,6]'::jsonb,
  timezone TEXT NOT NULL DEFAULT 'Africa/Cairo',
  content_types JSONB NOT NULL DEFAULT '["educational","tips","motivation"]'::jsonb,
  content_plan JSONB NOT NULL DEFAULT '{
    "0":"educational",
    "1":"interactive",
    "2":"tips",
    "3":"motivation",
    "4":"scientific",
    "5":"announcement",
    "6":"light"
  }'::jsonb,
  default_target_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  paused BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS teacher_social_posts (
  id SERIAL PRIMARY KEY,
  teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id INTEGER NULL REFERENCES tenants(id) ON DELETE SET NULL,
  generation_id INTEGER NULL,
  caption TEXT NOT NULL DEFAULT '',
  image_url TEXT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN (
      'draft', 'pending_approval', 'approved', 'scheduled',
      'queued', 'publishing', 'published', 'partial', 'failed', 'cancelled'
    )),
  approval_status TEXT NOT NULL DEFAULT 'none'
    CHECK (approval_status IN ('none', 'pending', 'approved', 'rejected')),
  scheduled_at TIMESTAMPTZ NULL,
  timezone TEXT NOT NULL DEFAULT 'Africa/Cairo',
  published_at TIMESTAMPTZ NULL,
  content_type TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_teacher_social_posts_teacher_status
  ON teacher_social_posts (teacher_id, status, scheduled_at DESC);

CREATE TABLE IF NOT EXISTS teacher_social_post_targets (
  id SERIAL PRIMARY KEY,
  post_id INTEGER NOT NULL REFERENCES teacher_social_posts(id) ON DELETE CASCADE,
  target_id INTEGER NOT NULL REFERENCES teacher_meta_targets(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('facebook_page', 'instagram_business')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'publishing', 'published', 'failed', 'skipped', 'cancelled')),
  external_post_id TEXT NULL,
  external_post_url TEXT NULL,
  published_at TIMESTAMPTZ NULL,
  last_error TEXT NULL,
  retry_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (post_id, target_id)
);

CREATE INDEX IF NOT EXISTS idx_teacher_social_post_targets_status
  ON teacher_social_post_targets (status, updated_at DESC);

CREATE TABLE IF NOT EXISTS teacher_social_publish_jobs (
  id SERIAL PRIMARY KEY,
  post_id INTEGER NOT NULL REFERENCES teacher_social_posts(id) ON DELETE CASCADE,
  post_target_id INTEGER NOT NULL REFERENCES teacher_social_post_targets(id) ON DELETE CASCADE,
  teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('facebook_page', 'instagram_business')),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'done', 'failed', 'needs_reauth', 'cancelled')),
  run_after TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attempts INTEGER NOT NULL DEFAULT 0,
  locked_at TIMESTAMPTZ NULL,
  completed_at TIMESTAMPTZ NULL,
  last_error TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_teacher_social_publish_jobs_claim
  ON teacher_social_publish_jobs (status, run_after)
  WHERE status = 'queued';

CREATE TABLE IF NOT EXISTS teacher_social_publishing_logs (
  id SERIAL PRIMARY KEY,
  teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id INTEGER NULL REFERENCES teacher_social_posts(id) ON DELETE SET NULL,
  post_target_id INTEGER NULL REFERENCES teacher_social_post_targets(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  status TEXT NOT NULL,
  error_code TEXT NULL,
  error_message TEXT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_teacher_social_publishing_logs_teacher
  ON teacher_social_publishing_logs (teacher_id, created_at DESC);

-- Down Migration
-- DROP TABLE IF EXISTS teacher_social_publishing_logs;
-- DROP TABLE IF EXISTS teacher_social_publish_jobs;
-- DROP TABLE IF EXISTS teacher_social_post_targets;
-- DROP TABLE IF EXISTS teacher_social_posts;
-- DROP TABLE IF EXISTS teacher_social_settings;
-- DROP TABLE IF EXISTS teacher_meta_targets;
-- DROP TABLE IF EXISTS teacher_meta_connections;
