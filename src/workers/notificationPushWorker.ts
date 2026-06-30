import { webPushConfig } from '../config/webPush';
import { NotificationPushQueue } from '../services/notificationPushQueue';
import { WebPushSender } from '../services/webPushSender';
import { logger } from '../utils';

let workerTimer: ReturnType<typeof setInterval> | null = null;
let processing = false;

export function startNotificationPushWorker(): void {
  if (!webPushConfig.workerEnabled) {
    logger.info('Web push worker disabled (WEB_PUSH_WORKER_ENABLED=false)');
    return;
  }
  if (!webPushConfig.enabled) {
    logger.warn('Web push worker not started — VAPID keys missing');
    return;
  }
  if (workerTimer) return;

  logger.info(
    { intervalMs: webPushConfig.workerIntervalMs, batchSize: webPushConfig.workerBatchSize },
    'Starting notification push worker',
  );

  workerTimer = setInterval(() => {
    void processBatch();
  }, webPushConfig.workerIntervalMs);

  void processBatch();
}

export function stopNotificationPushWorker(): void {
  if (workerTimer) {
    clearInterval(workerTimer);
    workerTimer = null;
  }
}

async function processBatch(): Promise<void> {
  if (processing) return;
  processing = true;
  try {
    const jobs = await NotificationPushQueue.claimBatch(webPushConfig.workerBatchSize);
    if (jobs.length === 0) return;

    logger.info({ count: jobs.length }, 'Processing web push queue batch');
    await Promise.all(
      jobs.map((job) =>
        WebPushSender.processQueueJob({
          ...job,
          attempts: job.attempts + 1,
        }),
      ),
    );
  } catch (err) {
    logger.error({ err }, 'Notification push worker batch failed');
  } finally {
    processing = false;
  }
}
