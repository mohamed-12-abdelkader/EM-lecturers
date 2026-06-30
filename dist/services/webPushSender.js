"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebPushSender = void 0;
exports.scheduleWebPushForUser = scheduleWebPushForUser;
exports.scheduleWebPushForUsers = scheduleWebPushForUsers;
const web_push_1 = __importDefault(require("web-push"));
const webPush_1 = require("../config/webPush");
const webPushSubscriptionService_1 = require("./webPushSubscriptionService");
const notificationPushQueue_1 = require("./notificationPushQueue");
const utils_1 = require("../utils");
class WebPushSender {
    static async sendToSubscription(subscription, payload) {
        if (!(0, webPush_1.ensureVapidConfigured)()) {
            return { success: false, error: 'Web Push (VAPID) is not configured' };
        }
        const pushSubscription = {
            endpoint: subscription.endpoint,
            keys: {
                p256dh: subscription.p256dh,
                auth: subscription.auth_key,
            },
        };
        const notificationPayload = JSON.stringify({
            title: payload.title,
            body: payload.body,
            icon: payload.icon,
            image: payload.image,
            url: payload.url,
            type: payload.type,
            notification_id: payload.notification_id,
            data: payload.data || {},
        });
        try {
            const result = await web_push_1.default.sendNotification(pushSubscription, notificationPayload, {
                TTL: 60 * 60 * 24,
                urgency: 'normal',
            });
            return { success: true, statusCode: result.statusCode };
        }
        catch (err) {
            const statusCode = err.statusCode;
            const message = err instanceof Error ? err.message : String(err);
            const expired = statusCode === 404 || statusCode === 410;
            if (expired) {
                await webPushSubscriptionService_1.WebPushSubscriptionService.deactivateSubscription(subscription.id);
            }
            utils_1.logger.warn({ subscriptionId: subscription.id, userId: subscription.user_id, statusCode, message }, 'Web push delivery failed');
            return { success: false, statusCode, expired, error: message };
        }
    }
    static async processQueueJob(job) {
        const subResult = await webPushSubscriptionService_1.WebPushSubscriptionService.getActiveSubscriptionsForUser(job.user_id);
        const subscription = subResult.find((s) => s.id === job.subscription_id);
        if (!subscription) {
            await notificationPushQueue_1.NotificationPushQueue.markFailed(job.id, 'Subscription not found or inactive', false, job.attempts);
            await notificationPushQueue_1.NotificationPushQueue.logDelivery({
                queueId: job.id,
                userId: job.user_id,
                subscriptionId: job.subscription_id,
                notificationId: job.notification_id || undefined,
                status: 'expired_subscription',
                errorMessage: 'Subscription not found or inactive',
            });
            return;
        }
        const result = await this.sendToSubscription(subscription, job.payload);
        if (result.success) {
            await notificationPushQueue_1.NotificationPushQueue.markSent(job.id);
            await notificationPushQueue_1.NotificationPushQueue.logDelivery({
                queueId: job.id,
                userId: job.user_id,
                subscriptionId: subscription.id,
                notificationId: job.notification_id || undefined,
                status: 'sent',
                responseCode: result.statusCode,
            });
            return;
        }
        const retry = !result.expired && job.attempts < job.max_attempts;
        await notificationPushQueue_1.NotificationPushQueue.markFailed(job.id, result.error || 'Unknown error', retry, job.attempts);
        await notificationPushQueue_1.NotificationPushQueue.logDelivery({
            queueId: job.id,
            userId: job.user_id,
            subscriptionId: subscription.id,
            notificationId: job.notification_id || undefined,
            status: result.expired ? 'expired_subscription' : 'failed',
            responseCode: result.statusCode,
            errorMessage: result.error,
        });
    }
}
exports.WebPushSender = WebPushSender;
/** Fire-and-forget helper for existing notification flows */
function scheduleWebPushForUser(userId, payload, notificationId) {
    notificationPushQueue_1.NotificationPushQueue.enqueueForUser(userId, payload, notificationId).catch((err) => utils_1.logger.error({ err, userId }, 'Failed to enqueue web push'));
}
function scheduleWebPushForUsers(userIds, payload) {
    notificationPushQueue_1.NotificationPushQueue.enqueueForUsers(userIds, payload).catch((err) => utils_1.logger.error({ err, count: userIds.length }, 'Failed to enqueue bulk web push'));
}
