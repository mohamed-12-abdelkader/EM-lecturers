# Admin APIs: Grades + Create Teacher

هذا المستند يشرح نقطتين أساسيتين بعد التعديلات الأخيرة:

1. API جلب الصفوف الدراسية لاستخدامها في شاشة إضافة المدرس.
2. API إضافة مدرس مع تحديد الصفوف الدراسية الخاصة به (`grade_ids`).

> Base URL (local): `http://localhost:8000/api`

---

## 1) جلب الصفوف الدراسية (للوحة الأدمن)

**Endpoint:** `GET /api/teacher/available-grades`

### الاستخدام
- يتم استدعاؤه قبل فتح/تحميل فورم إضافة المدرس.
- يرجع الصفوف النشطة فقط مع بيانات:
  - `id`
  - `name`
  - `slug`
  - `stage`
  - `status`

### مثال Request

```bash
curl -X GET "http://localhost:8000/api/teacher/available-grades"
```

### مثال Response

```json
{
  "grades": [
    {
      "id": 1,
      "name": "الصف الأول الإعدادي",
      "slug": "prep-1",
      "stage": "prep",
      "status": "active"
    },
    {
      "id": 11,
      "name": "كورسات عامة",
      "slug": "general-courses",
      "stage": "general",
      "status": "active"
    }
  ]
}
```

> ملاحظة: المسار الحالي لا يفرض `authMiddleware` داخل الكود الآن، لكنه مخصص عملياً للاستخدام من لوحة الإدارة.

---

## 2) إضافة مدرس مع تحديد الصفوف الدراسية

**Endpoint:** `POST /api/teacher`  
**Auth:** `Bearer <admin_token>` (Admin فقط)

### الحقول المطلوبة

| الحقل | النوع | مطلوب | ملاحظات |
|------|------|------|---------|
| `name` | string | نعم | اسم المدرس |
| `email` | string | نعم | فريد داخل نفس tenant |
| `password` | string | نعم | 6 أحرف على الأقل |
| `description` | string | نعم | نبذة المدرس |
| `subject` | string | نعم | المادة |

### الحقول الاختيارية

| الحقل | النوع | مطلوب | ملاحظات |
|------|------|------|---------|
| `avatar` | file | لا | صورة المدرس (multipart) |
| `grade_ids` | string/array | لا | ربط المدرس بصف دراسي واحد أو أكثر |

### شكل `grade_ids` المقبول

داخل `POST /api/teacher`:
- إذا أرسلتها نصاً: `1,2,4`
- إذا أرسلتها كمصفوفة: `[1,2,4]`

السيرفر سيحفظ العلاقات في جدول `teacher_grades`.

---

## 3) مثال Body (JSON)

> مفيد عند عدم إرسال صورة.

```json
{
  "name": "محمد عبدالقادر",
  "email": "teacher@example.com",
  "password": "secret123",
  "description": "مدرس رياضيات للمرحلتين الإعدادية والثانوية",
  "subject": "رياضيات",
  "grade_ids": [1, 2, 4]
}
```

### مثال curl (JSON)

```bash
curl -X POST "http://localhost:8000/api/teacher" ^
  -H "Content-Type: application/json" ^
  -H "Authorization: Bearer YOUR_ADMIN_JWT" ^
  -H "X-Tenant-Subdomain: mohamed-abdelkader" ^
  -d "{\"name\":\"محمد عبدالقادر\",\"email\":\"teacher@example.com\",\"password\":\"secret123\",\"description\":\"مدرس رياضيات\",\"subject\":\"رياضيات\",\"grade_ids\":[1,2,4]}"
```

---

## 4) مثال Body (multipart/form-data)

> مفيد عند إرسال صورة المدرس.

```bash
curl -X POST "http://localhost:8000/api/teacher" ^
  -H "Authorization: Bearer YOUR_ADMIN_JWT" ^
  -H "X-Tenant-Subdomain: mohamed-abdelkader" ^
  -F "name=محمد عبدالقادر" ^
  -F "email=teacher@example.com" ^
  -F "password=secret123" ^
  -F "description=مدرس رياضيات" ^
  -F "subject=رياضيات" ^
  -F "grade_ids=1,2,4" ^
  -F "avatar=@C:\path\to\avatar.jpg"
```

