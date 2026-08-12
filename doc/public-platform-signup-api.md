# إنشاء منصة — Public API (Self-Service)

أي شخص يمكنه إنشاء منصة تعليمية خاصة به بدون حساب أدمن.

Base path: `/api/tenants/public`  
Auth: **لا يُطلب** — endpoints عامة

---

## نظرة عامة

| Method | Path | الوصف |
|--------|------|--------|
| `GET` | `/signup-info` | قواعد النطاق + روابط مساعدة |
| `GET` | `/check-subdomain?subdomain=` | هل النطاق متاح؟ |
| `POST` | `/register` | إنشاء المنصة + حساب المدرس + دخول تلقائي |
| `GET` | `/teacher/available-grades` | الصفوف الدراسية (endpoint منفصل) |

بعد التسجيل الناجح يحصل المدرس على **Access Token** + **Refresh Cookie** (`em_refresh`) مثل `/api/login`.

---

## 1) معلومات النموذج

`GET /api/tenants/public/signup-info`

```json
{
  "success": true,
  "data": {
    "enabled": true,
    "subdomain_rules": {
      "min_length": 2,
      "max_length": 63,
      "pattern": "^[a-z0-9]+(?:-[a-z0-9]+)*$",
      "example": "ahmed-physics"
    },
    "platform_url_example": "https://your-name.em-online.online",
    "tenant_root_domain": "em-online.online",
    "grades_endpoint": "/api/teacher/available-grades",
    "owner_password_min_length": 6
  }
}
```

---

## 2) التحقق من النطاق (Subdomain)

`GET /api/tenants/public/check-subdomain?subdomain=ahmed-physics`

### متاح

```json
{
  "success": true,
  "data": {
    "available": true,
    "subdomain": "ahmed-physics",
    "platform_url": "https://ahmed-physics.em-online.online",
    "message": "النطاق متاح"
  }
}
```

### غير متاح

```json
{
  "success": true,
  "data": {
    "available": false,
    "subdomain": "admin",
    "reason": "SUBDOMAIN_RESERVED",
    "message": "هذا النطاق محجوز ولا يمكن استخدامه"
  }
}
```

### أسباب `reason`

| Code | المعنى |
|------|--------|
| `SUBDOMAIN_TAKEN` | مستخدم من قبل |
| `SUBDOMAIN_RESERVED` | محجوز (admin, api, www, …) |
| `SUBDOMAIN_INVALID_FORMAT` | أحرف غير مسموحة |
| `SUBDOMAIN_TOO_SHORT` / `SUBDOMAIN_TOO_LONG` | الطول |

**Rate limit:** 60 طلب / 15 دقيقة لكل IP.

---

## 3) إنشاء المنصة

`POST /api/tenants/public/register`

**نفس body الخاص بـ `POST /api/super/tenants`** — مع إلزام `owner` (لأنه لازم حساب مالك للمنصة للدخول).

يدعم JSON و `multipart/form-data` (صور: `avatar`, `favicon`, `og_image`, `hero_image`).

لإ إنشاء **منصة أكاديمية** أضف `"platform_type": "academy"` (الافتراضي `"teacher"`). عندها يكون دور المالك `academy` بدل `teacher`. التفاصيل: [academy-api.md](./academy-api.md).

### Request (JSON) — مطابق لـ super/tenants

```json
{
  "subdomain": "ahmed-physics",
  "display_name": "أحمد — فيزياء ثانوي",
  "specialty": "فيزياء",
  "bio": "منصة فيزياء للثانوية العامة",
  "avatar_url": null,
  "is_active": true,
  "seo_title": "أحمد فيزياء",
  "seo_meta_description": "...",
  "favicon_url": null,
  "og_image_url": null,
  "settings": {},
  "landing": {
    "hero": { "title": "مرحباً" }
  },
  "owner": {
    "name": "أحمد محمد",
    "email": "ahmed@example.com",
    "password": "secret12",
    "subject": "فيزياء",
    "description": "مدرس فيزياء",
    "grade_ids": [3, 4],
    "facebook_url": null,
    "instagram_url": null,
    "youtube_url": null,
    "tiktok_url": null,
    "whatsapp_number": "+201012345678"
  },
  "remember_me": false,
  "platform_type": "teacher"
}
```

