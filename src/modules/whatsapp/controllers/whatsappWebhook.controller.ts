import { Router } from 'express';
import { asyncWrapper } from '../../../utils';
import { WhatsAppInboundService } from '../services/whatsappInbound.service';
import { logger } from '../../../utils';

export const whatsappWebhookRouter = Router();

/**
 * POST /api/webhooks/whatsapp
 * Signed inbound webhook from wwebjs gateway.
 */
whatsappWebhookRouter.post(
  '/',
  asyncWrapper(async (req, res) => {
    const signature = req.header('x-wa-signature') || undefined;
    const rawBody = req.rawBody;

    if (!WhatsAppInboundService.verify(rawBody, signature)) {
      logger.warn(
        {
          signature: signature ? `${signature.slice(0, 20)}…` : null,
          rawLength: rawBody?.length ?? 0,
        },
        'WhatsApp webhook signature invalid',
      );
      return res.status(401).json({ success: false, message: 'Invalid signature' });
    }

    const result = await WhatsAppInboundService.process(req.body || {});
    if (!result.ok) {
      return res.status(400).json({ success: false, message: 'Invalid webhook payload' });
    }

    res.status(200).json({
      success: true,
      duplicate: result.duplicate === true,
      conversation_id: result.conversationId ?? null,
      service_key: result.serviceKey ?? null,
    });
  }),
);
