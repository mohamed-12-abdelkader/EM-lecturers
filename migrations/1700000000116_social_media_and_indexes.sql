BEGIN;

-- Multiple media per post
CREATE TABLE IF NOT EXISTS social_post_media (
  id BIGSERIAL PRIMARY KEY,
  post_id BIGINT NOT NULL REFERENCES social_posts(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  type TEXT CHECK (type IN ('image','video','file')),
  name TEXT,
  mime TEXT,
  size INTEGER,
  position INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_social_post_media_post ON social_post_media(post_id, position);

-- Helpful reaction counts view (optional usage via query join)
-- no view to keep migrations simple; we'll aggregate via queries.

COMMIT;



