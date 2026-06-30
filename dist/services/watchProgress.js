"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncLectureWatchCompletion = syncLectureWatchCompletion;
exports.getStudentCourseWatchPercentage = getStudentCourseWatchPercentage;
exports.getCourseAverageWatchPercentage = getCourseAverageWatchPercentage;
exports.getStudentLectureWatchPercentage = getStudentLectureWatchPercentage;
const pool_1 = __importDefault(require("../db/pool"));
/**
 * يحدّث completion_percentage لكل فيديوهات المحاضرة بناءً على عدد الفيديوهات المشاهدة فعلياً.
 * يُستدعى بعد تسجيل مشاهدة جديدة حتى تعكس التقارير والتحليلات التقدم الحقيقي.
 */
async function syncLectureWatchCompletion(userId, lectureId) {
    const counts = await pool_1.default.query(`SELECT
       (SELECT COUNT(*)::text FROM lecture_videos WHERE lecture_id = $2) AS total,
       (SELECT COUNT(DISTINCT vv.video_id)::text
        FROM video_views vv
        WHERE vv.user_id = $1 AND vv.lecture_id = $2) AS watched`, [userId, lectureId]);
    const total = parseInt(counts.rows[0]?.total ?? '0', 10);
    const watched = parseInt(counts.rows[0]?.watched ?? '0', 10);
    const percentage = total > 0
        ? Math.round((watched / total) * 10000) / 100
        : watched > 0
            ? 100
            : 0;
    const isLectureCompleted = total > 0 && watched >= total;
    await pool_1.default.query(`UPDATE video_views
     SET completion_percentage = GREATEST(completion_percentage, $3),
         is_completed = CASE WHEN $4 THEN true ELSE is_completed END,
         updated_at = NOW()
     WHERE user_id = $1 AND lecture_id = $2`, [userId, lectureId, percentage, isLectureCompleted]);
    return percentage;
}
/** نسبة مشاهدة الكورس للطالب = محاضرات بها مشاهدة / إجمالي المحاضرات */
async function getStudentCourseWatchPercentage(userId, courseId) {
    const result = await pool_1.default.query(`SELECT
       CASE WHEN COUNT(DISTINCT l.id) = 0 THEN 0
       ELSE ROUND(
         COUNT(DISTINCT CASE
           WHEN lv.lecture_id IS NOT NULL OR vv.lecture_id IS NOT NULL THEN l.id
         END)::numeric / COUNT(DISTINCT l.id) * 100,
         2
       )
       END::text AS watch_percentage
     FROM lectures l
     LEFT JOIN lecture_views lv ON lv.lecture_id = l.id AND lv.user_id = $1
     LEFT JOIN video_views vv ON vv.lecture_id = l.id AND vv.user_id = $1
     WHERE l.course_id = $2`, [userId, courseId]);
    return Number(result.rows[0]?.watch_percentage ?? 0);
}
/** متوسط نسبة مشاهدة الكورس لكل الطلاب المسجلين */
async function getCourseAverageWatchPercentage(courseId) {
    const result = await pool_1.default.query(`WITH enrolled AS (
       SELECT e.user_id
       FROM enrollments e
       WHERE e.course_id = $1
     ),
     per_student AS (
       SELECT
         en.user_id,
         CASE WHEN COUNT(DISTINCT l.id) = 0 THEN 0
         ELSE ROUND(
           COUNT(DISTINCT CASE
             WHEN lv.lecture_id IS NOT NULL OR vv.lecture_id IS NOT NULL THEN l.id
           END)::numeric / COUNT(DISTINCT l.id) * 100,
           2
         )
         END AS watch_percentage
       FROM enrolled en
       JOIN lectures l ON l.course_id = $1
       LEFT JOIN lecture_views lv ON lv.lecture_id = l.id AND lv.user_id = en.user_id
       LEFT JOIN video_views vv ON vv.lecture_id = l.id AND vv.user_id = en.user_id
       GROUP BY en.user_id
     )
     SELECT COALESCE(AVG(watch_percentage), 0)::text AS avg_watch
     FROM per_student`, [courseId]);
    return Number(result.rows[0]?.avg_watch ?? 0);
}
/** نسبة مشاهدة محاضرة لطالب واحد */
async function getStudentLectureWatchPercentage(userId, lectureId) {
    const result = await pool_1.default.query(`SELECT
       CASE WHEN COUNT(lv.id) = 0 THEN 0
       ELSE ROUND(
         COUNT(DISTINCT CASE WHEN vv.user_id IS NOT NULL THEN vv.video_id END)::numeric
         / COUNT(lv.id) * 100,
         2
       )
       END::text AS watch_percentage
     FROM lecture_videos lv
     LEFT JOIN video_views vv ON vv.video_id = lv.id AND vv.user_id = $1
     WHERE lv.lecture_id = $2`, [userId, lectureId]);
    return Number(result.rows[0]?.watch_percentage ?? 0);
}
