import { describe, expect, it } from 'vitest';
import {
  computeEndStatus,
  computeStartStatus,
  formatMinutesDuration,
  parseTimeToMinutes,
  toDateString,
} from '../utils/time';

describe('employeeWork time utils', () => {
  it('parses HH:mm to minutes', () => {
    expect(parseTimeToMinutes('09:00')).toBe(540);
    expect(parseTimeToMinutes('17:30')).toBe(1050);
  });

  it('classifies start status with grace', () => {
    expect(computeStartStatus(535, '09:00')).toBe('early'); // 08:55
    expect(computeStartStatus(540, '09:00')).toBe('on_time');
    expect(computeStartStatus(545, '09:00')).toBe('on_time'); // +5m
    expect(computeStartStatus(550, '09:00')).toBe('late');
  });

  it('classifies end status', () => {
    expect(computeEndStatus(1010, '17:00')).toBe('early_leave'); // 16:50
    expect(computeEndStatus(1020, '17:00')).toBe('on_time');
    expect(computeEndStatus(1030, '17:00')).toBe('overtime');
  });

  it('formats duration', () => {
    expect(formatMinutesDuration(495)).toBe('8h 15m');
  });

  it('normalizes pg DATE Date objects without local timezone shift', () => {
    // UTC midnight (node-pg DATE)
    expect(toDateString(new Date(Date.UTC(2026, 7, 25)))).toBe('2026-08-25');
    expect(toDateString('2026-08-25')).toBe('2026-08-25');
    expect(toDateString('2026-08-25T00:00:00.000Z')).toBe('2026-08-25');
    // local midnight (common on Windows) — use calendar day in local TZ
    const localMidnight = new Date(2026, 7, 25, 0, 0, 0, 0);
    expect(toDateString(localMidnight)).toBe('2026-08-25');
  });
});
