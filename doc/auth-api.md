# Auth API — Access Token + Refresh Cookie (Production Ready)

نظام المصادقة الجديد يعتمد على:

| العنصر | التخزين | المدة |
|--------|---------|--------|
| **Access Token** | JSON response (`token`) — في الذاكرة على الـ Frontend | `365d` (سنة) |
| **Refresh Token** | **HttpOnly Cookie** فقط (`em_refresh`) — لا يظهر في JSON | سنة في كل الحالات |

لا تعتمد على LocalStorage للـ Refresh Token.

**الأجهزة:** المدرس والأدمن من **أكثر من جهاز** في نفس الوقت. **الطالب: جلسة نشطة واحدة فقط** — تسجيل الدخول من جهاز جديد يلغي التوكين القديم فوراً. إعداد `student_device_limit` للربط بـ IP فقط.

---

## Base URL

```txt
/api
```

---

## إعدادات البيئة

```env
ACCESS_TOKEN_TTL=365d
REFRESH_TOKEN_TTL_DAYS=365
REFRESH_TOKEN_REMEMBER_DAYS=365
TENANT_ROOT_DOMAIN=em-online.online
# اختياري — يفرض Domain للكوكي (افتراضي: .TENANT_ROOT_DOMAIN)
AUTH_COOKIE_DOMAIN=
# اختياري — lax | strict | none
AUTH_COOKIE_SAMESITE=
# توافق خلفي مع العملاء القدامى (X-Access-Token auto-refresh). عطّله بعد تحديث الفرونت.
AUTH_LEGACY_AUTO_REFRESH=true
```

---

## Cookie

| الخاصية | القيمة |
|---------|--------|
| الاسم | `em_refresh` |
| HttpOnly | `true` |
| Secure | `true` في production / HTTPS |
| SameSite | `lax` على نطاق المنصات، `none` عند الحاجة لـ cross-site HTTPS |
| Path | `/api/auth` |
| Domain | `.em-online.online` (كل subdomains المدرسين) |

الـ Frontend يجب أن يرسل الطلبات بـ:

```ts
credentials: 'include'
```

---

## Endpoints

### `POST /login` (موجود — محدّث)

Body إضافي اختياري:

```json
{
  "email": "teacher@example.com",
  "password": "******",
  "remember_me": true
}
```

Response:

```json
{
  "user": { "id": 1, "name": "...", "role": "teacher", "...": "..." },
  "token": "<access_jwt>",
  "token_type": "Bearer",
  "expires_in": "365d",
  "tenant": { "id": 2, "subdomain": "mr-ali", "display_name": "..." },
  "employee_permissions": null,
  "employee_data": null
}
```

- `Set-Cookie: em_refresh=...` (HttpOnly)
- **لا يُرسل** الـ Refresh Token داخل الـ JSON

---

### `POST /auth/refresh`

بدون body. يعتمد على Cookie فقط.

```http
POST /api/auth/refresh
Cookie: em_refresh=...
```

Response `200`:

```json
{
  "token": "<new_access_jwt>",
  "user": { "id": 1, "name": "...", "role": "teacher" }
}
```

+ تحديث مدة الكوكي. نفس الـ Refresh Token يبقى صالح لنفس الجهاز حتى 365 يوم.

أخطاء:

| Status | code |
|--------|------|
| 401 | `MISSING_REFRESH_TOKEN` |
| 401 | `INVALID_REFRESH_TOKEN` |
| 401 | `SESSION_REVOKED` |
| 401 | `REFRESH_EXPIRED` |

أي طلب API بتوكين الجهاز القديم:

```json
{
  "message": "تم تسجيل الدخول من جهاز آخر. هذه الجلسة لم تعد صالحة.",
  "code": "SESSION_REPLACED"
}
```

---

### `POST /auth/logout`

يمسح Cookie + يلغي جلسة الجهاز الحالي.

```json
{ "message": "Logged out successfully" }
```

---

### `POST /auth/logout-all`

يتطلب Access Token صالح.

يلغي **كل** جلسات المستخدم على كل الأجهزة.

```http
Authorization: Bearer <ACCESS_TOKEN>
```

```json
{ "message": "Logged out from all devices", "revoked_sessions": 3 }
```

---

### `GET /auth/me`

Access Token فقط — **بدون** Refresh تلقائي داخل الـ Backend.

- صالح → بيانات المستخدم + tenant
- منتهي → `401` مع `code: TOKEN_EXPIRED` → الفرونت يستدعي `/auth/refresh`

---

### `GET /auth/sessions`

قائمة الأجهزة النشطة (يتطلب Access Token).

```json
{
  "sessions": [
    {
      "id": "uuid",
      "browser": "Chrome",
      "platform": "Windows",
      "ip": "1.2.3.4",
      "remember_me": true,
      "last_used_at": "...",
      "created_at": "...",
      "expires_at": "..."
    }
  ]
}
```

---

## تدفق الفرونت المقترح

```txt
1. POST /login  (credentials: include) → احفظ token في memory
2. كل طلب API → Authorization: Bearer <token>
3. لو 401 / TOKEN_EXPIRED → POST /auth/refresh (credentials: include)
4. استبدل الـ Access Token → أعد الطلب
5. لو 401 / SESSION_REPLACED → امسح التوكن واطلب Login من جديد (دخل من جهاز آخر)
6. Logout → POST /auth/logout
```

---

## Security

| الحماية | التطبيق |
|---------|---------|
| Refresh Token Hashing | SHA-256 في `user_devices` |
| Refresh Rotation | كل refresh يُبطل القديم ويُصدر جديداً |
| Replay / Reuse Detection | استخدام توكن قديم → إلغاء الجلسة + log `suspicious_activity` |
| Rate Limiting | login / refresh / forgot-password |
| Cookie Security | HttpOnly + Secure + SameSite + Path محدود |
| Security Headers | nosniff, DENY frame, Referrer-Policy, ... |
| CORS + Credentials | مفعّل للمنصات (`*.TENANT_ROOT_DOMAIN`) |
| Single active session | Login جديد يلغي كل جلسات `user_devices` + يغيّر `users.jti` |
| Logging | login, logout, refresh, refresh_failure, device_login, login_replaces_sessions, suspicious_activity |

---

## Backward Compatibility

- حقل `token` في رد Login كما هو (Access Token الآن قصير العمر).
- العملاء القدامى: `AUTH_LEGACY_AUTO_REFRESH=true` يجدد التوكن المنتهي عبر هيدر `X-Access-Token`.
- بعد تحديث الفرونت لـ `/auth/refresh` يُفضّل تعطيل الـ Legacy.
