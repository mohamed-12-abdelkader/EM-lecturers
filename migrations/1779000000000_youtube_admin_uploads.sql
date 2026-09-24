-- Admin YouTube uploads: platform channel OAuth + upload job queue

CREATE TABLE IF NOT EXISTS youtube_connections (
  id              SERIAL PRIMARY KEY,
  channel_id      TEXT,
  channel_title   TEXT,
  refresh_token   TEXT NOT NULL,
  access_token    TEXT,
  expires_at      TIMESTAMPTZ,
  scopes          TEXT,
  status          VARCHAR(32) NOT NULL DEFAULT 'connected'
                  CHECK (status IN ('connected', 'needs_reauth')),
  connected_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  connected_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Only one active platform connection is used; keep history possible but unique open row via app logic.
CREATE INDEX IF NOT EXISTS idx_youtube_connections_status ON youtube_connections(status);

CREATE TABLE IF NOT EXISTS youtube_upload_jobs (
  id                SERIAL PRIMARY KEY,
  meeting_id        UUID NOT NULL,
  meeting_table     VARCHAR(64) NOT NULL
                    CHECK (meeting_table IN ('meeting', 'general_course_group_meeting')),
  tenant_id         INTEGER REFERENCES tenants(id) ON DELETE SET NULL,
  course_id         INTEGER,
  course_title      TEXT,
  session_title     TEXT NOT NULL,
  teacher_name      TEXT,
  tenant_subdomain  TEXT,
  file_path         TEXT NOT NULL,
  file_size         BIGINT NOT NULL DEFAULT 0,
  status            VARCHAR(32) NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued', 'uploading', 'done', 'failed', 'needs_reauth')),
  progress_percent  INTEGER NOT NULL DEFAULT 0 CHECK (progress_percent >= 0 AND progress_percent <= 100),
  bytes_uploaded    BIGINT NOT NULL DEFAULT 0,
  youtube_video_id  TEXT,
  youtube_url       TEXT,
  privacy_status    VARCHAR(16) NOT NULL DEFAULT 'unlisted'
                    CHECK (privacy_status IN ('public', 'private', 'unlisted')),
  error_message     TEXT,
  resumable_uri     TEXT,
  replace_existing  BOOLEAN NOT NULL DEFAULT FALSE,
  created_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at        TIMESTAMPTZ,
  finished_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_youtube_upload_jobs_status ON youtube_upload_jobs(status);
CREATE INDEX IF NOT EXISTS idx_youtube_upload_jobs_meeting ON youtube_upload_jobs(meeting_id);
CREATE INDEX IF NOT EXISTS idx_youtube_upload_jobs_created ON youtube_upload_jobs(created_at DESC);

-- Down Migration
-- DROP TABLE IF EXISTS youtube_upload_jobs;
-- DROP TABLE IF EXISTS youtube_connections;
