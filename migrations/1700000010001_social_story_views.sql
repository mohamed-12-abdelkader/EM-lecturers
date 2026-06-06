-- تتبع مشاهدات الاستوري لكل مستخدم (واضح اللي اتشاف واللي لسه لا)
BEGIN;

CREATE TABLE IF NOT EXISTS social_story_views (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  story_id BIGINT NOT NULL REFERENCES social_stories(id) ON DELETE CASCADE,
  viewed_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, story_id)
);

CREATE INDEX IF NOT EXISTS idx_social_story_views_user ON social_story_views(user_id);
CREATE INDEX IF NOT EXISTS idx_social_story_views_story ON social_story_views(story_id);

COMMIT;
