import { logger } from '../utils';
import { TeacherSocialPublishingService } from '../services/teacherSocialPublishing';

let workerTimer: ReturnType<typeof setInterval> | null = null;
let processing = false;

const INTERVAL_MS = 4000;

export function startSocialPublishWorker(): void {
  if (workerTimer) return;
  logger.info({ intervalMs: INTERVAL_MS }, 'Starting social publish worker');
  workerTimer = setInterval(() => {
    void processNext();
  }, INTERVAL_MS);
  void processNext();
}

export function stopSocialPublishWorker(): void {
  if (workerTimer) {
    clearInterval(workerTimer);
    workerTimer = null;
  }
}

async function processNext(): Promise<void> {
  if (processing) return;
  processing = true;
  try {
    // Process up to 3 jobs per tick to keep throughput without overlapping
    for (let i = 0; i < 3; i++) {
      const job = await TeacherSocialPublishingService.claimNextJob();
      if (!job) break;
      logger.info(
        { jobId: job.id, postId: job.post_id, platform: job.platform },
        'Social publish job claimed',
      );
      await TeacherSocialPublishingService.processJob(job);
    }
  } catch (err) {
    logger.error({ err }, 'Social publish worker tick failed');
  } finally {
    processing = false;
  }
}
