-- عزل محتوى الكورسات العامة حسب المجموعة (محاضرات واختبارات مستقلة لكل مجموعة)

-- 1. ربط المحاضرات بالمجموعة
ALTER TABLE general_course_lectures
  ADD COLUMN IF NOT EXISTS group_id INTEGER REFERENCES general_course_groups(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_general_course_lectures_group_id ON general_course_lectures(group_id);

COMMENT ON COLUMN general_course_lectures.group_id IS 'المجموعة التي تنتمي إليها المحاضرة؛ إن كان NULL فالمحاضرة قديمة (قبل نظام المجموعات)';

-- 2. اختبارات خاصة بكل مجموعة
CREATE TABLE IF NOT EXISTS general_course_exams (
    id SERIAL PRIMARY KEY,
    group_id INTEGER NOT NULL REFERENCES general_course_groups(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    total_grade INTEGER NOT NULL DEFAULT 100,
    duration_minutes INTEGER,
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_general_course_exams_group_id ON general_course_exams(group_id);

CREATE TABLE IF NOT EXISTS general_course_exam_questions (
    id SERIAL PRIMARY KEY,
    exam_id INTEGER NOT NULL REFERENCES general_course_exams(id) ON DELETE CASCADE,
    question_text TEXT NOT NULL,
    grade INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_general_course_exam_questions_exam_id ON general_course_exam_questions(exam_id);

CREATE TABLE IF NOT EXISTS general_course_exam_submissions (
    id SERIAL PRIMARY KEY,
    exam_id INTEGER NOT NULL REFERENCES general_course_exams(id) ON DELETE CASCADE,
    student_id INTEGER NOT NULL REFERENCES users(id),
    total_grade INTEGER,
    passed BOOLEAN DEFAULT FALSE,
    submitted_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_general_course_exam_submissions_exam_student
  ON general_course_exam_submissions(exam_id, student_id);

CREATE TABLE IF NOT EXISTS general_course_exam_answers (
    id SERIAL PRIMARY KEY,
    submission_id INTEGER NOT NULL REFERENCES general_course_exam_submissions(id) ON DELETE CASCADE,
    question_id INTEGER NOT NULL REFERENCES general_course_exam_questions(id) ON DELETE CASCADE,
    answer_text TEXT,
    grade INTEGER
);

CREATE INDEX IF NOT EXISTS idx_general_course_exam_answers_submission ON general_course_exam_answers(submission_id);