---

## 5) مثال Response بعد إنشاء المدرس

```json
{
  "teacher": {
    "id": 25,
    "email": "teacher@example.com",
    "name": "محمد عبدالقادر",
    "avatar": "https://res.cloudinary.com/.../avatar.jpg",
    "role": "teacher",
    "description": "مدرس رياضيات",
    "subject": "رياضيات"
  }
}
```

> للحصول على الصفوف المرتبطة بعد الإنشاء، استخدم:
> - `GET /api/admin/teachers/:id` (من مسارات الإدارة الجديدة)
> - أو `GET /api/teacher/teachers` (قائمة المدرسين للأدمن وتحتوي `grades`)

---

## 6) أين أضيف الخدمات/الآراء/الإحصائيات/عن المدرس؟

سؤالك مهم: الحقول التالية **ليست** ضمن `POST /api/teacher` حالياً:
- الخدمات (`services`)
- آراء الطلاب (`testimonials`)
- FAQ
- إحصائيات (`statistics`)
- قسم About موسّع
- صور اللاندينج مثل `hero_image`, `og_image`, `favicon`

هذه الحقول مكانها الصحيح هو **محتوى اللاندينج** داخل:
- `POST /api/super/tenants` (عند الإنشاء)
- `PATCH /api/super/tenants/:id` (للتعديل لاحقاً)

وبعد التعديل الأخير: نفس `POST /api/super/tenants` يدعم أيضًا تحديد صفوف المدرس (owner) وقت إنشاء المنصة.

### تحديد صفوف المدرس داخل `POST /api/super/tenants`

يمكنك إرسال `grade_ids` بطريقتين:

1. داخل كائن `owner` (JSON):

```json
{
  "subdomain": "mohamed-abdelkader",
  "display_name": "محمد عبدالقادر",
  "owner": {
    "name": "محمد عبدالقادر",
    "email": "teacher@example.com",
    "password": "secret123",
    "description": "مدرس رياضيات",
    "subject": "رياضيات",
    "grade_ids": [1, 2, 4]
  }
}
```

2. في `multipart/form-data`:
- إذا أرسلت `owner` كـ JSON string يمكن تضمين `grade_ids` داخله.
- أو باستخدام حقل منفصل: `owner_grade_ids` بصيغة `1,2,4` أو JSON string مثل `[1,2,4]`.

> السيرفر يتحقق من وجود الصفوف فعليًا، ثم يحفظ الربط في `teacher_grades` عند إنشاء owner teacher.
> إذا كان أي `grade_id` غير صحيح يرجع خطأ 400.

### مثال body لمحتوى اللاندينج (JSON)

```json
{
  "landing": {
    "hero": {
      "title": "ابدأ رحلتك في الرياضيات",
      "subtitle": "مع الأستاذ محمد عبدالقادر",
      "description": "حصص مباشرة + تسجيلات + متابعة",
      "image_url": "https://example.com/hero.jpg"
    },
    "services": [
      { "title": "شرح مباشر", "description": "حصص تفاعلية أسبوعية" },
      { "title": "واجبات واختبارات", "description": "متابعة مستمرة" }
    ],
    "about": {
      "bio": "خبرة أكثر من 10 سنوات",
      "qualifications": "بكالوريوس علوم",
      "achievements": "تدريس أكثر من 5000 طالب"
    },
    "statistics": {
      "students_count": 5000,
      "courses_count": 42,
      "years_experience": 10
    },
    "testimonials": [
      { "name": "طالب", "text": "شرح ممتاز", "rating": 5 }
    ],
    "contact": {
      "whatsapp": "https://wa.me/201000000000",
      "facebook": "https://facebook.com/teacher"
    }
  }
}
```

### صور اللاندينج من الجهاز

عند استخدام `multipart/form-data` في `POST /api/super/tenants` يمكنك رفع:
- `avatar`
- `favicon`
- `og_image`
- `hero_image`

ثم تُحفظ تلقائياً في روابط اللاندينج/المنصة.

---

