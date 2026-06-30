import * as dotenv from 'dotenv';
import { randomUUID } from 'node:crypto';
import pino from 'pino';
import { pinoHttp } from 'pino-http';
import * as crypto from 'node:crypto';
import { bool, cleanEnv, num, port, str, testOnly } from 'envalid';
import * as jwt from 'jsonwebtoken';
import * as nodemailer from 'nodemailer';
import { NextFunction, RequestHandler, Request, Response } from 'express';
import { User } from './db/types';
import { Pool } from 'pg';
import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';
import * as fs from 'node:fs';
import * as util from 'node:util';
import * as path from 'node:path';

const envFile =
  process.env.NODE_ENV === 'production'
    ? '.env'
    : process.env.NODE_ENV === 'test'
      ? '.env'
      : '.env.development';

dotenv.config({ path: envFile });
if (process.env.NODE_ENV === 'development') {
  dotenv.config({ path: '.env.ngrok.local', override: true });
}

// Utils functions
export const asyncWrapper = (fn: RequestHandler) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

// Logger
export const logger = pino({
  redact: ['req.headers.authorization', 'req.headers.cookie'],
});

export const loggerMiddleware = pinoHttp({
  logger: logger.child({ category: 'HttpEvent' }),
  genReqId: function (req, res) {
    const id = randomUUID();
    res.setHeader('X-Request-Id', id);
    return id;
  },
  customLogLevel: function (req, res, err) {
    if (res.statusCode >= 400 && res.statusCode < 500) {
      return 'warn';
    } else if (res.statusCode >= 500 || err) {
      return 'error';
    }
    return 'info';
  },
  quietReqLogger: true,
});

export class HttpError extends Error {
  readonly status: number;
  readonly message: string;
  readonly details?: Record<string, unknown>;

  constructor(status: number, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.message = message;
    this.details = details;
  }
}

