import pool from '../db/pool';

type ScopeInput = {
  tenantId: number;
};

type RangeInput = {
  from?: string;
  to?: string;
};

function resolveRange(range: RangeInput): { from: Date; to: Date } {
  const to = range.to ? new Date(range.to) : new Date();
  const from = range.from ? new Date(range.from) : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  return { from, to };
}

export class AnalyticsIntelligenceService {
  static async getCourseAnalytics(
    scope: ScopeInput,
    courseId: number,
    range: RangeInput,
  ): Promise<Record<string, unknown>> {
    const { from, to } = resolveRange(range);

    const [enrollment, videoStats, completionStats, lectureCompletion, topStudents] = await Promise.all([
      pool.query<{ total_students: string }>(
        `SELECT COUNT(*)::text AS total_students
         FROM enrollments e
         JOIN users u ON u.id = e.user_id
         WHERE e.course_id = $1
           AND u.role = 'student'
           AND u.tenant_id = $2`,
        [courseId, scope.tenantId],
      ),
      pool.query<{
        avg_watch_seconds: string | null;
        total_watch_seconds: string | null;
        avg_completion: string | null;
        completed_sessions: string | null;
      }>(
        `WITH per_student AS (
           SELECT
             e.user_id,
             CASE WHEN COUNT(DISTINCT l.id) = 0 THEN 0
             ELSE ROUND(
               COUNT(DISTINCT CASE
                 WHEN lv.lecture_id IS NOT NULL OR vv.lecture_id IS NOT NULL THEN l.id
               END)::numeric / COUNT(DISTINCT l.id) * 100,
               2
             )
             END AS watch_percentage,
             COALESCE(SUM(vv.watch_duration), 0) AS watch_seconds
           FROM enrollments e
           JOIN users u ON u.id = e.user_id
           JOIN lectures l ON l.course_id = e.course_id
           LEFT JOIN lecture_views lv ON lv.lecture_id = l.id AND lv.user_id = e.user_id
             AND lv.viewed_at BETWEEN $3 AND $4
           LEFT JOIN video_views vv ON vv.lecture_id = l.id AND vv.user_id = e.user_id AND vv.course_id = e.course_id
             AND vv.updated_at BETWEEN $3 AND $4
           WHERE e.course_id = $1
             AND u.role = 'student'
             AND u.tenant_id = $2
           GROUP BY e.user_id
         )
         SELECT
           COALESCE(AVG(watch_seconds), 0)::text AS avg_watch_seconds,
           COALESCE(SUM(watch_seconds), 0)::text AS total_watch_seconds,
           COALESCE(AVG(watch_percentage), 0)::text AS avg_completion,
           '0'::text AS completed_sessions
         FROM per_student`,
        [courseId, scope.tenantId, from, to],
      ),
      pool.query<{ completion_rate: string | null }>(
        `WITH per_student AS (
           SELECT
             e.user_id,
             CASE WHEN COUNT(DISTINCT l.id) = 0 THEN 0
             ELSE ROUND(
               COUNT(DISTINCT CASE
                 WHEN lv.lecture_id IS NOT NULL OR vv.lecture_id IS NOT NULL THEN l.id
               END)::numeric / COUNT(DISTINCT l.id) * 100,
               2
             )
             END AS watch_percentage
           FROM enrollments e
           JOIN users u ON u.id = e.user_id
           JOIN lectures l ON l.course_id = e.course_id
           LEFT JOIN lecture_views lv ON lv.lecture_id = l.id AND lv.user_id = e.user_id
             AND lv.viewed_at BETWEEN $3 AND $4
           LEFT JOIN video_views vv ON vv.lecture_id = l.id AND vv.user_id = e.user_id AND vv.course_id = e.course_id
             AND vv.updated_at BETWEEN $3 AND $4
           WHERE e.course_id = $1
             AND u.role = 'student'
             AND u.tenant_id = $2
           GROUP BY e.user_id
         )
         SELECT COALESCE(AVG(CASE WHEN watch_percentage >= 80 THEN 100 ELSE 0 END), 0)::text AS completion_rate
         FROM per_student`,
        [courseId, scope.tenantId, from, to],
      ),
      pool.query<{
        lecture_id: number;
        lecture_title: string;
        avg_completion: string | null;
      }>(
        `SELECT
           l.id AS lecture_id,
           l.title AS lecture_title,
           CASE WHEN COUNT(DISTINCT e.user_id) = 0 THEN 0
           ELSE ROUND(
             COUNT(DISTINCT CASE
               WHEN lv.lecture_id IS NOT NULL OR vv.lecture_id IS NOT NULL THEN e.user_id
             END)::numeric / COUNT(DISTINCT e.user_id) * 100,
             2
           )
           END::text AS avg_completion
         FROM lectures l
         JOIN enrollments e ON e.course_id = l.course_id
         JOIN users u ON u.id = e.user_id AND u.role = 'student' AND u.tenant_id = $2
         LEFT JOIN lecture_views lv ON lv.lecture_id = l.id AND lv.user_id = e.user_id
           AND lv.viewed_at BETWEEN $3 AND $4
         LEFT JOIN video_views vv ON vv.lecture_id = l.id AND vv.user_id = e.user_id AND vv.course_id = l.course_id
           AND vv.updated_at BETWEEN $3 AND $4
         WHERE l.course_id = $1
         GROUP BY l.id, l.title
         ORDER BY l.position ASC, l.id ASC`,
        [courseId, scope.tenantId, from, to],
      ),
      pool.query<{
        student_id: number;
        student_name: string;
        study_seconds: string | null;
        avg_completion: string | null;
      }>(
        `SELECT
           u.id AS student_id,
           u.name AS student_name,
           COALESCE(SUM(vv.watch_duration), 0)::text AS study_seconds,
           CASE WHEN COUNT(DISTINCT l.id) = 0 THEN '0'
           ELSE ROUND(
             COUNT(DISTINCT CASE
               WHEN lv.lecture_id IS NOT NULL OR vv2.lecture_id IS NOT NULL THEN l.id
             END)::numeric / COUNT(DISTINCT l.id) * 100,
             2
           )::text
           END AS avg_completion
         FROM enrollments e
         JOIN users u ON u.id = e.user_id
         JOIN lectures l ON l.course_id = e.course_id
         LEFT JOIN lecture_views lv ON lv.lecture_id = l.id AND lv.user_id = e.user_id
           AND lv.viewed_at BETWEEN $3 AND $4
         LEFT JOIN video_views vv ON vv.user_id = u.id AND vv.course_id = e.course_id
           AND vv.updated_at BETWEEN $3 AND $4
         LEFT JOIN video_views vv2 ON vv2.lecture_id = l.id AND vv2.user_id = e.user_id
           AND vv2.updated_at BETWEEN $3 AND $4
         WHERE e.course_id = $1
           AND u.role = 'student'
           AND u.tenant_id = $2
         GROUP BY u.id, u.name
         ORDER BY COALESCE(SUM(vv.watch_duration), 0) DESC,
                  CASE WHEN COUNT(DISTINCT l.id) = 0 THEN 0
                  ELSE COUNT(DISTINCT CASE
                    WHEN lv.lecture_id IS NOT NULL OR vv2.lecture_id IS NOT NULL THEN l.id
                  END)::numeric / COUNT(DISTINCT l.id) * 100
                  END DESC
         LIMIT 20`,
        [courseId, scope.tenantId, from, to],
      ),
    ]);

    const avgCompletion = Number(videoStats.rows[0]?.avg_completion ?? 0);
    return {
      course_id: courseId,
      range: { from, to },
      total_students: Number(enrollment.rows[0]?.total_students ?? 0),
      average_study_seconds: Number(videoStats.rows[0]?.avg_watch_seconds ?? 0),
      total_watch_seconds: Number(videoStats.rows[0]?.total_watch_seconds ?? 0),
      average_completion_percentage: avgCompletion,
      course_completion_rate: Number(completionStats.rows[0]?.completion_rate ?? 0),
      drop_off_rate: Math.max(0, Number((100 - avgCompletion).toFixed(2))),
      lecture_completion: lectureCompletion.rows.map((r) => ({
        lecture_id: r.lecture_id,
        lecture_title: r.lecture_title,
        completion_percentage: Number(r.avg_completion ?? 0),
      })),
      top_students: topStudents.rows.map((r, index) => ({
        rank: index + 1,
        student_id: r.student_id,
        student_name: r.student_name,
        study_seconds: Number(r.study_seconds ?? 0),
        completion_percentage: Number(r.avg_completion ?? 0),
      })),
    };
  }

