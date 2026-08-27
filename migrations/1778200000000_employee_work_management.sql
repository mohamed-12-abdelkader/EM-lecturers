-- إدارة دوام الموظفين والمهام اليومية (لا يغيّر نظام tasks العام الحالي)

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS employee_code VARCHAR(32),
  ADD COLUMN IF NOT EXISTS department TEXT,
  ADD COLUMN IF NOT EXISTS job_title TEXT,
  ADD COLUMN IF NOT EXISTS work_start_time TIME NOT NULL DEFAULT '09:00',
  ADD COLUMN IF NOT EXISTS work_end_time TIME NOT NULL DEFAULT '17:00';

CREATE UNIQUE INDEX IF NOT EXISTS uniq_employees_employee_code
  ON employees (employee_code)
  WHERE employee_code IS NOT NULL;

CREATE SEQUENCE IF NOT EXISTS employee_code_seq START WITH 1001;

-- توليد أكواد للموظفين الحاليين بدون كود
UPDATE employees
SET employee_code = 'EMP' || LPAD(nextval('employee_code_seq')::text, 5, '0')
WHERE employee_code IS NULL;

CREATE TABLE IF NOT EXISTS employee_work_sessions (
  id              SERIAL PRIMARY KEY,
  employee_id     INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  work_date       DATE NOT NULL,
  scheduled_start_time TIME NOT NULL,
  scheduled_end_time   TIME NOT NULL,
  actual_start_at TIMESTAMPTZ,
  actual_end_at   TIMESTAMPTZ,
  start_status    VARCHAR(20)
    CHECK (start_status IS NULL OR start_status IN ('early', 'on_time', 'late')),
  end_status      VARCHAR(20)
    CHECK (end_status IS NULL OR end_status IN ('early_leave', 'on_time', 'overtime')),
  worked_minutes  INTEGER,
  status          VARCHAR(20) NOT NULL DEFAULT 'not_started'
    CHECK (status IN ('not_started', 'working', 'completed', 'absent')),
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (employee_id, work_date)
);

CREATE INDEX IF NOT EXISTS idx_employee_work_sessions_employee_date
  ON employee_work_sessions (employee_id, work_date DESC);
CREATE INDEX IF NOT EXISTS idx_employee_work_sessions_date
  ON employee_work_sessions (work_date);
CREATE INDEX IF NOT EXISTS idx_employee_work_sessions_status
  ON employee_work_sessions (status);

CREATE TABLE IF NOT EXISTS employee_daily_tasks (
  id                 SERIAL PRIMARY KEY,
  employee_id        INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  title              TEXT NOT NULL,
  description        TEXT,
  task_date          DATE NOT NULL,
  priority           VARCHAR(20) NOT NULL DEFAULT 'medium'
    CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  sort_order         INTEGER NOT NULL DEFAULT 1,
  status             VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled')),
  started_at         TIMESTAMPTZ,
  completed_at       TIMESTAMPTZ,
  completion_report  TEXT,
  created_by         INTEGER NOT NULL REFERENCES users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_employee_daily_tasks_employee_date
  ON employee_daily_tasks (employee_id, task_date DESC);
CREATE INDEX IF NOT EXISTS idx_employee_daily_tasks_date_status
  ON employee_daily_tasks (task_date, status);
CREATE INDEX IF NOT EXISTS idx_employee_daily_tasks_order
  ON employee_daily_tasks (employee_id, task_date, sort_order);
