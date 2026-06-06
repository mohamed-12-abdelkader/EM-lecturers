-- Allow students to be created with name only (no email, no phone).
-- Other roles (teacher, admin) must still have at least email or phone.

ALTER TABLE users DROP CONSTRAINT IF EXISTS email_or_phone_check;

ALTER TABLE users ADD CONSTRAINT email_or_phone_check CHECK (
  role = 'student'
  OR email IS NOT NULL
  OR phone IS NOT NULL
);
