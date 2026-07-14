import { HttpError } from '../../../utils';

const FETCH_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: '*/*',
};

function isPdfBuffer(buffer: Buffer): boolean {
  return (
    buffer.length >= 4 &&
    buffer[0] === 0x25 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x44 &&
    buffer[3] === 0x46
  );
}

function isImageBuffer(buffer: Buffer): boolean {
  if (buffer.length < 4) return false;
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return true;
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return true;
  }
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) {
    return true;
  }
  return false;
}

async function readResponseBuffer(res: Response): Promise<Buffer> {
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

function isHtmlResponse(contentType: string, buffer: Buffer): boolean {
  if (contentType.includes('text/html')) return true;
  const head = buffer.subarray(0, 64).toString('utf8').toLowerCase();
  return head.includes('<!doctype') || head.includes('<html');
}

function isValidFileBuffer(buffer: Buffer): boolean {
  return buffer.length >= 128 && (isPdfBuffer(buffer) || isImageBuffer(buffer));
}

function extractConfirmToken(html: string): string | null {
  const patterns = [
    /confirm=([0-9A-Za-z_]+)/,
    /name="confirm"\s+value="([0-9A-Za-z_]+)"/,
    /id="download-form"[^>]*action="[^"]*[?&]confirm=([0-9A-Za-z_]+)/,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

async function fetchBinaryUrl(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, {
      headers: FETCH_HEADERS,
      redirect: 'follow',
    });
    if (!res.ok) return null;

    const contentType = String(res.headers.get('content-type') || '').toLowerCase();
    const buffer = await readResponseBuffer(res);
    if (isHtmlResponse(contentType, buffer)) return null;
    if (isValidFileBuffer(buffer)) return buffer;
    return null;
  } catch {
    return null;
  }
}

async function fetchDriveDownloadWithConfirm(fileId: string): Promise<Buffer | null> {
  const initialUrl = `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`;
  try {
    const res = await fetch(initialUrl, { headers: FETCH_HEADERS, redirect: 'follow' });
    if (!res.ok) return null;

    const contentType = String(res.headers.get('content-type') || '').toLowerCase();
    const buffer = await readResponseBuffer(res);

    if (!isHtmlResponse(contentType, buffer) && isValidFileBuffer(buffer)) {
      return buffer;
    }

    const html = buffer.toString('utf8');
    const confirm = extractConfirmToken(html);
    if (!confirm) return null;

    const confirmedUrl = `https://drive.google.com/uc?export=download&confirm=${confirm}&id=${encodeURIComponent(fileId)}`;
    return fetchBinaryUrl(confirmedUrl);
  } catch {
    return null;
  }
}

export async function fetchGoogleDriveFileBuffer(fileId: string): Promise<Buffer> {
  const candidates = [
    `https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download&confirm=t`,
    `https://drive.google.com/uc?export=download&confirm=t&id=${encodeURIComponent(fileId)}`,
    `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`,
  ];

  for (const url of candidates) {
    const buffer = await fetchBinaryUrl(url);
    if (buffer) return buffer;
  }

  const confirmed = await fetchDriveDownloadWithConfirm(fileId);
  if (confirmed) return confirmed;

  throw new HttpError(
    502,
    'تعذر تحميل الملف من Google Drive. تأكد أن الملف مشارك (Anyone with the link).',
  );
}

export async function fetchGoogleDriveThumbnailBuffer(fileId: string): Promise<Buffer> {
  const candidates = [
    `https://drive.google.com/thumbnail?id=${encodeURIComponent(fileId)}&sz=w2000`,
    `https://drive.google.com/thumbnail?id=${encodeURIComponent(fileId)}&sz=w1600`,
    `https://lh3.googleusercontent.com/d/${encodeURIComponent(fileId)}=w1920`,
    `https://lh3.googleusercontent.com/d/${encodeURIComponent(fileId)}`,
    `https://drive.google.com/uc?export=view&id=${encodeURIComponent(fileId)}`,
  ];

  for (const url of candidates) {
    try {
      const res = await fetch(url, { headers: FETCH_HEADERS, redirect: 'follow' });
      if (!res.ok) continue;

      const contentType = String(res.headers.get('content-type') || '').toLowerCase();
      const buffer = await readResponseBuffer(res);
      if (buffer.length >= 128 && !isHtmlResponse(contentType, buffer)) {
        return buffer;
      }
    } catch {
      // try next
    }
  }

  throw new HttpError(502, 'تعذر تحميل صورة المعاينة من Google Drive');
}
