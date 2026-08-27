/** المنطقة الزمنية للمنصة — افتراضي Africa/Cairo */
export function platformTimezone(): string {
  return process.env.PLATFORM_TIMEZONE?.trim() || 'Africa/Cairo';
}

/**
 * تطبيع تاريخ من PostgreSQL DATE / string إلى YYYY-MM-DD.
 * node-pg قد يعيد DATE كـ UTC midnight أو local midnight حسب الإعدادات.
 */
export function toDateString(value: unknown): string {
  if (typeof value === 'string') {
    const m = value.trim().match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const iso = value.toISOString();
    // DATE من pg غالبًا منتصف ليل UTC
    if (/T00:00:00(\.\d+)?Z$/.test(iso)) {
      return iso.slice(0, 10);
    }
    // منتصف ليل محلي (شائع على Windows)
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(value ?? '').trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  throw new Error(`تاريخ غير صالح: ${String(value)}`);
}

/** تاريخ اليوم في منطقة المنصة بصيغة YYYY-MM-DD */
export function platformToday(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: platformTimezone(),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** أجزاء الوقت HH:mm في منطقة المنصة */
export function platformTimeParts(date = new Date()): { hours: number; minutes: number; totalMinutes: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: platformTimezone(),
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const hours = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const minutes = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return { hours, minutes, totalMinutes: hours * 60 + minutes };
}

export function parseTimeToMinutes(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = String(value).match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function formatMinutesDuration(totalMinutes: number | null | undefined): string {
  if (totalMinutes == null || !Number.isFinite(totalMinutes) || totalMinutes < 0) return '0h 0m';
  const h = Math.floor(totalMinutes / 60);
  const m = Math.round(totalMinutes % 60);
  return `${h}h ${m}m`;
}

const ON_TIME_GRACE_MINUTES = 5;

export type StartStatus = 'early' | 'on_time' | 'late';
export type EndStatus = 'early_leave' | 'on_time' | 'overtime';

export function computeStartStatus(
  actualTotalMinutes: number,
  scheduledStart: string,
): StartStatus {
  const scheduled = parseTimeToMinutes(scheduledStart) ?? 9 * 60;
  if (actualTotalMinutes < scheduled) return 'early';
  if (actualTotalMinutes <= scheduled + ON_TIME_GRACE_MINUTES) return 'on_time';
  return 'late';
}

export function computeEndStatus(
  actualTotalMinutes: number,
  scheduledEnd: string,
): EndStatus {
  const scheduled = parseTimeToMinutes(scheduledEnd) ?? 17 * 60;
  if (actualTotalMinutes < scheduled - ON_TIME_GRACE_MINUTES) return 'early_leave';
  if (actualTotalMinutes <= scheduled + ON_TIME_GRACE_MINUTES) return 'on_time';
  return 'overtime';
}

export function latenessMinutes(actualStart: Date | null, scheduledStart: string, workDate: string): number {
  if (!actualStart) return 0;
  const actual = platformTimeParts(actualStart).totalMinutes;
  const scheduled = parseTimeToMinutes(scheduledStart) ?? 0;
  return Math.max(0, actual - scheduled);
}

export function earlyLeaveMinutes(actualEnd: Date | null, scheduledEnd: string): number {
  if (!actualEnd) return 0;
  const actual = platformTimeParts(actualEnd).totalMinutes;
  const scheduled = parseTimeToMinutes(scheduledEnd) ?? 0;
  return Math.max(0, scheduled - actual);
}

export function overtimeMinutes(actualEnd: Date | null, scheduledEnd: string): number {
  if (!actualEnd) return 0;
  const actual = platformTimeParts(actualEnd).totalMinutes;
  const scheduled = parseTimeToMinutes(scheduledEnd) ?? 0;
  return Math.max(0, actual - scheduled);
}
