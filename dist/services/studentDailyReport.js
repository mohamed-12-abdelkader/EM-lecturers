"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.StudentDailyReportService = void 0;
const pool_1 = __importDefault(require("../db/pool"));
/**
 * تقرير يومي للطالب: المحاضرات والامتحانات المتراكمة (غير المكتملة)
 */
class StudentDailyReportService {
    static async getReport(studentId) {
        const now = new Date().toISOString();
        // 1) كورسات الطالب (نشطة)
        const enrollmentsRes = await pool_1.default.query(`SELECT c.id as course_id, c.title as course_title
       FROM enrollments e
       JOIN courses c ON e.course_id = c.id
       WHERE e.user_id = $1 AND c.is_visible = true
         AND (e.subscription_status IS NULL OR e.subscription_status = 'active')
         AND (e.expires_at IS NULL OR e.expires_at > NOW())
         AND (e.is_blocked_by_teacher IS NULL OR e.is_blocked_by_teacher = false)`, [studentId]);
        const enrollments = enrollmentsRes.rows;
        const courseIds = enrollments.map((r) => r.course_id);
        if (courseIds.length === 0) {
            return {
                pending_lectures: [],
                pending_exams: [],
                summary: {
                    pending_lectures_count: 0,
                    pending_exams_count: 0,
                    total_courses: 0,
                },
                generated_at: now,
            };
        }
        // 2) المحاضرات في هذه الكورسات
        const lecturesRes = await pool_1.default.query(`SELECT l.id, l.title, l.course_id, l.position
       FROM lectures l
       WHERE l.course_id = ANY($1::int[])
       ORDER BY l.course_id, l.position`, [courseIds]);
        const lectures = lecturesRes.rows;
        const lectureIds = lectures.map((l) => l.id);
        let videoCountByLecture = {};
        let watchedCountByLecture = {};
        if (lectureIds.length > 0) {
            const videoCountRes = await pool_1.default.query(`SELECT lecture_id, COUNT(*) as cnt
         FROM lecture_videos
         WHERE lecture_id = ANY($1::int[])
         GROUP BY lecture_id`, [lectureIds]);
            videoCountRes.rows.forEach((r) => {
                videoCountByLecture[r.lecture_id] = parseInt(r.cnt, 10) || 0;
            });
            const watchedRes = await pool_1.default.query(`SELECT lecture_id, COUNT(DISTINCT video_id) as cnt
         FROM video_views
         WHERE user_id = $1 AND lecture_id = ANY($2::int[])
         GROUP BY lecture_id`, [studentId, lectureIds]);
            watchedRes.rows.forEach((r) => {
                watchedCountByLecture[r.lecture_id] = parseInt(r.cnt, 10) || 0;
            });
        }
        const courseTitleById = {};
        enrollments.forEach((e) => {
            courseTitleById[e.course_id] = e.course_title;
        });
        const pending_lectures = [];
        for (const l of lectures) {
            const totalVideos = videoCountByLecture[l.id] || 0;
            const watchedVideos = watchedCountByLecture[l.id] || 0;
            const watchPercentage = totalVideos > 0 ? (watchedVideos / totalVideos) * 100 : 0;
            const isWatched = watchPercentage >= 33.33 || watchedVideos > 0;
            if (!isWatched && totalVideos > 0) {
                pending_lectures.push({
                    id: l.id,
                    title: l.title,
                    course_id: l.course_id,
                    course_title: courseTitleById[l.course_id] || '',
                    position: l.position,
                    watched_videos: watchedVideos,
                    total_videos: totalVideos,
                    watch_percentage: Math.round(watchPercentage * 100) / 100,
                });
            }
        }
        // 3) امتحانات المحاضرات (exams مرتبطة بـ lecture_id) — التي لم يُسلّم لها أو يمكن إعادة المحاولة
        const lectureExamsRes = await pool_1.default.query(`SELECT e.id, e.title, e.lecture_id, e.total_grade, l.course_id
       FROM exams e
       JOIN lectures l ON e.lecture_id = l.id
       WHERE l.course_id = ANY($1::int[])
         AND (e.is_visible IS NULL OR e.is_visible = true)
         AND (e.show_at IS NULL OR e.show_at <= NOW())
         AND (e.hide_at IS NULL OR e.hide_at > NOW())`, [courseIds]);
        const lectureExams = lectureExamsRes.rows;
        const pending_exams = [];
        for (const exam of lectureExams) {
            const subRes = await pool_1.default.query(`SELECT id, status, submitted_at, total_grade, passed
         FROM exam_submissions
         WHERE exam_id = $1 AND student_id = $2
         ORDER BY attempt_start_time DESC
         LIMIT 1`, [exam.id, studentId]);
            const last = subRes.rows[0];
            const submitted = last && (last.status === 'submitted' || last.status === 'late');
            const passed = last ? last.passed : null;
            if (!submitted) {
                pending_exams.push({
                    id: exam.id,
                    title: exam.title,
                    type: 'lecture',
                    course_id: exam.course_id,
                    course_title: courseTitleById[exam.course_id] || '',
                    lecture_id: exam.lecture_id,
                    total_grade: exam.total_grade || 0,
                    attempts_count: subRes.rowCount ? 1 : 0,
                    attempt_limit: null,
                    last_submitted_at: last?.submitted_at || null,
                    passed,
                });
            }
        }
        // 4) امتحانات الكورس (course_exams)
        const courseExamsRes = await pool_1.default.query(`SELECT ce.id, ce.title, ce.course_id, ce.total_grade, ce.attempt_limit
       FROM course_exams ce
       WHERE ce.course_id = ANY($1::int[])`, [courseIds]);
        for (const exam of courseExamsRes.rows) {
            const subRes = await pool_1.default.query(`SELECT id, attempts_count, submitted_at, passed
         FROM course_exam_submissions
         WHERE exam_id = $1 AND student_id = $2`, [exam.id, studentId]);
            const sub = subRes.rows[0];
            const attemptsCount = sub ? parseInt(sub.attempts_count, 10) || 0 : 0;
            const attemptLimit = exam.attempt_limit != null ? parseInt(exam.attempt_limit, 10) : null;
            const canTryMore = attemptLimit === null || attemptsCount < attemptLimit;
            if (!sub || canTryMore) {
                pending_exams.push({
                    id: exam.id,
                    title: exam.title,
                    type: 'course',
                    course_id: exam.course_id,
                    course_title: courseTitleById[exam.course_id] || '',
                    total_grade: exam.total_grade || 0,
                    attempts_count: attemptsCount,
                    attempt_limit: attemptLimit,
                    last_submitted_at: sub?.submitted_at || null,
                    passed: sub?.passed ?? null,
                });
            }
        }
        return {
            pending_lectures,
            pending_exams,
            summary: {
                pending_lectures_count: pending_lectures.length,
                pending_exams_count: pending_exams.length,
                total_courses: courseIds.length,
            },
            generated_at: now,
        };
    }
}
exports.StudentDailyReportService = StudentDailyReportService;
