-- Employee completion message shown to admin before approve/reject
ALTER TABLE tasks
ADD COLUMN IF NOT EXISTS employee_notes TEXT;
