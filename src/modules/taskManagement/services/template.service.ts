import pool from '../../../db/pool';
import { HttpError } from '../../../utils';
import type { TaskPriority, TaskTemplateRow, TaskType, TemplateStatus } from '../types';
import { TaskActivityService } from './activity.service';
import { safeDateStr } from '../utils/period';

export class TaskTemplateService {
  static async create(input: {
    title: string;
    description?: string | null;
    taskType: TaskType;
    priority?: TaskPriority;
    startDate: string;
    endDate?: string | null;
    scheduledTime?: string | null;
    adminNotes?: string | null;
    allowAttachments?: boolean;
    createdBy: number;
  }) {
    if (input.endDate && input.endDate < input.startDate) {
      throw new HttpError(400, 'تاريخ النهاية يجب أن يكون بعد تاريخ البداية');
    }

    const r = await pool.query<TaskTemplateRow>(
      `INSERT INTO task_templates
         (title, description, task_type, priority, start_date, end_date, scheduled_time, admin_notes, allow_attachments, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [
        input.title.trim(),
        input.description?.trim() || null,
        input.taskType,
        input.priority ?? 'medium',
        input.startDate,
        input.endDate ?? null,
        input.scheduledTime ?? null,
        input.adminNotes?.trim() || null,
        input.allowAttachments !== false,
        input.createdBy,
      ],
    );

    await TaskActivityService.log({
      templateId: r.rows[0].id,
      actorUserId: input.createdBy,
      action: 'template_created',
      details: { title: input.title, task_type: input.taskType },
    });

    return this.serializeTemplate(r.rows[0]);
  }

  static async getById(templateId: number) {
    const r = await pool.query<TaskTemplateRow>(
      `SELECT * FROM task_templates WHERE id = $1`,
      [templateId],
    );
    if (!r.rowCount) throw new HttpError(404, 'المهمة غير موجودة');
    return this.serializeTemplate(r.rows[0]);
  }

  static async list(filters: {
    search?: string;
    taskType?: TaskType;
    status?: TemplateStatus;
    priority?: TaskPriority;
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(filters.page ?? 1, 1);
    const limit = Math.min(Math.max(filters.limit ?? 20, 1), 100);
    const offset = (page - 1) * limit;
    const conditions = ['1=1'];
    const values: unknown[] = [];
    let i = 1;

    if (filters.search?.trim()) {
      conditions.push(`(t.title ILIKE $${i} OR t.description ILIKE $${i})`);
      values.push(`%${filters.search.trim()}%`);
      i++;
    }
    if (filters.taskType) {
      conditions.push(`t.task_type = $${i++}`);
      values.push(filters.taskType);
    }
    if (filters.status) {
      conditions.push(`t.status = $${i++}`);
      values.push(filters.status);
    }
    if (filters.priority) {
      conditions.push(`t.priority = $${i++}`);
      values.push(filters.priority);
    }

    const where = conditions.join(' AND ');
    const countRes = await pool.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM task_templates t WHERE ${where}`,
      values,
    );

    const listRes = await pool.query(
      `SELECT t.*,
              u.name AS created_by_name,
              (SELECT COUNT(*)::int FROM task_assignments a WHERE a.template_id = t.id AND a.status = 'active') AS assigned_count
       FROM task_templates t
       LEFT JOIN users u ON u.id = t.created_by
       WHERE ${where}
       ORDER BY t.created_at DESC
       LIMIT $${i++} OFFSET $${i++}`,
      [...values, limit, offset],
    );

    return {
      templates: listRes.rows.map((row) => ({
        ...this.serializeTemplate(row),
        created_by_name: row.created_by_name,
        assigned_count: Number(row.assigned_count ?? 0),
      })),
      pagination: {
        page,
        limit,
        total: Number(countRes.rows[0]?.total ?? 0),
        total_pages: Math.ceil(Number(countRes.rows[0]?.total ?? 0) / limit),
      },
    };
  }

