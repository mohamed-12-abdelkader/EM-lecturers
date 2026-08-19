# APIs إنشاء الحساب وتسجيل الدخول

توثيق مسارات **إنشاء الحساب** و**تسجيل الدخول** كما هي في المشروع حالياً.

> **Base URL:** `/api`  
> كل الطلبات `Content-Type: application/json` إلا ما يُذكر خلاف ذلك.  
> أرسل الطلبات بـ `credentials: 'include'` حتى تُحفظ كوكي الـ Refresh.

وثائق مرتبطة:

| الملف | الموضوع |
|--------|---------|
| [auth-api.md](./auth-api.md) | Access Token + Refresh Cookie + الجلسات |
| [teacher-managed-students-api.md](./teacher-managed-students-api.md) | إنشاء الطلاب من لوحة المدرس |
| [student-device-restriction-api.md](./student-device-restriction-api.md) | ربط حساب الطالب بجهاز / IP |

---

## 1) كيف تُحدَّد المنصة (Tenant)

كل حساب مربوط بـ `tenant_id` (منصة مدرس). نفس رقم الهاتف على منصتين = حسابان مختلفان.

الـ Backend يحدد المنصة بهذا الترتيب:

1. **Host** — مثال: `mr-ali.em-online.online` أو `mr-ali.localhost`
2. **Origin / Referer** — لو الـ API شغال على `127.0.0.1` والفرونت على subdomain
3. هيدر `X-Tenant-Subdomain: mr-ali`
4. في `POST /login` و `POST /users/register` فقط: حقل `subdomain` أو `tenant_subdomain` في الـ Body (عندما يكون الـ Host افتراضي)

```http
X-Tenant-Subdomain: mr-ali
```

أو في الـ Body:

```json
{ "subdomain": "mr-ali" }
```

---

## 2) قواعد الجلسة الحالية

| القاعدة | السلوك |
|---------|--------|
| مدة الـ Access Token | **سنة** (`expires_in: "365d"`) |
| مدة الـ Refresh Cookie `em_refresh` | **سنة** في كل الحالات (`remember_me` لا يغيّر المدة) |
| أجهزة الطالب | **افتراضي: أكثر من جهاز.** المدرس يغيّر إلى جهاز واحد من إعدادات المنصة |
| جهاز واحد (لو المدرس فعّله) | Login جديد للطالب يلغي الجلسة القديمة + ربط IP |
| المدرس / الأدمن | Login جديد يلغي الجلسة القديمة دائماً |
| التوكين | يُرسل في JSON باسم `token` — استخدمه: `Authorization: Bearer <token>` |
| الـ Refresh | HttpOnly Cookie فقط — **لا يظهر في JSON** |

لو المدرس فعّل جهاز واحد، والجهاز القديم استخدم التوكين بعد دخول جهاز جديد:

```json
{
  "message": "تم تسجيل الدخول من جهاز آخر. هذه الجلسة لم تعد صالحة.",
  "code": "SESSION_REPLACED"
}
```

الفرونت: امسح التوكين المحلي وأعد المستخدم لصفحة الدخول.

---

## 3) أوضاع تسجيل الطلاب على المنصة

قبل شاشة التسجيل/الدخول اعرض الإعدادات العامة:

```http
GET /api/tenants/public/{subdomain}/registration-settings
```

**Response:**

```json
{
  "success": true,
  "data": {
    "registration_mode": "self_registration",
    "self_registration_enabled": true,
    "login_with_student_code": false,
    "login_with_code_only": false,
    "student_code_digits_only": true,
    "course_group_access_enabled": false,
    "requires_course_group_selection": false,
    "student_device_limit": "multiple_devices",
    "single_device": false,
    "message": null
  }
}
```

| `registration_mode` | شاشة التسجيل | شاشة الدخول |
|---------------------|--------------|-------------|
| `self_registration` | الطالب ينشئ حسابه (`POST /users/register`) | هاتف + كلمة مرور |
| `teacher_registration` | **لا تسجيل ذاتي** — المدرس ينشئ الحساب | رقم الطالب `student_code` + `subdomain` (بدون كلمة مرور) |

صفوف المنصة للتسجيل (عام، بدون توكن):

```http
GET /api/tenants/public/{subdomain}/grades
```

مجموعات الكورس (لو `requires_course_group_selection = true`):

```http
GET /api/tenants/public/{subdomain}/course-groups?grade_id=3
```

---

## 4) إنشاء الحساب

### 4.1 تسجيل طالب بنفسه

```http
POST /api/users/register
```

المسار البديل نفسه: `POST /api/user/register`

يُرفض إذا كانت المنصة على `teacher_registration`.

**Body:**

