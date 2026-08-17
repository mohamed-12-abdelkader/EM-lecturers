import QRCode from 'qrcode';
import { getApiUrl } from '../../../config/appUrls';

const UUID_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;

export function studentPublicProfilePath(qrToken: string): string {
  return `/public/center/students/${qrToken}`;
}

export function studentPublicProfileUrl(qrToken: string): string {
  return `${getApiUrl()}${studentPublicProfilePath(qrToken)}`;
}

export function isStudentPublicProfileUrl(value: string): boolean {
  return /\/public\/center\/students\//i.test(value) && UUID_RE.test(value);
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
    // not JSON — maybe a URL from a generic scanner
  }
  const fromUrl = trimmed.match(UUID_RE);
  return fromUrl ? fromUrl[0].toLowerCase() : null;
}

export async function buildStudentQr(qrToken: string): Promise<{
  payload: string;
  qrImageBase64: string;
}> {
  const payload = studentPublicProfileUrl(qrToken);
  const qrImageBase64 = await QRCode.toDataURL(payload, { margin: 2, width: 320 });
  return { payload, qrImageBase64 };
}
