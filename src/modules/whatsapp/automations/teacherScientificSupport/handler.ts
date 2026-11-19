import pool from '../../../../db/pool';
import { logger } from '../../../../utils';
import {
  getTeacherPackage,
  hasPlanFeature,
} from '../../../../services/teacherPlanPolicy';
import { ScientificChatbotService } from '../../../../services/scientificChatbot';
import { registerWhatsAppHandler } from '../registry';
import { resolveStudentByPhone } from '../resolveStudent';
import type { HandlerResult, InboundContext, WaConversationRow } from '../types';
import { runStudentScientificBridge } from '../studentScientific/bridge';
import { TEACHER_SCIENTIFIC_SUPPORT_KEY } from './constants';

const NOT_STUDENT_REPLY =
  'هذا الرقم غير مسجل كطالب على المنصة. لو عندك حساب طالب، تأكد إن رقم الواتساب هو نفس الرقم المسجل.';

const VOICE_UNSUPPORTED_REPLY =
  'معلش، الرسائل الصوتية مش مدعومة هنا 🙏 لو سمحت اكتب سؤالك نص أو ابعت صورة من المنهج.';

const NOT_ENROLLED_REPLY =
  'لازم تكون مشترك في كورس لهذا المدرس عشان تستخدم المساعد العلمي على واتساب.';

const NO_CONTENT_REPLY =
  'المدرس لسه ما رفعش مواد للمساعد العلمي. حاول تاني بعد ما يرفع الملفات.';

const PLAN_DENIED_REPLY =
  'المساعد العلمي غير متاح حالياً لهذا المدرس.';

const SESSION_TEACHER_MISSING_REPLY =
  'الخدمة مش مربوطة بمدرس حالياً. تواصل مع الدعم.';

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

async function resolveTeacherIdFromSession(
  sessionSlug: string,
): Promise<number | null> {
  const res = await pool.query<{ teacher_id: number | null }>(
    `SELECT teacher_id FROM wa_sessions WHERE slug = $1`,
    [sessionSlug],
  );
  const id = res.rows[0]?.teacher_id;
  return id != null && Number.isFinite(Number(id)) ? Number(id) : null;
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
        },
        'teacher_scientific_support skipped (human mute active)',
      );
      return { handled: true };
    }
  }

  if (!ctx.body?.trim() && !ctx.media && !ctx.mediaError) {
    return { handled: true };
  }

  if (isVoiceOrAudioInbound(ctx)) {
    return {
      handled: true,
      reply: VOICE_UNSUPPORTED_REPLY,
      metadata: { voice_unsupported: true },
    };
  }

  const teacherId = await resolveTeacherIdFromSession(ctx.sessionSlug);
  if (!teacherId) {
    return {
      handled: true,
      reply: SESSION_TEACHER_MISSING_REPLY,
      metadata: { access_denied: 'session_not_teacher_owned' },
    };
  }

  const student = await resolveStudentByPhone(ctx.fromPhone);
  if (!student) {
    return {
      handled: true,
      reply: NOT_STUDENT_REPLY,
      metadata: { access_denied: 'not_student', teacher_id: teacherId },
    };
  }

  const pkg = await getTeacherPackage(teacherId);
  if (!hasPlanFeature(pkg, 'scientific_support')) {
    return {
      handled: true,
      reply: PLAN_DENIED_REPLY,
      metadata: {
        student_id: student.id,
        teacher_id: teacherId,
        access_denied: 'plan',
      },
    };
  }

  const subscribed = await ScientificChatbotService.studentHasTeacherSubscription(
    student.id,
    teacherId,
  );
  if (!subscribed) {
    return {
      handled: true,
      reply: NOT_ENROLLED_REPLY,
      metadata: {
        student_id: student.id,
        teacher_id: teacherId,
        access_denied: 'not_enrolled',
      },
    };
  }

  const hasContent = await ScientificChatbotService.teacherHasContent(teacherId);
  if (!hasContent) {
    return {
      handled: true,
      reply: NO_CONTENT_REPLY,
      metadata: {
        student_id: student.id,
        teacher_id: teacherId,
        access_denied: 'no_content',
      },
    };
  }

  try {
    const result = await runStudentScientificBridge(ctx, student.id, teacherId);
    return {
      handled: true,
      reply: result.reply,
      metadata: {
        ...result.metadata,
        teacher_scoped: true,
        service: TEACHER_SCIENTIFIC_SUPPORT_KEY,
      },
    };
  } catch (err) {
    logger.error(
      { err, studentId: student.id, teacherId },
      'teacher_scientific_support handler error',
    );
    const message =
      err instanceof Error && err.message
        ? err.message
        : 'معلش، حصل خطأ مش متوقع. جرّب تاني بعدين.';
    return {
      handled: true,
      reply: message,
      metadata: {
        student_id: student.id,
        teacher_id: teacherId,
        error: true,
      },
    };
  }
}

export function registerTeacherScientificSupport(): void {
  registerWhatsAppHandler({
    key: TEACHER_SCIENTIFIC_SUPPORT_KEY,
    onInbound,
  });
  logger.info(`Registered WhatsApp handler: ${TEACHER_SCIENTIFIC_SUPPORT_KEY}`);
}