```json
{
  "name": "أحمد محمد",
  "phone": "01012345678",
  "parent_phone": "01098765432",
  "password": "123456",
  "grade_id": 3,
  "course_group_id": 12,
  "device_ip": "197.54.10.20",
  "subdomain": "mr-ali"
}
```

| الحقل | إجباري | ملاحظات |
|--------|--------|---------|
| `name` | نعم | الاسم |
| `phone` | نعم | `+` اختياري ثم 8–15 رقم |
| `parent_phone` | نعم | نفس تنسيق الهاتف |
| `password` | نعم | 6 أحرف على الأقل |
| `grade_id` | لا | أو `student_level_id` (نفس المعنى) |
| `course_category` | لا | تخصص كورسات: `برمجة` \| `لغات` \| `إدارة وتسويق` \| `بيزنس` \| `مهارات متنوعة` — **لا يُرسل مع `grade_id`** |
| `course_group_id` | لا | مجموعة كورسات المنصة (لو مفعّلة) |
| `device_ip` | لا | أو `deviceIp` / `ip` / `registered_ip` — لربط الجهاز في وضع الجهاز الواحد |
| `subdomain` | حسب الـ Host | مطلوب على localhost / API host. أو `tenant_subdomain` |

**Response `201`:**

```json
{
  "success": true,
  "ip_registered": false,
  "user": {
    "id": 42,
    "phone": "01012345678",
    "name": "أحمد محمد",
    "parent_phone": "01098765432",
    "role": "student",
    "avatar": null,
    "device_ip": null,
    "course_category": null
  },
  "token": "<access_jwt>"
}
```

+ `Set-Cookie: em_refresh=...`

الطالب يدخل المنصة مباشرة بعد التسجيل (توكين جاهز).

**أخطاء شائعة:**

| Status | code | المعنى |
|--------|------|--------|
| 403 | `SELF_REGISTRATION_DISABLED` | المنصة لا تسمح بالتسجيل الذاتي |
| 400 | `PHONE_REGISTERED_ON_TENANT` | الهاتف مسجّل مسبقاً على **هذه** المنصة |
| 400 | `TENANT_NOT_FOUND` | الـ subdomain غير موجود أو غير مفعّل |
| 400 | `COURSE_GROUP_ASSIGN_FAILED` | فشل ربط مجموعة الكورس |

---

### 4.2 المدرس ينشئ حساب طالب

عندما `registration_mode = teacher_registration` (أو حتى مع التسجيل الذاتي).

```http
POST /api/teacher/students
Authorization: Bearer <teacher_jwt>
```

```json
{
  "name": "أحمد محمد علي",
  "grade_id": 3,
  "phone": "01012345678",
  "parent_phone": "01198765432",
  "use_phone_as_password": true
}
```

**Response `201`:** يرجع `student_code` (مثل `"10001"`) داخل `data.credentials` — اعرضه للمدرس مرة واحدة.

التفاصيل الكاملة: [teacher-managed-students-api.md](./teacher-managed-students-api.md)

استيراد CSV: `POST /api/teacher/students/import`

---

### 4.3 إنشاء أدمن / مدرس

```http
POST /api/register-admin
```

لا يتطلب توكن. الحساب يُنشأ على **منصة الـ Host الحالي**.

```json
{
  "name": "محمد علي",
  "email": "admin@example.com",
  "phone": "01011112222",
  "password": "123456",
  "role": "admin"
}
```

| الحقل | إجباري |
|--------|--------|
| `name` | نعم |
| `password` | نعم (6+) |
| `role` | نعم: `admin` أو `teacher` |
| `email` أو `phone` | واحد منهما على الأقل |

**Response `201`:**

```json
{
  "message": "Admin created successfully",
  "user": {
    "id": 10,
    "name": "محمد علي",
    "email": "admin@example.com",
    "phone": "01011112222",
    "role": "admin",
    "avatar": null
  },
  "token": "<access_jwt>"
}
```

لو `role = admin` يُنشأ سجل موظف بصلاحيات كاملة تلقائياً.

`400` — المستخدم موجود بنفس الإيميل أو الهاتف على نفس المنصة.

---

### 4.4 إنشاء منصة مدرس (عام)

التسجيل العام للمنصات **معطّل**.

```http
POST /api/tenants/public/register
```

يرجع دائماً:

```json
{
  "success": false,
  "message": "إنشاء المنصات متاح للأدمن فقط عبر لوحة الإدارة",
  "code": "PUBLIC_SIGNUP_DISABLED",
  "admin_endpoint": "POST /api/super/tenants"
}
```

معلومات الواجهة:

```http
GET /api/tenants/public/signup-info
```

إنشاء المنصة الفعلي: `POST /api/super/tenants` (أدمن النظام).

---

## 5) تسجيل الدخول

```http
POST /api/login
```

حد المعدل: **30 محاولة / 15 دقيقة** لكل IP. عند التجاوز: `429` + `code: RATE_LIMITED`.

