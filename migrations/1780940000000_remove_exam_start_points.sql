-- Up Migration: exam points are score-only (remove start-exam bonuses)

UPDATE teacher_points_settings
SET exam_start_enabled = FALSE,
    exam_start_points = 0,
    updated_at = NOW()
WHERE exam_start_enabled IS DISTINCT FROM FALSE
   OR COALESCE(exam_start_points, 0) <> 0;

DELETE FROM point_transactions
WHERE event_type = 'EXAM_START';

-- Rebuild balances from remaining ledger rows
DELETE FROM student_point_balances;

INSERT INTO student_point_balances (student_id, teacher_id, grade_id, total_points)
SELECT student_id,
       teacher_id,
       grade_id,
       GREATEST(0, COALESCE(SUM(points), 0)::int)
FROM point_transactions
GROUP BY student_id, teacher_id, grade_id;

-- Down Migration
-- (no automatic restore of deleted EXAM_START rows)
