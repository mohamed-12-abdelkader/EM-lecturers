import { Router } from 'express';
import { authMiddleware } from '../middleware/authentication';
import { asyncWrapper, HttpError } from '../utils';
import { LectureEngagementReportService, type LectureEngagementSort } from '../services/lectureEngagementReport';
import type { LectureEngagementStatus } from '../services/lectureEngagementStatus';
import { COURSE_CONTENT_ROLES } from '../services/courseAccessControl';

export const router = Router();

const STATUSES = new Set<LectureEngagementStatus>([
  'COMPLETED',
  'PARTIALLY_COMPLETED',
  'STARTED',
  'NOT_STARTED',
]);

const SORTS = new Set<LectureEngagementSort>([
  'watchPercentage',
  'lastWatchedAt',
  'name',
  'studentCode',
  'watchedVideos',
]);

/**
 * GET /api/course/lectures/:lectureId/engagement-report
 * تقرير تفاعل الطلاب مع محاضرة محددة (جميع المشتركين المؤهلين).
 */
router.get(
  '/lectures/:lectureId/engagement-report',
  authMiddleware(COURSE_CONTENT_ROLES),
  asyncWrapper(async (req, res) => {
    const lectureId = Number(req.params.lectureId);
    if (!Number.isInteger(lectureId) || lectureId <= 0) {
      throw new HttpError(400, 'lectureId غير صالح');
    }

    const statusRaw = String(req.query.status ?? '').trim().toUpperCase();
    const status = STATUSES.has(statusRaw as LectureEngagementStatus)
      ? (statusRaw as LectureEngagementStatus)
      : undefined;

    const sortRaw = String(req.query.sort ?? 'watchPercentage').trim();
    const sort = SORTS.has(sortRaw as LectureEngagementSort)
      ? (sortRaw as LectureEngagementSort)
      : 'watchPercentage';

    const orderRaw = String(req.query.order ?? 'desc').trim().toLowerCase();
    const order = orderRaw === 'asc' ? 'asc' : 'desc';

    const groupRaw = req.query.groupId ?? req.query.group_id;
    const groupParsed =
      groupRaw !== undefined && groupRaw !== null && String(groupRaw).trim() !== ''
        ? Number(groupRaw)
        : undefined;
    const groupId =
      groupParsed !== undefined && Number.isFinite(groupParsed) && groupParsed > 0
        ? groupParsed
        : undefined;

    const page = req.query.page ? Number(req.query.page) : 1;
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    const search =
      typeof req.query.search === 'string'
        ? req.query.search
        : typeof req.query.q === 'string'
          ? req.query.q
          : undefined;

    const parseWatchBound = (raw: unknown) => {
      if (raw === undefined || raw === null || String(raw).trim() === '') return undefined;
      const n = Number(raw);
      if (!Number.isFinite(n)) return undefined;
      return Math.max(0, Math.min(100, n));
    };
    const minWatchPercentage = parseWatchBound(
      req.query.minWatchPercentage ?? req.query.min_watch_percentage,
    );
    const maxWatchPercentage = parseWatchBound(
      req.query.maxWatchPercentage ?? req.query.max_watch_percentage,
    );

    const includeGroupsRaw = String(
      req.query.includeGroups ?? req.query.include_groups ?? 'true',
    )
      .trim()
      .toLowerCase();
    const includeGroups = !(
      includeGroupsRaw === '0' ||
      includeGroupsRaw === 'false' ||
      includeGroupsRaw === 'no'
    );

    const result = await LectureEngagementReportService.getLectureEngagementReport(
      lectureId,
      req.user!,
      {
        groupId,
        status,
        minWatchPercentage,
        maxWatchPercentage,
        search,
        sort,
        order,
        page: Number.isFinite(page) ? page : 1,
        limit: Number.isFinite(limit) ? limit : 50,
        includeGroups,
      },
    );

    res.json(result);
  }),
);
