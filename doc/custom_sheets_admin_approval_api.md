# Custom Sheets Admin Approval APIs

توثيق تفصيلي لمسارات الأدمن الخاصة بمراجعة واعتماد/رفض طلبات الموظفين على الشيتات.

## Base URL

`http://localhost:8000/api/custom-sheets`

## Authentication & Authorization

- جميع المسارات هنا تحتاج JWT:
  - `Authorization: Bearer <token>`
- هذه المسارات **للأدمن فقط**:
  - `authMiddleware(['admin'])`

---

## مقدمة سريعة

عند محاولة الموظف تنفيذ أي عملية من العمليات التالية:

- تعديل شيت
- حذف شيت
- تعديل صف داخل شيت
- حذف صف داخل شيت

لا يتم التنفيذ مباشرة، بل يتم إنشاء **طلب مراجعة** في جدول:

- `custom_sheet_change_requests`

ثم يقوم الأدمن بالمراجعة عبر المسارات التالية.

---

## 1) عرض طلبات المراجعة

### Endpoint

- **GET** `/requests/all`

### Query Parameters

| الاسم | النوع | مطلوب | القيم |
|------|------|--------|-------|
| `status` | string | لا | `pending` / `approved` / `rejected` / `all` |

> الافتراضي: `pending`

### أمثلة

- عرض الطلبات المعلقة فقط:
  - `GET /api/custom-sheets/requests/all`
- عرض كل الطلبات:
  - `GET /api/custom-sheets/requests/all?status=all`
- عرض الطلبات المرفوضة:
  - `GET /api/custom-sheets/requests/all?status=rejected`

### Success Response

`200 OK`

```json
{
  "success": true,
  "data": [
    {
      "id": "9c3384d0-3ea2-4a25-a655-13f2f65853a8",
      "sheet_id": "cde15d8a-70f8-4f8d-af95-4e4f24885613",
      "row_id": "20f8b173-c2ee-4f05-a972-2f8dc6ce8f69",
      "action": "update_row",
      "payload": {
        "data": {
          "student_name": "Ahmed Ali",
          "phone": "01012345678"
        }
      },
      "status": "pending",
      "requested_by": 379,
      "requested_by_name": "موظف النظام",
      "reviewed_by": null,
      "admin_note": null,
      "reviewed_at": null,
      "created_at": "2026-03-31T12:10:00.000Z",
      "updated_at": "2026-03-31T12:10:00.000Z"
    }
  ]
}
```

### Error Responses

- `401` Unauthorized (token missing/invalid)
- `403` Forbidden (ليس أدمن)
- `500` خطأ داخلي

---

## 2) اعتماد طلب وتنفيذه

### Endpoint

- **PATCH** `/requests/:requestId/approve`

### Path Params

| الاسم | النوع | الوصف |
|------|------|-------|
| `requestId` | UUID | معرف طلب المراجعة |

### Body (اختياري)

```json
{
  "admin_note": "تمت المراجعة والتنفيذ"
}
```

### ماذا يحدث عند الاعتماد؟

داخل Transaction واحدة:

1. قفل صف الطلب (`FOR UPDATE`)
2. التحقق أن الطلب موجود وحالته `pending`
3. تنفيذ العملية الفعلية حسب `action`:
   - `update_sheet`: تحديث اسم/حقول الشيت
   - `delete_sheet`: حذف الشيت
   - `update_row`: تحديث صف البيانات
   - `delete_row`: حذف الصف
4. تحديث الطلب إلى:
   - `status = approved`
   - `reviewed_by = admin user id`
   - `reviewed_at = now`
   - حفظ `admin_note` (إن وُجد)

### Success Response

`200 OK`

```json
{
  "success": true,
  "message": "تمت الموافقة وتنفيذ الطلب بنجاح",
  "data": {
    "request": {
      "id": "9c3384d0-3ea2-4a25-a655-13f2f65853a8",
      "status": "approved",
      "reviewed_by": 1,
      "admin_note": "تمت المراجعة والتنفيذ",
      "reviewed_at": "2026-03-31T12:20:00.000Z"
    },
    "applied": {
      "id": "20f8b173-c2ee-4f05-a972-2f8dc6ce8f69"
    }
  }
}
```

### Error Responses

- `404`:
  - الطلب غير موجود
  - أو العنصر الهدف (الشيت/الصف) غير موجود أثناء التنفيذ
- `400`:
  - الطلب ليس `pending` (تمت مراجعته مسبقًا)
- `401` / `403`
- `500` خطأ داخلي

---

## 3) رفض طلب

### Endpoint

- **PATCH** `/requests/:requestId/reject`

### Path Params

| الاسم | النوع | الوصف |
|------|------|-------|
| `requestId` | UUID | معرف طلب المراجعة |

### Body (اختياري)

```json
{
  "admin_note": "مرفوض: البيانات غير صحيحة"
}
```

### ماذا يحدث عند الرفض؟

- لا يتم تنفيذ أي تعديل على الشيت/الصف
- يتم تحديث الطلب فقط إلى:
  - `status = rejected`
  - `reviewed_by = admin user id`
  - `reviewed_at = now`
  - حفظ `admin_note` (إن وُجد)

### Success Response

`200 OK`

```json
{
  "success": true,
  "message": "تم رفض الطلب",
  "data": {
    "id": "9c3384d0-3ea2-4a25-a655-13f2f65853a8",
    "status": "rejected",
    "reviewed_by": 1,
    "admin_note": "مرفوض: البيانات غير صحيحة",
    "reviewed_at": "2026-03-31T12:22:00.000Z"
  }
}
```

### Error Responses

- `404`:
  - الطلب غير موجود
  - أو ليس في حالة `pending`
- `401` / `403`
- `500` خطأ داخلي

---

## Action Values Reference

| action | الوصف |
|--------|-------|
| `update_sheet` | تعديل بيانات الشيت |
| `delete_sheet` | حذف الشيت |
| `update_row` | تعديل صف داخل شيت |
| `delete_row` | حذف صف داخل شيت |

---

## Notes for Frontend / Mobile

- عند قيام الموظف بعملية تعديل/حذف سيحصل غالبًا على `202` مع بيانات الطلب بدل تنفيذ مباشر.
- اعرض حالة الطلب للموظف من خلال شاشة خاصة أو عبر polling على endpoint مخصص إن أضفتموه لاحقًا.
- للأدمن:
  1. اجلب `pending` requests.
  2. اعرض `action` + `payload` + اسم مقدم الطلب.
  3. نفّذ approve/reject مع `admin_note` اختياري.

