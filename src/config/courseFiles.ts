import path from 'node:path';

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

/** Max PDF size in bytes. Default 50MB. Override with COURSE_PDF_MAX_FILE_SIZE_MB. */
function resolveMaxFileSizeBytes(): number {
  const mb = parsePositiveInt(process.env.COURSE_PDF_MAX_FILE_SIZE_MB, 50);
  return mb * 1024 * 1024;
}

const localDirRaw = process.env.COURSE_PDF_LOCAL_DIR?.trim() || 'uploads/course-pdfs';
const localPublicPrefixRaw =
  process.env.COURSE_PDF_LOCAL_PUBLIC_PREFIX?.trim() || '/uploads/course-pdfs';

export const courseFilesConfig = {
  get maxFileSizeBytes() {
    return resolveMaxFileSizeBytes();
  },
  get maxFileSizeMb() {
    return Math.round(this.maxFileSizeBytes / (1024 * 1024));
  },
  signedUrlTtlSeconds: parsePositiveInt(process.env.COURSE_PDF_SIGNED_URL_TTL_SECONDS, 300),
  storageFolder: (process.env.COURSE_PDF_STORAGE_FOLDER?.trim() || 'course-pdfs').replace(/^\/+|\/+$/g, ''),
  tempDir: process.env.COURSE_PDF_TEMP_DIR?.trim() || 'uploads/course-pdfs-temp',
  allowedMimeTypes: new Set(['application/pdf', 'application/x-pdf']),
  localDir: localDirRaw,
  localPublicPrefix: localPublicPrefixRaw.replace(/\/+$/g, '') || '/uploads/course-pdfs',
};

export function resolveCoursePdfLocalDir(): string {
  return path.isAbsolute(courseFilesConfig.localDir)
    ? courseFilesConfig.localDir
    : path.join(process.cwd(), courseFilesConfig.localDir);
}

export function buildCoursePdfPublicUrl(storageKey: string): string {
  const key = storageKey.replace(/\\/g, '/').replace(/^\/+/, '');
  return `${courseFilesConfig.localPublicPrefix}/${key}`;
}

export function resolveCoursePdfLocalPath(fileKey: string, fileUrl?: string | null): string {
  if (fileUrl?.startsWith('/uploads/')) {
    const fullPath = path.resolve(process.cwd(), fileUrl.replace(/^\/+/, ''));
    const uploadsRoot = path.resolve(process.cwd(), 'uploads');
    if (!fullPath.startsWith(uploadsRoot)) {
      throw new Error('Invalid course file path');
    }
    return fullPath;
  }
  const base = resolveCoursePdfLocalDir();
  const normalized = fileKey.replace(/\\/g, '/');
  if (normalized.includes('..')) {
    throw new Error('Invalid file key');
  }
  return path.join(base, normalized);
}
