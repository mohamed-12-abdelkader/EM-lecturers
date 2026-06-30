import webpush from 'web-push';
import { ensureVapidConfigured } from '../config/webPush';
import { WebPushSubscriptionRow, WebPushSubscriptionService } from './webPushSubscriptionService';
import { NotificationPushQueue, QueuedPushPayload } from './notificationPushQueue';
import { logger } from '../utils';

export interface WebPushSendResult {
  success: boolean;
  statusCode?: number;
  expired?: boolean;
  error?: string;
}

export class WebPushSender {
  static async sendToSubscription(
    subscription: WebPushSubscriptionRow,
    payload: QueuedPushPayload,
  ): Promise<WebPushSendResult> {
    if (!ensureVapidConfigured()) {
      return { success: false, error: 'Web Push (VAPID) is not configured' };
    }

    const pushSubscription: webpush.PushSubscription = {
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
      const result = await webpush.sendNotification(pushSubscription, notificationPayload, {
        TTL: 60 * 60 * 24,
        urgency: 'normal',
      });
      return { success: true, statusCode: result.statusCode };
    } catch (err: unknown) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      const message = err instanceof Error ? err.message : String(err);
      const expired = statusCode === 404 || statusCode === 410;
      if (expired) {
        await WebPushSubscriptionService.deactivateSubscription(subscription.id);
      }
      logger.warn(
        { subscriptionId: subscription.id, userId: subscription.user_id, statusCode, message },
        'Web push delivery failed',
      );
      return { success: false, statusCode, expired, error: message };
    }
  }

  static async processQueueJob(job: {
    id: number;
    user_id: number;
    notification_id: number | null;
    subscription_id: number;
    payload: QueuedPushPayload;
    attempts: number;
    max_attempts: number;
  }): Promise<void> {
    const subResult = await WebPushSubscriptionService.getActiveSubscriptionsForUser(job.user_id);
    const subscription = subResult.find((s) => s.id === job.subscription_id);
    if (!subscription) {
      await NotificationPushQueue.markFailed(job.id, 'Subscription not found or inactive', false, job.attempts);
      await NotificationPushQueue.logDelivery({
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
      await NotificationPushQueue.markSent(job.id);
      await NotificationPushQueue.logDelivery({
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
    await NotificationPushQueue.markFailed(job.id, result.error || 'Unknown error', retry, job.attempts);
    await NotificationPushQueue.logDelivery({
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

/** Fire-and-forget helper for existing notification flows */
export function scheduleWebPushForUser(
  userId: number,
  payload: QueuedPushPayload,
  notificationId?: number,
): void {
  NotificationPushQueue.enqueueForUser(userId, payload, notificationId).catch((err) =>
    logger.error({ err, userId }, 'Failed to enqueue web push'),
  );
}

export function scheduleWebPushForUsers(userIds: number[], payload: QueuedPushPayload): void {
  NotificationPushQueue.enqueueForUsers(userIds, payload).catch((err) =>
    logger.error({ err, count: userIds.length }, 'Failed to enqueue bulk web push'),
  );
}
