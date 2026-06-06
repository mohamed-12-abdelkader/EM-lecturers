-- Up Migration
-- إنشاء جداول إجابات الطلاب على الواجبات

-- جدول تسليمات الواجبات (كل تسليم يمثل محاولة للطالب)
CREATE TABLE IF NOT EXISTS assignment_submissions (
    id SERIAL PRIMARY KEY,
    assignment_id INTEGER NOT NULL REFERENCES package_subject_item_lesson_assignments(id) ON DELETE CASCADE,
    student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    total_questions INTEGER NOT NULL DEFAULT 0,
    correct_answers INTEGER NOT NULL DEFAULT 0,
    wrong_answers INTEGER NOT NULL DEFAULT 0,
    score DECIMAL(5, 2) NOT NULL DEFAULT 0.00, -- النسبة المئوية
    submitted_at TIMESTAMP DEFAULT NOW(),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(assignment_id, student_id) -- كل طالب يمكنه تسليم الواجب مرة واحدة فقط
);

-- جدول إجابات الطالب على كل سؤال
CREATE TABLE IF NOT EXISTS assignment_submission_answers (
    id SERIAL PRIMARY KEY,
    submission_id INTEGER NOT NULL REFERENCES assignment_submissions(id) ON DELETE CASCADE,
    question_id INTEGER NOT NULL REFERENCES assignment_questions(id) ON DELETE CASCADE,
    student_answer TEXT CHECK (student_answer IN ('a', 'b', 'c', 'd')), -- للحفاظ على التوافق
    -- أعمدة بدون FK هنا: جدول assignment_question_options يُنشأ في migration 0940
    student_option_id INTEGER,
    is_correct BOOLEAN NOT NULL DEFAULT false,
    correct_answer TEXT CHECK (correct_answer IN ('a', 'b', 'c', 'd')), -- للحفاظ على التوافق
    correct_option_id INTEGER,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(submission_id, question_id) -- كل سؤال له إجابة واحدة فقط في كل تسليم
);

-- إنشاء indexes لتحسين الأداء
CREATE INDEX IF NOT EXISTS idx_assignment_submissions_assignment ON assignment_submissions(assignment_id);
CREATE INDEX IF NOT EXISTS idx_assignment_submissions_student ON assignment_submissions(student_id);
CREATE INDEX IF NOT EXISTS idx_assignment_submission_answers_submission ON assignment_submission_answers(submission_id);
CREATE INDEX IF NOT EXISTS idx_assignment_submission_answers_question ON assignment_submission_answers(question_id);

-- Down Migration
DROP INDEX IF EXISTS idx_assignment_submission_answers_question;
DROP INDEX IF EXISTS idx_assignment_submission_answers_submission;
DROP INDEX IF EXISTS idx_assignment_submissions_student;
DROP INDEX IF EXISTS idx_assignment_submissions_assignment;
DROP TABLE IF EXISTS assignment_submission_answers;
DROP TABLE IF EXISTS assignment_submissions;

