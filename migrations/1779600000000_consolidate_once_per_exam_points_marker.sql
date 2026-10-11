-- Up Migration
-- Marker: actual consolidation of attempt-scoped exam points → once-per-exam
-- runs in src/db/migrate.ts via TeacherPointsService.consolidateLegacyOncePerExamPoints
-- after migrations (idempotent). This file ensures deploy pipelines that only run
-- SQL migrations still bump the migration chain; logic is in application code.

SELECT 1;

-- Down Migration
SELECT 1;
