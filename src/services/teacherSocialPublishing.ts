import pool from '../db/pool';
import { buildFileUrl, HttpError, logger } from '../utils';
import { MetaConnectionService } from './metaConnection';
import {
  createInstagramMediaContainer,
  publishFacebookPagePhoto,
  publishInstagramMedia,
  waitForInstagramContainerReady,
} from './metaGraphClient';

export type SocialPostStatus =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'scheduled'
  | 'queued'
  | 'publishing'
  | 'published'
  | 'partial'
  | 'failed'
  | 'cancelled';

export type SocialSettings = {
  teacher_id: number;
  auto_publish_enabled: boolean;
  approval_mode: 'manual' | 'approval' | 'auto';
  posts_per_day: number;
  publish_times: string[];
  publish_days: number[];
  timezone: string;
  content_types: string[];
  default_target_ids: number[];
  paused: boolean;
  content_plan?: Record<string, string> | null;
  created_at?: Date;
  updated_at?: Date;
};

export type SocialPublishJobRow = {
  id: number;
  post_id: number;
  post_target_id: number;
  teacher_id: number;
  platform: 'facebook_page' | 'instagram_business';
  status: string;
  run_after: Date;
  attempts: number;
  locked_at: Date | null;
  completed_at: Date | null;
  last_error: string | null;
};

const MAX_ATTEMPTS = 5;
const RETRY_BASE_MS = 60_000;

function publicImageUrl(imageUrl: string | null | undefined): string {
  if (!imageUrl) throw new HttpError(400, 'الصورة مطلوبة للنشر');
  const built = buildFileUrl(imageUrl);
  const url = built || imageUrl;
  if (!/^https:\/\//i.test(url)) {
    throw new HttpError(
      400,
      'رابط الصورة يجب أن يكون HTTPS عامًا حتى تتمكن Meta من الوصول إليه (اضبط BASE_URL)',
    );
  }
  return url;
}

