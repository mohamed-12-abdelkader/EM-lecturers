# إنشاء حساب مدرس (Tenant) ومحتوى صفحة اللاندينج

هذا الدليل يشرح **من الـ API** كيف يُنشئ الأدمن **منصة فرعية (Tenant)** لمدرس مع **حساب مدرس (owner)** اختياري، وكيف يُعبَّأ **محتوى اللاندينج** (JSON مرن). للسياق العام للـ Multi-Tenant راجع: [`multi-tenant-saas-architecture.md`](./multi-tenant-saas-architecture.md).

---

## 1) متطلبات الوصول

| الشرط | التفاصيل |
|--------|-----------|
| **الدور** | مستخدم بدور **`admin`** (توكن JWT صالح). |
| **الـ Tenant للطلب** | مسارات الإدارة المركزية تعمل فقط عندما يكون الطلب على الـ tenant **`default`** (انظر [`tenantContext`](../src/middleware/tenantContext.ts): `requireDefaultTenantMiddleware`). |
| **تحديد الـ tenant في الطلب** | على الإنتاج: النطاق الجذر + subdomain (مثلاً لوحة السوبر على النطاق الذي يُحل إلى `default`). على **`localhost`**: أرسل الهيدر **`X-Tenant-Subdomain: default`**. |
| **المصادقة** | `Authorization: Bearer <access_token>` |

---

## 2) إنشاء منصة المدرس + حساب المدرس (مرة واحدة)

**المسار:** `POST /api/super/tenants`

يمكن إرسال الطلب بأحد شكلين:

| الشكل | `Content-Type` | الاستخدام |
|--------|----------------|-----------|
| **JSON** | `application/json` | نفس الحقول كما في الجداول أدناه (بما فيها روابط الصور كنص). |
| **نموذج متعدد الأجزاء** | `multipart/form-data` | رفع **ملفات صور من الجهاز**؛ تُرفع إلى Cloudinary وتُحوَّل تلقائياً إلى روابط تُخزَّن في الحقول المناظرة. **الملف المرفوع يتغلب على** أي قيمة نصية لنفس الحقل (`avatar_url`، إلخ) إن وُجدت في النموذج. |

---

### 2أ) JSON — `application/json`

### الحقول الأساسية (Tenant)

| الحقل | إلزامي | الوصف |
|--------|--------|--------|
| `subdomain` | نعم | اسم فرعي **إنجليزي صغير** فقط، مثلاً `ahmed` → لاحقاً `ahmed.<ROOT>`. نمط: `^[a-z0-9]+(?:-[a-z0-9]+)*$`، الطول 2–63. |
| `display_name` | نعم | الاسم الظاهر للمدرس / المنصة. |
| `specialty` | لا | التخصص. |
| `bio` | لا | نبذة. |
| `avatar_url` | لا | رابط صورة (مثلاً بعد رفعها لـ Cloudinary). |
| `is_active` | لا | افتراضياً `true`. |
| `seo_title` | لا | إن لم يُرسل يُستخدم `display_name`. |
| `seo_meta_description` | لا | وصف لمحركات البحث. |
| `favicon_url` | لا | أيقونة الموقع. |
| `og_image_url` | لا | صورة Open Graph. |

### حساب المدرس (اختياري — `owner`)

إذا أرسلت كائن **`owner`** يُنشأ مستخدم بدور **`teacher`** داخل **نفس الـ tenant** ويُربَط كـ **`owner_user_id`** للـ tenant.

| الحقل | إلزامي | الوصف |
|--------|--------|--------|
| `owner.name` | نعم إن وُجد `owner` | اسم المدرس. |
| `owner.email` | نعم | بريد فريد **داخل هذا الـ tenant** (يمكن تكرار نفس البريد في tenant آخر). |
| `owner.password` | نعم | كلمة مرور (6 أحرف على الأقل). |
| `owner.description` | لا | يُخزَّن في `users.description`. |
| `owner.subject` | لا | يُخزَّن في `users.subject`. |

### محتوى اللاندينج (`landing`)