// Config
export const config = cleanEnv(process.env, {
  NODE_ENV: str({ devDefault: testOnly('test'), choices: ['development', 'production', 'test'] }),
  APP_ENV: str({ default: 'development', choices: ['development', 'staging', 'production'] }),
  CORS_ORIGIN: str(),
  FRONTEND_HOST: str(),
  /** Public API base (HTTPS). Set automatically by npm run dev:expo */
  BASE_URL: str({ default: '' }),
  API_URL: str({ default: '' }),
  LOCAL_URL: str({ default: '' }),
  NGROK_URL: str({ default: '' }),
  PRODUCTION_URL: str({ default: '' }),
  USE_NGROK: bool({ default: false }),
  NGROK_AUTHTOKEN: str({ default: '' }),
  NGROK_DOMAIN: str({ default: '' }),
  NGROK_RELAX_CORS: bool({ default: true }),
  /** e.g. next-edu.online — used to parse {sub}.root from Host. Empty = always default tenant unless X-Tenant-Subdomain. */
  TENANT_ROOT_DOMAIN: str({ default: '' }),
  SECRET_KEY: str({ devDefault: testOnly(crypto.randomBytes(32).toString('hex')) }),
  ACCESS_TOKEN_EXPIRE_MINUTES: num({ default: 60 * 24 * 8 }), // 8 days
  COMMON_TOKEN_EXPIRE_HOURS: num({ default: 8 }),
  PORT: num({ default: 8000 }),

  // Database
  DATABASE_URL: str(),
  DATABASE_SSL: bool({ default: false }),

  // First Superuser
  FIRST_SUPERUSER: str({ default: undefined }),
  FIRST_SUPERUSER_PASSWORD: str({ default: undefined }),

  // Emails
  SMTP_HOST: str({ default: undefined }),
  SMTP_USER: str({ default: undefined }),
  SMTP_PASSWORD: str({ default: undefined }),
  SMTP_PORT: port({ default: 587 }),
  SMTP_TLS: bool({ default: true }),
  SMTP_SSL: bool({ default: false }),
  EMAILS_FROM_EMAIL: str({ default: undefined }),
  EMAILS_FROM_NAME: str({ default: undefined }),

  // CDN
  CLOUDINARY_URL: str(),
  CLOUDINARY_CLOUD_NAME: str(),
  CLOUDINARY_API_KEY: str(),
  CLOUDINARY_API_SECRET: str(),

  BUNNY_STORAGE_ZONE_NAME: str(),
  BUNNY_STORAGE_PUBLIC_HOSTNAME: str(),
  BUNNY_ACCESS_KEY: str(),
  BUNNY_MEDIA_PATH: str(),
  BUNNY_STREAM_API_KEY: str(),
  BUNNY_STREAM_LIBRARY_ID: str(),
  BUNNY_STREAM_BASE: str({
    default: `https://video.bunnycdn.com/library/${process.env.BUNNY_STREAM_LIBRARY_ID}/videos`,
  }),
  BUNNY_STREAM_EMBED_BASE: str({ default: 'https://iframe.mediadelivery.net/embed' }),

  // Google
  GOOGLE_CLIENT_ID: str(),
  GOOGLE_CLIENT_SECRET: str(),
  GOOGLE_API_KEY: str({ default: '' }),

  LIVEKIT_API_KEY: str({ default: 'devkey' }),
  LIVEKIT_API_SECRET: str({ default: 'secret' }),
  LIVEKIT_URL: str({ default: 'ws://localhost:7880' }),

  // Deepseek
  DEEPSEEK_API_KEY: str(),
  DEEPSEEK_API_URL: str({ default: 'https://api.deepseek.com' }),

  // Gemini
  GEMINI_API_KEY: str({ default: '' }),

  // Mistral OCR / question extraction
  MISTRAL_API_KEY: str({ default: '' }),
  MISTRAL_OCR_MODEL: str({ default: 'mistral-ocr-latest' }),
  MISTRAL_CHAT_MODEL: str({ default: 'mistral-large-latest' }),
  MISTRAL_API_BASE_URL: str({ default: 'https://api.mistral.ai/v1' }),

  // Teacher creative chatbot
  OPENAI_API_KEY: str({ default: '' }),
  OPENAI_IMAGE_MODEL: str({ default: 'gpt-image-2' }),
  TEACHER_CREATIVE_LOGO_PATH: str({ default: '' }),
  OPENAI_EMBEDDING_MODEL: str({ default: 'text-embedding-3-small' }),
  OPENAI_EMBEDDING_DIMENSIONS: num({ default: 1536 }),

  // Ollama
  OLLAMA_API_URL: str({ default: 'http://ollama.next-edu.online' }),
  OLLAMA_EMBEDDING_MODEL: str({ default: 'embeddinggemma:300m' }),

  // Milvus
  MILVUS_ADDRESS: str({ default: 'localhost:19530' }),
  MILVUS_USERNAME: str({ default: 'root' }),
  MILVUS_PASSWORD: str({ default: 'Milvus' }),

  // Web Push (VAPID)
  VAPID_PUBLIC_KEY: str({ default: '' }),
  VAPID_PRIVATE_KEY: str({ default: '' }),
  VAPID_SUBJECT: str({ default: 'mailto:support@example.com' }),
  WEB_PUSH_WORKER_ENABLED: bool({ default: true }),
  WEB_PUSH_WORKER_INTERVAL_MS: num({ default: 2000 }),
  WEB_PUSH_WORKER_BATCH_SIZE: num({ default: 50 }),
  WEB_PUSH_MAX_ATTEMPTS: num({ default: 5 }),
});

// Security
export type GenerateTokenOptions = {
  /** When set (e.g. from `req.tenant.id` at login), JWT `tid` matches the session host tenant even if `users.tenant_id` is stale. */
  sessionTenantId?: number | null;
};

export async function generateToken(
  user: User,
  pool: Pool,
  opts?: GenerateTokenOptions,
): Promise<string> {
  const jti = crypto.randomUUID();

  // لا نحدث JTI في قاعدة البيانات للطلاب (يسمح بتسجيل الدخول من أجهزة متعددة)
  // JTI يبقى في التوكن فقط لأغراض أخرى

  const fromUser = (user as { tenant_id?: number | null }).tenant_id;
  const explicit = opts?.sessionTenantId;
  const tenantId =
    explicit != null && !Number.isNaN(Number(explicit)) ? Number(explicit) : fromUser;
  const payload: Record<string, unknown> = {
    id: user.id,
    email: user.email,
    role: user.role,
    jti,
  };
  if (tenantId != null && !Number.isNaN(Number(tenantId))) {
    payload.tid = Number(tenantId);
  }

  return jwt.sign(payload, config.SECRET_KEY, {
    expiresIn: '7d',
  });
}

export const verifyToken = (token: string) => jwt.verify(token, config.SECRET_KEY);

// Emails
const transporter = nodemailer.createTransport({
  host: config.SMTP_HOST,
  port: config.SMTP_PORT,
  auth: {
    user: config.SMTP_USER,
    pass: config.SMTP_PASSWORD,
  },
});

