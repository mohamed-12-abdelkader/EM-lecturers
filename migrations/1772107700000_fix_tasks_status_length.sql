-- Fix tasks.status length to support values like 'completed_by_employee'
-- Current schema in some environments still has VARCHAR(20), which is too short.

ALTER TABLE tasks
ALTER COLUMN status TYPE VARCHAR(40);
