"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OWNER_BILLING_SUBSCRIPTION_SELECT = exports.OWNER_BILLING_SUBSCRIPTION_JOIN = exports.TEACHER_BILLING_SUBSCRIPTION_ORDER = exports.PLAN_LABELS = exports.PACKAGE_ORDER = void 0;
exports.packageLevel = packageLevel;
exports.hasPlanFeature = hasPlanFeature;
exports.getRequiredPlanForFeature = getRequiredPlanForFeature;
exports.planFeatureDeniedMessage = planFeatureDeniedMessage;
exports.getMonthlyLiveLimit = getMonthlyLiveLimit;
exports.getMaxStudents = getMaxStudents;
exports.getTeacherBillingSubscription = getTeacherBillingSubscription;
exports.syncUserSubscriptionPackageFromBilling = syncUserSubscriptionPackageFromBilling;
exports.getTeacherPackage = getTeacherPackage;
exports.getTeacherEffectivePlanContext = getTeacherEffectivePlanContext;
exports.getTeacherPackageRow = getTeacherPackageRow;
exports.countTeacherLiveSessionsInCycle = countTeacherLiveSessionsInCycle;
exports.countTenantStudents = countTenantStudents;
exports.enforcePlanFeature = enforcePlanFeature;
exports.enforceTeacherLiveCreationLimit = enforceTeacherLiveCreationLimit;
exports.enforceStudentLimit = enforceStudentLimit;
exports.getTeacherPlanAccess = getTeacherPlanAccess;
exports.buildPlanFeatureAccess = buildPlanFeatureAccess;
const pool_1 = __importDefault(require("../db/pool"));
const utils_1 = require("../utils");
exports.PACKAGE_ORDER = ['bronze', 'silver', 'gold', 'diamond'];
exports.PLAN_LABELS = {
    bronze: 'الانطلاقة',
    silver: 'التوسع',
    gold: 'الاحتراف',
    diamond: 'التميز',
};
const FEATURE_MIN_PACKAGE = {
    exam_builder_ai: 'gold',
    scientific_support: 'gold',
    data_analyst: 'diamond',
    creative_social: 'diamond',
};
const FEATURE_LABELS = {
    exam_builder_ai: 'إنشاء الامتحانات بالـ AI',
    scientific_support: 'الدعم العلمي بالـ AI',
    data_analyst: 'محلل مستوى الطلاب بالـ AI',
    creative_social: 'مساعد السوشيال ميديا بالـ AI',
};
const PLAN_CONFIG = {
    bronze: { monthly_live_limit: 6, max_students: 80 },
    silver: { monthly_live_limit: 10, max_students: 150 },
    gold: { monthly_live_limit: 16, max_students: 300 },
    diamond: { monthly_live_limit: null, max_students: null },
};
/** Latest finance subscription assigned by admin (accounting system). */
exports.TEACHER_BILLING_SUBSCRIPTION_ORDER = `
  CASE
    WHEN s.status = 'active' AND s.ends_at >= CURRENT_DATE THEN 0
    WHEN s.status = 'active' THEN 1
    ELSE 2
  END,
  s.created_at DESC,
  s.id DESC`;
exports.OWNER_BILLING_SUBSCRIPTION_JOIN = `
  LEFT JOIN LATERAL (
    SELECT p.code AS plan_code,
           p.name_ar AS plan_name_ar,
           s.id AS subscription_id,
           s.starts_at,
           s.ends_at,
           s.status AS subscription_status,
           s.subscription_number
    FROM teacher_platform_subscriptions s
    JOIN teacher_subscription_plans p ON p.id = s.plan_id
    WHERE s.teacher_id = owner.id
      AND s.status <> 'cancelled'
    ORDER BY ${exports.TEACHER_BILLING_SUBSCRIPTION_ORDER}
    LIMIT 1
  ) billing_sub ON owner.id IS NOT NULL`;
