-- Up Migration: Daily Quiz Competition System
-- مسابقة يومية: إعدادات المدرس، محاولات الطلاب، نقاط، ترتيب يومي/شهري، تحفيز

BEGIN;

-- ─────────────────────────────────────────────
-- 1) المسابقات اليومية
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS daily_quizzes (
  id                SERIAL PRIMARY KEY,
  tenant_id         INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  teacher_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  grade_id          INTEGER NOT NULL REFERENCES grades(id) ON DELETE CASCADE,

  title             VARCHAR(255) NOT NULL,
  description       TEXT,

  starts_at         TIMESTAMPTZ NOT NULL,
  ends_at           TIMESTAMPTZ NOT NULL,
  duration_seconds  INTEGER NOT NULL CHECK (duration_seconds > 0),

  max_points        INTEGER NOT NULL DEFAULT 100 CHECK (max_points > 0),
  allow_one_attempt BOOLEAN NOT NULL DEFAULT TRUE,
  questions_target  INTEGER DEFAULT 0 CHECK (questions_target >= 0),
  questions_count   INTEGER NOT NULL DEFAULT 0 CHECK (questions_count >= 0),

  shuffle_questions BOOLEAN NOT NULL DEFAULT TRUE,
  shuffle_options   BOOLEAN NOT NULL DEFAULT TRUE,
  allow_navigation  BOOLEAN NOT NULL DEFAULT TRUE,
  show_answers_mode VARCHAR(32) NOT NULL DEFAULT 'after_end'
    CHECK (show_answers_mode IN ('never', 'after_submit', 'after_end')),

  -- rank_bonus: +50 للأول ثم -5 لكل مركز | time_ratio: نسبة الزمن المتبقي
  scoring_mode         VARCHAR(32) NOT NULL DEFAULT 'rank_bonus'
    CHECK (scoring_mode IN ('rank_bonus', 'time_ratio')),
  rank_bonus_start     INTEGER NOT NULL DEFAULT 50,
  rank_bonus_step      INTEGER NOT NULL DEFAULT 5,
  rank_bonus_min       INTEGER NOT NULL DEFAULT 0,
  time_ratio_max_bonus INTEGER NOT NULL DEFAULT 50,

  status            VARCHAR(32) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'archived')),
  is_visible        BOOLEAN NOT NULL DEFAULT TRUE,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT daily_quizzes_time_window CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS idx_daily_quizzes_tenant ON daily_quizzes(tenant_id);
CREATE INDEX IF NOT EXISTS idx_daily_quizzes_teacher ON daily_quizzes(teacher_id);
CREATE INDEX IF NOT EXISTS idx_daily_quizzes_grade ON daily_quizzes(grade_id);
CREATE INDEX IF NOT EXISTS idx_daily_quizzes_window ON daily_quizzes(starts_at, ends_at);
CREATE INDEX IF NOT EXISTS idx_daily_quizzes_status ON daily_quizzes(status, is_visible);
CREATE INDEX IF NOT EXISTS idx_daily_quizzes_active
  ON daily_quizzes(tenant_id, grade_id, status, starts_at, ends_at)
  WHERE status = 'published' AND is_visible = TRUE;

COMMENT ON TABLE daily_quizzes IS 'المسابقات اليومية لكل مدرس وصف دراسي';

