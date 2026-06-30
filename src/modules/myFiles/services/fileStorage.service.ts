import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import axios from 'axios';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v2 as cloudinary } from 'cloudinary';
import { myFilesConfig, resolveLocalStorageDir } from '../config';
import type { StorageUploadResult } from '../types';
import { HttpError, uploadToCloudinary } from '../../../utils';

let s3Client: S3Client | null = null;

function getS3Client(): S3Client {
  if (!s3Client) {
    const { region, accessKeyId, secretAccessKey } = myFilesConfig.aws;
    if (!region || !myFilesConfig.aws.bucket || !accessKeyId || !secretAccessKey) {
      throw new HttpError(500, 'AWS S3 storage is not configured');
    }
    s3Client = new S3Client({
      region,
      credentials: { accessKeyId, secretAccessKey },
    });
  }
  return s3Client;
}

export class FileStorageService {
  static getProvider() {
    return myFilesConfig.storageProvider;
  }

  static async upload(filePath: string, storageKey: string, mimeType: string): Promise<StorageUploadResult> {
    switch (myFilesConfig.storageProvider) {
      case 'local':
        return this.uploadLocal(filePath, storageKey);
      case 's3':
        return this.uploadS3(filePath, storageKey, mimeType);
      case 'cloudinary':
      default:
        return this.uploadCloudinary(filePath, storageKey);
    }
  }

  static async deleteStoredObject(fileKey: string, fileUrl: string): Promise<void> {
    try {
      switch (myFilesConfig.storageProvider) {
        case 'local': {
          const fullPath = path.join(resolveLocalStorageDir(), fileKey);
          await fs.unlink(fullPath).catch(() => undefined);
          break;
        }
        case 's3': {
          const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
          await getS3Client().send(
            new DeleteObjectCommand({
              Bucket: myFilesConfig.aws.bucket,
              Key: fileKey,
            }),
          );
          break;
        }
        case 'cloudinary':
        default: {
          const publicId = fileKey;
          await cloudinary.uploader.destroy(publicId, { resource_type: 'raw' }).catch(() => undefined);
          if (fileUrl) {
            await cloudinary.uploader.destroy(publicId, { resource_type: 'image' }).catch(() => undefined);
          }
          break;
        }
      }
    } catch {
      // Non-blocking cleanup
    }
  }

  static async readBuffer(fileKey: string, fileUrl: string): Promise<Buffer> {
    switch (myFilesConfig.storageProvider) {
      case 'local': {
        const fullPath = path.join(resolveLocalStorageDir(), fileKey);
        return fs.readFile(fullPath);
      }
      case 's3': {
        const response = await getS3Client().send(
          new GetObjectCommand({
            Bucket: myFilesConfig.aws.bucket,
            Key: fileKey,
          }),
        );
        const body = response.Body;
        if (!body) throw new HttpError(404, 'الملف غير موجود في التخزين');
        if (Buffer.isBuffer(body)) return body;
        if (body instanceof Uint8Array) return Buffer.from(body);
        const chunks: Buffer[] = [];
        for await (const chunk of body as Readable) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        return Buffer.concat(chunks);
      }
      case 'cloudinary':
      default: {
        if (!fileUrl) throw new HttpError(404, 'رابط الملف غير متوفر');
        const response = await axios.get<ArrayBuffer>(fileUrl, {
          responseType: 'arraybuffer',
          timeout: 60_000,
          maxContentLength: myFilesConfig.maxFileSizeBytes,
          maxBodyLength: myFilesConfig.maxFileSizeBytes,
        });
        return Buffer.from(response.data);
      }
    }
  }

  static async getDownloadUrl(fileKey: string, fileUrl: string): Promise<string> {
    switch (myFilesConfig.storageProvider) {
      case 's3': {
        const command = new GetObjectCommand({
          Bucket: myFilesConfig.aws.bucket,
          Key: fileKey,
        });
        return getSignedUrl(getS3Client(), command, {
          expiresIn: myFilesConfig.signedUrlTtlSeconds,
        });
      }
      case 'cloudinary':
      default:
        return fileUrl;
    }
  }

  private static async uploadLocal(filePath: string, storageKey: string): Promise<StorageUploadResult> {
    const dir = resolveLocalStorageDir();
    await fs.mkdir(dir, { recursive: true });
    const dest = path.join(dir, storageKey);
    await fs.copyFile(filePath, dest);
    await fs.unlink(filePath).catch(() => undefined);
    const fileUrl = `/uploads/teacher-library/${storageKey}`;
    return { fileUrl, fileKey: storageKey };
  }

  private static async uploadS3(
    filePath: string,
    storageKey: string,
    mimeType: string,
  ): Promise<StorageUploadResult> {
    const body = await fs.readFile(filePath);
    await getS3Client().send(
      new PutObjectCommand({
        Bucket: myFilesConfig.aws.bucket,
        Key: storageKey,
        Body: body,
        ContentType: mimeType,
      }),
    );
    await fs.unlink(filePath).catch(() => undefined);

    const fileUrl =
      myFilesConfig.aws.publicBaseUrl ||
      `https://${myFilesConfig.aws.bucket}.s3.${myFilesConfig.aws.region}.amazonaws.com/${storageKey}`;

    return { fileUrl, fileKey: storageKey };
  }

  private static async uploadCloudinary(
    filePath: string,
    storageKey: string,
  ): Promise<StorageUploadResult> {
    const ext = path.extname(storageKey).toLowerCase();
    const imageExts = new Set(['.jpg', '.jpeg', '.png', '.webp']);
    const resourceType = imageExts.has(ext) ? 'image' : 'raw';

    const result = await uploadToCloudinary(filePath, {
      resource_type: resourceType,
    });

    const fileUrl = result.secure_url as string;
    const fileKey = result.public_id as string;
    return { fileUrl, fileKey };
  }
}
