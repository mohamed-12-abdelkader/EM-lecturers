-- دعم شات الدعم للزوار (غير المسجلين) بدون token
-- يستخدم guest_token لربط الشات بالزائر بدل student_id

BEGIN;

-- 1) support_chats: إضافة guest_token وجعل student_id قابلًا للـ NULL
ALTER TABLE support_chats
  ADD COLUMN IF NOT EXISTS guest_token VARCHAR(64) UNIQUE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_support_chats_guest_token
  ON support_chats (guest_token) WHERE guest_token IS NOT NULL;

-- السماح بـ student_id = NULL للشاتات الضيوف
ALTER TABLE support_chats
  DROP CONSTRAINT IF EXISTS support_chats_student_id_key;

ALTER TABLE support_chats
  ALTER COLUMN student_id DROP NOT NULL;

-- استعادة unique لـ student_id فقط عندما غير null (شات واحد لكل طالب مسجل)
CREATE UNIQUE INDEX IF NOT EXISTS idx_support_chats_student_id_unique
  ON support_chats (student_id) WHERE student_id IS NOT NULL;

-- 2) support_messages: السماح بـ sender_id = NULL للرسائل من الضيوف
ALTER TABLE support_messages
  ALTER COLUMN sender_id DROP NOT NULL;

COMMIT;
