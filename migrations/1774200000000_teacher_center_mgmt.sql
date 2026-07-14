-- Up Migration
-- Teacher Center Management — نظام سنتر المدرس (بديل cm_*)
-- مدرس واحد يملك كل البيانات عبر teacher_id

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- إزالة نظام السنتر السابق (multi-center / cm_*)
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

-- ========== Groups ==========
CREATE TABLE IF NOT EXISTS tc_groups (
  id                SERIAL PRIMARY KEY,
  teacher_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name              VARCHAR(200) NOT NULL,
  grade_id          INTEGER REFERENCES grades(id) ON DELETE SET NULL,
  subject_id        INTEGER REFERENCES subjects(id) ON DELETE SET NULL,
  days              TEXT[] NOT NULL DEFAULT '{}',
  start_time        TIME,
  end_time          TIME,
  monthly_fee       NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (monthly_fee >= 0),
  study_start_date  DATE,
  status            VARCHAR(20) NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'paused')),
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_tc_groups_teacher ON tc_groups(teacher_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tc_groups_grade ON tc_groups(grade_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tc_groups_status ON tc_groups(teacher_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tc_groups_name ON tc_groups(teacher_id, name) WHERE deleted_at IS NULL;

-- ========== Students ==========
CREATE TABLE IF NOT EXISTS tc_students (
  id                SERIAL PRIMARY KEY,
  teacher_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_id         UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  student_code      VARCHAR(40) NOT NULL,
  full_name         VARCHAR(200) NOT NULL,
  phone             VARCHAR(30),
  parent_phone      VARCHAR(30),
  notes             TEXT,
  joined_at         DATE NOT NULL DEFAULT CURRENT_DATE,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at        TIMESTAMPTZ
  -- student_code is unique per group via tc_student_groups.member_no (not per teacher)
);

CREATE INDEX IF NOT EXISTS idx_tc_students_teacher ON tc_students(teacher_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tc_students_name ON tc_students(teacher_id, full_name) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tc_students_phone ON tc_students(teacher_id, phone) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tc_students_parent ON tc_students(teacher_id, parent_phone) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tc_students_code ON tc_students(teacher_id, student_code) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS tc_student_code_seq (
  teacher_id        INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  last_value        INTEGER NOT NULL DEFAULT 0
);

-- ========== Student ↔ Group (M2M) ==========
CREATE TABLE IF NOT EXISTS tc_student_groups (
  id                SERIAL PRIMARY KEY,
  student_id        INTEGER NOT NULL REFERENCES tc_students(id) ON DELETE CASCADE,
  group_id          INTEGER NOT NULL REFERENCES tc_groups(id) ON DELETE CASCADE,
  /** Sequential id inside the group — starts at 1 for every group */
  member_no         INTEGER,
  enrolled_at       DATE NOT NULL DEFAULT CURRENT_DATE,
  status            VARCHAR(20) NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'left')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at        TIMESTAMPTZ,
  UNIQUE (student_id, group_id)
);

CREATE INDEX IF NOT EXISTS idx_tc_sg_group ON tc_student_groups(group_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tc_sg_student ON tc_student_groups(student_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_tc_sg_group_member_no
  ON tc_student_groups (group_id, member_no)
  WHERE deleted_at IS NULL AND member_no IS NOT NULL;

CREATE TABLE IF NOT EXISTS tc_group_member_seq (
  group_id    INTEGER PRIMARY KEY REFERENCES tc_groups(id) ON DELETE CASCADE,
  last_value  INTEGER NOT NULL DEFAULT 0
);

-- ========== QR / Barcode ==========
CREATE TABLE IF NOT EXISTS tc_qr_codes (
  id                SERIAL PRIMARY KEY,
  student_id        INTEGER NOT NULL REFERENCES tc_students(id) ON DELETE CASCADE UNIQUE,
  qr_token          UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  qr_payload        TEXT NOT NULL,
  qr_image_base64   TEXT,
  barcode           VARCHAR(64),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tc_qr_token ON tc_qr_codes(qr_token);
CREATE INDEX IF NOT EXISTS idx_tc_qr_barcode ON tc_qr_codes(barcode) WHERE barcode IS NOT NULL;

-- ========== Billing months (فتح شهر) ==========
CREATE TABLE IF NOT EXISTS tc_billing_months (
  id                SERIAL PRIMARY KEY,
  teacher_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  year              SMALLINT NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  month             SMALLINT NOT NULL CHECK (month BETWEEN 1 AND 12),
  opened_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  opened_by         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (teacher_id, year, month)
);

CREATE INDEX IF NOT EXISTS idx_tc_months_teacher ON tc_billing_months(teacher_id, year DESC, month DESC);

-- ========== Monthly subscriptions ==========
CREATE TABLE IF NOT EXISTS tc_monthly_subscriptions (
  id                SERIAL PRIMARY KEY,
  teacher_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  student_id        INTEGER NOT NULL REFERENCES tc_students(id) ON DELETE CASCADE,
  group_id          INTEGER NOT NULL REFERENCES tc_groups(id) ON DELETE CASCADE,
  year              SMALLINT NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  month             SMALLINT NOT NULL CHECK (month BETWEEN 1 AND 12),
  status            VARCHAR(20) NOT NULL DEFAULT 'unpaid'
                    CHECK (status IN ('paid', 'unpaid', 'partial', 'exempt')),
  amount_due        NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (amount_due >= 0),
  amount_paid       NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  remaining         NUMERIC(12, 2) NOT NULL DEFAULT 0,
  exemption_reason  TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at        TIMESTAMPTZ,
  UNIQUE (student_id, group_id, year, month)
);

CREATE INDEX IF NOT EXISTS idx_tc_subs_teacher ON tc_monthly_subscriptions(teacher_id, year, month)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tc_subs_student ON tc_monthly_subscriptions(student_id)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tc_subs_status ON tc_monthly_subscriptions(teacher_id, status)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tc_subs_group ON tc_monthly_subscriptions(group_id, year, month)
  WHERE deleted_at IS NULL;

-- ========== Payments ==========
CREATE TABLE IF NOT EXISTS tc_payments (
  id                SERIAL PRIMARY KEY,
  teacher_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  student_id        INTEGER NOT NULL REFERENCES tc_students(id) ON DELETE CASCADE,
  group_id          INTEGER REFERENCES tc_groups(id) ON DELETE SET NULL,
  subscription_id   INTEGER REFERENCES tc_monthly_subscriptions(id) ON DELETE SET NULL,
  year              SMALLINT NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  month             SMALLINT NOT NULL CHECK (month BETWEEN 1 AND 12),
  amount            NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  remaining_after   NUMERIC(12, 2) NOT NULL DEFAULT 0,
  paid_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  method            VARCHAR(30) NOT NULL DEFAULT 'cash'
                    CHECK (method IN ('cash', 'transfer', 'vodafone_cash', 'other')),
  notes             TEXT,
  recorded_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_tc_payments_teacher ON tc_payments(teacher_id, year, month)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tc_payments_student ON tc_payments(student_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tc_payments_paid_at ON tc_payments(teacher_id, paid_at DESC)
  WHERE deleted_at IS NULL;

-- ========== Attendance ==========
CREATE TABLE IF NOT EXISTS tc_attendance (
  id                SERIAL PRIMARY KEY,
  teacher_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id          INTEGER NOT NULL REFERENCES tc_groups(id) ON DELETE CASCADE,
  student_id        INTEGER NOT NULL REFERENCES tc_students(id) ON DELETE CASCADE,
  attendance_date   DATE NOT NULL,
  day_name          VARCHAR(30),
  status            VARCHAR(20) NOT NULL
                    CHECK (status IN ('present', 'absent', 'late', 'excused')),
  checked_in_at     TIMESTAMPTZ,
  method            VARCHAR(20) NOT NULL DEFAULT 'manual'
                    CHECK (method IN ('manual', 'qr')),
  notes             TEXT,
  recorded_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (student_id, group_id, attendance_date)
);

CREATE INDEX IF NOT EXISTS idx_tc_att_teacher_date ON tc_attendance(teacher_id, attendance_date);
CREATE INDEX IF NOT EXISTS idx_tc_att_group_date ON tc_attendance(group_id, attendance_date);
CREATE INDEX IF NOT EXISTS idx_tc_att_student ON tc_attendance(student_id, attendance_date);

-- ========== Audit log ==========
CREATE TABLE IF NOT EXISTS tc_activity_logs (
  id                BIGSERIAL PRIMARY KEY,
  teacher_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action            VARCHAR(80) NOT NULL,
  entity_type       VARCHAR(60),
  entity_id         INTEGER,
  meta              JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tc_activity_teacher ON tc_activity_logs(teacher_id, created_at DESC);

-- Down Migration
DROP TABLE IF EXISTS tc_activity_logs CASCADE;
DROP TABLE IF EXISTS tc_attendance CASCADE;
DROP TABLE IF EXISTS tc_payments CASCADE;
DROP TABLE IF EXISTS tc_monthly_subscriptions CASCADE;
DROP TABLE IF EXISTS tc_billing_months CASCADE;
DROP TABLE IF EXISTS tc_qr_codes CASCADE;
DROP TABLE IF EXISTS tc_student_groups CASCADE;
DROP TABLE IF EXISTS tc_students CASCADE;
DROP TABLE IF EXISTS tc_student_code_seq CASCADE;
DROP TABLE IF EXISTS tc_groups CASCADE;
