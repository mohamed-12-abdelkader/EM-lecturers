import type { PoolClient } from 'pg';
import pool from '../../../db/pool';
import { HttpError, logger } from '../../../utils';
import {
  computeEndStatus,
  computeStartStatus,
  earlyLeaveMinutes,
  formatMinutesDuration,
  latenessMinutes,
  overtimeMinutes,
  platformTimeParts,
  platformToday,
  toDateString,
} from '../utils/time';

export type WorkSessionRow = {
  id: number;
  employee_id: number;
  work_date: string;
  scheduled_start_time: string;
  scheduled_end_time: string;
  actual_start_at: Date | string | null;
  actual_end_at: Date | string | null;
  start_status: string | null;
  end_status: string | null;
  worked_minutes: number | null;
  status: string;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
};

function fmtTime(value: string | null | undefined): string {
  if (!value) return '09:00';
  const m = String(value).match(/^(\d{1,2}):(\d{2})/);
  if (!m) return String(value).slice(0, 5);
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

export function serializeWorkSession(row: WorkSessionRow | null | undefined) {
  if (!row) return null;
  const worked = row.worked_minutes;
  return {
    id: row.id,
    employee_id: row.employee_id,
    date: toDateString(row.work_date),
    scheduled_start_time: fmtTime(row.scheduled_start_time),
    scheduled_end_time: fmtTime(row.scheduled_end_time),
    actual_start_time: row.actual_start_at,
    actual_end_time: row.actual_end_at,
    start_status: row.start_status,
    end_status: row.end_status,
    worked_minutes: worked,
    worked_duration: formatMinutesDuration(worked),
    lateness_minutes: latenessMinutes(
      row.actual_start_at ? new Date(row.actual_start_at) : null,
      fmtTime(row.scheduled_start_time),
      toDateString(row.work_date),
    ),
    early_leave_minutes: earlyLeaveMinutes(
      row.actual_end_at ? new Date(row.actual_end_at) : null,
      fmtTime(row.scheduled_end_time),
    ),
    overtime_minutes: overtimeMinutes(
      row.actual_end_at ? new Date(row.actual_end_at) : null,
      fmtTime(row.scheduled_end_time),
    ),
    status: row.status,
    notes: row.notes,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export class EmployeeWorkSessionService {
  static async ensureSchema() {
    await pool.query(`
      ALTER TABLE employees
        ADD COLUMN IF NOT EXISTS employee_code VARCHAR(32),
        ADD COLUMN IF NOT EXISTS department TEXT,
        ADD COLUMN IF NOT EXISTS job_title TEXT,
        ADD COLUMN IF NOT EXISTS work_start_time TIME NOT NULL DEFAULT '09:00',
        ADD COLUMN IF NOT EXISTS work_end_time TIME NOT NULL DEFAULT '17:00'
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS employee_work_sessions (
        id SERIAL PRIMARY KEY,
        employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        work_date DATE NOT NULL,
        scheduled_start_time TIME NOT NULL,
        scheduled_end_time TIME NOT NULL,
        actual_start_at TIMESTAMPTZ,
        actual_end_at TIMESTAMPTZ,
        start_status VARCHAR(20),
        end_status VARCHAR(20),
        worked_minutes INTEGER,
        status VARCHAR(20) NOT NULL DEFAULT 'not_started',
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (employee_id, work_date)
      )
    `);
  }

  static async getByEmployeeAndDate(
    employeeId: number,
    workDate: string,
    client: PoolClient | typeof pool = pool,
  ): Promise<WorkSessionRow | null> {
    const r = await client.query<WorkSessionRow>(
      `SELECT * FROM employee_work_sessions WHERE employee_id = $1 AND work_date = $2`,
      [employeeId, workDate],
    );
    return r.rows[0] ?? null;
  }

  static async startWork(employeeId: number) {
    await this.ensureSchema();
    const emp = await pool.query<{
      id: number;
      is_active: boolean;
      work_start_time: string;
      work_end_time: string;
    }>(`SELECT id, is_active, work_start_time::text, work_end_time::text FROM employees WHERE id = $1`, [
      employeeId,
    ]);
    if (!emp.rowCount) throw new HttpError(404, 'الموظف غير موجود');
    if (!emp.rows[0].is_active) throw new HttpError(403, 'حساب الموظف غير نشط');

    const workDate = platformToday();
    const scheduledStart = fmtTime(emp.rows[0].work_start_time);
    const scheduledEnd = fmtTime(emp.rows[0].work_end_time);
    const now = new Date();
    const startStatus = computeStartStatus(platformTimeParts(now).totalMinutes, scheduledStart);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await this.getByEmployeeAndDate(employeeId, workDate, client);
      if (existing?.actual_start_at) {
        throw new HttpError(409, 'تم بدء يوم العمل بالفعل اليوم');
      }

      let row: WorkSessionRow;
      if (existing) {
        const updated = await client.query<WorkSessionRow>(
          `UPDATE employee_work_sessions
           SET actual_start_at = NOW(),
               start_status = $2,
               status = 'working',
               scheduled_start_time = $3,
               scheduled_end_time = $4,
               updated_at = NOW()
           WHERE id = $1
           RETURNING *`,
          [existing.id, startStatus, scheduledStart, scheduledEnd],
        );
        row = updated.rows[0];
      } else {
        const inserted = await client.query<WorkSessionRow>(
          `INSERT INTO employee_work_sessions
             (employee_id, work_date, scheduled_start_time, scheduled_end_time,
              actual_start_at, start_status, status)
           VALUES ($1, $2, $3, $4, NOW(), $5, 'working')
           RETURNING *`,
          [employeeId, workDate, scheduledStart, scheduledEnd, startStatus],
        );
        row = inserted.rows[0];
      }
      await client.query('COMMIT');
      logger.info({ employee_id: employeeId, session_id: row.id, start_status: startStatus }, 'employee_work_started');
      return serializeWorkSession(row);
    } catch (err) {
      await client.query('ROLLBACK');
      if (err instanceof HttpError) throw err;
      const code = (err as { code?: string })?.code;
      if (code === '23505') throw new HttpError(409, 'تم بدء يوم العمل بالفعل اليوم');
      throw err;
    } finally {
      client.release();
    }
  }

  static async endWork(employeeId: number) {
    await this.ensureSchema();
    const workDate = platformToday();
    const now = new Date();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await this.getByEmployeeAndDate(employeeId, workDate, client);
      if (!existing || !existing.actual_start_at) {
        throw new HttpError(400, 'يجب بدء يوم العمل أولاً');
      }
      if (existing.actual_end_at || existing.status === 'completed') {
        throw new HttpError(409, 'تم إنهاء يوم العمل بالفعل');
      }

      const scheduledEnd = fmtTime(existing.scheduled_end_time);
      const endStatus = computeEndStatus(platformTimeParts(now).totalMinutes, scheduledEnd);
      const startAt = new Date(existing.actual_start_at);
      const workedMinutes = Math.max(0, Math.round((now.getTime() - startAt.getTime()) / 60000));

      const updated = await client.query<WorkSessionRow>(
        `UPDATE employee_work_sessions
         SET actual_end_at = NOW(),
             end_status = $2,
             worked_minutes = $3,
             status = 'completed',
             updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [existing.id, endStatus, workedMinutes],
      );
      await client.query('COMMIT');
      logger.info(
        { employee_id: employeeId, session_id: existing.id, end_status: endStatus, worked_minutes: workedMinutes },
        'employee_work_ended',
      );
      return serializeWorkSession(updated.rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  static async listAttendance(
    employeeId: number,
    opts: { startDate?: string; endDate?: string; page?: number; limit?: number },
  ) {
    await this.ensureSchema();
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(100, Math.max(1, opts.limit ?? 30));
    const offset = (page - 1) * limit;
    const params: unknown[] = [employeeId];
    let where = 'employee_id = $1';
    if (opts.startDate) {
      params.push(opts.startDate);
      where += ` AND work_date >= $${params.length}`;
    }
    if (opts.endDate) {
      params.push(opts.endDate);
      where += ` AND work_date <= $${params.length}`;
    }
    const count = await pool.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM employee_work_sessions WHERE ${where}`,
      params,
    );
    params.push(limit, offset);
    const rows = await pool.query<WorkSessionRow>(
      `SELECT * FROM employee_work_sessions
       WHERE ${where}
       ORDER BY work_date DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return {
      items: rows.rows.map(serializeWorkSession),
      pagination: {
        page,
        limit,
        total: Number(count.rows[0]?.c ?? 0),
        total_pages: Math.ceil(Number(count.rows[0]?.c ?? 0) / limit) || 1,
      },
    };
  }
}
