-- Up Migration

CREATE TABLE IF NOT EXISTS analytics_video_sessions (
    id BIGSERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    teacher_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    course_id INTEGER REFERENCES courses(id) ON DELETE SET NULL,
    lecture_id INTEGER REFERENCES lectures(id) ON DELETE SET NULL,
    video_id INTEGER REFERENCES lecture_videos(id) ON DELETE SET NULL,
    session_key TEXT UNIQUE,
    source TEXT NOT NULL DEFAULT 'player',
    device_id TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at TIMESTAMPTZ,
    total_watch_seconds INTEGER NOT NULL DEFAULT 0,
    completion_percentage NUMERIC(5,2) NOT NULL DEFAULT 0,
    is_completed BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_analytics_video_sessions_tenant_student
ON analytics_video_sessions(tenant_id, student_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_analytics_video_sessions_course_lecture
ON analytics_video_sessions(tenant_id, course_id, lecture_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_analytics_video_sessions_video
ON analytics_video_sessions(video_id, created_at DESC);

CREATE TABLE IF NOT EXISTS analytics_watch_events (
    id BIGSERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    session_id BIGINT NOT NULL REFERENCES analytics_video_sessions(id) ON DELETE CASCADE,
    student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    video_second INTEGER NOT NULL DEFAULT 0,
    from_second INTEGER,
    to_second INTEGER,
    playback_rate NUMERIC(4,2) NOT NULL DEFAULT 1.0,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    event_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT analytics_watch_events_type_check CHECK (
      event_type IN ('play', 'pause', 'progress', 'seek', 'complete', 'heartbeat')
    )
);

CREATE INDEX IF NOT EXISTS idx_analytics_watch_events_session
ON analytics_watch_events(session_id, event_at DESC);

CREATE INDEX IF NOT EXISTS idx_analytics_watch_events_video_time
ON analytics_watch_events(tenant_id, event_type, video_second, event_at DESC);

CREATE TABLE IF NOT EXISTS analytics_student_activity_logs (
    id BIGSERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action_type TEXT NOT NULL,
    course_id INTEGER REFERENCES courses(id) ON DELETE SET NULL,
    lecture_id INTEGER REFERENCES lectures(id) ON DELETE SET NULL,
    exam_id INTEGER REFERENCES exams(id) ON DELETE SET NULL,
    meeting_id TEXT,
    duration_seconds INTEGER NOT NULL DEFAULT 0,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_analytics_activity_tenant_student
ON analytics_student_activity_logs(tenant_id, student_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_analytics_activity_type_time
ON analytics_student_activity_logs(tenant_id, action_type, occurred_at DESC);

CREATE TABLE IF NOT EXISTS analytics_exam_attempt_facts (
    id BIGSERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    teacher_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    course_id INTEGER REFERENCES courses(id) ON DELETE SET NULL,
    lecture_id INTEGER REFERENCES lectures(id) ON DELETE SET NULL,
    exam_source TEXT NOT NULL,
    exam_entity_id INTEGER NOT NULL,
    score NUMERIC(10,2),
    total_grade NUMERIC(10,2),
    percentage NUMERIC(5,2),
    passed BOOLEAN,
    attempt_number INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'submitted',
    duration_seconds INTEGER,
    started_at TIMESTAMPTZ,
    submitted_at TIMESTAMPTZ,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT analytics_exam_attempt_source_check CHECK (
      exam_source IN (
        'lecture_exam',
        'course_level_exam',
        'course_exam',
        'general_course_exam',
        'package_subject_exam',
        'group_exam'
      )
    )
);

CREATE INDEX IF NOT EXISTS idx_analytics_exam_attempts_exam
ON analytics_exam_attempt_facts(tenant_id, exam_source, exam_entity_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_analytics_exam_attempts_student
ON analytics_exam_attempt_facts(tenant_id, student_id, created_at DESC);

CREATE TABLE IF NOT EXISTS analytics_question_attempt_facts (
    id BIGSERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    attempt_fact_id BIGINT REFERENCES analytics_exam_attempt_facts(id) ON DELETE CASCADE,
    student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    question_source TEXT NOT NULL DEFAULT 'lecture_exam_question',
    question_entity_id INTEGER NOT NULL,
    exam_source TEXT NOT NULL,
    exam_entity_id INTEGER NOT NULL,
    course_id INTEGER REFERENCES courses(id) ON DELETE SET NULL,
    lecture_id INTEGER REFERENCES lectures(id) ON DELETE SET NULL,
    is_correct BOOLEAN NOT NULL,
    obtained_grade NUMERIC(10,2),
    max_grade NUMERIC(10,2),
    response_time_seconds INTEGER,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    answered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_analytics_question_attempts_question
ON analytics_question_attempt_facts(tenant_id, question_entity_id, answered_at DESC);

CREATE INDEX IF NOT EXISTS idx_analytics_question_attempts_exam
ON analytics_question_attempt_facts(tenant_id, exam_source, exam_entity_id, answered_at DESC);

CREATE TABLE IF NOT EXISTS analytics_progress_tracking_daily (
    id BIGSERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    day DATE NOT NULL,
    student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    teacher_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
    lectures_viewed INTEGER NOT NULL DEFAULT 0,
    videos_completed INTEGER NOT NULL DEFAULT 0,
    watch_seconds INTEGER NOT NULL DEFAULT 0,
    completion_percentage NUMERIC(5,2) NOT NULL DEFAULT 0,
    engagement_score NUMERIC(6,2) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, day, student_id, course_id)
);

CREATE INDEX IF NOT EXISTS idx_analytics_progress_daily_tenant_day
ON analytics_progress_tracking_daily(tenant_id, day DESC);

CREATE TABLE IF NOT EXISTS analytics_engagement_metrics_daily (
    id BIGSERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    day DATE NOT NULL,
    teacher_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
    lecture_id INTEGER REFERENCES lectures(id) ON DELETE CASCADE,
    active_students INTEGER NOT NULL DEFAULT 0,
    total_watch_seconds INTEGER NOT NULL DEFAULT 0,
    average_watch_seconds NUMERIC(12,2) NOT NULL DEFAULT 0,
    average_completion_percentage NUMERIC(5,2) NOT NULL DEFAULT 0,
    retention_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
    drop_off_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, day, course_id, lecture_id)
);

CREATE INDEX IF NOT EXISTS idx_analytics_engagement_daily_tenant_day
ON analytics_engagement_metrics_daily(tenant_id, day DESC);

CREATE TABLE IF NOT EXISTS analytics_performance_reports (
    id BIGSERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    report_scope TEXT NOT NULL,
    scope_id INTEGER,
    period_type TEXT NOT NULL,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    summary JSONB NOT NULL DEFAULT '{}'::jsonb,
    generated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT analytics_performance_scope_check CHECK (
      report_scope IN ('platform', 'teacher', 'course', 'student')
    ),
    CONSTRAINT analytics_performance_period_check CHECK (
      period_type IN ('daily', 'weekly', 'monthly')
    )
);

CREATE INDEX IF NOT EXISTS idx_analytics_reports_scope
ON analytics_performance_reports(tenant_id, report_scope, scope_id, generated_at DESC);

CREATE TABLE IF NOT EXISTS analytics_alerts (
    id BIGSERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    teacher_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    student_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
    alert_type TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'medium',
    message TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT analytics_alerts_severity_check CHECK (severity IN ('low', 'medium', 'high'))
);

CREATE INDEX IF NOT EXISTS idx_analytics_alerts_tenant_teacher
ON analytics_alerts(tenant_id, teacher_id, is_read, created_at DESC);

CREATE TABLE IF NOT EXISTS analytics_recommendations (
    id BIGSERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    teacher_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    student_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
    recommendation_type TEXT NOT NULL,
    recommendation_text TEXT NOT NULL,
    confidence NUMERIC(5,2) NOT NULL DEFAULT 0,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_analytics_recommendations_teacher
ON analytics_recommendations(tenant_id, teacher_id, generated_at DESC);

-- Down Migration
DROP TABLE IF EXISTS analytics_recommendations;
DROP TABLE IF EXISTS analytics_alerts;
DROP TABLE IF EXISTS analytics_performance_reports;
DROP TABLE IF EXISTS analytics_engagement_metrics_daily;
DROP TABLE IF EXISTS analytics_progress_tracking_daily;
DROP TABLE IF EXISTS analytics_question_attempt_facts;
DROP TABLE IF EXISTS analytics_exam_attempt_facts;
DROP TABLE IF EXISTS analytics_student_activity_logs;
DROP TABLE IF EXISTS analytics_watch_events;
DROP TABLE IF EXISTS analytics_video_sessions;
