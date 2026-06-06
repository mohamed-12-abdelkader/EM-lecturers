-- Up Migration
-- إنشاء جدول نقاط الطلاب

CREATE TABLE IF NOT EXISTS student_points (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    total_points INTEGER NOT NULL DEFAULT 0,
    last_reset_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE (user_id)
);

-- إنشاء جدول سجل النقاط (للتتبع)
CREATE TABLE IF NOT EXISTS student_points_history (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    points INTEGER NOT NULL,
    source_type VARCHAR(50) NOT NULL, -- 'lecture_watched', 'exam_solved'
    source_id INTEGER, -- ID المحاضرة أو الامتحان
    description TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- إنشاء فهارس للأداء
CREATE INDEX IF NOT EXISTS idx_student_points_user_id ON student_points(user_id);
CREATE INDEX IF NOT EXISTS idx_student_points_total_points ON student_points(total_points);
CREATE INDEX IF NOT EXISTS idx_student_points_history_user_id ON student_points_history(user_id);
CREATE INDEX IF NOT EXISTS idx_student_points_history_created_at ON student_points_history(created_at);
CREATE INDEX IF NOT EXISTS idx_student_points_history_source ON student_points_history(source_type, source_id);

-- Down Migration
DROP TABLE IF EXISTS student_points_history;
DROP TABLE IF EXISTS student_points;





