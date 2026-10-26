import { DEFAULT_PARENT_EXAM_TEMPLATES } from './templates';

export interface QuietHoursConfig {
  enabled: boolean;
  start: string;
  end: string;
  tz: string;
}

export interface ParentsExamConfig {
  no_reply: true;
  language: 'ar-EG';
  interval_seconds: number;
  jitter_seconds: number;
  daily_cap: number;
  quiet_hours: QuietHoursConfig;
}

export interface TeacherExamPrefs {
  auto_send: boolean;
  notify_passed: boolean;
  notify_failed: boolean;
  notify_absent: boolean;
  pass_percentage: number;
  template_passed: string;
  template_failed: string;
  template_absent: string;
}

export const DEFAULT_TEACHER_EXAM_PREFS: TeacherExamPrefs = {
  auto_send: false,
  notify_passed: false,
  notify_failed: false,
  notify_absent: false,
  pass_percentage: 50,
  template_passed: DEFAULT_PARENT_EXAM_TEMPLATES.passed,
  template_failed: DEFAULT_PARENT_EXAM_TEMPLATES.failed,
  template_absent: DEFAULT_PARENT_EXAM_TEMPLATES.absent,
};

export const DEFAULT_PARENTS_EXAM_CONFIG: ParentsExamConfig = {
  no_reply: true,
  language: 'ar-EG',
  interval_seconds: 30,
  jitter_seconds: 10,
  daily_cap: 400,
  quiet_hours: { enabled: true, start: '23:00', end: '08:00', tz: 'Africa/Cairo' },
};

function asRecord(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  if (typeof raw === 'object') return raw as Record<string, unknown>;
  return {};
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function asBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  return fallback;
}

function hhmm(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || !/^\d{2}:\d{2}$/.test(value)) return fallback;
  const [h, m] = value.split(':').map(Number);
  if (h > 23 || m > 59) return fallback;
  return value;
}

export function parseParentsExamConfig(raw: unknown): ParentsExamConfig {
  const src = asRecord(raw);
  const quiet = asRecord(src.quiet_hours);
  return {
    no_reply: true,
    language: 'ar-EG',
    interval_seconds: clampInt(src.interval_seconds, 30, 15, 300),
    jitter_seconds: clampInt(src.jitter_seconds, 10, 0, 120),
    daily_cap: src.daily_cap === 0 || src.daily_cap === '0' ? 0 : clampInt(src.daily_cap, 400, 1, 5000),
    quiet_hours: {
      enabled: asBool(quiet.enabled, true),
      start: hhmm(quiet.start, '23:00'),
      end: hhmm(quiet.end, '08:00'),
      tz: typeof quiet.tz === 'string' && quiet.tz.trim() ? quiet.tz.trim() : 'Africa/Cairo',
    },
  };
}

export function mergeParentsExamConfig(
  current: unknown,
  patch: Partial<ParentsExamConfig> & { quiet_hours?: Partial<QuietHoursConfig> },
): ParentsExamConfig {
  const base = parseParentsExamConfig(current);
  const quietPatch = patch.quiet_hours ?? {};
  return parseParentsExamConfig({
    ...base,
    ...patch,
    quiet_hours: { ...base.quiet_hours, ...quietPatch },
  });
}

function templateText(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const text = value.trim();
  if (!text || text.length > 500) return fallback;
  return text;
}

export function parseTeacherExamPrefs(raw: Partial<TeacherExamPrefs> | null | undefined): TeacherExamPrefs {
  const src = raw ?? {};
  return {
    auto_send: asBool(src.auto_send, false),
    notify_passed: asBool(src.notify_passed, false),
    notify_failed: asBool(src.notify_failed, false),
    notify_absent: asBool(src.notify_absent, false),
    pass_percentage: clampInt(src.pass_percentage, 50, 0, 100),
    template_passed: templateText(src.template_passed, DEFAULT_TEACHER_EXAM_PREFS.template_passed),
    template_failed: templateText(src.template_failed, DEFAULT_TEACHER_EXAM_PREFS.template_failed),
    template_absent: templateText(src.template_absent, DEFAULT_TEACHER_EXAM_PREFS.template_absent),
  };
}

export function templateForCohort(
  prefs: Pick<TeacherExamPrefs, 'template_passed' | 'template_failed' | 'template_absent'> | null | undefined,
  cohort: 'passed' | 'failed' | 'absent',
): string {
  if (!prefs) return DEFAULT_TEACHER_EXAM_PREFS[`template_${cohort}`];
  if (cohort === 'passed') return prefs.template_passed;
  if (cohort === 'failed') return prefs.template_failed;
  return prefs.template_absent;
}

export function cohortEnabled(prefs: TeacherExamPrefs, cohort: 'passed' | 'failed' | 'absent'): boolean {
  if (cohort === 'passed') return prefs.notify_passed;
  if (cohort === 'failed') return prefs.notify_failed;
  return prefs.notify_absent;
}
