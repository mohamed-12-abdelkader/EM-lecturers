import pool from '../db/pool';
import { HttpError } from '../utils';

export type TeacherScheduleTaskType = 'lecture' | 'live' | 'exam' | 'homework';

export type TeacherScheduleTaskInput = {
  teacherId: number;
  taskType: TeacherScheduleTaskType;
  title: string;
  courseName?: string | null;
  relatedCourseId?: number | null;
  relatedGroupId?: number | null;
  taskDate: string;
  startTime?: string | null;
  endTime?: string | null;
  dueAt?: string | null;
  meetingUrl?: string | null;
  notes?: string | null;
  createdBy?: number | null;
};

const TASK_TYPES = new Set<TeacherScheduleTaskType>([
  'lecture',
  'live',
  'exam',
  'homework',
]);

function assertTaskType(value: unknown): TeacherScheduleTaskType {
  const raw = String(value || '').trim().toLowerCase();
  if (!TASK_TYPES.has(raw as TeacherScheduleTaskType)) {
    throw new HttpError(400, 'taskType must be lecture, live, exam, or homework');
  }
  return raw as TeacherScheduleTaskType;
}

function assertDate(value: unknown, field = 'taskDate'): string {
  const raw = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new HttpError(400, `${field} must be YYYY-MM-DD`);
  }
  return raw;
}

function normalizeTime(value: unknown): string | null {
  if (value == null || value === '') return null;
  const raw = String(value).trim();
  if (/^\d{2}:\d{2}$/.test(raw)) return `${raw}:00`;
  if (/^\d{2}:\d{2}:\d{2}$/.test(raw)) return raw;
  throw new HttpError(400, 'time must be HH:MM or HH:MM:SS');
}

function mapTask(row: any) {
  return {
    id: Number(row.id),
    teacherId: Number(row.teacher_id),
    teacher_id: Number(row.teacher_id),
    teacherName: row.teacher_name || null,
    teacher_name: row.teacher_name || null,
    taskType: row.task_type,
    task_type: row.task_type,
    title: row.title,
    courseName: row.course_name,
    course_name: row.course_name,
    relatedCourseId: row.related_course_id,
    related_course_id: row.related_course_id,
    relatedGroupId: row.related_group_id,
    related_group_id: row.related_group_id,
    taskDate: row.task_date,
    task_date: row.task_date,
    startTime: row.start_time,
    start_time: row.start_time,
    endTime: row.end_time,
    end_time: row.end_time,
    dueAt: row.due_at,
    due_at: row.due_at,
    meetingUrl: row.meeting_url,
    meeting_url: row.meeting_url,
    notes: row.notes,
    createdBy: row.created_by,
    created_by: row.created_by,
    createdAt: row.created_at,
    created_at: row.created_at,
    updatedAt: row.updated_at,
    updated_at: row.updated_at,
  };
}

export class TeacherScheduleService {
  static async listTeachers() {
    const res = await pool.query(
      `SELECT
         u.id,
         u.name,
         u.email,
         u.phone,
         u.whatsapp_number,
         u.avatar,
         u.subject,
         COALESCE(u.account_status, 'active') AS account_status,
         (
           SELECT COUNT(*)::int
           FROM teacher_schedule_tasks t
           WHERE t.teacher_id = u.id
             AND t.task_date = (NOW() AT TIME ZONE 'Africa/Cairo')::date
         ) AS today_tasks_count,
         (
           SELECT COUNT(*)::int
           FROM teacher_schedule_tasks t
           WHERE t.teacher_id = u.id
             AND t.task_date > (NOW() AT TIME ZONE 'Africa/Cairo')::date
         ) AS upcoming_tasks_count
       FROM users u
       WHERE u.role = 'teacher'
       ORDER BY u.name ASC NULLS LAST, u.id ASC`,
    );
    return res.rows.map((row) => ({
      id: Number(row.id),
      name: row.name,
      email: row.email,
      phone: row.phone,
      whatsappNumber: row.whatsapp_number,
      whatsapp_number: row.whatsapp_number,
      avatar: row.avatar,
      subject: row.subject,
      accountStatus: row.account_status,
      account_status: row.account_status,
      todayTasksCount: Number(row.today_tasks_count || 0),
      today_tasks_count: Number(row.today_tasks_count || 0),
      upcomingTasksCount: Number(row.upcoming_tasks_count || 0),
      upcoming_tasks_count: Number(row.upcoming_tasks_count || 0),
    }));
  }

  static async listTasks(opts: {
    teacherId?: number;
    from?: string;
    to?: string;
    date?: string;
  }) {
    const values: unknown[] = [];
    const where: string[] = [];
    if (opts.teacherId) {
      values.push(Number(opts.teacherId));
      where.push(`t.teacher_id = $${values.length}`);
    }
    if (opts.date) {
      values.push(assertDate(opts.date, 'date'));
      where.push(`t.task_date = $${values.length}`);
    } else {
      if (opts.from) {
        values.push(assertDate(opts.from, 'from'));
        where.push(`t.task_date >= $${values.length}`);
      }
      if (opts.to) {
        values.push(assertDate(opts.to, 'to'));
        where.push(`t.task_date <= $${values.length}`);
      }
    }

    const res = await pool.query(
      `SELECT t.*, u.name AS teacher_name
       FROM teacher_schedule_tasks t
       JOIN users u ON u.id = t.teacher_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY t.task_date ASC,
                COALESCE(t.start_time, t.due_at::time, TIME '23:59:59') ASC,
                t.id ASC`,
      values,
    );
    return res.rows.map(mapTask);
  }

