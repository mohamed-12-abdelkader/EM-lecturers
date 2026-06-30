"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TeacherDailyCourseReportService = void 0;
const pool_1 = __importDefault(require("../db/pool"));
const watchProgress_1 = require("./watchProgress");
const utils_1 = require("../utils");
/**
 * تقرير يومي للمدرس عن آخر كورس أنشأه أو له نشاط حديث.
 * يشمل: بيانات الكورس، إحصائيات الطلاب، التفاعل مع المحاضرات، آخر امتحان، الأسئلة الضعيفة.
 */
class TeacherDailyCourseReportService {
    /**
     * آخر كورس: آخر كورس أنشأه المدرس (حسب created_at).
     */
    static async getLastCourseId(teacherId) {
        const res = await pool_1.default.query(`SELECT id FROM courses
       WHERE teacher_id = $1
       ORDER BY created_at DESC
       LIMIT 1`, [teacherId]);
        return res.rowCount && res.rows[0] ? res.rows[0].id : null;
    }
    /**
     * آخر كورس لكل صف: لكل صف (grade_id) فيه كورس للمدرس، يُرجع آخر كورس (حسب created_at).
     * DISTINCT ON (c.grade_id) يضمن صفاً واحداً لكل grade — الأحدث created_at.
     * ملاحظة: لو ظهر تقرير واحد فقط، تأكد أن كل كورس له grade_id الصحيح (أولى، ثانية، ثالثة...).
     */
    static async getLastCoursesPerGrade(teacherId) {
        const res = await pool_1.default.query(`SELECT DISTINCT ON (c.grade_id)
              c.id AS course_id, c.grade_id, g.name AS grade_name
       FROM courses c
       LEFT JOIN grades g ON g.id = c.grade_id
       WHERE c.teacher_id = $1 AND c.grade_id IS NOT NULL
       ORDER BY c.grade_id, c.created_at DESC`, [teacherId]);
        return (res.rows || []).map((row) => ({
            course_id: row.course_id,
            grade_id: row.grade_id,
            grade_name: row.grade_name || `الصف ${row.grade_id}`,
        }));
    }
    static async getReport(teacherId) {
        const reports = await this.getReports(teacherId);
        if (reports.length === 0) {
            throw new utils_1.HttpError(404, 'لا يوجد كورس للمدرس');
        }
        return reports[0];
    }
    /**
     * تقارير يومية: تقرير واحد لكل صف (آخر كورس شغال عليه المدرس في ذلك الصف).
     * لو المدرس عنده كورس في أولى وواحد في ثانية وواحد في ثالثة ثانوي، يُرجع 3 تقارير.
     * لو كل كورساته بدون صف، يُرجع تقريراً واحداً لآخر كورس له.
     */
    static async getReports(teacherId) {
        let coursesPerGrade = await this.getLastCoursesPerGrade(teacherId);
        if (coursesPerGrade.length === 0) {
            const lastId = await this.getLastCourseId(teacherId);
            if (lastId)
                coursesPerGrade = [{ course_id: lastId, grade_id: 0, grade_name: '' }];
        }
        const reports = [];
        for (const { course_id, grade_id, grade_name } of coursesPerGrade) {
            try {
                const report = await this.getReportForCourse(teacherId, course_id, grade_id || undefined, grade_name || undefined);
                reports.push(report);
            }
            catch (_e) {
                // تخطي كورس لو حصل خطأ (مثلاً تم حذفه)
            }
        }
        return reports;
    }
    /**
     * تقرير يومي لكورس واحد (مع التحقق من أن الكورس يخص المدرس).
     */
    static async getReportForCourse(teacherId, courseId, gradeId, gradeName) {
        const generated_at = new Date().toISOString();
        const emptyReport = {
            course: null,
            students_stats: {
                total_enrolled: 0,
                enrolled_today: 0,
                active_count: 0,
                inactive_count: 0,
            },
            lecture_stats: {
                last_lecture_watchers_count: 0,
                average_watch_percentage: 0,
            },
            last_exam: null,
            weak_questions: [],
            generated_at,
        };
        const courseCheck = await pool_1.default.query(`SELECT id, title, created_at, grade_id FROM courses WHERE id = $1 AND teacher_id = $2`, [courseId, teacherId]);
        if (!courseCheck.rowCount) {
            throw new utils_1.HttpError(404, 'الكورس غير موجود أو لا يخصك');
        }
        const courseRow = courseCheck.rows[0];
        const courseGradeId = gradeId ?? courseRow.grade_id ?? null;
        let courseGradeName = gradeName ?? null;
        if (courseGradeId != null && !courseGradeName) {
            const g = await pool_1.default.query('SELECT name FROM grades WHERE id = $1', [courseGradeId]);
            courseGradeName = g.rows[0]?.name ?? null;
        }
        // 1) Course: lectures count
        const lecturesCountRes = await pool_1.default.query('SELECT COUNT(*) as cnt FROM lectures WHERE course_id = $1', [courseId]);
        const lectures_count = parseInt(lecturesCountRes.rows[0]?.cnt || '0', 10);
        const course = {
            course_id: courseRow.id,
            course_title: courseRow.title,
            created_at: courseRow.created_at,
            lectures_count,
            ...(courseGradeId != null && { grade_id: courseGradeId }),
            ...(courseGradeName && { grade_name: courseGradeName }),
        };
        // 2) Students stats: total, enrolled today, active (last 48h), inactive
        const totalEnrolledRes = await pool_1.default.query(`SELECT COUNT(*) as cnt FROM enrollments e
       WHERE e.course_id = $1
         AND (e.subscription_status IS NULL OR e.subscription_status = 'active')
         AND (e.expires_at IS NULL OR e.expires_at > NOW())
         AND (e.is_blocked_by_teacher IS NULL OR e.is_blocked_by_teacher = false)`, [courseId]);
        const total_enrolled = parseInt(totalEnrolledRes.rows[0]?.cnt || '0', 10);
        const enrolledTodayRes = await pool_1.default.query(`SELECT COUNT(*) as cnt FROM enrollments e
       WHERE e.course_id = $1
         AND e.enrolled_at >= CURRENT_DATE
         AND (e.subscription_status IS NULL OR e.subscription_status = 'active')
         AND (e.expires_at IS NULL OR e.expires_at > NOW())
         AND (e.is_blocked_by_teacher IS NULL OR e.is_blocked_by_teacher = false)`, [courseId]);
        const enrolled_today = parseInt(enrolledTodayRes.rows[0]?.cnt || '0', 10);
        // Active = watched any video OR submitted any exam in last 48 hours (within this course)
        const activeIdsRes = await pool_1.default.query(`SELECT DISTINCT user_id FROM (
         SELECT user_id FROM video_views
         WHERE course_id = $1 AND viewed_at > NOW() - INTERVAL '48 hours'
         UNION
         SELECT es.student_id AS user_id
         FROM exam_submissions es
         JOIN exams e ON es.exam_id = e.id
         JOIN lectures l ON e.lecture_id = l.id
         WHERE l.course_id = $1 AND es.submitted_at > NOW() - INTERVAL '48 hours'
         UNION
         SELECT a.student_id AS user_id
         FROM course_level_exam_attempts a
         JOIN course_level_exams e ON a.exam_id = e.id
         WHERE e.course_id = $1 AND a.submitted_at > NOW() - INTERVAL '48 hours'
       ) AS active_users`, [courseId]);
        const activeUserIds = (activeIdsRes.rows || []).map((r) => r.user_id);
        const enrolledUserIdsRes = await pool_1.default.query(`SELECT e.user_id FROM enrollments e
       WHERE e.course_id = $1
         AND (e.subscription_status IS NULL OR e.subscription_status = 'active')
         AND (e.expires_at IS NULL OR e.expires_at > NOW())
         AND (e.is_blocked_by_teacher IS NULL OR e.is_blocked_by_teacher = false)`, [courseId]);
        const enrolledUserIds = new Set((enrolledUserIdsRes.rows || []).map((r) => r.user_id));
        const active_count = activeUserIds.filter((id) => enrolledUserIds.has(id)).length;
        const inactive_count = Math.max(0, total_enrolled - active_count);
        const students_stats = {
            total_enrolled,
            enrolled_today,
            active_count,
            inactive_count,
        };
        // 3) Lecture stats: last lecture watchers, average watch percentage
        let last_lecture_id = null;
        if (lectures_count > 0) {
            const lastLectureRes = await pool_1.default.query(`SELECT id FROM lectures WHERE course_id = $1 ORDER BY position DESC NULLS LAST, id DESC LIMIT 1`, [courseId]);
            last_lecture_id = lastLectureRes.rows[0]?.id ?? null;
        }
        let last_lecture_watchers_count = 0;
        if (last_lecture_id) {
            const watchersRes = await pool_1.default.query(`SELECT COUNT(DISTINCT vv.user_id) as cnt
         FROM video_views vv
         JOIN enrollments e ON e.user_id = vv.user_id AND e.course_id = vv.course_id
         WHERE vv.lecture_id = $1 AND vv.course_id = $2
           AND (e.subscription_status IS NULL OR e.subscription_status = 'active')
           AND (e.expires_at IS NULL OR e.expires_at > NOW())
           AND (e.is_blocked_by_teacher IS NULL OR e.is_blocked_by_teacher = false)`, [last_lecture_id, courseId]);
            last_lecture_watchers_count = parseInt(watchersRes.rows[0]?.cnt || '0', 10);
        }
        const average_watch_percentage = await (0, watchProgress_1.getCourseAverageWatchPercentage)(courseId);
        const lecture_stats = {
            last_lecture_watchers_count,
            average_watch_percentage,
        };
        // 4) Last exam in course (most recently created: lecture exam or course-level exam)
        const lastExamRow = await pool_1.default.query(`SELECT e.id, e.title, e.created_at, 'lecture' AS exam_type
       FROM exams e
       JOIN lectures l ON e.lecture_id = l.id
       WHERE l.course_id = $1
       UNION ALL
       SELECT cle.id, cle.title, cle.created_at, 'course' AS exam_type
       FROM course_level_exams cle
       WHERE cle.course_id = $1
       ORDER BY created_at DESC
       LIMIT 1`, [courseId]);
        let last_exam = null;
        if (lastExamRow.rowCount && lastExamRow.rows[0]) {
            const row = lastExamRow.rows[0];
            const examId = row.id;
            const examType = row.exam_type;
            if (examType === 'lecture') {
                const subRes = await pool_1.default.query(`SELECT COUNT(*) as total,
                  COUNT(*) FILTER (WHERE passed = true) as passed,
                  COUNT(*) FILTER (WHERE e.total_grade > 0 AND (es.total_grade::float / e.total_grade) > 0.85) as excellence
           FROM exam_submissions es
           JOIN exams e ON e.id = es.exam_id
           WHERE es.exam_id = $1 AND es.status IN ('submitted', 'late', 'expired')`, [examId]);
                const total = parseInt(subRes.rows[0]?.total || '0', 10);
                const passed = parseInt(subRes.rows[0]?.passed || '0', 10);
                const excellence = parseInt(subRes.rows[0]?.excellence || '0', 10);
                last_exam = {
                    exam_id: examId,
                    exam_title: row.title,
                    exam_type: 'lecture',
                    students_attempted: total,
                    success_rate: total > 0 ? Math.round((passed / total) * 10000) / 100 : 0,
                    excellence_rate: total > 0 ? Math.round((excellence / total) * 10000) / 100 : 0,
                };
            }
            else {
                const attRes = await pool_1.default.query(`SELECT COUNT(*) as total,
                  COUNT(*) FILTER (WHERE total_grade > 0 AND (obtained_grade::float / total_grade) >= 0.5) as passed,
                  COUNT(*) FILTER (WHERE total_grade > 0 AND (obtained_grade::float / total_grade) > 0.85) as excellence
           FROM course_level_exam_attempts
           WHERE exam_id = $1 AND status = 'submitted'`, [examId]);
                const total = parseInt(attRes.rows[0]?.total || '0', 10);
                const passed = parseInt(attRes.rows[0]?.passed || '0', 10);
                const excellence = parseInt(attRes.rows[0]?.excellence || '0', 10);
                last_exam = {
                    exam_id: examId,
                    exam_title: row.title,
                    exam_type: 'course',
                    students_attempted: total,
                    success_rate: total > 0 ? Math.round((passed / total) * 10000) / 100 : 0,
                    excellence_rate: total > 0 ? Math.round((excellence / total) * 10000) / 100 : 0,
                };
            }
        }
        // 5) Weak questions: wrong rate > 50% (lecture exams + course exams in this course)
        const weakQuestions = [];
        // Lecture exams: exam_questions + exam_answers (submission -> exam_submissions -> exams -> lectures -> course)
        const lectureWeakRes = await pool_1.default.query(`SELECT eq.id AS question_id,
              eq.question_text,
              eq.image AS question_image,
              COUNT(*) AS total_answers,
              COUNT(*) FILTER (WHERE ea.is_correct = false) AS wrong_count
       FROM exam_questions eq
       JOIN exams e ON eq.exam_id = e.id
       JOIN lectures l ON e.lecture_id = l.id
       JOIN exam_answers ea ON ea.question_id = eq.id
       JOIN exam_submissions es ON ea.submission_id = es.id AND es.exam_id = e.id
       WHERE l.course_id = $1
         AND es.status IN ('submitted', 'late', 'expired')
       GROUP BY eq.id, eq.question_text, eq.image
       HAVING COUNT(*) > 0 AND (COUNT(*) FILTER (WHERE ea.is_correct = false)::float / COUNT(*)) > 0.5`, [courseId]);
        for (const r of lectureWeakRes.rows || []) {
            const total = parseInt(r.total_answers, 10) || 0;
            const wrong = parseInt(r.wrong_count, 10) || 0;
            weakQuestions.push({
                question_id: r.question_id,
                question_source: 'lecture_exam',
                question_text: r.question_text || null,
                question_image: r.question_image || null,
                wrong_rate: total > 0 ? Math.round((wrong / total) * 10000) / 100 : 0,
                students_wrong_count: wrong,
            });
        }
        // Course-level exams: course_level_exam_questions + course_level_exam_answers
        const courseWeakRes = await pool_1.default.query(`SELECT q.id AS question_id,
              q.question_text,
              q.question_image,
              COUNT(*) AS total_answers,
              COUNT(*) FILTER (WHERE a.is_correct = false) AS wrong_count,
              COUNT(DISTINCT CASE WHEN a.is_correct = false THEN att.student_id END) AS students_wrong
       FROM course_level_exam_questions q
       JOIN course_level_exams e ON q.exam_id = e.id
       JOIN course_level_exam_answers a ON a.question_id = q.id
       JOIN course_level_exam_attempts att ON a.attempt_id = att.id AND att.exam_id = e.id
       WHERE e.course_id = $1 AND att.status = 'submitted'
       GROUP BY q.id, q.question_text, q.question_image
       HAVING COUNT(*) > 0 AND (COUNT(*) FILTER (WHERE a.is_correct = false)::float / COUNT(*)) > 0.5`, [courseId]);
        for (const r of courseWeakRes.rows || []) {
            const total = parseInt(r.total_answers, 10) || 0;
            const wrong = parseInt(r.wrong_count, 10) || 0;
            const studentsWrong = parseInt(r.students_wrong, 10) || 0;
            weakQuestions.push({
                question_id: r.question_id,
                question_source: 'course_exam',
                question_text: r.question_text || null,
                question_image: r.question_image || null,
                wrong_rate: total > 0 ? Math.round((wrong / total) * 10000) / 100 : 0,
                students_wrong_count: studentsWrong,
            });
        }
        return {
            course,
            students_stats,
            lecture_stats,
            last_exam,
            weak_questions: weakQuestions,
            generated_at,
        };
    }
}
exports.TeacherDailyCourseReportService = TeacherDailyCourseReportService;
