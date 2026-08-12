import pool from '../../../../db/pool';
import { HttpError, logger } from '../../../../utils';
import { enforcePlanFeature } from '../../../../services/teacherPlanPolicy';
import { registerWhatsAppHandler } from '../registry';
import type { HandlerResult, InboundContext, WaConversationRow } from '../types';
import { runTeacherCreativeBridge } from './bridge';
import { resolveTeacherByPhone } from '../resolveTeacher';

export const TEACHER_CREATIVE_BOT_KEY = 'teacher_creative_bot';

const NOT_TEACHER_REPLY =
  'هذا الرقم غير مسجل كمدرس على المنصة. لو عندك حساب مدرس، تأكد إن رقم الواتساب مسجل في بياناتك.';

const VOICE_UNSUPPORTED_REPLY =
  'معلش، الرسائل الصوتية مش مدعومة هنا 🙏 لو سمحت اكتب رسالتك أو ابعت صورة.';

const DEFAULT_HUMAN_MUTE_MINUTES = 60;

function isVoiceOrAudioInbound(ctx: InboundContext): boolean {
  const mimeCandidates = [
    ctx.media?.mimetype,
    typeof ctx.metadata?.media_mimetype === 'string'
      ? ctx.metadata.media_mimetype
      : null,
  ];
  for (const raw of mimeCandidates) {
    if (!raw) continue;
    const mime = raw.toLowerCase();
    if (
      mime.startsWith('audio/') ||
      mime.includes('ogg') ||
      mime.includes('opus')
    ) {
      return true;
    }
  }
  const mediaType =
    ctx.metadata?.wa_message_type ??
    ctx.metadata?.media_type ??
    ctx.metadata?.type;
  if (typeof mediaType === 'string') {
    const t = mediaType.toLowerCase();
    if (t === 'ptt' || t === 'audio' || t === 'voice' || t === 'voip') return true;
  }
  return false;
}

function getHumanMuteMinutes(ctx: InboundContext): number {
  const raw = ctx.service?.config?.human_mute_minutes;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (Number.isFinite(n) && n > 0) return Math.floor(n);
  return DEFAULT_HUMAN_MUTE_MINUTES;
}

function parseMuteUntil(meta: Record<string, unknown>): Date | null {
  const raw = meta.human_mute_until;
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function maybeResumeFromHumanMute(
  conversation: WaConversationRow,
  muteMinutes: number,
): Promise<WaConversationRow> {
  if (conversation.status === 'bot' || conversation.status === 'closed') {
    return conversation;
  }

  const now = Date.now();
  const muteUntil = parseMuteUntil(conversation.metadata || {});
  let expired = false;

  if (muteUntil) {
    expired = muteUntil.getTime() <= now;
  } else if (conversation.assigned_at) {
    const assignedAt = new Date(conversation.assigned_at).getTime();
    expired =
      Number.isFinite(assignedAt) &&
      assignedAt + muteMinutes * 60_000 <= now;
  } else {
    expired = true;
  }

  if (!expired) return conversation;

  const result = await pool.query<WaConversationRow>(
    `UPDATE wa_conversations
     SET status = 'bot',
         metadata = (COALESCE(metadata, '{}'::jsonb) - 'human_mute_until'),
         updated_at = NOW()
     WHERE id = $1
     RETURNING id, service_id, session_slug, tenant_id, student_user_id,
               contact_phone, status, metadata, wwebjs_conversation_id,
               last_message_at, assigned_at, created_at, updated_at`,
    [conversation.id],
  );

  const row = result.rows[0];
  if (!row) return conversation;

  logger.info(
    { conversationId: conversation.id },
    'teacher_creative_bot resumed after human mute expired',
  );

  return {
    ...row,
    metadata:
      typeof row.metadata === 'string'
        ? JSON.parse(row.metadata)
        : row.metadata || {},
  };
}

async function onInbound(ctx: InboundContext): Promise<HandlerResult> {
  if (!ctx.service?.is_enabled) {
    return { handled: false };
  }

  let conversation = ctx.conversation;
  if (conversation && conversation.status !== 'bot') {
    conversation = await maybeResumeFromHumanMute(
      conversation,
      getHumanMuteMinutes(ctx),
    );
    ctx = { ...ctx, conversation };

    if (conversation.status !== 'bot') {
      logger.info(
        {
          conversationId: conversation.id,
          status: conversation.status,
          humanMuteUntil: conversation.metadata?.human_mute_until ?? null,
        },
        'teacher_creative_bot skipped (human mute active)',
      );
      return { handled: true };
    }
  }

  if (!ctx.body?.trim() && !ctx.media && !ctx.mediaError) {
    logger.info(
      { waMessageId: ctx.waMessageId, fromPhone: ctx.fromPhone },
      'teacher_creative_bot skipped (empty non-media inbound)',
    );
    return { handled: true };
  }

  if (isVoiceOrAudioInbound(ctx)) {
    return {
      handled: true,
      reply: VOICE_UNSUPPORTED_REPLY,
      metadata: { voice_unsupported: true },
    };
  }

  const teacher = await resolveTeacherByPhone(ctx.fromPhone);
  if (!teacher) {
    return {
      handled: true,
      reply: NOT_TEACHER_REPLY,
      metadata: { access_denied: 'not_teacher' },
    };
  }

  try {
    await enforcePlanFeature(teacher.id, 'creative_social');
  } catch (err) {
    const message =
      err instanceof HttpError
        ? err.message
        : 'مساعد السوشيال متاح في باقة الماسي أو أعلى';
    return {
      handled: true,
      reply: message,
      metadata: {
        access_denied: 'plan',
        teacher_id: teacher.id,
      },
    };
  }

  try {
    const result = await runTeacherCreativeBridge(ctx, teacher.id);
    return {
      handled: true,
      reply: result.reply,
      mediaUrl: result.mediaUrl,
      metadata: result.metadata,
    };
  } catch (err) {
    logger.error({ err, teacherId: teacher.id }, 'teacher_creative_bot handler error');
    const message =
      err instanceof Error && err.message
        ? err.message
        : 'معلش، حصل خطأ مش متوقع. جرّب تاني بعدين.';
    return {
      handled: true,
      reply: message,
      metadata: { teacher_id: teacher.id, error: true },
    };
  }
}

export function registerTeacherCreativeBot(): void {
  registerWhatsAppHandler({
    key: TEACHER_CREATIVE_BOT_KEY,
    onInbound,
  });
  logger.info('Registered WhatsApp handler: teacher_creative_bot');
}
