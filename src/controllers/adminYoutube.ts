import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/authentication';
import { requireDefaultTenantMiddleware } from '../middleware/tenantContext';
import { asyncWrapper, HttpError } from '../utils';
import { YoutubeConnectionService } from '../services/youtubeConnection';
import { YoutubeAdminUploadsService } from '../services/youtubeAdminUploads';

export const router = Router();

function parseOptionalBool(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (value === true || value === 'true' || value === '1') return true;
  if (value === false || value === 'false' || value === '0') return false;
  return undefined;
}

/** OAuth callback from Google — no Bearer token; validated via signed state. */
router.get(
  '/callback',
  asyncWrapper(async (req, res) => {
    const error = typeof req.query.error === 'string' ? req.query.error : '';
    if (error) {
      return res.redirect(
        YoutubeConnectionService.frontendReturnUrl({ error: 'oauth_denied', detail: error }),
      );
    }

    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    if (!code || !state) {
      return res.redirect(
        YoutubeConnectionService.frontendReturnUrl({ error: 'missing_code' }),
      );
    }

    try {
      const { adminId } = YoutubeConnectionService.verifyOAuthState(state);
      const row = await YoutubeConnectionService.exchangeCodeAndSave(code, adminId);
      return res.redirect(
        YoutubeConnectionService.frontendReturnUrl({
          connected: '1',
          channel: row.channel_title || '',
        }),
      );
    } catch (err: any) {
      const message = err instanceof HttpError ? err.message : err?.message || 'oauth_failed';
      return res.redirect(
        YoutubeConnectionService.frontendReturnUrl({
          error: 'oauth_failed',
          detail: String(message).slice(0, 200),
        }),
      );
    }
  }),
);

router.use(requireDefaultTenantMiddleware());
router.use(authMiddleware(['admin']));

router.get(
  '/status',
  asyncWrapper(async (_req, res) => {
    const status = await YoutubeConnectionService.getStatus();
    return res.json({ success: true, data: status });
  }),
);

router.get(
  '/connect',
  asyncWrapper(async (req, res) => {
    const url = YoutubeConnectionService.buildConnectUrl(req.user!.id);
    return res.json({
      success: true,
      data: {
        url,
        redirect_uri: YoutubeConnectionService.getRedirectUrl(),
      },
    });
  }),
);

router.post(
  '/disconnect',
  asyncWrapper(async (_req, res) => {
    await YoutubeConnectionService.disconnect();
    return res.json({ success: true, message: 'تم قطع اتصال YouTube' });
  }),
);

router.get(
  '/sessions',
  asyncWrapper(async (req, res) => {
    const tenantId = req.query.tenant_id ? Number(req.query.tenant_id) : undefined;
    const courseId = req.query.course_id ? Number(req.query.course_id) : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    const offset = req.query.offset ? Number(req.query.offset) : 0;
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    const from = typeof req.query.from === 'string' ? req.query.from : undefined;
    const to = typeof req.query.to === 'string' ? req.query.to : undefined;
    const hasFile = parseOptionalBool(req.query.has_file);
    const notOnYoutube = parseOptionalBool(req.query.not_on_youtube);

    const data = await YoutubeAdminUploadsService.listSessions({
      tenantId: tenantId && !Number.isNaN(tenantId) ? tenantId : undefined,
      courseId: courseId && !Number.isNaN(courseId) ? courseId : undefined,
      search,
      from,
      to,
      hasFile,
      notOnYoutube,
      limit,
      offset,
    });

    return res.json({ success: true, data });
  }),
);

const EnqueueSchema = z.object({
  meeting_ids: z.array(z.string().uuid()).min(1).max(50),
  replace: z.boolean().optional().default(false),
});

router.post(
  '/uploads',
  asyncWrapper(async (req, res) => {
    const parsed = EnqueueSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: parsed.error.errors,
      });
    }

    const result = await YoutubeAdminUploadsService.enqueueUploads({
      meetingIds: parsed.data.meeting_ids,
      createdBy: req.user!.id,
      replace: parsed.data.replace,
    });

    return res.status(201).json({
      success: true,
      data: result,
    });
  }),
);

router.get(
  '/uploads',
  asyncWrapper(async (req, res) => {
    const raw = typeof req.query.ids === 'string' ? req.query.ids : '';
    const ids = raw
      .split(',')
      .map((x) => Number(x.trim()))
      .filter((n) => Number.isFinite(n) && n > 0);
    const jobs = await YoutubeAdminUploadsService.getJobs(ids.length ? ids : undefined);
    return res.json({ success: true, data: { jobs } });
  }),
);

router.post(
  '/uploads/:jobId/retry',
  asyncWrapper(async (req, res) => {
    const jobId = Number(req.params.jobId);
    if (!jobId) return res.status(400).json({ success: false, message: 'معرف المهمة غير صحيح' });
    const job = await YoutubeAdminUploadsService.retryJob(jobId, req.user!.id);
    return res.json({ success: true, data: { job } });
  }),
);
