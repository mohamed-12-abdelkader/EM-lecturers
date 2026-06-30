# Question Bank Admin Change Requests API

هذا الملف يشرح تعامل الأدمن مع **طلبات التعديل والحذف** المرسلة من الموظفين داخل نظام بنك الأسئلة.

> الموظف صاحب صلاحية `question_bank_management` عند تنفيذ **update/delete** لا يتم التنفيذ مباشرة، بل يُنشأ طلب موافقة.  
> الأدمن يراجع الطلب ثم يوافق أو يرفض.

---

## Base URL

`http://localhost:8000/api/question-banks`

## Authentication

- كل المسارات هنا تتطلب JWT:
  - `Authorization: Bearer <token>`
- الصلاحية: **admin فقط**

---

## حالة الطلب (status)

| القيمة | المعنى |
|-------|--------|
| `pending` | بانتظار مراجعة الأدمن |
| `approved` | تمت الموافقة وتم تنفيذ التعديل/الحذف |
| `rejected` | تم رفض الطلب ولم يتم التنفيذ |

---

## نوع الكيان (entity_type)

| القيمة | الوصف |
|-------|-------|
| `question_bank` | بنك الأسئلة |
| `subject` | مادة |
| `book` | كتاب داخل المادة |
| `chapter` | فصل |
| `lesson` | درس |

---

## نوع العملية (action)

| القيمة | الوصف |
|-------|-------|
| `update` | تعديل |
| `delete` | حذف |

---

## 1) جلب طلبات المراجعة

### Endpoint

- **GET** `/change-requests/all`

### Query Parameters

| الاسم | النوع | مطلوب | القيم |
|------|------|--------|-------|
| `status` | string | لا | `pending` / `approved` / `rejected` / `all` |

> القيمة الافتراضية: `pending`

### أمثلة

- `GET /api/question-banks/change-requests/all`
- `GET /api/question-banks/change-requests/all?status=all`
- `GET /api/question-banks/change-requests/all?status=rejected`

### Success Response (200)

```json
{
  "success": true,
  "data": [
    {
      "id": "f9baf1d2-4f45-4b7f-9e6c-2e5d8b5d8dd3",
      "entity_type": "subject",
      "entity_id": 13,
      "action": "update",
      "payload": {
        "name": "Algebra",
        "description": "Updated subject description"
      },
      "status": "pending",
      "requested_by": 379,
      "requested_by_name": "موظف النظام",
      "reviewed_by": null,
      "reviewed_by_name": null,
      "admin_note": null,
      "reviewed_at": null,
      "created_at": "2026-03-31T15:10:00.000Z",
      "updated_at": "2026-03-31T15:10:00.000Z"
    }
  ]
}
```

### Errors

- `401`: Unauthorized
- `403`: Forbidden (المستخدم ليس أدمن)
- `500`: خطأ داخلي

---

## 2) اعتماد طلب وتنفيذه

### Endpoint

- **PATCH** `/change-requests/:id/approve`

### Path Params

| الاسم | النوع | الوصف |
|------|------|-------|
| `id` | UUID | معرف طلب المراجعة |

### Body (اختياري)

```json
{
  "admin_note": "تمت المراجعة والموافقة"
}
```

### ماذا يحدث عند الموافقة؟

داخل Transaction:

1. التحقق من وجود الطلب وأن حالته `pending`.
2. تنفيذ العملية الفعلية حسب:
   - `entity_type`
   - `action`
   - `payload`
3. تحديث الطلب إلى:
   - `status = approved`
   - `reviewed_by = admin user id`
   - `reviewed_at = now`
   - `admin_note` (اختياري)

### Success Response (200)

```json
{
  "success": true,
  "message": "تمت الموافقة على الطلب وتنفيذه",
  "data": {
    "request": {
      "id": "f9baf1d2-4f45-4b7f-9e6c-2e5d8b5d8dd3",
      "status": "approved",
      "reviewed_by": 1,
      "admin_note": "تمت المراجعة والموافقة",
      "reviewed_at": "2026-03-31T15:20:00.000Z"
    },
    "applied": {
      "id": 13,
      "name": "Algebra",
      "description": "Updated subject description"
    }
  }
}
```

### Errors

- `404`: الطلب غير موجود
- `400`: الطلب تم مراجعته مسبقًا / أو خطأ في بيانات التنفيذ
- `401` / `403`

---

## 3) رفض طلب

### Endpoint

- **PATCH** `/change-requests/:id/reject`

### Path Params

| الاسم | النوع | الوصف |
|------|------|-------|
| `id` | UUID | معرف طلب المراجعة |

### Body (اختياري)

```json
{
  "admin_note": "مرفوض: التعديل غير مطابق للسياسة"
}
```

### ماذا يحدث عند الرفض؟

- لا يتم تنفيذ أي تغيير على بنك الأسئلة.
- يتم فقط تحديث حالة الطلب إلى `rejected` مع بيانات المراجعة.

### Success Response (200)

```json
{
  "success": true,
  "message": "تم رفض الطلب",
  "data": {
    "id": "f9baf1d2-4f45-4b7f-9e6c-2e5d8b5d8dd3",
    "status": "rejected",
    "reviewed_by": 1,
    "admin_note": "مرفوض: التعديل غير مطابق للسياسة",
    "reviewed_at": "2026-03-31T15:25:00.000Z"
  }
}
```

### Errors

- `404`: الطلب غير موجود أو ليس `pending`
- `401` / `403`
- `500`

---

## سيناريو عمل مقترح للأدمن

1. استدعاء:
   - `GET /change-requests/all?status=pending`
2. عرض الطلبات في لوحة الإدارة (نوع الكيان + العملية + payload).
3. اتخاذ قرار:
   - موافقة: `PATCH /change-requests/:id/approve`
   - رفض: `PATCH /change-requests/:id/reject`
4. (اختياري) حفظ سبب القرار في `admin_note`.

---

## ملاحظات مهمة

- `payload` يحتوي البيانات الجديدة المطلوبة في حالة `update`.
- في حالة `delete` قد يكون `payload` فارغًا، والاعتماد يعتمد على (`entity_type`, `entity_id`).
- لا يمكن اعتماد/رفض طلب غير `pending`.