  static async getLectureAnalytics(
    scope: ScopeInput,
    lectureId: number,
    range: RangeInput,
  ): Promise<Record<string, unknown>> {
    const { from, to } = resolveRange(range);
    const [stats, replayHeatmap, skipHeatmap] = await Promise.all([
      pool.query<{
        lecture_id: number;
        lecture_title: string;
        total_views: string | null;
        unique_views: string | null;
        avg_watch_seconds: string | null;
        completion_percentage: string | null;
      }>(
        `SELECT
           l.id AS lecture_id,
           l.title AS lecture_title,
           COALESCE(COUNT(vv.id), 0)::text AS total_views,
           COALESCE(COUNT(DISTINCT vv.user_id), 0)::text AS unique_views,
           COALESCE(AVG(vv.watch_duration), 0)::text AS avg_watch_seconds,
           COALESCE((
             SELECT AVG(per_user.watch_pct)
             FROM (
               SELECT
                 CASE WHEN lecture_total.total_videos = 0 THEN 0
                 ELSE ROUND(
                   COUNT(DISTINCT vv2.video_id)::numeric / lecture_total.total_videos * 100,
                   2
                 )
                 END AS watch_pct
               FROM video_views vv2
               CROSS JOIN (
                 SELECT COUNT(*)::numeric AS total_videos
                 FROM lecture_videos
                 WHERE lecture_id = l.id
               ) lecture_total
               WHERE vv2.lecture_id = l.id
                 AND vv2.updated_at BETWEEN $2 AND $3
               GROUP BY vv2.user_id, lecture_total.total_videos
             ) per_user
           ), 0)::text AS completion_percentage
         FROM lectures l
         LEFT JOIN video_views vv ON vv.lecture_id = l.id
           AND vv.updated_at BETWEEN $2 AND $3
         LEFT JOIN users u ON u.id = vv.user_id
         WHERE l.id = $1
           AND (u.id IS NULL OR u.tenant_id = $4)
         GROUP BY l.id, l.title`,
        [lectureId, from, to, scope.tenantId],
      ),
      pool.query<{ bucket_second: number; replay_count: string }>(
        `SELECT
           (COALESCE(to_second, 0) / 30) * 30 AS bucket_second,
           COUNT(*)::text AS replay_count
         FROM analytics_watch_events
         WHERE tenant_id = $1
           AND event_type = 'seek'
           AND to_second IS NOT NULL
           AND from_second IS NOT NULL
           AND to_second < from_second
           AND event_at BETWEEN $2 AND $3
           AND session_id IN (
             SELECT id FROM analytics_video_sessions
             WHERE lecture_id = $4
           )
         GROUP BY bucket_second
         ORDER BY bucket_second`,
        [scope.tenantId, from, to, lectureId],
      ),
      pool.query<{ bucket_second: number; skip_count: string }>(
        `SELECT
           (COALESCE(from_second, 0) / 30) * 30 AS bucket_second,
           COUNT(*)::text AS skip_count
         FROM analytics_watch_events
         WHERE tenant_id = $1
           AND event_type = 'seek'
           AND to_second IS NOT NULL
           AND from_second IS NOT NULL
           AND to_second > from_second
           AND event_at BETWEEN $2 AND $3
           AND session_id IN (
             SELECT id FROM analytics_video_sessions
             WHERE lecture_id = $4
           )
         GROUP BY bucket_second
         ORDER BY bucket_second`,
        [scope.tenantId, from, to, lectureId],
      ),
    ]);

    const row = stats.rows[0];
    return {
      lecture_id: lectureId,
      range: { from, to },
      lecture_title: row?.lecture_title ?? null,
      total_views: Number(row?.total_views ?? 0),
      unique_views: Number(row?.unique_views ?? 0),
      average_watch_seconds: Number(row?.avg_watch_seconds ?? 0),
      completion_percentage: Number(row?.completion_percentage ?? 0),
      replay_heatmap: replayHeatmap.rows.map((r) => ({
        second: r.bucket_second,
        replay_count: Number(r.replay_count),
      })),
      skip_analytics: skipHeatmap.rows.map((r) => ({
        second: r.bucket_second,
        skip_count: Number(r.skip_count),
      })),
    };
  }

