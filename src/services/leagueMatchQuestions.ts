import pool from '../db/pool';

export type CorrectAnswer = 'A' | 'B' | 'C' | 'D' | null;

export interface LmqCreate {
  match_id: number;
  text: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  image_url?: string | null;
}

export interface LmqUpdate {
  text?: string;
  option_a?: string;
  option_b?: string;
  option_c?: string;
  option_d?: string;
  image_url?: string | null;
  correct_answer?: CorrectAnswer;
}

export class LeagueMatchQuestionsService {
  static async createOne(data: LmqCreate, createdBy: number, correctAnswer?: CorrectAnswer) {
    const q = `
      INSERT INTO league_match_questions (match_id, text, option_a, option_b, option_c, option_d, image_url, correct_answer, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING *
    `;
    const r = await pool.query(q, [
      data.match_id,
      data.text,
      data.option_a,
      data.option_b,
      data.option_c,
      data.option_d,
      data.image_url ?? null,
      correctAnswer ?? null,
      createdBy,
    ]);
    return r.rows[0];
  }

  static async bulkCreate(
    matchId: number,
    items: Omit<LmqCreate, 'match_id'>[],
    createdBy: number,
  ) {
    const values: any[] = [];
    const rows: string[] = [];
    let i = 1;
    for (const it of items) {
      rows.push(`($${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++})`);
      values.push(
        matchId,
        it.text,
        it.option_a,
        it.option_b,
        it.option_c,
        it.option_d,
        it.image_url ?? null,
        createdBy,
      );
    }
    const q = `
      INSERT INTO league_match_questions (match_id, text, option_a, option_b, option_c, option_d, image_url, created_by)
      VALUES ${rows.join(',')}
      RETURNING *
    `;
    const r = await pool.query(q, values);
    return r.rows;
  }

  static async listByMatch(matchId: number) {
    const r = await pool.query(
      'SELECT * FROM league_match_questions WHERE match_id = $1 ORDER BY created_at ASC',
      [matchId],
    );
    return r.rows;
  }

  static async getById(id: number) {
    const r = await pool.query('SELECT * FROM league_match_questions WHERE id = $1', [id]);
    return r.rows[0] || null;
  }

  static async update(id: number, data: LmqUpdate) {
    const fields = Object.keys(data).filter((k) => (data as any)[k] !== undefined);
    if (!fields.length) return this.getById(id);
    const set = fields.map((f, idx) => `${f} = $${idx + 2}`).join(', ');
    const values = [id, ...fields.map((f) => (data as any)[f])];
    const r = await pool.query(
      `UPDATE league_match_questions SET ${set} WHERE id = $1 RETURNING *`,
      values,
    );
    return r.rows[0] || null;
  }

  static async delete(id: number) {
    const r = await pool.query('DELETE FROM league_match_questions WHERE id = $1', [id]);
    return (r.rowCount ?? 0) > 0;
  }

  static async setCorrectAnswer(id: number, answer: CorrectAnswer) {
    if (answer && !['A', 'B', 'C', 'D'].includes(answer)) throw new Error('Invalid correct answer');
    const r = await pool.query(
      'UPDATE league_match_questions SET correct_answer = $2 WHERE id = $1 RETURNING *',
      [id, answer],
    );
    return r.rows[0] || null;
  }
}
