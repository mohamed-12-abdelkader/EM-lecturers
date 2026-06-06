"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.saveExpoPushToken = saveExpoPushToken;
exports.getTokensByUserId = getTokensByUserId;
exports.getTokensByUserIds = getTokensByUserIds;
exports.removeExpoPushToken = removeExpoPushToken;
exports.sendPushNotification = sendPushNotification;
exports.sendPushNotificationToMany = sendPushNotificationToMany;
/**
 * خدمة موحدة لإرسال Push Notifications عبر Expo (تطبيق الموبايل).
 * مستقلة عن نظام الإشعارات الحالي ولا تؤثر على APIs الويب.
 */
const expo_server_sdk_1 = require("expo-server-sdk");
const pool_1 = __importDefault(require("../db/pool"));
const PUSH_LOG_PREFIX = '[ExpoPush]';
let expoClient = null;
function getExpoClient() {
    if (expoClient)
        return expoClient;
    const accessToken = process.env.EXPO_ACCESS_TOKEN;
    try {
        expoClient = new expo_server_sdk_1.Expo({
            ...(accessToken && { accessToken }),
            useFcmV1: true,
        });
        return expoClient;
    }
    catch (e) {
        console.error(`${PUSH_LOG_PREFIX} Failed to create Expo client:`, e);
        return null;
    }
}
/**
 * حفظ أو تحديث Expo Push Token للمستخدم (يدعم تحديث التوكن عند تغييره).
 */
async function saveExpoPushToken(userId, token, deviceId) {
    if (!token || typeof token !== 'string' || !token.trim()) {
        return { success: false, error: 'Token is required' };
    }
    const trimmed = token.trim();
    if (!expo_server_sdk_1.Expo.isExpoPushToken(trimmed)) {
        return { success: false, error: 'Invalid Expo push token format' };
    }
    try {
        await pool_1.default.query(`INSERT INTO expo_push_tokens (user_id, token, device_id, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (user_id, token) DO UPDATE SET updated_at = NOW(), device_id = COALESCE(EXCLUDED.device_id, expo_push_tokens.device_id)`, [userId, trimmed, deviceId || null]);
        return { success: true };
    }
    catch (e) {
        console.error(`${PUSH_LOG_PREFIX} Failed to save token for user ${userId}:`, e);
        return { success: false, error: e instanceof Error ? e.message : 'Unknown error' };
    }
}
/**
 * جلب جميع التوكنات الصالحة لمستخدم واحد.
 */
async function getTokensByUserId(userId) {
    const result = await pool_1.default.query(`SELECT token FROM expo_push_tokens WHERE user_id = $1`, [userId]);
    return result.rows.map((r) => r.token).filter((t) => expo_server_sdk_1.Expo.isExpoPushToken(t));
}
/**
 * جلب توكنات عدة مستخدمين (للاستخدام في الإرسال الجماعي).
 */
async function getTokensByUserIds(userIds) {
    const map = new Map();
    if (userIds.length === 0)
        return map;
    const uniq = [...new Set(userIds)];
    const result = await pool_1.default.query(`SELECT user_id, token FROM expo_push_tokens WHERE user_id = ANY($1::int[])`, [uniq]);
    for (const row of result.rows) {
        if (!expo_server_sdk_1.Expo.isExpoPushToken(row.token))
            continue;
        const list = map.get(row.user_id) || [];
        list.push(row.token);
        map.set(row.user_id, list);
    }
    return map;
}
/**
 * حذف توكن (مثلاً عند معرفة أنه غير صالح من رد Expo).
 */
async function removeExpoPushToken(token) {
    try {
        await pool_1.default.query(`DELETE FROM expo_push_tokens WHERE token = $1`, [token]);
    }
    catch (e) {
        console.error(`${PUSH_LOG_PREFIX} Failed to remove token:`, e);
    }
}
/**
 * إرسال إشعار Push لمستخدم واحد (حسب userId).
 * تجلب التوكن من DB وترسل عبر Expo مع التعامل مع الأخطاء والتوكنات غير الصالحة.
 */
async function sendPushNotification(userId, title, body, data = {}) {
    const tokens = await getTokensByUserId(userId);
    if (tokens.length === 0)
        return { sent: 0, failed: 0, invalidTokens: [] };
    return sendPushToTokens(tokens, title, body, data);
}
/**
 * إرسال إشعار Push لعدة مستخدمين (إرسال جماعي).
 */
async function sendPushNotificationToMany(userIds, title, body, data = {}) {
    const tokenMap = await getTokensByUserIds(userIds);
    const allTokens = [];
    tokenMap.forEach((tokens) => allTokens.push(...tokens));
    if (allTokens.length === 0)
        return { sent: 0, failed: 0, invalidTokens: [] };
    return sendPushToTokens(allTokens, title, body, data);
}
/**
 * إرسال فعلي إلى قائمة توكنات مع معالجة الأخطاء وحذف التوكنات غير الصالحة.
 */
async function sendPushToTokens(tokens, title, body, data = {}) {
    const expo = getExpoClient();
    if (!expo) {
        console.warn(`${PUSH_LOG_PREFIX} Expo client not available, skipping push`);
        return { sent: 0, failed: tokens.length, invalidTokens: [] };
    }
    const validTokens = [];
    const invalidTokens = [];
    for (const t of tokens) {
        if (expo_server_sdk_1.Expo.isExpoPushToken(t))
            validTokens.push(t);
        else
            invalidTokens.push(t);
    }
    if (validTokens.length === 0) {
        if (invalidTokens.length) {
            console.warn(`${PUSH_LOG_PREFIX} All tokens invalid, count: ${invalidTokens.length}`);
        }
        return { sent: 0, failed: tokens.length, invalidTokens };
    }
    const messages = validTokens.map((pushToken) => ({
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
                    const token = chunk[i].to;
                    if (!ticket || typeof ticket !== 'object') {
                        failed++;
                        continue;
                    }
                    const status = ticket.status;
                    const details = ticket.details;
                    if (status === 'ok') {
                        sent++;
                    }
                    else {
                        failed++;
                        const errorCode = details?.error;
                        if (errorCode === 'DeviceNotRegistered' ||
                            errorCode === 'InvalidCredentials' ||
                            errorCode === 'MessageTooBig' ||
                            errorCode === 'MessageRateExceeded') {
                            console.warn(`${PUSH_LOG_PREFIX} Invalid or expired token (${errorCode}), removing: ${String(token).slice(0, 30)}...`);
                            if (token) {
                                invalidTokens.push(token);
                                await removeExpoPushToken(token);
                            }
                        }
                        else {
                            console.error(`${PUSH_LOG_PREFIX} Push failed for token:`, errorCode || details, ticket);
                        }
                    }
                }
            }
            catch (chunkError) {
                console.error(`${PUSH_LOG_PREFIX} Error sending chunk:`, chunkError);
                failed += chunk.length;
            }
        }
    }
    catch (err) {
        console.error(`${PUSH_LOG_PREFIX} Error sending push notifications:`, err);
        failed = validTokens.length;
    }
    if (failed > 0) {
        console.warn(`${PUSH_LOG_PREFIX} Sent=${sent}, Failed=${failed}, InvalidTokensRemoved=${invalidTokens.length}`);
    }
    return { sent, failed, invalidTokens };
}