  static async getStudentAnalytics(
    scope: ScopeInput,
    studentId: number,
    range: RangeInput,
  ): Promise<Record<string, unknown>> {
    const { from, to } = resolveRange(range);
    const [profile, lectureStats, weeklyActivity, examStats] = await Promise.all([
      pool.query<{ id: number; name: string; created_at: Date; last_activity: Date | null }>(
        `SELECT
           u.id, u.name, u.created_at,
           (
             SELECT MAX(a.occurred_at)
             FROM analytics_student_activity_logs a
             WHERE a.student_id = u.id AND a.tenant_id = $2
           ) AS last_activity
         FROM users u
         WHERE u.id = $1
           AND u.role = 'student'
           AND u.tenant_id = $2
         LIMIT 1`,
        [studentId, scope.tenantId],
      ),
      pool.query<{
        lecture_id: number;
        lecture_title: string;
        watch_count: string;
        watched_seconds: string | null;
        completed: boolean;
      }>(
        `SELECT
           l.id AS lecture_id,
           l.title AS lecture_title,
           COUNT(vv.id)::text AS watch_count,
           COALESCE(SUM(vv.watch_duration), 0)::text AS watched_seconds,
           COALESCE(BOOL_OR(vv.is_completed), false) AS completed
         FROM video_views vv
         JOIN lectures l ON l.id = vv.lecture_id
         WHERE vv.user_id = $1
           AND vv.updated_at BETWEEN $2 AND $3
         GROUP BY l.id, l.title
         ORDER BY MAX(vv.updated_at) DESC`,
        [studentId, from, to],
      ),
      pool.query<{ active_days: string }>(
        `SELECT COUNT(DISTINCT DATE(occurred_at))::text AS active_days
         FROM analytics_student_activity_logs
         WHERE tenant_id = $1
           AND student_id = $2
           AND occurred_at >= NOW() - INTERVAL '7 days'`,
        [scope.tenantId, studentId],
      ),
      pool.query<{
        attempts: string;
        avg_percentage: string | null;
        passed_attempts: string;
      }>(
        `SELECT
           COUNT(*)::text AS attempts,
           COALESCE(AVG(CASE WHEN total_grade > 0 THEN (COALESCE(score, 0) * 100.0 / total_grade) ELSE NULL END), 0)::text AS avg_percentage,
           COALESCE(SUM(CASE WHEN passed = true THEN 1 ELSE 0 END), 0)::text AS passed_attempts
         FROM analytics_exam_attempt_facts
         WHERE tenant_id = $1
           AND student_id = $2
           AND created_at BETWEEN $3 AND $4`,
        [scope.tenantId, studentId, from, to],
      ),
    ]);

    const student = profile.rows[0];
    const activeDays = Number(weeklyActivity.rows[0]?.active_days ?? 0);
    return {
      student: student
        ? {
            id: student.id,
            name: student.name,
            created_at: student.created_at,
            last_activity: student.last_activity,
          }
        : null,
      range: { from, to },
      lectures: lectureStats.rows.map((r) => ({
        lecture_id: r.lecture_id,
        lecture_title: r.lecture_title,
        watch_count: Number(r.watch_count),
        watched_seconds: Number(r.watched_seconds ?? 0),
        completed: r.completed,
      })),
      weekly_commitment: {
        active_days: activeDays,
        absence_days: Math.max(0, 7 - activeDays),
        attendance_rate: Number(((activeDays / 7) * 100).toFixed(2)),
      },
      exam_performance: {
        attempts: Number(examStats.rows[0]?.attempts ?? 0),
        average_percentage: Number(examStats.rows[0]?.avg_percentage ?? 0),
        pass_count: Number(examStats.rows[0]?.passed_attempts ?? 0),
      },
    };
  }

