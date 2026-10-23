-- Up Migration: allow restoring platform student accounts from trash snapshots
UPDATE teacher_trash_snapshots
SET can_restore = TRUE,
    restore_blockers = ARRAY[]::text[]
WHERE entity_type = 'platform_student'
  AND restored_at IS NULL
  AND (
    can_restore = FALSE
    OR 'HARD_DELETE_NO_RECOVERY' = ANY (restore_blockers)
  );

-- Down Migration
-- (no-op: cannot reliably restore previous blocker flags)
;