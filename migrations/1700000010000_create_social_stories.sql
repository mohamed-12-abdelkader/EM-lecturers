BEGIN;

CREATE TABLE IF NOT EXISTS social_stories (
  id BIGSERIAL PRIMARY KEY,
  author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('text', 'image', 'video', 'text_image', 'text_video')),
  content TEXT,
  media_url TEXT,
  expires_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_social_stories_author ON social_stories(author_id);
CREATE INDEX IF NOT EXISTS idx_social_stories_expires ON social_stories(expires_at);

CREATE TABLE IF NOT EXISTS social_story_replies (
  id BIGSERIAL PRIMARY KEY,
  story_id BIGINT NOT NULL REFERENCES social_stories(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- The student whose conversation thread this belong to
  sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,   -- The actual sender of the message (Student or Teacher)
  message TEXT NOT NULL,
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_social_story_replies_story ON social_story_replies(story_id);
CREATE INDEX IF NOT EXISTS idx_social_story_replies_student ON social_story_replies(student_id);

COMMIT;
