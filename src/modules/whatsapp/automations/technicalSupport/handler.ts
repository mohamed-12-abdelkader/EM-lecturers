import { logger } from '../../../../utils';
import { registerWhatsAppHandler } from '../registry';
import type { HandlerResult, InboundContext } from '../types';
import { runTechnicalSupportAgent } from './agent';

export const TECHNICAL_SUPPORT_BOT_KEY = 'technical_support_bot';

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
  if (!ctx.body?.trim() && !ctx.media) {
    logger.info(
      { waMessageId: ctx.waMessageId, fromPhone: ctx.fromPhone },
      'support bot skipped (empty non-media inbound)',
    );
    return { handled: true };
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
