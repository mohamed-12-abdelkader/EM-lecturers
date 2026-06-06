"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LeagueMatchQuestionsService = void 0;
const pool_1 = __importDefault(require("../db/pool"));
class LeagueMatchQuestionsService {
    static async createOne(data, createdBy, correctAnswer) {
        const q = `
      INSERT INTO league_match_questions (match_id, text, option_a, option_b, option_c, option_d, image_url, correct_answer, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING *
    `;
        const r = await pool_1.default.query(q, [
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
    static async bulkCreate(matchId, items, createdBy) {
        const values = [];
        const rows = [];
        let i = 1;
        for (const it of items) {
            rows.push(`($${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++})`);
            values.push(matchId, it.text, it.option_a, it.option_b, it.option_c, it.option_d, it.image_url ?? null, createdBy);
        }
        const q = `
      INSERT INTO league_match_questions (match_id, text, option_a, option_b, option_c, option_d, image_url, created_by)
      VALUES ${rows.join(',')}
      RETURNING *
    `;
        const r = await pool_1.default.query(q, values);
        return r.rows;
    }
    static async listByMatch(matchId) {
        const r = await pool_1.default.query('SELECT * FROM league_match_questions WHERE match_id = $1 ORDER BY created_at ASC', [matchId]);
        return r.rows;
    }
    static async getById(id) {
        const r = await pool_1.default.query('SELECT * FROM league_match_questions WHERE id = $1', [id]);
        return r.rows[0] || null;
    }
    static async update(id, data) {
        const fields = Object.keys(data).filter((k) => data[k] !== undefined);
        if (!fields.length)
            return this.getById(id);
        const set = fields.map((f, idx) => `${f} = $${idx + 2}`).join(', ');
        const values = [id, ...fields.map((f) => data[f])];
        const r = await pool_1.default.query(`UPDATE league_match_questions SET ${set} WHERE id = $1 RETURNING *`, values);
        return r.rows[0] || null;
    }
    static async delete(id) {
        const r = await pool_1.default.query('DELETE FROM league_match_questions WHERE id = $1', [id]);
        return (r.rowCount ?? 0) > 0;
    }
    static async setCorrectAnswer(id, answer) {
        if (answer && !['A', 'B', 'C', 'D'].includes(answer))
            throw new Error('Invalid correct answer');
        const r = await pool_1.default.query('UPDATE league_match_questions SET correct_answer = $2 WHERE id = $1 RETURNING *', [id, answer]);
        return r.rows[0] || null;
    }
}
exports.LeagueMatchQuestionsService = LeagueMatchQuestionsService;