- يُخزَّن كاملاً في **`tenant_landing_pages.page`** كـ **JSON** (`object` من مفاتيح نصية لأي قيمة JSON).
- الـ API **لا يفرض** شكلاً ثابتاً؛ يُفضَّل الاتفاق مع الواجهة (Next.js) على مفاتيح موحّدة.

**مقترح هيكل (اتفاقية مع الواجهة):**

```json
{
  "hero": {
    "title": "عنوان رئيسي",
    "subtitle": "عنوان فرعي",
    "description": "نص تعريفي",
    "image_url": "https://...",
    "cta_label": "اشترك الآن",
    "cta_href": "/register"
  },
  "theme": {
    "primary_color": "#2563eb",
    "secondary_color": "#0ea5e9",
    "button_style": "rounded",
    "background_style": "gradient",
    "font_family": "Cairo, sans-serif"
  },
  "services": [
    { "title": "خدمة 1", "description": "..." },
    { "title": "خدمة 2", "description": "..." }
  ],
  "about": {
    "bio": "نبذة",
    "experience": "خبرات",
    "qualifications": "مؤهلات",
    "achievements": "إنجازات"
  },
  "statistics": {
    "students_count": 120,
    "courses_count": 15,
    "years_experience": 8
  },
  "testimonials": [
    { "name": "طالب", "text": "رأي...", "rating": 5 }
  ],
  "faq": [
    { "question": "سؤال؟", "answer": "إجابة." }
  ],
  "contact": {
    "whatsapp": "https://wa.me/...",
    "telegram": "https://t.me/...",
    "facebook": "https://...",
    "instagram": "https://..."
  }
}
```

يمكنك إضافة/حذف مفاتيح حسب تصميم الواجهة؛ المهم أن **`landing`** يكون **كائن JSON صالح**.

### إعدادات إضافية (`settings`)

كائن JSON اختياري يُخزَّن في **`tenant_settings.data`** (مثلاً حدود معدّل الطلبات، ميزات مفعّلة، …).

### مثال طلب كامل JSON (`curl`)

```bash
curl -X POST "http://localhost:8000/api/super/tenants" ^
  -H "Content-Type: application/json" ^
  -H "Authorization: Bearer YOUR_ADMIN_JWT" ^
  -H "X-Tenant-Subdomain: default" ^
  -d "{\"subdomain\":\"ahmed\",\"display_name\":\"أحمد محمد\",\"specialty\":\"رياضيات\",\"bio\":\"مدرس ...\",\"avatar_url\":\"https://example.com/ahmed.jpg\",\"seo_title\":\"أحمد — دروس أونلاين\",\"seo_meta_description\":\"صفحة أحمد الرسمية\",\"favicon_url\":\"https://example.com/favicon.ico\",\"og_image_url\":\"https://example.com/og.jpg\",\"owner\":{\"name\":\"أحمد محمد\",\"email\":\"ahmed@example.com\",\"password\":\"secret12\",\"description\":\"مدرس خصوصي\",\"subject\":\"رياضيات\"},\"landing\":{\"hero\":{\"title\":\"مرحباً\",\"subtitle\":\"تعلم مع أحمد\"},\"theme\":{\"primary_color\":\"#1d4ed8\"},\"services\":[],\"about\":{},\"statistics\":{},\"testimonials\":[],\"faq\":[],\"contact\":{}}}"
```

---

### 2ب) رفع صور من الجهاز — `multipart/form-data`

- **لا** تُستخدم `validate` بنفس جسم JSON؛ الحقول النصية تُقرأ من حقول النموذج، و`landing` / `settings` / `owner` تُرسل عادةً كـ **سلاسل JSON** (نص واحد لكل حقل).
- الملفات المدعومة في هذا المسار (أسماء حقول **`multipart`**):

| حقل الملف | النتيجة بعد الرفع |
|-----------|-------------------|
| `avatar` | يُملأ `avatar_url` (صورة المدرّس / المنصة). |
| `favicon` | يُملأ `favicon_url`. |
| `og_image` | يُملأ `og_image_url`. |
| `hero_image` | يُدمج في `landing.hero.image_url` (يُنشئ/يُحدّث كائن `hero`؛ إن وُجد `landing` كنص JSON يُدمج معه). |

