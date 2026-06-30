import webpush from 'web-push';
import { config } from '../utils';

/** VAPID + worker settings (requires VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in env). */
export const webPushConfig = {
  enabled: Boolean(config.VAPID_PUBLIC_KEY && config.VAPID_PRIVATE_KEY),
  publicKey: config.VAPID_PUBLIC_KEY,
  privateKey: config.VAPID_PRIVATE_KEY,
  subject: config.VAPID_SUBJECT,
  workerEnabled: config.WEB_PUSH_WORKER_ENABLED,
  workerIntervalMs: config.WEB_PUSH_WORKER_INTERVAL_MS,
  workerBatchSize: config.WEB_PUSH_WORKER_BATCH_SIZE,
  maxAttempts: config.WEB_PUSH_MAX_ATTEMPTS,
};

let vapidConfigured = false;

export function ensureVapidConfigured(): boolean {
  if (!webPushConfig.enabled) return false;
  if (vapidConfigured) return true;
  webpush.setVapidDetails(webPushConfig.subject, webPushConfig.publicKey, webPushConfig.privateKey);
  vapidConfigured = true;
  return true;
}
