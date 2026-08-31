# Teacher Trash API — المحذوفات واستعادتها

API موحّد للمدرس لعرض كل ما حذفه واستعادته.

> **ملاحظة:** العناصر التي تستخدم `deleted_at` (سنتر، ملفات، PDF) تظهر **تلقائياً** حتى لو حُذفت قبل إنشاء هذا الـ API.  
> الكورسات/المحاضرات المحذوفة **نهائياً** تُسجَّل من الآن فصاعداً؛ القديم منها يظهر في سجل النشاط فقط إن وُجد.

---

## Migration

```bash
npm run migrate up
```

الملف: `migrations/1778700000000_teacher_trash_system.sql`

---

## المصادقة

`Authorization: Bearer <token>` — أدوار: `teacher`, `admin`

للأدمن: `?teacher_id=` أو `teacher_id` في body لتحديد المدرس.

---

## GET `/api/teacher/trash`

قائمة المحذوفات.

| Query | الوصف |
|-------|--------|
| `type` | فلتر حسب النوع (انظر الجدول أدناه) |
| `search` | بحث في العنوان |
| `page` | افتراضي `1` |
| `limit` | افتراضي `30`، أقصى `100` |
| `include_activity_log` | `false` لإخفاء حذوفات سجل النشاط القديمة |

### أنواع العناصر (`type`)

| type | الوصف | قابل للاستعادة؟ |
|------|--------|-----------------|
| `center_group` | مجموعة سنتر | ✅ |
| `center_student` | طالب سنتر | ✅ (+ اشتراكاته في مجموعات نشطة) |
| `center_enrollment` | طالب في مجموعة | ✅ إذا المجموعة موجودة |
| `center_exam` | امتحان مجموعة | ✅ |
| `center_payment` | دفعة | ✅ |
| `center_subscription` | اشتراك شهري | ✅ |
| `teacher_file` | ملف (ملفاتي) | ✅ روابط Drive فقط |
| `course_file` | PDF كورس | ✅ إذا لم يُمسح من التخزين |
| `course` | كورس (snapshot) | ⚠️ استعادة جزئية للسجل |
| `lecture` | محاضرة (snapshot) | ⚠️ استعادة جزئية |
| `platform_student` | طالب منصة | ❌ للعرض فقط |

### Response

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "type": "center_group",
        "typeLabel": "مجموعة سنتر",
        "id": 12,
        "title": "مجموعة السبت",
        "subtitle": "الصف الثالث",
        "deletedAt": "2026-08-20T10:00:00.000Z",
        "canRestore": true,
        "restoreBlockers": [],
        "source": "live",
        "metadata": { "grade_id": 3, "status": "paused" }
      }
    ],
    "total": 1,
    "page": 1,
    "limit": 30
  },
  "supportedTypes": ["center_group", "..."]
}
```

`source`:
- `live` — صف ما زال في قاعدة البيانات مع `deleted_at`
- `snapshot` — نسخة قبل حذف نهائي (كورس/محاضرة)
- `activity_log` — سجل نشاط قديم (غير قابل للاستعادة)

---

## GET `/api/teacher/trash/summary`

عدد المحذوفات لكل نوع.

```json
{
  "success": true,
  "data": [
    { "type": "center_student", "count": 5, "label": "طالب سنتر" }
  ]
}
```

---

## POST `/api/teacher/trash/:type/:id/restore`

استعادة عنصر.

- `:type` — نوع العنصر (مثل `center_group`, `course_file`, `course`)
- `:id` — معرف العنصر (أو `snapshot_id` للكورسات/المحاضرات من `source: snapshot`)

Query/body اختياري: `source=snapshot` عند استعادة من جدول snapshots.

### Response

```json
{
  "success": true,
  "message": "تمت استعادة العنصر بنجاح",
  "data": {
    "restored": true,
    "type": "center_group",
    "id": 12
  }
}
```

### أخطاء شائعة

| Status | السبب |
|--------|--------|
| 404 | العنصر غير موجود في المحذوفات |
| 409 | `STORAGE_PURGED` — ملف PDF/رفع محذوف من Cloudinary |
| 409 | `GROUP_DELETED` — استعد المجموعة أولاً |
| 409 | `NO_SNAPSHOT` — حذف قديم بدون نسخة احتياطية |

---

## أمثلة cURL

```bash
# قائمة المحذوفات
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:8000/api/teacher/trash?page=1&limit=20"

# استعادة مجموعة سنتر
curl -X POST -H "Authorization: Bearer $TOKEN" \
  "http://localhost:8000/api/teacher/trash/center_group/12/restore"

# استعادة ملف PDF
curl -X POST -H "Authorization: Bearer $TOKEN" \
  "http://localhost:8000/api/teacher/trash/course_file/7/restore"
```

---

## ملاحظات للفرونت

1. اعرض `canRestore === false` مع `restoreBlockers` كسبب.
2. للعناصر `source: snapshot` استخدم `id` من القائمة مباشرة مع `type=course` أو `lecture`.
3. بعد الاستعادة حدّث القائمة — العنصر يختفي من المحذوفات.
