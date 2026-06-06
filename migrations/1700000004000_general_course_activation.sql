-- Migration: Create General Course Activation Codes and Enrollments
-- إنشاء جداول التفعيل والاشتراكات للكورسات العامة

-- 1. جدول اشتراكات الطلاب في الكورسات العامة
CREATE TABLE IF NOT EXISTS general_course_enrollments (
    id SERIAL PRIMARY KEY,
    student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    general_course_id INTEGER NOT NULL REFERENCES general_courses(id) ON DELETE CASCADE,
    enrolled_at TIMESTAMP DEFAULT NOW(),
    enrollment_type VARCHAR(50) DEFAULT 'code', -- 'code', 'purchase', etc.
    
    -- منع تكرار اشتراك الطالب في نفس الكورس
    UNIQUE(student_id, general_course_id)
);

CREATE INDEX IF NOT EXISTS idx_general_course_enrollments_student ON general_course_enrollments(student_id);
CREATE INDEX IF NOT EXISTS idx_general_course_enrollments_course ON general_course_enrollments(general_course_id);

-- 2. جدول أكواد التفعيل
CREATE TABLE IF NOT EXISTS general_course_activation_codes (
    id SERIAL PRIMARY KEY,
    general_course_id INTEGER NOT NULL REFERENCES general_courses(id) ON DELETE CASCADE,
    code VARCHAR(8) NOT NULL UNIQUE,
    is_used BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW(),
    used_at TIMESTAMP,
    used_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    
    -- التأكد من أن الكود مكون من 8 أرقام
    CONSTRAINT check_code_length CHECK (LENGTH(code) = 8)
);

CREATE INDEX IF NOT EXISTS idx_activation_codes_course ON general_course_activation_codes(general_course_id);
CREATE INDEX IF NOT EXISTS idx_activation_codes_code ON general_course_activation_codes(code);

-- Down Migration
-- DROP TABLE IF EXISTS general_course_activation_codes;
-- DROP TABLE IF EXISTS general_course_enrollments;
