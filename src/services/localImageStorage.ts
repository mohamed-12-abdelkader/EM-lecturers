import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { UploadApiResponse } from 'cloudinary';

/** Organized local image folders under /uploads */
export const IMAGE_STORAGE_CATEGORIES = [
  'users',
  'teachers',
  'courses',
  'lessons',
  'questions',
  'general',
  'avatars',
  'social',
  'chat',
  'academy',
  'leagues',
  'packages',
  'media',
] as const;

export type ImageStorageCategory = (typeof IMAGE_STORAGE_CATEGORIES)[number] | string;

export const ALLOWED_IMAGE_MIME = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
]);

export const ALLOWED_IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

export const MAX_IMAGE_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

/** Absolute path to project uploads root */
export function getUploadsRoot(): string {
  return path.join(process.cwd(), 'uploads');
}

export function ensureUploadsDir(...segments: string[]): string {
  const dir = path.join(getUploadsRoot(), ...segments.filter(Boolean));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function sanitizeExt(filePathOrName: string): string {
  const ext = path.extname(filePathOrName || '').toLowerCase();
  if (ALLOWED_IMAGE_EXT.has(ext)) return ext;
  return '.jpg';
}

function normalizeCategory(category?: string | null): string {
  const raw = String(category || 'general')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!raw || raw === 'media') return 'general';
  // Keep known category folders; map legacy cloudinary folders
  if (raw === 'course-images' || raw === 'course') return 'courses';
  if (raw === 'question' || raw === 'exam' || raw === 'exams') return 'questions';
  if (raw === 'lesson') return 'lessons';
  if (raw === 'teacher' || raw === 'teacher-avatars') return 'teachers';
  if (raw === 'user' || raw === 'user-avatars') return 'avatars';
  return raw.slice(0, 40);
}

/** Build unique safe filename (never trust client original name alone). */
export function buildUniqueFilename(originalName?: string): string {
  const ext = sanitizeExt(originalName || '');
  return `${Date.now()}-${randomUUID().replace(/-/g, '').slice(0, 12)}${ext}`;
}

/**
 * Public relative path stored in DB, e.g. /uploads/courses/....jpg
 */
export function toPublicUploadPath(category: string, filename: string): string {
  const cat = normalizeCategory(category);
  return `/uploads/${cat}/${filename}`.replace(/\\/g, '/');
}

/** Resolve relative /uploads/... (or absolute URL ending in /uploads/...) to disk path. */
export function resolveUploadDiskPath(storedUrl: string): string | null {
  if (!storedUrl) return null;
  let pathname = storedUrl.trim();
  try {
    if (/^https?:\/\//i.test(pathname)) {
      pathname = new URL(pathname).pathname;
    }
  } catch {
    return null;
  }
  pathname = pathname.split('?')[0].split('#')[0];
  if (!pathname.startsWith('/uploads/')) return null;

  const relative = pathname.replace(/^\/+/, '');
  const full = path.resolve(process.cwd(), relative);
  const root = path.resolve(getUploadsRoot());
  if (!full.startsWith(root + path.sep) && full !== root) {
    return null; // path traversal guard
  }
  return full;
}

export function isAllowedImageUpload(mimetype: string, originalname: string): boolean {
  const mimeOk = ALLOWED_IMAGE_MIME.has(String(mimetype || '').toLowerCase());
  const extOk = ALLOWED_IMAGE_EXT.has(path.extname(originalname || '').toLowerCase());
  return mimeOk && extOk;
}

/**
 * Persist a temp multer file (or any local path) into categorized /uploads and
 * return a Cloudinary-compatible result so existing callers keep working.
 */
export function saveLocalImageFile(
  filePath: string,
  options?: { category?: string; folder?: string; originalFilename?: string },
): UploadApiResponse {
  const category = normalizeCategory(options?.category || options?.folder || 'general');
  const destDir = ensureUploadsDir(category);
  const filename = buildUniqueFilename(options?.originalFilename || filePath);
  const destPath = path.join(destDir, filename);

  if (path.resolve(filePath) !== path.resolve(destPath)) {
    fs.copyFileSync(filePath, destPath);
    try {
      fs.unlinkSync(filePath);
    } catch {
      // ignore temp cleanup failures
    }
  }

  const publicPath = toPublicUploadPath(category, filename);
  const bytes = fs.existsSync(destPath) ? fs.statSync(destPath).size : 0;

  return {
    asset_id: filename,
    public_id: `${category}/${filename.replace(/\.[^.]+$/, '')}`,
    version: 1,
    version_id: filename,
    signature: '',
    width: 0,
    height: 0,
    format: path.extname(filename).replace('.', ''),
    resource_type: 'image',
    created_at: new Date().toISOString(),
    tags: [],
    bytes,
    type: 'upload',
    etag: '',
    placeholder: false,
    url: publicPath,
    secure_url: publicPath,
    folder: category,
    original_filename: filename,
    api_key: '',
  } as unknown as UploadApiResponse;
}

export function saveLocalImageBuffer(
  buffer: Buffer,
  filenameHint: string,
  options?: { category?: string; folder?: string },
): UploadApiResponse {
  const category = normalizeCategory(options?.category || options?.folder || 'general');
  const destDir = ensureUploadsDir(category);
  const filename = buildUniqueFilename(filenameHint);
  const destPath = path.join(destDir, filename);
  fs.writeFileSync(destPath, buffer);

  const publicPath = toPublicUploadPath(category, filename);
  const bytes = buffer.length;

  return {
    asset_id: filename,
    public_id: `${category}/${filename.replace(/\.[^.]+$/, '')}`,
    version: 1,
    version_id: filename,
    signature: '',
    width: 0,
    height: 0,
    format: path.extname(filename).replace('.', ''),
    resource_type: 'image',
    created_at: new Date().toISOString(),
    tags: [],
    bytes,
    type: 'upload',
    etag: '',
    placeholder: false,
    url: publicPath,
    secure_url: publicPath,
    folder: category,
    original_filename: filename,
    api_key: '',
  } as unknown as UploadApiResponse;
}

/** Delete a local upload by relative or absolute /uploads URL. Returns true if deleted. */
export function deleteLocalUploadByUrl(url?: string | null): boolean {
  const diskPath = url ? resolveUploadDiskPath(url) : null;
  if (!diskPath) return false;
  try {
    if (fs.existsSync(diskPath)) {
      fs.unlinkSync(diskPath);
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

/** Ensure category folders exist (with .gitkeep for empty dirs in git). */
export function ensureImageStorageLayout(): void {
  for (const cat of IMAGE_STORAGE_CATEGORIES) {
    if (cat === 'media') continue;
    const dir = ensureUploadsDir(cat);
    const keep = path.join(dir, '.gitkeep');
    if (!fs.existsSync(keep)) {
      fs.writeFileSync(keep, '');
    }
  }
}
