-- Up Migration
-- إنشاء جدول تتبع مشاهدات الفيديوهات الفردية

CREATE TABLE IF NOT EXISTS video_views (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    video_id INTEGER NOT NULL REFERENCES lecture_videos(id) ON DELETE CASCADE,
    lecture_id INTEGER NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
    course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    viewed_at TIMESTAMP DEFAULT NOW(),
    watch_duration INTEGER DEFAULT 0, -- المدة المشاهدة بالثواني
    completion_percentage DECIMAL(5,2) DEFAULT 0, -- نسبة الإكمال
    is_completed BOOLEAN DEFAULT FALSE, -- هل تم إكمال الفيديو بالكامل
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE (user_id, video_id)
);

-- إنشاء فهارس للأداء
CREATE INDEX IF NOT EXISTS idx_video_views_user_id ON video_views(user_id);
CREATE INDEX IF NOT EXISTS idx_video_views_video_id ON video_views(video_id);
CREATE INDEX IF NOT EXISTS idx_video_views_lecture_id ON video_views(lecture_id);
CREATE INDEX IF NOT EXISTS idx_video_views_course_id ON video_views(course_id);
CREATE INDEX IF NOT EXISTS idx_video_views_viewed_at ON video_views(viewed_at);

-- Down Migration
DROP TABLE IF EXISTS video_views;

