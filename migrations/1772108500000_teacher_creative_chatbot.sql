-- Teacher creative chatbot generations and reference uploads

CREATE TABLE IF NOT EXISTS teacher_creative_generations (
  id SERIAL PRIMARY KEY,
  teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_type TEXT NOT NULL CHECK (request_type IN ('post', 'image')),
  prompt TEXT NOT NULL,
  platform TEXT,
  tone TEXT,
  aspect_ratio TEXT,
  status TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'completed', 'failed')),
  generated_text TEXT,
  generated_image_url TEXT,
  provider TEXT,
  provider_model TEXT,
  provider_response JSONB NOT NULL DEFAULT '{}'::jsonb,
  logo_path TEXT,
  error_message TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS teacher_creative_reference_files (
  id SERIAL PRIMARY KEY,
  generation_id INTEGER NOT NULL REFERENCES teacher_creative_generations(id) ON DELETE CASCADE,
  teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_url TEXT NOT NULL,
  original_name TEXT,
  mime_type TEXT,
  file_size INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_teacher_creative_generations_teacher_created
  ON teacher_creative_generations(teacher_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_teacher_creative_generations_type
  ON teacher_creative_generations(request_type);

CREATE INDEX IF NOT EXISTS idx_teacher_creative_reference_files_generation
  ON teacher_creative_reference_files(generation_id);

ALTER TABLE notifications
DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE notifications
ADD CONSTRAINT notifications_type_check
CHECK (type IN (
  'lecture_added',
  'video_added',
  'file_added',
  'social_comment',
  'social_reply',
  'social_like',
  'social_reaction',
  'group_message',
  'direct_message',
  'essay_exam_created',
  'exam_graded',
  'exam_added',
  'exam_updated',
  'quiz_added',
  'quiz_updated',
  'package_lesson_added',
  'package_video_added',
  'package_assignment_added',
  'package_exam_added',
  'package_file_added',
  'course_update',
  'course_content_update',
  'live_stream_started',
  'task_assigned',
  'task_deadline_reminder',
  'task_rejected',
  'task_approved',
  'teacher_creative_reminder'
));
