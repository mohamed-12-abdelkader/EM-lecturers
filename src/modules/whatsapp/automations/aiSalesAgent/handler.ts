import { logger } from '../../../../utils';
import { registerWhatsAppHandler } from '../registry';
import type { HandlerResult, InboundContext } from '../types';
import { runSalesAgent } from './agent';
import { AI_SALES_AGENT_KEY } from './constants';
import { SalesAgentSessionStore } from './sessionStore';
import { SalesLeadStore } from './leadStore';

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

async function onInbound(ctx: InboundContext): Promise<HandlerResult> {
  if (!ctx.service?.is_enabled) return { handled: false };

  if (ctx.conversation && ctx.conversation.status !== 'bot') {
    logger.info(
      { conversationId: ctx.conversation.id, status: ctx.conversation.status },
      'sales agent skipped (conversation not in bot mode)',
    );
    return { handled: true };
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

  // paused/archived stay silent; error is treated as recoverable and re-activated
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

    // Clear previous last_error after a successful reply
    if (result.reply && salesSession.last_error) {
      await SalesAgentSessionStore.update(salesSession.id, { last_error: null }).catch(
        () => undefined,
      );
    }

    if (result.escalate && ctx.conversation?.id) {
      await SalesLeadStore.update(Number(result.metadata?.lead_id), salesSession.id, {
        ai_enabled: false,
      }).catch(() => undefined);
    }

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
    // Keep session active — only store the error for the admin UI
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
