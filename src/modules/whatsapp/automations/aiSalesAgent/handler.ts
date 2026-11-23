import pool from '../../../../db/pool';
import { logger } from '../../../../utils';
import { registerWhatsAppHandler } from '../registry';
import type { HandlerResult, InboundContext, WaConversationRow } from '../types';
import { runSalesAgent } from './agent';
import { AI_SALES_AGENT_KEY } from './constants';
import { SalesAgentSessionStore } from './sessionStore';

const DEFAULT_HUMAN_MUTE_MINUTES = 60;

function isVoiceOrAudioInbound(ctx: InboundContext): boolean {
  const mimeCandidates = [
    ctx.media?.mimetype,
    typeof ctx.metadata?.media_mimetype === 'string' ? ctx.metadata.media_mimetype : null,
  ];
  for (const raw of mimeCandidates) {
    if (!raw) continue;
    const mime = raw.toLowerCase();
    if (mime.startsWith('audio/') || mime.includes('ogg') || mime.includes('opus')) return true;
  }
  const mediaType =
    ctx.metadata?.wa_message_type ?? ctx.metadata?.media_type ?? ctx.metadata?.type;
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

/**
 * If a human replied from the inbox, AI is muted for ~1 hour.
 * After mute expires, resume bot mode automatically.
 */
async function maybeResumeFromHumanMute(
  conversation: WaConversationRow,
  muteMinutes: number,
): Promise<WaConversationRow> {
  if (conversation.status === 'bot' || conversation.status === 'closed') {
    return conversation;
  }
  // waiting_human = team notified, AI should keep talking
  if (conversation.status === 'waiting_human') {
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

  logger.info({ conversationId: conversation.id }, 'sales agent resumed after human mute expired');
  return {
    ...row,
    metadata:
      typeof row.metadata === 'string' ? JSON.parse(row.metadata as any) : row.metadata || {},
  };
}

async function onInbound(ctx: InboundContext): Promise<HandlerResult> {
  if (!ctx.service?.is_enabled) return { handled: false };

  let conversation = ctx.conversation;
  if (conversation && conversation.status !== 'bot') {
    conversation = await maybeResumeFromHumanMute(conversation, getHumanMuteMinutes(ctx));
    ctx = { ...ctx, conversation };

    // Human actively owns the chat (inbox reply) → mute AI until timer ends
    if (conversation.status === 'human' || conversation.status === 'closed') {
      logger.info(
        {
          conversationId: conversation.id,
          status: conversation.status,
          humanMuteUntil: conversation.metadata?.human_mute_until ?? null,
        },
        'sales agent skipped (human mute active)',
      );
      // Dashboard: human took over → clear "needs human" flag for this lead
      await pool
        .query(
          `UPDATE wa_sales_leads
           SET last_action = 'human_handling',
               memory = COALESCE(memory, '{}'::jsonb) || '{"needs_human":false}'::jsonb,
               updated_at = NOW()
           WHERE conversation_id = $1
             AND (
               last_action IN ('escalate_human','needs_human')
               OR COALESCE((memory->>'needs_human')::boolean, FALSE) = TRUE
             )`,
          [conversation.id],
        )
        .catch(() => undefined);
      return { handled: true };
    }
  }

  if (!ctx.body?.trim() && !ctx.media && !ctx.mediaError) {
    return { handled: true };
  }

  if (isVoiceOrAudioInbound(ctx)) {
    return {
      handled: true,
      reply: 'معلش الرسائل الصوتية مش متاحة حالياً 🙏 ابعتلي رسالتك كتابة وأنا معاك.',
      metadata: { voice_unsupported: true },
    };
  }

  const salesSession = await SalesAgentSessionStore.resolveForInbound(ctx.sessionSlug);
  if (!salesSession) {
    logger.warn(
      { sessionSlug: ctx.sessionSlug },
      'sales agent: no sales session bound to this WhatsApp session',
    );
    return {
      handled: true,
      reply:
        'الخدمة شغالة لكن مفيش Sales Session مربوطة على الرقم ده. راجع لوحة التحكم واربط الجلسة برقم واتساب.',
      metadata: { unbound_session: true },
    };
  }

  if (salesSession.status === 'paused' || salesSession.status === 'archived') {
    return { handled: true, metadata: { skipped: true, reason: 'session_not_active' } };
  }
  if (salesSession.status === 'draft') {
    return {
      handled: true,
      reply: 'جلسة المبيعات لسه مسودة. من لوحة التحكم اضغط «تشغيل» بعد ربط الرقم.',
      metadata: { skipped: true, reason: 'session_draft' },
    };
  }
  if (salesSession.status === 'error') {
    await SalesAgentSessionStore.setStatus(salesSession.id, 'active', null).catch(() => undefined);
    salesSession.status = 'active';
  }

  try {
    const result = await runSalesAgent({ ctx, session: salesSession });
    if (result.metadata?.skipped && !result.reply) {
      return { handled: true, metadata: result.metadata };
    }

    if (result.reply && salesSession.last_error) {
      await SalesAgentSessionStore.update(salesSession.id, { last_error: null }).catch(
        () => undefined,
      );
    }

    // escalate → waiting_human in inbox, AI keeps chatting until a human replies
    return {
      handled: true,
      reply: result.reply || undefined,
      escalate: result.escalate,
      metadata: result.metadata,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(
      { err, sessionSlug: ctx.sessionSlug, salesSessionId: salesSession.id, message },
      'sales agent handler failed',
    );
    await SalesAgentSessionStore.update(salesSession.id, {
      last_error: message.slice(0, 500),
    }).catch(() => undefined);
    return {
      handled: true,
      reply: 'حاضر، ثانية واحدة… حصل خطأ بسيط. جرّب تبعت تاني ولو استمرت المشكلة فريقنا هيتابع.',
      metadata: { error: true, last_error: message.slice(0, 300) },
    };
  }
}

export function registerAiSalesAgentHandler(): void {
  registerWhatsAppHandler({
    key: AI_SALES_AGENT_KEY,
    onInbound,
  });
}