يجب إرسال **واحد على الأقل** من: `email` | `phone` | `student_code`.

---

### 5.1 طالب — هاتف + كلمة مرور

استخدمه مع `self_registration`.

```json
{
  "phone": "01012345678",
  "password": "123456",
  "subdomain": "mr-ali",
  "device_ip": "197.54.10.20"
}
```

---

### 5.2 طالب — رقم الطالب فقط

استخدمه مع `teacher_registration`. كلمة المرور **غير مطلوبة**.

```json
{
  "student_code": "10001",
  "subdomain": "mr-ali"
}
```

- `student_code`: أرقام فقط، 4–20 خانة (أي حروف تُحذف تلقائياً).
- على localhost / API host: `subdomain` **إجباري** وإلا `SUBDOMAIN_REQUIRED`.
- لو أُرسلت `password` معها تُتحقق أيضاً.

---

### 5.3 مدرس / أدمن / موظف — إيميل أو هاتف

`subdomain` **غير مطلوب**. المنصة تُكتشف من الحساب.

```json
{
  "email": "teacher@example.com",
  "password": "******"
}
```

أو:

```json
{
  "phone": "01011112222",
  "password": "******"
}
```

لو وُجد أكثر من حساب ستاف بنفس الإيميل/الهاتف على منصات مختلفة:

```json
{
  "message": "يوجد أكثر من حساب بهذا البريد أو الهاتف. أرسل subdomain المنصة.",
  "code": "MULTIPLE_STAFF_ACCOUNTS",
  "accounts": [
    { "role": "teacher", "subdomain": "mr-ali" },
    { "role": "admin", "subdomain": "other-center" }
  ]
}
```

أعد الطلب مع `"subdomain": "mr-ali"`.

---

### 5.4 Response النجاح (`200`)

```json
{
  "success": true,
  "ip_registered": false,
  "user": {
    "id": 42,
    "name": "أحمد محمد",
    "email": null,
    "phone": "01012345678",
    "student_code": "10001",
    "role": "student",
    "avatar": null,
    "must_change_password": false
  },
  "token": "<access_jwt>",
  "token_type": "Bearer",
  "expires_in": "365d",
  "tenant": {
    "id": 5,
    "subdomain": "mr-ali",
    "display_name": "منصة مستر علي"
  },
  "employee_permissions": null,
  "employee_data": null
}
```

+ `Set-Cookie: em_refresh=...` (HttpOnly)

| الحقل | لمن يظهر |
|--------|----------|
| `employee_permissions` / `employee_data` | `admin` و `employee` فقط |
| `ip_registered` | الطلاب — `true` لو اتربط IP الجهاز لأول مرة |
| `must_change_password` | لو المدرس أنشأ الحساب بكلمة مرور مؤقتة |
| `remember_me` في الـ Body | اختياري (`true`/`false`) — المدة حالياً سنة في الحالتين |

بعد النجاح احفظ `token` وأرسله في كل طلب:

```http
Authorization: Bearer <token>
```

---

### 5.5 أخطاء الدخول

| Status | code | المعنى |
|--------|------|--------|
| 400 | — | `Invalid credentials` (بيانات غلط) |
| 400 | `SUBDOMAIN_REQUIRED` | دخول برقم طالب من Host افتراضي بدون subdomain |
| 400 | `TENANT_NOT_FOUND` | المنصة غير موجودة |
| 400 | `TENANT_LOGIN_MISMATCH` | الحساب على منصة أخرى — راجع `expected_subdomain` |
| 403 | `TEACHER_ACCOUNT_INACTIVE` | حساب المدرس غير نشط |
| 403 | `STUDENT_ACCOUNT_INACTIVE` | حساب الطالب موقوف |
| 403 | `ACCOUNT_IP_MISMATCH` | المنصة بجهاز واحد والحساب مربوط بجهاز آخر |
| 403 | `DEVICE_IP_REQUIRED` | تعذر تحديد عنوان الجهاز |
| 409 | `MULTIPLE_STAFF_ACCOUNTS` | أكثر من حساب ستاف — أرسل subdomain |
| 429 | `RATE_LIMITED` | محاولات كثيرة |

`ACCOUNT_IP_MISMATCH` يظهر فقط لو إعداد المنصة `student_device_limit = single_device`. التفاصيل: [student-device-restriction-api.md](./student-device-restriction-api.md)

---

## 6) بعد الدخول — الجلسة

كل المسارات التالية تحت `/api`. الكوكي تُرسل فقط لمسار `/api/auth`.

### تجديد التوكين

```http
POST /api/auth/refresh
```

بدون Body. يعتمد على Cookie `em_refresh`.

```json
{
  "token": "<new_access_jwt>",
  "user": { "id": 42, "name": "...", "role": "student", "must_change_password": false }
}
```