  static async getTask(taskId: number) {
    const res = await pool.query(
      `SELECT t.*, u.name AS teacher_name
       FROM teacher_schedule_tasks t
       JOIN users u ON u.id = t.teacher_id
       WHERE t.id = $1`,
      [taskId],
    );
    if (!res.rowCount) throw new HttpError(404, 'المهمة غير موجودة');
    return mapTask(res.rows[0]);
  }

  static async createTask(input: TeacherScheduleTaskInput) {
    await this.assertTeacher(input.teacherId);
    const taskType = assertTaskType(input.taskType);
    const title = String(input.title || '').trim();
    if (!title) throw new HttpError(400, 'title is required');
    const taskDate = assertDate(input.taskDate);

    const res = await pool.query(
      `INSERT INTO teacher_schedule_tasks
         (teacher_id, task_type, title, course_name, related_course_id, related_group_id,
          task_date, start_time, end_time, due_at, meeting_url, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [
        input.teacherId,
        taskType,
        title,
        input.courseName?.trim() || null,
        input.relatedCourseId || null,
        input.relatedGroupId || null,
        taskDate,
        normalizeTime(input.startTime),
        normalizeTime(input.endTime),
        input.dueAt || null,
        input.meetingUrl?.trim() || null,
        input.notes?.trim() || null,
        input.createdBy || null,
      ],
    );
    return this.getTask(Number(res.rows[0].id));
  }

  static async updateTask(taskId: number, patch: Partial<TeacherScheduleTaskInput>) {
    const current = await this.getTask(taskId);
    const teacherId = patch.teacherId ?? current.teacherId;
    if (patch.teacherId) await this.assertTeacher(teacherId);

    const res = await pool.query(
      `UPDATE teacher_schedule_tasks SET
         teacher_id = $2,
         task_type = $3,
         title = $4,
         course_name = $5,
         related_course_id = $6,
         related_group_id = $7,
         task_date = $8,
         start_time = $9,
         end_time = $10,
         due_at = $11,
         meeting_url = $12,
         notes = $13,
         updated_at = NOW()
       WHERE id = $1
       RETURNING id`,
      [
        taskId,
        teacherId,
        assertTaskType(patch.taskType ?? current.taskType),
        String(patch.title ?? current.title).trim(),
        patch.courseName !== undefined
          ? patch.courseName?.trim() || null
          : current.courseName,
        patch.relatedCourseId !== undefined
          ? patch.relatedCourseId
          : current.relatedCourseId,
        patch.relatedGroupId !== undefined
          ? patch.relatedGroupId
          : current.relatedGroupId,
        assertDate(patch.taskDate ?? current.taskDate),
        patch.startTime !== undefined
          ? normalizeTime(patch.startTime)
          : current.startTime,
        patch.endTime !== undefined ? normalizeTime(patch.endTime) : current.endTime,
        patch.dueAt !== undefined ? patch.dueAt || null : current.dueAt,
        patch.meetingUrl !== undefined
          ? patch.meetingUrl?.trim() || null
          : current.meetingUrl,
        patch.notes !== undefined ? patch.notes?.trim() || null : current.notes,
      ],
    );
    if (!res.rowCount) throw new HttpError(404, 'المهمة غير موجودة');
    return this.getTask(taskId);
  }

  static async deleteTask(taskId: number) {
    const res = await pool.query(
      `DELETE FROM teacher_schedule_tasks WHERE id = $1 RETURNING id`,
      [taskId],
    );
    if (!res.rowCount) throw new HttpError(404, 'المهمة غير موجودة');
    return { deleted: true, id: taskId };
  }

  static async todaySummary(teacherId?: number) {
    const values: unknown[] = [];
    let where = `t.task_date = (NOW() AT TIME ZONE 'Africa/Cairo')::date`;
    if (teacherId) {
      values.push(Number(teacherId));
      where += ` AND t.teacher_id = $${values.length}`;
    }
    const res = await pool.query(
      `SELECT t.*, u.name AS teacher_name
       FROM teacher_schedule_tasks t
       JOIN users u ON u.id = t.teacher_id
       WHERE ${where}
       ORDER BY u.name ASC,
                COALESCE(t.start_time, t.due_at::time, TIME '23:59:59') ASC`,
      values,
    );
    return res.rows.map(mapTask);
  }

  private static async assertTeacher(teacherId: number) {
    const res = await pool.query(
      `SELECT id FROM users WHERE id = $1 AND role = 'teacher'`,
      [teacherId],
    );
    if (!res.rowCount) throw new HttpError(404, 'المدرس غير موجود');
  }
}
