-- Up Migration
-- إنشاء جدول امتحانات المادة (package_subject_exams)
-- امتحانات على مستوى المادة نفسها (package_subject_items)

CREATE TABLE IF NOT EXISTS package_subject_exams (
    id SERIAL PRIMARY KEY,
    subject_id INTEGER NOT NULL REFERENCES package_subject_items(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    duration INTEGER NOT NULL, -- المدة بالدقائق
    total_marks INTEGER NOT NULL, -- الدرجة الكلية
    question_count INTEGER NOT NULL DEFAULT 0, -- عدد الأسئلة
    is_visible BOOLEAN DEFAULT FALSE NOT NULL, -- مخفي افتراضياً
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_package_subject_exams_subject_id ON package_subject_exams(subject_id);
CREATE INDEX IF NOT EXISTS idx_package_subject_exams_is_visible ON package_subject_exams(is_visible);
CREATE INDEX IF NOT EXISTS idx_package_subject_exams_created_at ON package_subject_exams(created_at DESC);

-- جدول لتسجيلات الطلاب في الامتحانات (للتتبع)
CREATE TABLE IF NOT EXISTS package_subject_exam_submissions (
    id SERIAL PRIMARY KEY,
    exam_id INTEGER NOT NULL REFERENCES package_subject_exams(id) ON DELETE CASCADE,
    student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    score INTEGER, -- الدرجة المحصل عليها
    submitted_at TIMESTAMP DEFAULT NOW(),
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(exam_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_package_subject_exam_submissions_exam_id ON package_subject_exam_submissions(exam_id);
CREATE INDEX IF NOT EXISTS idx_package_subject_exam_submissions_student_id ON package_subject_exam_submissions(student_id);

-- Down Migration
DROP TABLE IF EXISTS package_subject_exam_submissions;
DROP TABLE IF EXISTS package_subject_exams;
