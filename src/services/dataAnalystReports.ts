import pool from '../db/pool';
import { HttpError } from '../utils';
import { TeacherDailyCourseReportService } from './teacherDailyCourseReport';
import { TeacherReportsService } from './teacherReports';
import { AnalyticsIntelligenceService } from './analyticsIntelligence';
import { getCourseAverageWatchPercentage } from './watchProgress';
export type TeacherOverviewReport = {
  teacher_id: number;
  total_students: number;
  total_courses: number;
  average_watch_percentage: number;
  average_exam_percentage: number;
  courses: Array<{
    course_id: number;
    course_title: string;
    enrolled_students: number;
    average_watch_percentage: number;
  }>;
  top_students: Array<{
    rank: number;
    student_id: number;
    student_name: string;
    courses_count: number;
    watch_percentage: number;
    exam_percentage: number;
  }>;
  at_risk_students: Array<{
    student_id: number;
    student_name: string;
    inactivity_days: number;
    watch_percentage: number;
    exam_percentage: number;
    risk_score: number;
  }>;
  generated_at: string;
};

export class DataAnalystReportsService {
  static async verifyTeacherOwnsCourse(teacherId: number, courseId: number): Promise<boolean> {
    const r = await pool.query(
      `SELECT 1 FROM courses WHERE id = $1 AND teacher_id = $2 LIMIT 1`,
      [courseId, teacherId],
    );
    return Boolean(r.rowCount);
  }

  static async getTeacherCourses(teacherId: number) {
    const r = await pool.query<{ id: number; title: string; enrolled_students: string }>(
      `SELECT c.id, c.title,
              COUNT(DISTINCT e.user_id)::text AS enrolled_students
       FROM courses c
       LEFT JOIN enrollments e ON e.course_id = c.id
       WHERE c.teacher_id = $1
       GROUP BY c.id, c.title
       ORDER BY c.created_at DESC`,
      [teacherId],
    );
    return r.rows.map((row) => ({
      course_id: row.id,
      course_title: row.title,
      enrolled_students: Number(row.enrolled_students ?? 0),
    }));
  }

  static async findCoursesByName(
    teacherId: number,
    name: string,
  ): Promise<{ id: number; title: string; enrolled_students: string }[]> {
    const trimmed = (name || '').trim();
    if (!trimmed) return [];
    const result = await pool.query(
      `SELECT c.id, c.title, COUNT(DISTINCT e.user_id)::text AS enrolled_students
       FROM courses c
       LEFT JOIN enrollments e ON e.course_id = c.id
       WHERE c.teacher_id = $1 AND c.title ILIKE $2
       GROUP BY c.id, c.title
       ORDER BY c.title ASC
       LIMIT 20`,
      [teacherId, `%${trimmed}%`],
    );
    return result.rows;
  }

  static async getCourseReportByName(
    teacherId: number,
    name: string,
    tenantId: number,
  ): Promise<
    | { report: Awaited<ReturnType<typeof DataAnalystReportsService.getCourseReport>>; course_id: number }
    | {
        matches: { id: number; title: string; enrolled_students: string }[];
        message: string;
      }
  > {
    const matches = await this.findCoursesByName(teacherId, name);
    if (matches.length === 0) {
      throw new HttpError(404, 'لا يوجد كورس بهذا الاسم');
    }
    if (matches.length > 1) {
      return {
        matches: matches.map((m) => ({
          id: m.id,
          title: m.title,
          enrolled_students: m.enrolled_students,
        })),
        message:
          'وجد أكثر من كورس بهذا الاسم. أرسل كود الكورس (id) أو جزءاً أدق من الاسم لتحديد الكورس.',
      };
    }
    const report = await this.getCourseReport(teacherId, matches[0].id, tenantId);
    return { report, course_id: matches[0].id };
  }