exports.OWNER_BILLING_SUBSCRIPTION_SELECT = `
         billing_sub.plan_code AS owner_billing_plan_code,
         billing_sub.plan_name_ar AS owner_billing_plan_name,
         billing_sub.subscription_id AS owner_billing_subscription_id,
         billing_sub.starts_at AS owner_billing_starts_at,
         billing_sub.ends_at AS owner_billing_ends_at,
         billing_sub.subscription_status AS owner_billing_status,
         billing_sub.subscription_number AS owner_billing_number`;
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
function packageLevel(pkg) {
    return exports.PACKAGE_ORDER.indexOf(pkg);
}
function hasPlanFeature(pkg, feature) {
    const required = FEATURE_MIN_PACKAGE[feature];
    return packageLevel(pkg) >= packageLevel(required);
}
function getRequiredPlanForFeature(feature) {
    return FEATURE_MIN_PACKAGE[feature];
}
function planFeatureDeniedMessage(feature) {
    const required = FEATURE_MIN_PACKAGE[feature];
    const label = exports.PLAN_LABELS[required];
    return `${FEATURE_LABELS[feature]} متاح في باقة ${label} أو أعلى`;
}
function getMonthlyLiveLimit(pkg) {
    return PLAN_CONFIG[pkg].monthly_live_limit;
}
function getMaxStudents(pkg) {
    return PLAN_CONFIG[pkg].max_students;
}
async function getTeacherBillingSubscription(teacherId) {
    const result = await pool_1.default.query(`SELECT s.id AS subscription_id,
            p.code AS plan_code,
            p.name_ar AS plan_name_ar,
            s.starts_at,
            s.ends_at,
            s.status AS subscription_status,
            s.subscription_number
     FROM teacher_platform_subscriptions s
     JOIN teacher_subscription_plans p ON p.id = s.plan_id
     WHERE s.teacher_id = $1
       AND s.status <> 'cancelled'
     ORDER BY ${exports.TEACHER_BILLING_SUBSCRIPTION_ORDER}
     LIMIT 1`, [teacherId]);
    const row = result.rows[0];
    if (!row)
        return null;
    return {
        subscription_id: row.subscription_id,
        package: row.plan_code,
        plan_name_ar: row.plan_name_ar,
        starts_at: row.starts_at,
        ends_at: row.ends_at,
        status: row.subscription_status,
        subscription_number: row.subscription_number,
    };
}
/** Keep users.subscription_package aligned with the active finance subscription. */
async function syncUserSubscriptionPackageFromBilling(teacherId) {
    const billing = await getTeacherBillingSubscription(teacherId);
    if (!billing)
        return;
    await pool_1.default.query(`UPDATE users
     SET subscription_package = $1,
         subscription_package_assigned_at = COALESCE($2, subscription_package_assigned_at, NOW())
     WHERE id = $3 AND role = 'teacher'`, [billing.package, billing.starts_at, teacherId]);
}
async function getTeacherPackage(teacherId) {
    const billing = await getTeacherBillingSubscription(teacherId);
    if (billing)
        return billing.package;
    const result = await pool_1.default.query(`SELECT subscription_package FROM users WHERE id = $1 AND role = 'teacher' LIMIT 1`, [teacherId]);
    return (result.rows[0]?.subscription_package ?? 'bronze');
}
async function getTeacherEffectivePlanContext(teacherId) {
    const userRes = await pool_1.default.query(`SELECT subscription_package, subscription_package_assigned_at, tenant_id
     FROM users WHERE id = $1 AND role = 'teacher' LIMIT 1`, [teacherId]);
    const user = userRes.rows[0];
    const billing = await getTeacherBillingSubscription(teacherId);
    return {
        package: billing?.package ?? (user?.subscription_package ?? 'bronze'),
        package_assigned_at: billing?.starts_at ??
            (user?.subscription_package_assigned_at
                ? new Date(user.subscription_package_assigned_at)
                : null),
        tenant_id: user?.tenant_id ?? null,
        billing,
    };
}
async function getTeacherPackageRow(teacherId) {
    const userRes = await pool_1.default.query(`SELECT subscription_package, subscription_package_assigned_at, tenant_id
     FROM users WHERE id = $1 AND role = 'teacher' LIMIT 1`, [teacherId]);
    if (!userRes.rowCount)
        return null;
    const ctx = await getTeacherEffectivePlanContext(teacherId);
    return {
        subscription_package: ctx.package,
        subscription_package_assigned_at: ctx.package_assigned_at,
        tenant_id: ctx.tenant_id,
    };
}
async function countTeacherLiveSessionsInCycle(teacherId, cycleStart, cycleEnd) {
    const countRes = await pool_1.default.query(`SELECT (
        (SELECT COUNT(*)::int FROM meeting
         WHERE created_by = $1 AND created_at >= $2 AND created_at < $3)
        +
        (SELECT COUNT(*)::int FROM general_course_group_meeting
         WHERE created_by = $1 AND created_at >= $2 AND created_at < $3)
      )::text AS total`, [teacherId, cycleStart, cycleEnd]);
    return Number(countRes.rows[0]?.total ?? 0);
}
async function countTenantStudents(tenantId) {
    const result = await pool_1.default.query(`SELECT COUNT(*)::text AS total FROM users WHERE tenant_id = $1 AND role = 'student'`, [tenantId]);
    return Number(result.rows[0]?.total ?? 0);
}
async function enforcePlanFeature(teacherId, feature) {
    const pkg = await getTeacherPackage(teacherId);
    if (!hasPlanFeature(pkg, feature)) {
        throw new utils_1.HttpError(403, planFeatureDeniedMessage(feature), {
            code: 'PLAN_FEATURE_NOT_AVAILABLE',
            feature,
            current_plan: pkg,
            current_plan_label: exports.PLAN_LABELS[pkg],
            required_plan: FEATURE_MIN_PACKAGE[feature],
            required_plan_label: exports.PLAN_LABELS[FEATURE_MIN_PACKAGE[feature]],
        });
    }
}
async function enforceTeacherLiveCreationLimit(teacherId) {
    const teacher = await getTeacherPackageRow(teacherId);
    if (!teacher)
        return;
    const pkg = (teacher.subscription_package ?? 'bronze');
    const limit = getMonthlyLiveLimit(pkg);
    if (limit === null)
        return;
    const now = new Date();
    const assignedAt = teacher.subscription_package_assigned_at
        ? new Date(teacher.subscription_package_assigned_at)
        : now;
    const cycleStart = getCurrentCycleStart(assignedAt, now);
    const cycleEnd = addMonths(cycleStart, 1);
    const createdLives = await countTeacherLiveSessionsInCycle(teacherId, cycleStart, cycleEnd);
    if (createdLives >= limit) {
        throw new utils_1.HttpError(403, `لقد وصلت للحد الأقصى للايفات في باقة ${exports.PLAN_LABELS[pkg]} (${limit} لايف/شهر).`, {
            code: 'PLAN_LIVE_LIMIT_REACHED',
            current_plan: pkg,
            monthly_live_limit: limit,
            monthly_live_used: createdLives,
        });
    }
}
async function enforceStudentLimit(teacherId, tenantId) {
    const pkg = await getTeacherPackage(teacherId);
    const maxStudents = getMaxStudents(pkg);
    if (maxStudents === null)
        return;
    const current = await countTenantStudents(tenantId);
    if (current >= maxStudents) {
        throw new utils_1.HttpError(403, `وصلت للحد الأقصى لعدد الطلاب في باقة ${exports.PLAN_LABELS[pkg]} (${maxStudents} طالب).`, {
            code: 'PLAN_STUDENT_LIMIT_REACHED',
            current_plan: pkg,
            max_students: maxStudents,
            current_students: current,
        });
    }
}
async function getTeacherPlanAccess(teacherId) {
    const ctx = await getTeacherEffectivePlanContext(teacherId);
    const pkg = ctx.package;
    const config = PLAN_CONFIG[pkg];
    const now = new Date();
    const assignedAt = ctx.package_assigned_at ? new Date(ctx.package_assigned_at) : now;
    const cycleStart = getCurrentCycleStart(assignedAt, now);
    const cycleEnd = addMonths(cycleStart, 1);
    const monthlyLiveUsed = await countTeacherLiveSessionsInCycle(teacherId, cycleStart, cycleEnd);
    const tenantId = ctx.tenant_id;
    const currentStudents = tenantId != null ? await countTenantStudents(tenantId) : 0;
    const features = Object.keys(FEATURE_MIN_PACKAGE).reduce((acc, feature) => {
        const allowed = hasPlanFeature(pkg, feature);
        const required = FEATURE_MIN_PACKAGE[feature];
        acc[feature] = {
            allowed,
            label: FEATURE_LABELS[feature],
            required_plan: required,
            required_plan_label: exports.PLAN_LABELS[required],
            ...(allowed
                ? {}
                : { message: planFeatureDeniedMessage(feature) }),
        };
        return acc;
    }, {});
    return {
        package: pkg,
        package_label: exports.PLAN_LABELS[pkg],
        billing_subscription: ctx.billing,
        monthly_live_limit: config.monthly_live_limit,
        monthly_live_used: monthlyLiveUsed,
        monthly_live_remaining: config.monthly_live_limit == null
            ? null
            : Math.max(0, config.monthly_live_limit - monthlyLiveUsed),
        max_students: config.max_students,
        current_students: currentStudents,
        students_remaining: config.max_students == null
            ? null
            : Math.max(0, config.max_students - currentStudents),
        features,
    };
}
function buildPlanFeatureAccess(teacherId, pkg, feature) {
    if (!teacherId || !pkg) {
        return { allowed: true };
    }
    const allowed = hasPlanFeature(pkg, feature);
    if (allowed) {
        return {
            allowed: true,
            current_plan: pkg,
            current_plan_label: exports.PLAN_LABELS[pkg],
        };
    }
    const required = FEATURE_MIN_PACKAGE[feature];
    return {
        allowed: false,
        message: planFeatureDeniedMessage(feature),
        current_plan: pkg,
        current_plan_label: exports.PLAN_LABELS[pkg],
        required_plan: required,
        required_plan_label: exports.PLAN_LABELS[required],
        feature,
    };
}