async function writeLog(opts: {
  teacherId: number;
  postId?: number | null;
  postTargetId?: number | null;
  action: string;
  status: string;
  errorCode?: string | null;
  errorMessage?: string | null;
  metadata?: Record<string, unknown>;
}) {
  await pool.query(
    `INSERT INTO teacher_social_publishing_logs
       (teacher_id, post_id, post_target_id, action, status, error_code, error_message, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
    [
      opts.teacherId,
      opts.postId ?? null,
      opts.postTargetId ?? null,
      opts.action,
      opts.status,
      opts.errorCode ?? null,
      opts.errorMessage ?? null,
      JSON.stringify(opts.metadata || {}),
    ],
  );
}

async function refreshPostAggregateStatus(postId: number) {
  const targets = await pool.query<{ status: string }>(
    `SELECT status FROM teacher_social_post_targets WHERE post_id = $1`,
    [postId],
  );
  if (!targets.rowCount) return;
  const statuses = targets.rows.map((r) => r.status);
  const allPublished = statuses.every((s) => s === 'published' || s === 'skipped' || s === 'cancelled');
  const anyPublished = statuses.some((s) => s === 'published');
  const anyFailed = statuses.some((s) => s === 'failed');
  const anyPublishing = statuses.some((s) => s === 'publishing' || s === 'pending');

  let status: SocialPostStatus = 'publishing';
  if (allPublished && anyPublished) status = 'published';
  else if (anyPublished && anyFailed) status = 'partial';
  else if (anyFailed && !anyPublishing && !anyPublished) status = 'failed';
  else if (anyPublishing) status = 'publishing';

  await pool.query(
    `UPDATE teacher_social_posts SET
       status = $2,
       published_at = CASE WHEN $2 = 'published' THEN COALESCE(published_at, NOW()) ELSE published_at END,
       updated_at = NOW()
     WHERE id = $1`,
    [postId, status],
  );
}

export class TeacherSocialPublishingService {
  static async getOrCreateSettings(teacherId: number): Promise<SocialSettings> {
    const existing = await pool.query(`SELECT * FROM teacher_social_settings WHERE teacher_id = $1`, [
      teacherId,
    ]);
    if (existing.rowCount) {
      return normalizeSettings(existing.rows[0]);
    }
    const inserted = await pool.query(
      `INSERT INTO teacher_social_settings (teacher_id) VALUES ($1) RETURNING *`,
      [teacherId],
    );
    return normalizeSettings(inserted.rows[0]);
  }

  static async updateSettings(
    teacherId: number,
    patch: Partial<{
      auto_publish_enabled: boolean;
      approval_mode: 'manual' | 'approval' | 'auto';
      posts_per_day: number;
      publish_times: string[];
      publish_days: number[];
      timezone: string;
      content_types: string[];
      default_target_ids: number[];
      paused: boolean;
    }>,
  ): Promise<SocialSettings> {
    await this.getOrCreateSettings(teacherId);
    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    const map: Record<string, unknown> = {
      auto_publish_enabled: patch.auto_publish_enabled,
      approval_mode: patch.approval_mode,
      posts_per_day: patch.posts_per_day,
      publish_times: patch.publish_times != null ? JSON.stringify(patch.publish_times) : undefined,
      publish_days: patch.publish_days != null ? JSON.stringify(patch.publish_days) : undefined,
      timezone: patch.timezone,
      content_types: patch.content_types != null ? JSON.stringify(patch.content_types) : undefined,
      default_target_ids:
        patch.default_target_ids != null ? JSON.stringify(patch.default_target_ids) : undefined,
      paused: patch.paused,
    };
    for (const [key, val] of Object.entries(map)) {
      if (val === undefined) continue;
      fields.push(`${key} = $${i++}`);
      values.push(val);
    }
    if (!fields.length) return this.getOrCreateSettings(teacherId);
    fields.push(`updated_at = NOW()`);
    values.push(teacherId);
    const res = await pool.query(
      `UPDATE teacher_social_settings SET ${fields.join(', ')} WHERE teacher_id = $${i} RETURNING *`,
      values,
    );
    return normalizeSettings(res.rows[0]);
  }

  static async createPost(opts: {
    teacherId: number;
    tenantId?: number | null;
    caption: string;
    imageUrl: string;
    generationId?: number | null;
    contentType?: string | null;
    targetIds?: number[];
    status?: SocialPostStatus;
    approvalStatus?: 'none' | 'pending' | 'approved' | 'rejected';
    scheduledAt?: Date | null;
    timezone?: string;
  }) {
    const settings = await this.getOrCreateSettings(opts.teacherId);
    let status = opts.status;
    let approvalStatus = opts.approvalStatus;
    if (!status) {
      if (settings.approval_mode === 'manual') {
        status = 'draft';
        approvalStatus = 'none';
      } else if (settings.approval_mode === 'approval') {
        status = 'pending_approval';
        approvalStatus = 'pending';
      } else {
        status = 'approved';
        approvalStatus = 'approved';
      }
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const postRes = await client.query(
        `INSERT INTO teacher_social_posts
           (teacher_id, tenant_id, generation_id, caption, image_url, status, approval_status,
            scheduled_at, timezone, content_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [
          opts.teacherId,
          opts.tenantId ?? null,
          opts.generationId ?? null,
          opts.caption || '',
          opts.imageUrl,
          status,
          approvalStatus || 'none',
          opts.scheduledAt ?? null,
          opts.timezone || settings.timezone || 'Africa/Cairo',
          opts.contentType ?? null,
        ],
      );
      const post = postRes.rows[0];

      let targetIds = opts.targetIds?.filter(Boolean) || [];
      if (!targetIds.length) {
        targetIds = (settings.default_target_ids || []).map(Number).filter(Boolean);
      }
      if (!targetIds.length) {
        const defaults = await client.query<{ id: number }>(
          `SELECT id FROM teacher_meta_targets
           WHERE teacher_id = $1 AND is_enabled = TRUE
           ORDER BY is_default DESC, id`,
          [opts.teacherId],
        );
        targetIds = defaults.rows.map((r) => r.id);
      }

      for (const tid of targetIds) {
        const t = await client.query<{ id: number; platform: string }>(
          `SELECT id, platform FROM teacher_meta_targets
           WHERE id = $1 AND teacher_id = $2 AND is_enabled = TRUE`,
          [tid, opts.teacherId],
        );
        if (!t.rowCount) continue;
        await client.query(
          `INSERT INTO teacher_social_post_targets (post_id, target_id, platform)
           VALUES ($1, $2, $3)
           ON CONFLICT (post_id, target_id) DO NOTHING`,
          [post.id, tid, t.rows[0].platform],
        );
      }

      await client.query('COMMIT');
      await writeLog({
        teacherId: opts.teacherId,
        postId: post.id,
        action: 'create_post',
        status: 'ok',
        metadata: { status: post.status },
      });
      return this.getPost(opts.teacherId, post.id);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  static async getPost(teacherId: number, postId: number) {
    const post = await pool.query(`SELECT * FROM teacher_social_posts WHERE id = $1 AND teacher_id = $2`, [
      postId,
      teacherId,
    ]);
    if (!post.rowCount) throw new HttpError(404, 'البوست غير موجود');
    const targets = await pool.query(
      `SELECT pt.*,
              t.page_name, t.ig_username, t.platform AS target_platform,
              t.page_picture_url, t.ig_picture_url
       FROM teacher_social_post_targets pt
       JOIN teacher_meta_targets t ON t.id = pt.target_id
       WHERE pt.post_id = $1
       ORDER BY pt.id`,
      [postId],
    );
    return { ...post.rows[0], targets: targets.rows };
  }

  static async listPosts(
    teacherId: number,
    opts: {
      status?: string;
      from?: string;
      to?: string;
      limit?: number;
      offset?: number;
    } = {},
  ) {
    const limit = Math.min(Math.max(opts.limit || 50, 1), 200);
    const offset = Math.max(opts.offset || 0, 0);
    const params: unknown[] = [teacherId];
    let where = `teacher_id = $1`;
    if (opts.status) {
      params.push(opts.status);
      where += ` AND status = $${params.length}`;
    }
    if (opts.from) {
      params.push(opts.from);
      where += ` AND COALESCE(scheduled_at, created_at) >= $${params.length}::timestamptz`;
    }
    if (opts.to) {
      params.push(opts.to);
      where += ` AND COALESCE(scheduled_at, created_at) <= $${params.length}::timestamptz`;
    }
    params.push(limit, offset);
    const res = await pool.query(
      `SELECT * FROM teacher_social_posts
       WHERE ${where}
       ORDER BY COALESCE(scheduled_at, created_at) DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    const ids = res.rows.map((r) => r.id);
    let targetsByPost: Record<number, any[]> = {};
    if (ids.length) {
      const t = await pool.query(
        `SELECT pt.*, t.page_name, t.ig_username
         FROM teacher_social_post_targets pt
         JOIN teacher_meta_targets t ON t.id = pt.target_id
         WHERE pt.post_id = ANY($1::int[])`,
        [ids],
      );
      targetsByPost = t.rows.reduce((acc: Record<number, any[]>, row) => {
        (acc[row.post_id] ||= []).push(row);
        return acc;
      }, {});
    }
    return res.rows.map((p) => ({ ...p, targets: targetsByPost[p.id] || [] }));
  }

  static async updatePost(
    teacherId: number,
    postId: number,
    patch: {
      caption?: string;
      image_url?: string;
      target_ids?: number[];
      scheduled_at?: string | null;
      content_type?: string | null;
    },
  ) {
    const post = await this.getPost(teacherId, postId);
    if (['published', 'publishing', 'cancelled'].includes(post.status) && patch.target_ids) {
      // allow caption/image edits only before/after carefully — block target change after publish start
      if (post.status === 'published' || post.status === 'publishing') {
        throw new HttpError(400, 'لا يمكن تعديل الحسابات بعد بدء النشر');
      }
    }
    if (post.status === 'published') {
      throw new HttpError(400, 'لا يمكن تعديل بوست منشور');
    }

    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    if (patch.caption !== undefined) {
      fields.push(`caption = $${i++}`);
      values.push(patch.caption);
    }
    if (patch.image_url !== undefined) {
      fields.push(`image_url = $${i++}`);
      values.push(patch.image_url);
    }
    if (patch.scheduled_at !== undefined) {
      fields.push(`scheduled_at = $${i++}`);
      values.push(patch.scheduled_at);
      if (patch.scheduled_at) {
        fields.push(`status = CASE WHEN status IN ('draft','approved','pending_approval') THEN 'scheduled' ELSE status END`);
      }
    }
    if (patch.content_type !== undefined) {
      fields.push(`content_type = $${i++}`);
      values.push(patch.content_type);
    }
    if (fields.length) {
      fields.push(`updated_at = NOW()`);
      values.push(postId, teacherId);
      await pool.query(
        `UPDATE teacher_social_posts SET ${fields.join(', ')}
         WHERE id = $${i++} AND teacher_id = $${i}`,
        values,
      );
    }

    if (patch.target_ids) {
      await pool.query(`DELETE FROM teacher_social_post_targets WHERE post_id = $1`, [postId]);
      for (const tid of patch.target_ids) {
        const t = await pool.query<{ platform: string }>(
          `SELECT platform FROM teacher_meta_targets
           WHERE id = $1 AND teacher_id = $2 AND is_enabled = TRUE`,
          [tid, teacherId],
        );
        if (!t.rowCount) continue;
        await pool.query(
          `INSERT INTO teacher_social_post_targets (post_id, target_id, platform)
           VALUES ($1, $2, $3)`,
          [postId, tid, t.rows[0].platform],
        );
      }
    }

    return this.getPost(teacherId, postId);
  }

  static async approvePost(teacherId: number, postId: number, scheduledAt?: string | null) {
    const post = await this.getPost(teacherId, postId);
    if (post.approval_status === 'rejected') {
      throw new HttpError(400, 'تم رفض هذا البوست');
    }
    await pool.query(
      `UPDATE teacher_social_posts SET
         approval_status = 'approved',
         status = CASE WHEN $3::timestamptz IS NOT NULL THEN 'scheduled' ELSE 'approved' END,
         scheduled_at = COALESCE($3::timestamptz, scheduled_at),
         updated_at = NOW()
       WHERE id = $1 AND teacher_id = $2`,
      [postId, teacherId, scheduledAt ?? null],
    );
    await writeLog({
      teacherId,
      postId,
      action: 'approve',
      status: 'ok',
    });
    return this.getPost(teacherId, postId);
  }

  static async rejectPost(teacherId: number, postId: number) {
    await pool.query(
      `UPDATE teacher_social_posts SET
         approval_status = 'rejected',
         status = 'cancelled',
         updated_at = NOW()
       WHERE id = $1 AND teacher_id = $2 AND status NOT IN ('published', 'publishing')`,
      [postId, teacherId],
    );
    await pool.query(
      `UPDATE teacher_social_publish_jobs
       SET status = 'cancelled', updated_at = NOW()
       WHERE post_id = $1 AND teacher_id = $2 AND status IN ('queued', 'processing')`,
      [postId, teacherId],
    );
    return this.getPost(teacherId, postId);
  }

  static async cancelSchedule(teacherId: number, postId: number) {
    await pool.query(
      `UPDATE teacher_social_posts SET
         status = 'draft',
         scheduled_at = NULL,
         updated_at = NOW()
       WHERE id = $1 AND teacher_id = $2 AND status IN ('scheduled', 'approved', 'queued')`,
      [postId, teacherId],
    );
    await pool.query(
      `UPDATE teacher_social_publish_jobs
       SET status = 'cancelled', updated_at = NOW()
       WHERE post_id = $1 AND teacher_id = $2 AND status IN ('queued')`,
      [postId, teacherId],
    );
    await writeLog({ teacherId, postId, action: 'cancel_schedule', status: 'ok' });
    return this.getPost(teacherId, postId);
  }

  static async deletePost(teacherId: number, postId: number) {
    const post = await this.getPost(teacherId, postId);
    if (['published', 'publishing', 'partial'].includes(post.status)) {
      throw new HttpError(400, 'لا يمكن حذف بوست منشور أو قيد النشر');
    }
    await pool.query(
      `UPDATE teacher_social_publish_jobs
       SET status = 'cancelled', updated_at = NOW()
       WHERE post_id = $1 AND teacher_id = $2 AND status IN ('queued', 'processing')`,
      [postId, teacherId],
    );
    await pool.query(`DELETE FROM teacher_social_posts WHERE id = $1 AND teacher_id = $2`, [
      postId,
      teacherId,
    ]);
    return { deleted: true };
  }

  /** Queue publish jobs for all pending targets (immediate or scheduled). */
  static async enqueuePublish(
    teacherId: number,
    postId: number,
    opts: { immediate?: boolean; runAfter?: Date | null } = {},
  ) {
    const post = await this.getPost(teacherId, postId);
    if (!post.image_url) throw new HttpError(400, 'الصورة مطلوبة');
    if (!post.targets?.length) throw new HttpError(400, 'اختر حسابًا واحدًا على الأقل');

    const settings = await this.getOrCreateSettings(teacherId);
    if (settings.paused && !opts.immediate) {
      throw new HttpError(400, 'النشر التلقائي متوقف مؤقتًا');
    }

    const runAfter =
      opts.runAfter ||
      (opts.immediate ? new Date() : post.scheduled_at ? new Date(post.scheduled_at) : new Date());

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE teacher_social_posts SET
           status = 'queued',
           scheduled_at = COALESCE(scheduled_at, $3),
           updated_at = NOW()
         WHERE id = $1 AND teacher_id = $2`,
        [postId, teacherId, runAfter],
      );

      for (const pt of post.targets) {
        if (['published', 'cancelled'].includes(pt.status)) continue;
        // Idempotency: skip if active job exists
        const existing = await client.query(
          `SELECT id FROM teacher_social_publish_jobs
           WHERE post_target_id = $1 AND status IN ('queued', 'processing', 'done')
           LIMIT 1`,
          [pt.id],
        );
        if (existing.rowCount) continue;

        await client.query(
          `UPDATE teacher_social_post_targets
           SET status = 'pending', last_error = NULL, updated_at = NOW()
           WHERE id = $1`,
          [pt.id],
        );
        await client.query(
          `INSERT INTO teacher_social_publish_jobs
             (post_id, post_target_id, teacher_id, platform, status, run_after)
           VALUES ($1, $2, $3, $4, 'queued', $5)`,
          [postId, pt.id, teacherId, pt.platform, runAfter],
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    await writeLog({
      teacherId,
      postId,
      action: 'enqueue_publish',
      status: 'ok',
      metadata: { immediate: !!opts.immediate, runAfter },
    });
    return this.getPost(teacherId, postId);
  }

  static async retryFailed(teacherId: number, postId: number) {
    const post = await this.getPost(teacherId, postId);
    await pool.query(
      `UPDATE teacher_social_post_targets
       SET status = 'pending', last_error = NULL, updated_at = NOW()
       WHERE post_id = $1 AND status = 'failed'`,
      [postId],
    );
    // Cancel old failed jobs so new ones can be created
    await pool.query(
      `UPDATE teacher_social_publish_jobs
       SET status = 'cancelled', updated_at = NOW()
       WHERE post_id = $1 AND status = 'failed'`,
      [postId],
    );
    return this.enqueuePublish(teacherId, post.id, { immediate: true });
  }

  static async claimNextJob(): Promise<SocialPublishJobRow | null> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const res = await client.query<SocialPublishJobRow>(
        `SELECT * FROM teacher_social_publish_jobs
         WHERE status = 'queued' AND run_after <= NOW()
         ORDER BY run_after ASC, id ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 1`,
      );
      if (!res.rowCount) {
        await client.query('COMMIT');
        return null;
      }
      const updated = await client.query<SocialPublishJobRow>(
        `UPDATE teacher_social_publish_jobs SET
           status = 'processing',
           locked_at = NOW(),
           attempts = attempts + 1,
           updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [res.rows[0].id],
      );
      await client.query('COMMIT');
      return updated.rows[0];
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  static async processJob(job: SocialPublishJobRow): Promise<void> {
    const postRes = await pool.query(
      `SELECT * FROM teacher_social_posts WHERE id = $1`,
      [job.post_id],
    );
    const post = postRes.rows[0];
    if (!post || post.status === 'cancelled') {
      await pool.query(
        `UPDATE teacher_social_publish_jobs
         SET status = 'cancelled', completed_at = NOW(), updated_at = NOW(),
             last_error = 'البوست ملغي'
         WHERE id = $1`,
        [job.id],
      );
      return;
    }

    const ptRes = await pool.query(
      `SELECT * FROM teacher_social_post_targets WHERE id = $1`,
      [job.post_target_id],
    );
    const pt = ptRes.rows[0];
    if (!pt || pt.status === 'published' || pt.status === 'cancelled') {
      await pool.query(
        `UPDATE teacher_social_publish_jobs
         SET status = 'done', completed_at = NOW(), updated_at = NOW()
         WHERE id = $1`,
        [job.id],
      );
      return;
    }

    try {
      await pool.query(
        `UPDATE teacher_social_posts SET status = 'publishing', updated_at = NOW() WHERE id = $1`,
        [job.post_id],
      );
      await pool.query(
        `UPDATE teacher_social_post_targets
         SET status = 'publishing', updated_at = NOW() WHERE id = $1`,
        [pt.id],
      );

      const { target, pageAccessToken } = await MetaConnectionService.getTargetForPublish(
        job.teacher_id,
        pt.target_id,
      );
      const imageUrl = publicImageUrl(post.image_url);
      const caption = String(post.caption || '');

      let externalPostId: string | null = null;
      let externalPostUrl: string | null = null;

      if (job.platform === 'facebook_page') {
        if (!target.page_id) throw new HttpError(400, 'معرف صفحة فيسبوك مفقود');
        const result = await publishFacebookPagePhoto({
          pageId: target.page_id,
          pageAccessToken,
          imageUrl,
          caption,
        });
        externalPostId = result.post_id || result.id || null;
        if (externalPostId) {
          // post_id format is often `{pageId}_{postId}`
          const permalinkId = String(externalPostId).includes('_')
            ? String(externalPostId)
            : `${target.page_id}_${externalPostId}`;
          externalPostUrl = `https://www.facebook.com/${permalinkId}`;
        }
      } else if (job.platform === 'instagram_business') {
        if (!target.ig_user_id) throw new HttpError(400, 'معرف إنستجرام مفقود');
        const container = await createInstagramMediaContainer({
          igUserId: target.ig_user_id,
          pageAccessToken,
          imageUrl,
          caption,
        });
        await waitForInstagramContainerReady({
          creationId: container.id,
          pageAccessToken,
        });
        const published = await publishInstagramMedia({
          igUserId: target.ig_user_id,
          pageAccessToken,
          creationId: container.id,
        });
        externalPostId = published.id;
        if (target.ig_username && externalPostId) {
          externalPostUrl = `https://www.instagram.com/p/${externalPostId}/`;
        }
      } else {
        throw new HttpError(400, `منصة غير مدعومة: ${job.platform}`);
      }

      await pool.query(
        `UPDATE teacher_social_post_targets SET
           status = 'published',
           external_post_id = $2,
           external_post_url = $3,
           published_at = NOW(),
           last_error = NULL,
           updated_at = NOW()
         WHERE id = $1`,
        [pt.id, externalPostId, externalPostUrl],
      );
      await pool.query(
        `UPDATE teacher_social_publish_jobs SET
           status = 'done',
           completed_at = NOW(),
           last_error = NULL,
           updated_at = NOW()
         WHERE id = $1`,
        [job.id],
      );
      await refreshPostAggregateStatus(job.post_id);
      await writeLog({
        teacherId: job.teacher_id,
        postId: job.post_id,
        postTargetId: pt.id,
        action: 'publish',
        status: 'success',
        metadata: { platform: job.platform, externalPostId },
      });

      try {
        const { NotificationService } = await import('./notifications.js');
        await NotificationService.notifyTeacherSocialPublishResult({
          userId: job.teacher_id,
          success: true,
          postId: job.post_id,
          platform: job.platform,
          postUrl: externalPostUrl,
        });
      } catch (notifyErr) {
        logger.warn({ notifyErr }, 'social publish success notify failed');
      }
    } catch (err: any) {
      const message = err instanceof HttpError ? err.message : err?.message || 'فشل النشر';
      const code = err?.details?.metaCode || err?.details?.code || err?.code || null;
      const needsReauth =
        err instanceof HttpError &&
        (err.status === 401 || err.details?.code === 'needs_reauth' || String(code) === '190');

      logger.error(
        { err: { message, code }, jobId: job.id, postId: job.post_id },
        'Social publish job failed',
      );

      await pool.query(
        `UPDATE teacher_social_post_targets SET
           status = 'failed',
           last_error = $2,
           retry_count = retry_count + 1,
           updated_at = NOW()
         WHERE id = $1`,
        [pt.id, String(message).slice(0, 1000)],
      );

      if (needsReauth) {
        const t = await pool.query<{ connection_id: number }>(
          `SELECT connection_id FROM teacher_meta_targets WHERE id = $1`,
          [pt.target_id],
        );
        if (t.rowCount) {
          await MetaConnectionService.markNeedsReauth(t.rows[0].connection_id, message);
        }
        await pool.query(
          `UPDATE teacher_social_publish_jobs SET
             status = 'needs_reauth',
             last_error = $2,
             completed_at = NOW(),
             updated_at = NOW()
           WHERE id = $1`,
          [job.id, String(message).slice(0, 1000)],
        );
      } else if (job.attempts >= MAX_ATTEMPTS) {
        await pool.query(
          `UPDATE teacher_social_publish_jobs SET
             status = 'failed',
             last_error = $2,
             completed_at = NOW(),
             updated_at = NOW()
           WHERE id = $1`,
          [job.id, String(message).slice(0, 1000)],
        );
      } else {
        const delay = RETRY_BASE_MS * Math.pow(2, Math.max(0, job.attempts - 1));
        await pool.query(
          `UPDATE teacher_social_publish_jobs SET
             status = 'queued',
             run_after = NOW() + ($2::bigint * INTERVAL '1 millisecond'),
             locked_at = NULL,
             last_error = $3,
             updated_at = NOW()
           WHERE id = $1`,
          [job.id, delay, String(message).slice(0, 1000)],
        );
      }

      await refreshPostAggregateStatus(job.post_id);
      await writeLog({
        teacherId: job.teacher_id,
        postId: job.post_id,
        postTargetId: pt.id,
        action: 'publish',
        status: needsReauth ? 'needs_reauth' : 'failed',
        errorCode: code != null ? String(code) : null,
        errorMessage: String(message).slice(0, 1000),
      });

      try {
        const { NotificationService } = await import('./notifications.js');
        await NotificationService.notifyTeacherSocialPublishResult({
          userId: job.teacher_id,
          success: false,
          postId: job.post_id,
          platform: job.platform,
          errorMessage: message,
          needsReauth,
        });
      } catch (notifyErr) {
        logger.warn({ notifyErr }, 'social publish failure notify failed');
      }
    }
  }

  static async getDashboard(teacherId: number) {
    const [targets, posts, jobs, settings] = await Promise.all([
      MetaConnectionService.listTargets(teacherId),
      pool.query(
        `SELECT status, COUNT(*)::int AS count
         FROM teacher_social_posts WHERE teacher_id = $1
         GROUP BY status`,
        [teacherId],
      ),
      pool.query(
        `SELECT status, COUNT(*)::int AS count
         FROM teacher_social_publish_jobs WHERE teacher_id = $1
         GROUP BY status`,
        [teacherId],
      ),
      this.getOrCreateSettings(teacherId),
    ]);
    const byStatus = Object.fromEntries(posts.rows.map((r) => [r.status, r.count]));
    const jobsByStatus = Object.fromEntries(jobs.rows.map((r) => [r.status, r.count]));
    return {
      connections_count: targets.length,
      facebook_count: targets.filter((t) => t.platform === 'facebook_page').length,
      instagram_count: targets.filter((t) => t.platform === 'instagram_business').length,
      needs_reauth: targets.some((t) => t.connection_status === 'needs_reauth'),
      posts_by_status: byStatus,
      jobs_by_status: jobsByStatus,
      settings,
    };
  }

  static async listLogs(teacherId: number, limit = 50) {
    const res = await pool.query(
      `SELECT id, post_id, post_target_id, action, status, error_code, error_message, metadata, created_at
       FROM teacher_social_publishing_logs
       WHERE teacher_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [teacherId, Math.min(limit, 200)],
    );
    return res.rows;
  }

  /** Create post from latest creative generation (optional bridge). */
  static async createFromGeneration(teacherId: number, generationId: number, tenantId?: number | null) {
    const gen = await pool.query(
      `SELECT id, teacher_id, generated_text, generated_image_url, platform, request_type
       FROM teacher_creative_generations
       WHERE id = $1 AND teacher_id = $2`,
      [generationId, teacherId],
    );
    if (!gen.rowCount) throw new HttpError(404, 'التوليد غير موجود');
    const g = gen.rows[0];
    if (!g.generated_image_url && !g.generated_text) {
      throw new HttpError(400, 'التوليد لا يحتوي على محتوى قابل للنشر');
    }
    if (!g.generated_image_url) {
      throw new HttpError(400, 'النشر التلقائي يتطلب صورة — ولّد تصميمًا أولًا');
    }
    return this.createPost({
      teacherId,
      tenantId,
      caption: g.generated_text || '',
      imageUrl: g.generated_image_url,
      generationId: g.id,
      contentType: 'ai_generated',
    });
  }
}

function normalizeSettings(row: any): SocialSettings {
  const parseJson = (value: unknown, fallback: any) => {
    if (Array.isArray(value) || (value && typeof value === 'object')) return value;
    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch {
        return fallback;
      }
    }
    return fallback;
  };
  return {
    teacher_id: row.teacher_id,
    auto_publish_enabled: !!row.auto_publish_enabled,
    approval_mode: row.approval_mode,
    posts_per_day: row.posts_per_day,
    publish_times: parseJson(row.publish_times, ['20:00']),
    publish_days: parseJson(row.publish_days, [0, 1, 2, 3, 4, 5, 6]),
    timezone: row.timezone || 'Africa/Cairo',
    content_types: parseJson(row.content_types, ['educational']),
    content_plan: parseJson(row.content_plan, null),
    default_target_ids: (parseJson(row.default_target_ids, []) as any[]).map(Number),
    paused: !!row.paused,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
