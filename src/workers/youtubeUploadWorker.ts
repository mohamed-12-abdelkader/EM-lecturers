import { logger } from '../utils';
import { YoutubeAdminUploadsService } from '../services/youtubeAdminUploads';

let workerTimer: ReturnType<typeof setInterval> | null = null;
let processing = false;

const INTERVAL_MS = 3000;

export function startYoutubeUploadWorker(): void {
  if (workerTimer) return;
  logger.info({ intervalMs: INTERVAL_MS }, 'Starting YouTube upload worker');
  workerTimer = setInterval(() => {
    void processNext();
  }, INTERVAL_MS);
  void processNext();
}

export function stopYoutubeUploadWorker(): void {
  if (workerTimer) {
    clearInterval(workerTimer);
    workerTimer = null;
  }
}

async function processNext(): Promise<void> {
  if (processing) return;
  processing = true;
  try {
    const job = await YoutubeAdminUploadsService.claimNextQueuedJob();
    if (!job) return;
    logger.info({ jobId: job.id, meetingId: job.meeting_id }, 'YouTube upload job claimed');
    await YoutubeAdminUploadsService.processJob(job);
  } catch (err) {
    logger.error({ err }, 'YouTube upload worker tick failed');
  } finally {
    processing = false;
  }
}
