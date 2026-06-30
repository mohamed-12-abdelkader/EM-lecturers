import pool from '../db/pool';
import { HttpError } from '../utils';

export type TeacherPackage = 'bronze' | 'silver' | 'gold' | 'diamond';

export type PlanFeature =
  | 'exam_builder_ai'
  | 'scientific_support'
  | 'data_analyst'
  | 'creative_social';

export const PACKAGE_ORDER: TeacherPackage[] = ['bronze', 'silver', 'gold', 'diamond'];

export const PLAN_LABELS: Record<TeacherPackage, string> = {
  bronze: 'الانطلاقة',
  silver: 'التوسع',
  gold: 'الاحتراف',
  diamond: 'التميز',
};

const FEATURE_MIN_PACKAGE: Record<PlanFeature, TeacherPackage> = {
  exam_builder_ai: 'gold',
  scientific_support: 'gold',
  data_analyst: 'diamond',
  creative_social: 'diamond',
};

const FEATURE_LABELS: Record<PlanFeature, string> = {
  exam_builder_ai: 'إنشاء الامتحانات بالـ AI',
  scientific_support: 'الدعم العلمي بالـ AI',
  data_analyst: 'محلل مستوى الطلاب بالـ AI',
  creative_social: 'مساعد السوشيال ميديا بالـ AI',
};

const PLAN_CONFIG: Record<
  TeacherPackage,
  { monthly_live_limit: number | null; max_students: number | null }
> = {
  bronze: { monthly_live_limit: 6, max_students: 80 },
  silver: { monthly_live_limit: 10, max_students: 150 },
  gold: { monthly_live_limit: 16, max_students: 300 },
  diamond: { monthly_live_limit: null, max_students: null },
};

/** Latest finance subscription assigned by admin (accounting system). */
export const TEACHER_BILLING_SUBSCRIPTION_ORDER = `
  CASE
    WHEN s.status = 'active' AND s.ends_at >= CURRENT_DATE THEN 0
    WHEN s.status = 'active' THEN 1
    ELSE 2
  END,
  s.created_at DESC,
  s.id DESC`;

export type TeacherBillingSubscription = {
  subscription_id: number;
  package: TeacherPackage;
  plan_name_ar: string;
  starts_at: Date | null;
  ends_at: Date | null;
  status: string;
  subscription_number: string;
};

export const OWNER_BILLING_SUBSCRIPTION_JOIN = `
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
    ORDER BY ${TEACHER_BILLING_SUBSCRIPTION_ORDER}
    LIMIT 1
  ) billing_sub ON owner.id IS NOT NULL`;

export const OWNER_BILLING_SUBSCRIPTION_SELECT = `
         billing_sub.plan_code AS owner_billing_plan_code,
         billing_sub.plan_name_ar AS owner_billing_plan_name,
         billing_sub.subscription_id AS owner_billing_subscription_id,
         billing_sub.starts_at AS owner_billing_starts_at,
         billing_sub.ends_at AS owner_billing_ends_at,
         billing_sub.subscription_status AS owner_billing_status,
         billing_sub.subscription_number AS owner_billing_number`;

type TeacherPackageRow = {
  subscription_package: TeacherPackage | null;
  subscription_package_assigned_at: Date | string | null;
  tenant_id: number | null;
};

function addMonths(baseDate: Date, months: number): Date {
  const d = new Date(baseDate);
  d.setMonth(d.getMonth() + months);
  return d;
}

function getCurrentCycleStart(assignedAt: Date, now: Date): Date {
  let monthsDiff = (now.getFullYear() - assignedAt.getFullYear()) * 12;
  monthsDiff += now.getMonth() - assignedAt.getMonth();

  let cycleStart = addMonths(assignedAt, monthsDiff);
  if (cycleStart > now) {
    monthsDiff -= 1;
    cycleStart = addMonths(assignedAt, monthsDiff);
  }
  return cycleStart;
}

export function packageLevel(pkg: TeacherPackage): number {
  return PACKAGE_ORDER.indexOf(pkg);
}

export function hasPlanFeature(pkg: TeacherPackage, feature: PlanFeature): boolean {
  const required = FEATURE_MIN_PACKAGE[feature];
  return packageLevel(pkg) >= packageLevel(required);
}

export function getRequiredPlanForFeature(feature: PlanFeature): TeacherPackage {
  return FEATURE_MIN_PACKAGE[feature];
}

export function planFeatureDeniedMessage(feature: PlanFeature): string {
  const required = FEATURE_MIN_PACKAGE[feature];
  const label = PLAN_LABELS[required];
  return `${FEATURE_LABELS[feature]} متاح في باقة ${label} أو أعلى`;
}

export function getMonthlyLiveLimit(pkg: TeacherPackage): number | null {
  return PLAN_CONFIG[pkg].monthly_live_limit;
}

