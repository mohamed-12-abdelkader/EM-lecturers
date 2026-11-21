import { Router } from 'express';
import { z } from 'zod';
import pool from '../db/pool';
import { authMiddleware } from '../middleware/authentication';
import { requireTeacherPlanFeature } from '../middleware/teacherPlanGate';
import { asyncWrapper, config, HttpError } from '../utils';
import { MetaConnectionService, metaFrontendReturnUrl } from '../services/metaConnection';
import { TeacherSocialPublishingService } from '../services/teacherSocialPublishing';

export const router = Router();

const planGate = requireTeacherPlanFeature('creative_social');

/** Meta OAuth callback — validated via signed state (no Bearer). */
router.get(
  '/oauth/callback',
  asyncWrapper(async (req, res) => {
    const error = typeof req.query.error === 'string' ? req.query.error : '';
    if (error) {
      return res.redirect(metaFrontendReturnUrl({ error: 'oauth_denied', detail: error }));
    }

    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    if (!code || !state) {
      return res.redirect(metaFrontendReturnUrl({ error: 'missing_code' }));
    }

    try {
      const { teacherId, tenantId } = MetaConnectionService.verifyOAuthState(state);
      const result = await MetaConnectionService.handleOAuthCallback(code, teacherId, tenantId);
      return res.redirect(
        metaFrontendReturnUrl({
          connected: '1',
          accounts: String(result.discovered_count),
          tab: 'connections',
        }),
      );
    } catch (err: any) {
      const message = err instanceof HttpError ? err.message : err?.message || 'oauth_failed';
      return res.redirect(
        metaFrontendReturnUrl({
          error: 'oauth_failed',
          detail: String(message).slice(0, 200),
        }),
      );
    }
  }),
);

/** Admin overview — no creative plan gate */
router.get(
  '/admin/overview',
  authMiddleware(['admin']),
  asyncWrapper(async (_req, res) => {
    const [teachers, targets, posts, jobs, failed] = await Promise.all([
      pool.query(
        `SELECT COUNT(DISTINCT teacher_id)::int AS count
         FROM teacher_meta_connections WHERE status = 'connected'`,
      ),
      pool.query(
        `SELECT platform, COUNT(*)::int AS count
         FROM teacher_meta_targets WHERE is_enabled = TRUE
         GROUP BY platform`,
      ),
      pool.query(`SELECT status, COUNT(*)::int AS count FROM teacher_social_posts GROUP BY status`),
      pool.query(
        `SELECT status, COUNT(*)::int AS count FROM teacher_social_publish_jobs GROUP BY status`,
      ),
      pool.query(
        `SELECT COUNT(*)::int AS count FROM teacher_social_publish_jobs WHERE status = 'failed'`,
      ),
    ]);
    return res.json({
      success: true,
      data: {
        connected_teachers: teachers.rows[0]?.count || 0,
        targets_by_platform: Object.fromEntries(targets.rows.map((r) => [r.platform, r.count])),
        posts_by_status: Object.fromEntries(posts.rows.map((r) => [r.status, r.count])),
        jobs_by_status: Object.fromEntries(jobs.rows.map((r) => [r.status, r.count])),
        failed_jobs: failed.rows[0]?.count || 0,
      },
    });
  }),
);

router.use(authMiddleware(['teacher', 'admin']));
router.use(planGate);

router.get(
  '/dashboard',
  asyncWrapper(async (req, res) => {
    const data = await TeacherSocialPublishingService.getDashboard(req.user!.id);
    return res.json({ success: true, data });
  }),
);

router.get(
  '/connections',
  asyncWrapper(async (req, res) => {
    const [connections, targets] = await Promise.all([
      MetaConnectionService.listConnections(req.user!.id),
      MetaConnectionService.listTargets(req.user!.id),
    ]);
    return res.json({
      success: true,
      data: {
        connections,
        targets,
        redirect_uri: MetaConnectionService.getRedirectUrl(),
        configured: Boolean(config.META_APP_ID && config.META_APP_SECRET),
      },
    });
  }),
);

router.get(
  '/connect',
  asyncWrapper(async (req, res) => {
    const url = MetaConnectionService.buildConnectUrl(req.user!.id, req.user!.tenant_id ?? null);
    return res.json({
      success: true,
      data: { url, redirect_uri: MetaConnectionService.getRedirectUrl() },
    });
  }),
);