export async function sendEmail(to: string, subject: string, html: string) {
  await transporter.sendMail({
    from: 'EM Online Academy',
    to,
    subject,
    html,
  });
}

// Upload (generic)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../../uploads');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${file.originalname}`;
    cb(null, uniqueName);
  },
});

const fileFilter = (req: any, file: any, cb: any) => {
  if (file.mimetype.startsWith('image/')) cb(null, true);
  else cb(new Error('Only image files are allowed'), false);
};

export const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
});

const unlinkFile = util.promisify(fs.unlink);

cloudinary.config({
  cloud_name: config.CLOUDINARY_CLOUD_NAME,
  api_key: config.CLOUDINARY_API_KEY,
  api_secret: config.CLOUDINARY_API_SECRET,
});

export const uploadToCloudinary = async (
  filePath: string,
  options?: { resource_type?: 'image' | 'video' | 'raw' | 'auto' },
) => {
  const uploadOptions: any = {
    folder: 'media',
  };

  // تحديد نوع الملف إذا تم تمريره
  if (options?.resource_type) {
    uploadOptions.resource_type = options.resource_type;
  }

  const result = await cloudinary.uploader.upload(filePath, uploadOptions);
  await unlinkFile(filePath);
  return result;
};

/** Delete a Cloudinary media by its delivered URL (best effort). */
export const deleteCloudinaryAssetByUrl = async (url?: string | null): Promise<void> => {
  if (!url) return;
  try {
    // Example: .../upload/v123456/media/path/file.jpg -> media/path/file
    const marker = '/upload/';
    const idx = url.indexOf(marker);
    if (idx < 0) return;
    const afterUpload = url.slice(idx + marker.length);
    const pathStart = afterUpload.indexOf('/');
    if (pathStart < 0) return;
    const withVersionOrPath = afterUpload.slice(pathStart + 1);
    const withoutVersion = withVersionOrPath.replace(/^v\d+\//, '');
    const publicId = withoutVersion.replace(/\.[^.]+$/, '');
    if (!publicId) return;
    await cloudinary.uploader.destroy(publicId, { resource_type: 'image' });
  } catch {
    // Keep operation non-blocking: data update/delete should not fail if CDN cleanup fails.
  }
};

/** رفع buffer (مثلاً صورة صفحة PDF) إلى Cloudinary - يكتب مؤقتاً ثم يرفع ويحذف الملف */
export const uploadBufferToCloudinary = async (
  buffer: Buffer,
  filename: string,
  options?: { resource_type?: 'image' | 'video' | 'raw' | 'auto' },
) => {
  const dir = path.join(__dirname, '../../uploads');
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, buffer);
  return uploadToCloudinary(filePath, options);
};

// Exam image upload
const examImageStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../../uploads');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${file.originalname}`;
    cb(null, uniqueName);
  },
});

export const uploadExamImage = multer({
  storage: examImageStorage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 },
});

// Teacher avatar upload
const teacherAvatarStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../../uploads');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${file.originalname}`;
    cb(null, uniqueName);
  },
});

export const uploadTeacherAvatar = multer({
  storage: teacherAvatarStorage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 },
});

export const generateRandomString = (length: number) => {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let randomString = '';

  for (let i = 0; i < length; i++) {
    const randomIndex = Math.floor(Math.random() * characters.length);
    randomString += characters[randomIndex];
  }

  return randomString;
};

export async function sendPushNotification(
  externalUserIds: string[] | number[],
  title: string,
  message: string,
  data: Record<string, any> = {},
) {
  try {
    const response = await fetch('https://onesignal.com/api/v1/notifications', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization:
          'Basic os_v2_app_tectj6vmqzg4to7biiirgfwmknfd6hsxbhxezbnukyzruxrw44aggsieo4e5tlij4vntzurbbirqhkqxxfx3yw5hmtv45ezz37t3yuy',
      },
      body: JSON.stringify({
        app_id: '990534fa-ac86-4dc9-bbe1-42111316cc53',
        include_external_user_ids: externalUserIds.map(String),
        contents: { en: message },
        headings: { en: title },
        data,
      }),
    });

    const result = await response.json();
    console.log('OneSignal push result:', result);
    return result;
  } catch (error) {
    console.error('Error sending push notification:', error);
    return null;
  }
}

export { getBaseUrl, getApiUrl, buildFileUrl, getSocketUrl, getServerInfo } from './config/appUrls';
