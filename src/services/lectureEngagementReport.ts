import pool from '../db/pool';
import { HttpError } from '../utils';
import { CourseAccessControl } from './courseAccessControl';
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
  groupId?: number;
  status?: LectureEngagementStatus;
  minWatchPercentage?: number;
  maxWatchPercentage?: number;
  search?: string;
  sort?: LectureEngagementSort;
  order?: 'asc' | 'desc';
  page?: number;
  limit?: number;
  includeGroups?: boolean;
};

type RequestUser = { id: number; role: string };

type SchemaCaps = {
  lectureAccessMode: boolean;
  lectureAccessType: boolean;
  studentCode: boolean;
  courseGroupsTable: boolean;
  courseGroupStatus: boolean;
  scgmUpdatedAt: boolean;
  lectureCourseGroups: boolean;
  studyGroups: boolean;
  groupStudentsJoinedAt: boolean;
};

let cachedCaps: SchemaCaps | null = null;

async function getSchemaCaps(): Promise<SchemaCaps> {
  if (cachedCaps) return cachedCaps;
  try {
    const r = await pool.query<{
      lecture_access_mode: boolean;
      lecture_access_type: boolean;
      student_code: boolean;
      course_groups_table: boolean;
      course_group_status: boolean;
      scgm_updated_at: boolean;
      lecture_course_groups: boolean;
      study_groups: boolean;
      group_students_joined_at: boolean;
    }>(
      `SELECT
         EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'lectures' AND column_name = 'access_mode'
         ) AS lecture_access_mode,
         EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'lectures' AND column_name = 'access_type'
         ) AS lecture_access_type,
         EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'student_code'
         ) AS student_code,
         EXISTS (
           SELECT 1 FROM information_schema.tables
           WHERE table_schema = 'public' AND table_name = 'student_course_group_memberships'
         ) AS course_groups_table,
         EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'course_groups' AND column_name = 'status'
         ) AS course_group_status,
         EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public'
             AND table_name = 'student_course_group_memberships'
             AND column_name = 'updated_at'
         ) AS scgm_updated_at,
         EXISTS (
           SELECT 1 FROM information_schema.tables
           WHERE table_schema = 'public' AND table_name = 'lecture_course_groups'
         ) AS lecture_course_groups,
         EXISTS (
           SELECT 1 FROM information_schema.tables
           WHERE table_schema = 'public' AND table_name = 'study_groups'
         ) AS study_groups,
         EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'group_students' AND column_name = 'joined_at'
         ) AS group_students_joined_at`,
    );
    const row = r.rows[0];
    cachedCaps = {
      lectureAccessMode: !!row?.lecture_access_mode,
      lectureAccessType: !!row?.lecture_access_type,
      studentCode: !!row?.student_code,
      courseGroupsTable: !!row?.course_groups_table,
      courseGroupStatus: !!row?.course_group_status,
      scgmUpdatedAt: !!row?.scgm_updated_at,
      lectureCourseGroups: !!row?.lecture_course_groups,
      studyGroups: !!row?.study_groups,
      groupStudentsJoinedAt: !!row?.group_students_joined_at,
    };
  } catch (error) {
    console.error('[LectureEngagementReport] schema probe failed, using safe defaults', error);
    cachedCaps = {
      lectureAccessMode: false,
      lectureAccessType: false,
      studentCode: false,
      courseGroupsTable: false,
      courseGroupStatus: false,
      scgmUpdatedAt: false,
      lectureCourseGroups: false,
      studyGroups: true,
      groupStudentsJoinedAt: true,
    };
  }
  return cachedCaps;
}

function pct(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((part / total) * 10000) / 100;
}

