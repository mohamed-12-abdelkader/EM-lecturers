/**
 * خدمة موحدة لإرسال Push Notifications عبر Expo (تطبيق الموبايل).
 * مستقلة عن نظام الإشعارات الحالي ولا تؤثر على APIs الويب.
 */
import { Expo, ExpoPushMessage } from 'expo-server-sdk';
import pool from '../db/pool';

const PUSH_LOG_PREFIX = '[ExpoPush]';

let expoClient: Expo | null = null;

function getExpoClient(): Expo | null {
  if (expoClient) return expoClient;
  const accessToken = process.env.EXPO_ACCESS_TOKEN;
  try {
    expoClient = new Expo({
      ...(accessToken && { accessToken }),
      useFcmV1: true,
    });
    return expoClient;
  } catch (e) {
    console.error(`${PUSH_LOG_PREFIX} Failed to create Expo client:`, e);
    return null;
  }
}

/**
 * حفظ أو تحديث Expo Push Token للمستخدم (يدعم تحديث التوكن عند تغييره).
 */
export async function saveExpoPushToken(
  userId: number,
  token: string,
  deviceId?: string,
): Promise<{ success: boolean; error?: string }> {
  if (!token || typeof token !== 'string' || !token.trim()) {
    return { success: false, error: 'Token is required' };
  }
  const trimmed = token.trim();
  if (!Expo.isExpoPushToken(trimmed)) {
    return { success: false, error: 'Invalid Expo push token format' };
  }
  try {
    await pool.query(
      `INSERT INTO expo_push_tokens (user_id, token, device_id, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (user_id, token) DO UPDATE SET updated_at = NOW(), device_id = COALESCE(EXCLUDED.device_id, expo_push_tokens.device_id)`,
      [userId, trimmed, deviceId || null],
    );
    return { success: true };
  } catch (e) {
    console.error(`${PUSH_LOG_PREFIX} Failed to save token for user ${userId}:`, e);
    return { success: false, error: e instanceof Error ? e.message : 'Unknown error' };
  }
}

/**
 * جلب جميع التوكنات الصالحة لمستخدم واحد.
 */
export async function getTokensByUserId(userId: number): Promise<string[]> {
  const result = await pool.query<{ token: string }>(
    `SELECT token FROM expo_push_tokens WHERE user_id = $1`,
    [userId],
  );
  return result.rows.map((r) => r.token).filter((t) => Expo.isExpoPushToken(t));
}

/**
 * جلب توكنات عدة مستخدمين (للاستخدام في الإرسال الجماعي).
 */
export async function getTokensByUserIds(userIds: number[]): Promise<Map<number, string[]>> {
  const map = new Map<number, string[]>();
  if (userIds.length === 0) return map;
  const uniq = [...new Set(userIds)];
  const result = await pool.query<{ user_id: number; token: string }>(
    `SELECT user_id, token FROM expo_push_tokens WHERE user_id = ANY($1::int[])`,
    [uniq],
  );
  for (const row of result.rows) {
    if (!Expo.isExpoPushToken(row.token)) continue;
    const list = map.get(row.user_id) || [];
    list.push(row.token);
    map.set(row.user_id, list);
  }
  return map;
}

/**
 * حذف توكن (مثلاً عند معرفة أنه غير صالح من رد Expo).
 */
export async function removeExpoPushToken(token: string): Promise<void> {
  try {
    await pool.query(`DELETE FROM expo_push_tokens WHERE token = $1`, [token]);
  } catch (e) {
    console.error(`${PUSH_LOG_PREFIX} Failed to remove token:`, e);
  }
}

/**
 * إرسال إشعار Push لمستخدم واحد (حسب userId).
 * تجلب التوكن من DB وترسل عبر Expo مع التعامل مع الأخطاء والتوكنات غير الصالحة.
 */
