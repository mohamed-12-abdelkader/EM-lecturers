import pool from '../db/pool';

export interface LeagueMatchCreate {
  league_id: number;
  name: string;
  description?: string;
  image_url?: string | null;
  is_visible?: boolean;
  start_date?: string; // YYYY-MM-DD
  start_time?: string; // HH:MM
  end_time?: string;   // HH:MM
  duration_minutes?: number; // مدة المباراة بالدقائق
}

export interface LeagueMatchUpdate {
  name?: string;
  description?: string | null;
  image_url?: string | null;
  is_visible?: boolean;
  start_date?: string;
  start_time?: string;
  end_time?: string;
  duration_minutes?: number;
}

export class LeagueMatchesService {
  static async create(data: LeagueMatchCreate, createdBy: number) {
    const q = `
      INSERT INTO league_matches (league_id, name, description, image_url, is_visible, start_date, start_time, end_time, duration_minutes, created_by)
      VALUES ($1, $2, $3, $4, COALESCE($5, TRUE), $6, $7, $8, $9, $10)
      RETURNING *
    `;
    const v = [
      data.league_id,
      data.name,
      data.description ?? null,
      data.image_url ?? null,
      data.is_visible,
      data.start_date || null,
      data.start_time || null,
      data.end_time || null,
      data.duration_minutes ?? null,
      createdBy,
    ];
    const r = await pool.query(q, v);
    return r.rows[0];
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  static async listByLeague(leagueId: number, forStudent: boolean = false) {
    // For students, we used to filter is_visible=TRUE, now we return all so they see 'unavailable' ones.
    const where = 'WHERE league_id = $1';
    const q = `
      SELECT *,
        (
          CASE 
            WHEN end_time IS NOT NULL AND start_date IS NOT NULL 
            THEN (NOW()::time > end_time AND NOW()::date >= start_date)
            ELSE FALSE
          END
        ) AS is_ended
      FROM league_matches 
      ${where}
      ORDER BY 
        (start_date IS NULL), -- Put NULL dates first or last logic? Usually matches without date might be "Coming Soon" or "TBD".
        start_date ASC NULLS LAST, 
        start_time ASC NULLS LAST, 
        created_at DESC`;
    const r = await pool.query(q, [leagueId]);
    return r.rows;
  }

  static async getById(id: number) {
    const r = await pool.query(
      `SELECT *, (NOW()::time > end_time AND NOW()::date >= start_date) AS is_ended
       FROM league_matches WHERE id = $1`,
      [id],
    );
    return r.rows[0] || null;
  }

  static async update(id: number, data: LeagueMatchUpdate) {
    const fields = Object.keys(data).filter((k) => (data as any)[k] !== undefined);
    if (fields.length === 0) return await this.getById(id);
    const set = fields.map((f, i) => `${f} = $${i + 2}`).join(', ');
    const values = [id, ...fields.map((f) => (data as any)[f])];
    const q = `UPDATE league_matches SET ${set} WHERE id = $1 RETURNING *`;
    const r = await pool.query(q, values);
    return r.rows[0] || null;
  }

  static async delete(id: number) {
    const r = await pool.query('DELETE FROM league_matches WHERE id = $1', [id]);
    return (r.rowCount ?? 0) > 0;
  }

  static async toggleVisibility(id: number) {
    const r = await pool.query(
      'UPDATE league_matches SET is_visible = NOT is_visible WHERE id = $1 RETURNING *',
      [id],
    );
    return r.rows[0] || null;
  }
}