router.post(
  '/targets/:id/enable',
  asyncWrapper(async (req, res) => {
    const id = Number(req.params.id);
    const enabled = req.body?.enabled !== false;
    const targets = await MetaConnectionService.setTargetEnabled(req.user!.id, id, enabled);
    return res.json({ success: true, data: { targets } });
  }),
);

router.post(
  '/targets/:id/default',
  asyncWrapper(async (req, res) => {
    const targets = await MetaConnectionService.setDefaultTarget(
      req.user!.id,
      Number(req.params.id),
    );
    return res.json({ success: true, data: { targets } });
  }),
);

router.delete(
  '/targets/:id',
  asyncWrapper(async (req, res) => {
    const targets = await MetaConnectionService.disconnectTarget(
      req.user!.id,
      Number(req.params.id),
    );
    return res.json({ success: true, data: { targets } });
  }),
);

router.delete(
  '/connections/:id',
  asyncWrapper(async (req, res) => {
    await MetaConnectionService.disconnectConnection(req.user!.id, Number(req.params.id));
    return res.json({ success: true, message: 'تم فصل الاتصال' });
  }),
);

router.get(
  '/settings',
  asyncWrapper(async (req, res) => {
    const data = await TeacherSocialPublishingService.getOrCreateSettings(req.user!.id);
    return res.json({ success: true, data });
  }),
);

const SettingsSchema = z.object({
  auto_publish_enabled: z.boolean().optional(),
  approval_mode: z.enum(['manual', 'approval', 'auto']).optional(),
  posts_per_day: z.number().int().min(0).max(10).optional(),
  publish_times: z.array(z.string().regex(/^\d{1,2}:\d{2}$/)).min(1).max(6).optional(),
  publish_days: z.array(z.number().int().min(0).max(6)).min(1).max(7).optional(),
  timezone: z.string().min(1).max(64).optional(),
  content_types: z.array(z.string()).max(20).optional(),
  default_target_ids: z.array(z.number().int().positive()).max(20).optional(),
  paused: z.boolean().optional(),
});

router.put(
  '/settings',
  asyncWrapper(async (req, res) => {
    const parsed = SettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: parsed.error.errors,
      });
    }
    const data = await TeacherSocialPublishingService.updateSettings(req.user!.id, parsed.data);
    return res.json({ success: true, data });
  }),
);

router.get(
  '/posts',
  asyncWrapper(async (req, res) => {
    const data = await TeacherSocialPublishingService.listPosts(req.user!.id, {
      status: typeof req.query.status === 'string' ? req.query.status : undefined,
      from: typeof req.query.from === 'string' ? req.query.from : undefined,
      to: typeof req.query.to === 'string' ? req.query.to : undefined,
      limit: req.query.limit ? Number(req.query.limit) : 50,
      offset: req.query.offset ? Number(req.query.offset) : 0,
    });
    return res.json({ success: true, data });
  }),
);

router.get(
  '/posts/:id',
  asyncWrapper(async (req, res) => {
    const data = await TeacherSocialPublishingService.getPost(req.user!.id, Number(req.params.id));
    return res.json({ success: true, data });
  }),
);

const CreatePostSchema = z.object({
  caption: z.string().max(5000).default(''),
  image_url: z.string().min(1).max(2000),
  generation_id: z.number().int().positive().optional(),
  content_type: z.string().max(64).optional(),
  target_ids: z.array(z.number().int().positive()).max(20).optional(),
  scheduled_at: z.string().optional().nullable(),
  status: z
    .enum([
      'draft',
      'pending_approval',
      'approved',
      'scheduled',
      'queued',
      'publishing',
      'published',
      'partial',
      'failed',
      'cancelled',
    ])
    .optional(),
});

router.post(
  '/posts',
  asyncWrapper(async (req, res) => {
    const parsed = CreatePostSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: parsed.error.errors,
      });
    }
    const data = await TeacherSocialPublishingService.createPost({
      teacherId: req.user!.id,
      tenantId: req.user!.tenant_id ?? null,
      caption: parsed.data.caption,
      imageUrl: parsed.data.image_url,
      generationId: parsed.data.generation_id,
      contentType: parsed.data.content_type,
      targetIds: parsed.data.target_ids,
      status: parsed.data.status,
      scheduledAt: parsed.data.scheduled_at ? new Date(parsed.data.scheduled_at) : null,
    });
    return res.status(201).json({ success: true, data });
  }),
);

