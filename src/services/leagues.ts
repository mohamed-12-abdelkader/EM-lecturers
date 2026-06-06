import { League, LeagueCreate, LeagueUpdate } from '../db/types';
import pool from '../db/pool';

export class LeaguesService {
  static async create(data: LeagueCreate, createdBy: number): Promise<League> {
    const query = `
      INSERT INTO leagues (name, grade_id, image_url, matches_count, start_date, end_date, description, price, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `;
    const values = [
      data.name,
      data.grade_id,
      data.image_url ?? null,
      data.matches_count,
      data.start_date,
      data.end_date,
      data.description ?? null,
      data.price ?? null,
      createdBy,
    ];
    const result = await pool.query<League>(query, values);
    return result.rows[0];
  }

  static async getAll(): Promise<any[]> {
    const query = `
      SELECT l.*, g.name as grade_name
      FROM leagues l
      LEFT JOIN grades g ON l.grade_id = g.id
      ORDER BY l.created_at DESC
    `;
    const result = await pool.query(query);
    return result.rows;
  }

  static async getById(id: number): Promise<any | null> {
    const query = `
      SELECT l.*, g.name as grade_name
      FROM leagues l
      LEFT JOIN grades g ON l.grade_id = g.id
      WHERE l.id = $1
    `;
    const result = await pool.query(query, [id]);
    return result.rows[0] || null;
  }

  static async getForStudent(userId: number): Promise<any[]> {
    const query = `
      SELECT DISTINCT 
        l.*, 
        g.name as grade_name,
        CASE WHEN ls.student_id IS NOT NULL AND ls.is_active = TRUE THEN TRUE ELSE FALSE END AS is_enrolled
      FROM leagues l
      JOIN user_grades ug ON ug.grade_id = l.grade_id
      LEFT JOIN grades g ON l.grade_id = g.id
      LEFT JOIN league_students ls ON ls.league_id = l.id AND ls.student_id = $1 AND ls.is_active = TRUE
      WHERE ug.user_id = $1
      ORDER BY l.start_date ASC, l.created_at DESC
    `;
    const result = await pool.query(query, [userId]);
    return result.rows;
  }

  static async isStudentEnrolled(leagueId: number, studentId: number): Promise<boolean> {
    const q = `SELECT 1 FROM league_students WHERE league_id = $1 AND student_id = $2 AND is_active = TRUE`;
    const r = await pool.query(q, [leagueId, studentId]);
    return (r.rowCount ?? 0) > 0;
  }

  static async enrollFree(leagueId: number, studentId: number): Promise<boolean> {
    // Ensure league exists and free
    const leagueRes = await pool.query(`SELECT id, price FROM leagues WHERE id = $1`, [leagueId]);
    if (leagueRes.rows.length === 0) throw new Error('الدوري غير موجود');
    const price = leagueRes.rows[0].price as number | null;
    if (price != null && Number(price) > 0) throw new Error('هذا الدوري مدفوع');

    const q = `
      INSERT INTO league_students (league_id, student_id, is_active)
      VALUES ($1, $2, TRUE)
      ON CONFLICT (league_id, student_id)
      DO UPDATE SET is_active = TRUE, joined_at = NOW()
    `;
    const r = await pool.query(q, [leagueId, studentId]);
    return (r.rowCount ?? 0) > 0;
  }

  static async getEnrolledStudents(leagueId: number): Promise<any[]> {
    const q = `
      SELECT ls.id as subscription_id,
             ls.joined_at,
             u.id as student_id,
             u.name as student_name,
             u.email as student_email,
             ug.grade_id,
             g.name as grade_name
      FROM league_students ls
      JOIN users u ON u.id = ls.student_id
      LEFT JOIN user_grades ug ON ug.user_id = u.id
      LEFT JOIN grades g ON g.id = ug.grade_id
      WHERE ls.league_id = $1 AND ls.is_active = TRUE
      ORDER BY ls.joined_at DESC
    `;
    const r = await pool.query(q, [leagueId]);
    return r.rows;
  }

