# نظام المنصة الحالي وتعديلات Multi-Tenant (المرحلة الأولى)

هذا المستند يشرح **وضع المشروع قبل وبعد** إدخال أساس الـ **Multi-Tenant** على مستوى الـ **API** (Express + PostgreSQL). الواجهة الأمامية (مثل Next.js) ليست جزءاً من هذا المستودع؛ التعديلات هنا تخص الـ **backend** فقط.

---

## 1) ما هو النظام حالياً (المستودع `emOnline-api-2`)

- **تقنية:** Node.js، Express، TypeScript، PostgreSQL (`node-pg-migrate`)، Redis وخدمات أخرى حسب الميزات.
- **الدور:** واجهة برمجية واحدة (`/api/...`) لمنصة تعليمية تشمل على سبيل المثال: مستخدمين (طالب / مدرس / أدمن / موظف)، كورسات، محتوى، اشتراكات، محادثات، دعم فني، محاسبة، وغيرها.
- **قبل التعديل:** كان نموذج المستخدمين يفترض منصة **واحدة** عالمياً، مع قيود **فريدة** على `email` و `phone` على مستوى جدول `users` بالكامل (أي حساب واحد لكل بريد أو هاتف عبر المنصة كلها).

---

## 2) الهدف من التعديلات الحالية

التحضير لتحويل المنصة إلى **SaaS متعدد المستأجرين (Multi-Tenant)** بحيث:

- كل **مدرس / منصة فرعية** يمثل **Tenant** مستقل منطقياً.
- **البريد والهاتف** يكونان فريدين **داخل نفس الـ Tenant** وليس على مستوى قاعدة البيانات كلها (`(email + tenant_id)` و `(phone + tenant_id)` عبر فهارس جزئية).
- تحديد الـ Tenant من **اسم المضيف (Host)** أو من هيدر للتطوير.

> **ملاحظة:** ربط **جميع** الجداول (`courses`, `payments`, …) بـ `tenant_id` لم يُكتمل بعد؛ المرحلة الحالية تركز على **هوية الـ Tenant**، **المستخدمين**، و**واجهات إدارة الـ tenants** و**قراءة اللاندينج العامة**.

---

## 3) تعديلات قاعدة البيانات (Migration)

الملف: `migrations/1710000000000_multi_tenant_foundation.sql`

| العنصر | الوصف |
|--------|--------|
| **`tenants`** | سجل لكل مستأجر: `subdomain` (فريد، أحرف صغيرة)، `display_name`, تخصص، نبذة، صورة، تفعيل، حقول SEO أساسية (`seo_title`, …)، `owner_user_id` اختياري. |
| **`tenant_settings`** | إعدادات تشغيلية لكل tenant بصيغة `JSONB` (`data`). |
| **`tenant_landing_pages`** | محتوى صفحة الهبوط/الـ Page Builder بصيغة `JSONB` (`page`). |
| **`users.tenant_id`** | عمود إلزامي يربط كل مستخدم بـ tenant. |
| **Tenant افتراضي** | إدراج صف بـ `subdomain = 'default'` لربط **كل المستخدمين الحاليين** به عند الترقية. |
| **فهارس فريدة جديدة** | إزالة `UNIQUE` العام على `email` / `phone` واستبدالها بفهارس فريدة مركبة مع `tenant_id` (مع شروط `WHERE` للقيم الفارغة). |
| **`DEFAULT` على `tenant_id`** | القيمة الافتراضية `1` (tenant الافتراضي) لمسارات `INSERT` قديمة لم تُمرَّر لها `tenant_id` بعد، لتجنب كسر النظام أثناء الانتقال التدريجي. |

قسم **Down Migration** موجود في نفس الملف لمحاولة التراجع (بحذر في بيئات الإنتاج).

---

## 4) متغيرات البيئة الجديدة

في `src/utils.ts` (عبر `envalid`):

| المتغير | المعنى |
|---------|--------|
| **`TENANT_ROOT_DOMAIN`** | النطاق الجذر للمنصة، مثل `next-edu.online`. يُستخدم لاستخراج الـ subdomain من `Host` (مثلاً `ahmed.next-edu.online` → `ahmed`). إذا كان **فارغاً**، يُعامل الطلب كأنه على الـ tenant الافتراضي ما لم يُستخدم الهيدر أدناه. |

**التطوير على `localhost`:**

- **`subdomain.localhost`** (مثل `ahmed.localhost:3000`): يُستخرج الـ subdomain من الاسم تلقائياً دون هيدر إضافي.
- **`localhost` أو `127.0.0.1` فقط:** استخدم الهيدر **`X-Tenant-Subdomain`** (مثلاً `default` أو `ahmed`)، أو أرسل **`subdomain`** في جسم **`POST /api/login`** عندما يكون الـ tenant المستنتج `default`.
- **بروكسي Next.js → API على منفذ آخر:** إذا وصل الـ API بـ `Host` داخلي مثل `localhost:8000`، مرّر **`X-Forwarded-Host`** الأصلي (مثل `ahmed.localhost:3000`) حتى يُحلّ نفس الـ tenant؛ الـ middleware يقرأ `X-Forwarded-Host` أولاً عند وجوده.

---

## 5) Middleware: تحديد الـ Tenant

الملف: `src/middleware/tenantContext.ts`

