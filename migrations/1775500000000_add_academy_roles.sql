-- Academy platform system (additive — does not change teacher platforms)

-- Roles
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'academy';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'academy_teacher';
