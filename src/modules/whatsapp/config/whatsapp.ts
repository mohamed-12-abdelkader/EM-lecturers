import { config } from '../../../utils';

export const whatsappConfig = {
  gatewayUrl: config.WHATSAPP_GATEWAY_URL,
  apiKey: config.WHATSAPP_API_KEY,
  webhookSecret: config.WHATSAPP_WEBHOOK_SECRET,
  workerEnabled: config.WHATSAPP_WORKER_ENABLED,
  workerIntervalMs: config.WHATSAPP_WORKER_INTERVAL_MS,
  workerBatchSize: config.WHATSAPP_WORKER_BATCH_SIZE,
  maxAttempts: config.WHATSAPP_MAX_ATTEMPTS,
  get configured(): boolean {
    return Boolean(config.WHATSAPP_GATEWAY_URL && config.WHATSAPP_API_KEY);
  },
};