  static async getExamAnalytics(
    scope: ScopeInput,
    examId: number,
    range: RangeInput,
  ): Promise<Record<string, unknown>> {
    const { from, to } = resolveRange(range);

    const legacyStats = await pool.query<{
      attempts: string;
      avg_score: string | null;
      max_score: string | null;
      min_score: string | null;
      pass_count: string;
      avg_duration_seconds: string | null;
    }>(
      `SELECT
         COUNT(*)::text AS attempts,
         COALESCE(AVG(es.total_grade), 0)::text AS avg_score,
         COALESCE(MAX(es.total_grade), 0)::text AS max_score,
         COALESCE(MIN(es.total_grade), 0)::text AS min_score,
         COALESCE(SUM(CASE WHEN es.passed THEN 1 ELSE 0 END), 0)::text AS pass_count,
         COALESCE(AVG(EXTRACT(EPOCH FROM (COALESCE(es.submitted_at, NOW()) - COALESCE(es.attempt_start_time, es.submitted_at)))), 0)::text AS avg_duration_seconds
       FROM exam_submissions es
       JOIN users u ON u.id = es.student_id
       WHERE es.exam_id = $1
         AND u.tenant_id = $2
         AND es.submitted_at BETWEEN $3 AND $4`,
      [examId, scope.tenantId, from, to],
    );

    const r = legacyStats.rows[0];
    const attempts = Number(r?.attempts ?? 0);
    const passCount = Number(r?.pass_count ?? 0);
    return {
      exam_id: examId,
      range: { from, to },
      attempts,
      average_score: Number(r?.avg_score ?? 0),
      max_score: Number(r?.max_score ?? 0),
      min_score: Number(r?.min_score ?? 0),
      success_rate: attempts ? Number(((passCount / attempts) * 100).toFixed(2)) : 0,
      failure_rate: attempts ? Number((((attempts - passCount) / attempts) * 100).toFixed(2)) : 0,
      average_duration_seconds: Number(r?.avg_duration_seconds ?? 0),
    };
  }

