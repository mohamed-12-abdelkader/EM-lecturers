import pool from '../db/pool';
import { HttpError } from '../utils';
import { CourseAccessControl } from './courseAccessControl';
import { CourseGroupAccessService } from './courseGroupAccess';
import {
  PARTIAL_THRESHOLD_PERCENT,
  type LectureEngagementStatus,
} from './lectureEngagementStatus';

export type { LectureEngagementStatus } from './lectureEngagementStatus';
export { resolveLectureEngagementStatus } from './lectureEngagementStatus';

export type LectureEngagementSort =
  | 'watchPercentage'
  | 'lastWatchedAt'
  | 'name'
  | 'studentCode'
  | 'watchedVideos';

export type LectureEngagementReportFilters = {
  /** فلترة بمجموعة كورس أو مجموعة دراسة */
  groupId?: number;
  status?: LectureEngagementStatus;
  /** حد أدنى لنسبة المشاهدة (0–100) */
  minWatchPercentage?: number;
  /** حد أقصى لنسبة المشاهدة (0–100) */
  maxWatchPercentage?: number;
  search?: string;
  sort?: LectureEngagementSort;
  order?: 'asc' | 'desc';
  page?: number;
  limit?: number;
  /** تخطي قائمة المجموعات لتسريع الطلبات المتكررة أثناء الفلترة */
  includeGroups?: boolean;
};

type RequestUser = { id: number; role: string };

function pct(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((part / total) * 10000) / 100;
}

