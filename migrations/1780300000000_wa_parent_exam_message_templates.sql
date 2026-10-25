-- Up Migration
-- Teachers can edit the three parent exam WhatsApp messages.

ALTER TABLE wa_parent_exam_teacher_settings
  ADD COLUMN IF NOT EXISTS template_passed TEXT NOT NULL DEFAULT 'ولي أمر {الاسم}، نتيجة «{الامتحان}»: {الدرجة}/{المجموع} — ألف مبروك، نجح.',
  ADD COLUMN IF NOT EXISTS template_failed TEXT NOT NULL DEFAULT 'ولي أمر {الاسم}، نتيجة «{الامتحان}»: {الدرجة}/{المجموع} — للأسف ما نجحش.',
  ADD COLUMN IF NOT EXISTS template_absent TEXT NOT NULL DEFAULT 'ولي أمر {الاسم}، {الاسم} ما دخلش امتحان «{الامتحان}» خالص.';

-- Down Migration
ALTER TABLE wa_parent_exam_teacher_settings
  DROP COLUMN IF EXISTS template_passed,
  DROP COLUMN IF EXISTS template_failed,
  DROP COLUMN IF EXISTS template_absent;
