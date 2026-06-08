"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isTeacherCreativeReminderTime = isTeacherCreativeReminderTime;
exports.runTeacherCreativeReminderJob = runTeacherCreativeReminderJob;
const pool_1 = __importDefault(require("../db/pool"));
const utils_1 = require("../utils");
const notifications_1 = require("./notifications");
let teacherCreativeReminderLastRunDate = '';
function isTeacherCreativeReminderTime() {
    const d = new Date();
    return d.getHours() === 8 && d.getMinutes() === 0;
}
async function hasReminderToday(teacherId) {
    const result = await pool_1.default.query(`SELECT 1
     FROM notifications
     WHERE user_id = $1
       AND type = 'teacher_creative_reminder'
       AND created_at::date = CURRENT_DATE
     LIMIT 1`, [teacherId]);
    return (result.rowCount || 0) > 0;
}
async function runTeacherCreativeReminderJob() {
    const today = new Date().toISOString().slice(0, 10);
    if (teacherCreativeReminderLastRunDate === today)
        return;
    teacherCreativeReminderLastRunDate = today;
    try {
        const teachersRes = await pool_1.default.query(`SELECT id FROM users WHERE role = 'teacher'`);
        let sent = 0;
        for (const row of teachersRes.rows) {
            try {
                if (await hasReminderToday(row.id))
                    continue;
                const result = await notifications_1.NotificationService.notifyTeacherCreativeReminder(row.id);
                if (result.success)
                    sent++;
            }
            catch (error) {
                utils_1.logger.error({ error, teacher_id: row.id }, '[TeacherCreativeReminder] Failed for teacher');
            }
        }
        utils_1.logger.info(`[TeacherCreativeReminder] Sent to ${sent} teachers.`);
    }
    catch (error) {
        teacherCreativeReminderLastRunDate = '';
        utils_1.logger.error({ error }, '[TeacherCreativeReminder] Job failed');
    }
}