  static async getLeaderboard(
    leagueId: number,
    limit: number = 10,
    offset: number = 0,
    studentId?: number,
  ) {
    // Ensure league exists
    const leagueRes = await pool.query('SELECT id, name FROM leagues WHERE id = $1', [leagueId]);
    if (!leagueRes.rowCount) {
      throw new Error('League not found');
    }

    const totalRes = await pool.query(
      `SELECT COUNT(*) AS total
       FROM league_students ls
       WHERE ls.league_id = $1 AND ls.is_active = TRUE`,
      [leagueId],
    );
    const total = parseInt(totalRes.rows[0].total);

    // جلب الترتيب الكامل
    const q = `
      WITH sums AS (
        SELECT s.student_id,
               COALESCE(SUM(s.score), 0) AS total_score,
               COUNT(*) AS submissions_count
        FROM league_match_submissions s
        JOIN league_matches m ON m.id = s.match_id
        WHERE m.league_id = $1
        GROUP BY s.student_id
      ),
      ranked_students AS (
        SELECT 
          ROW_NUMBER() OVER (ORDER BY COALESCE(su.total_score, 0) DESC, COALESCE(su.submissions_count, 0) DESC, u.name ASC) AS rank,
          u.id AS student_id,
          u.name AS student_name,
          u.avatar AS student_avatar,
          u.avatar,
          COALESCE(su.total_score, 0) AS total_score,
          COALESCE(su.submissions_count, 0) AS submissions_count
        FROM league_students ls
        JOIN users u ON u.id = ls.student_id
        LEFT JOIN sums su ON su.student_id = ls.student_id
        WHERE ls.league_id = $1 AND ls.is_active = TRUE
      )
      SELECT * FROM ranked_students
      ORDER BY rank ASC
      LIMIT $2 OFFSET $3
    `;
    const rows = (await pool.query(q, [leagueId, limit, offset])).rows;

    // جلب ترتيب الطالب الحالي إذا كان موجوداً
    let studentRank: any = null;
    if (studentId) {
      const studentRankQuery = `
        WITH sums AS (
          SELECT s.student_id,
          COALESCE(SUM(s.score), 0) AS total_score,
          COUNT(*) AS submissions_count
          FROM league_match_submissions s
          JOIN league_matches m ON m.id = s.match_id
          WHERE m.league_id = $1
          GROUP BY s.student_id
        ),
        ranked_students AS (
          SELECT 
            ROW_NUMBER() OVER (ORDER BY COALESCE(su.total_score, 0) DESC, COALESCE(su.submissions_count, 0) DESC, u.name ASC) AS rank,
            u.id AS student_id,
            u.name AS student_name,
            u.avatar AS student_avatar,
            u.avatar,
            COALESCE(su.total_score, 0) AS total_score,
            COALESCE(su.submissions_count, 0) AS submissions_count
          FROM league_students ls
          JOIN users u ON u.id = ls.student_id
          LEFT JOIN sums su ON su.student_id = ls.student_id
          WHERE ls.league_id = $1 AND ls.is_active = TRUE
        )
        SELECT * FROM ranked_students
        WHERE student_id = $2
      `;
      const studentRankRes = await pool.query(studentRankQuery, [leagueId, studentId]);
      if ((studentRankRes.rowCount ?? 0) > 0) {
        studentRank = studentRankRes.rows[0];
      }
    }

    return {
      league: leagueRes.rows[0],
      leaderboard: rows,
      my_rank: studentRank, // ترتيب الطالب الحالي
      pagination: { total, limit, offset, has_more: offset + limit < total },
    };
  }

  static async cancelEnrollment(leagueId: number, studentId: number): Promise<boolean> {
    const q = `
      UPDATE league_students
      SET is_active = FALSE
      WHERE league_id = $1 AND student_id = $2 AND is_active = TRUE
    `;
    const r = await pool.query(q, [leagueId, studentId]);
    return (r.rowCount ?? 0) > 0;
  }

  static async update(id: number, data: LeagueUpdate): Promise<League | null> {
    const fields = Object.keys(data).filter((k) => (data as any)[k] !== undefined);
    if (fields.length === 0) {
      const existing = await this.getById(id);
      return existing as any;
    }
    const setClause = fields.map((field, index) => `${field} = $${index + 2}`).join(', ');
    const values = [id, ...fields.map((f) => (data as any)[f])];
    const query = `UPDATE leagues SET ${setClause} WHERE id = $1 RETURNING *`;
    const result = await pool.query<League>(query, values);
    return result.rows[0] || null;
  }

  static async delete(id: number): Promise<boolean> {
    const result = await pool.query('DELETE FROM leagues WHERE id = $1', [id]);
    return (result.rowCount ?? 0) > 0;
  }
}
