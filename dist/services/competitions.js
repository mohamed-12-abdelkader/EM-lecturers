"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CompetitionsService = void 0;
const pool_1 = __importDefault(require("../db/pool"));
class CompetitionsService {
    // إنشاء مسابقة جديدة
    static async create(competition, createdBy) {
        const { title, description, image_url, duration, grade_id, is_visible, is_active } = competition;
        const query = `
      INSERT INTO competitions (title, description, image_url, duration, grade_id, is_visible, is_active, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `;
        const values = [
            title,
            description,
            image_url,
            duration,
            grade_id,
            is_visible,
            is_active,
            createdBy,
        ];
        const result = await pool_1.default.query(query, values);
        return result.rows[0];
    }
    // الحصول على جميع المسابقات
    static async getAll() {
        const query = `
      SELECT c.*, g.name as grade_name, u.name as creator_name
      FROM competitions c
      LEFT JOIN grades g ON c.grade_id = g.id
      LEFT JOIN users u ON c.created_by = u.id
      ORDER BY c.created_at DESC
    `;
        const result = await pool_1.default.query(query);
        return result.rows;
    }
    // الحصول على المسابقات المرئية فقط
    static async getVisible() {
        const query = `
      SELECT c.*, g.name as grade_name
      FROM competitions c
      LEFT JOIN grades g ON c.grade_id = g.id
      WHERE c.is_visible = true AND c.is_active = true
      ORDER BY c.created_at DESC
    `;
        const result = await pool_1.default.query(query);
        return result.rows;
    }
    // الحصول على مسابقة بواسطة المعرف
    static async getById(id) {
        const query = `
      SELECT c.*, g.name as grade_name, u.name as creator_name
      FROM competitions c
      LEFT JOIN grades g ON c.grade_id = g.id
      LEFT JOIN users u ON c.created_by = u.id
      WHERE c.id = $1
    `;
        const result = await pool_1.default.query(query, [id]);
        return result.rows[0] || null;
    }
    // الحصول على مسابقات صف دراسي معين
    static async getByGrade(gradeId) {
        const query = `
      SELECT c.*, g.name as grade_name
      FROM competitions c
      LEFT JOIN grades g ON c.grade_id = g.id
      WHERE c.grade_id = $1 AND c.is_visible = true AND c.is_active = true
      ORDER BY c.created_at DESC
    `;
        const result = await pool_1.default.query(query, [gradeId]);
        return result.rows;
    }
    // تحديث مسابقة
    static async update(id, competition) {
        const fields = Object.keys(competition).filter((key) => competition[key] !== undefined);
        if (fields.length === 0) {
            return this.getById(id);
        }
        const setClause = fields.map((field, index) => `${field} = $${index + 2}`).join(', ');
        const query = `
      UPDATE competitions 
      SET ${setClause}
      WHERE id = $1
      RETURNING *
    `;
        const values = [id, ...fields.map((field) => competition[field])];
        const result = await pool_1.default.query(query, values);
        return result.rows[0] || null;
    }
    // حذف مسابقة
    static async delete(id) {
        const query = 'DELETE FROM competitions WHERE id = $1';
        const result = await pool_1.default.query(query, [id]);
        return (result.rowCount ?? 0) > 0;
    }
    // تغيير حالة الرؤية
    static async toggleVisibility(id) {
        const query = `
      UPDATE competitions 
      SET is_visible = NOT is_visible
      WHERE id = $1
      RETURNING *
    `;
        const result = await pool_1.default.query(query, [id]);
        return result.rows[0] || null;
    }
    // تغيير حالة النشاط
    static async toggleActive(id) {
        const query = `
      UPDATE competitions 
      SET is_active = NOT is_active
      WHERE id = $1
      RETURNING *
    `;
        const result = await pool_1.default.query(query, [id]);
        return result.rows[0] || null;
    }
    // التحقق من وجود مسابقة
    static async exists(id) {
        const query = 'SELECT 1 FROM competitions WHERE id = $1';
        const result = await pool_1.default.query(query, [id]);
        return (result.rowCount ?? 0) > 0;
    }
    // الحصول على مسابقات الطالب حسب صفوفه
    static async getStudentCompetitions(studentId) {
        console.log('getStudentCompetitions called with studentId:', studentId);
        console.log('studentId type:', typeof studentId);
        console.log('isNaN(studentId):', isNaN(studentId));
        if (isNaN(studentId)) {
            throw new Error(`Invalid studentId: ${studentId}`);
        }
        // التحقق من وجود مسابقات في الجدول أولاً
        const competitionsCountQuery = 'SELECT COUNT(*) as count FROM competitions';
        const competitionsCountResult = await pool_1.default.query(competitionsCountQuery);
        console.log('Total competitions in database:', competitionsCountResult.rows[0].count);
        // التحقق من وجود مسابقات مرئية ونشطة
        const visibleActiveCountQuery = 'SELECT COUNT(*) as count FROM competitions WHERE is_visible = true AND is_active = true';
        const visibleActiveCountResult = await pool_1.default.query(visibleActiveCountQuery);
        console.log('Total visible and active competitions:', visibleActiveCountResult.rows[0].count);
        // أولاً، التحقق من وجود بيانات في user_grades للطالب
        const userGradesQuery = 'SELECT grade_id FROM user_grades WHERE user_id = $1';
        const userGradesResult = await pool_1.default.query(userGradesQuery, [studentId]);
        console.log('User grades found:', userGradesResult.rows);
        console.log('User grades count:', userGradesResult.rows.length);
        if (userGradesResult.rows.length === 0) {
            console.log('No grades found for student, returning empty array');
            return [];
        }
        const query = `
      SELECT DISTINCT c.*, g.name as grade_name
      FROM competitions c
      LEFT JOIN grades g ON c.grade_id = g.id
      INNER JOIN user_grades ug ON c.grade_id = ug.grade_id
      WHERE ug.user_id = $1 
        AND c.is_visible = true 
        AND c.is_active = true
      ORDER BY c.created_at DESC
    `;
        console.log('Executing query with studentId:', studentId);
        const result = await pool_1.default.query(query, [studentId]);
        console.log('Query result rows count:', result.rows.length);
        return result.rows;
    }
    // التحقق من اشتراك الطالب في مسابقة
    static async isStudentEnrolled(competitionId, studentId) {
        const query = `
      SELECT 1 FROM competition_students 
      WHERE competition_id = $1 AND student_id = $2 AND is_active = true
    `;
        const result = await pool_1.default.query(query, [competitionId, studentId]);
        return (result.rowCount ?? 0) > 0;
    }
    // اشتراك الطالب في مسابقة
    static async enrollStudent(competitionId, studentId) {
        // التحقق من وجود المسابقة
        const competitionExists = await this.exists(competitionId);
        if (!competitionExists) {
            throw new Error('المسابقة غير موجودة');
        }
        // التحقق من أن الطالب ليس مشتركاً بالفعل
        const isEnrolled = await this.isStudentEnrolled(competitionId, studentId);
        if (isEnrolled) {
            return true; // الطالب مشترك بالفعل
        }
        const query = `
      INSERT INTO competition_students (competition_id, student_id)
      VALUES ($1, $2)
      ON CONFLICT (competition_id, student_id) 
      DO UPDATE SET is_active = true, joined_at = NOW()
    `;
        const result = await pool_1.default.query(query, [competitionId, studentId]);
        return (result.rowCount ?? 0) > 0;
    }
    // جلب تفاصيل المسابقة للطالب (مع الأسئلة)
    static async getStudentCompetitionDetails(competitionId, studentId) {
        try {
            // التحقق من اشتراك الطالب
            const isEnrolled = await this.isStudentEnrolled(competitionId, studentId);
            if (!isEnrolled) {
                throw new Error('يجب الاشتراك في المسابقة لعرض التفاصيل');
            }
            // جلب تفاصيل المسابقة
            const competition = await this.getById(competitionId);
            if (!competition) {
                throw new Error('المسابقة غير موجودة');
            }
            // التحقق من وجود نتيجة للطالب
            const resultQuery = `
        SELECT * FROM competition_results 
        WHERE competition_id = $1 AND student_id = $2
      `;
            const resultResult = await pool_1.default.query(resultQuery, [competitionId, studentId]);
            const hasSolved = resultResult.rows.length > 0;
            if (hasSolved) {
                // الطالب قد حل المسابقة - عرض النتيجة
                const studentResult = await this.getStudentResult(competitionId, studentId);
                return {
                    competition: {
                        id: competition.id,
                        title: competition.title,
                        duration: competition.duration,
                        grade_id: competition.grade_id,
                        is_visible: competition.is_visible,
                        is_active: competition.is_active,
                    },
                    questions: [],
                    has_solved: true,
                    result: studentResult.result,
                    answers: studentResult.answers,
                };
            }
            else {
                // الطالب لم يحل المسابقة - عرض الأسئلة
                const questionsQuery = `
          SELECT id, question_text, option_a, option_b, option_c, option_d, 
                 points, question_order
          FROM competition_questions 
          WHERE competition_id = $1 AND is_active = true
          ORDER BY question_order ASC
        `;
                const questionsResult = await pool_1.default.query(questionsQuery, [competitionId]);
                return {
                    competition: {
                        id: competition.id,
                        title: competition.title,
                        duration: competition.duration,
                        grade_id: competition.grade_id,
                        is_visible: competition.is_visible,
                        is_active: competition.is_active,
                    },
                    questions: questionsResult.rows,
                    has_solved: false,
                };
            }
        }
        catch (error) {
            console.error('Error in getStudentCompetitionDetails:', error);
            throw error;
        }
    }
    // جلب مسابقات الطالب - method جديد محسن
    static async getStudentCompetitionsNew(studentId) {
        try {
            // التحقق من أن معرف الطالب رقم صحيح
            if (!studentId || studentId <= 0) {
                throw new Error('معرف الطالب غير صحيح');
            }
            // جلب الصفوف المسجل فيها الطالب
            const userGradesQuery = `
        SELECT ug.grade_id, g.name as grade_name
        FROM user_grades ug
        LEFT JOIN grades g ON ug.grade_id = g.id
        WHERE ug.user_id = $1
      `;
            const userGradesResult = await pool_1.default.query(userGradesQuery, [studentId]);
            if (userGradesResult.rows.length === 0) {
                // الطالب ليس مسجل في أي صف
                return [];
            }
            // جلب المسابقات المتاحة في صفوف الطالب
            const competitionsQuery = `
        SELECT DISTINCT 
          c.id,
          c.title,
          c.description,
          c.image_url,
          c.duration,
          c.is_visible,
          c.is_active,
          c.grade_id,
          g.name as grade_name,
          c.questions_count,
          c.created_at,
          c.updated_at
        FROM competitions c
        LEFT JOIN grades g ON c.grade_id = g.id
        WHERE c.grade_id IN (
          SELECT grade_id FROM user_grades WHERE user_id = $1
        )
        AND c.is_visible = true 
        AND c.is_active = true
        ORDER BY c.created_at DESC
      `;
            const competitionsResult = await pool_1.default.query(competitionsQuery, [studentId]);
            return competitionsResult.rows;
        }
        catch (error) {
            console.error('Error in getStudentCompetitionsNew:', error);
            throw error;
        }
    }
    // جلب مسابقات الطالب - method بسيط جداً
    static async getStudentCompetitionsSimple(studentId) {
        try {
            // جلب المسابقات المتاحة في صفوف الطالب مع حالة الاشتراك
            const query = `
        SELECT DISTINCT 
          c.id,
          c.title,
          c.description,
          c.image_url,
          c.duration,
          c.is_visible,
          c.is_active,
          c.grade_id,
          g.name as grade_name,
          c.questions_count,
          c.created_at,
          c.updated_at,
          CASE 
            WHEN cs.student_id IS NOT NULL THEN true 
            ELSE false 
          END as is_enrolled
        FROM competitions c
        LEFT JOIN grades g ON c.grade_id = g.id
        INNER JOIN user_grades ug ON c.grade_id = ug.grade_id
        LEFT JOIN competition_students cs ON c.id = cs.competition_id AND cs.student_id = $1 AND cs.is_active = true
        WHERE ug.user_id = $1
        AND c.is_visible = true 
        AND c.is_active = true
        ORDER BY c.created_at DESC
      `;
            const result = await pool_1.default.query(query, [studentId]);
            return result.rows;
        }
        catch (error) {
            console.error('Error in getStudentCompetitionsSimple:', error);
            throw error;
        }
    }
    // حل المسابقة وإرسال الإجابات
    static async solveCompetition(competitionId, studentId, answers) {
        const client = await pool_1.default.connect();
        try {
            await client.query('BEGIN');
            // التحقق من وجود المسابقة
            const competitionExists = await this.exists(competitionId);
            if (!competitionExists) {
                throw new Error('المسابقة غير موجودة');
            }
            // التحقق من اشتراك الطالب
            const isEnrolled = await this.isStudentEnrolled(competitionId, studentId);
            if (!isEnrolled) {
                throw new Error('يجب الاشتراك في المسابقة لحلها');
            }
            // التحقق من أن الطالب لم يحل المسابقة مسبقاً
            const existingResult = await client.query('SELECT id FROM competition_results WHERE competition_id = $1 AND student_id = $2', [competitionId, studentId]);
            if (existingResult.rows.length > 0) {
                throw new Error('لقد قمت بحل هذه المسابقة مسبقاً');
            }
            // جلب أسئلة المسابقة مع الإجابات الصحيحة
            const questionsQuery = `
        SELECT id, question_text, option_a, option_b, option_c, option_d, 
               correct_answer, points, question_order
        FROM competition_questions 
        WHERE competition_id = $1 AND is_active = true
        ORDER BY question_order ASC
      `;
            const questionsResult = await client.query(questionsQuery, [competitionId]);
            const questions = questionsResult.rows;
            if (questions.length === 0) {
                throw new Error('لا توجد أسئلة في هذه المسابقة');
            }
            // التحقق من أن جميع الأسئلة لها إجابات صحيحة
            const questionsWithoutAnswers = questions.filter((q) => !q.correct_answer);
            if (questionsWithoutAnswers.length > 0) {
                throw new Error('بعض الأسئلة لا تحتوي على إجابات صحيحة');
            }
            // تقييم الإجابات
            let correctAnswers = 0;
            let totalPoints = 0;
            let earnedPoints = 0;
            const studentAnswers = [];
            for (const question of questions) {
                const studentAnswer = answers.find((a) => a.question_id === question.id);
                if (!studentAnswer) {
                    throw new Error(`لم يتم الإجابة على السؤال رقم ${question.id}`);
                }
                const isCorrect = studentAnswer.selected_answer === question.correct_answer;
                const earned = isCorrect ? question.points : 0;
                if (isCorrect) {
                    correctAnswers++;
                }
                totalPoints += question.points;
                earnedPoints += earned;
                studentAnswers.push({
                    question_id: question.id,
                    student_answer: studentAnswer.selected_answer,
                    is_correct: isCorrect,
                    points: question.points,
                    earned_points: earned,
                });
            }
            const wrongAnswers = questions.length - correctAnswers;
            const score = Math.round((earnedPoints / totalPoints) * 100);
            const percentage = parseFloat(((earnedPoints / totalPoints) * 100).toFixed(2));
            // حفظ النتيجة
            const resultQuery = `
        INSERT INTO competition_results 
        (competition_id, student_id, score, total_questions, correct_answers, wrong_answers, 
         total_points, earned_points, percentage, submitted_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
        RETURNING id
      `;
            const resultInsert = await client.query(resultQuery, [
                competitionId,
                studentId,
                score,
                questions.length,
                correctAnswers,
                wrongAnswers,
                totalPoints,
                earnedPoints,
                percentage,
            ]);
            const resultId = resultInsert.rows[0].id;
            // حفظ إجابات الطالب
            for (const answer of studentAnswers) {
                await client.query(`
          INSERT INTO student_answers 
          (competition_result_id, question_id, student_answer, is_correct, points, earned_points)
          VALUES ($1, $2, $3, $4, $5, $6)
        `, [
                    resultId,
                    answer.question_id,
                    answer.student_answer,
                    answer.is_correct,
                    answer.points,
                    answer.earned_points,
                ]);
            }
            // حساب الترتيب
            const rankQuery = `
        SELECT COUNT(*) + 1 as rank
        FROM competition_results 
        WHERE competition_id = $1 AND score > $2
      `;
            const rankResult = await client.query(rankQuery, [competitionId, score]);
            const rank = parseInt(rankResult.rows[0].rank);
            // إجمالي عدد الطلاب
            const totalStudentsQuery = `
        SELECT COUNT(*) as total
        FROM competition_results 
        WHERE competition_id = $1
      `;
            const totalStudentsResult = await client.query(totalStudentsQuery, [competitionId]);
            const totalStudents = parseInt(totalStudentsResult.rows[0].total);
            await client.query('COMMIT');
            return {
                score,
                total_questions: questions.length,
                correct_answers: correctAnswers,
                wrong_answers: wrongAnswers,
                total_points: totalPoints,
                earned_points: earnedPoints,
                percentage,
                rank,
                total_students: totalStudents,
                submitted_at: new Date(),
            };
        }
        catch (error) {
            await client.query('ROLLBACK');
            throw error;
        }
        finally {
            client.release();
        }
    }
    // جلب نتيجة الطالب في مسابقة معينة
    static async getStudentResult(competitionId, studentId) {
        try {
            // التحقق من وجود النتيجة
            const resultQuery = `
        SELECT cr.*, c.title, c.duration
        FROM competition_results cr
        JOIN competitions c ON cr.competition_id = c.id
        WHERE cr.competition_id = $1 AND cr.student_id = $2
      `;
            const result = await pool_1.default.query(resultQuery, [competitionId, studentId]);
            if (result.rows.length === 0) {
                throw new Error('لم تقم بحل هذه المسابقة بعد');
            }
            const competitionResult = result.rows[0];
            // جلب إجابات الطالب مع تفاصيل الأسئلة
            const answersQuery = `
        SELECT sa.*, cq.question_text, cq.option_a, cq.option_b, cq.option_c, cq.option_d, cq.correct_answer
        FROM student_answers sa
        JOIN competition_questions cq ON sa.question_id = cq.id
        WHERE sa.competition_result_id = $1
        ORDER BY cq.question_order ASC
      `;
            const answersResult = await pool_1.default.query(answersQuery, [competitionResult.id]);
            const answers = answersResult.rows.map((row) => ({
                question_id: row.question_id,
                question_text: row.question_text,
                student_answer: row.student_answer,
                correct_answer: row.correct_answer,
                is_correct: row.is_correct,
                points: row.points,
                earned_points: row.earned_points,
                explanation: !row.is_correct
                    ? `الإجابة الصحيحة هي ${row.correct_answer}) ${row[`option_${row.correct_answer.toLowerCase()}`]}`
                    : undefined,
            }));
            return {
                competition: {
                    id: competitionResult.competition_id,
                    title: competitionResult.title,
                    duration: competitionResult.duration,
                },
                result: {
                    score: competitionResult.score,
                    total_questions: competitionResult.total_questions,
                    correct_answers: competitionResult.correct_answers,
                    wrong_answers: competitionResult.wrong_answers,
                    total_points: competitionResult.total_points,
                    earned_points: competitionResult.earned_points,
                    percentage: competitionResult.percentage,
                    rank: competitionResult.rank,
                    total_students: competitionResult.total_students,
                    submitted_at: competitionResult.submitted_at,
                },
                answers,
            };
        }
        catch (error) {
            console.error('Error in getStudentResult:', error);
            throw error;
        }
    }
    // جلب ترتيب الطلاب في مسابقة معينة
    static async getCompetitionLeaderboard(competitionId, limit = 10, offset = 0) {
        try {
            // التحقق من وجود المسابقة
            const competitionExists = await this.exists(competitionId);
            if (!competitionExists) {
                throw new Error('المسابقة غير موجودة');
            }
            // جلب إجمالي عدد الطلاب
            const totalQuery = `
        SELECT COUNT(*) as total
        FROM competition_results 
        WHERE competition_id = $1
      `;
            const totalResult = await pool_1.default.query(totalQuery, [competitionId]);
            const total = parseInt(totalResult.rows[0].total);
            // جلب الترتيب
            const leaderboardQuery = `
        SELECT 
          ROW_NUMBER() OVER (ORDER BY cr.score DESC, cr.submitted_at ASC) as rank,
          u.name as student_name,
          cr.score,
          cr.percentage,
          cr.correct_answers,
          cr.total_questions,
          cr.submitted_at
        FROM competition_results cr
        JOIN users u ON cr.student_id = u.id
        WHERE cr.competition_id = $1
        ORDER BY cr.score DESC, cr.submitted_at ASC
        LIMIT $2 OFFSET $3
      `;
            const leaderboardResult = await pool_1.default.query(leaderboardQuery, [competitionId, limit, offset]);
            // جلب معلومات المسابقة
            const competitionQuery = `
        SELECT id, title
        FROM competitions 
        WHERE id = $1
      `;
            const competitionResult = await pool_1.default.query(competitionQuery, [competitionId]);
            const competition = competitionResult.rows[0];
            return {
                competition: {
                    id: competition.id,
                    title: competition.title,
                    total_students: total,
                },
                leaderboard: leaderboardResult.rows,
                pagination: {
                    total,
                    limit,
                    offset,
                    has_more: offset + limit < total,
                },
                filters: {
                    grade_id: null,
                    grade_name: 'جميع الصفوف',
                },
            };
        }
        catch (error) {
            console.error('Error in getCompetitionLeaderboard:', error);
            throw error;
        }
    }
    // جلب ترتيب أوائل مسابقة معينة (للأدمن)
    static async getCompetitionLeaderboardForAdmin(competitionId, gradeId = null, limit = 10, offset = 0) {
        try {
            // التحقق من وجود المسابقة
            const competitionQuery = 'SELECT id, title, grade_id FROM competitions WHERE id = $1';
            const competitionResult = await pool_1.default.query(competitionQuery, [competitionId]);
            if (competitionResult.rows.length === 0) {
                throw new Error('المسابقة غير موجودة');
            }
            const competition = competitionResult.rows[0];
            let whereClause = 'WHERE cr.competition_id = $1';
            const params = [competitionId, limit, offset];
            let paramIndex = 4;
            if (gradeId) {
                whereClause += ' AND c.grade_id = $4';
                params.push(gradeId);
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                paramIndex++;
            }
            // جلب إجمالي عدد النتائج
            const totalQuery = `
        SELECT COUNT(*) as total
        FROM competition_results cr
        JOIN competitions c ON cr.competition_id = c.id
        ${whereClause}
      `;
            // إنشاء مصفوفة منفصلة للـ total query
            const totalParams = [competitionId];
            if (gradeId) {
                totalParams.push(gradeId);
            }
            const totalResult = await pool_1.default.query(totalQuery, totalParams);
            const total = parseInt(totalResult.rows[0].total);
            // جلب الترتيب
            const leaderboardQuery = `
        SELECT 
          ROW_NUMBER() OVER (ORDER BY cr.score DESC, cr.submitted_at ASC) as rank,
          u.name as student_name,
          u.id as student_id,
          g.name as grade_name,
          c.title as competition_title,
          c.id as competition_id,
          cr.score,
          cr.percentage,
          cr.correct_answers,
          cr.total_questions,
          cr.submitted_at
        FROM competition_results cr
        JOIN users u ON cr.student_id = u.id
        JOIN competitions c ON cr.competition_id = c.id
        JOIN grades g ON c.grade_id = g.id
        ${whereClause}
        ORDER BY cr.score DESC, cr.submitted_at ASC
        LIMIT $2 OFFSET $3
      `;
            const leaderboardResult = await pool_1.default.query(leaderboardQuery, params);
            // تحديد اسم الصف للفلتر
            let gradeName = 'جميع الصفوف';
            if (gradeId) {
                const gradeQuery = 'SELECT name FROM grades WHERE id = $1';
                const gradeResult = await pool_1.default.query(gradeQuery, [gradeId]);
                gradeName = gradeResult.rows[0]?.name || 'صف غير معروف';
            }
            return {
                competition: {
                    id: competition.id,
                    title: competition.title,
                    total_students: total,
                },
                leaderboard: leaderboardResult.rows,
                pagination: {
                    total,
                    limit,
                    offset,
                    has_more: offset + limit < total,
                },
                filters: {
                    grade_id: gradeId,
                    grade_name: gradeName,
                },
            };
        }
        catch (error) {
            console.error('Error in getCompetitionLeaderboardForAdmin:', error);
            throw error;
        }
    }
    // جلب ترتيب أوائل المسابقات (للأدمن) - محفوظ للاستخدام المستقبلي
    static async getGlobalLeaderboard(gradeId = null, limit = 10, offset = 0) {
        try {
            let whereClause = '';
            const params = [limit, offset];
            let paramIndex = 3;
            if (gradeId) {
                whereClause = 'WHERE c.grade_id = $3';
                params.push(gradeId);
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                paramIndex++;
            }
            // جلب إجمالي عدد النتائج
            const totalQuery = `
        SELECT COUNT(*) as total
        FROM competition_results cr
        JOIN competitions c ON cr.competition_id = c.id
        ${whereClause}
      `;
            const totalResult = await pool_1.default.query(totalQuery, gradeId ? [gradeId] : []);
            const total = parseInt(totalResult.rows[0].total);
            // جلب الترتيب
            const leaderboardQuery = `
        SELECT 
          ROW_NUMBER() OVER (ORDER BY cr.score DESC, cr.submitted_at ASC) as rank,
          u.name as student_name,
          u.id as student_id,
          g.name as grade_name,
          c.title as competition_title,
          c.id as competition_id,
          cr.score,
          cr.percentage,
          cr.correct_answers,
          cr.total_questions,
          cr.submitted_at
        FROM competition_results cr
        JOIN users u ON cr.student_id = u.id
        JOIN competitions c ON cr.competition_id = c.id
        JOIN grades g ON c.grade_id = g.id
        ${whereClause}
        ORDER BY cr.score DESC, cr.submitted_at ASC
        LIMIT $1 OFFSET $2
      `;
            const leaderboardResult = await pool_1.default.query(leaderboardQuery, params);
            // تحديد اسم الصف للفلتر
            let gradeName = 'جميع الصفوف';
            if (gradeId) {
                const gradeQuery = 'SELECT name FROM grades WHERE id = $1';
                const gradeResult = await pool_1.default.query(gradeQuery, [gradeId]);
                gradeName = gradeResult.rows[0]?.name || 'صف غير معروف';
            }
            return {
                leaderboard: leaderboardResult.rows,
                pagination: {
                    total,
                    limit,
                    offset,
                    has_more: offset + limit < total,
                },
                filters: {
                    grade_id: gradeId,
                    grade_name: gradeName,
                },
            };
        }
        catch (error) {
            console.error('Error in getGlobalLeaderboard:', error);
            throw error;
        }
    }
}
exports.CompetitionsService = CompetitionsService;