export class LectureEngagementReportService {
  /**
   * تقرير تفاعل الطلاب مع محاضرة واحدة.
   * يعتمد على video_views (أي سجل = فيديو مُشاهَد) + lecture_views لفتح المحاضرة.
   */
  static async getLectureEngagementReport(
    lectureId: number,
    requester: RequestUser,
    filters: LectureEngagementReportFilters = {},
  ) {
    const lectureRes = await pool.query<{
      id: number;
      title: string;
      course_id: number;
      teacher_id: number;
      course_title: string;
      access_mode: string;
      access_type: string;
    }>(
      `SELECT l.id, l.title, l.course_id,
              COALESCE(l.access_mode, 'open') AS access_mode,
              COALESCE(l.access_type, 'all') AS access_type,
              c.teacher_id, c.title AS course_title
       FROM lectures l
       JOIN courses c ON c.id = l.course_id
       WHERE l.id = $1`,
      [lectureId],
    );

    if (!lectureRes.rowCount) {
      throw new HttpError(404, 'المحاضرة غير موجودة');
    }

    const lecture = lectureRes.rows[0];
    const courseId = Number(lecture.course_id);
    const teacherId = Number(lecture.teacher_id);

    if (requester.role !== 'admin') {
      await CourseAccessControl.assertCanManageCourse(requester, courseId);
    }

    const videosCountRes = await pool.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM lecture_videos WHERE lecture_id = $1`,
      [lectureId],
    );
    const totalVideos = Number(videosCountRes.rows[0]?.total ?? 0);

    const isGroupsMode =
      lecture.access_mode === 'groups' || lecture.access_type === 'groups';
    let lectureGroupIds: number[] = [];
    if (isGroupsMode) {
      const meta = await CourseGroupAccessService.getLectureAccessMeta(lectureId);
      lectureGroupIds = meta?.group_ids?.map(Number) ?? [];
    }

    const page = Math.max(1, Number(filters.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(filters.limit) || 50));
    const offset = (page - 1) * limit;
    const order = filters.order === 'asc' ? 'ASC' : 'DESC';
    const sort = filters.sort ?? 'watchPercentage';

    const params: unknown[] = [lectureId, courseId, teacherId];
    let p = 4;

    // نطاق الطلاب: كل المسجلين في الكورس، مع تضييق لمجموعات المحاضرة إن وُجدت
    const conditions: string[] = [`e.course_id = $2`, `u.role = 'student'`];

    if (isGroupsMode && lectureGroupIds.length > 0) {
      conditions.push(`EXISTS (
        SELECT 1
        FROM student_course_group_memberships scgm
        WHERE scgm.student_id = u.id
          AND scgm.group_id = ANY($${p}::int[])
      )`);
      params.push(lectureGroupIds);
      p++;
    } else if (isGroupsMode && lectureGroupIds.length === 0) {
      // محاضرة مجموعات بدون مجموعات مرتبطة → لا يوجد طلاب مؤهلين
      conditions.push('FALSE');
    }

    if (filters.search?.trim()) {
      conditions.push(`(
        u.name ILIKE $${p}
        OR COALESCE(u.student_code, '') ILIKE $${p}
        OR COALESCE(u.phone, '') ILIKE $${p}
        OR COALESCE(u.parent_phone, '') ILIKE $${p}
      )`);
      params.push(`%${filters.search.trim()}%`);
      p++;
    }

    if (filters.groupId && Number.isFinite(filters.groupId) && filters.groupId > 0) {
      conditions.push(`(
        EXISTS (
          SELECT 1 FROM student_course_group_memberships scgm_f
          WHERE scgm_f.student_id = u.id
            AND scgm_f.group_id = $${p}
        )
        OR EXISTS (
          SELECT 1 FROM group_students gs_f
          WHERE gs_f.student_id = u.id
            AND gs_f.group_id = $${p}
        )
      )`);
      params.push(Number(filters.groupId));
      p++;
    }

    const whereEligible = conditions.join(' AND ');

    const buildCte = (eligibleWhere: string) => `
      WITH eligible AS (
        SELECT
          u.id AS student_id,
          u.name,
          u.student_code,
          u.phone,
          u.parent_phone,
          u.email,
          e.enrolled_at
        FROM enrollments e
        JOIN users u ON u.id = e.user_id
        WHERE ${eligibleWhere}
      ),
      watch AS (
        SELECT
          vv.user_id,
          COUNT(DISTINCT vv.video_id)::int AS watched_videos,
          COALESCE(SUM(vv.watch_duration), 0)::bigint AS total_watch_duration_seconds,
          MAX(vv.viewed_at) AS last_watched_at,
          COUNT(DISTINCT CASE WHEN vv.is_completed THEN vv.video_id END)::int AS completed_videos
        FROM video_views vv
        WHERE vv.lecture_id = $1
        GROUP BY vv.user_id
      ),
      opened AS (
        SELECT lv.user_id, lv.viewed_at AS lecture_opened_at
        FROM lecture_views lv
        WHERE lv.lecture_id = $1
      ),
      course_group AS (
        SELECT DISTINCT ON (m.student_id)
          m.student_id,
          cg.id AS group_id,
          cg.name AS group_name
        FROM student_course_group_memberships m
        JOIN course_groups cg ON cg.id = m.group_id
        WHERE COALESCE(cg.status, 'active') = 'active'
        ORDER BY m.student_id, m.updated_at DESC NULLS LAST, m.id DESC
      ),
      study_group AS (
        SELECT DISTINCT ON (gs.student_id)
          gs.student_id,
          sg.id AS group_id,
          sg.name AS group_name
        FROM group_students gs
        JOIN study_groups sg ON sg.id = gs.group_id
        ORDER BY gs.student_id, gs.joined_at DESC NULLS LAST, gs.id DESC
      ),
      scored AS (
        SELECT
          el.student_id,
          el.name,
          el.student_code,
          el.phone,
          el.parent_phone,
          el.email,
          el.enrolled_at,
          COALESCE(w.watched_videos, 0)::int AS watched_videos,
          COALESCE(w.completed_videos, 0)::int AS completed_videos,
          COALESCE(w.total_watch_duration_seconds, 0)::bigint AS total_watch_duration_seconds,
          w.last_watched_at,
          o.lecture_opened_at,
          (o.user_id IS NOT NULL) AS has_opened_lecture,
          COALESCE(cg.group_id, sg.group_id) AS group_id,
          COALESCE(cg.group_name, sg.group_name) AS group_name,
          CASE
            WHEN ${totalVideos} <= 0 THEN
              CASE WHEN o.user_id IS NOT NULL THEN 'COMPLETED' ELSE 'NOT_STARTED' END
            WHEN COALESCE(w.watched_videos, 0) >= ${totalVideos} THEN 'COMPLETED'
            WHEN COALESCE(w.watched_videos, 0) <= 0 THEN
              CASE WHEN o.user_id IS NOT NULL THEN 'STARTED' ELSE 'NOT_STARTED' END
            WHEN (COALESCE(w.watched_videos, 0)::numeric / ${totalVideos}::numeric) * 100
                 >= ${PARTIAL_THRESHOLD_PERCENT} THEN 'PARTIALLY_COMPLETED'
            ELSE 'STARTED'
          END AS status,
          CASE
            WHEN ${totalVideos} <= 0 THEN
              CASE WHEN o.user_id IS NOT NULL THEN 100 ELSE 0 END
            ELSE ROUND(
              (COALESCE(w.watched_videos, 0)::numeric / ${totalVideos}::numeric) * 100,
              2
            )
          END AS watch_percentage
        FROM eligible el
        LEFT JOIN watch w ON w.user_id = el.student_id
        LEFT JOIN opened o ON o.user_id = el.student_id
        LEFT JOIN course_group cg ON cg.student_id = el.student_id
        LEFT JOIN study_group sg ON sg.student_id = el.student_id
      )
    `;

    const baseCte = buildCte(whereEligible);

    const sortColumn =
      sort === 'name'
        ? 'name'
        : sort === 'studentCode'
          ? 'student_code'
          : sort === 'lastWatchedAt'
            ? 'last_watched_at'
            : sort === 'watchedVideos'
              ? 'watched_videos'
              : 'watch_percentage';

    const nulls =
      sort === 'lastWatchedAt'
        ? order === 'ASC'
          ? 'NULLS FIRST'
          : 'NULLS LAST'
        : '';

    // الإحصائيات على كل الطلاب المؤهلين (بعد search/group) بدون فلتر الحالة
    const statsRes = await pool.query(
      `${baseCte}
       SELECT
         COUNT(*)::int AS total_students,
         COUNT(*) FILTER (WHERE status = 'COMPLETED')::int AS completed,
         COUNT(*) FILTER (WHERE status = 'PARTIALLY_COMPLETED')::int AS partially_completed,
         COUNT(*) FILTER (WHERE status = 'STARTED')::int AS started,
         COUNT(*) FILTER (WHERE status = 'NOT_STARTED')::int AS not_started
       FROM scored`,
      params,
    );

    const stats = statsRes.rows[0] || {
      total_students: 0,
      completed: 0,
      partially_completed: 0,
      started: 0,
      not_started: 0,
    };

    const listClauses: string[] = [];
    const listParams = [...params];
    let listP = p;
    if (filters.status) {
      listClauses.push(`status = $${listP}`);
      listParams.push(filters.status);
      listP++;
    }

    const minWatch =
      filters.minWatchPercentage != null && Number.isFinite(Number(filters.minWatchPercentage))
        ? Math.max(0, Math.min(100, Number(filters.minWatchPercentage)))
        : undefined;
    const maxWatch =
      filters.maxWatchPercentage != null && Number.isFinite(Number(filters.maxWatchPercentage))
        ? Math.max(0, Math.min(100, Number(filters.maxWatchPercentage)))
        : undefined;

    if (minWatch !== undefined) {
      listClauses.push(`watch_percentage >= $${listP}`);
      listParams.push(minWatch);
      listP++;
    }
    if (maxWatch !== undefined) {
      listClauses.push(`watch_percentage <= $${listP}`);
      listParams.push(maxWatch);
      listP++;
    }

    const listWhere = listClauses.length ? ` WHERE ${listClauses.join(' AND ')}` : '';

    const limitIdx = listP;
    const offsetIdx = listP + 1;
    listParams.push(limit, offset);

    // قائمة + العدد في استعلام واحد (بدل CTE مرتين)
    const listRes = await pool.query(
      `${baseCte}
       SELECT *, COUNT(*) OVER()::int AS filtered_total
       FROM scored
       ${listWhere}
       ORDER BY ${sortColumn} ${order} ${nulls}, name ASC, student_id ASC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      listParams,
    );
    const filteredTotal = Number(listRes.rows[0]?.filtered_total ?? 0);

