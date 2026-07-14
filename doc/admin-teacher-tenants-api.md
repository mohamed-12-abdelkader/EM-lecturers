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
