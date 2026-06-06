-- Up Migration
-- إضافة فهارس لتحسين أداء استعلامات تتبع تقدم الطلاب

-- فهارس لجدول lecture_views
CREATE INDEX IF NOT EXISTS idx_lecture_views_user_lecture ON lecture_views(user_id, lecture_id);
CREATE INDEX IF NOT EXISTS idx_lecture_views_lecture_id ON lecture_views(lecture_id);

-- فهارس لجدول video_views
CREATE INDEX IF NOT EXISTS idx_video_views_user_course ON video_views(user_id, course_id);
CREATE INDEX IF NOT EXISTS idx_video_views_course_id ON video_views(course_id);
CREATE INDEX IF NOT EXISTS idx_video_views_lecture_id ON video_views(lecture_id);

-- فهارس لجدول exam_submissions
CREATE INDEX IF NOT EXISTS idx_exam_submissions_student_exam ON exam_submissions(student_id, exam_id);
CREATE INDEX IF NOT EXISTS idx_exam_submissions_exam_id ON exam_submissions(exam_id);

-- فهارس لجدول course_exam_submissions
CREATE INDEX IF NOT EXISTS idx_course_exam_submissions_student_exam ON course_exam_submissions(student_id, exam_id);
CREATE INDEX IF NOT EXISTS idx_course_exam_submissions_exam_id ON course_exam_submissions(exam_id);

-- فهارس لجدول enrollments
CREATE INDEX IF NOT EXISTS idx_enrollments_course_user ON enrollments(course_id, user_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_user_id ON enrollments(user_id);

-- فهارس لجدول lectures
CREATE INDEX IF NOT EXISTS idx_lectures_course_position ON lectures(course_id, position);

-- فهارس لجدول lecture_videos
CREATE INDEX IF NOT EXISTS idx_lecture_videos_lecture_position ON lecture_videos(lecture_id, position);

-- فهارس لجدول exams
CREATE INDEX IF NOT EXISTS idx_exams_lecture_type ON exams(lecture_id, type);

-- فهارس لجدول course_exams
CREATE INDEX IF NOT EXISTS idx_course_exams_course_id ON course_exams(course_id);

-- Down Migration
DROP INDEX IF EXISTS idx_lecture_views_user_lecture;
DROP INDEX IF EXISTS idx_lecture_views_lecture_id;
DROP INDEX IF EXISTS idx_video_views_user_course;
DROP INDEX IF EXISTS idx_video_views_course_id;
DROP INDEX IF EXISTS idx_video_views_lecture_id;
DROP INDEX IF EXISTS idx_exam_submissions_student_exam;
DROP INDEX IF EXISTS idx_exam_submissions_exam_id;
DROP INDEX IF EXISTS idx_course_exam_submissions_student_exam;
DROP INDEX IF EXISTS idx_course_exam_submissions_exam_id;
DROP INDEX IF EXISTS idx_enrollments_course_user;
DROP INDEX IF EXISTS idx_enrollments_user_id;
DROP INDEX IF EXISTS idx_lectures_course_position;
DROP INDEX IF EXISTS idx_lecture_videos_lecture_position;
DROP INDEX IF EXISTS idx_exams_lecture_type;
DROP INDEX IF EXISTS idx_course_exams_course_id;