  static async getDifficultQuestions(scope: ScopeInput, limit = 20): Promise<Record<string, unknown>[]> {
    const result = await pool.query<{
      question_id: number;
      question_text: string;
      attempts: string;
      wrong_count: string;
      error_rate: string;
    }>(
      `SELECT
         eq.id AS question_id,
         eq.question_text,
         COUNT(ea.id)::text AS attempts,
         SUM(CASE WHEN COALESCE(ea.is_correct, false) = false THEN 1 ELSE 0 END)::text AS wrong_count,
         ROUND(
           SUM(CASE WHEN COALESCE(ea.is_correct, false) = false THEN 1 ELSE 0 END) * 100.0
           / NULLIF(COUNT(ea.id), 0),
           2
         )::text AS error_rate
       FROM exam_answers ea
       JOIN exam_questions eq ON eq.id = ea.question_id
       JOIN exam_submissions es ON es.id = ea.submission_id
       JOIN users u ON u.id = es.student_id
       WHERE u.tenant_id = $1
       GROUP BY eq.id, eq.question_text
       HAVING COUNT(ea.id) >= 5
       ORDER BY
         ROUND(
           SUM(CASE WHEN COALESCE(ea.is_correct, false) = false THEN 1 ELSE 0 END) * 100.0
           / NULLIF(COUNT(ea.id), 0),
           2
         ) DESC NULLS LAST,
         COUNT(ea.id) DESC
       LIMIT $2`,
      [scope.tenantId, limit],
    );
    return result.rows.map((r) => ({
      question_id: r.question_id,
      question_text: r.question_text,
      attempts: Number(r.attempts),
      wrong_count: Number(r.wrong_count),
      error_rate: Number(r.error_rate ?? 0),
    }));
  }