function pgErrorMessage(error: unknown): string {
  const err = error as { message?: string; code?: string; detail?: string; hint?: string };
  const parts = [err?.message, err?.detail, err?.hint, err?.code ? `code=${err.code}` : null].filter(
    Boolean,
  );
  return parts.join(' | ') || 'Unknown database error';
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
    const caps = await getSchemaCaps();

    const accessModeSelect = caps.lectureAccessMode
      ? `COALESCE(l.access_mode, 'open') AS access_mode`
      : `'open'::text AS access_mode`;
    const accessTypeSelect = caps.lectureAccessType
      ? `COALESCE(l.access_type, 'all') AS access_type`
      : `'all'::text AS access_type`;

    let lecture: {
      id: number;
      title: string;
      course_id: number;
      teacher_id: number;
      course_title: string;
      access_mode: string;
      access_type: string;
    };

    try {
      const lectureRes = await pool.query(
        `SELECT l.id, l.title, l.course_id,
                ${accessModeSelect},
                ${accessTypeSelect},
                c.teacher_id, c.title AS course_title
         FROM lectures l
         JOIN courses c ON c.id = l.course_id
         WHERE l.id = $1`,
        [lectureId],
      );
      if (!lectureRes.rowCount) {
        throw new HttpError(404, 'المحاضرة غير موجودة');
      }
      lecture = lectureRes.rows[0];
    } catch (error) {
      if (error instanceof HttpError) throw error;
      console.error('[LectureEngagementReport] lecture load failed:', pgErrorMessage(error));
      throw new HttpError(500, `فشل تحميل المحاضرة: ${pgErrorMessage(error)}`);
    }

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
    if (isGroupsMode && caps.lectureCourseGroups) {
      try {
        const gRes = await pool.query<{ group_id: number }>(
          `SELECT group_id FROM lecture_course_groups WHERE lecture_id = $1`,
          [lectureId],
        );
        lectureGroupIds = gRes.rows.map((r) => Number(r.group_id)).filter((n) => n > 0);
      } catch (error) {
        console.error('[LectureEngagementReport] lecture groups load failed:', pgErrorMessage(error));
        lectureGroupIds = [];
      }
    }

    const page = Math.max(1, Number(filters.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(filters.limit) || 50));
    const offset = (page - 1) * limit;
    const order = filters.order === 'asc' ? 'ASC' : 'DESC';
    const sort = filters.sort ?? 'watchPercentage';

    const params: unknown[] = [lectureId, courseId, teacherId];
    let p = 4;

    const conditions: string[] = [`e.course_id = $2`, `u.role = 'student'`];

    if (isGroupsMode && caps.courseGroupsTable && lectureGroupIds.length > 0) {
      conditions.push(`EXISTS (
        SELECT 1
        FROM student_course_group_memberships scgm
        WHERE scgm.student_id = u.id
          AND scgm.group_id = ANY($${p}::int[])
      )`);
      params.push(lectureGroupIds);
      p++;
    } else if (isGroupsMode && lectureGroupIds.length === 0 && caps.courseGroupsTable) {
      conditions.push('FALSE');
    }

    if (filters.search?.trim()) {
      const searchParts = [`u.name ILIKE $${p}`, `COALESCE(u.phone, '') ILIKE $${p}`, `COALESCE(u.parent_phone, '') ILIKE $${p}`];
      if (caps.studentCode) {
        searchParts.splice(1, 0, `COALESCE(u.student_code, '') ILIKE $${p}`);
      }
      conditions.push(`(${searchParts.join(' OR ')})`);
      params.push(`%${filters.search.trim()}%`);
      p++;
    }

    if (filters.groupId && Number.isFinite(filters.groupId) && filters.groupId > 0) {
      const groupConds: string[] = [];
      if (caps.courseGroupsTable) {
        groupConds.push(`EXISTS (
          SELECT 1 FROM student_course_group_memberships scgm_f
          WHERE scgm_f.student_id = u.id AND scgm_f.group_id = $${p}
        )`);
      }
      if (caps.studyGroups) {
        groupConds.push(`EXISTS (
          SELECT 1 FROM group_students gs_f
          WHERE gs_f.student_id = u.id AND gs_f.group_id = $${p}
        )`);
      }
      if (groupConds.length) {
        conditions.push(`(${groupConds.join(' OR ')})`);
        params.push(Number(filters.groupId));
        p++;
      }
    }

    const whereEligible = conditions.join(' AND ');
    const studentCodeSelect = caps.studentCode ? 'u.student_code' : 'NULL::text AS student_code';

    const courseGroupCte = caps.courseGroupsTable
      ? `
      course_group AS (
        SELECT DISTINCT ON (m.student_id)
          m.student_id,
          cg.id AS group_id,
          cg.name AS group_name
        FROM student_course_group_memberships m
        JOIN course_groups cg ON cg.id = m.group_id
        WHERE cg.teacher_id = $3
          ${caps.courseGroupStatus ? `AND COALESCE(cg.status, 'active') = 'active'` : ''}
        ORDER BY m.student_id,
          ${caps.scgmUpdatedAt ? 'm.updated_at DESC NULLS LAST,' : ''}
          m.id DESC
      ),`
      : `
      course_group AS (
        SELECT NULL::int AS student_id, NULL::int AS group_id, NULL::text AS group_name
        WHERE FALSE
      ),`;

    const studyGroupOrder = caps.groupStudentsJoinedAt
      ? 'gs.student_id, gs.joined_at DESC NULLS LAST, gs.id DESC'
      : 'gs.student_id, gs.id DESC';

    const studyGroupCte = caps.studyGroups
      ? `
      study_group AS (
        SELECT DISTINCT ON (gs.student_id)
          gs.student_id,
          sg.id AS group_id,
          sg.name AS group_name
        FROM group_students gs
        JOIN study_groups sg ON sg.id = gs.group_id
        WHERE sg.teacher_id = $3
        ORDER BY ${studyGroupOrder}
      ),`
      : `
      study_group AS (
        SELECT NULL::int AS student_id, NULL::int AS group_id, NULL::text AS group_name
        WHERE FALSE
      ),`;

    const baseCte = `
      WITH eligible AS (
        SELECT
          u.id AS student_id,
          u.name,
          ${studentCodeSelect},
          u.phone,
          u.parent_phone,
          u.email,
          e.enrolled_at
        FROM enrollments e
        JOIN users u ON u.id = e.user_id
        WHERE ${whereEligible}
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
      ${courseGroupCte}
      ${studyGroupCte}
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
            WHEN (COALESCE(w.watched_videos, 0)::numeric / ${Math.max(totalVideos, 1)}::numeric) * 100
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

    try {
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

      const students = listRes.rows.map((row) => ({
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
        watchedVideos: Number(row.watched_videos) || 0,
        completedVideos: Number(row.completed_videos) || 0,
        watchPercentage: Number(row.watch_percentage) || 0,
        status: row.status as LectureEngagementStatus,
        lastWatchedAt: row.last_watched_at
          ? new Date(row.last_watched_at).toISOString()
          : null,
        lectureOpenedAt: row.lecture_opened_at
          ? new Date(row.lecture_opened_at).toISOString()
          : null,
        totalWatchDurationSeconds: Number(row.total_watch_duration_seconds) || 0,
        hasOpenedLecture: Boolean(row.has_opened_lecture),
      }));

      let groups: { id: number; name: string }[] = [];
      if (filters.includeGroups !== false) {
        const groupsMap = new Map<number, { id: number; name: string }>();
        for (const s of students) {
          if (s.group?.id) {
            groupsMap.set(s.group.id, {
              id: s.group.id,
              name: s.group.name || `مجموعة #${s.group.id}`,
            });
          }
        }

        try {
          const unions: string[] = [];
          if (caps.courseGroupsTable) {
            unions.push(`
              SELECT cg.id, cg.name
              FROM enrollments e
              JOIN student_course_group_memberships m ON m.student_id = e.user_id
              JOIN course_groups cg ON cg.id = m.group_id
              WHERE e.course_id = $1
                ${caps.courseGroupStatus ? `AND COALESCE(cg.status, 'active') = 'active'` : ''}
            `);
          }
          if (caps.studyGroups) {
            unions.push(`
              SELECT sg.id, sg.name
              FROM enrollments e
              JOIN group_students gs ON gs.student_id = e.user_id
              JOIN study_groups sg ON sg.id = gs.group_id
              WHERE e.course_id = $1
            `);
          }
          if (unions.length) {
            const fallbackGroupsRes = await pool.query<{ id: number; name: string }>(
              `SELECT DISTINCT g.id, g.name
               FROM (${unions.join(' UNION ')}) g
               ORDER BY g.name ASC`,
              [courseId],
            );
            for (const row of fallbackGroupsRes.rows) {
              const id = Number(row.id);
              if (!Number.isFinite(id) || id <= 0 || groupsMap.has(id)) continue;
              groupsMap.set(id, { id, name: row.name || `مجموعة #${id}` });
            }
          }
        } catch (error) {
          console.error('[LectureEngagementReport] groups list failed:', pgErrorMessage(error));
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
          filters: { groups },
          pagination: {
            page,
            limit,
            total: filteredTotal,
            totalPages: Math.max(1, Math.ceil(filteredTotal / limit) || 1),
          },
          students,
        },
      };
    } catch (error) {
      if (error instanceof HttpError) throw error;
      console.error('[LectureEngagementReport] query failed:', pgErrorMessage(error), {
        lectureId,
        courseId,
        caps,
      });
      // أعد رسالة الخطأ الفعلية حتى تظهر في البرودكشن بدل "Something went wrong" المبهمة
      throw new HttpError(500, `فشل تقرير تفاعل المحاضرة: ${pgErrorMessage(error)}`);
    }
  }
}
