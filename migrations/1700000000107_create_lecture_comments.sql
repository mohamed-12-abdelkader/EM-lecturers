-- Up Migration
-- إنشاء جدول تعليقات المحاضرات مع دعم التعليقات المتداخلة
CREATE TABLE IF NOT EXISTS lecture_comments (
  id SERIAL PRIMARY KEY,
  lecture_id INTEGER NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_comment_id INTEGER REFERENCES lecture_comments(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- فهارس لتحسين الأداء
CREATE INDEX IF NOT EXISTS idx_lecture_comments_lecture_id ON lecture_comments(lecture_id);
CREATE INDEX IF NOT EXISTS idx_lecture_comments_parent_id ON lecture_comments(parent_comment_id);
CREATE INDEX IF NOT EXISTS idx_lecture_comments_created_at ON lecture_comments(created_at);

-- Down Migration
DROP TABLE IF EXISTS lecture_comments;




