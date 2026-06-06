-- إنشاء جدول اشتراك الطلاب في المسابقات
-- This table tracks which students are enrolled in which competitions

CREATE TABLE IF NOT EXISTS competition_students (
    id SERIAL PRIMARY KEY,
    competition_id INTEGER NOT NULL,
    student_id INTEGER NOT NULL,
    joined_at TIMESTAMP DEFAULT NOW(),
    is_active BOOLEAN DEFAULT true,
    
    -- Foreign key constraints
    CONSTRAINT fk_competition_students_competition 
        FOREIGN KEY (competition_id) 
        REFERENCES competitions(id) 
        ON DELETE CASCADE,
    
    CONSTRAINT fk_competition_students_student 
        FOREIGN KEY (student_id) 
        REFERENCES users(id) 
        ON DELETE CASCADE,
    
    -- Unique constraint to prevent duplicate enrollments
    CONSTRAINT unique_competition_student 
        UNIQUE (competition_id, student_id)
);

-- Create indexes for better performance
CREATE INDEX idx_competition_students_competition_id ON competition_students(competition_id);
CREATE INDEX idx_competition_students_student_id ON competition_students(student_id);
CREATE INDEX idx_competition_students_active ON competition_students(is_active);

-- Add comments
COMMENT ON TABLE competition_students IS 'جدول اشتراك الطلاب في المسابقات';
COMMENT ON COLUMN competition_students.competition_id IS 'معرف المسابقة';
COMMENT ON COLUMN competition_students.student_id IS 'معرف الطالب';
COMMENT ON COLUMN competition_students.joined_at IS 'تاريخ الاشتراك';
COMMENT ON COLUMN competition_students.is_active IS 'حالة الاشتراك';


