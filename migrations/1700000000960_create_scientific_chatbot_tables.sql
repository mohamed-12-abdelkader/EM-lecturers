-- Up Migration
-- Create tables for scientific support chatbot

-- Table for course content files uploaded by teachers
CREATE TABLE IF NOT EXISTS course_content_files (
    id SERIAL PRIMARY KEY,
    course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    file_size INTEGER, -- Size in bytes
    file_type VARCHAR(50), -- e.g., 'text/plain', 'application/pdf'
    content_text TEXT, -- Extracted text content
    uploaded_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Table for chat history between students and the scientific chatbot
CREATE TABLE IF NOT EXISTS scientific_chat_history (
    id SERIAL PRIMARY KEY,
    student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    question TEXT NOT NULL,
    rewritten_question TEXT, -- The standalone rewritten question
    answer TEXT NOT NULL,
    retrieved_chunks JSONB, -- Array of retrieved chunk IDs and texts used for RAG
    created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_course_content_files_course_id ON course_content_files(course_id);
CREATE INDEX IF NOT EXISTS idx_course_content_files_teacher_id ON course_content_files(teacher_id);
CREATE INDEX IF NOT EXISTS idx_scientific_chat_history_student_id ON scientific_chat_history(student_id);
CREATE INDEX IF NOT EXISTS idx_scientific_chat_history_course_id ON scientific_chat_history(course_id);
CREATE INDEX IF NOT EXISTS idx_scientific_chat_history_created_at ON scientific_chat_history(created_at);

-- Down Migration
DROP TABLE IF EXISTS scientific_chat_history;
DROP TABLE IF EXISTS course_content_files;

