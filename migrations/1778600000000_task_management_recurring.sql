-- Up Migration
-- نظام المهام المتكررة: Template → Assignment → Instance

CREATE TABLE IF NOT EXISTS task_templates (
  id                SERIAL PRIMARY KEY,
  title             TEXT NOT NULL,
  description       TEXT,
  task_type         VARCHAR(20) NOT NULL CHECK (task_type IN ('daily', 'weekly')),
  priority          VARCHAR(20) NOT NULL DEFAULT 'medium'
                    CHECK (priority IN ('low', 'medium', 'high')),
  start_date        DATE NOT NULL,
  end_date          DATE,
  scheduled_time    TIME,
  admin_notes       TEXT,
  status            VARCHAR(20) NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'cancelled', 'archived')),
  allow_attachments BOOLEAN NOT NULL DEFAULT TRUE,
  created_by        INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_templates_type ON task_templates(task_type);
CREATE INDEX IF NOT EXISTS idx_task_templates_status ON task_templates(status);
CREATE INDEX IF NOT EXISTS idx_task_templates_dates ON task_templates(start_date, end_date);

CREATE TABLE IF NOT EXISTS task_template_attachments (
  id            SERIAL PRIMARY KEY,
  template_id   INTEGER NOT NULL REFERENCES task_templates(id) ON DELETE CASCADE,
  file_name     TEXT NOT NULL,
  file_path     TEXT NOT NULL,
  file_size     INTEGER,
  uploaded_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_template_attachments_template ON task_template_attachments(template_id);

CREATE TABLE IF NOT EXISTS task_assignments (
  id            SERIAL PRIMARY KEY,
  template_id   INTEGER NOT NULL REFERENCES task_templates(id) ON DELETE CASCADE,
  employee_id   INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  status        VARCHAR(20) NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'cancelled')),
  assigned_by   INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  assigned_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cancelled_at  TIMESTAMPTZ,
  UNIQUE (template_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_task_assignments_template ON task_assignments(template_id);
CREATE INDEX IF NOT EXISTS idx_task_assignments_employee ON task_assignments(employee_id);
CREATE INDEX IF NOT EXISTS idx_task_assignments_status ON task_assignments(status);

CREATE TABLE IF NOT EXISTS task_instances (
  id              SERIAL PRIMARY KEY,
  assignment_id   INTEGER NOT NULL REFERENCES task_assignments(id) ON DELETE CASCADE,
  template_id     INTEGER NOT NULL REFERENCES task_templates(id) ON DELETE CASCADE,
  employee_id     INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  instance_type   VARCHAR(20) NOT NULL CHECK (instance_type IN ('daily', 'weekly')),
  period_start    DATE NOT NULL,
  period_end      DATE NOT NULL,
  status          VARCHAR(20) NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'in_progress', 'completed', 'overdue', 'cancelled', 'missed')),
  due_at          TIMESTAMPTZ,
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  employee_notes  TEXT,
  reminder_sent_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (assignment_id, period_start, instance_type)
);

CREATE INDEX IF NOT EXISTS idx_task_instances_employee_period ON task_instances(employee_id, period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_task_instances_template ON task_instances(template_id);
CREATE INDEX IF NOT EXISTS idx_task_instances_status ON task_instances(status);
CREATE INDEX IF NOT EXISTS idx_task_instances_due ON task_instances(due_at);

CREATE TABLE IF NOT EXISTS task_instance_notes (
  id              SERIAL PRIMARY KEY,
  instance_id     INTEGER NOT NULL REFERENCES task_instances(id) ON DELETE CASCADE,
  author_user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  note            TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_instance_notes_instance ON task_instance_notes(instance_id);

CREATE TABLE IF NOT EXISTS task_instance_attachments (
  id              SERIAL PRIMARY KEY,
  instance_id     INTEGER NOT NULL REFERENCES task_instances(id) ON DELETE CASCADE,
  file_name       TEXT NOT NULL,
  file_path       TEXT NOT NULL,
  file_size       INTEGER,
  uploaded_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_instance_attachments_instance ON task_instance_attachments(instance_id);

CREATE TABLE IF NOT EXISTS task_activity_logs (
  id              SERIAL PRIMARY KEY,
  template_id     INTEGER REFERENCES task_templates(id) ON DELETE SET NULL,
  assignment_id   INTEGER REFERENCES task_assignments(id) ON DELETE SET NULL,
  instance_id     INTEGER REFERENCES task_instances(id) ON DELETE SET NULL,
  actor_user_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action          VARCHAR(80) NOT NULL,
  details         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_activity_template ON task_activity_logs(template_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_activity_instance ON task_activity_logs(instance_id, created_at DESC);

COMMENT ON TABLE task_templates IS 'قالب المهمة المتكررة (Daily / Weekly)';
COMMENT ON TABLE task_assignments IS 'ربط المهمة بموظف — حالة مستقلة لكل موظف';
COMMENT ON TABLE task_instances IS 'نسخة يومية أو أسبوعية من المهمة لموظف محدد';
COMMENT ON TABLE task_activity_logs IS 'سجل تدقيق عمليات المهام';

-- Down Migration
DROP TABLE IF EXISTS task_activity_logs;
DROP TABLE IF EXISTS task_instance_attachments;
DROP TABLE IF EXISTS task_instance_notes;
DROP TABLE IF EXISTS task_instances;
DROP TABLE IF EXISTS task_assignments;
DROP TABLE IF EXISTS task_template_attachments;
DROP TABLE IF EXISTS task_templates;
