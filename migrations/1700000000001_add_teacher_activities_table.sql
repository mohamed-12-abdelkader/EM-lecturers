-- Up Migration
-- إضافة جدول نشاطات المدرس
CREATE TABLE IF NOT EXISTS teacher_activities (
    id SERIAL PRIMARY KEY,
    teacher_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    activity_type TEXT NOT NULL, -- 'course_created', 'lecture_added', 'video_added', 'file_added', 'quiz_created', 'exam_created'
    title TEXT NOT NULL,
    description TEXT,
    course_id INTEGER REFERENCES courses (id) ON DELETE CASCADE,
    lecture_id INTEGER REFERENCES lectures (id) ON DELETE CASCADE,
    quiz_id INTEGER REFERENCES quizzes (id) ON DELETE CASCADE,
    metadata JSONB DEFAULT '{}', -- لتخزين بيانات إضافية مثل عدد الطلاب، الدرجات، إلخ
    created_at TIMESTAMP DEFAULT NOW()
);

-- إنشاء index لتحسين الأداء
CREATE INDEX idx_teacher_activities_teacher_id ON teacher_activities(teacher_id);
CREATE INDEX idx_teacher_activities_created_at ON teacher_activities(created_at DESC);

-- Down Migration
DROP TABLE IF EXISTS teacher_activities; 