export function getMaxStudents(pkg: TeacherPackage): number | null {
  return PLAN_CONFIG[pkg].max_students;
}

export async function getTeacherBillingSubscription(
  teacherId: number,
): Promise<TeacherBillingSubscription | null> {
  const result = await pool.query<{
    subscription_id: number;
    plan_code: TeacherPackage;
    plan_name_ar: string;
    starts_at: Date | null;
    ends_at: Date | null;
    subscription_status: string;
    subscription_number: string;
  }>(
    `SELECT s.id AS subscription_id,
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
     ORDER BY ${TEACHER_BILLING_SUBSCRIPTION_ORDER}
     LIMIT 1`,
    [teacherId],
  );

  const row = result.rows[0];
  if (!row) return null;

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
export async function syncUserSubscriptionPackageFromBilling(teacherId: number): Promise<void> {
  const billing = await getTeacherBillingSubscription(teacherId);
  if (!billing) return;

  await pool.query(
    `UPDATE users
     SET subscription_package = $1,
         subscription_package_assigned_at = COALESCE($2, subscription_package_assigned_at, NOW())
     WHERE id = $3 AND role = 'teacher'`,
    [billing.package, billing.starts_at, teacherId],
  );
}

export async function getTeacherPackage(teacherId: number): Promise<TeacherPackage> {
  const billing = await getTeacherBillingSubscription(teacherId);
  if (billing) return billing.package;

  const result = await pool.query<{ subscription_package: TeacherPackage | null }>(
    `SELECT subscription_package FROM users WHERE id = $1 AND role = 'teacher' LIMIT 1`,
    [teacherId],
  );
  return (result.rows[0]?.subscription_package ?? 'bronze') as TeacherPackage;
}

export async function getTeacherEffectivePlanContext(teacherId: number): Promise<{
  package: TeacherPackage;
  package_assigned_at: Date | null;
  tenant_id: number | null;
  billing: TeacherBillingSubscription | null;
}> {
  const userRes = await pool.query<TeacherPackageRow>(
    `SELECT subscription_package, subscription_package_assigned_at, tenant_id
     FROM users WHERE id = $1 AND role = 'teacher' LIMIT 1`,
    [teacherId],
  );
  const user = userRes.rows[0];
  const billing = await getTeacherBillingSubscription(teacherId);

  return {
    package: billing?.package ?? (user?.subscription_package ?? 'bronze') as TeacherPackage,
    package_assigned_at:
      billing?.starts_at ??
      (user?.subscription_package_assigned_at
        ? new Date(user.subscription_package_assigned_at)
        : null),
    tenant_id: user?.tenant_id ?? null,
    billing,
  };
}

export async function getTeacherPackageRow(teacherId: number): Promise<TeacherPackageRow | null> {
  const userRes = await pool.query<TeacherPackageRow>(
    `SELECT subscription_package, subscription_package_assigned_at, tenant_id
     FROM users WHERE id = $1 AND role = 'teacher' LIMIT 1`,
    [teacherId],
  );
  if (!userRes.rowCount) return null;

  const ctx = await getTeacherEffectivePlanContext(teacherId);
  return {
    subscription_package: ctx.package,
    subscription_package_assigned_at: ctx.package_assigned_at,
    tenant_id: ctx.tenant_id,
  };
}

export async function countTeacherLiveSessionsInCycle(
  teacherId: number,
  cycleStart: Date,
  cycleEnd: Date,
): Promise<number> {
  const countRes = await pool.query<{ total: string }>(
    `SELECT (
        (SELECT COUNT(*)::int FROM meeting
         WHERE created_by = $1 AND created_at >= $2 AND created_at < $3)
        +
        (SELECT COUNT(*)::int FROM general_course_group_meeting
         WHERE created_by = $1 AND created_at >= $2 AND created_at < $3)
      )::text AS total`,
    [teacherId, cycleStart, cycleEnd],
  );
  return Number(countRes.rows[0]?.total ?? 0);
}

export async function countTenantStudents(tenantId: number): Promise<number> {
  const result = await pool.query<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM users WHERE tenant_id = $1 AND role = 'student'`,
    [tenantId],
  );
  return Number(result.rows[0]?.total ?? 0);
}

export async function enforcePlanFeature(teacherId: number, feature: PlanFeature): Promise<void> {
  const pkg = await getTeacherPackage(teacherId);
  if (!hasPlanFeature(pkg, feature)) {
    throw new HttpError(403, planFeatureDeniedMessage(feature), {
      code: 'PLAN_FEATURE_NOT_AVAILABLE',
      feature,
      current_plan: pkg,
      current_plan_label: PLAN_LABELS[pkg],
      required_plan: FEATURE_MIN_PACKAGE[feature],
      required_plan_label: PLAN_LABELS[FEATURE_MIN_PACKAGE[feature]],
    });
  }
}

export async function enforceTeacherLiveCreationLimit(teacherId: number): Promise<void> {
  const teacher = await getTeacherPackageRow(teacherId);
  if (!teacher) return;

  const pkg = (teacher.subscription_package ?? 'bronze') as TeacherPackage;
  const limit = getMonthlyLiveLimit(pkg);
  if (limit === null) return;

  const now = new Date();
  const assignedAt = teacher.subscription_package_assigned_at
    ? new Date(teacher.subscription_package_assigned_at)
    : now;
  const cycleStart = getCurrentCycleStart(assignedAt, now);
  const cycleEnd = addMonths(cycleStart, 1);

  const createdLives = await countTeacherLiveSessionsInCycle(teacherId, cycleStart, cycleEnd);
  if (createdLives >= limit) {
    throw new HttpError(
      403,
      `لقد وصلت للحد الأقصى للايفات في باقة ${PLAN_LABELS[pkg]} (${limit} لايف/شهر).`,
      {
        code: 'PLAN_LIVE_LIMIT_REACHED',
        current_plan: pkg,
        monthly_live_limit: limit,
        monthly_live_used: createdLives,
      },
    );
  }
}

export async function enforceStudentLimit(teacherId: number, tenantId: number): Promise<void> {
  const pkg = await getTeacherPackage(teacherId);
  const maxStudents = getMaxStudents(pkg);
  if (maxStudents === null) return;

  const current = await countTenantStudents(tenantId);
  if (current >= maxStudents) {
    throw new HttpError(
      403,
      `وصلت للحد الأقصى لعدد الطلاب في باقة ${PLAN_LABELS[pkg]} (${maxStudents} طالب).`,
      {
        code: 'PLAN_STUDENT_LIMIT_REACHED',
        current_plan: pkg,
        max_students: maxStudents,
        current_students: current,
      },
    );
  }
}

export async function getTeacherPlanAccess(teacherId: number) {
  const ctx = await getTeacherEffectivePlanContext(teacherId);
  const pkg = ctx.package;
  const config = PLAN_CONFIG[pkg];

  const now = new Date();
  const assignedAt = ctx.package_assigned_at ? new Date(ctx.package_assigned_at) : now;
  const cycleStart = getCurrentCycleStart(assignedAt, now);
  const cycleEnd = addMonths(cycleStart, 1);
  const monthlyLiveUsed = await countTeacherLiveSessionsInCycle(teacherId, cycleStart, cycleEnd);

  const tenantId = ctx.tenant_id;
  const currentStudents =
    tenantId != null ? await countTenantStudents(tenantId) : 0;

  const features = (Object.keys(FEATURE_MIN_PACKAGE) as PlanFeature[]).reduce(
    (acc, feature) => {
      const allowed = hasPlanFeature(pkg, feature);
      const required = FEATURE_MIN_PACKAGE[feature];
      acc[feature] = {
        allowed,
        label: FEATURE_LABELS[feature],
        required_plan: required,
        required_plan_label: PLAN_LABELS[required],
        ...(allowed
          ? {}
          : { message: planFeatureDeniedMessage(feature) }),
      };
      return acc;
    },
    {} as Record<
      PlanFeature,
      {
        allowed: boolean;
        label: string;
        required_plan: TeacherPackage;
        required_plan_label: string;
        message?: string;
      }
    >,
  );

  return {
    package: pkg,
    package_label: PLAN_LABELS[pkg],
    billing_subscription: ctx.billing,
    monthly_live_limit: config.monthly_live_limit,
    monthly_live_used: monthlyLiveUsed,
    monthly_live_remaining:
      config.monthly_live_limit == null
        ? null
        : Math.max(0, config.monthly_live_limit - monthlyLiveUsed),
    max_students: config.max_students,
    current_students: currentStudents,
    students_remaining:
      config.max_students == null
        ? null
        : Math.max(0, config.max_students - currentStudents),
    features,
  };
}

export function buildPlanFeatureAccess(
  teacherId: number | undefined,
  pkg: TeacherPackage | null | undefined,
  feature: PlanFeature,
) {
  if (!teacherId || !pkg) {
    return { allowed: true };
  }
  const allowed = hasPlanFeature(pkg, feature);
  if (allowed) {
    return {
      allowed: true,
      current_plan: pkg,
      current_plan_label: PLAN_LABELS[pkg],
    };
  }
  const required = FEATURE_MIN_PACKAGE[feature];
  return {
    allowed: false,
    message: planFeatureDeniedMessage(feature),
    current_plan: pkg,
    current_plan_label: PLAN_LABELS[pkg],
    required_plan: required,
    required_plan_label: PLAN_LABELS[required],
    feature,
  };
}
