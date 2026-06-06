-- Up Migration
-- Fix unique constraint conflict:
-- Old: UNIQUE (grade_id, owner_teacher_id) across ALL chat_groups
-- New: UNIQUE (grade_id, owner_teacher_id) ONLY for teacher-grade groups (package_subject_group_id IS NULL)
--
-- This allows creating multiple chat groups for the same (grade_id, owner_teacher_id)
-- when they are tied to different package_subject_group_id values.

DROP INDEX IF EXISTS idx_chat_groups_teacher_grade_unique;

CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_groups_teacher_grade_unique
ON chat_groups(grade_id, owner_teacher_id)
WHERE package_subject_group_id IS NULL;

-- Down Migration (best-effort)
DROP INDEX IF EXISTS idx_chat_groups_teacher_grade_unique;

CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_groups_teacher_grade_unique
ON chat_groups(grade_id, owner_teacher_id);







