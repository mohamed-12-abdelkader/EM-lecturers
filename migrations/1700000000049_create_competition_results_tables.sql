-- إنشاء جدول نتائج المسابقات
CREATE TABLE competition_results (
    id SERIAL PRIMARY KEY,
    competition_id INTEGER NOT NULL,
    student_id INTEGER NOT NULL,
    score INTEGER NOT NULL,
    total_questions INTEGER NOT NULL,
    correct_answers INTEGER NOT NULL,
    wrong_answers INTEGER NOT NULL,
    total_points INTEGER NOT NULL,
    earned_points INTEGER NOT NULL,
    percentage DECIMAL(5,2) NOT NULL,
    submitted_at TIMESTAMP NOT NULL DEFAULT NOW(),
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    
    -- Foreign Keys
    FOREIGN KEY (competition_id) REFERENCES competitions(id) ON DELETE CASCADE,
    FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
    
    -- Constraints
    CONSTRAINT unique_student_competition UNIQUE(competition_id, student_id),
    CONSTRAINT valid_score CHECK (score >= 0),
    CONSTRAINT valid_percentage CHECK (percentage >= 0 AND percentage <= 100),
    CONSTRAINT valid_answers CHECK (correct_answers + wrong_answers = total_questions)
);

-- إنشاء جدول إجابات الطلاب
CREATE TABLE student_answers (
    id SERIAL PRIMARY KEY,
    competition_result_id INTEGER NOT NULL,
    question_id INTEGER NOT NULL,
    student_answer VARCHAR(1) NOT NULL,
    is_correct BOOLEAN NOT NULL,
    points INTEGER NOT NULL,
    earned_points INTEGER NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    
    -- Foreign Keys
    FOREIGN KEY (competition_result_id) REFERENCES competition_results(id) ON DELETE CASCADE,
    FOREIGN KEY (question_id) REFERENCES competition_questions(id) ON DELETE CASCADE,
    
    -- Constraints
    CONSTRAINT valid_answer CHECK (student_answer IN ('A', 'B', 'C', 'D')),
    CONSTRAINT valid_points CHECK (points >= 0 AND earned_points >= 0)
);

-- إنشاء فهارس للأداء
CREATE INDEX idx_competition_results_competition_id ON competition_results(competition_id);
CREATE INDEX idx_competition_results_student_id ON competition_results(student_id);
CREATE INDEX idx_competition_results_score ON competition_results(score DESC);
CREATE INDEX idx_competition_results_submitted_at ON competition_results(submitted_at DESC);

CREATE INDEX idx_student_answers_competition_result_id ON student_answers(competition_result_id);
CREATE INDEX idx_student_answers_question_id ON student_answers(question_id);

-- إنشاء trigger لتحديث updated_at
CREATE OR REPLACE FUNCTION update_competition_results_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_competition_results_updated_at
    BEFORE UPDATE ON competition_results
    FOR EACH ROW
    EXECUTE FUNCTION update_competition_results_updated_at();

-- إضافة تعليقات على الجداول
COMMENT ON TABLE competition_results IS 'نتائج الطلاب في المسابقات';
COMMENT ON TABLE student_answers IS 'إجابات الطلاب على أسئلة المسابقات';
COMMENT ON COLUMN competition_results.score IS 'الدرجة النهائية';
COMMENT ON COLUMN competition_results.percentage IS 'النسبة المئوية';
COMMENT ON COLUMN student_answers.student_answer IS 'إجابة الطالب (A/B/C/D)';
COMMENT ON COLUMN student_answers.is_correct IS 'هل الإجابة صحيحة';
COMMENT ON COLUMN student_answers.earned_points IS 'النقاط المكتسبة من السؤال';

