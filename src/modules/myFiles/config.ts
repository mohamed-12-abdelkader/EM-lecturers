import path from 'node:path';

export type FileStorageProvider = 'local' | 'cloudinary' | 's3';

export const myFilesConfig = {
  maxFileSizeBytes: 100 * 1024 * 1024,
  maxBulkFiles: 20,
  localDir: process.env.TEACHER_FILES_LOCAL_DIR?.trim() || 'uploads/teacher-library',
  signedUrlTtlSeconds: Number(process.env.TEACHER_FILES_SIGNED_URL_TTL_SECONDS || 3600),
  storageProvider: (process.env.FILE_STORAGE_PROVIDER?.trim().toLowerCase() || 'cloudinary') as FileStorageProvider,
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