## 7) ملاحظات تصميم مهمة

- `POST /api/teacher` = إنشاء حساب مستخدم مدرس + ربطه بالصفوف (`teacher_grades`).
- `POST /api/super/tenants` = إنشاء منصة + owner teacher، والآن يمكن أيضًا ربط `owner` بالصفوف عبر `owner.grade_ids` أو `owner_grade_ids`.
- `PATCH /api/super/tenants/:id` = تعديل نفس الجسم تقريبًا (بيانات المنصة + `owner`) بشكل جزئي أو كامل، بما في ذلك `owner.grade_ids` لتحديث صفوف المدرس.
- `landing` = محتوى صفحة التسويق/الواجهة العامة للمدرس (خدمات، آراء، صور، إحصائيات...).
- الفصل بينهما مقصود للحفاظ على تنظيم البيانات وسهولة الإدارة.

---

## 8) شكل Body لتعديل المنصة والمدرس بالكامل

**Endpoint:** `PATCH /api/super/tenants/:id`

يمكنك إرسال نفس الشكل التالي لتعديل بيانات المنصة + المدرس + الصفوف:

```json
{
  "subdomain": "mohamed-abdelkader",
  "display_name": "محمد عبدالقادر",
  "specialty": "رياضيات",
  "bio": "منصة تعليمية للمرحلتين الإعدادية والثانوية",
  "avatar_url": "https://example.com/avatar.jpg",
  "seo_title": "محمد عبدالقادر | منصة تعليمية",
  "seo_meta_description": "تعلم الرياضيات مع الأستاذ محمد",
  "favicon_url": "https://example.com/favicon.png",
  "og_image_url": "https://example.com/og.jpg",
  "is_active": true,
  "settings": {
    "theme": "light",
    "features": {
      "chat_enabled": true
    }
  },
  "landing": {
    "hero": {
      "title": "ابدأ التعلم الآن",
      "subtitle": "شرح مبسط + متابعة مستمرة",
      "image_url": "https://example.com/hero.jpg"
    },
    "services": [
      { "title": "حصص مباشرة", "description": "حصص تفاعلية أسبوعية" }
    ],
    "statistics": {
      "students_count": 5000,
      "courses_count": 42
    }
  },
  "owner": {
    "name": "محمد عبدالقادر",
    "email": "teacher@example.com",
    "password": "secret123",
    "description": "مدرس رياضيات",
    "subject": "رياضيات",
    "grade_ids": [1, 2, 4]
  }
}
```

ملاحظات:
- كل الحقول في `PATCH` اختيارية (Partial update).
- عند إرسال `owner.grade_ids` يتم عمل **sync** للصفوف في `teacher_grades`.
- إذا لم يكن للـ tenant مالك سابقًا، وتم إرسال `owner` مع `name + email + password` سيتم إنشاء owner teacher وربطه تلقائيًا.

---

## 9) أخطاء شائعة

- `400` — `name, email, password, description, subject are required`  
  عندما ينقص أي حقل إلزامي.

- `400` — `Email already registered`  
  عند وجود نفس البريد داخل نفس tenant.

- `400` — `الصفوف الدراسية التالية غير موجودة: ...`  
  إذا أرسل الأدمن `grade_ids` غير موجودة في جدول `grades`.

---

## 10) تحديد باقة المدرس (Admin)

**Endpoint:** `PATCH /api/admin/teachers/:id/package`  
**Auth:** `Bearer <admin_token>` (Admin فقط)

### الباقات المتاحة

- `bronze`
- `silver`
- `gold`
- `diamond`

### مثال Request

```bash
curl -X PATCH "http://localhost:8000/api/admin/teachers/25/package" ^
  -H "Content-Type: application/json" ^
  -H "Authorization: Bearer YOUR_ADMIN_JWT" ^
  -H "X-Tenant-Subdomain: mohamed-abdelkader" ^
  -d "{\"subscription_package\":\"gold\"}"
```

### مثال Response

```json
{
  "success": true,
  "message": "Teacher package updated"
}
```

> ملاحظة: الباقة يتم حفظها في العمود `users.subscription_package` لاستخدامها مستقبلاً.
