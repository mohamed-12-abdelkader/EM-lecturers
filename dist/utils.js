"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getServerInfo = exports.getSocketUrl = exports.buildFileUrl = exports.getApiUrl = exports.getBaseUrl = exports.generateRandomString = exports.uploadTeacherAvatar = exports.uploadExamImage = exports.uploadBufferToCloudinary = exports.deleteCloudinaryAssetByUrl = exports.uploadToCloudinary = exports.upload = exports.verifyToken = exports.config = exports.HttpError = exports.loggerMiddleware = exports.logger = exports.asyncWrapper = void 0;
exports.generateToken = generateToken;
exports.sendEmail = sendEmail;
exports.sendPushNotification = sendPushNotification;
const dotenv = __importStar(require("dotenv"));
const node_crypto_1 = require("node:crypto");
const pino_1 = __importDefault(require("pino"));
const pino_http_1 = require("pino-http");
const crypto = __importStar(require("node:crypto"));
const envalid_1 = require("envalid");
const jwt = __importStar(require("jsonwebtoken"));
const nodemailer = __importStar(require("nodemailer"));
const multer_1 = __importDefault(require("multer"));
const cloudinary_1 = require("cloudinary");
const fs = __importStar(require("node:fs"));
const util = __importStar(require("node:util"));
const path = __importStar(require("node:path"));
const envFile = process.env.NODE_ENV === 'production'
    ? '.env'
    : process.env.NODE_ENV === 'test'
        ? '.env'
        : '.env.development';
