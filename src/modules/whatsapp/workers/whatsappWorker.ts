import axios from 'axios';
import { whatsappConfig } from '../config/whatsapp';
import { WhatsAppOutboundQueue } from '../queue/whatsappOutboundQueue';
import { sendMessage, isWhatsAppConfigured } from '../gateway/whatsappGatewayClient';
import { logger } from '../../../utils';

let workerTimer: ReturnType<typeof setInterval> | null = null;
let processing = false;

export function startWhatsAppWorker(): void {
  if (!whatsappConfig.workerEnabled) {
    logger.info('WhatsApp worker disabled (WHATSAPP_WORKER_ENABLED=false)');
    return;
  }
  if (!isWhatsAppConfigured()) {
    logger.warn('WhatsApp worker not started — WHATSAPP_API_KEY missing');
    return;
  }
  if (workerTimer) return;

  logger.info(
    {
      intervalMs: whatsappConfig.workerIntervalMs,
      batchSize: whatsappConfig.workerBatchSize,
    },
    'Starting WhatsApp outbound worker',
  );

  workerTimer = setInterval(() => {
    void processBatch();
  }, whatsappConfig.workerIntervalMs);

  void processBatch();
}

export function stopWhatsAppWorker(): void {
  if (workerTimer) {
    clearInterval(workerTimer);
    workerTimer = null;
  }
}

async function processBatch(): Promise<void> {
  if (processing) return;
  processing = true;
  try {
    const jobs = await WhatsAppOutboundQueue.claimBatch(whatsappConfig.workerBatchSize);
    if (jobs.length === 0) return;

    logger.info({ count: jobs.length }, 'Processing WhatsApp outbound queue batch');

    await Promise.all(
      jobs.map(async (job) => {
        const attempts = job.attempts + 1;
        try {
          await sendMessage({
            sessionId: job.session_slug,
            to: job.to_phone,
            body: job.body || undefined,
            media: job.media_url ? { url: job.media_url } : undefined,
            metadata: {
              ...(job.metadata || {}),
              job_id: job.id,
              service_id: job.service_id,
              trigger_type: job.trigger_type,
            },
          });
          await WhatsAppOutboundQueue.markSent(job.id);
        } catch (err) {
          const detail = axios.isAxiosError(err)
            ? JSON.stringify(err.response?.data ?? err.message)
            : err instanceof Error
              ? err.message
              : String(err);
          const retry = attempts < job.max_attempts;
          await WhatsAppOutboundQueue.markFailed(job.id, detail, retry, attempts);
          logger.warn(
            { jobId: job.id, attempts, retry, err: detail },
            'WhatsApp outbound job failed',
          );
        }
      }),
    );
  } catch (err) {
    logger.error({ err }, 'WhatsApp outbound worker batch failed');
  } finally {
    processing = false;
  }
}