| حقل | مطلوب | ملاحظات |
|-----|--------|---------|
| `subdomain` | نعم | إنجليزي صغير + أرقام + `-` |
| `display_name` | نعم | اسم المنصة |
| `specialty` | لا | |
| `bio` | لا | |
| `avatar_url` | لا | أو ملف `avatar` في multipart |
| `is_active` | لا | افتراضي `true` |
| `seo_title` / `seo_meta_description` | لا | |
| `favicon_url` / `og_image_url` | لا | أو ملفات |
| `settings` | لا | JSON object |
| `landing` | لا | JSON object |
| `owner` | **نعم** (في public) | نفس شكل super |
| `owner.password` | نعم | حد أدنى 6 أحرف (مثل super) |
| `remember_me` | لا | جلسة طويلة — خاص بـ public فقط |
| `platform_type` | لا | `teacher` (افتراضي) أو `academy` |

### Response `201`

```json
{
  "success": true,
  "data": {
    "tenant": {
      "id": 42,
      "subdomain": "ahmed-physics",
      "display_name": "أحمد — فيزياء ثانوي",
      "is_active": true,
      "owner_user_id": 501,
      "platform_url": "https://ahmed-physics.em-online.online"
    },
    "user": {
      "id": 501,
      "name": "أحمد محمد",
      "email": "ahmed@example.com",
      "phone": null,
      "role": "teacher",
      "avatar": null,
      "must_change_password": false
    },
    "token": "<access_token>",
    "token_type": "Bearer",
    "expires_in": "15m",
    "message": "تم إنشاء منصتك بنجاح — مرحباً بك!"
  }
}
```

- **Access Token** في JSON.
- **Refresh Token** في HttpOnly Cookie `em_refresh`.

### أخطاء

| Status | code | المعنى |
|--------|------|--------|
| `400` | `SUBDOMAIN_INVALID_FORMAT` | نطاق غير صالح |
| `400` | `OWNER_REQUIRED` | owner ناقص |
| `409` | `SUBDOMAIN_TAKEN` | النطاق مستخدم |
| `400` | `INVALID_GRADE_IDS` | صف دراسي غير موجود |
| `429` | `RATE_LIMITED` | أكثر من 10 تسجيلات/ساعة من نفس IP |
| `503` | `SIGNUP_DISABLED` | التسجيل الذاتي معطّل |

---

## 4) الصفوف الدراسية (للنموذج)

`GET /api/teacher/available-grades`

```json
{
  "grades": [
    { "id": 3, "name": "الصف الثالث الثانوي", "slug": "grade-3-secondary", "stage": "secondary", "status": "active" }
  ]
}
```

---

## 5) ما يحدث بعد التسجيل

1. إنشاء سجل `tenants` + `tenant_settings` (تسجيل طلاب ذاتي افتراضياً).
2. إنشاء `tenant_landing_pages` بصفحة ترحيب بسيطة.
3. إنشاء حساب `teacher` وربطه كـ `owner_user_id`.
4. ربط الصفوف في `teacher_grades` إن وُجدت.
5. إصدار جلسة دخول — جاهز للوحة التحكم.

---

## 6) تدفق الواجهة (React)

```
1. GET /signup-info
2. المستخدم يكتب subdomain → debounce → GET /check-subdomain
3. GET /teacher/available-grades (مرة واحدة)
4. POST /register
5. Redirect إلى platform_url أو لوحة المدرس
```

---

## 7) إعدادات السيرفر

| متغير | الافتراضي | الوصف |
|-------|-----------|--------|
| `PUBLIC_PLATFORM_SIGNUP_ENABLED` | `true` | `false` لإيقاف التسجيل الذاتي |
| `TENANT_ROOT_DOMAIN` | — | لبناء `platform_url` |

---

## 8) أمان

- Rate limiting على التحقق والتسجيل.
- كلمات مرور 8+ أحرف.
- Subdomains محجوزة: `www`, `api`, `app`, `admin`, `default`, …
- المنصة تُنشأ `is_active: true` مباشرة.
- لا يمكن إنشاء منصة بدون `owner` (حساب مدرس).

---

## مثال cURL

```bash
# تحقق
curl "http://localhost:8000/api/tenants/public/check-subdomain?subdomain=ahmed-test"

# إنشاء
curl -X POST "http://localhost:8000/api/tenants/public/register" \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Subdomain: default" \
  -d '{
    "subdomain": "ahmed-test",
    "display_name": "أحمد تيست",
    "owner": {
      "name": "أحمد",
      "email": "ahmed@test.com",
      "password": "secret12"
    }
  }'
```
