import path from 'node:path';
import { randomUUID } from 'node:crypto';

export type FileStorageProvider = 'local' | 'cloudinary' | 's3';

export const TEACHER_LIBRARY_PUBLIC_PREFIX = '/uploads/teacher-library';

export const myFilesConfig = {
  maxFileSizeBytes: 100 * 1024 * 1024,
  maxBulkFiles: 20,
  localDir: process.env.TEACHER_FILES_LOCAL_DIR?.trim() || 'uploads/teacher-library',
  signedUrlTtlSeconds: Number(process.env.TEACHER_FILES_SIGNED_URL_TTL_SECONDS || 3600),
  storageProvider: (process.env.FILE_STORAGE_PROVIDER?.trim().toLowerCase() || 'local') as FileStorageProvider,
  aws: {
    region: process.env.AWS_REGION?.trim() || '',
    bucket: process.env.AWS_S3_BUCKET?.trim() || '',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID?.trim() || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY?.trim() || '',
    publicBaseUrl: process.env.AWS_S3_PUBLIC_BASE_URL?.trim() || '',
  },
  allowedExtensions: new Set([
    'pdf',
    'doc',
    'docx',
    'xls',
    'xlsx',
    'ppt',
    'pptx',
    'zip',
    'jpg',
    'jpeg',
    'png',
    'webp',
  ]),
  blockedExtensions: new Set([
    'exe',
    'bat',
    'cmd',
    'sh',
    'ps1',
    'msi',
    'dll',
    'js',
    'mjs',
    'cjs',
    'html',
    'htm',
    'php',
    'asp',
    'aspx',
    'jar',
    'vbs',
    'scr',
    'com',
  ]),
};

export function resolveLocalStorageDir(): string {
  return path.isAbsolute(myFilesConfig.localDir)
    ? myFilesConfig.localDir
    : path.join(process.cwd(), myFilesConfig.localDir);
}

export function resolveTenantStorageDir(tenantId: number): string {
  return path.join(resolveLocalStorageDir(), String(tenantId));
}

export function buildTenantStorageKey(tenantId: number, extension: string): string {
  const ext = extension.replace(/^\./, '').toLowerCase();
  return `${tenantId}/${randomUUID()}.${ext}`;
}

export function buildPublicFileUrl(storageKey: string): string {
  return `${TEACHER_LIBRARY_PUBLIC_PREFIX}/${storageKey}`;
}

/** Resolve on-disk path for a stored file key (supports legacy flat keys). */
export function resolveLocalFilePath(fileKey: string): string {
  const base = resolveLocalStorageDir();
  const normalized = fileKey.replace(/\\/g, '/');
  if (normalized.includes('..')) {
    throw new Error('Invalid file key');
  }
  return path.join(base, normalized);
}
