"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DataAnalystExamReportsService = void 0;
exports.isExamAnalysisRequest = isExamAnalysisRequest;
exports.classifyExamReportKind = classifyExamReportKind;
exports.extractExamSearchQuery = extractExamSearchQuery;
const pool_1 = __importDefault(require("../db/pool"));
const utils_1 = require("../utils");
const courseLevelExams_1 = require("./courseLevelExams");
const examFlow_1 = require("./examFlow");
function normalizeText(text) {
    return text
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .replace(/[أإآ]/g, 'ا')
        .replace(/ة/g, 'ه')
        .replace(/ى/g, 'ي');
}
function containsAny(text, keywords) {
    const normalized = normalizeText(text);
    return keywords.some((keyword) => normalized.includes(normalizeText(keyword)));
}
function isExamAnalysisRequest(text) {
    const hasIntent = containsAny(text, [
        'تقرير',
        'تحليل',
        'احصائيات',
        'إحصائيات',
        'اداء',
        'أداء',
        'مين امتحن',
        'من امتحن',
        'لم يمتحن',
        'نقاط قوة',
        'نقاط ضعف',
    ]);
    const hasExamRef = containsAny(text, [
        'واجب',
        'تكليف',
        'homework',
        'assignment',
        'محاضرة',
        'امتحان',
        'اختبار',
        'exam',
        'quiz',
    ]);
    return hasIntent && hasExamRef;
}
function classifyExamReportKind(text) {
    const lectureHints = ['واجب', 'تكليف', 'homework', 'assignment', 'محاضرة'];
    const courseHints = ['امتحان', 'اختبار', 'exam', 'quiz'];
    const isLecture = containsAny(text, lectureHints);
    const isCourse = containsAny(text, courseHints);
    if (isLecture && !isCourse)
        return 'lecture';
    if (isCourse && !isLecture)
        return 'course';
    if (isLecture && isCourse) {
        const n = normalizeText(text);
        const lectureIndex = Math.min(...lectureHints
            .map((hint) => n.indexOf(normalizeText(hint)))
            .filter((index) => index >= 0));
        const courseIndex = Math.min(...courseHints
            .map((hint) => n.indexOf(normalizeText(hint)))
            .filter((index) => index >= 0));
        if (Number.isFinite(lectureIndex) && Number.isFinite(courseIndex)) {
            return lectureIndex < courseIndex ? 'lecture' : 'course';
        }
        return 'lecture';
    }
    return null;
}
function extractExamSearchQuery(text) {
    let query = text.trim();
    const patterns = [
        /^محتاج\s+(?:تقرير|تحليل)\s+(?:عن|ل)?\s*/i,
        /^(?:اعمل|اعطني|عايز|اريد|أريد)\s+(?:تقرير|تحليل)\s+(?:عن|ل)?\s*/i,
        /^(?:تقرير|تحليل)\s+(?:عن|ل)?\s*/i,
    ];
    for (const pattern of patterns) {
        query = query.replace(pattern, '').trim();
    }
    return query.replace(/\s+/g, ' ').trim();
}
function buildSearchPattern(query) {
    const words = query
        .split(/\s+/)
        .map((word) => word.trim())
        .filter((word) => word.length >= 2);
    if (!words.length)
        return `%${query}%`;
    return `%${words.join('%')}%`;
}
class DataAnalystExamReportsService {
    static async findLectureExams(teacherId, query) {
        const pattern = buildSearchPattern(query);
        const result = await pool_1.default.query(`SELECT e.id, e.title, e.type, l.title AS lecture_title, c.title AS course_title
       FROM exams e
       INNER JOIN lectures l ON e.lecture_id = l.id
       INNER JOIN courses c ON l.course_id = c.id
       WHERE c.teacher_id = $1
         AND (
           l.title ILIKE $2
           OR e.title ILIKE $2
           OR CONCAT(l.title, ' ', COALESCE(e.title, '')) ILIKE $2
           OR CONCAT(c.title, ' ', l.title) ILIKE $2
         )
       ORDER BY e.created_at DESC
       LIMIT 15`, [teacherId, pattern]);
        return result.rows.map((row) => ({
            id: row.id,
            title: row.title,
            courseTitle: row.course_title,
            lectureTitle: row.lecture_title,
            examKind: 'lecture',
            type: row.type,
        }));
    }
    static async findCourseExams(teacherId, query) {
        const pattern = buildSearchPattern(query);
        const result = await pool_1.default.query(`SELECT e.id, e.title, c.title AS course_title
       FROM course_level_exams e
       INNER JOIN courses c ON e.course_id = c.id
       WHERE c.teacher_id = $1
         AND (e.title ILIKE $2 OR c.title ILIKE $2 OR CONCAT(c.title, ' ', e.title) ILIKE $2)
       ORDER BY e.created_at DESC
       LIMIT 15`, [teacherId, pattern]);
        return result.rows.map((row) => ({
            id: row.id,
            title: row.title,
            courseTitle: row.course_title,
            examKind: 'course',
        }));
    }
    static async getLectureExamAnalysis(teacherId, examId) {
        const exam = await examFlow_1.ExamFlowService.getExamWithCourse(examId);
        if (!exam)
            throw new utils_1.HttpError(404, 'الامتحان غير موجود');
        if (exam.teacher_id !== teacherId) {
            throw new utils_1.HttpError(403, 'ليس لديك صلاحية على هذا الامتحان');
        }
        const questionReport = await examFlow_1.ExamFlowService.getExamQuestionReport(examId, {
            id: teacherId,
            role: 'teacher',
        });
        const participationRes = await pool_1.default.query(`SELECT
         u.id AS student_id,
         u.name AS student_name,
         es.id AS submission_id,
         es.status,
         es.total_grade,
         es.passed,
         es.submitted_at
       FROM enrollments en
       JOIN users u ON u.id = en.user_id
       LEFT JOIN LATERAL (
         SELECT s.id, s.status, s.total_grade, s.passed, s.submitted_at
         FROM exam_submissions s
         WHERE s.exam_id = $2
           AND s.student_id = u.id
           AND s.status IN ('submitted', 'late', 'expired')
         ORDER BY s.submitted_at DESC NULLS LAST, s.id DESC
         LIMIT 1
       ) es ON TRUE
       WHERE en.course_id = $1
       ORDER BY u.name ASC`, [exam.course_id, examId]);
        const students = participationRes.rows.map((row) => ({
            studentId: row.student_id,
            studentName: row.student_name,
            submitted: row.submission_id != null,
            status: row.status,
            totalGrade: row.total_grade,
            passed: row.passed,
            submittedAt: row.submitted_at,
        }));
        const submitted = students.filter((s) => s.submitted);
        const notSubmitted = students.filter((s) => !s.submitted);
        const totalEnrolled = students.length;
        const submissionRate = totalEnrolled > 0 ? Math.round((submitted.length / totalEnrolled) * 1000) / 10 : 0;
        const questionStats = questionReport.questions.map((question) => ({
            questionId: question.questionId,
            questionText: question.questionText,
            totalResponses: question.totalResponses,
            correctCount: question.correctCount,
            incorrectCount: question.incorrectCount,
            correctPercentage: question.totalResponses > 0
                ? Math.round((question.correctCount / question.totalResponses) * 1000) / 10
                : 0,
        }));
        const strongestQuestions = [...questionStats]
            .filter((q) => q.totalResponses > 0)
            .sort((a, b) => b.correctPercentage - a.correctPercentage)
            .slice(0, 3);
        const weakestQuestions = [...questionStats]
            .filter((q) => q.totalResponses > 0)
            .sort((a, b) => a.correctPercentage - b.correctPercentage)
            .slice(0, 5);
        const averageScore = submitted.length > 0
            ? Math.round((submitted.reduce((sum, s) => sum + Number(s.totalGrade ?? 0), 0) / submitted.length) *
                10) / 10
            : 0;
        const topStudents = [...submitted]
            .sort((a, b) => Number(b.totalGrade ?? 0) - Number(a.totalGrade ?? 0))
            .slice(0, 5);
        const strugglingStudents = [...submitted]
            .sort((a, b) => Number(a.totalGrade ?? 0) - Number(b.totalGrade ?? 0))
            .slice(0, 5);
        const metaRes = await pool_1.default.query(`SELECT c.title AS course_title, l.title AS lecture_title
       FROM lectures l
       JOIN courses c ON c.id = l.course_id
       WHERE l.id = $1`, [exam.lecture_id]);
        const meta = metaRes.rows[0];
        return {
            examKind: 'lecture',
            exam: {
                id: exam.id,
                title: exam.title,
                type: exam.type,
                lectureId: exam.lecture_id,
                lectureTitle: meta?.lecture_title ?? null,
                courseId: exam.course_id,
                courseTitle: meta?.course_title ?? null,
                totalGrade: exam.total_grade,
            },
            participation: {
                totalEnrolled,
                submittedCount: submitted.length,
                notSubmittedCount: notSubmitted.length,
                submissionRate,
                submittedStudents: submitted,
                notSubmittedStudents: notSubmitted,
            },
            performance: {
                averageScore,
                topStudents,
                strugglingStudents,
            },
            questions: questionStats,
            insights: {
                strengths: [
                    submissionRate >= 70 ? `نسبة تسليم جيدة (${submissionRate}%)` : null,
                    strongestQuestions.length
                        ? `أسئلة بفهم جيد: ${strongestQuestions.map((q) => q.questionText?.slice(0, 40) || `سؤال ${q.questionId}`).join(' | ')}`
                        : null,
                    topStudents.length
                        ? `أفضل الطلاب: ${topStudents.map((s) => s.studentName).join('، ')}`
                        : null,
                ].filter(Boolean),
                weaknesses: [
                    notSubmitted.length
                        ? `${notSubmitted.length} طالب لم يُسلّم بعد: ${notSubmitted.map((s) => s.studentName).join('، ')}`
                        : null,
                    weakestQuestions.length
                        ? `أسئلة تحتاج مراجعة: ${weakestQuestions.map((q) => `${q.questionText?.slice(0, 35) || `سؤال ${q.questionId}`} (${q.correctPercentage}%)`).join(' | ')}`
                        : null,
                    submissionRate < 50 ? `نسبة التسليم منخفضة (${submissionRate}%)` : null,
                ].filter(Boolean),
            },
            rawQuestionReport: questionReport,
        };
    }
    static async getCourseExamAnalysis(teacherId, examId) {
        const requester = { id: teacherId, role: 'teacher' };
        const [detailReport, gradesReport] = await Promise.all([
            courseLevelExams_1.CourseLevelExamsService.getExamReport(examId, requester),
            courseLevelExams_1.CourseLevelExamsService.getExamGrades(examId, requester),
        ]);
        const courseId = detailReport.exam.courseId;
        const participationRes = await pool_1.default.query(`SELECT
         u.id AS student_id,
         u.name AS student_name,
         att.id AS attempt_id,
         att.status,
         att.obtained_grade,
         att.total_grade,
         att.submitted_at
       FROM enrollments en
       JOIN users u ON u.id = en.user_id
       LEFT JOIN LATERAL (
         SELECT a.id, a.status, a.obtained_grade, a.total_grade, a.submitted_at
         FROM course_level_exam_attempts a
         WHERE a.exam_id = $2 AND a.student_id = u.id AND a.status = 'submitted'
         ORDER BY a.submitted_at DESC NULLS LAST, a.id DESC
         LIMIT 1
       ) att ON TRUE
       WHERE en.course_id = $1
       ORDER BY u.name ASC`, [courseId, examId]);
        const students = participationRes.rows.map((row) => ({
            studentId: row.student_id,
            studentName: row.student_name,
            submitted: row.attempt_id != null,
            obtainedGrade: row.obtained_grade,
            totalGrade: row.total_grade,
            percentage: row.total_grade > 0
                ? Math.round((Number(row.obtained_grade) / Number(row.total_grade)) * 1000) / 10
                : null,
            submittedAt: row.submitted_at,
        }));
        const submitted = students.filter((s) => s.submitted);
        const notSubmitted = students.filter((s) => !s.submitted);
        const totalEnrolled = students.length;
        const submissionRate = totalEnrolled > 0 ? Math.round((submitted.length / totalEnrolled) * 1000) / 10 : 0;
        const weakestQuestions = [...detailReport.mostProblematicQuestions];
        const strongestQuestions = [...detailReport.questions]
            .filter((q) => q.statistics.totalAnswers > 0)
            .sort((a, b) => b.statistics.correctPercentage - a.statistics.correctPercentage)
            .slice(0, 3)
            .map((q) => ({
            questionId: q.questionId,
            questionText: q.questionText,
            correctPercentage: q.statistics.correctPercentage,
        }));
        return {
            examKind: 'course',
            exam: detailReport.exam,
            overallStatistics: detailReport.overallStatistics,
            participation: {
                totalEnrolled,
                submittedCount: submitted.length,
                notSubmittedCount: notSubmitted.length,
                submissionRate,
                submittedStudents: submitted,
                notSubmittedStudents: notSubmitted,
            },
            grades: gradesReport,
            questions: detailReport.questions,
            insights: {
                strengths: [
                    submissionRate >= 70 ? `نسبة أداء الطلاب في التسليم جيدة (${submissionRate}%)` : null,
                    gradesReport.statistics.averageGrade >= 70
                        ? `متوسط الدرجات مرتفع (${gradesReport.statistics.averageGrade}%)`
                        : null,
                    strongestQuestions.length
                        ? `أسئلة بفهم جيد: ${strongestQuestions.map((q) => q.questionText?.slice(0, 40) || `سؤال ${q.questionId}`).join(' | ')}`
                        : null,
                ].filter(Boolean),
                weaknesses: [
                    notSubmitted.length
                        ? `${notSubmitted.length} طالب لم يمتحن بعد: ${notSubmitted.map((s) => s.studentName).join('، ')}`
                        : null,
                    weakestQuestions.length
                        ? `أصعب الأسئلة: ${weakestQuestions.map((q) => `${q.questionText?.slice(0, 35)} (${q.wrongPercentage}% خطأ)`).join(' | ')}`
                        : null,
                    detailReport.overallStatistics.overallCorrectPercentage < 50
                        ? `نسبة الإجابات الصحيحة منخفضة (${detailReport.overallStatistics.overallCorrectPercentage}%)`
                        : null,
                ].filter(Boolean),
            },
            rawDetailReport: detailReport,
        };
    }
}
exports.DataAnalystExamReportsService = DataAnalystExamReportsService;
