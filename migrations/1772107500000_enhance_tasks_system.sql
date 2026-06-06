-- تعديل القيود (Constraints) الموجودة لجدول الـ المهام 
ALTER TABLE tasks DROP CONSTRAINT tasks_status_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_status_check CHECK (status IN ('pending', 'in_progress', 'completed_by_employee', 'approved', 'rejected', 'overdue', 'completed', 'cancelled'));

-- إضافة أعمدة جديدة للمهام لتتبع دورة الحياة 
ALTER TABLE tasks ADD COLUMN start_date TIMESTAMP;
ALTER TABLE tasks ADD COLUMN approved_at TIMESTAMP;
ALTER TABLE tasks ADD COLUMN admin_notes TEXT;

-- إنشاء جدول Logs لتتبع التغييرات على المهام
CREATE TABLE IF NOT EXISTS task_logs (
    id SERIAL PRIMARY KEY,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action VARCHAR(50) NOT NULL,
    note TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_logs_task_id ON task_logs(task_id);
