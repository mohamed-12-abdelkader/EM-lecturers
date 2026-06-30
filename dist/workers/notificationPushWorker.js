"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startNotificationPushWorker = startNotificationPushWorker;
exports.stopNotificationPushWorker = stopNotificationPushWorker;
const webPush_1 = require("../config/webPush");
const notificationPushQueue_1 = require("../services/notificationPushQueue");
const webPushSender_1 = require("../services/webPushSender");
const utils_1 = require("../utils");
let workerTimer = null;
let processing = false;
function startNotificationPushWorker() {
    if (!webPush_1.webPushConfig.workerEnabled) {
        utils_1.logger.info('Web push worker disabled (WEB_PUSH_WORKER_ENABLED=false)');
        return;
    }
    if (!webPush_1.webPushConfig.enabled) {
        utils_1.logger.warn('Web push worker not started — VAPID keys missing');
        return;
    }
    if (workerTimer)
        return;
    utils_1.logger.info({ intervalMs: webPush_1.webPushConfig.workerIntervalMs, batchSize: webPush_1.webPushConfig.workerBatchSize }, 'Starting notification push worker');
    workerTimer = setInterval(() => {
        void processBatch();
    }, webPush_1.webPushConfig.workerIntervalMs);
    void processBatch();
}
function stopNotificationPushWorker() {
    if (workerTimer) {
        clearInterval(workerTimer);
        workerTimer = null;
    }
}
async function processBatch() {
    if (processing)
        return;
    processing = true;
    try {
        const jobs = await notificationPushQueue_1.NotificationPushQueue.claimBatch(webPush_1.webPushConfig.workerBatchSize);
        if (jobs.length === 0)
            return;
        utils_1.logger.info({ count: jobs.length }, 'Processing web push queue batch');
        await Promise.all(jobs.map((job) => webPushSender_1.WebPushSender.processQueueJob({
            ...job,
            attempts: job.attempts + 1,
        })));
    }
    catch (err) {
        utils_1.logger.error({ err }, 'Notification push worker batch failed');
    }
    finally {
        processing = false;
    }
}