  static async getTopStudents(scope: ScopeInput, limit = 20): Promise<Record<string, unknown>[]> {
    const result = await pool.query<{
      student_id: number;
      student_name: string;
      total_watch_seconds: string;
      avg_completion: string | null;
      avg_exam_percentage: string | null;
    }>(
      `WITH watch AS (
         SELECT
           vv.user_id AS student_id,
           COALESCE(SUM(vv.watch_duration), 0) AS total_watch_seconds,
           COALESCE(AVG(vv.completion_percentage), 0) AS avg_completion
         FROM video_views vv
         JOIN users u ON u.id = vv.user_id
         WHERE u.tenant_id = $1
         GROUP BY vv.user_id
       ),
       exams AS (
         SELECT
           a.student_id,
           COALESCE(AVG(CASE WHEN a.total_grade > 0 THEN (COALESCE(a.score, 0) * 100.0 / a.total_grade) ELSE NULL END), 0) AS avg_exam_percentage
         FROM analytics_exam_attempt_facts a
         WHERE a.tenant_id = $1
         GROUP BY a.student_id
       )
       SELECT
         u.id AS student_id,
         u.name AS student_name,
         COALESCE(w.total_watch_seconds, 0)::text AS total_watch_seconds,
         COALESCE(w.avg_completion, 0)::text AS avg_completion,
         COALESCE(e.avg_exam_percentage, 0)::text AS avg_exam_percentage
       FROM users u
       LEFT JOIN watch w ON w.student_id = u.id
       LEFT JOIN exams e ON e.student_id = u.id
       WHERE u.role = 'student'
         AND u.tenant_id = $1
       ORDER BY
         COALESCE(e.avg_exam_percentage, 0) DESC,
         COALESCE(w.avg_completion, 0) DESC,
         COALESCE(w.total_watch_seconds, 0) DESC
       LIMIT $2`,
      [scope.tenantId, limit],
    );
    return result.rows.map((r, index) => ({
      rank: index + 1,
      student_id: r.student_id,
      student_name: r.student_name,
      total_watch_seconds: Number(r.total_watch_seconds),
      completion_percentage: Number(r.avg_completion ?? 0),
      exam_percentage: Number(r.avg_exam_percentage ?? 0),
    }));
  }

