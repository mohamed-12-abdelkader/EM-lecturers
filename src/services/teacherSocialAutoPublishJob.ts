import pool from '../db/pool';
import { logger } from '../utils';
import { TeacherCreativeChatbotService } from './teacherCreativeChatbot';
import { TeacherSocialPublishingService } from './teacherSocialPublishing';
import { NotificationService } from './notifications';

const CONTENT_PROMPTS: Record<string, string> = {
  educational: 'صمم بوست تعليمي جذاب لمادة المدرس مع نصيحة دراسية قصيرة ومفيدة للطلاب',
  tips: 'صمم بوست نصائح عملية للطلاب حول المذاكرة والتنظيم',
  motivation: 'صمم بوست تحفيزي قصير يشجع الطلاب على الاستمرار',
  announcement: 'صمم بوست تذكير/إعلان بسيط عن أهمية المتابعة مع المدرس',
  scientific: 'صمم بوست معلومة علمية مبسطة مرتبطة بمادة المدرس',
  interactive: 'صمم بوست سؤال تفاعلي قصير للطلاب يشجعهم على التعليق',
  light: 'صمم بوست خفيف وإيجابي مناسب لنهاية الأسبوع للطلاب',
  review: 'صمم بوست مراجعة سريعة لنقطة مهمة في المنهج',
};

function localParts(timezone: string): { day: number; hhmm: string; dateKey: string } {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone || 'Africa/Cairo',
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
  const weekday = get('weekday');
  const map: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const day = map[weekday] ?? new Date().getDay();
  const hhmm = `${get('hour')}:${get('minute')}`;
  const dateKey = `${get('year')}-${get('month')}-${get('day')}`;
  return { day, hhmm, dateKey };
}

function nearSlot(hhmm: string, slots: string[], windowMinutes = 4): boolean {
  const [h, m] = hhmm.split(':').map(Number);
  const nowMins = h * 60 + m;
  return slots.some((slot) => {
    const [sh, sm] = String(slot).split(':').map(Number);
    if (Number.isNaN(sh) || Number.isNaN(sm)) return false;
    const slotMins = sh * 60 + sm;
    const diff = Math.abs(nowMins - slotMins);
    return diff <= windowMinutes;
  });
}

/**
 * Sweeper: for teachers with auto-publish enabled, generate + queue posts
 * when local time matches configured slots. Idempotent via daily slot key in logs metadata.
 */
export async function runTeacherSocialAutoPublishTick(): Promise<void> {
  const settingsRes = await pool.query(
    `SELECT * FROM teacher_social_settings
     WHERE auto_publish_enabled = TRUE
       AND paused = FALSE
       AND approval_mode IN ('auto', 'approval')
       AND posts_per_day > 0`,
  );

  for (const row of settingsRes.rows) {
    try {
      await processTeacherAuto(row);
    } catch (err) {
      logger.error({ err, teacherId: row.teacher_id }, 'auto-publish teacher failed');
    }
  }
}

