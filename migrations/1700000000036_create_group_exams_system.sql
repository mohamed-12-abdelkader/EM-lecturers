-- Up Migration
-- إنشاء نظام امتحانات المجموعات الدراسية

-- جدول امتحانات المجموعات
CREATE TABLE IF NOT EXISTS group_exams (
    id SERIAL PRIMARY KEY,
    group_id INTEGER NOT NULL REFERENCES study_groups(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    total_grade INTEGER NOT NULL DEFAULT 100,
    exam_date DATE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- جدول درجات الطلاب في الامتحانات
CREATE TABLE IF NOT EXISTS group_exam_grades (
    id SERIAL PRIMARY KEY,
    exam_id INTEGER NOT NULL REFERENCES group_exams(id) ON DELETE CASCADE,
    student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    grade DECIMAL(5,2) NOT NULL,
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(exam_id, student_id)
);

-- Down Migration
DROP TABLE IF EXISTS group_exam_grades;
DROP TABLE IF EXISTS group_exams; 