| Status | code |
|--------|------|
| 401 | `MISSING_REFRESH_TOKEN` |
| 401 | `INVALID_REFRESH_TOKEN` |
| 401 | `SESSION_REVOKED` |
| 401 | `REFRESH_EXPIRED` |
| 401 | `REFRESH_REUSE_DETECTED` |
| 401 | `SESSION_REPLACED` |

حد المعدل: 120 / 15 دقيقة.

### المستخدم الحالي

```http
GET /api/auth/me
Authorization: Bearer <token>
```

أو: `GET /api/users/me` (يتطلب توكن صالح عبر middleware).

### تسجيل الخروج

```http
POST /api/auth/logout
```

يمسح الكوكي ويلغي جلسة هذا الجهاز.

```http
POST /api/auth/logout-all
Authorization: Bearer <token>
```

يلغي كل الأجهزة.

### الأجهزة النشطة

```http
GET /api/auth/sessions
Authorization: Bearer <token>
```

---

## 7) كلمة المرور

### نسيت كلمة المرور (بالإيميل)

```http
POST /api/forgot-password
```

```json
{ "email": "user@example.com" }
```

دائماً يرجع `200`: `"If user exists, email was sent"` (لا يكشف إن الحساب موجود).  
حد المعدل: 5 / 15 دقيقة.

### تعيين كلمة مرور جديدة من اللينك

```http
POST /api/reset-password
```

```json
{
  "token": "<من الإيميل>",
  "password": "newpass123"
}
```

### أدمن يغيّر كلمة مرور مستخدم

```http
POST /api/users/change-password
Authorization: Bearer <admin_jwt>
```

```json
{
  "phone": "01012345678",
  "new_password": "newpass123"
}
```

أو `email` بدل `phone`.

### طالب يغيّر كلمة المرور برقم الهاتف

```http
POST /api/student/change-password
```

```json
{
  "phone": "01012345678",
  "new_password": "newpass123"
}
```

لا يتطلب توكن. يبحث عن طالب بهذا الهاتف.

المدرس يعيد تعيين كلمة طالب من: `POST /api/teacher/students/:studentId/reset-password`

---

## 8) تدفق الفرونت المقترح

```txt
1. GET /tenants/public/{subdomain}/registration-settings
2. لو self_registration:
     شاشة تسجيل → POST /users/register
     أو دخول → POST /login  (phone + password)
   لو teacher_registration:
     لا شاشة تسجيل ذاتي
     دخول → POST /login  (student_code + subdomain)
3. احفظ token في الذاكرة (أو التخزين الآمن في الموبايل)
4. كل طلب API → Authorization: Bearer <token>  +  credentials: include
5. 401 TOKEN_EXPIRED → POST /auth/refresh ثم أعد الطلب
6. 401 SESSION_REPLACED → امسح التوكن → صفحة الدخول
     (المستخدم دخل من جهاز آخر)
7. Logout → POST /auth/logout
```

**موبايل / Host افتراضي:** أرسل دائماً `subdomain` في Body لـ `/login` و `/users/register`.

**مدرس من أي دومين:** يكفي الإيميل + الباسورد؛ المنصة تُكتشف وحدها.

---

## 9) ملخص المسارات

| Method | المسار | Auth | الوظيفة |
|--------|--------|------|---------|
| GET | `/tenants/public/:subdomain/registration-settings` | لا | وضع التسجيل/الدخول للمنصة |
| GET | `/tenants/public/:subdomain/grades` | لا | الصفوف للتسجيل |
| GET | `/tenants/public/:subdomain/course-groups` | لا | مجموعات الكورس للتسجيل |
| POST | `/users/register` | لا | تسجيل طالب ذاتي |
| POST | `/teacher/students` | مدرس | إنشاء طالب من اللوحة |
| POST | `/register-admin` | لا | إنشاء أدمن أو مدرس |
| POST | `/tenants/public/register` | لا | معطّل — `PUBLIC_SIGNUP_DISABLED` |
| POST | `/login` | لا | دخول كل الأدوار |
| POST | `/auth/refresh` | Cookie | تجديد Access Token |
| GET | `/auth/me` | Bearer | المستخدم الحالي |
| POST | `/auth/logout` | Cookie | خروج هذا الجهاز |
| POST | `/auth/logout-all` | Bearer | خروج كل الأجهزة |
| GET | `/auth/sessions` | Bearer | الجلسات النشطة |
| POST | `/forgot-password` | لا | إيميل استعادة |
| POST | `/reset-password` | لا | تعيين باسورد من اللينك |
| POST | `/users/change-password` | أدمن | تغيير باسورد مستخدم |
| POST | `/student/change-password` | لا | طالب يغيّر باسورد بالهاتف |
