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
};
