BEGIN;

-- Posts
CREATE TABLE IF NOT EXISTS social_posts (
  id BIGSERIAL PRIMARY KEY,
  author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT,
  media_url TEXT,
  media_type TEXT CHECK (media_type IN ('image','video','file')),
  visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','grades','teachers','students')),
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_social_posts_author ON social_posts(author_id, created_at DESC);

-- Comments (supports nested via parent_comment_id)
CREATE TABLE IF NOT EXISTS social_comments (
  id BIGSERIAL PRIMARY KEY,
  post_id BIGINT NOT NULL REFERENCES social_posts(id) ON DELETE CASCADE,
  author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT,
  media_url TEXT,
  media_type TEXT CHECK (media_type IN ('image','audio','file')),
  parent_comment_id BIGINT REFERENCES social_comments(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_social_comments_post ON social_comments(post_id, created_at);
CREATE INDEX IF NOT EXISTS idx_social_comments_parent ON social_comments(parent_comment_id);

-- Reactions (like, love, support) for posts and comments
CREATE TABLE IF NOT EXISTS social_reactions (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id BIGINT REFERENCES social_posts(id) ON DELETE CASCADE,
  comment_id BIGINT REFERENCES social_comments(id) ON DELETE CASCADE,
  reaction TEXT NOT NULL CHECK (reaction IN ('like','love','support')),
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT one_target CHECK ((post_id IS NOT NULL AND comment_id IS NULL) OR (post_id IS NULL AND comment_id IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_social_reaction_unique_post ON social_reactions(user_id, post_id) WHERE post_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_social_reaction_unique_comment ON social_reactions(user_id, comment_id) WHERE comment_id IS NOT NULL;

COMMIT;