async function processTeacherAuto(row: any) {
  const settings = await TeacherSocialPublishingService.getOrCreateSettings(row.teacher_id);
  const { day, hhmm, dateKey } = localParts(settings.timezone);
  if (!settings.publish_days.map(Number).includes(day)) return;
  if (!nearSlot(hhmm, settings.publish_times)) return;

  const slotKey = `${dateKey}|${hhmm.slice(0, 4)}0`; // bucket by 10-min to reduce duplicates within window
  // Better: use exact matched slot
  const matchedSlot =
    settings.publish_times.find((s) => nearSlot(hhmm, [s])) || settings.publish_times[0];
  const idempotencyKey = `auto:${row.teacher_id}:${dateKey}:${matchedSlot}`;

  const already = await pool.query(
    `SELECT id FROM teacher_social_publishing_logs
     WHERE teacher_id = $1 AND action = 'auto_generate' AND metadata->>'idempotency_key' = $2
     LIMIT 1`,
    [row.teacher_id, idempotencyKey],
  );
  if (already.rowCount) return;

  const todayCount = await pool.query(
    `SELECT COUNT(*)::int AS count FROM teacher_social_posts
     WHERE teacher_id = $1
       AND created_at AT TIME ZONE $2 >= date_trunc('day', NOW() AT TIME ZONE $2)`,
    [row.teacher_id, settings.timezone],
  );
  if ((todayCount.rows[0]?.count || 0) >= settings.posts_per_day) return;

  const plan =
    (typeof row.content_plan === 'object' && row.content_plan) ||
    settings.content_types?.[0] ||
    {};
  const contentType =
    (typeof plan === 'object' ? plan[String(day)] : null) ||
    settings.content_types?.[0] ||
    'educational';
  const prompt =
    CONTENT_PROMPTS[contentType] || CONTENT_PROMPTS.educational;

  // Mark idempotency early to prevent double generation under concurrent ticks
  await pool.query(
    `INSERT INTO teacher_social_publishing_logs
       (teacher_id, action, status, metadata)
     VALUES ($1, 'auto_generate', 'started', $2::jsonb)`,
    [row.teacher_id, JSON.stringify({ idempotency_key: idempotencyKey, contentType, slotKey })],
  );

  const image = await TeacherCreativeChatbotService.generateImage(row.teacher_id, {
    prompt,
    platform: 'facebook',
    aspect_ratio: '1:1',
    language_mode: 'arabic',
  });

  let caption = prompt;
  try {
    const postText = await TeacherCreativeChatbotService.generatePost(row.teacher_id, {
      prompt: `اكتب كابشن عربي مناسب لهذا البوست (${contentType}) بدون مقدمة طويلة`,
      platform: 'facebook',
      tone: 'friendly',
    });
    caption = postText.generated_text || caption;
  } catch {
    // caption fallback = prompt
  }

  const imageUrl = image.generated_image_url;
  if (!imageUrl) {
    await pool.query(
      `INSERT INTO teacher_social_publishing_logs
         (teacher_id, action, status, error_message, metadata)
       VALUES ($1, 'auto_generate', 'failed', 'no image', $2::jsonb)`,
      [row.teacher_id, JSON.stringify({ idempotency_key: idempotencyKey })],
    );
    return;
  }

  const post = await TeacherSocialPublishingService.createPost({
    teacherId: row.teacher_id,
    caption,
    imageUrl,
    generationId: image.id,
    contentType,
    targetIds: settings.default_target_ids,
  });

  if (settings.approval_mode === 'approval' || post.status === 'pending_approval') {
    await NotificationService.notifyTeacherSocialPendingApproval(row.teacher_id, post.id);
  } else if (settings.approval_mode === 'auto') {
    await TeacherSocialPublishingService.enqueuePublish(row.teacher_id, post.id, {
      immediate: true,
    });
  }

  await pool.query(
    `INSERT INTO teacher_social_publishing_logs
       (teacher_id, post_id, action, status, metadata)
     VALUES ($1, $2, 'auto_generate', 'ok', $3::jsonb)`,
    [
      row.teacher_id,
      post.id,
      JSON.stringify({ idempotency_key: idempotencyKey, contentType }),
    ],
  );
}

let autoTimer: ReturnType<typeof setInterval> | null = null;

export function startTeacherSocialAutoPublishSweeper(): void {
  if (autoTimer) return;
  const intervalMs = 60_000;
  logger.info({ intervalMs }, 'Starting social auto-publish sweeper');
  autoTimer = setInterval(() => {
    void runTeacherSocialAutoPublishTick().catch((err) =>
      logger.error({ err }, 'social auto-publish tick failed'),
    );
  }, intervalMs);
  void runTeacherSocialAutoPublishTick().catch(() => undefined);
}

export function stopTeacherSocialAutoPublishSweeper(): void {
  if (autoTimer) {
    clearInterval(autoTimer);
    autoTimer = null;
  }
}
