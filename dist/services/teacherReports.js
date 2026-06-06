"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TeacherReportsService = void 0;
const pool_1 = __importDefault(require("../db/pool"));
const utils_1 = require("../utils");
class TeacherReportsService {
    /**
     * البحث عن طلاب مشتركين مع المدرس بالاسم (جزء من الاسم يكفي).
     */
    static async findStudentsByName(teacherId, name) {
        const trimmed = (name || '').trim();
        if (!trimmed)
            return [];
        const result = await pool_1.default.query(`SELECT DISTINCT u.id, u.name, u.email, u.phone,
              COUNT(DISTINCT e.course_id)::text as courses_count
       FROM users u
       JOIN enrollments e ON u.id = e.user_id
       JOIN courses c ON e.course_id = c.id
       WHERE c.teacher_id = $1 AND u.role = 'student'
         AND (u.name ILIKE $2 OR u.email ILIKE $2)
       GROUP BY u.id, u.name, u.email, u.phone
       ORDER BY u.name ASC
       LIMIT 20`, [teacherId, `%${trimmed}%`]);
        return result.rows;
    }
    /**
     * تقرير طالب بالاسم: إن وُجد طالب واحد مطابق يُرجع التقرير، وإلا قائمة مطابقين أو 404.
     */
    static async getStudentReportByName(teacherId, name) {
        const matches = await this.findStudentsByName(teacherId, name);
        if (matches.length === 0) {
            throw new utils_1.HttpError(404, 'لا يوجد طالب مشترك معك بهذا الاسم');
        }
        if (matches.length > 1) {
            return {
                matches: matches.map((m) => ({
                    id: m.id,
                    name: m.name,
                    email: m.email,
                    courses_count: m.courses_count,
                })),
                message: 'وجد أكثر من طالب بهذا الاسم. اختر المعرّف (id) وأرسل الطلب إلى /teacher/students/:studentId/report أو أضف جزءاً من الاسم لتحديد الطالب.',
            };
        }
        const report = await this.getStudentDetailedReport(teacherId, matches[0].id);
        return { report };
    }
    /**
     * Get all students enrolled in teacher's courses
     */
    static async getTeacherStudents(teacherId) {
        const result = await pool_1.default.query(`SELECT DISTINCT 
         u.id,
         u.name,
         u.email,
         u.phone,
         COUNT(DISTINCT e.course_id) as courses_count
       FROM users u
       JOIN enrollments e ON u.id = e.user_id
       JOIN courses c ON e.course_id = c.id
       WHERE c.teacher_id = $1 AND u.role = 'student'
       GROUP BY u.id, u.name, u.email, u.phone
       ORDER BY u.name ASC`, [teacherId]);
        return result.rows;
    }
    /**
     * Get detailed report for a specific student
     */
    static async getStudentDetailedReport(teacherId, studentId) {
        // Verify student is enrolled in teacher's courses
        const enrollmentCheck = await pool_1.default.query(`SELECT DISTINCT e.course_id, c.title as course_title
       FROM enrollments e
       JOIN courses c ON e.course_id = c.id
       WHERE c.teacher_id = $1 AND e.user_id = $2`, [teacherId, studentId]);
        if (!enrollmentCheck.rowCount) {
            throw new utils_1.HttpError(404, 'Student not found or not enrolled in your courses');
        }
        // Get student basic info
        const studentRes = await pool_1.default.query('SELECT id, name, email, phone FROM users WHERE id = $1 AND role = $2', [studentId, 'student']);
        if (!studentRes.rowCount) {
            throw new utils_1.HttpError(404, 'Student not found');
        }
        const student = studentRes.rows[0];
        const courses = enrollmentCheck.rows;
        // Get detailed info for each course
        const coursesDetails = await Promise.all(courses.map(async (course) => {
            try {
                const courseId = course.course_id;
                // Get lectures count
                const lecturesRes = await pool_1.default.query('SELECT COUNT(*) as count FROM lectures WHERE course_id = $1', [courseId]);
                const totalLectures = Number(lecturesRes.rows[0]?.count || 0);
                // Get watched lectures (lecture_views)
                const watchedLecturesRes = await pool_1.default.query(`SELECT l.id, l.title, lv.viewed_at
           FROM lecture_views lv
           JOIN lectures l ON lv.lecture_id = l.id
           WHERE l.course_id = $1 AND lv.user_id = $2
           ORDER BY lv.viewed_at DESC`, [courseId, studentId]);
                const watchedLectures = watchedLecturesRes.rows;
                const watchedLecturesCount = watchedLectures.length;
                // Get all lectures with watched status
                const allLecturesRes = await pool_1.default.query(`SELECT l.id, l.title, l.created_at,
                  CASE WHEN lv.user_id IS NOT NULL THEN true ELSE false END as is_watched,
                  lv.viewed_at
           FROM lectures l
           LEFT JOIN lecture_views lv ON l.id = lv.lecture_id AND lv.user_id = $2
           WHERE l.course_id = $1
           ORDER BY l.created_at ASC`, [courseId, studentId]);
                const allLectures = allLecturesRes.rows;
                // Get video views count + نسبة المشاهدة (متوسط completion_percentage)
                const videoViewsRes = await pool_1.default.query(`SELECT COUNT(DISTINCT vv.video_id) as watched_videos_count,
                  COUNT(*) as total_video_views,
                  COALESCE(AVG(vv.completion_percentage), 0)::float as avg_completion_pct
           FROM video_views vv
           WHERE vv.course_id = $1 AND vv.user_id = $2`, [courseId, studentId]);
                const watchedVideosCount = Number(videoViewsRes.rows[0]?.watched_videos_count || 0);
                const totalVideoViews = Number(videoViewsRes.rows[0]?.total_video_views || 0);
                const watch_percentage = Math.round(Number(videoViewsRes.rows[0]?.avg_completion_pct || 0) * 100) / 100;
                // Get lecture exams (exams table)
                const lectureExamsRes = await pool_1.default.query(`SELECT e.id, e.title, e.type, l.title as lecture_title
           FROM exams e
           JOIN lectures l ON e.lecture_id = l.id
           WHERE l.course_id = $1 AND e.type = 'exam'
           ORDER BY l.created_at ASC, e.created_at ASC`, [courseId]);
                const lectureExams = lectureExamsRes.rows;
                // Get lecture exam submissions
                const lectureExamSubmissionsRes = await pool_1.default.query(`SELECT es.exam_id, es.total_grade, es.obtained_grade, es.passed, es.submitted_at,
                  e.title as exam_title, l.title as lecture_title
           FROM exam_submissions es
           JOIN exams e ON es.exam_id = e.id
           JOIN lectures l ON e.lecture_id = l.id
           WHERE l.course_id = $1 AND es.student_id = $2
           ORDER BY es.submitted_at DESC`, [courseId, studentId]);
                const lectureExamSubmissions = lectureExamSubmissionsRes.rows;
                // Map exams with submission status
                const examsWithStatus = lectureExams.map((exam) => {
                    const submission = lectureExamSubmissions.find((s) => s.exam_id === exam.id);
                    return {
                        examId: exam.id,
                        examTitle: exam.title,
                        lectureTitle: exam.lecture_title,
                        type: 'lecture_exam',
                        hasSubmitted: !!submission,
                        totalGrade: submission?.total_grade || null,
                        obtainedGrade: submission?.obtained_grade || null,
                        passed: submission?.passed || null,
                        submittedAt: submission?.submitted_at || null,
                    };
                });
                // Get course-level exams
                const courseExamsRes = await pool_1.default.query(`SELECT id, title, questions_count, duration_minutes, created_at
           FROM course_level_exams
           WHERE course_id = $1 AND is_active = true
           ORDER BY created_at ASC`, [courseId]);
                const courseExams = courseExamsRes.rows;
                // Get course-level exam attempts
                const courseExamAttemptsRes = await pool_1.default.query(`SELECT a.exam_id, a.attempt_number, a.status, a.total_grade, a.obtained_grade, 
                  a.started_at, a.submitted_at, e.title as exam_title
           FROM course_level_exam_attempts a
           JOIN course_level_exams e ON a.exam_id = e.id
           WHERE e.course_id = $1 AND a.student_id = $2
           ORDER BY a.submitted_at DESC, a.started_at DESC`, [courseId, studentId]);
                const courseExamAttempts = courseExamAttemptsRes.rows;
                // Map course exams with attempt status
                const courseExamsWithStatus = courseExams.map((exam) => {
                    const attempts = courseExamAttempts.filter((a) => a.exam_id === exam.id);
                    const lastAttempt = attempts.length > 0 ? attempts[0] : null;
                    return {
                        examId: exam.id,
                        examTitle: exam.title,
                        questionsCount: exam.questions_count,
                        durationMinutes: exam.duration_minutes,
                        type: 'course_exam',
                        hasAttempted: attempts.length > 0,
                        attemptsCount: attempts.length,
                        lastAttempt: lastAttempt
                            ? {
                                attemptNumber: lastAttempt.attempt_number,
                                status: lastAttempt.status,
                                totalGrade: lastAttempt.total_grade,
                                obtainedGrade: lastAttempt.obtained_grade,
                                startedAt: lastAttempt.started_at,
                                submittedAt: lastAttempt.submitted_at,
                            }
                            : null,
                        allAttempts: attempts.map((a) => ({
                            attemptNumber: a.attempt_number,
                            status: a.status,
                            totalGrade: a.total_grade,
                            obtainedGrade: a.obtained_grade,
                            startedAt: a.started_at,
                            submittedAt: a.submitted_at,
                        })),
                    };
                });
                // Calculate statistics
                const totalExams = lectureExams.length + courseExams.length;
                const submittedExams = examsWithStatus.filter((e) => e.hasSubmitted).length +
                    courseExamsWithStatus.filter((e) => e.hasAttempted).length;
                const notSubmittedExams = totalExams - submittedExams;
                // Calculate average grade
                const allGrades = [
                    ...lectureExamSubmissions.map((s) => ({
                        obtained: s.obtained_grade,
                        total: s.total_grade,
                    })),
                    ...courseExamAttempts
                        .filter((a) => a.status === 'submitted' && a.total_grade && a.obtained_grade)
                        .map((a) => ({
                        obtained: a.obtained_grade,
                        total: a.total_grade,
                    })),
                ];
                const totalObtained = allGrades.reduce((sum, g) => sum + (g.obtained || 0), 0);
                const totalMax = allGrades.reduce((sum, g) => sum + (g.total || 0), 0);
                const averageGrade = totalMax > 0 ? (totalObtained / totalMax) * 100 : 0;
                return {
                    courseId: courseId,
                    courseTitle: course.course_title,
                    totalLectures,
                    watchedLecturesCount,
                    notWatchedLecturesCount: totalLectures - watchedLecturesCount,
                    watchedLectures: watchedLectures.map((l) => ({
                        lectureId: l.id,
                        lectureTitle: l.title,
                        viewedAt: l.viewed_at,
                    })),
                    allLectures: allLectures.map((l) => ({
                        lectureId: l.id,
                        lectureTitle: l.title,
                        isWatched: l.is_watched,
                        viewedAt: l.viewed_at,
                    })),
                    watchedVideosCount,
                    totalVideoViews,
                    watch_percentage: watch_percentage,
                    lectureExams: examsWithStatus,
                    courseExams: courseExamsWithStatus,
                    statistics: {
                        totalExams,
                        submittedExams,
                        notSubmittedExams,
                        totalLectures,
                        watchedLecturesCount,
                        notWatchedLecturesCount: totalLectures - watchedLecturesCount,
                        averageGrade: Math.round(averageGrade * 100) / 100,
                        totalObtainedGrade: totalObtained,
                        totalMaxGrade: totalMax,
                        watch_percentage: watch_percentage,
                    },
                };
            }
            catch (error) {
                console.error(`Error processing course ${course.course_id}:`, error);
                // Return basic course info even if there's an error
                return {
                    courseId: course.course_id,
                    courseTitle: course.course_title,
                    totalLectures: 0,
                    watchedLecturesCount: 0,
                    notWatchedLecturesCount: 0,
                    watchedLectures: [],
                    allLectures: [],
                    watchedVideosCount: 0,
                    totalVideoViews: 0,
                    watch_percentage: 0,
                    lectureExams: [],
                    courseExams: [],
                    statistics: {
                        totalExams: 0,
                        submittedExams: 0,
                        notSubmittedExams: 0,
                        totalLectures: 0,
                        watchedLecturesCount: 0,
                        notWatchedLecturesCount: 0,
                        averageGrade: 0,
                        totalObtainedGrade: 0,
                        totalMaxGrade: 0,
                        watch_percentage: 0,
                    },
                };
            }
        }));
        const totalLecturesOverall = coursesDetails.reduce((sum, c) => sum + c.statistics.totalLectures, 0);
        const watchedLecturesOverall = coursesDetails.reduce((sum, c) => sum + c.statistics.watchedLecturesCount, 0);
        const totalExamsOverall = coursesDetails.reduce((sum, c) => sum + c.statistics.totalExams, 0);
        const submittedExamsOverall = coursesDetails.reduce((sum, c) => sum + c.statistics.submittedExams, 0);
        const overallWatchPercentage = coursesDetails.length > 0
            ? Math.round((coursesDetails.reduce((sum, c) => sum + (c.statistics.watch_percentage ?? 0), 0) /
                coursesDetails.length) *
                100) / 100
            : 0;
        return {
            student: {
                id: student.id,
                name: student.name,
                email: student.email,
                phone: student.phone,
            },
            courses: coursesDetails,
            overallStatistics: {
                totalCourses: courses.length,
                totalLectures: totalLecturesOverall,
                watchedLectures: watchedLecturesOverall,
                totalExams: totalExamsOverall,
                submittedExams: submittedExamsOverall,
                overallAverageGrade: coursesDetails.length > 0
                    ? Math.round((coursesDetails.reduce((sum, c) => sum + c.statistics.averageGrade, 0) /
                        coursesDetails.length) *
                        100) / 100
                    : 0,
                watch_percentage: overallWatchPercentage,
            },
        };
    }
}
exports.TeacherReportsService = TeacherReportsService;
