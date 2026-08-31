import { platformToday, platformTimezone, toDateString } from '../../employeeWork/utils/time';

/** بداية الأسبوع (الأحد) */
export function weekStartDate(dateStr?: string): string {
  const base = dateStr ?? platformToday();
  const [y, m, d] = base.split('-').map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  const day = utc.getUTCDay(); // 0 = Sunday
  utc.setUTCDate(utc.getUTCDate() - day);
  return utc.toISOString().slice(0, 10);
}

/** نهاية الأسبوع (السبت) */
export function weekEndDate(dateStr?: string): string {
  const start = weekStartDate(dateStr);
  return addDays(start, 6);
}

export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  utc.setUTCDate(utc.getUTCDate() + days);
  return utc.toISOString().slice(0, 10);
}

export function isDateInRange(dateStr: string, start: string, end: string | null): boolean {
  if (dateStr < start) return false;
  if (end && dateStr > end) return false;
  return true;
}

/** due_at من scheduled_time + period_end */
export function computeDueAt(
  periodEnd: string,
  scheduledTime: string | null | undefined,
): Date | null {
  if (!scheduledTime) return null;
  const m = String(scheduledTime).match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const tz = platformTimezone();
  const iso = `${periodEnd}T${m[1].padStart(2, '0')}:${m[2]}:00`;
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'shortOffset',
    });
    void formatter;
    return new Date(`${iso}+00:00`);
  } catch {
    return new Date(iso);
  }
}

export function safeDateStr(value: unknown): string {
  return toDateString(value);
}
