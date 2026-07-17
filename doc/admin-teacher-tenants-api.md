# Admin — قائمة منصات المدرسين (Tenants)

> **Base URL:** `/api`  
> **الجمهور:** `admin` فقط  
> **السياق:** يجب أن يكون الطلب على tenant **`default`** (لوحة الإدارة المركزية)

---

## المصادقة

```http
Authorization: Bearer <JWT>
X-Tenant-Subdomain: default
```

على `localhost` أرسل الهيدر `X-Tenant-Subdomain: default` مع توكن الأدمن.

---

## عرض كل منصات المدرسين

```http
GET /api/admin/tenants
```

يعرض كل **tenant** خاص بمدرس (منصة فرعية)، مع بيانات المالك (`owner`) وإحصائيات مختصرة.

**لا يُضمَّن** tenant `default` إلا إذا طلبت ذلك صراحة.

### Query Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | number | `50` | عدد النتائج (1–200) |
| `offset` | number | `0` | للتصفح |
| `search` | string | — | بحث في `subdomain`، `display_name`، اسم/بريد المالك |
| `is_active` | boolean | — | `true` أو `false` لتصفية المنصات النشطة/المعطّلة |
| `include_default` | boolean | `false` | إن `true` يُضمَّن tenant المنصة الرئيسية `default` |

### مثال

```bash
curl "http://localhost:8000/api/admin/tenants?limit=20&search=ahmed" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "X-Tenant-Subdomain: default"
```

### Response

```json
{
  "success": true,
  "data": {
    "tenants": [
      {
        "id": 5,
        "subdomain": "ahmed-physics",
        "display_name": "أحمد — فيزياء",
        "specialty": "فيزياء",
        "bio": "مدرس فيزياء ثانوي",
        "avatar_url": "https://res.cloudinary.com/.../avatar.jpg",
        "is_active": true,
        "seo_title": "أحمد فيزياء",
        "seo_meta_description": null,
        "favicon_url": null,
        "og_image_url": null,
        "owner_user_id": 42,
        "created_at": "2026-01-10T12:00:00.000Z",
        "updated_at": "2026-01-10T12:00:00.000Z",
        "owner": {
          "id": 42,
          "name": "أحمد محمد",
          "email": "ahmed@example.com",
          "phone": "+201234567890",
          "subject": "فيزياء",
          "avatar": "https://...",
          "account_status": "active",
          "subscription_package": "gold",
          "subscription_package_assigned_at": "2026-01-10T12:00:00.000Z",
          "created_at": "2026-01-10T12:00:00.000Z"
        },
        "stats": {
          "teachers_count": 1,
          "courses_count": 8,
          "students_count": 240
        }
      }
    ],
    "total": 1,
    "limit": 20,
    "offset": 0
  }
}
```

### الحقول المهمة

| الحقل | الوصف |
|-------|--------|
| `subdomain` | اسم المنصة الفرعية (مثال: `ahmed-physics` → `ahmed-physics.yourdomain.com`) |
| `owner` | حساب المدرس المالك للمنصة — يتضمن `subscription_package` (bronze / silver / gold / diamond) |
| `stats.teachers_count` | عدد المستخدمين بدور `teacher` داخل هذا الـ tenant |
| `stats.courses_count` | عدد الكورسات لمدرسي هذا الـ tenant |
| `stats.students_count` | عدد الطلاب المسجّلين (distinct) في كورسات مدرسي الـ tenant |

---

## عرض طلاب منصة معينة

```http
GET /api/admin/tenants/:id/students
```

يعرض **كل طلاب المنصة** (مستخدمي `role=student` لنفس `tenant_id`) مع:

- البريد / الهاتف
- حالة الاشتراك: **مشترك** أو **غير مشترك**
- أكواد التفعيل اللي استخدمها الطالب على المنصة (كورس / باقة / كورس عام)

