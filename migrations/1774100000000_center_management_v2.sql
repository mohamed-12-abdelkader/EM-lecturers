-- Up Migration
-- =============================================================================
-- Center Management System v2
-- نظام إدارة السنتر التعليمي — جداول مستقلة (cm_*) مع Soft Delete وفهارس
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------- Centers ----------
CREATE TABLE IF NOT EXISTS cm_centers (
  id              SERIAL PRIMARY KEY,
  owner_user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  tenant_id       INTEGER REFERENCES tenants(id) ON DELETE SET NULL,
  name            VARCHAR(200) NOT NULL,
  description     TEXT,
  phone           VARCHAR(30),
  address         TEXT,
  default_fee     NUMERIC(12, 2) NOT NULL DEFAULT 0,
  currency        VARCHAR(10) NOT NULL DEFAULT 'EGP',
  settings        JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_cm_centers_owner ON cm_centers(owner_user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cm_centers_tenant ON cm_centers(tenant_id) WHERE deleted_at IS NULL;

-- ---------- Roles (seed) ----------
CREATE TABLE IF NOT EXISTS cm_roles (
  id          SERIAL PRIMARY KEY,
  code        VARCHAR(40) NOT NULL UNIQUE,
  name_ar     VARCHAR(100) NOT NULL,
  name_en     VARCHAR(100) NOT NULL,
  description TEXT,
  is_system   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO cm_roles (code, name_ar, name_en, description) VALUES
  ('owner', 'المالك', 'Owner', 'صلاحيات كاملة على السنتر'),
  ('admin', 'مدير', 'Admin', 'إدارة كاملة باستثناء نقل الملكية'),
  ('teacher', 'مدرس', 'Teacher', 'إدارة المجموعات والطلاب والحضور'),
  ('accountant', 'محاسب', 'Accountant', 'الاشتراكات والمدفوعات والماليات'),
  ('assistant', 'مساعد', 'Assistant', 'تسجيل الحضور وعرض البيانات')
ON CONFLICT (code) DO NOTHING;

-- ---------- Permissions (seed) ----------
CREATE TABLE IF NOT EXISTS cm_permissions (
  id          SERIAL PRIMARY KEY,
  code        VARCHAR(80) NOT NULL UNIQUE,
  name_ar     VARCHAR(150) NOT NULL,
  module      VARCHAR(60) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO cm_permissions (code, name_ar, module) VALUES
  ('center.view', 'عرض السنتر', 'center'),
  ('center.update', 'تعديل السنتر', 'center'),
  ('center.delete', 'حذف السنتر', 'center'),
  ('staff.manage', 'إدارة الموظفين', 'staff'),
  ('grades.manage', 'إدارة الصفوف', 'grades'),
  ('groups.manage', 'إدارة المجموعات', 'groups'),
  ('students.manage', 'إدارة الطلاب', 'students'),
  ('students.view', 'عرض الطلاب', 'students'),
  ('attendance.manage', 'تسجيل الحضور', 'attendance'),
  ('attendance.view', 'عرض الحضور', 'attendance'),
  ('subscriptions.manage', 'إدارة الاشتراكات', 'subscriptions'),
  ('subscriptions.view', 'عرض الاشتراكات', 'subscriptions'),
  ('payments.manage', 'إدارة المدفوعات', 'payments'),
  ('payments.view', 'عرض المدفوعات', 'payments'),
  ('finance.view', 'عرض الماليات', 'finance'),
  ('dashboard.view', 'عرض لوحة التحكم', 'dashboard'),
  ('reports.view', 'عرض التقارير', 'reports'),
  ('activity.view', 'عرض سجل النشاط', 'activity'),
  ('notifications.view', 'عرض الإشعارات', 'notifications')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS cm_role_permissions (
  role_id       INTEGER NOT NULL REFERENCES cm_roles(id) ON DELETE CASCADE,
  permission_id INTEGER NOT NULL REFERENCES cm_permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

-- Owner: all
INSERT INTO cm_role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM cm_roles r CROSS JOIN cm_permissions p
WHERE r.code = 'owner'
ON CONFLICT DO NOTHING;

-- Admin: all except center.delete
INSERT INTO cm_role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM cm_roles r CROSS JOIN cm_permissions p
WHERE r.code = 'admin' AND p.code <> 'center.delete'
ON CONFLICT DO NOTHING;

-- Teacher
INSERT INTO cm_role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM cm_roles r
JOIN cm_permissions p ON p.code IN (
  'center.view', 'grades.manage', 'groups.manage',
  'students.manage', 'students.view',
  'attendance.manage', 'attendance.view',
  'subscriptions.view', 'payments.view',
  'dashboard.view', 'reports.view', 'activity.view', 'notifications.view'
)
WHERE r.code = 'teacher'
ON CONFLICT DO NOTHING;

-- Accountant
INSERT INTO cm_role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM cm_roles r
JOIN cm_permissions p ON p.code IN (
  'center.view', 'students.view',
  'subscriptions.manage', 'subscriptions.view',
  'payments.manage', 'payments.view',
  'finance.view', 'dashboard.view', 'reports.view',
  'activity.view', 'notifications.view'
)
WHERE r.code = 'accountant'
ON CONFLICT DO NOTHING;

-- Assistant
INSERT INTO cm_role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM cm_roles r
JOIN cm_permissions p ON p.code IN (
  'center.view', 'students.view',
  'attendance.manage', 'attendance.view',
  'dashboard.view', 'notifications.view'
)
WHERE r.code = 'assistant'
ON CONFLICT DO NOTHING;

-- ---------- Staff memberships ----------
CREATE TABLE IF NOT EXISTS cm_staff (
  id              SERIAL PRIMARY KEY,
  center_id       INTEGER NOT NULL REFERENCES cm_centers(id) ON DELETE CASCADE,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id         INTEGER NOT NULL REFERENCES cm_roles(id) ON DELETE RESTRICT,
  custom_permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  invited_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ,
  UNIQUE (center_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_cm_staff_center ON cm_staff(center_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cm_staff_user ON cm_staff(user_id) WHERE deleted_at IS NULL;

-- ---------- Center grades (صفوف السنتر) ----------
CREATE TABLE IF NOT EXISTS cm_grades (
  id              SERIAL PRIMARY KEY,
  center_id       INTEGER NOT NULL REFERENCES cm_centers(id) ON DELETE CASCADE,
  name            VARCHAR(150) NOT NULL,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  platform_grade_id INTEGER REFERENCES grades(id) ON DELETE SET NULL,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ,
  UNIQUE (center_id, name)
);

CREATE INDEX IF NOT EXISTS idx_cm_grades_center ON cm_grades(center_id) WHERE deleted_at IS NULL;

-- ---------- Groups ----------
CREATE TABLE IF NOT EXISTS cm_groups (
  id              SERIAL PRIMARY KEY,
  center_id       INTEGER NOT NULL REFERENCES cm_centers(id) ON DELETE CASCADE,
  grade_id        INTEGER NOT NULL REFERENCES cm_grades(id) ON DELETE RESTRICT,
  name            VARCHAR(200) NOT NULL,
  days            TEXT[] NOT NULL DEFAULT '{}',
  session_time    TIME,
  duration_minutes INTEGER,
  max_capacity    INTEGER,
  status          VARCHAR(20) NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'paused')),
  notes           TEXT,
  default_fee     NUMERIC(12, 2),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_cm_groups_center ON cm_groups(center_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cm_groups_grade ON cm_groups(grade_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cm_groups_status ON cm_groups(center_id, status) WHERE deleted_at IS NULL;

-- ---------- Students ----------
CREATE TABLE IF NOT EXISTS cm_students (
  id              SERIAL PRIMARY KEY,
  center_id       INTEGER NOT NULL REFERENCES cm_centers(id) ON DELETE CASCADE,
  public_id       UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  student_code    VARCHAR(40) NOT NULL,
  full_name       VARCHAR(200) NOT NULL,
  phone           VARCHAR(30),
  parent_phone    VARCHAR(30),
  grade_id        INTEGER REFERENCES cm_grades(id) ON DELETE SET NULL,
  joined_at       DATE NOT NULL DEFAULT CURRENT_DATE,
  notes           TEXT,
  platform_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ,
  UNIQUE (center_id, student_code)
);

CREATE INDEX IF NOT EXISTS idx_cm_students_center ON cm_students(center_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cm_students_name ON cm_students(center_id, full_name) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cm_students_phone ON cm_students(center_id, phone) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cm_students_parent ON cm_students(center_id, parent_phone) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cm_students_grade ON cm_students(grade_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cm_students_public ON cm_students(public_id);

-- Sequence helper for student codes per center
CREATE TABLE IF NOT EXISTS cm_student_code_seq (
  center_id       INTEGER PRIMARY KEY REFERENCES cm_centers(id) ON DELETE CASCADE,
  last_value      INTEGER NOT NULL DEFAULT 0
);

-- ---------- Student QR Codes ----------
CREATE TABLE IF NOT EXISTS cm_student_qrcodes (
  id              SERIAL PRIMARY KEY,
  student_id      INTEGER NOT NULL REFERENCES cm_students(id) ON DELETE CASCADE UNIQUE,
  qr_token        UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  qr_payload      TEXT NOT NULL,
  qr_image_base64 TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cm_qr_token ON cm_student_qrcodes(qr_token);

-- ---------- Group enrollments ----------
CREATE TABLE IF NOT EXISTS cm_enrollments (
  id              SERIAL PRIMARY KEY,
  group_id        INTEGER NOT NULL REFERENCES cm_groups(id) ON DELETE CASCADE,
  student_id      INTEGER NOT NULL REFERENCES cm_students(id) ON DELETE CASCADE,
  enrolled_at     DATE NOT NULL DEFAULT CURRENT_DATE,
  status          VARCHAR(20) NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'left', 'suspended')),
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ,
  UNIQUE (group_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_cm_enrollments_group ON cm_enrollments(group_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cm_enrollments_student ON cm_enrollments(student_id) WHERE deleted_at IS NULL;

-- ---------- Attendance sessions (حصة / يوم) ----------
CREATE TABLE IF NOT EXISTS cm_attendance_sessions (
  id              SERIAL PRIMARY KEY,
  center_id       INTEGER NOT NULL REFERENCES cm_centers(id) ON DELETE CASCADE,
  group_id        INTEGER NOT NULL REFERENCES cm_groups(id) ON DELETE CASCADE,
  session_date    DATE NOT NULL,
  starts_at       TIMESTAMPTZ,
  ends_at         TIMESTAMPTZ,
  title           VARCHAR(200),
  created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ,
  UNIQUE (group_id, session_date)
);

CREATE INDEX IF NOT EXISTS idx_cm_att_sessions_center ON cm_attendance_sessions(center_id, session_date)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cm_att_sessions_group ON cm_attendance_sessions(group_id, session_date)
  WHERE deleted_at IS NULL;

-- ---------- Attendance records ----------
CREATE TABLE IF NOT EXISTS cm_attendance (
  id              SERIAL PRIMARY KEY,
  session_id      INTEGER NOT NULL REFERENCES cm_attendance_sessions(id) ON DELETE CASCADE,
  student_id      INTEGER NOT NULL REFERENCES cm_students(id) ON DELETE CASCADE,
  status          VARCHAR(20) NOT NULL DEFAULT 'present'
                  CHECK (status IN ('present', 'absent', 'late', 'excused')),
  checked_in_at   TIMESTAMPTZ,
  method          VARCHAR(20) NOT NULL DEFAULT 'manual'
                  CHECK (method IN ('manual', 'qr', 'bulk')),
  notes           TEXT,
  recorded_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (session_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_cm_attendance_student ON cm_attendance(student_id);
CREATE INDEX IF NOT EXISTS idx_cm_attendance_status ON cm_attendance(session_id, status);

-- ---------- Subscriptions ----------
CREATE TABLE IF NOT EXISTS cm_subscriptions (
  id              SERIAL PRIMARY KEY,
  center_id       INTEGER NOT NULL REFERENCES cm_centers(id) ON DELETE CASCADE,
  student_id      INTEGER NOT NULL REFERENCES cm_students(id) ON DELETE CASCADE,
  group_id        INTEGER REFERENCES cm_groups(id) ON DELETE SET NULL,
  amount          NUMERIC(12, 2) NOT NULL,
  month           SMALLINT NOT NULL CHECK (month BETWEEN 1 AND 12),
  year            SMALLINT NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  starts_at       DATE NOT NULL,
  ends_at         DATE NOT NULL,
  status          VARCHAR(20) NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('active', 'expired', 'pending')),
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ,
  UNIQUE (student_id, month, year, group_id)
);

CREATE INDEX IF NOT EXISTS idx_cm_subs_center ON cm_subscriptions(center_id, year, month)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cm_subs_student ON cm_subscriptions(student_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cm_subs_status ON cm_subscriptions(center_id, status) WHERE deleted_at IS NULL;

-- ---------- Payments ----------
CREATE TABLE IF NOT EXISTS cm_payments (
  id              SERIAL PRIMARY KEY,
  center_id       INTEGER NOT NULL REFERENCES cm_centers(id) ON DELETE CASCADE,
  student_id      INTEGER NOT NULL REFERENCES cm_students(id) ON DELETE CASCADE,
  subscription_id INTEGER REFERENCES cm_subscriptions(id) ON DELETE SET NULL,
  amount          NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  paid_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  month           SMALLINT NOT NULL CHECK (month BETWEEN 1 AND 12),
  year            SMALLINT NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  method          VARCHAR(40) NOT NULL DEFAULT 'cash'
                  CHECK (method IN ('cash', 'card', 'transfer', 'wallet', 'other')),
  transaction_ref VARCHAR(100),
  notes           TEXT,
  recorded_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_cm_payments_center ON cm_payments(center_id, year, month)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cm_payments_student ON cm_payments(student_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cm_payments_paid_at ON cm_payments(center_id, paid_at DESC)
  WHERE deleted_at IS NULL;

-- ---------- Invoices / receipts ----------
CREATE TABLE IF NOT EXISTS cm_invoices (
  id              SERIAL PRIMARY KEY,
  center_id       INTEGER NOT NULL REFERENCES cm_centers(id) ON DELETE CASCADE,
  payment_id      INTEGER NOT NULL REFERENCES cm_payments(id) ON DELETE CASCADE UNIQUE,
  invoice_number  VARCHAR(60) NOT NULL,
  issued_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  snapshot        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (center_id, invoice_number)
);

CREATE INDEX IF NOT EXISTS idx_cm_invoices_center ON cm_invoices(center_id, issued_at DESC);

CREATE TABLE IF NOT EXISTS cm_invoice_seq (
  center_id       INTEGER PRIMARY KEY REFERENCES cm_centers(id) ON DELETE CASCADE,
  last_value      INTEGER NOT NULL DEFAULT 0
);

-- ---------- Activity logs ----------
CREATE TABLE IF NOT EXISTS cm_activity_logs (
  id              BIGSERIAL PRIMARY KEY,
  center_id       INTEGER NOT NULL REFERENCES cm_centers(id) ON DELETE CASCADE,
  actor_user_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action          VARCHAR(80) NOT NULL,
  entity_type     VARCHAR(60),
  entity_id       INTEGER,
  meta            JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address      VARCHAR(60),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cm_activity_center ON cm_activity_logs(center_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cm_activity_action ON cm_activity_logs(center_id, action);
CREATE INDEX IF NOT EXISTS idx_cm_activity_entity ON cm_activity_logs(center_id, entity_type, entity_id);

-- ---------- Notifications ----------
CREATE TABLE IF NOT EXISTS cm_notifications (
  id              BIGSERIAL PRIMARY KEY,
  center_id       INTEGER NOT NULL REFERENCES cm_centers(id) ON DELETE CASCADE,
  user_id         INTEGER REFERENCES users(id) ON DELETE CASCADE,
  student_id      INTEGER REFERENCES cm_students(id) ON DELETE CASCADE,
  type            VARCHAR(60) NOT NULL,
  title           VARCHAR(250) NOT NULL,
  body            TEXT,
  meta            JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_read         BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cm_notif_center ON cm_notifications(center_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cm_notif_user ON cm_notifications(user_id, is_read, created_at DESC)
  WHERE user_id IS NOT NULL;

-- Down Migration
DROP TABLE IF EXISTS cm_notifications CASCADE;
DROP TABLE IF EXISTS cm_activity_logs CASCADE;
DROP TABLE IF EXISTS cm_invoices CASCADE;
DROP TABLE IF EXISTS cm_invoice_seq CASCADE;
DROP TABLE IF EXISTS cm_payments CASCADE;
DROP TABLE IF EXISTS cm_subscriptions CASCADE;
DROP TABLE IF EXISTS cm_attendance CASCADE;
DROP TABLE IF EXISTS cm_attendance_sessions CASCADE;
DROP TABLE IF EXISTS cm_enrollments CASCADE;
DROP TABLE IF EXISTS cm_student_qrcodes CASCADE;
DROP TABLE IF EXISTS cm_students CASCADE;
DROP TABLE IF EXISTS cm_student_code_seq CASCADE;
DROP TABLE IF EXISTS cm_groups CASCADE;
DROP TABLE IF EXISTS cm_grades CASCADE;
DROP TABLE IF EXISTS cm_staff CASCADE;
DROP TABLE IF EXISTS cm_role_permissions CASCADE;
DROP TABLE IF EXISTS cm_permissions CASCADE;
DROP TABLE IF EXISTS cm_roles CASCADE;
DROP TABLE IF EXISTS cm_centers CASCADE;
