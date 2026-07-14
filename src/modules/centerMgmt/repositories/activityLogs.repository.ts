import pool from '../../../db/pool';

export class ActivityLogsRepository {
  static async log(input: {
    teacherId: number;
    actorUserId?: number | null;
    action: string;
    entityType?: string | null;
    entityId?: number | null;
    meta?: Record<string, unknown>;
  }): Promise<void> {
    await pool.query(
      `INSERT INTO tc_activity_logs (teacher_id, actor_user_id, action, entity_type, entity_id, meta)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [
        input.teacherId,
        input.actorUserId ?? null,
        input.action,
        input.entityType ?? null,
        input.entityId ?? null,
        JSON.stringify(input.meta ?? {}),
      ],
    );
  }
}
