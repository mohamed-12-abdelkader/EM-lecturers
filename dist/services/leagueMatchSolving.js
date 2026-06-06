"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LeagueMatchSolvingService = void 0;
const pool_1 = __importDefault(require("../db/pool"));
class LeagueMatchSolvingService {
    static async hasSubmitted(matchId, studentId) {
        const r = await pool_1.default.query('SELECT 1 FROM league_match_submissions WHERE match_id = $1 AND student_id = $2', [matchId, studentId]);
        return (r.rowCount ?? 0) > 0;
    }
    static async solve(matchId, studentId, answers) {
        const client = await pool_1.default.connect();
        try {
            await client.query('BEGIN');
            // fetch questions
            const qRes = await client.query('SELECT id, correct_answer FROM league_match_questions WHERE match_id = $1', [matchId]);
            const questions = qRes.rows;
            if (!questions.length)
                throw new Error('No questions');
            // prevent re-submit
            const exists = await client.query('SELECT 1 FROM league_match_submissions WHERE match_id = $1 AND student_id = $2', [matchId, studentId]);
            if (exists.rowCount && exists.rowCount > 0)
                throw new Error('submitted_before');
            let correct = 0;
            let wrong = 0;
            const perCorrect = 10;
            const perWrong = -5;
            const answersMap = new Map();
            for (const a of answers)
                answersMap.set(a.question_id, a.selected_answer);
            for (const q of questions) {
                const sel = answersMap.get(q.id);
                if (!sel || !q.correct_answer)
                    continue; // unanswered or no key: ignore scoring
                if (sel === q.correct_answer)
                    correct++;
                else
                    wrong++;
            }
            const total = questions.length;
            const score = correct * perCorrect + wrong * perWrong;
            const subRes = await client.query(`INSERT INTO league_match_submissions (match_id, student_id, total_questions, correct_answers, wrong_answers, score)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, [matchId, studentId, total, correct, wrong, score]);
            const submissionId = subRes.rows[0].id;
            for (const q of questions) {
                const sel = answersMap.get(q.id) || null;
                if (!sel)
                    continue;
                const isCorrect = q.correct_answer ? sel === q.correct_answer : false;
                const pts = isCorrect ? perCorrect : perWrong;
                await client.query(`INSERT INTO league_match_answers (submission_id, question_id, selected_answer, is_correct, points)
           VALUES ($1,$2,$3,$4,$5)`, [submissionId, q.id, sel, isCorrect, pts]);
            }
            await client.query('COMMIT');
            return { score, total_questions: total, correct_answers: correct, wrong_answers: wrong };
        }
        catch (e) {
            await client.query('ROLLBACK');
            throw e;
        }
        finally {
            client.release();
        }
    }
    static async getStudentResult(matchId, studentId) {
        const subRes = await pool_1.default.query(`SELECT * FROM league_match_submissions WHERE match_id = $1 AND student_id = $2`, [matchId, studentId]);
        if (!subRes.rowCount)
            return null;
        const sub = subRes.rows[0];
        const ansRes = await pool_1.default.query(`SELECT a.question_id, a.selected_answer, a.is_correct, a.points,
              q.text, q.option_a, q.option_b, q.option_c, q.option_d, q.correct_answer, q.image_url
       FROM league_match_answers a
       JOIN league_match_questions q ON q.id = a.question_id
       WHERE a.submission_id = $1
       ORDER BY q.id`, [sub.id]);
        const answers = ansRes.rows.map((r) => ({
            question_id: r.question_id,
            question_text: r.text,
            options: [r.option_a, r.option_b, r.option_c, r.option_d],
            selected_answer: r.selected_answer,
            correct_answer: r.correct_answer,
            is_correct: r.is_correct,
            points: r.points,
            image: r.image_url ?? null,
        }));
        return {
            score: sub.score,
            total_questions: sub.total_questions,
            correct_answers: sub.correct_answers,
            wrong_answers: sub.wrong_answers,
            answers,
        };
    }
    // جلب الأسئلة الخاطئة فقط مع التصحيح
    static async getWrongQuestions(matchId, studentId) {
        const subRes = await pool_1.default.query(`SELECT id FROM league_match_submissions WHERE match_id = $1 AND student_id = $2`, [matchId, studentId]);
        if (!subRes.rowCount)
            return null;
        const submissionId = subRes.rows[0].id;
        const ansRes = await pool_1.default.query(`SELECT a.question_id, a.selected_answer, a.is_correct, a.points,
              q.text, q.option_a, q.option_b, q.option_c, q.option_d, q.correct_answer, q.image_url
       FROM league_match_answers a
       JOIN league_match_questions q ON q.id = a.question_id
       WHERE a.submission_id = $1 AND a.is_correct = false
       ORDER BY q.id`, [submissionId]);
        const wrongQuestions = ansRes.rows.map((r) => ({
            question_id: r.question_id,
            question_text: r.text,
            options: [r.option_a, r.option_b, r.option_c, r.option_d],
            selected_answer: r.selected_answer, // إجابة الطالب
            correct_answer: r.correct_answer, // الإجابة الصحيحة
            points: r.points,
            image: r.image_url ?? null,
        }));
        return {
            wrong_questions_count: wrongQuestions.length,
            wrong_questions: wrongQuestions,
        };
    }
    // بدء الماتش للطالب - يرجع الأسئلة والوقت
    static async startMatch(matchId, studentId) {
        // التحقق من أن الطالب لم يبدأ الماتش من قبل
        const hasStarted = await this.hasSubmitted(matchId, studentId);
        if (hasStarted) {
            // إذا كان قد بدأ من قبل، إرجاع النتيجة السابقة
            const result = await this.getStudentResult(matchId, studentId);
            return {
                already_started: true,
                message: 'لقد قمت ببدء هذه المباراة من قبل',
                previous_result: result,
            };
        }
        // جلب معلومات الماتش
        const matchRes = await pool_1.default.query(`SELECT id, name, duration_minutes FROM league_matches WHERE id = $1`, [matchId]);
        if (!matchRes.rowCount) {
            throw new Error('Match not found');
        }
        const match = matchRes.rows[0];
        // جلب الأسئلة (بدون الإجابة الصحيحة)
        const questionsRes = await pool_1.default.query(`SELECT id, text, option_a, option_b, option_c, option_d, image_url
       FROM league_match_questions
       WHERE match_id = $1
       ORDER BY created_at ASC`, [matchId]);
        const questions = questionsRes.rows.map((q) => ({
            id: q.id,
            text: q.text,
            options: [q.option_a, q.option_b, q.option_c, q.option_d],
            image: q.image_url ?? null,
        }));
        return {
            already_started: false,
            match_id: match.id,
            match_name: match.name,
            duration_minutes: match.duration_minutes,
            questions: questions,
            total_questions: questions.length,
        };
    }
}
exports.LeagueMatchSolvingService = LeagueMatchSolvingService;