dotenv.config({ path: envFile });
if (process.env.NODE_ENV === 'development') {
    dotenv.config({ path: '.env.ngrok.local', override: true });
}
// Utils functions
const asyncWrapper = (fn) => {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
};
exports.asyncWrapper = asyncWrapper;
// Logger
exports.logger = (0, pino_1.default)({
    redact: ['req.headers.authorization', 'req.headers.cookie'],
});
exports.loggerMiddleware = (0, pino_http_1.pinoHttp)({
    logger: exports.logger.child({ category: 'HttpEvent' }),
    genReqId: function (req, res) {
        const id = (0, node_crypto_1.randomUUID)();
        res.setHeader('X-Request-Id', id);
        return id;
    },
    customLogLevel: function (req, res, err) {
        if (res.statusCode >= 400 && res.statusCode < 500) {
            return 'warn';
        }
        else if (res.statusCode >= 500 || err) {
            return 'error';
        }
        return 'info';
    },
    quietReqLogger: true,
});
class HttpError extends Error {
    status;
    message;
    details;
    constructor(status, message, details) {
        super(message);
        this.name = 'HttpError';
        this.status = status;
        this.message = message;
        this.details = details;
    }
}
exports.HttpError = HttpError;
// Config
exports.config = (0, envalid_1.cleanEnv)(process.env, {
    NODE_ENV: (0, envalid_1.str)({ devDefault: (0, envalid_1.testOnly)('test'), choices: ['development', 'production', 'test'] }),
    APP_ENV: (0, envalid_1.str)({ default: 'development', choices: ['development', 'staging', 'production'] }),
    CORS_ORIGIN: (0, envalid_1.str)(),
    FRONTEND_HOST: (0, envalid_1.str)(),
    /** Public API base (HTTPS). Set automatically by npm run dev:expo */
    BASE_URL: (0, envalid_1.str)({ default: '' }),
    API_URL: (0, envalid_1.str)({ default: '' }),
    LOCAL_URL: (0, envalid_1.str)({ default: '' }),
    NGROK_URL: (0, envalid_1.str)({ default: '' }),
    PRODUCTION_URL: (0, envalid_1.str)({ default: '' }),
    USE_NGROK: (0, envalid_1.bool)({ default: false }),
    NGROK_AUTHTOKEN: (0, envalid_1.str)({ default: '' }),
    NGROK_DOMAIN: (0, envalid_1.str)({ default: '' }),
    NGROK_RELAX_CORS: (0, envalid_1.bool)({ default: true }),
    /** e.g. next-edu.online — used to parse {sub}.root from Host. Empty = always default tenant unless X-Tenant-Subdomain. */
    TENANT_ROOT_DOMAIN: (0, envalid_1.str)({ default: '' }),
    SECRET_KEY: (0, envalid_1.str)({ devDefault: (0, envalid_1.testOnly)(crypto.randomBytes(32).toString('hex')) }),
    ACCESS_TOKEN_EXPIRE_MINUTES: (0, envalid_1.num)({ default: 60 * 24 * 8 }), // 8 days
    COMMON_TOKEN_EXPIRE_HOURS: (0, envalid_1.num)({ default: 8 }),
    PORT: (0, envalid_1.num)({ default: 8000 }),
    // Database
    DATABASE_URL: (0, envalid_1.str)(),
    DATABASE_SSL: (0, envalid_1.bool)({ default: false }),
    // First Superuser
    FIRST_SUPERUSER: (0, envalid_1.str)({ default: undefined }),
    FIRST_SUPERUSER_PASSWORD: (0, envalid_1.str)({ default: undefined }),
    // Emails
    SMTP_HOST: (0, envalid_1.str)({ default: undefined }),
    SMTP_USER: (0, envalid_1.str)({ default: undefined }),
    SMTP_PASSWORD: (0, envalid_1.str)({ default: undefined }),
    SMTP_PORT: (0, envalid_1.port)({ default: 587 }),
    SMTP_TLS: (0, envalid_1.bool)({ default: true }),
    SMTP_SSL: (0, envalid_1.bool)({ default: false }),
    EMAILS_FROM_EMAIL: (0, envalid_1.str)({ default: undefined }),
    EMAILS_FROM_NAME: (0, envalid_1.str)({ default: undefined }),
    // CDN
    CLOUDINARY_URL: (0, envalid_1.str)(),
    CLOUDINARY_CLOUD_NAME: (0, envalid_1.str)(),
    CLOUDINARY_API_KEY: (0, envalid_1.str)(),
    CLOUDINARY_API_SECRET: (0, envalid_1.str)(),
    BUNNY_STORAGE_ZONE_NAME: (0, envalid_1.str)(),
    BUNNY_STORAGE_PUBLIC_HOSTNAME: (0, envalid_1.str)(),
    BUNNY_ACCESS_KEY: (0, envalid_1.str)(),
    BUNNY_MEDIA_PATH: (0, envalid_1.str)(),
    BUNNY_STREAM_API_KEY: (0, envalid_1.str)(),
    BUNNY_STREAM_LIBRARY_ID: (0, envalid_1.str)(),
    BUNNY_STREAM_BASE: (0, envalid_1.str)({
        default: `https://video.bunnycdn.com/library/${process.env.BUNNY_STREAM_LIBRARY_ID}/videos`,
    }),
    BUNNY_STREAM_EMBED_BASE: (0, envalid_1.str)({ default: 'https://iframe.mediadelivery.net/embed' }),
    // Google
    GOOGLE_CLIENT_ID: (0, envalid_1.str)(),
    GOOGLE_CLIENT_SECRET: (0, envalid_1.str)(),
    GOOGLE_API_KEY: (0, envalid_1.str)({ default: '' }),
    LIVEKIT_API_KEY: (0, envalid_1.str)({ default: 'devkey' }),
    LIVEKIT_API_SECRET: (0, envalid_1.str)({ default: 'secret' }),
    LIVEKIT_URL: (0, envalid_1.str)({ default: 'ws://localhost:7880' }),
    // Deepseek
    DEEPSEEK_API_KEY: (0, envalid_1.str)(),
    DEEPSEEK_API_URL: (0, envalid_1.str)({ default: 'https://api.deepseek.com' }),
    // Gemini
    GEMINI_API_KEY: (0, envalid_1.str)({ default: '' }),
    // Mistral OCR / question extraction
    MISTRAL_API_KEY: (0, envalid_1.str)({ default: '' }),
    MISTRAL_OCR_MODEL: (0, envalid_1.str)({ default: 'mistral-ocr-latest' }),
    MISTRAL_CHAT_MODEL: (0, envalid_1.str)({ default: 'mistral-large-latest' }),
    MISTRAL_API_BASE_URL: (0, envalid_1.str)({ default: 'https://api.mistral.ai/v1' }),
    // Teacher creative chatbot
    OPENAI_API_KEY: (0, envalid_1.str)({ default: '' }),
    OPENAI_IMAGE_MODEL: (0, envalid_1.str)({ default: 'gpt-image-2' }),
    TEACHER_CREATIVE_LOGO_PATH: (0, envalid_1.str)({ default: '' }),
    OPENAI_EMBEDDING_MODEL: (0, envalid_1.str)({ default: 'text-embedding-3-small' }),
    OPENAI_EMBEDDING_DIMENSIONS: (0, envalid_1.num)({ default: 1536 }),
    // Ollama
    OLLAMA_API_URL: (0, envalid_1.str)({ default: 'http://ollama.next-edu.online' }),
    OLLAMA_EMBEDDING_MODEL: (0, envalid_1.str)({ default: 'embeddinggemma:300m' }),
    // Milvus
    MILVUS_ADDRESS: (0, envalid_1.str)({ default: 'localhost:19530' }),
    MILVUS_USERNAME: (0, envalid_1.str)({ default: 'root' }),
    MILVUS_PASSWORD: (0, envalid_1.str)({ default: 'Milvus' }),
    // Web Push (VAPID)
    VAPID_PUBLIC_KEY: (0, envalid_1.str)({ default: '' }),
    VAPID_PRIVATE_KEY: (0, envalid_1.str)({ default: '' }),
    VAPID_SUBJECT: (0, envalid_1.str)({ default: 'mailto:support@example.com' }),
    WEB_PUSH_WORKER_ENABLED: (0, envalid_1.bool)({ default: true }),
    WEB_PUSH_WORKER_INTERVAL_MS: (0, envalid_1.num)({ default: 2000 }),
    WEB_PUSH_WORKER_BATCH_SIZE: (0, envalid_1.num)({ default: 50 }),
    WEB_PUSH_MAX_ATTEMPTS: (0, envalid_1.num)({ default: 5 }),
});
async function generateToken(user, pool, opts) {
    const jti = crypto.randomUUID();
    // لا نحدث JTI في قاعدة البيانات للطلاب (يسمح بتسجيل الدخول من أجهزة متعددة)
    // JTI يبقى في التوكن فقط لأغراض أخرى
    const fromUser = user.tenant_id;
    const explicit = opts?.sessionTenantId;
    const tenantId = explicit != null && !Number.isNaN(Number(explicit)) ? Number(explicit) : fromUser;
    const payload = {
        id: user.id,
        email: user.email,
        role: user.role,
        jti,
    };
    if (tenantId != null && !Number.isNaN(Number(tenantId))) {
        payload.tid = Number(tenantId);
    }
    return jwt.sign(payload, exports.config.SECRET_KEY, {
        expiresIn: '7d',
    });
}
const verifyToken = (token) => jwt.verify(token, exports.config.SECRET_KEY);
exports.verifyToken = verifyToken;
// Emails
const transporter = nodemailer.createTransport({
    host: exports.config.SMTP_HOST,
    port: exports.config.SMTP_PORT,
    auth: {
        user: exports.config.SMTP_USER,
        pass: exports.config.SMTP_PASSWORD,
    },
});
async function sendEmail(to, subject, html) {
    await transporter.sendMail({
        from: 'EM Online Academy',
        to,
        subject,
        html,
    });
}
// Upload (generic)
const storage = multer_1.default.diskStorage({
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
const fileFilter = (req, file, cb) => {
    if (file.mimetype.startsWith('image/'))
        cb(null, true);
    else
        cb(new Error('Only image files are allowed'), false);
};
exports.upload = (0, multer_1.default)({
    storage,
    fileFilter,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
});
const unlinkFile = util.promisify(fs.unlink);
cloudinary_1.v2.config({
    cloud_name: exports.config.CLOUDINARY_CLOUD_NAME,
    api_key: exports.config.CLOUDINARY_API_KEY,
    api_secret: exports.config.CLOUDINARY_API_SECRET,
});
const uploadToCloudinary = async (filePath, options) => {
    const uploadOptions = {
        folder: 'media',
    };
    // تحديد نوع الملف إذا تم تمريره
    if (options?.resource_type) {
        uploadOptions.resource_type = options.resource_type;
    }
    const result = await cloudinary_1.v2.uploader.upload(filePath, uploadOptions);
    await unlinkFile(filePath);
    return result;
};
exports.uploadToCloudinary = uploadToCloudinary;
/** Delete a Cloudinary media by its delivered URL (best effort). */
const deleteCloudinaryAssetByUrl = async (url) => {
    if (!url)
        return;
    try {
        // Example: .../upload/v123456/media/path/file.jpg -> media/path/file
        const marker = '/upload/';
        const idx = url.indexOf(marker);
        if (idx < 0)
            return;
        const afterUpload = url.slice(idx + marker.length);
        const pathStart = afterUpload.indexOf('/');
        if (pathStart < 0)
            return;
        const withVersionOrPath = afterUpload.slice(pathStart + 1);
        const withoutVersion = withVersionOrPath.replace(/^v\d+\//, '');
        const publicId = withoutVersion.replace(/\.[^.]+$/, '');
        if (!publicId)
            return;
        await cloudinary_1.v2.uploader.destroy(publicId, { resource_type: 'image' });
    }
    catch {
        // Keep operation non-blocking: data update/delete should not fail if CDN cleanup fails.
    }
};
exports.deleteCloudinaryAssetByUrl = deleteCloudinaryAssetByUrl;
/** رفع buffer (مثلاً صورة صفحة PDF) إلى Cloudinary - يكتب مؤقتاً ثم يرفع ويحذف الملف */
const uploadBufferToCloudinary = async (buffer, filename, options) => {
    const dir = path.join(__dirname, '../../uploads');
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, filename);
    fs.writeFileSync(filePath, buffer);
    return (0, exports.uploadToCloudinary)(filePath, options);
};
exports.uploadBufferToCloudinary = uploadBufferToCloudinary;
// Exam image upload
const examImageStorage = multer_1.default.diskStorage({
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
exports.uploadExamImage = (0, multer_1.default)({
    storage: examImageStorage,
    fileFilter,
    limits: { fileSize: 5 * 1024 * 1024 },
});
// Teacher avatar upload
const teacherAvatarStorage = multer_1.default.diskStorage({
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
exports.uploadTeacherAvatar = (0, multer_1.default)({
    storage: teacherAvatarStorage,
    fileFilter,
    limits: { fileSize: 5 * 1024 * 1024 },
});
const generateRandomString = (length) => {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let randomString = '';
    for (let i = 0; i < length; i++) {
        const randomIndex = Math.floor(Math.random() * characters.length);
        randomString += characters[randomIndex];
    }
    return randomString;
};
exports.generateRandomString = generateRandomString;
async function sendPushNotification(externalUserIds, title, message, data = {}) {
    try {
        const response = await fetch('https://onesignal.com/api/v1/notifications', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                Authorization: 'Basic os_v2_app_tectj6vmqzg4to7biiirgfwmknfd6hsxbhxezbnukyzruxrw44aggsieo4e5tlij4vntzurbbirqhkqxxfx3yw5hmtv45ezz37t3yuy',
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
    }
    catch (error) {
        console.error('Error sending push notification:', error);
        return null;
    }
}
var appUrls_1 = require("./config/appUrls");
Object.defineProperty(exports, "getBaseUrl", { enumerable: true, get: function () { return appUrls_1.getBaseUrl; } });
Object.defineProperty(exports, "getApiUrl", { enumerable: true, get: function () { return appUrls_1.getApiUrl; } });
Object.defineProperty(exports, "buildFileUrl", { enumerable: true, get: function () { return appUrls_1.buildFileUrl; } });
Object.defineProperty(exports, "getSocketUrl", { enumerable: true, get: function () { return appUrls_1.getSocketUrl; } });
Object.defineProperty(exports, "getServerInfo", { enumerable: true, get: function () { return appUrls_1.getServerInfo; } });
