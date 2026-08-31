import pool from '../../db/pool';
import type { RecordTrashSnapshotInput, TrashEntityType, TrashListItem } from './types';

type TrashRow = {
  entity_type: string;
  id: number;
  title: string;
  subtitle: string | null;
  deleted_at: Date | string;
  can_restore: boolean;
  restore_blockers: string[] | null;
  source: 'live' | 'snapshot' | 'activity_log';
  metadata: Record<string, unknown> | null;
};

function mapRow(row: TrashRow): TrashListItem {
  return {
    type: row.entity_type,
    id: row.id,
    title: row.title,
    subtitle: row.subtitle,
    deletedAt: new Date(row.deleted_at).toISOString(),
    canRestore: row.can_restore,
    restoreBlockers: row.restore_blockers ?? [],
    source: row.source,
    metadata: row.metadata ?? {},
  };
}

export class TeacherTrashRepository {
  static async listLiveTrash(
    teacherId: number,
    opts: {
      type?: string;
      search?: string;
      page?: number;
      limit?: number;
    } = {},
  ): Promise<{ rows: TrashListItem[]; total: number }> {
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(100, Math.max(1, opts.limit ?? 30));
    const offset = (page - 1) * limit;
    const params: unknown[] = [teacherId];
    const unions: string[] = [];

    const typeFilter = opts.type?.trim();
    const search = opts.search?.trim();
    let searchParamIndex: number | null = null;
    if (search) {
      params.push(`%${search}%`);
      searchParamIndex = params.length;
    }

    function addUnion(entityType: string, sql: string) {
      if (typeFilter && typeFilter !== entityType) return;
      unions.push(sql);
    }

    addUnion(
      'center_group',
      `SELECT
         'center_group'::text AS entity_type,
         g.id,
         g.name AS title,
         COALESCE(gr.name, '') AS subtitle,
         g.deleted_at,
         TRUE AS can_restore,
         ARRAY[]::text[] AS restore_blockers,
         'live'::text AS source,
         jsonb_build_object('grade_id', g.grade_id, 'status', g.status) AS metadata
       FROM tc_groups g
       LEFT JOIN grades gr ON gr.id = g.grade_id
       WHERE g.teacher_id = $1 AND g.deleted_at IS NOT NULL`,
    );

    addUnion(
      'center_student',
      `SELECT
         'center_student'::text,
         st.id,
         st.full_name,
         COALESCE(st.student_code, st.phone, '') AS subtitle,
         st.deleted_at,
         TRUE,
         ARRAY[]::text[],
         'live'::text,
         jsonb_build_object('phone', st.phone, 'parent_phone', st.parent_phone) AS metadata
       FROM tc_students st
       WHERE st.teacher_id = $1 AND st.deleted_at IS NOT NULL`,
    );

    addUnion(
      'center_enrollment',
      `SELECT
         'center_enrollment'::text,
         sg.id,
         st.full_name || ' — ' || g.name AS title,
         COALESCE(sg.status, '') AS subtitle,
         sg.deleted_at,
         CASE WHEN g.deleted_at IS NULL THEN TRUE ELSE FALSE END AS can_restore,
         CASE WHEN g.deleted_at IS NOT NULL THEN ARRAY['GROUP_DELETED']::text[] ELSE ARRAY[]::text[] END AS restore_blockers,
         'live'::text,
         jsonb_build_object('student_id', sg.student_id, 'group_id', sg.group_id, 'member_no', sg.member_no) AS metadata
       FROM tc_student_groups sg
       JOIN tc_students st ON st.id = sg.student_id AND st.teacher_id = $1
       JOIN tc_groups g ON g.id = sg.group_id AND g.teacher_id = $1
       WHERE sg.deleted_at IS NOT NULL`,
    );

    addUnion(
      'center_exam',
      `SELECT
         'center_exam'::text,
         e.id,
         COALESCE(e.title, 'امتحان') AS title,
         g.name AS subtitle,
         e.deleted_at,
         CASE WHEN g.deleted_at IS NULL THEN TRUE ELSE FALSE END,
         CASE WHEN g.deleted_at IS NOT NULL THEN ARRAY['GROUP_DELETED']::text[] ELSE ARRAY[]::text[] END,
         'live'::text,
         jsonb_build_object('group_id', e.group_id, 'exam_date', e.exam_date) AS metadata
       FROM tc_group_exams e
       JOIN tc_groups g ON g.id = e.group_id AND g.teacher_id = $1
       WHERE e.teacher_id = $1 AND e.deleted_at IS NOT NULL`,
    );

    addUnion(
      'center_payment',
      `SELECT
         'center_payment'::text,
         p.id,
         COALESCE(st.full_name, 'دفعة') AS title,
         COALESCE(p.amount::text, '') AS subtitle,
         p.deleted_at,
         TRUE,
         ARRAY[]::text[],
         'live'::text,
         jsonb_build_object('student_id', p.student_id, 'group_id', p.group_id) AS metadata
       FROM tc_payments p
       LEFT JOIN tc_students st ON st.id = p.student_id
       WHERE p.teacher_id = $1 AND p.deleted_at IS NOT NULL`,
    );

    addUnion(
      'center_subscription',
      `SELECT
         'center_subscription'::text,
         sub.id,
         COALESCE(st.full_name, 'اشتراك') AS title,
         (sub.year::text || '-' || sub.month::text) AS subtitle,
         sub.deleted_at,
         TRUE,
         ARRAY[]::text[],
         'live'::text,
         jsonb_build_object('student_id', sub.student_id, 'group_id', sub.group_id, 'status', sub.status) AS metadata
       FROM tc_monthly_subscriptions sub
       LEFT JOIN tc_students st ON st.id = sub.student_id
       WHERE sub.teacher_id = $1 AND sub.deleted_at IS NOT NULL`,
    );

    addUnion(
      'teacher_file',
      `SELECT
         'teacher_file'::text,
         f.id,
         f.name AS title,
         COALESCE(f.source_type, '') AS subtitle,
         f.deleted_at,
         TRUE AS can_restore,
         ARRAY[]::text[] AS restore_blockers,
         'live'::text,
         jsonb_build_object('source_type', f.source_type, 'mime_type', f.mime_type) AS metadata
       FROM teacher_files f
       WHERE f.teacher_id = $1 AND f.deleted_at IS NOT NULL`,
    );

    addUnion(
      'course_file',
      `SELECT
         'course_file'::text,
         cf.id,
         COALESCE(cf.title, cf.name) AS title,
         COALESCE(c.title, '') AS subtitle,
         cf.deleted_at,
         CASE WHEN cf.storage_deleted_at IS NULL THEN TRUE ELSE FALSE END,
         CASE WHEN cf.storage_deleted_at IS NOT NULL THEN ARRAY['STORAGE_PURGED']::text[] ELSE ARRAY[]::text[] END,
         'live'::text,
         jsonb_build_object('course_id', cf.course_id, 'lecture_id', cf.lecture_id) AS metadata
       FROM course_files cf
       JOIN courses c ON c.id = cf.course_id
       WHERE c.teacher_id = $1 AND cf.deleted_at IS NOT NULL`,
    );

    if (unions.length === 0) {
      return { rows: [], total: 0 };
    }

    let searchSql = '';
    if (searchParamIndex) {
      searchSql = ` AND (title ILIKE $${searchParamIndex} OR subtitle ILIKE $${searchParamIndex})`;
    }

    const inner = unions.join('\nUNION ALL\n');
    const countSql = `SELECT COUNT(*)::int AS total FROM (${inner}) trash WHERE 1=1${searchSql}`;
    const listSql = `
      SELECT * FROM (${inner}) trash
      WHERE 1=1${searchSql}
      ORDER BY deleted_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;

    const countParams = [...params];
    const listParams = [...params, limit, offset];

    const [countRes, listRes] = await Promise.all([
      pool.query<{ total: number }>(countSql, countParams),
      pool.query<TrashRow>(listSql, listParams),
    ]);

    return {
      rows: listRes.rows.map(mapRow),
      total: countRes.rows[0]?.total ?? 0,
    };
  }

  static async listSnapshots(
    teacherId: number,
    opts: { type?: string; search?: string; page?: number; limit?: number } = {},
  ): Promise<{ rows: TrashListItem[]; total: number }> {
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(100, Math.max(1, opts.limit ?? 30));
    const offset = (page - 1) * limit;
    const params: unknown[] = [teacherId];
    const where = ['teacher_id = $1', 'restored_at IS NULL'];

    if (opts.type?.trim()) {
      params.push(opts.type.trim());
      where.push(`entity_type = $${params.length}`);
    }
    if (opts.search?.trim()) {
      params.push(`%${opts.search.trim()}%`);
      where.push(`(title ILIKE $${params.length} OR subtitle ILIKE $${params.length})`);
    }

    const whereSql = where.join(' AND ');
    const [countRes, listRes] = await Promise.all([
      pool.query<{ total: number }>(
        `SELECT COUNT(*)::int AS total FROM teacher_trash_snapshots WHERE ${whereSql}`,
        params,
      ),
      pool.query<{
        entity_type: string;
        entity_id: number | null;
        title: string;
        subtitle: string | null;
        deleted_at: Date;
        can_restore: boolean;
        restore_blockers: string[] | null;
        id: number;
        snapshot: Record<string, unknown>;
      }>(
        `SELECT id, entity_type, entity_id, title, subtitle, deleted_at, can_restore, restore_blockers, snapshot
         FROM teacher_trash_snapshots
         WHERE ${whereSql}
         ORDER BY deleted_at DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset],
      ),
    ]);

    return {
      rows: listRes.rows.map((row) =>
        mapRow({
          entity_type: row.entity_type,
          id: row.id,
          title: row.title,
          subtitle: row.subtitle,
          deleted_at: row.deleted_at,
          can_restore: row.can_restore,
          restore_blockers: row.restore_blockers,
          source: 'snapshot',
          metadata: {
            ...(row.snapshot ?? {}),
            original_entity_id: row.entity_id,
            snapshot_id: row.id,
          },
        }),
      ),
      total: countRes.rows[0]?.total ?? 0,
    };
  }

  static async listActivityLogDeletes(teacherId: number): Promise<TrashListItem[]> {
    const result = await pool.query<{
      id: number;
      entity_type: string;
      entity_id: number | null;
      action: string;
      description: string | null;
      created_at: Date;
    }>(
      `SELECT id, entity_type, entity_id, action, description, created_at
       FROM teacher_activity_log
       WHERE teacher_id = $1
         AND action ILIKE '%delete%'
       ORDER BY created_at DESC
       LIMIT 500`,
      [teacherId],
    );

    return result.rows.map((row) => ({
      type: row.entity_type,
      id: row.entity_id ?? row.id,
      title: row.description || row.action,
      subtitle: row.action,
      deletedAt: new Date(row.created_at).toISOString(),
      canRestore: false,
      restoreBlockers: ['NO_SNAPSHOT'],
      source: 'activity_log' as const,
      metadata: {
        activity_log_id: row.id,
        entity_id: row.entity_id,
      },
    }));
  }

  static async insertSnapshot(input: RecordTrashSnapshotInput): Promise<number> {
    const result = await pool.query<{ id: number }>(
      `INSERT INTO teacher_trash_snapshots (
         teacher_id, tenant_id, entity_type, entity_id, title, subtitle,
         snapshot, deleted_by, can_restore, restore_blockers
       ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10)
       RETURNING id`,
      [
        input.teacherId,
        input.tenantId ?? null,
        input.entityType,
        input.entityId ?? null,
        input.title,
        input.subtitle ?? null,
        JSON.stringify(input.snapshot ?? {}),
        input.deletedBy ?? null,
        input.canRestore ?? true,
        input.restoreBlockers ?? [],
      ],
    );
    return result.rows[0].id;
  }

  static async getSnapshot(snapshotId: number, teacherId: number) {
    const result = await pool.query(
      `SELECT * FROM teacher_trash_snapshots
       WHERE id = $1 AND teacher_id = $2 AND restored_at IS NULL`,
      [snapshotId, teacherId],
    );
    return result.rows[0] ?? null;
  }

  static async markSnapshotRestored(snapshotId: number, teacherId: number): Promise<boolean> {
    const result = await pool.query(
      `UPDATE teacher_trash_snapshots
       SET restored_at = NOW()
       WHERE id = $1 AND teacher_id = $2 AND restored_at IS NULL`,
      [snapshotId, teacherId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  static async restoreCenterGroup(id: number, teacherId: number): Promise<boolean> {
    const result = await pool.query(
      `UPDATE tc_groups
       SET deleted_at = NULL, status = 'active', updated_at = NOW()
       WHERE id = $1 AND teacher_id = $2 AND deleted_at IS NOT NULL`,
      [id, teacherId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  static async restoreCenterStudent(id: number, teacherId: number): Promise<boolean> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `UPDATE tc_students
         SET deleted_at = NULL, is_active = TRUE, updated_at = NOW()
         WHERE id = $1 AND teacher_id = $2 AND deleted_at IS NOT NULL`,
        [id, teacherId],
      );
      if ((result.rowCount ?? 0) === 0) {
        await client.query('ROLLBACK');
        return false;
      }
      await client.query(
        `UPDATE tc_student_groups sg
         SET deleted_at = NULL, status = 'active', updated_at = NOW()
         FROM tc_groups g
         WHERE sg.student_id = $1
           AND sg.group_id = g.id
           AND g.teacher_id = $2
           AND g.deleted_at IS NULL
           AND sg.deleted_at IS NOT NULL`,
        [id, teacherId],
      );
      await client.query('COMMIT');
      return true;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  static async restoreCenterEnrollment(id: number, teacherId: number): Promise<boolean> {
    const result = await pool.query(
      `UPDATE tc_student_groups sg
       SET deleted_at = NULL, status = 'active', updated_at = NOW()
       FROM tc_groups g, tc_students st
       WHERE sg.id = $1
         AND sg.group_id = g.id AND g.teacher_id = $2 AND g.deleted_at IS NULL
         AND sg.student_id = st.id AND st.teacher_id = $2 AND st.deleted_at IS NULL
         AND sg.deleted_at IS NOT NULL`,
      [id, teacherId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  static async restoreCenterExam(id: number, teacherId: number): Promise<boolean> {
    const result = await pool.query(
      `UPDATE tc_group_exams e
       SET deleted_at = NULL, updated_at = NOW()
       FROM tc_groups g
       WHERE e.id = $1 AND e.teacher_id = $2 AND e.deleted_at IS NOT NULL
         AND e.group_id = g.id AND g.deleted_at IS NULL`,
      [id, teacherId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  static async restoreCenterPayment(id: number, teacherId: number): Promise<boolean> {
    const result = await pool.query(
      `UPDATE tc_payments
       SET deleted_at = NULL, updated_at = NOW()
       WHERE id = $1 AND teacher_id = $2 AND deleted_at IS NOT NULL`,
      [id, teacherId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  static async restoreCenterSubscription(id: number, teacherId: number): Promise<boolean> {
    const result = await pool.query(
      `UPDATE tc_monthly_subscriptions
       SET deleted_at = NULL, updated_at = NOW()
       WHERE id = $1 AND teacher_id = $2 AND deleted_at IS NOT NULL`,
      [id, teacherId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  static async restoreTeacherFile(id: number, teacherId: number): Promise<boolean> {
    const result = await pool.query(
      `UPDATE teacher_files
       SET deleted_at = NULL, updated_at = NOW()
       WHERE id = $1 AND teacher_id = $2 AND deleted_at IS NOT NULL`,
      [id, teacherId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  static async restoreCourseFile(id: number, teacherId: number): Promise<boolean> {
    const result = await pool.query(
      `UPDATE course_files cf
       SET deleted_at = NULL, updated_at = NOW()
       FROM courses c
       WHERE cf.id = $1 AND cf.deleted_at IS NOT NULL AND cf.storage_deleted_at IS NULL
         AND cf.course_id = c.id AND c.teacher_id = $2`,
      [id, teacherId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  static async restoreCourseFromSnapshot(
    snapshot: Record<string, unknown>,
    teacherId: number,
  ): Promise<number | null> {
    const row = snapshot;
    const id = Number(row.id);
    if (!Number.isInteger(id) || id <= 0) return null;

    const exists = await pool.query(`SELECT 1 FROM courses WHERE id = $1`, [id]);
    if (exists.rowCount) return null;

    const result = await pool.query(
      `INSERT INTO courses (
         id, title, description, teacher_id, tenant_id, subject_id, grade_id,
         price, image, is_visible, created_at, updated_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE($10, FALSE), COALESCE($11, NOW()), NOW()
       )
       ON CONFLICT (id) DO NOTHING
       RETURNING id`,
      [
        id,
        row.title ?? 'كورس مستعاد',
        row.description ?? null,
        teacherId,
        row.tenant_id ?? null,
        row.subject_id ?? null,
        row.grade_id ?? null,
        row.price ?? 0,
        row.image ?? null,
        row.is_visible ?? false,
        row.created_at ?? null,
      ],
    );
    return result.rows[0]?.id ?? null;
  }

  static async restoreLectureFromSnapshot(
    snapshot: Record<string, unknown>,
    teacherId: number,
  ): Promise<number | null> {
    const row = snapshot;
    const tableName = String(row.table_name || 'lectures');
    const id = Number(row.id);
    if (!Number.isInteger(id) || id <= 0) return null;

    const courseId = Number(row.course_id);
    const owns = await pool.query(`SELECT 1 FROM courses WHERE id = $1 AND teacher_id = $2`, [
      courseId,
      teacherId,
    ]);
    if (!owns.rowCount) return null;

    if (tableName === 'course_lectures') {
      const exists = await pool.query(`SELECT 1 FROM course_lectures WHERE id = $1`, [id]);
      if (exists.rowCount) return null;
      const result = await pool.query(
        `INSERT INTO course_lectures (id, course_id, title, description, order_index, is_free, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,NOW()),NOW())
         ON CONFLICT (id) DO NOTHING RETURNING id`,
        [
          id,
          courseId,
          row.title ?? 'محاضرة مستعادة',
          row.description ?? null,
          row.order_index ?? 0,
          row.is_free ?? false,
          row.created_at ?? null,
        ],
      );
      return result.rows[0]?.id ?? null;
    }

    const exists = await pool.query(`SELECT 1 FROM lectures WHERE id = $1`, [id]);
    if (exists.rowCount) return null;
    const result = await pool.query(
      `INSERT INTO lectures (id, course_id, title, description, order_index, is_free, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,NOW()))
       ON CONFLICT (id) DO NOTHING RETURNING id`,
      [
        id,
        courseId,
        row.title ?? 'محاضرة مستعادة',
        row.description ?? null,
        row.order_index ?? 0,
        row.is_free ?? false,
        row.created_at ?? null,
      ],
    );
    return result.rows[0]?.id ?? null;
  }

  static isKnownLiveType(type: string): type is TrashEntityType {
    return [
      'center_group',
      'center_student',
      'center_enrollment',
      'center_exam',
      'center_payment',
      'center_subscription',
      'teacher_file',
      'course_file',
    ].includes(type);
  }
}