-- ─────────────────────────────────────────────
-- 2) أسئلة المسابقة
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS daily_quiz_questions (
  id                  SERIAL PRIMARY KEY,
  quiz_id             INTEGER NOT NULL REFERENCES daily_quizzes(id) ON DELETE CASCADE,
  question_text       TEXT NOT NULL,
  question_image_url  TEXT,

  option_a            VARCHAR(1000) NOT NULL,
  option_b            VARCHAR(1000) NOT NULL,
  option_c            VARCHAR(1000) NOT NULL,
  option_d            VARCHAR(1000) NOT NULL,
  option_a_image_url  TEXT,
  option_b_image_url  TEXT,
  option_c_image_url  TEXT,
  option_d_image_url  TEXT,

  correct_answer      CHAR(1) NOT NULL CHECK (correct_answer IN ('A', 'B', 'C', 'D')),
  points              INTEGER NOT NULL DEFAULT 100 CHECK (points >= 0),
  question_order      INTEGER NOT NULL DEFAULT 0,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_daily_quiz_questions_quiz
  ON daily_quiz_questions(quiz_id, question_order);

-- عدّاد الأسئلة
CREATE OR REPLACE FUNCTION daily_quiz_sync_questions_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE daily_quizzes SET questions_count = questions_count + 1, updated_at = NOW()
    WHERE id = NEW.quiz_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE daily_quizzes SET questions_count = GREATEST(questions_count - 1, 0), updated_at = NOW()
    WHERE id = OLD.quiz_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_daily_quiz_questions_count ON daily_quiz_questions;
CREATE TRIGGER trg_daily_quiz_questions_count
  AFTER INSERT OR DELETE ON daily_quiz_questions
  FOR EACH ROW EXECUTE FUNCTION daily_quiz_sync_questions_count();

-- ─────────────────────────────────────────────
-- 3) محاولات الطلاب
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS daily_quiz_attempts (
  id               SERIAL PRIMARY KEY,
  quiz_id          INTEGER NOT NULL REFERENCES daily_quizzes(id) ON DELETE CASCADE,
  student_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  status           VARCHAR(32) NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress', 'submitted', 'expired', 'abandoned')),

  started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at       TIMESTAMPTZ NOT NULL,
  submitted_at     TIMESTAMPTZ,

  -- ترتيب عشوائي محفوظ لكل محاولة
  question_order   JSONB NOT NULL DEFAULT '[]'::jsonb,
  option_orders    JSONB NOT NULL DEFAULT '{}'::jsonb,

  ip_address       VARCHAR(64),
  user_agent       TEXT,
  device_info      JSONB,

  submit_token     VARCHAR(64), -- لمنع الإرسال المكرر من العميل
  last_autosave_at TIMESTAMPTZ,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_daily_quiz_attempt_student UNIQUE (quiz_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_daily_quiz_attempts_student
  ON daily_quiz_attempts(student_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_daily_quiz_attempts_quiz_status
  ON daily_quiz_attempts(quiz_id, status, submitted_at);

-- ─────────────────────────────────────────────
-- 4) إجابات المحاولة (autosave + نهائي)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS daily_quiz_attempt_answers (
  id              SERIAL PRIMARY KEY,
  attempt_id      INTEGER NOT NULL REFERENCES daily_quiz_attempts(id) ON DELETE CASCADE,
  question_id     INTEGER NOT NULL REFERENCES daily_quiz_questions(id) ON DELETE CASCADE,

  selected_answer CHAR(1) CHECK (selected_answer IS NULL OR selected_answer IN ('A', 'B', 'C', 'D')),
  is_correct      BOOLEAN,
  points_awarded  INTEGER NOT NULL DEFAULT 0,
  answered_at     TIMESTAMPTZ,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_daily_quiz_attempt_answer UNIQUE (attempt_id, question_id)
);

CREATE INDEX IF NOT EXISTS idx_daily_quiz_attempt_answers_attempt
  ON daily_quiz_attempt_answers(attempt_id);

-- ─────────────────────────────────────────────
-- 5) نتائج نهائية (مصدر ترتيب اليوم)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS daily_quiz_results (
  id                 SERIAL PRIMARY KEY,
  quiz_id            INTEGER NOT NULL REFERENCES daily_quizzes(id) ON DELETE CASCADE,
  attempt_id         INTEGER NOT NULL REFERENCES daily_quiz_attempts(id) ON DELETE CASCADE,
  student_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  correct_count      INTEGER NOT NULL DEFAULT 0,
  wrong_count        INTEGER NOT NULL DEFAULT 0,
  unanswered_count   INTEGER NOT NULL DEFAULT 0,

  base_points        INTEGER NOT NULL DEFAULT 0,
  speed_bonus        INTEGER NOT NULL DEFAULT 0,
  total_points       INTEGER NOT NULL DEFAULT 0,
  score_percent      NUMERIC(6, 2) NOT NULL DEFAULT 0,

  duration_ms        INTEGER NOT NULL DEFAULT 0,
  finish_rank        INTEGER,

  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_daily_quiz_result_student UNIQUE (quiz_id, student_id),
  CONSTRAINT uq_daily_quiz_result_attempt UNIQUE (attempt_id)
);

CREATE INDEX IF NOT EXISTS idx_daily_quiz_results_leaderboard
  ON daily_quiz_results(quiz_id, total_points DESC, duration_ms ASC, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_daily_quiz_results_student
  ON daily_quiz_results(student_id, created_at DESC);

-- ─────────────────────────────────────────────
-- 6) ترتيب شهري (مادة حيّة) + أرشيف
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS daily_quiz_monthly_scores (
  id                    SERIAL PRIMARY KEY,
  tenant_id             INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  grade_id              INTEGER NOT NULL REFERENCES grades(id) ON DELETE CASCADE,
  year_month            CHAR(7) NOT NULL, -- YYYY-MM
  student_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  total_points          INTEGER NOT NULL DEFAULT 0,
  quizzes_participated  INTEGER NOT NULL DEFAULT 0,
  first_place_count     INTEGER NOT NULL DEFAULT 0,
  total_correct         INTEGER NOT NULL DEFAULT 0,
  total_duration_ms     BIGINT NOT NULL DEFAULT 0,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_daily_quiz_monthly UNIQUE (tenant_id, grade_id, year_month, student_id),
  CONSTRAINT chk_daily_quiz_year_month CHECK (year_month ~ '^\d{4}-\d{2}$')
);

CREATE INDEX IF NOT EXISTS idx_daily_quiz_monthly_board
  ON daily_quiz_monthly_scores(tenant_id, grade_id, year_month, total_points DESC);

CREATE TABLE IF NOT EXISTS daily_quiz_monthly_archive (
  id                    SERIAL PRIMARY KEY,
  tenant_id             INTEGER NOT NULL,
  grade_id              INTEGER NOT NULL,
  year_month            CHAR(7) NOT NULL,
  student_id            INTEGER NOT NULL,
  rank                  INTEGER,
  total_points          INTEGER NOT NULL DEFAULT 0,
  quizzes_participated  INTEGER NOT NULL DEFAULT 0,
  first_place_count     INTEGER NOT NULL DEFAULT 0,
  total_correct         INTEGER NOT NULL DEFAULT 0,
  total_duration_ms     BIGINT NOT NULL DEFAULT 0,
  archived_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_daily_quiz_monthly_archive UNIQUE (tenant_id, grade_id, year_month, student_id)
);

CREATE INDEX IF NOT EXISTS idx_daily_quiz_monthly_archive_ym
  ON daily_quiz_monthly_archive(tenant_id, grade_id, year_month, rank);

-- ─────────────────────────────────────────────
-- 7) ملف تحفيز الطالب (XP / Level / Coins / Streak)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS daily_quiz_student_profiles (
  id                     SERIAL PRIMARY KEY,
  tenant_id              INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  student_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  xp                     INTEGER NOT NULL DEFAULT 0,
  level                  INTEGER NOT NULL DEFAULT 1,
  coins                  INTEGER NOT NULL DEFAULT 0,

  current_streak         INTEGER NOT NULL DEFAULT 0,
  longest_streak         INTEGER NOT NULL DEFAULT 0,
  last_participation_date DATE,

  best_daily_rank        INTEGER,
  total_quizzes          INTEGER NOT NULL DEFAULT 0,
  total_points_earned    INTEGER NOT NULL DEFAULT 0,
  total_first_places     INTEGER NOT NULL DEFAULT 0,
  perfect_quizzes        INTEGER NOT NULL DEFAULT 0,

  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_daily_quiz_student_profile UNIQUE (tenant_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_daily_quiz_profiles_level
  ON daily_quiz_student_profiles(tenant_id, level DESC, xp DESC);

-- ─────────────────────────────────────────────
-- 8) الشارات
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS daily_quiz_badges (
  id           SERIAL PRIMARY KEY,
  code         VARCHAR(64) NOT NULL UNIQUE,
  title_ar     VARCHAR(255) NOT NULL,
  description  TEXT,
  icon         VARCHAR(64),
  category     VARCHAR(64) NOT NULL DEFAULT 'general',
  criteria     JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS daily_quiz_student_badges (
  id          SERIAL PRIMARY KEY,
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  student_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  badge_id    INTEGER NOT NULL REFERENCES daily_quiz_badges(id) ON DELETE CASCADE,
  meta        JSONB,
  earned_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_daily_quiz_student_badge UNIQUE (tenant_id, student_id, badge_id)
);

CREATE INDEX IF NOT EXISTS idx_daily_quiz_student_badges
  ON daily_quiz_student_badges(student_id, earned_at DESC);

INSERT INTO daily_quiz_badges (code, title_ar, description, icon, category, criteria) VALUES
  ('first_place_5', 'بطل المراكز', 'أول مركز 5 مرات', '🥇', 'rank', '{"first_places": 5}'),
  ('speed_demon', 'أسرع طالب', 'حصل على أعلى speed bonus في مسابقة', '⚡', 'speed', '{"min_speed_bonus": 45}'),
  ('streak_30', 'نار متواصلة', 'شارك 30 يوماً متتالياً', '🔥', 'streak', '{"streak": 30}'),
  ('streak_7', 'أسبوع ناري', 'شارك 7 أيام متتالية', '🔥', 'streak', '{"streak": 7}'),
  ('perfect_10', 'دقة قاتلة', '100% صحيحة في 10 مسابقات', '🎯', 'accuracy', '{"perfect_quizzes": 10}'),
  ('first_quiz', 'أول مشاركة', 'شارك في أول مسابقة يومية', '🌟', 'general', '{"quizzes": 1}'),
  ('centurion', 'مئة نقطة ذهبية', 'وصل إجمالي نقاط المسابقات إلى 1000', '💯', 'points', '{"total_points": 1000}')
ON CONFLICT (code) DO NOTHING;

-- ─────────────────────────────────────────────
-- 9) سجل نقاط المسابقة اليومية
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS daily_quiz_points_history (
  id           SERIAL PRIMARY KEY,
  tenant_id    INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  student_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  quiz_id      INTEGER REFERENCES daily_quizzes(id) ON DELETE SET NULL,
  attempt_id   INTEGER REFERENCES daily_quiz_attempts(id) ON DELETE SET NULL,
  points       INTEGER NOT NULL,
  xp           INTEGER NOT NULL DEFAULT 0,
  coins        INTEGER NOT NULL DEFAULT 0,
  source_type  VARCHAR(64) NOT NULL, -- quiz_submit | badge | streak_bonus | level_up
  description  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_daily_quiz_points_history_student
  ON daily_quiz_points_history(student_id, created_at DESC);

-- ─────────────────────────────────────────────
-- 10) تتبع إشعارات مجدولة (منع التكرار)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS daily_quiz_notification_log (
  id         SERIAL PRIMARY KEY,
  quiz_id    INTEGER NOT NULL REFERENCES daily_quizzes(id) ON DELETE CASCADE,
  event_type VARCHAR(64) NOT NULL, -- started | ending_soon | results_ready
  sent_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_daily_quiz_notif UNIQUE (quiz_id, event_type)
);

-- updated_at triggers
CREATE OR REPLACE FUNCTION daily_quiz_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_daily_quizzes_updated ON daily_quizzes;
CREATE TRIGGER trg_daily_quizzes_updated
  BEFORE UPDATE ON daily_quizzes
  FOR EACH ROW EXECUTE FUNCTION daily_quiz_touch_updated_at();

DROP TRIGGER IF EXISTS trg_daily_quiz_questions_updated ON daily_quiz_questions;
CREATE TRIGGER trg_daily_quiz_questions_updated
  BEFORE UPDATE ON daily_quiz_questions
  FOR EACH ROW EXECUTE FUNCTION daily_quiz_touch_updated_at();

DROP TRIGGER IF EXISTS trg_daily_quiz_attempts_updated ON daily_quiz_attempts;
CREATE TRIGGER trg_daily_quiz_attempts_updated
  BEFORE UPDATE ON daily_quiz_attempts
  FOR EACH ROW EXECUTE FUNCTION daily_quiz_touch_updated_at();

DROP TRIGGER IF EXISTS trg_daily_quiz_results_updated ON daily_quiz_results;
CREATE TRIGGER trg_daily_quiz_results_updated
  BEFORE UPDATE ON daily_quiz_results
  FOR EACH ROW EXECUTE FUNCTION daily_quiz_touch_updated_at();

DROP TRIGGER IF EXISTS trg_daily_quiz_monthly_updated ON daily_quiz_monthly_scores;
CREATE TRIGGER trg_daily_quiz_monthly_updated
  BEFORE UPDATE ON daily_quiz_monthly_scores
  FOR EACH ROW EXECUTE FUNCTION daily_quiz_touch_updated_at();

DROP TRIGGER IF EXISTS trg_daily_quiz_profiles_updated ON daily_quiz_student_profiles;
CREATE TRIGGER trg_daily_quiz_profiles_updated
  BEFORE UPDATE ON daily_quiz_student_profiles
  FOR EACH ROW EXECUTE FUNCTION daily_quiz_touch_updated_at();

COMMIT;

-- Down Migration
-- BEGIN;
-- DROP TABLE IF EXISTS daily_quiz_notification_log;
-- DROP TABLE IF EXISTS daily_quiz_points_history;
-- DROP TABLE IF EXISTS daily_quiz_student_badges;
-- DROP TABLE IF EXISTS daily_quiz_badges;
-- DROP TABLE IF EXISTS daily_quiz_student_profiles;
-- DROP TABLE IF EXISTS daily_quiz_monthly_archive;
-- DROP TABLE IF EXISTS daily_quiz_monthly_scores;
-- DROP TABLE IF EXISTS daily_quiz_results;
-- DROP TABLE IF EXISTS daily_quiz_attempt_answers;
-- DROP TABLE IF EXISTS daily_quiz_attempts;
-- DROP TABLE IF EXISTS daily_quiz_questions;
-- DROP TABLE IF EXISTS daily_quizzes;
-- DROP FUNCTION IF EXISTS daily_quiz_sync_questions_count();
-- DROP FUNCTION IF EXISTS daily_quiz_touch_updated_at();
-- COMMIT;