**حقول نصية شائعة في النموذج:** `subdomain`, `display_name`, واختيارياً `specialty`, `bio`, `avatar_url`, `favicon_url`, `og_image_url`, `seo_title`, `seo_meta_description`, `is_active` (`true` / `false` / `1`), `landing` (JSON string), `settings` (JSON string).

**المالك (`owner`) — أحد الخيارين:**

1. حقل واحد **`owner`** = نص JSON، مثلاً: `{"name":"...","email":"...","password":"..."}` مع الحقول الاختيارية `description`, `subject`.
2. أو حقول مسطّحة: `owner_name`, `owner_email`, `owner_password` (إلزامية الثلاثة معاً)، و`owner_description`, `owner_subject` اختياريان.

إذا فشل تحليل JSON لـ `owner` / `landing` / `settings` أو كان الشكل ليس كائناً، يعيد الـ API خطأ وصفياً (مثل `Invalid owner JSON`).

### مثال `curl` مع ملفات (ويندوز)

عدّل المسارات لملفات الصور لديك:

```bash
curl -X POST "http://localhost:8000/api/super/tenants" ^
  -H "Authorization: Bearer YOUR_ADMIN_JWT" ^
  -H "X-Tenant-Subdomain: default" ^
  -F "subdomain=ahmed" ^
  -F "display_name=أحمد محمد" ^
  -F "avatar=@C:\path\to\avatar.jpg" ^
  -F "favicon=@C:\path\to\favicon.png" ^
  -F "og_image=@C:\path\to\og.jpg" ^
  -F "hero_image=@C:\path\to\hero.jpg" ^
  -F "owner={\"name\":\"أحمد\",\"email\":\"ahmed@example.com\",\"password\":\"secret12\"}" ^
  -F "landing={\"hero\":{\"title\":\"مرحباً\"},\"theme\":{\"primary_color\":\"#1d4ed8\"}}"
```

ملاحظة: في `-F` قد تحتاج لتفادي مشاكل الاقتباس في الطرفية؛ البديل هو إرسال `owner` من الواجهة كحقل نموذج منفصل أو استخدام الحقول المسطّحة `owner_name`, `owner_email`, `owner_password`.

### الاستجابة الناجحة

- **201** مع جسم يشمل `success: true` و`tenant` (يحتوي على `id`, `subdomain`, `owner_user_id` إن وُجد مالك).

### أخطاء شائعة

| الحالة | الاستجابة |
|--------|------------|
| `subdomain` مكرر | **409** — `Subdomain already taken` |
| ليس على tenant `default` | **403** — كود `SUPER_ADMIN_HOST_REQUIRED` |
| توكن غير أدمن | **403** |
| **400** — `Validation failed` و`subdomain` / `display_name` مطلوبان | غالباً الجسم لم يُستقبل كـ JSON صالح، أو الحقول داخل غلاف (`tenant` / `data`)، أو أسماء **camelCase** فقط (`displayName`, `subDomain`) — الـ API يدعم الآن الغلاف والأسماء البديلة. إن كنت تستخدم **FormData** فلا تضبط `Content-Type: application/json` يدوياً؛ اترك المتصفح يضبط `multipart/form-data` مع `boundary`. |

#### تشخيص سريع لخطأ «Required» على `subdomain` و`display_name`

1. **JSON:** `Content-Type: application/json` والجسم مثلاً `{ "subdomain": "ahmed", "display_name": "..." }` (يمكن أيضاً `{ "tenant": { "subdomain", "display_name" } }` أو `displayName` / `subDomain`).  
2. **رفع ملفات:** `multipart/form-data` + حقول نصية `subdomain` و`display_name` (أو `subDomain` / `displayName`)؛ **لا** تدمج مع هيدر JSON افتراضي من Axios/Interceptors.

---

## 3) تحديث بيانات المنصة أو اللاندينج لاحقاً

**المسار:** `PATCH /api/super/tenants/:id`  
**`:id`** = معرف الـ tenant (من استجابة الإنشاء أو من `GET /api/super/tenants`).

الجسم JSON **جزئي**: أي من `display_name`, `specialty`, `bio`, `avatar_url`, `is_active`, حقول SEO، **`landing`**, **`settings`**.

