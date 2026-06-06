BEGIN;

-- 1) Drop old unique constraint on grade_id if exists
ALTER TABLE chat_groups DROP CONSTRAINT IF EXISTS chat_groups_grade_id_key;
-- Some environments might have created an index with same name
DROP INDEX IF EXISTS chat_groups_grade_id_key;

-- Ensure column exists and allow NULL (legacy rows may have NULL owner_teacher_id)
ALTER TABLE chat_groups ALTER COLUMN owner_teacher_id DROP NOT NULL;

-- 2) Create composite unique index for (grade_id, owner_teacher_id)
CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_groups_teacher_grade_unique 
ON chat_groups(grade_id, owner_teacher_id);

-- 3) Seed groups per (teacher_id, grade_id)
INSERT INTO chat_groups (grade_id, owner_teacher_id, name, allow_student_send)
SELECT tg.grade_id, tg.teacher_id, COALESCE(g.name, CONCAT('Grade ', g.id)), TRUE
FROM teacher_grades tg
JOIN grades g ON g.id = tg.grade_id
LEFT JOIN chat_groups cg ON cg.grade_id = tg.grade_id AND cg.owner_teacher_id = tg.teacher_id
WHERE cg.id IS NULL;

COMMIT;


