/** أدوار جهاز المدرس داخل نفس غرفة الميتنج */
export type MeetingDeviceRole = 'camera' | 'screen' | 'observer' | 'general';

const DEVICE_ROLES = new Set<MeetingDeviceRole>(['camera', 'screen', 'observer', 'general']);

export function normalizeMeetingDeviceRole(value: unknown): MeetingDeviceRole {
  const raw = String(value || '')
    .trim()
    .toLowerCase();
  if (DEVICE_ROLES.has(raw as MeetingDeviceRole)) return raw as MeetingDeviceRole;
  return 'general';
}

/** معرّف جهاز مستقر وآمن للهوية داخل LiveKit */
export function normalizeMeetingDeviceId(value: unknown): string {
  const raw = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  if (raw && raw.length <= 64) return raw;
  return `web-${Date.now().toString(36)}`;
}

/**
 * هوية LiveKit للمشارك.
 * - أجهزة المدرس المتعددة: user_{id}_meeting_{meetingId}_d_{deviceId}
 * - التوافق القديم: user_{id}_meeting_{meetingId}
 */
export function buildMeetingParticipantIdentity(opts: {
  userId: number | string;
  meetingId: string;
  deviceId?: string | null;
}): string {
  const base = `user_${opts.userId}_meeting_${opts.meetingId}`;
  const deviceId = opts.deviceId ? normalizeMeetingDeviceId(opts.deviceId) : '';
  return deviceId ? `${base}_d_${deviceId}` : base;
}

export function buildScreenShareIdentity(participantIdentity: string): string {
  return `${participantIdentity}_screenShare`;
}

/** استخراج userId من هوية LiveKit (يدعم الأجهزة المتعددة ومشاركة الشاشة) */
export function parseUserIdFromMeetingIdentity(identity: unknown): number | null {
  const raw = String(identity || '');
  const match = raw.match(/^user_(\d+)_meeting_/);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function isRecorderIdentity(identity: unknown): boolean {
  return String(identity || '').startsWith('recorder_');
}

export function isScreenShareIdentity(identity: unknown): boolean {
  return String(identity || '').includes('_screenShare');
}

/** هل الهوية تخص نفس المستخدم (بغض النظر عن الجهاز / screenShare) */
export function identitiesBelongToSameUser(a: unknown, b: unknown): boolean {
  const left = parseUserIdFromMeetingIdentity(a);
  const right = parseUserIdFromMeetingIdentity(b);
  return left != null && right != null && left === right;
}
