import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import axios from 'axios';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v2 as cloudinary } from 'cloudinary';
import { myFilesConfig, resolveLocalStorageDir } from '../config';
import type { FileStorageProvider } from '../config';
import type { StorageUploadOptions, StorageUploadResult } from '../types';
import { HttpError, logger, uploadToCloudinary } from '../../../utils';

let s3Client: S3Client | null = null;

type CloudinaryDeliveryType = 'upload' | 'authenticated' | 'private';

function resolveCloudinaryResourceType(fileKey: string, fileUrl: string): 'image' | 'raw' {
  if (fileUrl.includes('/raw/upload/') || fileUrl.includes('/raw/authenticated/') || fileUrl.includes('/raw/private/')) {
    return 'raw';
  }
  if (fileUrl.includes('/image/upload/') || fileUrl.includes('/image/authenticated/')) return 'image';
  const ext = path.extname(fileKey || '').toLowerCase();
  if (['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext)) return 'image';
  return 'raw';
}

function resolveCloudinaryFormat(fileKey: string, fileUrl: string): string {
  const fromKey = path.extname(fileKey).replace(/^\./, '').toLowerCase();
  if (fromKey) return fromKey;
  const fromUrl = fileUrl.split('?')[0].split('.').pop()?.toLowerCase();
  return fromUrl || 'bin';
}

function resolveDeliveryType(fileUrl: string, explicit?: string | null): CloudinaryDeliveryType {
  if (explicit === 'authenticated' || explicit === 'private' || explicit === 'upload') {
    return explicit;
  }
  if (fileUrl.includes('/authenticated/')) return 'authenticated';
  if (fileUrl.includes('/private/')) return 'private';
  return 'upload';
}

function buildCloudinaryAccessUrls(
  fileKey: string,
  fileUrl: string,
  options?: { deliveryType?: string | null; ttlSeconds?: number },
): string[] {
  const resourceType = resolveCloudinaryResourceType(fileKey, fileUrl);
  const format = resolveCloudinaryFormat(fileKey, fileUrl);
  const deliveryType = resolveDeliveryType(fileUrl, options?.deliveryType);
  const ttl = options?.ttlSeconds ?? myFilesConfig.signedUrlTtlSeconds;
  const expiresAt = Math.floor(Date.now() / 1000) + ttl;
  const urls: string[] = [];

  urls.push(
    cloudinary.url(fileKey, {
      resource_type: resourceType,
      type: deliveryType,
      secure: true,
      sign_url: true,
      expires_at: expiresAt,
      ...(resourceType === 'raw' ? { format } : {}),
    }),
  );

  try {
    urls.push(
      cloudinary.utils.private_download_url(fileKey, format, {
        resource_type: resourceType,
        type: deliveryType,
        expires_at: expiresAt,
      }),
    );
  } catch {
    // signed delivery URL remains available
  }

  if (deliveryType !== 'upload') {
    urls.push(
      cloudinary.url(fileKey, {
        resource_type: resourceType,
        type: 'upload',
        secure: true,
        sign_url: true,
        expires_at: expiresAt,
        ...(resourceType === 'raw' ? { format } : {}),
      }),
    );
  }

  if (fileUrl) urls.push(fileUrl);
  return [...new Set(urls.filter(Boolean))];
}

async function fetchCloudinaryBuffer(fileKey: string, fileUrl: string): Promise<Buffer> {
  if (!fileKey) throw new HttpError(404, 'مفتاح الملف غير متوفر');

  const candidateUrls = buildCloudinaryAccessUrls(fileKey, fileUrl);
  let lastStatus: number | undefined;

  for (const url of candidateUrls) {
    try {
      const response = await axios.get<ArrayBuffer>(url, {
        responseType: 'arraybuffer',
        timeout: 60_000,
        maxContentLength: myFilesConfig.maxFileSizeBytes,
        maxBodyLength: myFilesConfig.maxFileSizeBytes,
        validateStatus: (status) => status >= 200 && status < 300,
      });
      return Buffer.from(response.data);
    } catch (error: unknown) {
      const axiosError = error as { response?: { status?: number } };
      lastStatus = axiosError.response?.status ?? lastStatus;
    }
  }

  throw new HttpError(
    502,
    lastStatus === 401
      ? 'تعذر الوصول للملف على Cloudinary (401). تحقق من إعدادات التسليم أو استخدم FILE_STORAGE_PROVIDER=local'
      : 'فشل جلب الملف من التخزين السحابي',
  );
}

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

function withFolder(storageKey: string, folder?: string): string {
  if (!folder) return storageKey;
  return `${folder.replace(/^\/+|\/+$/g, '')}/${storageKey}`;
}

export class FileStorageService {
  static getProvider() {
    return myFilesConfig.storageProvider;
  }

  static async upload(
    filePath: string,
    storageKey: string,
    mimeType: string,
    options?: StorageUploadOptions,
  ): Promise<StorageUploadResult> {
    const key = withFolder(storageKey, options?.folder);
    switch (myFilesConfig.storageProvider) {
      case 'local':
        return this.uploadLocal(filePath, key);
      case 's3':
        return this.uploadS3(filePath, key, mimeType);
      case 'cloudinary':
      default:
        return this.uploadCloudinary(filePath, storageKey, options);
    }
  }

  static async deleteStoredObject(
    fileKey: string,
    fileUrl: string,
    options?: { provider?: FileStorageProvider | string; deliveryType?: string | null },
  ): Promise<void> {
    const provider = (options?.provider || myFilesConfig.storageProvider) as FileStorageProvider | string;
    try {
      switch (provider) {
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
          if (!fileKey) break;
          const deliveryType = resolveDeliveryType(fileUrl, options?.deliveryType);
          const resourceTypes: Array<'raw' | 'image'> = ['raw', 'image'];
          const types: CloudinaryDeliveryType[] = [deliveryType, 'upload', 'authenticated', 'private'];
          for (const resourceType of resourceTypes) {
            for (const type of [...new Set(types)]) {
              await cloudinary.uploader
                .destroy(fileKey, { resource_type: resourceType, type })
                .catch(() => undefined);
            }
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
      default:
        return fetchCloudinaryBuffer(fileKey, fileUrl);
    }
  }

  static async openReadStream(
    fileKey: string,
    fileUrl: string,
    options?: { provider?: string; deliveryType?: string | null; ttlSeconds?: number },
  ): Promise<{ stream: Readable; contentLength?: number }> {
    const provider = options?.provider || myFilesConfig.storageProvider;

    if (fileUrl.startsWith('/uploads/')) {
      const fullPath = path.resolve(process.cwd(), fileUrl.replace(/^\/+/, ''));
      const uploadsRoot = path.resolve(process.cwd(), 'uploads');
      if (!fullPath.startsWith(uploadsRoot)) {
        throw new HttpError(400, 'مسار ملف غير صالح');
      }
      const stat = await fs.stat(fullPath);
      return { stream: createReadStream(fullPath), contentLength: stat.size };
    }

    if (provider === 'local') {
      const fullPath = path.join(resolveLocalStorageDir(), fileKey);
      const stat = await fs.stat(fullPath);
      return { stream: createReadStream(fullPath), contentLength: stat.size };
    }

    if (provider === 's3') {
      const response = await getS3Client().send(
        new GetObjectCommand({
          Bucket: myFilesConfig.aws.bucket,
          Key: fileKey,
        }),
      );
      const body = response.Body;
      if (!body) throw new HttpError(404, 'الملف غير موجود في التخزين');
      return {
        stream: body as Readable,
        contentLength: response.ContentLength,
      };
    }

    if (!fileKey && /^https?:\/\//i.test(fileUrl)) {
      const response = await axios.get(fileUrl, {
        responseType: 'stream',
        timeout: 120_000,
        maxContentLength: Infinity,
        validateStatus: (status) => status >= 200 && status < 300,
      });
      const lengthHeader = response.headers['content-length'];
      return {
        stream: response.data as Readable,
        contentLength: lengthHeader ? Number(lengthHeader) : undefined,
      };
    }

    const signed = await this.getSignedViewUrl(fileKey, fileUrl, {
      deliveryType: options?.deliveryType,
      ttlSeconds: options?.ttlSeconds,
    });
    const candidates = signed
      ? [signed, ...buildCloudinaryAccessUrls(fileKey, fileUrl, options)]
      : buildCloudinaryAccessUrls(fileKey, fileUrl, options);

    let lastStatus: number | undefined;
    for (const url of [...new Set(candidates)]) {
      try {
        const response = await axios.get(url, {
          responseType: 'stream',
          timeout: 120_000,
          maxContentLength: Infinity,
          validateStatus: (status) => status >= 200 && status < 300,
        });
        const lengthHeader = response.headers['content-length'];
        return {
          stream: response.data as Readable,
          contentLength: lengthHeader ? Number(lengthHeader) : undefined,
        };
      } catch (error: unknown) {
        const axiosError = error as { response?: { status?: number } };
        lastStatus = axiosError.response?.status ?? lastStatus;
      }
    }

    throw new HttpError(
      502,
      lastStatus === 401
        ? 'تعذر الوصول للملف على Cloudinary (401)'
        : 'فشل جلب الملف من التخزين السحابي',
    );
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
      default: {
        const signedUrls = buildCloudinaryAccessUrls(fileKey, fileUrl);
        return signedUrls[0] || fileUrl;
      }
    }
  }

  static async getSignedViewUrl(
    fileKey: string,
    fileUrl: string,
    options?: { deliveryType?: string | null; ttlSeconds?: number; provider?: string },
  ): Promise<string | null> {
    const provider = options?.provider || myFilesConfig.storageProvider;
    const ttl = options?.ttlSeconds ?? myFilesConfig.signedUrlTtlSeconds;

    if (provider === 's3' && fileKey) {
      const command = new GetObjectCommand({
        Bucket: myFilesConfig.aws.bucket,
        Key: fileKey,
      });
      return getSignedUrl(getS3Client(), command, { expiresIn: ttl });
    }

    if (provider === 'cloudinary' && fileKey) {
      const urls = buildCloudinaryAccessUrls(fileKey, fileUrl, {
        deliveryType: options?.deliveryType,
        ttlSeconds: ttl,
      });
      return urls[0] || null;
    }

    return null;
  }

  /** رابط مباشر للعرض في iframe (أسرع من البروكسي عبر الـ API) */
  static async getDirectAccessUrl(fileKey: string, fileUrl: string): Promise<string | null> {
    switch (myFilesConfig.storageProvider) {
      case 'cloudinary': {
        const signedUrls = buildCloudinaryAccessUrls(fileKey, fileUrl);
        return signedUrls[0] || null;
      }
      case 's3':
        return this.getDownloadUrl(fileKey, fileUrl);
      case 'local':
      default:
        return null;
    }
  }

  private static async uploadLocal(filePath: string, storageKey: string): Promise<StorageUploadResult> {
    const dir = resolveLocalStorageDir();
    const dest = path.join(dir, storageKey);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(filePath, dest);
    await fs.unlink(filePath).catch(() => undefined);
    const fileUrl = `/uploads/teacher-library/${storageKey}`;
    return { fileUrl, fileKey: storageKey, deliveryType: 'upload', resourceType: 'raw' };
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

    return { fileUrl, fileKey: storageKey, deliveryType: 'upload', resourceType: 'raw' };
  }

  private static async uploadCloudinary(
    filePath: string,
    storageKey: string,
    options?: StorageUploadOptions,
  ): Promise<StorageUploadResult> {
    const ext = path.extname(storageKey).toLowerCase();
    const imageExts = new Set(['.jpg', '.jpeg', '.png', '.webp']);
    const resourceType = imageExts.has(ext) ? 'image' : 'raw';
    const publicId = path.basename(storageKey, ext);
    const folder = options?.folder;
    const access = options?.access ?? 'public';

    const runUpload = async (
      type: CloudinaryDeliveryType,
      accessMode: 'public' | 'authenticated',
      allowLocalFallback: boolean,
    ) =>
      uploadToCloudinary(filePath, {
        resource_type: resourceType,
        type,
        access_mode: accessMode,
        folder,
        public_id: publicId,
        allowLocalFallback,
      });

    if (access === 'authenticated') {
      try {
        const result = await runUpload('authenticated', 'authenticated', false);
        return {
          fileUrl: result.secure_url as string,
          fileKey: result.public_id as string,
          deliveryType: 'authenticated',
          resourceType,
        };
      } catch (error) {
        logger.warn(
          { err: error, storageKey },
          'Authenticated Cloudinary upload failed — falling back to standard upload (view still proxied)',
        );
      }
    }

    const result = await runUpload('upload', access === 'authenticated' ? 'authenticated' : 'public', true);
    return {
      fileUrl: result.secure_url as string,
      fileKey: result.public_id as string,
      deliveryType: 'upload',
      resourceType,
    };
  }
}
