-- Add number_in_group: student order within each group (1, 2, 3... per group)
ALTER TABLE group_students ADD COLUMN IF NOT EXISTS number_in_group INTEGER;

-- Backfill existing rows: assign 1, 2, 3... per group by joined_at
WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY group_id ORDER BY joined_at ASC, id ASC) AS rn
  FROM group_students
  WHERE number_in_group IS NULL
)
UPDATE group_students gs
SET number_in_group = numbered.rn
FROM numbered
WHERE gs.id = numbered.id;

-- Now set NOT NULL and add unique constraint per group
ALTER TABLE group_students ALTER COLUMN number_in_group SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_group_students_group_number ON group_students(group_id, number_in_group);

-- Down: remove column and index
-- DROP INDEX IF EXISTS idx_group_students_group_number;
-- ALTER TABLE group_students DROP COLUMN IF EXISTS number_in_group;
