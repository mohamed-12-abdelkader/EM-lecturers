import { HttpError } from '../../../utils';

export type GoogleDriveResourceKind = 'file' | 'document' | 'spreadsheet' | 'presentation';

export interface ParsedGoogleDriveLink {
  fileId: string;
  resourceKind: GoogleDriveResourceKind;
  driveUrl: string;
  viewUrl: string;
  previewUrl: string;
  embedUrl: string;
}

const DRIVE_HOSTS = new Set(['drive.google.com', 'docs.google.com']);

function extractDriveFileId(url: URL): { fileId: string; resourceKind: GoogleDriveResourceKind } | null {
  const path = url.pathname;

  const fileMatch = path.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (fileMatch) {
    return { fileId: fileMatch[1], resourceKind: 'file' };
  }

  const openId = url.searchParams.get('id');
  if (openId && hostIsDrive(url)) {
    return { fileId: openId, resourceKind: 'file' };
  }

  const docMatch = path.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
  if (docMatch) {
    return { fileId: docMatch[1], resourceKind: 'document' };
  }

  const sheetMatch = path.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (sheetMatch) {
    return { fileId: sheetMatch[1], resourceKind: 'spreadsheet' };
  }

  const slidesMatch = path.match(/\/presentation\/d\/([a-zA-Z0-9_-]+)/);
  if (slidesMatch) {
    return { fileId: slidesMatch[1], resourceKind: 'presentation' };
  }

  return null;
}

function hostIsDrive(url: URL): boolean {
  return DRIVE_HOSTS.has(url.hostname.replace(/^www\./, ''));
}

export function parseGoogleDriveLink(input: string): ParsedGoogleDriveLink {
  const trimmed = input?.trim();
  if (!trimmed) {
    throw new HttpError(400, 'رابط Google Drive مطلوب');
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new HttpError(400, 'رابط Google Drive غير صالح');
  }

  if (!hostIsDrive(url)) {
    throw new HttpError(400, 'يجب أن يكون الرابط من Google Drive (drive.google.com أو docs.google.com)');
  }

  const parsed = extractDriveFileId(url);
  if (!parsed) {
    throw new HttpError(400, 'تعذر استخراج معرف الملف من رابط Google Drive');
  }

  const { fileId, resourceKind } = parsed;

  if (resourceKind === 'file') {
    const viewUrl = `https://drive.google.com/file/d/${fileId}/view`;
    const previewUrl = `https://drive.google.com/file/d/${fileId}/preview`;
    return {
      fileId,
      resourceKind,
      driveUrl: viewUrl,
      viewUrl,
      previewUrl,
      embedUrl: previewUrl,
    };
  }

  const base = `https://docs.google.com/${resourceKind === 'document' ? 'document' : resourceKind === 'spreadsheet' ? 'spreadsheets' : 'presentation'}/d/${fileId}`;
  const viewUrl = `${base}/edit`;
  const previewUrl = `${base}/preview`;
  return {
    fileId,
    resourceKind,
    driveUrl: viewUrl,
    viewUrl,
    previewUrl,
    embedUrl: previewUrl,
  };
}

export function inferExtensionFromName(name: string, fallback = 'link'): string {
  const ext = name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!ext || ext === name.toLowerCase()) return fallback;
  if (ext.length > 10) return fallback;
  return ext;
}

export function mimeTypeFromExtension(ext: string): string {
  const map: Record<string, string> = {
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    zip: 'application/zip',
    link: 'application/vnd.google-apps.drive-link',
  };
  return map[ext] ?? 'application/octet-stream';
}
