-- Flatten teacher question library: Lessons (per teacher) → Questions
-- Removes chapters and parts layers.

ALTER TABLE teacher_question_lessons
  ADD COLUMN IF NOT EXISTS teacher_id INTEGER REFERENCES users(id) ON DELETE CASCADE;

UPDATE teacher_question_lessons l
SET teacher_id = c.teacher_id
FROM teacher_question_chapters c
WHERE l.chapter_id = c.id
  AND l.teacher_id IS NULL;

ALTER TABLE teacher_questions
  ADD COLUMN IF NOT EXISTS lesson_id INTEGER REFERENCES teacher_question_lessons(id) ON DELETE CASCADE;

UPDATE teacher_questions q
SET lesson_id = p.lesson_id
FROM teacher_question_parts p
WHERE q.part_id = p.id
  AND q.lesson_id IS NULL;

ALTER TABLE teacher_question_passages
  ADD COLUMN IF NOT EXISTS lesson_id INTEGER REFERENCES teacher_question_lessons(id) ON DELETE CASCADE;

UPDATE teacher_question_passages pass
SET lesson_id = p.lesson_id
FROM teacher_question_parts p
WHERE pass.part_id = p.id
  AND pass.lesson_id IS NULL;

ALTER TABLE teacher_question_lessons
  ALTER COLUMN teacher_id SET NOT NULL;

ALTER TABLE teacher_questions
  ALTER COLUMN lesson_id SET NOT NULL;

ALTER TABLE teacher_question_passages
  ALTER COLUMN lesson_id SET NOT NULL;

ALTER TABLE teacher_questions DROP COLUMN IF EXISTS part_id;
ALTER TABLE teacher_question_passages DROP COLUMN IF EXISTS part_id;

ALTER TABLE teacher_question_lessons DROP COLUMN IF EXISTS chapter_id;

DROP TABLE IF EXISTS teacher_question_parts;
DROP TABLE IF EXISTS teacher_question_chapters;

CREATE INDEX IF NOT EXISTS idx_teacher_question_lessons_teacher_id
  ON teacher_question_lessons(teacher_id);

CREATE INDEX IF NOT EXISTS idx_teacher_questions_lesson_id
  ON teacher_questions(lesson_id);

CREATE INDEX IF NOT EXISTS idx_teacher_question_passages_lesson_id
  ON teacher_question_passages(lesson_id);

DROP INDEX IF EXISTS idx_teacher_question_passages_part_id;
