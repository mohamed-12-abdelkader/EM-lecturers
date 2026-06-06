-- Up Migration
-- إنشاء جداول محتوى الكورس

-- جدول المحاضرات
CREATE TABLE IF NOT EXISTS course_lectures (
    id SERIAL PRIMARY KEY,
    course_id INTEGER NOT NULL REFERENCES subject_courses(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    content TEXT, -- محتوى نصي للمحاضرة
    video_url TEXT, -- رابط الفيديو
    video_duration INTEGER, -- مدة الفيديو بالدقائق
    order_index INTEGER DEFAULT 0, -- ترتيب المحاضرة
    is_free BOOLEAN DEFAULT TRUE, -- هل المحاضرة مجانية
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- جدول امتحانات الكورس
CREATE TABLE IF NOT EXISTS course_exams (
    id SERIAL PRIMARY KEY,
    course_id INTEGER NOT NULL REFERENCES subject_courses(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    total_questions INTEGER DEFAULT 0,
    total_grade INTEGER DEFAULT 100,
    duration_minutes INTEGER DEFAULT 60,
    passing_grade INTEGER DEFAULT 60,
    is_comprehensive BOOLEAN DEFAULT FALSE, -- امتحان شامل أم لا
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- جدول أسئلة الامتحانات
CREATE TABLE IF NOT EXISTS course_exam_questions (
    id SERIAL PRIMARY KEY,
    exam_id INTEGER NOT NULL REFERENCES course_exams(id) ON DELETE CASCADE,
    question_text TEXT NOT NULL,
    question_type VARCHAR(20) DEFAULT 'multiple_choice', -- multiple_choice, true_false, essay
    grade INTEGER DEFAULT 1,
    order_index INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
);

-- جدول خيارات الأسئلة
CREATE TABLE IF NOT EXISTS course_exam_question_options (
    id SERIAL PRIMARY KEY,
    question_id INTEGER NOT NULL REFERENCES course_exam_questions(id) ON DELETE CASCADE,
    option_text TEXT NOT NULL,
    is_correct BOOLEAN DEFAULT FALSE,
    order_index INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
);

-- جدول تقديمات الطلاب للامتحانات
CREATE TABLE IF NOT EXISTS course_exam_submissions (
    id SERIAL PRIMARY KEY,
    exam_id INTEGER NOT NULL REFERENCES course_exams(id) ON DELETE CASCADE,
    student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    submitted_at TIMESTAMP DEFAULT NOW(),
    total_grade INTEGER,
    obtained_grade INTEGER DEFAULT 0,
    passed BOOLEAN DEFAULT FALSE,
    time_taken_minutes INTEGER -- الوقت المستغرق
);

-- جدول إجابات الطلاب
CREATE TABLE IF NOT EXISTS course_exam_answers (
    id SERIAL PRIMARY KEY,
    submission_id INTEGER NOT NULL REFERENCES course_exam_submissions(id) ON DELETE CASCADE,
    question_id INTEGER NOT NULL REFERENCES course_exam_questions(id) ON DELETE CASCADE,
    answer_text TEXT, -- للإجابات النصية
    selected_option_id INTEGER REFERENCES course_exam_question_options(id), -- للاختيار من متعدد
    grade INTEGER DEFAULT 0,
    is_correct BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW()
);

-- جدول الملفات المرفقة للمحاضرات
CREATE TABLE IF NOT EXISTS course_lecture_attachments (
    id SERIAL PRIMARY KEY,
    lecture_id INTEGER NOT NULL REFERENCES course_lectures(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL,
    file_url TEXT NOT NULL,
    file_size INTEGER, -- حجم الملف بالبايت
    file_type VARCHAR(50), -- نوع الملف
    description TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- جدول تقدم الطلاب في الكورس
CREATE TABLE IF NOT EXISTS course_progress (
    id SERIAL PRIMARY KEY,
    course_id INTEGER NOT NULL REFERENCES subject_courses(id) ON DELETE CASCADE,
    student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    lecture_id INTEGER REFERENCES course_lectures(id),
    completed BOOLEAN DEFAULT FALSE,
    watched_duration INTEGER DEFAULT 0, -- المدة المشاهدة بالثواني
    last_watched_at TIMESTAMP DEFAULT NOW(),
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(course_id, student_id, lecture_id)
);

-- جدول تقييمات الكورس
CREATE TABLE IF NOT EXISTS course_ratings (
    id SERIAL PRIMARY KEY,
    course_id INTEGER NOT NULL REFERENCES subject_courses(id) ON DELETE CASCADE,
    student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    review TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(course_id, student_id)
);

-- Down Migration
DROP TABLE IF EXISTS course_ratings;
DROP TABLE IF EXISTS course_progress;
DROP TABLE IF EXISTS course_lecture_attachments;
DROP TABLE IF EXISTS course_exam_answers;
DROP TABLE IF EXISTS course_exam_submissions;
DROP TABLE IF EXISTS course_exam_question_options;
DROP TABLE IF EXISTS course_exam_questions;
DROP TABLE IF EXISTS course_exams;
DROP TABLE IF EXISTS course_lectures; 