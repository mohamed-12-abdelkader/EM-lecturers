-- إصلاح جداول الامتحانات المقالية
-- حذف الجداول إذا كانت موجودة لإعادة إنشائها
DROP TABLE IF EXISTS essay_grades CASCADE;
DROP TABLE IF EXISTS essay_answers CASCADE;
DROP TABLE IF EXISTS essay_questions CASCADE;
DROP TABLE IF EXISTS essay_exams CASCADE;

-- إنشاء جدول الامتحانات المقالية
CREATE TABLE IF NOT EXISTS essay_exams (
    id SERIAL PRIMARY KEY,
    lecture_id INTEGER NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    is_visible BOOLEAN DEFAULT TRUE,
    created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- إنشاء جدول الأسئلة المقالية
CREATE TABLE IF NOT EXISTS essay_questions (
    id SERIAL PRIMARY KEY,
    exam_id INTEGER NOT NULL REFERENCES essay_exams(id) ON DELETE CASCADE,
    question_text TEXT NOT NULL,
    order_index INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- إنشاء جدول إجابات الطلاب
CREATE TABLE IF NOT EXISTS essay_answers (
    id SERIAL PRIMARY KEY,
    exam_id INTEGER NOT NULL REFERENCES essay_exams(id) ON DELETE CASCADE,
    student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    question_id INTEGER NOT NULL REFERENCES essay_questions(id) ON DELETE CASCADE,
    answer_text TEXT NOT NULL,
    submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(exam_id, student_id, question_id)
);

-- إنشاء جدول درجات الطلاب
CREATE TABLE IF NOT EXISTS essay_grades (
    id SERIAL PRIMARY KEY,
    exam_id INTEGER NOT NULL REFERENCES essay_exams(id) ON DELETE CASCADE,
    student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    total_grade DECIMAL(5,2) NOT NULL DEFAULT 0,
    max_grade DECIMAL(5,2) NOT NULL DEFAULT 0,
    graded_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    graded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    feedback TEXT,
    UNIQUE(exam_id, student_id)
);

-- إنشاء فهارس للأداء
CREATE INDEX IF NOT EXISTS idx_essay_exams_lecture_id ON essay_exams(lecture_id);
CREATE INDEX IF NOT EXISTS idx_essay_exams_created_by ON essay_exams(created_by);
CREATE INDEX IF NOT EXISTS idx_essay_exams_is_visible ON essay_exams(is_visible);
CREATE INDEX IF NOT EXISTS idx_essay_questions_exam_id ON essay_questions(exam_id);
CREATE INDEX IF NOT EXISTS idx_essay_questions_order ON essay_questions(exam_id, order_index);
CREATE INDEX IF NOT EXISTS idx_essay_answers_exam_id ON essay_answers(exam_id);
CREATE INDEX IF NOT EXISTS idx_essay_answers_student_id ON essay_answers(student_id);
CREATE INDEX IF NOT EXISTS idx_essay_answers_question_id ON essay_answers(question_id);
CREATE INDEX IF NOT EXISTS idx_essay_grades_exam_id ON essay_grades(exam_id);
CREATE INDEX IF NOT EXISTS idx_essay_grades_student_id ON essay_grades(student_id);
CREATE INDEX IF NOT EXISTS idx_essay_grades_graded_by ON essay_grades(graded_by);

-- إضافة تعليقات للجداول
COMMENT ON TABLE essay_exams IS 'جدول الامتحانات المقالية المرتبطة بالمحاضرات';
COMMENT ON TABLE essay_questions IS 'جدول الأسئلة المقالية داخل كل امتحان';
COMMENT ON TABLE essay_answers IS 'جدول إجابات الطلاب على الأسئلة المقالية';
COMMENT ON TABLE essay_grades IS 'جدول درجات الطلاب في الامتحانات المقالية';