- يُركَّب على **`/api`** في `src/app.ts` **قبل** الراوتر الرئيسي.
- يقرأ اسم المضيف كما يراه العميل (`X-Forwarded-Host` ثم `Host`)، ويستنتج الـ subdomain إن وُجد `TENANT_ROOT_DOMAIN`.
- يحجز أسماء فرعية شائعة (`www`, `api`, `app`, `admin`, …) لتعيينها إلى الـ tenant **`default`**.
- يحمّل الصف من `tenants` ويرفض الطلب إن لم يوجد السجل أو كان `is_active = false`.
- يضع النتيجة في **`req.tenant`** (مُعرَّف في `src/types.d.ts`).

**Middleware إضافي:** `requireDefaultTenantMiddleware()` — يُستخدم لمسارات **سوبر أدمن** بحيث تُنفَّذ فقط عندما يكون الـ tenant الحالي هو **`default`** (إدارة مركزية من النطاق الافتراضي).

---

## 6) المصادقة وتوكن JWT

- **`generateToken`** (`src/utils.ts`): يضيف **`tid`** في الـ payload عندما يكون `user.tenant_id` معروفاً.
- **`src/middleware/authentication.ts`:** بعد التحقق من المستخدم، يُتحقق من تطابق **`tid` في التوكن** مع **`req.tenant`**، وتطابق **`user.tenant_id`** مع **`req.tenant.id`** (مع استثناءات للتوكنات القديمة بدون `tid` على الـ tenant الافتراضي فقط).

---

## 7) تعديلات على مسارات محددة (نطاق المستخدمين)

تم تقييد أو إدراج **`tenant_id`** حيث يلزم، منها:

| الملف / المسار | التغيير |
|----------------|---------|
| `src/controllers/auth.ts` | تسجيل الدخول، نسيت كلمة المرور، `register-admin` — مرتبط بـ `req.tenant`. |
| `src/controllers/user.ts` | تسجيل الطالب — فحص الهاتف وإدراج المستخدم ضمن نفس الـ tenant. |
| `src/controllers/teacher.ts` | إنشاء مدرس — فحص البريد وإدراج ضمن نفس الـ tenant. |
| `src/services/employees.ts` + `src/controllers/employees.ts` | إنشاء موظف مع `tenant_id`. |
| `src/controllers/tasks.ts` | مسار إنشاء موظف — نفس الفكرة. |
| `src/services/studyGroups.ts` + `src/controllers/studyGroups.ts` | إنشاء/بحث طالب بالهاتف ضمن نفس الـ tenant عند إضافة طالب لمجموعة. |
| `src/db/migrate.ts` | إنشاء أول superuser مرتبط بـ tenant **`default`** إن وُجدت إعدادات `FIRST_SUPERUSER`. |

> ما زالت هناك مسارات أخرى في الخدمات (مثل `centerGroups`, `groupExams`) قد تعتمد على **`DEFAULT`** لـ `tenant_id` حتى تُحدَّث لاحقاً لتمرير tenant ص显ي.

---

## 8) واجهات API جديدة

| المسار | الوصف |
|--------|--------|
| **`GET /api/tenants/public/:subdomain`** | قراءة عامة: بيانات الـ tenant + **`teacher`** (ملف المدرّس العام من `users` إن وُجد مالك) + `tenant_settings.data` + `tenant_landing_pages.page` (بدون مصادقة) — مناسب للّاندينج في الواجهة أو Next.js. |
| **`GET /api/super/tenants`** | قائمة tenants (أدمن + يجب أن يكون الطلب على tenant **`default`**). |
| **`POST /api/super/tenants`** | إنشاء tenant جديد مع إعدادات ولاندينج واختيارياً **`owner`** (مدرّس). |
| **`PATCH /api/super/tenants/:id`** | تحديث بيانات / SEO / `landing` / `settings`. |

الراوترات مُسجَّلة في `src/routes.ts`؛ الـ Super يمر عبر `src/controllers/tenantsSuper.ts` والخدمات في `src/services/tenants.ts`.

---

## 9) ما لم يُنفَّذ بعد (للمراحل القادمة)

- إضافة **`tenant_id`** إلى جداول المحتوى والأعمال (`courses`, `lessons`, `enrollments`, `payments`, …) مع سياسة موحّدة للاستعلام.
- **Next.js:** middleware للـ subdomain، صفحات auth/dashboard، وـ SEO ديناميكي لكل tenant.
- **Rate limiting** و**caching** لكل tenant (مثلاً Redis).
- مراجعة **Socket.IO** في `src/index.ts` لربط الجلسات بالـ tenant إن لزم.

---

## 10) ملخص سريع للمطور

1. شغّل الـ migrations كالمعتاد (`npm run migrate` أو عند تشغيل السيرفر حسب إعدادكم).
2. في الإنتاج عرّف **`TENANT_ROOT_DOMAIN`** ليطابق النطاق الذي يستضيف الـ subdomains.
3. للاختبار المحلي على API واحد: **`X-Tenant-Subdomain: default`** أو اسم tenant آخر بعد إنشائه.
4. سوبر الأدمن لإدارة الـ tenants: من سياق يُحل إلى **`default`** + توكن **admin**.

---

*آخر تحديث للمستند يتوافق مع مرحلة التأسيس Multi-Tenant على الـ API كما في المستودع.*
