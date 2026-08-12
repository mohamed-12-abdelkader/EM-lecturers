import { logger } from '../../../../utils';
import { registerWhatsAppHandler } from '../registry';
import type { HandlerResult, InboundContext } from '../types';
import { runTechnicalSupportAgent } from './agent';

export const TECHNICAL_SUPPORT_BOT_KEY = 'technical_support_bot';

const VOICE_UNSUPPORTED_REPLY =
  'معلش، الرسائل الصوتية مش مدعومة هنا 🙏 لو سمحت اكتب رسالتك نص عشان أقدر أساعدك.';

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
  // Gateway may mark voice notes as type ptt even when media download fails
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

async function onInbound(ctx: InboundContext): Promise<HandlerResult> {
  if (!ctx.service?.is_enabled) {
    return { handled: false };
  }

  // Do not auto-reply when a human owns the conversation
  if (ctx.conversation && ctx.conversation.status !== 'bot') {
    logger.info(
      {
        conversationId: ctx.conversation.id,
        status: ctx.conversation.status,
      },
      'support bot skipped (conversation not in bot mode)',
    );
    return { handled: true };
  }

  // Chat-open / protocol noise often arrives as empty bodies with distinct wa_message_ids.
  // Replying to each produces 3–4 greetings when a user first starts chatting.
  // Keep media_error events — gateway failed to download the image; agent should ask to resend.
  if (!ctx.body?.trim() && !ctx.media && !ctx.mediaError) {
    logger.info(
      { waMessageId: ctx.waMessageId, fromPhone: ctx.fromPhone },
      'support bot skipped (empty non-media inbound)',
    );
    return { handled: true };
  }

  if (isVoiceOrAudioInbound(ctx)) {
    logger.info(
      {
        waMessageId: ctx.waMessageId,
        fromPhone: ctx.fromPhone,
        mime: ctx.media?.mimetype || ctx.metadata?.media_mimetype || null,
      },
      'support bot rejected voice/audio inbound',
    );
    return {
      handled: true,
      reply: VOICE_UNSUPPORTED_REPLY,
      metadata: { voice_unsupported: true },
    };
  }

  try {
    const result = await runTechnicalSupportAgent(ctx);
    return {
      handled: true,
      reply: result.reply,
      escalate: result.escalate,
      metadata: result.metadata,
    };
  } catch (err) {
    logger.error({ err }, 'technical_support_bot handler error');
    return {
      handled: true,
      reply:
        'معلش، حصل خطأ مش متوقع. جرّب تاني بعدين أو كلّم المدرس.',
    };
  }
}

export function registerTechnicalSupportBot(): void {
  registerWhatsAppHandler({
    key: TECHNICAL_SUPPORT_BOT_KEY,
    onInbound,
  });
  logger.info('Registered WhatsApp handler: technical_support_bot');
}