  static async getTeacherOverviewReport(teacherId: number, tenantId: number): Promise<TeacherOverviewReport> {
    const [courses, topStudentsRaw, atRiskRaw, aggregates] = await Promise.all([
      this.getTeacherCourses(teacherId),
      pool.query<{
        student_id: number;
        student_name: string;
        courses_count: string;
        watch_percentage: string | null;
        exam_percentage: string | null;
      }>(
        `WITH teacher_students AS (
           SELECT DISTINCT u.id, u.name
           FROM users u
           JOIN enrollments e ON e.user_id = u.id
           JOIN courses c ON c.id = e.course_id
           WHERE c.teacher_id = $1 AND u.role = 'student'
         ),
         watch AS (
           SELECT e.user_id AS student_id,
                  CASE WHEN COUNT(DISTINCT l.id) = 0 THEN 0
                  ELSE ROUND(
                    COUNT(DISTINCT CASE
                      WHEN lv.lecture_id IS NOT NULL OR vv.lecture_id IS NOT NULL THEN l.id
                    END)::numeric / COUNT(DISTINCT l.id) * 100,
                    2
                  )
                  END AS watch_percentage
           FROM enrollments e
           JOIN courses c ON c.id = e.course_id
           JOIN lectures l ON l.course_id = c.id
           LEFT JOIN lecture_views lv ON lv.lecture_id = l.id AND lv.user_id = e.user_id
           LEFT JOIN video_views vv ON vv.lecture_id = l.id AND vv.user_id = e.user_id AND vv.course_id = c.id
           WHERE c.teacher_id = $1
           GROUP BY e.user_id
         ),
         exams AS (
           SELECT es.student_id,
                  COALESCE(AVG(CASE WHEN ex.total_grade > 0 THEN (es.total_grade * 100.0 / ex.total_grade) ELSE NULL END), 0) AS exam_percentage
           FROM exam_submissions es
           JOIN exams ex ON ex.id = es.exam_id
           JOIN lectures l ON l.id = ex.lecture_id
           JOIN courses c ON c.id = l.course_id
           WHERE c.teacher_id = $1
           GROUP BY es.student_id
         ),
         course_counts AS (
           SELECT e.user_id AS student_id, COUNT(DISTINCT e.course_id)::int AS courses_count
           FROM enrollments e
           JOIN courses c ON c.id = e.course_id
           WHERE c.teacher_id = $1
           GROUP BY e.user_id
         )
         SELECT ts.id AS student_id,
                ts.name AS student_name,
                COALESCE(cc.courses_count, 0)::text AS courses_count,
                COALESCE(w.watch_percentage, 0)::text AS watch_percentage,
                COALESCE(ex.exam_percentage, 0)::text AS exam_percentage
         FROM teacher_students ts
         LEFT JOIN course_counts cc ON cc.student_id = ts.id
         LEFT JOIN watch w ON w.student_id = ts.id
         LEFT JOIN exams ex ON ex.student_id = ts.id
         ORDER BY COALESCE(ex.exam_percentage, 0) DESC,
                  COALESCE(w.watch_percentage, 0) DESC
         LIMIT 10`,
        [teacherId],
      ),
      pool.query<{
        student_id: number;
        student_name: string;
        inactivity_days: string;
        watch_percentage: string;
        exam_percentage: string;
        risk_score: string;
      }>(
        `WITH teacher_students AS (
           SELECT DISTINCT u.id, u.name
           FROM users u
           JOIN enrollments e ON e.user_id = u.id
           JOIN courses c ON c.id = e.course_id
           WHERE c.teacher_id = $1 AND u.role = 'student'
         ),
         latest_activity AS (
           SELECT ts.id AS student_id, MAX(a.occurred_at) AS last_activity
           FROM teacher_students ts
           LEFT JOIN analytics_student_activity_logs a
             ON a.student_id = ts.id AND a.tenant_id = $2
           GROUP BY ts.id
         ),
         watch AS (
           SELECT e.user_id AS student_id,
                  CASE WHEN COUNT(DISTINCT l.id) = 0 THEN 0
                  ELSE ROUND(
                    COUNT(DISTINCT CASE
                      WHEN lv.lecture_id IS NOT NULL OR vv.lecture_id IS NOT NULL THEN l.id
                    END)::numeric / COUNT(DISTINCT l.id) * 100,
                    2
                  )
                  END AS watch_percentage
           FROM enrollments e
           JOIN courses c ON c.id = e.course_id
           JOIN lectures l ON l.course_id = c.id
           LEFT JOIN lecture_views lv ON lv.lecture_id = l.id AND lv.user_id = e.user_id
           LEFT JOIN video_views vv ON vv.lecture_id = l.id AND vv.user_id = e.user_id AND vv.course_id = c.id
           WHERE c.teacher_id = $1
           GROUP BY e.user_id
         ),
         exams AS (
           SELECT es.student_id,
                  COALESCE(AVG(CASE WHEN ex.total_grade > 0 THEN (es.total_grade * 100.0 / ex.total_grade) ELSE NULL END), 0) AS exam_percentage
           FROM exam_submissions es
           JOIN exams ex ON ex.id = es.exam_id
           JOIN lectures l ON l.id = ex.lecture_id
           JOIN courses c ON c.id = l.course_id
           WHERE c.teacher_id = $1
           GROUP BY es.student_id
         )
         SELECT ranked.student_id,
                ranked.student_name,
                ranked.inactivity_days,
                ranked.watch_percentage,
                ranked.exam_percentage,
                ranked.risk_score
         FROM (
           SELECT ts.id AS student_id,
                  ts.name AS student_name,
                  COALESCE(DATE_PART('day', NOW() - la.last_activity), 999)::text AS inactivity_days,
                  COALESCE(w.watch_percentage, 0)::text AS watch_percentage,
                  COALESCE(ex.exam_percentage, 0)::text AS exam_percentage,
                  (
                    LEAST(100, COALESCE(DATE_PART('day', NOW() - la.last_activity), 30) * 2)
                    + (100 - COALESCE(w.watch_percentage, 0)) * 0.4
                    + (100 - COALESCE(ex.exam_percentage, 0)) * 0.6
                  )::text AS risk_score
           FROM teacher_students ts
           LEFT JOIN latest_activity la ON la.student_id = ts.id
           LEFT JOIN watch w ON w.student_id = ts.id
           LEFT JOIN exams ex ON ex.student_id = ts.id
         ) ranked
         ORDER BY ranked.risk_score::numeric DESC
         LIMIT 10`,
        [teacherId, tenantId],
      ),
      pool.query<{
        total_students: string;
        average_watch: string | null;
        average_exam: string | null;
      }>(
        `WITH teacher_students AS (
           SELECT DISTINCT u.id
           FROM users u
           JOIN enrollments e ON e.user_id = u.id
           JOIN courses c ON c.id = e.course_id
           WHERE c.teacher_id = $1 AND u.role = 'student'
         )
         SELECT
           (SELECT COUNT(*)::text FROM teacher_students) AS total_students,
           (
             SELECT COALESCE(AVG(per_student.watch_percentage), 0)::text
             FROM (
               SELECT e.user_id,
                      CASE WHEN COUNT(DISTINCT l.id) = 0 THEN 0
                      ELSE ROUND(
                        COUNT(DISTINCT CASE
                          WHEN lv.lecture_id IS NOT NULL OR vv.lecture_id IS NOT NULL THEN l.id
                        END)::numeric / COUNT(DISTINCT l.id) * 100,
                        2
                      )
                      END AS watch_percentage
               FROM enrollments e
               JOIN courses c ON c.id = e.course_id
               JOIN lectures l ON l.course_id = c.id
               LEFT JOIN lecture_views lv ON lv.lecture_id = l.id AND lv.user_id = e.user_id
               LEFT JOIN video_views vv ON vv.lecture_id = l.id AND vv.user_id = e.user_id
               WHERE c.teacher_id = $1
               GROUP BY e.user_id
             ) per_student
           ) AS average_watch,
           (
             SELECT COALESCE(AVG(CASE WHEN ex.total_grade > 0 THEN (es.total_grade * 100.0 / ex.total_grade) ELSE NULL END), 0)::text
             FROM exam_submissions es
             JOIN exams ex ON ex.id = es.exam_id
             JOIN lectures l ON l.id = ex.lecture_id
             JOIN courses c ON c.id = l.course_id
             WHERE c.teacher_id = $1
           ) AS average_exam`,
        [teacherId],
      ),
    ]);

    const coursesWithWatch = await Promise.all(
      courses.map(async (course) => ({
        ...course,
        average_watch_percentage: await getCourseAverageWatchPercentage(course.course_id),
      })),
    );

    return {
      teacher_id: teacherId,
      total_students: Number(aggregates.rows[0]?.total_students ?? 0),
      total_courses: courses.length,
      average_watch_percentage: Number(aggregates.rows[0]?.average_watch ?? 0),
      average_exam_percentage: Number(aggregates.rows[0]?.average_exam ?? 0),
      courses: coursesWithWatch,
      top_students: topStudentsRaw.rows.map((row, index) => ({
        rank: index + 1,
        student_id: row.student_id,
        student_name: row.student_name,
        courses_count: Number(row.courses_count ?? 0),
        watch_percentage: Number(row.watch_percentage ?? 0),
        exam_percentage: Number(row.exam_percentage ?? 0),
      })),
      at_risk_students: atRiskRaw.rows.map((row) => ({
        student_id: row.student_id,
        student_name: row.student_name,
        inactivity_days: Number(row.inactivity_days),
        watch_percentage: Number(row.watch_percentage),
        exam_percentage: Number(row.exam_percentage),
        risk_score: Number(row.risk_score),
      })),
      generated_at: new Date().toISOString(),
    };
  }

  static async getStudentReport(teacherId: number, studentId: number) {
    return TeacherReportsService.getStudentDetailedReport(teacherId, studentId);
  }

  static async getStudentReportByName(teacherId: number, name: string) {
    return TeacherReportsService.getStudentReportByName(teacherId, name);
  }

  static async getCourseReport(teacherId: number, courseId: number, tenantId: number) {
    const owns = await this.verifyTeacherOwnsCourse(teacherId, courseId);
    if (!owns) throw new HttpError(404, 'الكورس غير موجود أو لا يخصك');

    const [dailyReport, analytics] = await Promise.all([
      TeacherDailyCourseReportService.getReportForCourse(teacherId, courseId),
      AnalyticsIntelligenceService.getCourseAnalytics({ tenantId }, courseId, {}),
    ]);

    return { daily_report: dailyReport, analytics };
  }

  static async getGeneralReport(teacherId: number, tenantId: number) {
    const [overview, courseReports] = await Promise.all([
      this.getTeacherOverviewReport(teacherId, tenantId),
      TeacherDailyCourseReportService.getReports(teacherId),
    ]);
    return { overview, course_reports: courseReports };
  }
}
