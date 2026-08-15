import { buildTenantPublicUrl } from '../../../../config/appUrls';

/** Teachers whose students must use the mobile app — never the website URL. */
export const APP_ONLY_TEACHER_SUBDOMAINS = new Set(['mr-nofal']);

export const MR_NOFAL_FORBIDDEN_WEBSITE_URL = 'https://mr-nofal.em-online.online';

export const MR_NOFAL_APP_STUDENT_GUIDANCE = `طلاب مصطفى نوفل (منصة mr-nofal) بيستخدموا تطبيق الموبايل بس — ممنوع تبعت أو تذكر لينك الموقع (${MR_NOFAL_FORBIDDEN_WEBSITE_URL}) وممنوع تقولهم يدخلوا من الموقع.
وجّه الطالب للتطبيق:
- نزّل التطبيق من لينك التحميل اللي المدرس بعتهوله.
- لو معندوش لينك التحميل: يكلّم مصطفى نوفل مباشرة ويطلب منه لينك التطبيق.
بعد كده ساعده بالكامل على التطبيق: التحميل، التثبيت، التسجيل/الدخول برقم الموبايل والباسورد، تفعيل الحساب/الكورس، وحل أي مشكلة تقنية خطوة بخطوة.`;

export function isAppOnlyTeacherSubdomain(subdomain?: string | null): boolean {
  if (!subdomain) return false;
  return APP_ONLY_TEACHER_SUBDOMAINS.has(subdomain.trim().toLowerCase());
}

export type TenantAccessPayload = {
  public_url: string | null;
  access_channel: 'mobile_app' | 'website';
  never_share_website_url: boolean;
  forbidden_website_url?: string;
  student_guidance?: string;
};

export function tenantAccessForSubdomain(subdomain?: string | null): TenantAccessPayload {
  if (isAppOnlyTeacherSubdomain(subdomain)) {
    return {
      public_url: null,
      access_channel: 'mobile_app',
      never_share_website_url: true,
      forbidden_website_url: MR_NOFAL_FORBIDDEN_WEBSITE_URL,
      student_guidance: MR_NOFAL_APP_STUDENT_GUIDANCE,
    };
  }
  return {
    public_url: subdomain ? buildTenantPublicUrl(subdomain) : null,
    access_channel: 'website',
    never_share_website_url: false,
  };
}

/** Strip leaked website URLs for app-only teachers from the model reply. */
export function sanitizeAppOnlyTeacherReply(text: string): string {
  if (!text) return text;
  return text
    .replace(/https?:\/\/mr-nofal\.em-online\.online\/?/gi, 'تطبيق الموبايل')
    .replace(/\bmr-nofal\.em-online\.online\b/gi, 'تطبيق الموبايل');
}
