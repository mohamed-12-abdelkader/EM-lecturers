-- Up Migration
-- سجل المحذوفات للعناصر التي تُحذف نهائياً (hard delete) + استعادتها لاحقاً
CREATE TABLE IF NOT EXISTS teacher_trash_snapshots (
  id                SERIAL PRIMARY KEY,
  teacher_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id         INTEGER REFERENCES tenants(id) ON DELETE SET NULL,
  entity_type       VARCHAR(64) NOT NULL,
  entity_id         INTEGER,
  title             TEXT NOT NULL,
  subtitle          TEXT,
  snapshot          JSONB NOT NULL DEFAULT '{}'::jsonb,
  deleted_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  restored_at       TIMESTAMPTZ,
  can_restore       BOOLEAN NOT NULL DEFAULT TRUE,
  restore_blockers  TEXT[] NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_teacher_trash_snapshots_teacher_deleted
  ON teacher_trash_snapshots (teacher_id, deleted_at DESC)
  WHERE restored_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_teacher_trash_snapshots_entity
  ON teacher_trash_snapshots (teacher_id, entity_type, entity_id)
  WHERE restored_at IS NULL;

COMMENT ON TABLE teacher_trash_snapshots IS 'نسخة احتياطية للعناصر المحذوفة نهائياً — للاستعادة عند الطلب';

-- Down Migration
DROP TABLE IF EXISTS teacher_trash_snapshots;