    const students = listRes.rows.map((row) => {
      const watchedVideos = Number(row.watched_videos) || 0;
      const watchPercentage = Number(row.watch_percentage) || 0;
      const status = row.status as LectureEngagementStatus;

      return {
        studentId: Number(row.student_id),
        name: row.name,
        studentCode: row.student_code ?? null,
        phone: row.phone ?? null,
        parentName: null as string | null,
        parentPhone: row.parent_phone ?? null,
        email: row.email ?? null,
        enrolledAt: row.enrolled_at ?? null,
        group: row.group_id
          ? {
              id: Number(row.group_id),
              name: row.group_name,
            }
          : null,
        lectureId,
        lectureTitle: lecture.title,
        totalVideos,
        watchedVideos,
        completedVideos: Number(row.completed_videos) || 0,
        watchPercentage,
        status,
        lastWatchedAt: row.last_watched_at
          ? new Date(row.last_watched_at).toISOString()
          : null,
        lectureOpenedAt: row.lecture_opened_at
          ? new Date(row.lecture_opened_at).toISOString()
          : null,
        totalWatchDurationSeconds: Number(row.total_watch_duration_seconds) || 0,
        hasOpenedLecture: Boolean(row.has_opened_lecture),
      };
    });

    // مجموعات خفيفة من enrollments — بدون إعادة تشغيل الـ CTE الثقيل
    let groups: { id: number; name: string }[] = [];
    if (filters.includeGroups !== false) {
      const groupsFromStudents = students
        .map((s) => s.group)
        .filter((g): g is { id: number; name: string } => !!g?.id);

      const fallbackGroupsRes = await pool.query<{ id: number; name: string }>(
        `SELECT DISTINCT g.id, g.name
         FROM (
           SELECT cg.id, cg.name
           FROM enrollments e
           JOIN student_course_group_memberships m ON m.student_id = e.user_id
           JOIN course_groups cg ON cg.id = m.group_id
           WHERE e.course_id = $1
             AND COALESCE(cg.status, 'active') = 'active'
           UNION
           SELECT sg.id, sg.name
           FROM enrollments e
           JOIN group_students gs ON gs.student_id = e.user_id
           JOIN study_groups sg ON sg.id = gs.group_id
           WHERE e.course_id = $1
         ) g
         ORDER BY g.name ASC`,
        [courseId],
      );

      const groupsMap = new Map<number, { id: number; name: string }>();
      for (const g of groupsFromStudents) {
        groupsMap.set(Number(g.id), {
          id: Number(g.id),
          name: g.name || `مجموعة #${g.id}`,
        });
      }
      for (const row of fallbackGroupsRes.rows) {
        const id = Number(row.id);
        if (!Number.isFinite(id) || id <= 0 || groupsMap.has(id)) continue;
        groupsMap.set(id, {
          id,
          name: row.name || `مجموعة #${id}`,
        });
      }
      groups = [...groupsMap.values()].sort((a, b) =>
        String(a.name).localeCompare(String(b.name), 'ar'),
      );
    }