  static async update(
    templateId: number,
    patch: Partial<{
      title: string;
      description: string | null;
      priority: TaskPriority;
      startDate: string;
      endDate: string | null;
      scheduledTime: string | null;
      adminNotes: string | null;
      allowAttachments: boolean;
      status: TemplateStatus;
    }>,
    actorUserId: number,
  ) {
    const current = await this.getById(templateId);
    const fields: string[] = [];
    const vals: unknown[] = [];
    let p = 1;

    if (patch.title !== undefined) {
      fields.push(`title = $${p++}`);
      vals.push(patch.title.trim());
    }
    if (patch.description !== undefined) {
      fields.push(`description = $${p++}`);
      vals.push(patch.description);
    }
    if (patch.priority !== undefined) {
      fields.push(`priority = $${p++}`);
      vals.push(patch.priority);
    }
    if (patch.startDate !== undefined) {
      fields.push(`start_date = $${p++}`);
      vals.push(patch.startDate);
    }
    if (patch.endDate !== undefined) {
      fields.push(`end_date = $${p++}`);
      vals.push(patch.endDate);
    }
    if (patch.scheduledTime !== undefined) {
      fields.push(`scheduled_time = $${p++}`);
      vals.push(patch.scheduledTime);
    }
    if (patch.adminNotes !== undefined) {
      fields.push(`admin_notes = $${p++}`);
      vals.push(patch.adminNotes);
    }
    if (patch.allowAttachments !== undefined) {
      fields.push(`allow_attachments = $${p++}`);
      vals.push(patch.allowAttachments);
    }
    if (patch.status !== undefined) {
      fields.push(`status = $${p++}`);
      vals.push(patch.status);
    }

    if (!fields.length) return current;

    fields.push('updated_at = NOW()');
    vals.push(templateId);

    const r = await pool.query<TaskTemplateRow>(
      `UPDATE task_templates SET ${fields.join(', ')} WHERE id = $${p} RETURNING *`,
      vals,
    );

    await TaskActivityService.log({
      templateId,
      actorUserId,
      action: 'template_updated',
      details: patch as Record<string, unknown>,
    });

    return this.serializeTemplate(r.rows[0]);
  }

  static async cancel(templateId: number, actorUserId: number) {
    const t = await this.update(templateId, { status: 'cancelled' }, actorUserId);
    await pool.query(
      `UPDATE task_assignments SET status = 'cancelled', cancelled_at = NOW()
       WHERE template_id = $1 AND status = 'active'`,
      [templateId],
    );
    await pool.query(
      `UPDATE task_instances SET status = 'cancelled', updated_at = NOW()
       WHERE template_id = $1 AND status IN ('pending', 'in_progress')`,
      [templateId],
    );
    await TaskActivityService.log({
      templateId,
      actorUserId,
      action: 'template_cancelled',
    });
    return t;
  }

  static async duplicate(templateId: number, actorUserId: number) {
    const src = await pool.query<TaskTemplateRow>(
      `SELECT * FROM task_templates WHERE id = $1`,
      [templateId],
    );
    if (!src.rowCount) throw new HttpError(404, 'المهمة غير موجودة');
    const row = src.rows[0];
    const copy = await this.create({
      title: `${row.title} (نسخة)`,
      description: row.description,
      taskType: row.task_type,
      priority: row.priority,
      startDate: safeDateStr(row.start_date),
      endDate: row.end_date ? safeDateStr(row.end_date) : null,
      scheduledTime: row.scheduled_time,
      adminNotes: row.admin_notes,
      allowAttachments: row.allow_attachments,
      createdBy: actorUserId,
    });
    await TaskActivityService.log({
      templateId: Number(copy.id),
      actorUserId,
      action: 'template_duplicated',
      details: { source_template_id: templateId },
    });
    return copy;
  }

  static async delete(templateId: number, actorUserId: number) {
    await this.getById(templateId);
    await pool.query(`DELETE FROM task_templates WHERE id = $1`, [templateId]);
    await TaskActivityService.log({
      templateId,
      actorUserId,
      action: 'template_deleted',
    });
    return { deleted: true, template_id: templateId };
  }

  static async addAttachment(
    templateId: number,
    file: { fileName: string; filePath: string; fileSize?: number },
    uploadedBy: number,
  ) {
    await this.getById(templateId);
    const r = await pool.query(
      `INSERT INTO task_template_attachments (template_id, file_name, file_path, file_size, uploaded_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [templateId, file.fileName, file.filePath, file.fileSize ?? null, uploadedBy],
    );
    return r.rows[0];
  }

  static async listAttachments(templateId: number) {
    const r = await pool.query(
      `SELECT * FROM task_template_attachments WHERE template_id = $1 ORDER BY created_at DESC`,
      [templateId],
    );
    return r.rows;
  }

  static serializeTemplate(row: TaskTemplateRow | Record<string, unknown>) {
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      task_type: row.task_type,
      priority: row.priority,
      start_date: safeDateStr(row.start_date),
      end_date: row.end_date ? safeDateStr(row.end_date) : null,
      scheduled_time: row.scheduled_time,
      admin_notes: row.admin_notes,
      status: row.status,
      allow_attachments: row.allow_attachments,
      created_by: row.created_by,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }
}
