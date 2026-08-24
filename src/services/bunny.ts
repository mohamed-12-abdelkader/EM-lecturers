import crypto from 'crypto';
import axios from 'axios';
import { config } from '../utils';
import fs from 'fs';

const STORAGE_ZONE_NAME = config.BUNNY_STORAGE_ZONE_NAME;
const PUBLIC_HOSTNAME = config.BUNNY_STORAGE_PUBLIC_HOSTNAME;
const MEDIA_PATH = config.BUNNY_MEDIA_PATH;
const BUNNY_ACCESS_KEY = config.BUNNY_ACCESS_KEY;
const STREAM_BASE = config.BUNNY_STREAM_BASE;
const STREAM_API_KEY = config.BUNNY_STREAM_API_KEY;
const STREAM_EMBED_BASE = config.BUNNY_STREAM_EMBED_BASE;
const STREAM_LIBRARY_ID = config.BUNNY_STREAM_LIBRARY_ID;

// URL-safe random hash
function generateHash(length: number): string {
  const byteLength = Math.ceil((length * 3) / 4); // Base64 expands data
  const randomBytes = crypto.randomBytes(byteLength);
  let base64String = randomBytes.toString('base64');
  base64String = base64String.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return base64String.slice(0, length);
}

export async function checkFileExistsStorage(fileName: string): Promise<boolean> {
  try {
    await axios.head(`https://${PUBLIC_HOSTNAME}/${MEDIA_PATH}/${fileName}`);
    return true;
  } catch (error: any) {
    if (error.response && error.response.status === 404) {
      return false;
    }
    throw error;
  }
}

async function retryRequest<T>(
  fn: () => Promise<T>,
  maxAttempts: number,
  delay: number,
): Promise<T> {
  let attempts = 0;
  while (attempts < maxAttempts) {
    try {
      return await fn();
    } catch (_error) {
      attempts++;
      if (attempts >= maxAttempts) {
        throw new Error('Async process failed!.');
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw new Error('Max attempts reached');
}

export interface UploadFile {
  path: string;
  ext: string;
  mime: string;
  originalname?: string;
}

export async function uploadToBunnyStorage(
  file: UploadFile,
  maxAttempts = 2,
  retryDelay = 0,
): Promise<string> {
  const hash = generateHash(16) + '.' + file.ext;
  const url = `https://storage.bunnycdn.com/${STORAGE_ZONE_NAME}/${MEDIA_PATH}/${hash}`;

  try {
    await retryRequest(
      async () => {
        const fileStream = fs.createReadStream(file.path);
        return axios.put(url, fileStream, {
          headers: {
            AccessKey: BUNNY_ACCESS_KEY,
            'Content-Type': file.mime,
          },
          timeout: 60000,
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
        });
      },
      maxAttempts,
      retryDelay,
    );
    return `https://${PUBLIC_HOSTNAME}/${MEDIA_PATH}/${hash}`;
  } catch (error: any) {
    const detail =
      error?.response?.status != null
        ? `HTTP ${error.response.status}`
        : error?.message || 'unknown error';
    throw new Error(`Failed to upload to Bunny.net: ${detail}`);
  } finally {
    if (file?.path) {
      fs.unlinkSync(file.path);
    }
  }
}

export async function uploadToBunnyStream(
  file: UploadFile,
  options?: {
    maxAttempts?: number;
    retryDelay?: number;
    deleteSource?: boolean;
    uploadTimeoutMs?: number;
  },
): Promise<string> {
  const maxAttempts = options?.maxAttempts ?? 3;
  const retryDelay = options?.retryDelay ?? 0;
  const deleteSource = options?.deleteSource ?? true;
  const uploadTimeoutMs = options?.uploadTimeoutMs ?? 600_000;

  if (!STREAM_API_KEY || !STREAM_LIBRARY_ID) {
    throw new Error('Bunny Stream is not configured (BUNNY_STREAM_API_KEY / BUNNY_STREAM_LIBRARY_ID)');
  }

  try {
    const createResponse = await axios.post(
      STREAM_BASE,
      {
        title: file.originalname || 'Untitled',
      },
      {
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          AccessKey: STREAM_API_KEY,
        },
        timeout: 30_000,
      },
    );
    const videoId = createResponse.data.guid;
    const videoUploadUrl = `${STREAM_BASE}/${videoId}`;

    await retryRequest(
      async () => {
        const fileStream = fs.createReadStream(file.path);
        return axios.put(videoUploadUrl, fileStream, {
          headers: {
            'Content-Type': 'application/octet-stream',
            AccessKey: STREAM_API_KEY,
          },
          timeout: uploadTimeoutMs,
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
        });
      },
      maxAttempts,
      retryDelay,
    );

    return `${STREAM_EMBED_BASE}/${STREAM_LIBRARY_ID}/${videoId}`;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'unknown error';
    throw new Error(`Failed to upload to Bunny Stream: ${message}`);
  } finally {
    if (deleteSource && file?.path && fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }
  }
}
