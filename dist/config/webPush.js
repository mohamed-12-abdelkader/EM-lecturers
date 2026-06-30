"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.webPushConfig = void 0;
exports.ensureVapidConfigured = ensureVapidConfigured;
const web_push_1 = __importDefault(require("web-push"));
const utils_1 = require("../utils");
/** VAPID + worker settings (requires VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in env). */
exports.webPushConfig = {
    enabled: Boolean(utils_1.config.VAPID_PUBLIC_KEY && utils_1.config.VAPID_PRIVATE_KEY),
    publicKey: utils_1.config.VAPID_PUBLIC_KEY,
    privateKey: utils_1.config.VAPID_PRIVATE_KEY,
    subject: utils_1.config.VAPID_SUBJECT,
    workerEnabled: utils_1.config.WEB_PUSH_WORKER_ENABLED,
    workerIntervalMs: utils_1.config.WEB_PUSH_WORKER_INTERVAL_MS,
    workerBatchSize: utils_1.config.WEB_PUSH_WORKER_BATCH_SIZE,
    maxAttempts: utils_1.config.WEB_PUSH_MAX_ATTEMPTS,
};
let vapidConfigured = false;
function ensureVapidConfigured() {
    if (!exports.webPushConfig.enabled)
        return false;
    if (vapidConfigured)
        return true;
    web_push_1.default.setVapidDetails(exports.webPushConfig.subject, exports.webPushConfig.publicKey, exports.webPushConfig.privateKey);
    vapidConfigured = true;
    return true;
}
