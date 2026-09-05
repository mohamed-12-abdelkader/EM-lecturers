import type { Request } from 'express';
import { config } from '../utils';

/**
 * التحقق من أن الطلب قادم من تطبيق Expo الرسمي (EAS Project ID)
 * المستخدم عند مشاركة الشاشة في الميتنج يجب أن يفتح التطبيق الرسمي فقط.
 */

export type ScreenShareAppInfo = {
  /** هل مشاركة الشاشة تتطلب التطبيق الرسمي؟ */
  requiresOfficialApp: true;
  /** هل الطلب الحالي من التطبيق الرسمي؟ */
  isOfficialApp: boolean;
  /** EAS Project ID المتوقع */
  easProjectId: string;
  /** Deep link لفتح التطبيق وبدء مشاركة الشاشة */
  openAppUrl: string;
  /** اسم الهيدر المطلوب من التطبيق */
  requiredHeader: 'X-EAS-Project-Id';
};

function normalizeProjectId(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase();
}

export function getConfiguredEasProjectId(): string {
  return normalizeProjectId(config.EAS_PROJECT_ID);
}

/** هل الطلب يحمل EAS Project ID المطابق للتطبيق الرسمي؟ */
export function isOfficialEasApp(req: Request): boolean {
  const expected = getConfiguredEasProjectId();
  if (!expected) return false;

  const fromHeader =
    req.get('x-eas-project-id') ||
    req.get('x-expo-project-id') ||
    req.get('x-eas-projectid') ||
    '';
  const fromQuery =
    (typeof req.query.easProjectId === 'string' && req.query.easProjectId) ||
    (typeof req.query.eas_project_id === 'string' && req.query.eas_project_id) ||
    (typeof req.query.projectId === 'string' && req.query.projectId) ||
    '';

  const provided = normalizeProjectId(fromHeader || fromQuery);
  return Boolean(provided) && provided === expected;
}

/**
 * بناء رابط فتح التطبيق لمشاركة الشاشة في ميتنج معيّن.
 * scheme من EXPO_APP_SCHEME (افتراضي: emlecturers)
 */
export function buildScreenShareOpenAppUrl(meetingId: string): string {
  const scheme = String(config.EXPO_APP_SCHEME || 'emlecturers').replace(/:\/\/$/, '');
  const projectId = getConfiguredEasProjectId();
  const params = new URLSearchParams({
    meetingId: String(meetingId),
    easProjectId: projectId,
    action: 'screen_share',
  });
  return `${scheme}://meeting/screen-share?${params.toString()}`;
}

/** معلومات فتح التطبيق — تُرجع لصاحب الميتنج دائماً */
export function buildScreenShareAppInfo(req: Request, meetingId: string): ScreenShareAppInfo {
  return {
    requiresOfficialApp: true,
    isOfficialApp: isOfficialEasApp(req),
    easProjectId: getConfiguredEasProjectId(),
    openAppUrl: buildScreenShareOpenAppUrl(meetingId),
    requiredHeader: 'X-EAS-Project-Id',
  };
}

/**
 * هل يُسمح بإصدار screenShareToken لهذا الطلب؟
 * - يجب أن يكون owner (يُتحقق خارجياً)
 * - ويجب أن يكون الطلب من التطبيق الرسمي (EAS Project ID مطابق)
 */
export function canIssueScreenShareToken(req: Request): boolean {
  const expected = getConfiguredEasProjectId();
  // لو مفيش project id مضبوط في السيرفر، نسمح مؤقتاً (dev بدون إعداد)
  if (!expected) return true;
  return isOfficialEasApp(req);
}