### Query Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | number | `50` | 1–200 |
| `offset` | number | `0` | للتصفح |
| `search` | string | — | بحث في الاسم / الإيميل / الهاتف / كود الطالب |
| `is_subscribed` | boolean | — | `true` = مشتركون فقط، `false` = غير مشتركين |
| `account_status` | string | — | مثلاً `active` / `inactive` / `suspended` |

### متى يُعتبر الطالب «مشترك»؟

إذا كان لديه أي من:

- تسجيل كورس نشط (`enrollments.subscription_status = active` وغير محظور)
- تفعيل باقة نشط (`package_activations.is_active = true`)
- اشتراك في كورس عام

### مثال

```bash
curl "http://localhost:8000/api/admin/tenants/5/students?limit=20&is_subscribed=true" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "X-Tenant-Subdomain: default"
```

### Response

```json
{
  "success": true,
  "data": {
    "tenant": {
      "id": 5,
      "subdomain": "ahmed-physics",
      "display_name": "أحمد — فيزياء",
      "owner_user_id": 42
    },
    "summary": {
      "total": 240,
      "subscribed": 180,
      "not_subscribed": 60
    },
    "students": [
      {
        "id": 101,
        "name": "محمد علي",
        "email": "student@example.com",
        "phone": "01000000000",
        "parent_phone": null,
        "avatar": null,
        "student_code": "ST-001",
        "account_status": "active",
        "created_at": "2026-03-01T10:00:00.000Z",
        "is_subscribed": true,
        "subscription_label": "مشترك",
        "grades": [{ "id": 3, "name": "ثالثة ثانوي", "slug": "g12" }],
        "enrollments_count": 2,
        "active_enrollments_count": 1,
        "package_activations_count": 1,
        "activation_codes": [
          {
            "type": "course_invite",
            "code": "ABC12XYZ",
            "used_at": "2026-03-02T12:00:00.000Z",
            "target_id": 15,
            "target_title": "كورس الفيزياء"
          },
          {
            "type": "package",
            "code": "PKG99AB",
            "used_at": "2026-03-05T09:00:00.000Z",
            "target_id": 3,
            "target_title": "باقة الترم الأول"
          }
        ]
      }
    ],
    "total": 180,
    "limit": 20,
    "offset": 0
  }
}
```

### أنواع أكواد التفعيل في `activation_codes[].type`

| type | المعنى |
|------|--------|
| `course_invite` | كود دعوة كورس (`teacher_invite_codes`) |
| `package` | كود تفعيل باقة |
| `general_course` | كود كورس عام |

---

## تغيير كلمة سر طالب على منصة معينة

```http
PATCH /api/admin/tenants/:id/students/:studentId/password
```

يغيّر كلمة سر طالب **مسجّل على نفس المنصة فقط** (`tenant_id` + `role=student`).

### Body

```json
{
  "new_password": "Secret12",
  "must_change_password": false
}
```

| الحقل | مطلوب | الوصف |
|--------|--------|--------|
| `new_password` | نعم | كلمة السر الجديدة (6 أحرف على الأقل). يُقبل أيضاً `password` |
| `must_change_password` | لا | إن `true` يُطلب من الطالب تغييرها عند أول دخول |

### مثال

```bash
curl -X PATCH "http://localhost:8000/api/admin/tenants/5/students/101/password" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "X-Tenant-Subdomain: default" \
  -H "Content-Type: application/json" \
  -d "{\"new_password\":\"NewPass123\"}"
```

### Response

```json
{
  "success": true,
  "message": "تم تغيير كلمة سر الطالب بنجاح",
  "data": {
    "student_id": 101,
    "name": "محمد علي",
    "email": "student@example.com",
    "phone": "01000000000",
    "tenant_id": 5,
    "must_change_password": false,
    "password_changed_at": "2026-07-16T12:30:00.000Z"
  }
}
```

### أخطاء شائعة

| HTTP | المعنى |
|------|--------|
| `400` | كلمة السر قصيرة أو معرف غير صحيح |
| `404` | المنصة غير موجودة، أو الطالب مش على هذه المنصة |

---

## عرض منصة واحدة (تفاصيل كاملة)

