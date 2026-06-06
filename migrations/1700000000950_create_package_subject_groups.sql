-- Up Migration
-- Groups داخل مادة الباقة + جدول مواعيد + ربط الطلاب

CREATE TABLE IF NOT EXISTS package_subject_item_groups (
    id SERIAL PRIMARY KEY,
    package_subject_item_id INTEGER NOT NULL REFERENCES package_subject_items(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    teacher_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(package_subject_item_id, name)
);

CREATE INDEX IF NOT EXISTS idx_psig_subject ON package_subject_item_groups(package_subject_item_id);
CREATE INDEX IF NOT EXISTS idx_psig_teacher ON package_subject_item_groups(teacher_id);

CREATE TABLE IF NOT EXISTS package_subject_item_group_schedules (
    id SERIAL PRIMARY KEY,
    group_id INTEGER NOT NULL REFERENCES package_subject_item_groups(id) ON DELETE CASCADE,
    title TEXT,
    starts_at TIMESTAMP NOT NULL,
    ends_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_psigs_group ON package_subject_item_group_schedules(group_id);
CREATE INDEX IF NOT EXISTS idx_psigs_starts_at ON package_subject_item_group_schedules(starts_at);

CREATE TABLE IF NOT EXISTS package_subject_item_group_students (
    id SERIAL PRIMARY KEY,
    group_id INTEGER NOT NULL REFERENCES package_subject_item_groups(id) ON DELETE CASCADE,
    student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    added_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    added_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(group_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_psigs_students_group ON package_subject_item_group_students(group_id);
CREATE INDEX IF NOT EXISTS idx_psigs_students_student ON package_subject_item_group_students(student_id);

-- Down Migration
DROP TABLE IF EXISTS package_subject_item_group_students;
DROP TABLE IF EXISTS package_subject_item_group_schedules;
DROP TABLE IF EXISTS package_subject_item_groups;