router.post(
  '/posts/from-generation/:generationId',
  asyncWrapper(async (req, res) => {
    const data = await TeacherSocialPublishingService.createFromGeneration(
      req.user!.id,
      Number(req.params.generationId),
      req.user!.tenant_id ?? null,
    );
    return res.status(201).json({ success: true, data });
  }),
);

const UpdatePostSchema = z.object({
  caption: z.string().max(5000).optional(),
  image_url: z.string().min(1).max(2000).optional(),
  target_ids: z.array(z.number().int().positive()).max(20).optional(),
  scheduled_at: z.string().nullable().optional(),
  content_type: z.string().max(64).nullable().optional(),
});

router.patch(
  '/posts/:id',
  asyncWrapper(async (req, res) => {
    const parsed = UpdatePostSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: parsed.error.errors,
      });
    }
    const data = await TeacherSocialPublishingService.updatePost(
      req.user!.id,
      Number(req.params.id),
      parsed.data,
    );
    return res.json({ success: true, data });
  }),
);

router.post(
  '/posts/:id/approve',
  asyncWrapper(async (req, res) => {
    const scheduledAt =
      typeof req.body?.scheduled_at === 'string' ? req.body.scheduled_at : null;
    const publishNow = req.body?.publish_now === true;
    let data = await TeacherSocialPublishingService.approvePost(
      req.user!.id,
      Number(req.params.id),
      scheduledAt,
    );
    if (publishNow) {
      data = await TeacherSocialPublishingService.enqueuePublish(req.user!.id, Number(req.params.id), {
        immediate: true,
      });
    } else if (scheduledAt) {
      data = await TeacherSocialPublishingService.enqueuePublish(req.user!.id, Number(req.params.id), {
        runAfter: new Date(scheduledAt),
      });
    }
    return res.json({ success: true, data });
  }),
);

router.post(
  '/posts/:id/reject',
  asyncWrapper(async (req, res) => {
    const data = await TeacherSocialPublishingService.rejectPost(
      req.user!.id,
      Number(req.params.id),
    );
    return res.json({ success: true, data });
  }),
);

router.post(
  '/posts/:id/publish-now',
  asyncWrapper(async (req, res) => {
    const data = await TeacherSocialPublishingService.enqueuePublish(
      req.user!.id,
      Number(req.params.id),
      { immediate: true },
    );
    return res.json({ success: true, data });
  }),
);

router.post(
  '/posts/:id/schedule',
  asyncWrapper(async (req, res) => {
    const scheduledAt = typeof req.body?.scheduled_at === 'string' ? req.body.scheduled_at : '';
    if (!scheduledAt) {
      return res.status(400).json({ success: false, message: 'scheduled_at مطلوب' });
    }
    await TeacherSocialPublishingService.updatePost(req.user!.id, Number(req.params.id), {
      scheduled_at: scheduledAt,
    });
    const data = await TeacherSocialPublishingService.enqueuePublish(
      req.user!.id,
      Number(req.params.id),
      { runAfter: new Date(scheduledAt) },
    );
    return res.json({ success: true, data });
  }),
);

router.post(
  '/posts/:id/cancel-schedule',
  asyncWrapper(async (req, res) => {
    const data = await TeacherSocialPublishingService.cancelSchedule(
      req.user!.id,
      Number(req.params.id),
    );
    return res.json({ success: true, data });
  }),
);

router.post(
  '/posts/:id/retry',
  asyncWrapper(async (req, res) => {
    const data = await TeacherSocialPublishingService.retryFailed(
      req.user!.id,
      Number(req.params.id),
    );
    return res.json({ success: true, data });
  }),
);

router.delete(
  '/posts/:id',
  asyncWrapper(async (req, res) => {
    const data = await TeacherSocialPublishingService.deletePost(
      req.user!.id,
      Number(req.params.id),
    );
    return res.json({ success: true, data });
  }),
);

router.get(
  '/logs',
  asyncWrapper(async (req, res) => {
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    const data = await TeacherSocialPublishingService.listLogs(req.user!.id, limit);
    return res.json({ success: true, data });
  }),
);
