import pool from '../db/pool';
import { buildTenantPublicUrl } from '../config/appUrls';
import { TeacherPlatformSubscriptionsService } from './teacherPlatformSubscriptions';

export type TeacherPlatformMatch = {
  teacher_id: number;
  teacher_name: string;
  subject: string | null;
  nickname: string | null;
  subdomain: string;
  platform_url: string;
  display_name: string | null;
};

export type TeacherLookupFilters = {
  subject?: string | null;
  grade?: string | null;
  nickname?: string | null;
};

function normalizeArabic(text: string): string {
  return text
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .toLowerCase();
}

function tokenize(text: string): string[] {
  return normalizeArabic(text)
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
}

/**
 * بحث مدرسين لديهم منصة (tenant) نشطة بالاسم + فلاتر اختيارية.
 */
export async function lookupTeachersByName(
  teacherNameRaw: string,
  filters: TeacherLookupFilters = {},
): Promise<TeacherPlatformMatch[]> {
  const teacherName = teacherNameRaw.trim();
  if (!teacherName) return [];

  const tokens = tokenize(teacherName);
  if (!tokens.length) return [];

  const normalizedFull = normalizeArabic(teacherName);
  const params: unknown[] = [normalizedFull];
  const whereParts: string[] = [
    `u.role = 'teacher'`,
    `t.subdomain IS NOT NULL`,
    `t.subdomain <> 'default'`,
    `COALESCE(t.is_active, false) = true`,
    `t.subdomain NOT LIKE 'deleted-%'`,
  ];

  tokens.forEach((token) => {
    params.push(`%${token}%`);
    const i = params.length;
    whereParts.push(
      `(translate(lower(u.name), 'أإآٱةىؤئ', 'ااااهيوي') ILIKE $${i}
        OR translate(lower(COALESCE(t.display_name, '')), 'أإآٱةىؤئ', 'ااااهيوي') ILIKE $${i})`,
    );
  });

  if (filters.subject?.trim()) {
    params.push(`%${normalizeArabic(filters.subject)}%`);
    const i = params.length;
    whereParts.push(
      `(translate(lower(COALESCE(u.subject, '')), 'أإآٱةىؤئ', 'ااااهيوي') ILIKE $${i}
        OR translate(lower(COALESCE(t.specialty, '')), 'أإآٱةىؤئ', 'ااااهيوي') ILIKE $${i})`,
    );
  }

  if (filters.nickname?.trim()) {
    params.push(`%${normalizeArabic(filters.nickname)}%`);
    const i = params.length;
    whereParts.push(
      `(translate(lower(u.name), 'أإآٱةىؤئ', 'ااااهيوي') ILIKE $${i}
        OR translate(lower(COALESCE(t.display_name, '')), 'أإآٱةىؤئ', 'ااااهيوي') ILIKE $${i})`,
    );
  }

  const sql = `
    SELECT
      u.id AS teacher_id,
      u.name AS teacher_name,
      u.subject,
      t.subdomain,
      t.display_name
    FROM users u
    INNER JOIN tenants t ON t.owner_user_id = u.id
    WHERE ${whereParts.join(' AND ')}
    ORDER BY
      CASE
        WHEN translate(lower(u.name), 'أإآٱةىؤئ', 'ااااهيوي') = $1 THEN 0
        WHEN translate(lower(u.name), 'أإآٱةىؤئ', 'ااااهيوي') LIKE $1 || '%' THEN 1
        ELSE 2
      END,
      length(u.name) ASC,
      u.id ASC
    LIMIT 10
  `;

  const res = await pool.query(sql, params);
  const matches: TeacherPlatformMatch[] = [];

  for (const row of res.rows) {
    const access = await TeacherPlatformSubscriptionsService.getPlatformAccessState(row.teacher_id);
    if (!access.allowed) continue;

    matches.push({
      teacher_id: row.teacher_id,
      teacher_name: row.teacher_name,
      subject: row.subject ?? null,
      nickname: row.display_name ?? null,
      subdomain: row.subdomain,
      platform_url: buildTenantPublicUrl(row.subdomain),
      display_name: row.display_name ?? null,
    });
  }

  return matches;
}

export function buildSubscribeTeacherReply(platformUrl: string): string {
  return `✅ يمكنك التسجيل من خلال الرابط التالي:

${platformUrl}

بعد الدخول إلى المنصة:

1- قم بإنشاء حساب جديد.

2- بعد تسجيل الدخول ستجد كورس الشهر الأول.

3- اضغط على "اشتراك".

4- أدخل كود الاشتراك المكون من 8 أرقام.

5- سيتم تفعيل الكورس تلقائيًا على حسابك.`;
}

export const ASK_TEACHER_NAME = 'أكيد، مع أي مدرس تريد الاشتراك؟';

export const TEACHER_NOT_FOUND =
  'معلش، مش لاقي المدرس بالاسم ده. ممكن تكتب الاسم أوضح شوية؟';
