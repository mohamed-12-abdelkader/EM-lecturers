# Expo Go + ngrok — دليل التطوير

هذا الدليل يشرح تشغيل الباك إند محلياً مع **Expo Go** على الهاتف عبر رابط **HTTPS** من ngrok.

---

## المتطلبات

1. حساب مجاني على [ngrok](https://dashboard.ngrok.com/signup)
2. نسخ **Authtoken** من [لوحة ngrok](https://dashboard.ngrok.com/get-started/your-authtoken)
3. إضافته في `.env.development`:

```env
NGROK_AUTHTOKEN=your_authtoken_here
PORT=8000
```

4. تثبيت الحزم (مرة واحدة):

```bash
npm install
```

---

## التشغيل السريع (موصى به)

```bash
npm run dev:expo
```

هذا الأمر يقوم تلقائياً بـ:

1. فتح نفق ngrok على المنفذ `PORT`
2. إنشاء ملف `.env.ngrok.local` يحتوي:
   - `BASE_URL=https://xxxx.ngrok-free.app`
   - `API_URL=https://xxxx.ngrok-free.app/api`
   - `NGROK_URL=...`
   - `USE_NGROK=true`
3. تشغيل السيرفر مع هذه الإعدادات

ستظهر في الطرفية:

```
BASE_URL:   https://xxxx.ngrok-free.app
API_URL:    https://xxxx.ngrok-free.app/api
SOCKET_URL: wss://xxxx.ngrok-free.app
```

---

## سكريبتات NPM

| الأمر | الوظيفة |
|--------|---------|
| `npm run dev` | تشغيل السيرفر محلياً فقط (بدون ngrok) |
| `npm run dev:server` | نفس `dev` — السيرفر فقط |
| `npm run dev:expo` | ngrok + السيرفر معاً (لـ Expo Go) |
| `npm run ngrok` | ngrok فقط (السيرفر يعمل في طرفية أخرى) |

### تشغيل منفصل (طرفيتان)

**الطرفية 1:**

```bash
npm run dev
```

**الطرفية 2:**

```bash
npm run ngrok
```

ثم أعد تشغيل السيرفر (أو شغّله بعد ngrok) ليقرأ `.env.ngrok.local`.

---

## إعداد تطبيق Expo

### 1. عنوان الـ API

استخدم `API_URL` من الطرفية أو من:

```http
GET https://YOUR-NGROK-URL.ngrok-free.app/api/server-info
```

الرد:

```json
{
  "app_env": "development",
  "base_url": "https://xxxx.ngrok-free.app",
  "api_url": "https://xxxx.ngrok-free.app/api",
  "socket_url": "wss://xxxx.ngrok-free.app",
  "use_ngrok": true
}
```

### 2. مثال في Expo (axios)

```typescript
const API_URL = 'https://xxxx.ngrok-free.app/api';

export const api = axios.create({
  baseURL: API_URL,
  headers: {
    Authorization: `Bearer ${token}`,
    // قد تحتاج لتجاوز صفحة ngrok التحذيرية:
  },
});
```

### 3. Socket.IO

```typescript
import { io } from 'socket.io-client';

const socket = io('https://xxxx.ngrok-free.app', {
  path: '/socket.io',
  transports: ['websocket', 'polling'],
  auth: { token: accessToken },
});
```

أو استخدم `socket_url` من `/api/server-info`.

---

## متغيرات البيئة

| المتغير | الوصف |
|---------|--------|
| `APP_ENV` | `development` \| `staging` \| `production` |
| `LOCAL_URL` | `http://localhost:8000` |
| `NGROK_URL` | رابط ngrok الحالي (يُملأ تلقائياً) |
| `BASE_URL` | الرابط العام للملفات والروابط المطلقة |
| `API_URL` | `{BASE_URL}/api` |
| `PRODUCTION_URL` | رابط الإنتاج |
| `USE_NGROK` | `true` عند التشغيل عبر `dev:expo` |
| `NGROK_RELAX_CORS` | `true` — يسمح بـ Expo Go و ngrok في التطوير |

---

## كيف يعمل نظام الروابط؟

### ملف الإعدادات المركزي

`src/config/appUrls.ts`:

- `getBaseUrl()` — الرابط العام الحالي
- `getApiUrl()` — جذر الـ API
- `getSocketUrl()` — WebSocket (wss)
- `buildFileUrl('/uploads/...')` — رابط ملف مطلق

### Middleware تلقائي

`absoluteUrlResponseMiddleware` يحوّل في كل رد JSON:

- `/uploads/...` → `https://xxxx.ngrok-free.app/uploads/...`
- `http://localhost:8000/...` → رابط ngrok

لذلك **لا يُرجَع localhost للعميل** أثناء التطوير مع ngrok.

---

## CORS و Expo Go

مع `NGROK_RELAX_CORS=true` يُسمح تلقائياً بـ:

- `exp://` و `exps://` (Expo Go)
- نطاقات `*.ngrok-free.app` و `*.ngrok.io`
- الطلبات بدون `Origin` (تطبيقات native)

أضف أيضاً في `CORS_ORIGIN` أي منافذ محلية تحتاجها:

```env
CORS_ORIGIN=http://localhost:3000,http://localhost:5173,exp://localhost:8081
```

---

## تحديث الرابط عند تغيير ngrok

في الخطة المجانية يتغير الرابط عند كل تشغيل لـ ngrok.

1. أوقف `dev:expo` (Ctrl+C)
2. شغّله مجدداً: `npm run dev:expo`
3. انسخ `API_URL` الجديد إلى تطبيق Expo

أو استخدم `NGROK_DOMAIN` (خطة مدفوعة) لدومين ثابت:

```env
NGROK_DOMAIN=your-subdomain.ngrok-free.app
```

---

## رفع وتحميل الملفات

- الملفات المحلية تُخدم من `/uploads`
- مع ngrok تصبح: `https://xxxx.ngrok-free.app/uploads/...`
- ملفات Cloudinary / Bunny تبقى على CDN كما هي

---

## استكشاف الأخطاء

| المشكلة | الحل |
|---------|------|
| `NGROK_AUTHTOKEN is missing` | أضف التوكن في `.env.development` |
| Expo لا يتصل | تأكد أن الهاتف والكمبيوتر على نفس الشبكة أو استخدم ngrok |
| CORS error | `NGROK_RELAX_CORS=true` و أعد التشغيل |
| صور لا تظهر | تحقق من `/api/server-info` — `base_url` يجب أن يكون HTTPS |
| Socket لا يعمل | استخدم `wss://` وليس `ws://` مع ngrok HTTPS |

---

## الإنتاج

في الإنتاج **لا تستخدم ngrok**. عيّن:

```env
NODE_ENV=production
APP_ENV=production
BASE_URL=https://api.yourdomain.com
API_URL=https://api.yourdomain.com/api
PRODUCTION_URL=https://api.yourdomain.com
USE_NGROK=false
```

---

## ملاحظات أمنية

- لا ترفع `.env.ngrok.local` إلى Git (مُستثنى في `.gitignore`)
- لا تشارك `NGROK_AUTHTOKEN` علناً
- ngrok للتطوير فقط — ليس للإنتاج