export async function sendPushNotification(
  userId: number,
  title: string,
  body: string,
  data: Record<string, unknown> = {},
): Promise<{ sent: number; failed: number; invalidTokens: string[] }> {
  const tokens = await getTokensByUserId(userId);
  if (tokens.length === 0) return { sent: 0, failed: 0, invalidTokens: [] };
  return sendPushToTokens(tokens, title, body, data);
}

/**
 * إرسال إشعار Push لعدة مستخدمين (إرسال جماعي).
 */
export async function sendPushNotificationToMany(
  userIds: number[],
  title: string,
  body: string,
  data: Record<string, unknown> = {},
): Promise<{ sent: number; failed: number; invalidTokens: string[] }> {
  const tokenMap = await getTokensByUserIds(userIds);
  const allTokens: string[] = [];
  tokenMap.forEach((tokens) => allTokens.push(...tokens));
  if (allTokens.length === 0) return { sent: 0, failed: 0, invalidTokens: [] };
  return sendPushToTokens(allTokens, title, body, data);
}

/**
 * إرسال فعلي إلى قائمة توكنات مع معالجة الأخطاء وحذف التوكنات غير الصالحة.
 */
async function sendPushToTokens(
  tokens: string[],
  title: string,
  body: string,
  data: Record<string, unknown> = {},
): Promise<{ sent: number; failed: number; invalidTokens: string[] }> {
  const expo = getExpoClient();
  if (!expo) {
    console.warn(`${PUSH_LOG_PREFIX} Expo client not available, skipping push`);
    return { sent: 0, failed: tokens.length, invalidTokens: [] };
  }

  const validTokens: string[] = [];
  const invalidTokens: string[] = [];
  for (const t of tokens) {
    if (Expo.isExpoPushToken(t)) validTokens.push(t);
    else invalidTokens.push(t);
  }

  if (validTokens.length === 0) {
    if (invalidTokens.length) {
      console.warn(`${PUSH_LOG_PREFIX} All tokens invalid, count: ${invalidTokens.length}`);
    }
    return { sent: 0, failed: tokens.length, invalidTokens };
  }

  const messages: ExpoPushMessage[] = validTokens.map((pushToken) => ({
    to: pushToken,
    sound: 'default',
    title: title || undefined,
    body: body || '',
    data: { ...data },
  }));

  let sent = 0;
  let failed = 0;

  try {
    const chunks = expo.chunkPushNotifications(messages);
    for (const chunk of chunks) {
      try {
        const tickets = await expo.sendPushNotificationsAsync(chunk);
        for (let i = 0; i < tickets.length; i++) {
          const ticket = tickets[i];
          const token = (chunk[i] as ExpoPushMessage).to as string;
          if (!ticket || typeof ticket !== 'object') {
            failed++;
            continue;
          }
          const status = (ticket as { status?: string }).status;
          const details = (ticket as { details?: { error?: string } }).details;
          if (status === 'ok') {
            sent++;
          } else {
            failed++;
            const errorCode = details?.error;
            if (
              errorCode === 'DeviceNotRegistered' ||
              errorCode === 'InvalidCredentials' ||
              errorCode === 'MessageTooBig' ||
              errorCode === 'MessageRateExceeded'
            ) {
              console.warn(`${PUSH_LOG_PREFIX} Invalid or expired token (${errorCode}), removing: ${String(token).slice(0, 30)}...`);
              if (token) {
                invalidTokens.push(token);
                await removeExpoPushToken(token);
              }
            } else {
              console.error(`${PUSH_LOG_PREFIX} Push failed for token:`, errorCode || details, ticket);
            }
          }
        }
      } catch (chunkError) {
        console.error(`${PUSH_LOG_PREFIX} Error sending chunk:`, chunkError);
        failed += chunk.length;
      }
    }
  } catch (err) {
    console.error(`${PUSH_LOG_PREFIX} Error sending push notifications:`, err);
    failed = validTokens.length;
  }

  if (failed > 0) {
    console.warn(`${PUSH_LOG_PREFIX} Sent=${sent}, Failed=${failed}, InvalidTokensRemoved=${invalidTokens.length}`);
  }

  return { sent, failed, invalidTokens };
}
