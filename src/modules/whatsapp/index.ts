export { whatsappAdminRouter } from './controllers/whatsappAdmin.controller';
export { whatsappWebhookRouter } from './controllers/whatsappWebhook.controller';
export { startWhatsAppWorker, stopWhatsAppWorker } from './workers/whatsappWorker';
export { WhatsAppOutboundQueue } from './queue/whatsappOutboundQueue';
export { SessionPoolService } from './routing/sessionPool.service';
export { registerWhatsAppHandler, getWhatsAppHandler } from './automations/registry';
export { isWhatsAppConfigured, normalizePhone, sendMessage } from './gateway/whatsappGatewayClient';

// Register chatbot handlers (side effects)
import './automations/technicalSupport';