  static async getAtRiskStudents(scope: ScopeInput, limit = 20): Promise<Record<string, unknown>[]> {
    const result = await pool.query<{
      student_id: number;
      student_name: string;
      inactivity_days: string;
      completion_percentage: string;
      exam_percentage: string;
      risk_score: string;
    }>(
      `WITH latest_activity AS (
         SELECT
           u.id AS student_id,
           MAX(a.occurred_at) AS last_activity
         FROM users u
         LEFT JOIN analytics_student_activity_logs a
           ON a.student_id = u.id
           AND a.tenant_id = $1
         WHERE u.role = 'student' AND u.tenant_id = $1
         GROUP BY u.id
       ),
       completion AS (
         SELECT
           vv.user_id AS student_id,
           COALESCE(AVG(vv.completion_percentage), 0) AS completion_percentage
         FROM video_views vv
         JOIN users u ON u.id = vv.user_id
         WHERE u.tenant_id = $1
         GROUP BY vv.user_id
       ),
       exams AS (
         SELECT
           a.student_id,
           COALESCE(AVG(CASE WHEN a.total_grade > 0 THEN (COALESCE(a.score, 0) * 100.0 / a.total_grade) ELSE NULL END), 0) AS exam_percentage
         FROM analytics_exam_attempt_facts a
         WHERE a.tenant_id = $1
         GROUP BY a.student_id
       ),
       ranked AS (
         SELECT
           u.id AS student_id,
           u.name AS student_name,
           COALESCE(DATE_PART('day', NOW() - la.last_activity), 999)::text AS inactivity_days,
           COALESCE(c.completion_percentage, 0)::text AS completion_percentage,
           COALESCE(e.exam_percentage, 0)::text AS exam_percentage,
           (
             LEAST(100, COALESCE(DATE_PART('day', NOW() - la.last_activity), 30) * 2)
             + (100 - COALESCE(c.completion_percentage, 0)) * 0.4
             + (100 - COALESCE(e.exam_percentage, 0)) * 0.6
           )::text AS risk_score
         FROM users u
         LEFT JOIN latest_activity la ON la.student_id = u.id
         LEFT JOIN completion c ON c.student_id = u.id
         LEFT JOIN exams e ON e.student_id = u.id
         WHERE u.role = 'student'
           AND u.tenant_id = $1
       )
       SELECT
         student_id,
         student_name,
         inactivity_days,
         completion_percentage,
         exam_percentage,
         risk_score
       FROM ranked
       ORDER BY risk_score::numeric DESC
       LIMIT $2`,
      [scope.tenantId, limit],
    );

    return result.rows.map((r) => ({
      student_id: r.student_id,
      student_name: r.student_name,
      inactivity_days: Number(r.inactivity_days),
      completion_percentage: Number(r.completion_percentage),
      exam_percentage: Number(r.exam_percentage),
      risk_score: Number(r.risk_score),
    }));
  }

  static async getPerformanceSummary(scope: ScopeInput): Promise<Record<string, unknown>> {
    const [students, activeWeekly, completion, difficultQuestions] = await Promise.all([
      pool.query<{ total_students: string }>(
        `SELECT COUNT(*)::text AS total_students
         FROM users
         WHERE role = 'student'
           AND tenant_id = $1`,
        [scope.tenantId],
      ),
      pool.query<{ active_students: string }>(
        `SELECT COUNT(DISTINCT student_id)::text AS active_students
         FROM analytics_student_activity_logs
         WHERE tenant_id = $1
           AND occurred_at >= NOW() - INTERVAL '7 days'`,
        [scope.tenantId],
      ),
      pool.query<{ avg_completion: string | null }>(
        `SELECT COALESCE(AVG(completion_percentage), 0)::text AS avg_completion
         FROM video_views vv
         JOIN users u ON u.id = vv.user_id
         WHERE u.tenant_id = $1`,
        [scope.tenantId],
      ),
      this.getDifficultQuestions(scope, 5),
    ]);

    const totalStudents = Number(students.rows[0]?.total_students ?? 0);
    const activeStudents = Number(activeWeekly.rows[0]?.active_students ?? 0);
    return {
      total_students: totalStudents,
      active_students_weekly: activeStudents,
      weekly_engagement_rate: totalStudents
        ? Number(((activeStudents / totalStudents) * 100).toFixed(2))
        : 0,
      average_completion_percentage: Number(completion.rows[0]?.avg_completion ?? 0),
      difficult_questions_top5: difficultQuestions,
    };
  }
}