    return {
      success: true as const,
      data: {
        lecture: {
          id: lectureId,
          title: lecture.title,
          courseId,
          courseTitle: lecture.course_title,
          totalVideos,
          accessMode: lecture.access_mode,
          groupRestricted: isGroupsMode,
          lectureGroupIds,
        },
        statistics: {
          totalStudents: Number(stats.total_students) || 0,
          completed: Number(stats.completed) || 0,
          partiallyCompleted: Number(stats.partially_completed) || 0,
          started: Number(stats.started) || 0,
          notStarted: Number(stats.not_started) || 0,
          completedPercentage: pct(
            Number(stats.completed) || 0,
            Number(stats.total_students) || 0,
          ),
          partiallyCompletedPercentage: pct(
            Number(stats.partially_completed) || 0,
            Number(stats.total_students) || 0,
          ),
          startedPercentage: pct(
            Number(stats.started) || 0,
            Number(stats.total_students) || 0,
          ),
          notStartedPercentage: pct(
            Number(stats.not_started) || 0,
            Number(stats.total_students) || 0,
          ),
        },
        filters: {
          groups,
        },
        pagination: {
          page,
          limit,
          total: filteredTotal,
          totalPages: Math.max(1, Math.ceil(filteredTotal / limit) || 1),
        },
        students,
      },
    };
  }
}
