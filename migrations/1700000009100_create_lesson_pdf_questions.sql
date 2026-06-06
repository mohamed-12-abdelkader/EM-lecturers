-- Migration: Lesson PDF Questions (نظام مستقل - أسئلة من ملف PDF)
-- وصف: جدول منفصل لأسئلة مستوردة من PDF (صورة لكل صفحة، بدون OCR).
-- لا يعدل أي جدول أو مسار إضافة أسئلة موجود.

-- جدول أسئلة الدرس من PDF (صورة واحدة = سؤال واحد، نوع image_mcq)
CREATE TABLE IF NOT EXISTS lesson_pdf_questions (
    id SERIAL PRIMARY KEY,
    lesson_id INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    image_url TEXT NOT NULL,
    correct_answer VARCHAR(1) NULL CHECK (correct_answer IS NULL OR correct_answer IN ('أ', 'ب', 'ج', 'د', 'A', 'B', 'C', 'D')),
    order_index INTEGER NOT NULL DEFAULT 0,
    source_file_name VARCHAR(500),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_lesson_pdf_questions_lesson_id ON lesson_pdf_questions(lesson_id);
CREATE INDEX IF NOT EXISTS idx_lesson_pdf_questions_order ON lesson_pdf_questions(lesson_id, order_index);

COMMENT ON TABLE lesson_pdf_questions IS 'أسئلة مستوردة من PDF - كل صفحة = سؤال بصورة واحدة (image_mcq)، correct_answer يُحدد لاحقاً';
