import QRCode from 'qrcode';
import { getApiUrl } from '../../../config/appUrls';
import { config } from '../../../utils';
import type { PublicStudentCard } from '../services/publicStudentCard.service';

const UUID_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;

/** Marker inside QR text so attendance scan can still find the student. Not a URL. */
export const PARENT_CARD_TOKEN_LABEL = 'معرف المسح';

/** Keep QR scannable on phones (UTF-8 Arabic). */
const MAX_QR_BYTES = 1600;

export function studentPublicProfilePath(qrToken: string): string {
  return `/public/center/students/${qrToken}`;
}

function publicApiBase(): string {
  const explicit = config.CENTER_PUBLIC_API_URL?.trim();
  if (explicit) {
    const base = explicit.replace(/\/+$/, '');
    return /\/api$/i.test(base) ? base : `${base}/api`;
  }
  return getApiUrl();
}

/** Kept for optional HTML/JSON endpoint — not encoded in the QR image. */
export function studentPublicProfileUrl(qrToken: string): string {
  return `${publicApiBase()}${studentPublicProfilePath(qrToken)}`;
}

export function isStudentPublicProfileUrl(value: string): boolean {
  return /\/public\/center\/students\//i.test(value) && UUID_RE.test(value);
}

export function isParentCardPayload(value: string): boolean {
  return value.includes(`${PARENT_CARD_TOKEN_LABEL}:`) && UUID_RE.test(value);
}

export function extractQrToken(value?: string | null): string | null {
  if (!value?.trim()) return null;
  const trimmed = value.trim();
  if (UUID_RE.test(trimmed) && trimmed.replace(/[{}]/g, '').length === 36) {
    const exact = trimmed.match(UUID_RE);
    return exact ? exact[0].toLowerCase() : null;
  }
  try {
    const parsed = JSON.parse(trimmed) as { qr_token?: string };
    if (parsed?.qr_token && UUID_RE.test(parsed.qr_token)) {
      return parsed.qr_token.toLowerCase();
    }
  } catch {
    // not JSON — parent card text or a URL from an old QR
  }
  const fromUrl = trimmed.match(UUID_RE);
  return fromUrl ? fromUrl[0].toLowerCase() : null;
}

function money(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const rounded = Number.isInteger(value) ? String(value) : value.toFixed(2);
  return `${rounded} ج.م.`;
}

function byteLength(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

function groupBlock(
  g: PublicStudentCard['groups'][number],
  monthLabel: string,
  compact: boolean,
): string {
  const lines = [`■ ${g.group_name}`];
  if (!compact) {
    const meta = [g.subject_name, g.grade_name].filter(Boolean).join(' · ');
    if (meta) lines.push(meta);
    if (g.schedule_label) lines.push(g.schedule_label);
  }
  lines.push(`حضور ${g.lectures_attended} · غياب ${g.absent} · تأخير ${g.late}`);
  const pay = g.payment_status_ar
    ? `اشتراك ${monthLabel}: ${g.payment_status_ar}` +
      (g.remaining != null ? ` | متبقي ${money(g.remaining)}` : '')
    : `اشتراك ${monthLabel}: غير مسجّل`;
  lines.push(pay);
  return lines.join('\n');
}

export function formatParentCardText(card: PublicStudentCard, qrToken: string): string {
  const totals = card.attendance_totals;
  const header = [
    'بطاقة ولي الأمر',
    `المدرس: ${card.teacher_name}`,
    `الطالب: ${card.student.full_name}`,
    `الكود: ${card.student.student_code}`,
    '',
    `الإجمالي: حضر ${totals.lectures_attended} · غاب ${totals.absent} · تأخير ${totals.late} · بعذر ${totals.excused}`,
  ];

  const groupsFull = card.groups.map((g) => groupBlock(g, card.billing_month.label, false));
  const groupsCompact = card.groups.map((g) => groupBlock(g, card.billing_month.label, true));

  const recent = card.recent_attendance.slice(0, 8).map((row) => {
    const day = row.day_name ? ` (${row.day_name})` : '';
    return `${row.attendance_date} ${row.status_ar} — ${row.group_name}${day}`;
  });
  const recentBlock = recent.length ? ['', 'آخر الحصص:', ...recent] : [];

  const exams = card.exams.slice(0, 6).map((e) => {
    const score = e.is_absent
      ? 'غائب'
      : e.score != null
        ? `${e.score}/${e.total_grade}`
        : '—';
    return `${e.title}: ${score}`;
  });
  const examsBlock = exams.length ? ['', 'درجات السنتر:', ...exams] : [];

  const tokenLine = `\n${PARENT_CARD_TOKEN_LABEL}: ${qrToken}`;

  const candidates = [
    [...header, '', ...groupsFull, ...recentBlock, ...examsBlock],
    [...header, '', ...groupsFull, ...recentBlock],
    [...header, '', ...groupsFull, ...examsBlock],
    [...header, '', ...groupsFull],
    [...header, '', ...groupsCompact],
    header,
  ];

  for (const parts of candidates) {
    const text = `${parts.join('\n')}${tokenLine}`;
    if (byteLength(text) <= MAX_QR_BYTES) return text;
  }

  return `بطاقة ولي الأمر\nالطالب: ${card.student.full_name}\nالكود: ${card.student.student_code}\nحضر ${totals.lectures_attended} · غاب ${totals.absent}${tokenLine}`;
}

export async function buildStudentQr(
  qrToken: string,
  card?: PublicStudentCard | null,
): Promise<{
  payload: string;
  qrImageBase64: string;
}> {
  const payload = card
    ? formatParentCardText(card, qrToken)
    : `بطاقة ولي الأمر\n${PARENT_CARD_TOKEN_LABEL}: ${qrToken}`;
  const qrImageBase64 = await QRCode.toDataURL(payload, {
    margin: 1,
    width: 400,
    errorCorrectionLevel: 'M',
  });
  return { payload, qrImageBase64 };
}
