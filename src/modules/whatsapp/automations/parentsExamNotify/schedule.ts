import type { QuietHoursConfig } from './settings';

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const bag: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== 'literal') bag[part.type] = part.value;
  }
  return {
    year: Number(bag.year),
    month: Number(bag.month),
    day: Number(bag.day),
    hour: Number(bag.hour),
    minute: Number(bag.minute),
    second: Number(bag.second),
  };
}

/** Convert a wall-clock time in `timeZone` to a UTC Date. */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const parts = zonedParts(new Date(utcGuess), timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return new Date(utcGuess - (asUtc - utcGuess));
}

export function dayStart(now: Date, timeZone: string): Date {
  const parts = zonedParts(now, timeZone);
  return zonedTimeToUtc(parts.year, parts.month, parts.day, 0, 0, timeZone);
}

function minutesOfDay(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function inQuiet(mins: number, start: number, end: number): boolean {
  if (start === end) return false;
  if (start < end) return mins >= start && mins < end;
  return mins >= start || mins < end;
}

export function snapOutOfQuietHours(date: Date, quiet: QuietHoursConfig): Date {
  if (!quiet.enabled) return date;
  const start = minutesOfDay(quiet.start);
  const end = minutesOfDay(quiet.end);
  const parts = zonedParts(date, quiet.tz);
  const mins = parts.hour * 60 + parts.minute;
  if (!inQuiet(mins, start, end)) return date;

  const endHour = Math.floor(end / 60);
  const endMinute = end % 60;
  let year = parts.year;
  let month = parts.month;
  let day = parts.day;
  if (start > end && mins >= start) {
    const next = new Date(Date.UTC(year, month - 1, day) + 24 * 60 * 60 * 1000);
    year = next.getUTCFullYear();
    month = next.getUTCMonth() + 1;
    day = next.getUTCDate();
  }
  return zonedTimeToUtc(year, month, day, endHour, endMinute, quiet.tz);
}

export interface ScheduleInput {
  now: Date;
  lastSlot: Date | null;
  intervalSeconds: number;
  jitterSeconds: number;
  quietHours: QuietHoursConfig;
  random?: () => number;
  dailyCount: number;
  dailyCap: number;
  immediate?: boolean;
}

export type ScheduleResult = { ok: true; at: Date } | { ok: false; reason: 'capped' };

export function nextScheduledAt(input: ScheduleInput): ScheduleResult {
  if (input.dailyCount >= input.dailyCap) return { ok: false, reason: 'capped' };
  if (input.immediate) return { ok: true, at: new Date(input.now.getTime()) };

  const random = input.random ?? Math.random;
  const jitterSpan = Math.max(0, input.jitterSeconds);
  const jitter = jitterSpan === 0 ? 0 : Math.floor(random() * (jitterSpan + 1));
  const baseMs =
    input.lastSlot && input.lastSlot.getTime() > input.now.getTime()
      ? input.lastSlot.getTime()
      : input.now.getTime();
  const at = new Date(baseMs + (input.intervalSeconds + jitter) * 1000);
  return { ok: true, at: snapOutOfQuietHours(at, input.quietHours) };
}
