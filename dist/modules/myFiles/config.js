"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.myFilesConfig = void 0;
exports.resolveLocalStorageDir = resolveLocalStorageDir;
const node_path_1 = __importDefault(require("node:path"));
exports.myFilesConfig = {
    maxFileSizeBytes: 100 * 1024 * 1024,
    maxBulkFiles: 20,
    localDir: process.env.TEACHER_FILES_LOCAL_DIR?.trim() || 'uploads/teacher-library',
    signedUrlTtlSeconds: Number(process.env.TEACHER_FILES_SIGNED_URL_TTL_SECONDS || 3600),
    storageProvider: (process.env.FILE_STORAGE_PROVIDER?.trim().toLowerCase() || 'cloudinary'),
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
function resolveLocalStorageDir() {
    return node_path_1.default.isAbsolute(exports.myFilesConfig.localDir)
        ? exports.myFilesConfig.localDir
        : node_path_1.default.join(process.cwd(), exports.myFilesConfig.localDir);
}
