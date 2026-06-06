-- Up Migration
ALTER TABLE exam_questions ADD COLUMN IF NOT EXISTS question_id_v2 INTEGER REFERENCES questions_v2(id) ON DELETE SET NULL;

-- Down Migration
ALTER TABLE exam_questions DROP COLUMN IF EXISTS question_id_v2;