مثال: تحديث اللاندينج فقط:

```json
{
  "landing": {
    "hero": { "title": "عنوان محدث" },
    "theme": { "primary_color": "#059669" }
  }
}
```

(الدمج مع المحتوى القديم يتم على الواجهة أو ترسل الـ `landing` كاملاً حسب استراتيجيتكم.)

---

## 4) قراءة البيانات العامة (للواجهة / Next.js)

**المسار:** `GET /api/tenants/public/:subdomain`  
**بدون توكن.** يعيد:

- `data.tenant` — بيانات المنصة الظاهرة + SEO (`display_name`, `specialty`, `bio`, `avatar_url`, …).  
- `data.teacher` — **بيانات المدرّس (مالك المنصة)** إن وُجد `owner_user_id` ومستخدم `teacher` مطابق لنفس الـ tenant؛ وإلا **`null`**. الحقول العامة فقط (بدون بريد أو هاتف): `name`, `avatar`, `description`, `subject`, `facebook_url`, `youtube_url`, `tiktok_url`, `whatsapp_number`.  
- `data.settings` — من `tenant_settings.data`  
- `data.landing` — من `tenant_landing_pages.page`  

استدعِ هذا المسار عند فتح صفحة اللاندينج (`ahmed.<your-root-domain>` أو `localhost` مع تمرير الـ subdomain في الواجهة) لعرض **هوية المنصة + المدرّس + محتوى الصفحة** في طلب واحد.

---

## 5) تسجيل دخول المدرس بعد الإنشاء

- يجب أن يكون طلب تسجيل الدخول على **نفس منصة المدرس** (`tenant_id` الصحيح). يُستنتج الـ tenant من:
  - **النطاق:** `ahmed.<ROOT_DOMAIN>` → منصة `ahmed`؛ أو
  - **الهيدر (تطوير / API واحد):** `X-Tenant-Subdomain: ahmed`؛ أو
  - **جسم JSON لـ `POST /api/login`:** عندما يكون الـ tenant المستنتج من النطاق هو **`default`** (مثل `localhost` أو نطاق `api.*` المحجوز)، أرسل مع `email` و`password` الحقل **`subdomain`** (أو `tenant_subdomain`) بقيمة منصة المدرس، مثلاً `"subdomain": "ahmed"`. بدون ذلك يبقى البحث على الـ tenant الافتراضي ويظهر «Invalid credentials» رغم صحة البريد وكلمة المرور.
- **POST** `/api/login` مع `email` + `password` الخاصين بـ **`owner`** (مطابقة البريد غير حساسة لحالة الأحرف بعد `trim`).

---

## 6) مسار قديم: إنشاء مدرس بدون Tenant جديد

إذا أردت فقط إضافة مدرس على **المنصة الحالية (tenant `default`)** دون subdomain جديد، يبقى المسار الحالي لدى المشروع (مثلاً إنشاء مدرس من لوحة الأدمن على نفس الـ API) كما في `POST /api/teacher` مع صلاحيات أدمن — ذلك **لا** ينشئ `tenant` ولا لاندينج منفصل؛ الاستخدام أعلاه مخصص لنموذج **SaaS متعدد المستأجرين**.

---

## 7) ملخص سريع

1. تسجيل دخول أدمن على سياق **`default`** + هيدر المصادقة.  
2. **`POST /api/super/tenants`**: إما **JSON** لكل الحقول، أو **`multipart/form-data`** لرفع `avatar` / `favicon` / `og_image` / `hero_image` من الجهاز مع الحقول النصية و`landing`/`settings`/`owner` كما في القسم 2.  
3. التحقق من **`GET /api/tenants/public/<subdomain>`**.  
4. للتعديلات: **`PATCH /api/super/tenants/<id>`** (حالياً JSON فقط؛ الصور عبر روابط أو رفع منفصل حسب سياسة المنتج).  
5. المدرس يسجّل الدخول من نطاق / هيدر الـ tenant الخاص به.

---

*آخر تحديث يتوافق مع المسارات في `src/controllers/tenantsSuper.ts` (إنشاء عبر JSON أو `multipart` مع رفع Cloudinary) و`src/services/tenants.ts`.*
