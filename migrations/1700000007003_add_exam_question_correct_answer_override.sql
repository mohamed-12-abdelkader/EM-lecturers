-- إضافة تجاوز للإجابة الصحيحة على مستوى امتحان المحاضرة (بدون تعديل بنك الأسئلة)
-- يُستخدم عندما يريد المدرس تغيير الإجابة الصحيحة لسؤال مُضاف من البنك في هذا الامتحان فقط

-- Up
ALTER TABLE exam_questions
  ADD COLUMN IF NOT EXISTS correct_answer_index_override INTEGER NULL;

ALTER TABLE exam_questions
  ADD CONSTRAINT exam_questions_correct_answer_override_check
  CHECK (correct_answer_index_override IS NULL OR (
    correct_answer_index_override >= 0 AND correct_answer_index_override <= 3
  ));

COMMENT ON COLUMN exam_questions.correct_answer_index_override IS '0=أ, 1=ب, 2=ج, 3=د - إن وُجد يُستخدم بدل قيمة البنك في هذا الامتحان فقط';

-- Down
ALTER TABLE exam_questions DROP CONSTRAINT IF EXISTS exam_questions_correct_answer_override_check;
ALTER TABLE exam_questions DROP COLUMN IF EXISTS correct_answer_index_override;
