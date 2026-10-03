-- Up Migration: indexes for lecture engagement report queries
CREATE INDEX IF NOT EXISTS idx_video_views_lecture_user
  ON video_views (lecture_id, user_id);

CREATE INDEX IF NOT EXISTS idx_video_views_lecture_viewed_at
  ON video_views (lecture_id, viewed_at DESC);

CREATE INDEX IF NOT EXISTS idx_lecture_views_lecture_user
  ON lecture_views (lecture_id, user_id);

CREATE INDEX IF NOT EXISTS idx_enrollments_course_user
  ON enrollments (course_id, user_id);

CREATE INDEX IF NOT EXISTS idx_scgm_group_student
  ON student_course_group_memberships (group_id, student_id);

-- Down Migration
DROP INDEX IF EXISTS idx_scgm_group_student;
DROP INDEX IF EXISTS idx_enrollments_course_user;
DROP INDEX IF EXISTS idx_lecture_views_lecture_user;
DROP INDEX IF EXISTS idx_video_views_lecture_viewed_at;
DROP INDEX IF EXISTS idx_video_views_lecture_user;
