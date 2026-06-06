-- Up Migration
-- إضافة جدول الإشعارات
CREATE TABLE IF NOT EXISTS notifications (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    type TEXT NOT NULL, -- 'lecture_added', 'video_added', 'file_added'
    course_id INTEGER REFERENCES courses (id) ON DELETE CASCADE,
    lecture_id INTEGER REFERENCES lectures (id) ON DELETE CASCADE,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW ()
);

-- Down Migration
DROP TABLE IF EXISTS notifications; 