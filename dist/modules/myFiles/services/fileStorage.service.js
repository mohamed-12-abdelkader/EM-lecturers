"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FileStorageService = void 0;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const axios_1 = __importDefault(require("axios"));
const client_s3_1 = require("@aws-sdk/client-s3");
const s3_request_presigner_1 = require("@aws-sdk/s3-request-presigner");
const cloudinary_1 = require("cloudinary");
const config_1 = require("../config");
const utils_1 = require("../../../utils");
let s3Client = null;
function getS3Client() {
    if (!s3Client) {
        const { region, accessKeyId, secretAccessKey } = config_1.myFilesConfig.aws;
        if (!region || !config_1.myFilesConfig.aws.bucket || !accessKeyId || !secretAccessKey) {
            throw new utils_1.HttpError(500, 'AWS S3 storage is not configured');
        }
        s3Client = new client_s3_1.S3Client({
            region,
            credentials: { accessKeyId, secretAccessKey },
        });
    }
    return s3Client;
}
class FileStorageService {
    static getProvider() {
        return config_1.myFilesConfig.storageProvider;
    }
    static async upload(filePath, storageKey, mimeType) {
        switch (config_1.myFilesConfig.storageProvider) {
            case 'local':
                return this.uploadLocal(filePath, storageKey);
            case 's3':
                return this.uploadS3(filePath, storageKey, mimeType);
            case 'cloudinary':
            default:
                return this.uploadCloudinary(filePath, storageKey);
        }
    }
    static async deleteStoredObject(fileKey, fileUrl) {
        try {
            switch (config_1.myFilesConfig.storageProvider) {
                case 'local': {
                    const fullPath = node_path_1.default.join((0, config_1.resolveLocalStorageDir)(), fileKey);
                    await promises_1.default.unlink(fullPath).catch(() => undefined);
                    break;
                }
                case 's3': {
                    const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
                    await getS3Client().send(new DeleteObjectCommand({
                        Bucket: config_1.myFilesConfig.aws.bucket,
                        Key: fileKey,
                    }));
                    break;
                }
                case 'cloudinary':
                default: {
                    const publicId = fileKey;
                    await cloudinary_1.v2.uploader.destroy(publicId, { resource_type: 'raw' }).catch(() => undefined);
                    if (fileUrl) {
                        await cloudinary_1.v2.uploader.destroy(publicId, { resource_type: 'image' }).catch(() => undefined);
                    }
                    break;
                }
            }
        }
        catch {
            // Non-blocking cleanup
        }
    }
    static async readBuffer(fileKey, fileUrl) {
        switch (config_1.myFilesConfig.storageProvider) {
            case 'local': {
                const fullPath = node_path_1.default.join((0, config_1.resolveLocalStorageDir)(), fileKey);
                return promises_1.default.readFile(fullPath);
            }
            case 's3': {
                const response = await getS3Client().send(new client_s3_1.GetObjectCommand({
                    Bucket: config_1.myFilesConfig.aws.bucket,
                    Key: fileKey,
                }));
                const body = response.Body;
                if (!body)
                    throw new utils_1.HttpError(404, 'الملف غير موجود في التخزين');
                if (Buffer.isBuffer(body))
                    return body;
                if (body instanceof Uint8Array)
                    return Buffer.from(body);
                const chunks = [];
                for await (const chunk of body) {
                    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
                }
                return Buffer.concat(chunks);
            }
            case 'cloudinary':
            default: {
                if (!fileUrl)
                    throw new utils_1.HttpError(404, 'رابط الملف غير متوفر');
                const response = await axios_1.default.get(fileUrl, {
                    responseType: 'arraybuffer',
                    timeout: 60_000,
                    maxContentLength: config_1.myFilesConfig.maxFileSizeBytes,
                    maxBodyLength: config_1.myFilesConfig.maxFileSizeBytes,
                });
                return Buffer.from(response.data);
            }
        }
    }
    static async getDownloadUrl(fileKey, fileUrl) {
        switch (config_1.myFilesConfig.storageProvider) {
            case 's3': {
                const command = new client_s3_1.GetObjectCommand({
                    Bucket: config_1.myFilesConfig.aws.bucket,
                    Key: fileKey,
                });
                return (0, s3_request_presigner_1.getSignedUrl)(getS3Client(), command, {
                    expiresIn: config_1.myFilesConfig.signedUrlTtlSeconds,
                });
            }
            case 'cloudinary':
            default:
                return fileUrl;
        }
    }
    static async uploadLocal(filePath, storageKey) {
        const dir = (0, config_1.resolveLocalStorageDir)();
        await promises_1.default.mkdir(dir, { recursive: true });
        const dest = node_path_1.default.join(dir, storageKey);
        await promises_1.default.copyFile(filePath, dest);
        await promises_1.default.unlink(filePath).catch(() => undefined);
        const fileUrl = `/uploads/teacher-library/${storageKey}`;
        return { fileUrl, fileKey: storageKey };
    }
    static async uploadS3(filePath, storageKey, mimeType) {
        const body = await promises_1.default.readFile(filePath);
        await getS3Client().send(new client_s3_1.PutObjectCommand({
            Bucket: config_1.myFilesConfig.aws.bucket,
            Key: storageKey,
            Body: body,
            ContentType: mimeType,
        }));
        await promises_1.default.unlink(filePath).catch(() => undefined);
        const fileUrl = config_1.myFilesConfig.aws.publicBaseUrl ||
            `https://${config_1.myFilesConfig.aws.bucket}.s3.${config_1.myFilesConfig.aws.region}.amazonaws.com/${storageKey}`;
        return { fileUrl, fileKey: storageKey };
    }
    static async uploadCloudinary(filePath, storageKey) {
        const ext = node_path_1.default.extname(storageKey).toLowerCase();
        const imageExts = new Set(['.jpg', '.jpeg', '.png', '.webp']);
        const resourceType = imageExts.has(ext) ? 'image' : 'raw';
        const result = await (0, utils_1.uploadToCloudinary)(filePath, {
            resource_type: resourceType,
        });
        const fileUrl = result.secure_url;
        const fileKey = result.public_id;
        return { fileUrl, fileKey };
    }
}
exports.FileStorageService = FileStorageService;