```http
GET /api/admin/tenants/:id
```

يعرض بيانات المنصة كاملة: `settings`، `landing`، بيانات المالك، الصفوف، الإحصائيات.

---

## تعديل بيانات منصة مدرس

```http
PATCH /api/admin/tenants/:id
```

يدعم **JSON** أو **`multipart/form-data`** (لرفع الصور من الجهاز).

### ما يمكن تعديله

| الحقل | الوصف |
|-------|--------|
| `subdomain`, `display_name`, `specialty`, `bio` | بيانات المنصة الأساسية |
| `is_active` | تفعيل / تعطيل المنصة |
| `seo_title`, `seo_meta_description` | SEO |
| `avatar_url`, `favicon_url`, `og_image_url` | روابط صور (أو رفع ملفات) |
| `settings` | JSON إعدادات (`tenant_settings`) |
| `landing` | JSON صفحة اللاندينج (`tenant_landing_pages`) |
| `owner` | بيانات المدرس المالك (اسم، بريد، كلمة مرور، صفوف، …) |

### رفع الصور (multipart)

بلا حد حجم من التطبيق افتراضياً (`TENANT_IMAGE_MAX_FILE_SIZE_MB=0`). ارفع حد الـ proxy في البروداكشن أيضاً.

| ملف | يُخزَّن في |
|-----|-----------|
| `avatar` | `avatar_url` (+ صورة المالك إن وُجد) |
| `favicon` | `favicon_url` |
| `og_image` | `og_image_url` |
| `hero_image` | `landing.hero.image_url` |

### دمج JSON جزئي

افتراضياً `landing` و`settings` يُدمجان مع القيم الحالية (تحديث جزئي).

للاستبدال الكامل:

```json
{
  "landing": { "hero": { "title": "جديد" } },
  "merge_landing": false
}
```

### مثال JSON

```bash
curl -X PATCH "http://localhost:8000/api/admin/tenants/5" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Tenant-Subdomain: default" \
  -H "Content-Type: application/json" \
  -d '{
    "display_name": "أحمد — فيزياء محدّث",
    "bio": "نبذة جديدة",
    "is_active": true,
    "landing": {
      "hero": {
        "title": "مرحباً بكم",
        "subtitle": "منصة فيزياء ثانوي"
      }
    },
    "owner": {
      "name": "أحمد محمد",
      "phone": "+201234567890",
      "subject": "فيزياء",
      "grade_ids": [1, 2]
    }
  }'
```

### مثال multipart (صور + بيانات)

```bash
curl -X PATCH "http://localhost:8000/api/admin/tenants/5" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Tenant-Subdomain: default" \
  -F "display_name=أحمد فيزياء" \
  -F "bio=نبذة محدثة" \
  -F "avatar=@./avatar.jpg" \
  -F "favicon=@./favicon.png" \
  -F "hero_image=@./hero.jpg" \
  -F 'landing={"hero":{"title":"مرحباً"}}' \
  -F 'owner={"name":"أحمد","phone":"+2012..."}'
```

### Response

```json
{
  "success": true,
  "message": "تم تحديث بيانات المنصة",
  "data": { "...": "المنصة بعد التحديث كاملة" }
}
```

---

## مسار بديل (legacy)

```http
GET /api/super/tenants
```

قائمة مختصرة (بدون owner ولا stats). للتفاصيل الكاملة استخدم `/api/admin/tenants`.

مع `?detailed=true` يُرجع نفس بيانات `/api/admin/tenants` تقريباً.

---

## أخطاء شائعة

| HTTP | السبب |
|------|--------|
| `403` | الطلب ليس على tenant `default` |
| `401` | توكن غير صالح أو ليس `admin` |

---

## توثيق مرتبط

- [`tenant-teacher-and-landing.md`](./tenant-teacher-and-landing.md) — إنشاء tenant جديد
- [`multi-tenant-saas-architecture.md`](./multi-tenant-saas-architecture.md) — بنية Multi-Tenant
