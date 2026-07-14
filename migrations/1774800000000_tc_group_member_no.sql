-- Per-group student number (starts at 1 in every group)
-- member_no on enrollment + sequence table

ALTER TABLE tc_student_groups
  ADD COLUMN IF NOT EXISTS member_no INTEGER;

CREATE TABLE IF NOT EXISTS tc_group_member_seq (
  group_id    INTEGER PRIMARY KEY REFERENCES tc_groups(id) ON DELETE CASCADE,
  last_value  INTEGER NOT NULL DEFAULT 0
);

-- Backfill member_no for existing active enrollments (by enrollment order)
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY group_id
           ORDER BY enrolled_at ASC NULLS LAST, id ASC
         ) AS rn
  FROM tc_student_groups
  WHERE deleted_at IS NULL
    AND member_no IS NULL
)
UPDATE tc_student_groups sg
SET member_no = ranked.rn
FROM ranked
WHERE sg.id = ranked.id;

-- Init / sync sequence counters
INSERT INTO tc_group_member_seq (group_id, last_value)
SELECT group_id, COALESCE(MAX(member_no), 0)
FROM tc_student_groups
WHERE deleted_at IS NULL AND member_no IS NOT NULL
GROUP BY group_id
ON CONFLICT (group_id) DO UPDATE
SET last_value = GREATEST(tc_group_member_seq.last_value, EXCLUDED.last_value);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tc_sg_group_member_no
  ON tc_student_groups (group_id, member_no)
  WHERE deleted_at IS NULL AND member_no IS NOT NULL;

-- Allow same display codes across different groups (codes are group-scoped now)
ALTER TABLE tc_students DROP CONSTRAINT IF EXISTS tc_students_teacher_id_student_code_key;

-- Align existing student_code with group member_no when student has exactly one active group
UPDATE tc_students st
SET student_code = sg.member_no::text,
    updated_at = NOW()
FROM tc_student_groups sg
WHERE sg.student_id = st.id
  AND sg.deleted_at IS NULL
  AND sg.status = 'active'
  AND sg.member_no IS NOT NULL
  AND st.deleted_at IS NULL
  AND (
    SELECT COUNT(*) FROM tc_student_groups x
    WHERE x.student_id = st.id AND x.deleted_at IS NULL AND x.status = 'active'
  ) = 1;
