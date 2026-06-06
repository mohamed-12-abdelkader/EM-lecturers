"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.enforceTeacherLiveCreationLimit = enforceTeacherLiveCreationLimit;
const pool_1 = __importDefault(require("../db/pool"));
const utils_1 = require("../utils");
function addMonths(baseDate, months) {
    const d = new Date(baseDate);
    d.setMonth(d.getMonth() + months);
    return d;
}
function getCurrentCycleStart(assignedAt, now) {
    let monthsDiff = (now.getFullYear() - assignedAt.getFullYear()) * 12;
    monthsDiff += now.getMonth() - assignedAt.getMonth();
    let cycleStart = addMonths(assignedAt, monthsDiff);
    if (cycleStart > now) {
        monthsDiff -= 1;
        cycleStart = addMonths(assignedAt, monthsDiff);
    }
    return cycleStart;
}
function getMonthlyLimitForPackage(pkg) {
    if (pkg === 'bronze')
        return 0;
    if (pkg === 'silver')
        return 4;
    if (pkg === 'gold')
        return 8;
    return null; // diamond
}
async function enforceTeacherLiveCreationLimit(teacherId) {
    const teacherRes = await pool_1.default.query(`SELECT subscription_package, subscription_package_assigned_at
     FROM users
     WHERE id = $1
       AND role = 'teacher'
     LIMIT 1`, [teacherId]);
    const teacher = teacherRes.rows[0];
    if (!teacher)
        return;
    const pkg = (teacher.subscription_package ?? 'bronze');
    const limit = getMonthlyLimitForPackage(pkg);
    if (limit === null)
        return; // diamond: unlimited
    const now = new Date();
    const assignedAt = teacher.subscription_package_assigned_at
        ? new Date(teacher.subscription_package_assigned_at)
        : now;
    const cycleStart = getCurrentCycleStart(assignedAt, now);
    const cycleEnd = addMonths(cycleStart, 1);
    const countRes = await pool_1.default.query(`SELECT (
        (SELECT COUNT(*)::int FROM meeting
         WHERE created_by = $1 AND created_at >= $2 AND created_at < $3)
        +
        (SELECT COUNT(*)::int FROM general_course_group_meeting
         WHERE created_by = $1 AND created_at >= $2 AND created_at < $3)
      )::text AS total`, [teacherId, cycleStart, cycleEnd]);
    const createdLives = Number(countRes.rows[0]?.total ?? 0);
    if (createdLives >= limit) {
        if (pkg === 'bronze') {
            throw new utils_1.HttpError(403, 'الباقة البرونزية لا تسمح بإنشاء أي لايفات.');
        }
        throw new utils_1.HttpError(403, `لقد وصلت للحد الأقصى للايفات في باقة ${pkg} (${limit} لايف/شهر).`);
    }
}
