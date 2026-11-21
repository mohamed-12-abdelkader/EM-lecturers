import pool from '../../../../db/pool';
import { HttpError, logger } from '../../../../utils';
import { enforcePlanFeature } from '../../../../services/teacherPlanPolicy';
import { WhatsAppOutboundQueue } from '../../queue/whatsappOutboundQueue';
import { registerWhatsAppHandler } from '../registry';
import { resolveTeacherByPhone } from '../resolveTeacher';
import type { HandlerResult, InboundContext, WaConversationRow } from '../types';
import { WA_HELP_REPLY } from './commands';
import { ExamAssistantSessionStore } from './sessionStore';
import { runExamAssistantWorkflow } from './workflow';

export const TEACHER_EXAM_BUILDER_BOT_KEY = 'teacher_exam_builder_bot';

const NOT_TEACHER_REPLY =
  'هذا الرقم غير مسجل كمدرس على المنصة. لو عندك حساب مدرس، تأكد إن رقم الواتساب مسجل في بياناتك.';

const VOICE_UNSUPPORTED_REPLY =
  'معلش، الرسائل الصوتية مش مدعومة هنا 🙏 لو سمحت اكتب طلبك نصاً أو ابعت ملف/صور.';

const DEFAULT_HUMAN_MUTE_MINUTES = 60;
const WA_CHUNK_SIZE = 3500;

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
    if (mime.startsWith('audio/') || mime.includes('ogg') || mime.includes('opus')) {
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
    expired = Number.isFinite(assignedAt) && assignedAt + muteMinutes * 60_000 <= now;
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
    'teacher_exam_builder_bot resumed after human mute expired',
  );

  return {
    ...row,
    metadata:
      typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata || {},
  };
}

function splitWhatsAppChunks(text: string, maxLen = WA_CHUNK_SIZE): string[] {
  const trimmed = String(text || '').trim();
  if (!trimmed) return [];
  if (trimmed.length <= maxLen) return [trimmed];
  const chunks: string[] = [];
  let remaining = trimmed;
  while (remaining.length > maxLen) {
    let cut = remaining.lastIndexOf('\n\n', maxLen);
    if (cut < maxLen * 0.5) cut = remaining.lastIndexOf('\n', maxLen);
    if (cut < maxLen * 0.5) cut = remaining.lastIndexOf(' ', maxLen);
    if (cut < maxLen * 0.5) cut = maxLen;
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks.filter(Boolean);
}

async function enqueueChunks(
  ctx: InboundContext,
  chunks: string[],
  metadata: Record<string, unknown>,
): Promise<string> {
  const first = chunks[0] || '';
  const rest = chunks.slice(1);
  if (rest.length && ctx.conversation && ctx.service) {
    for (let i = 0; i < rest.length; i += 1) {
      await WhatsAppOutboundQueue.enqueue({
        sessionSlug: ctx.conversation.session_slug,
        to: ctx.fromPhone,
        body: rest[i],
        serviceId: ctx.service.id,
        conversationId: ctx.conversation.id,
        tenantId: ctx.conversation.tenant_id,
        triggerType: 'inbound_reply_chunk',
        triggerRef: `${ctx.waMessageId}:chunk:${i + 2}`,
        metadata: {
          ...metadata,
          chunk_index: i + 2,
          chunk_total: chunks.length,
        },
        scheduledAt: new Date(Date.now() + (i + 1) * 750),
      });
    }
  }
  return first;
}

async function onInbound(ctx: InboundContext): Promise<HandlerResult> {
  if (!ctx.service?.is_enabled) {
    return { handled: false };
  }

  let conversation = ctx.conversation;
  if (conversation && conversation.status !== 'bot') {
    conversation = await maybeResumeFromHumanMute(conversation, getHumanMuteMinutes(ctx));
    ctx = { ...ctx, conversation };

    if (conversation.status !== 'bot') {
      logger.info(
        {
          conversationId: conversation.id,
          status: conversation.status,
          humanMuteUntil: conversation.metadata?.human_mute_until ?? null,
        },
        'teacher_exam_builder_bot skipped (human mute active)',
      );
      return { handled: true };
    }
  }

  if (!ctx.body?.trim() && !ctx.media && !ctx.mediaError) {
    logger.info(
      { waMessageId: ctx.waMessageId, fromPhone: ctx.fromPhone },
      'teacher_exam_builder_bot skipped (empty non-media inbound)',
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
    await enforcePlanFeature(teacher.id, 'exam_builder_ai');
  } catch (err) {
    const message =
      err instanceof HttpError
        ? err.message
        : 'إنشاء الامتحانات بالـ AI متاح في باقة الذهبية أو أعلى';
    return {
      handled: true,
      reply: message,
      metadata: { access_denied: 'plan', teacher_id: teacher.id },
    };
  }

  const normalized = (ctx.body || '').trim().toLowerCase();
  if (['مساعدة', 'مساعده', 'help', 'مرحبا', 'اهلا', 'أهلا'].includes(normalized)) {
    return {
      handled: true,
      reply: WA_HELP_REPLY,
      metadata: { teacher_id: teacher.id, action: 'help' },
    };
  }

  try {
    const result = await runExamAssistantWorkflow(ctx, teacher.id);
    if (result.session?.id && ctx.conversation?.id) {
      await pool.query(
        `UPDATE wa_conversations
         SET metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb,
             updated_at = NOW()
         WHERE id = $1`,
        [
          ctx.conversation.id,
          JSON.stringify({
            teacher_id: teacher.id,
            exam_assistant_session_id: result.session.id,
            exam_assistant_state: result.session.state,
            exam_builder_session_id: result.session.exam_builder_session_id,
          }),
        ],
      );
    }

    const chunks = splitWhatsAppChunks(result.reply);
    const metadata = {
      teacher_id: teacher.id,
      exam_assistant_session_id: result.session?.id ?? null,
      exam_assistant_state: result.session?.state ?? null,
      ...(result.metadata || {}),
    };
    const reply = await enqueueChunks(ctx, chunks, metadata);
    return {
      handled: true,
      reply,
      metadata: {
        ...metadata,
        chunk_total: chunks.length,
        chunk_index: 1,
      },
    };
  } catch (err) {
    logger.error({ err, teacherId: teacher.id }, 'teacher_exam_builder_bot handler error');
    const message =
      err instanceof HttpError
        ? err.message
        : err instanceof Error && err.message
          ? err.message
          : 'معلش، حصل خطأ مش متوقع. جرّب تاني بعدين.';
    return {
      handled: true,
      reply: message,
      metadata: { teacher_id: teacher.id, error: true },
    };
  }
}

export function registerTeacherExamBuilderBot(): void {
  registerWhatsAppHandler({
    key: TEACHER_EXAM_BUILDER_BOT_KEY,
    onInbound,
  });
  logger.info('Registered WhatsApp handler: teacher_exam_builder_bot');
}

/** Admin helper export */
export async function listExamAssistantSessionsForAdmin(limit = 50) {
  return ExamAssistantSessionStore.listForAdmin({ limit });
}

export { ExamAssistantSessionStore };
