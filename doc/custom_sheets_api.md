# Custom Sheets API Documentation

هذا المستند يشرح جميع واجهات برمجة التطبيقات (APIs) الخاصة بنظام الشيتات الديناميكية (Custom Sheets). يتيح هذا النظام للإدارة إنشاء جداول مخصصة بحقول ديناميكية وتخزين البيانات بداخلها، على غرار Airtable أو Google Sheets.

## المسار الأساسي (Base URL)
`/api/custom-sheets`

---

## المصادقة والصلاحيات (Authentication & Authorization)
جميع هذه المسارات **تتطلب صلاحية أدمن (Admin)**.
يجب إرسال الـ Token الخاص بالأدمن في الهيدر `Authorization: Bearer <token>`.

---

## 1. إدارة الشيتات (Sheets Management)

### 1.1 إنشاء شيت جديد
`POST /api/custom-sheets`

يقوم بإنشاء جدول (Sheet) جديد مع تحديد الأعمدة (Fields) وأنواعها.

**طلب (Request):**
```json
{
  "name": "العملاء",
  "fields": [
    {
      "name": "الاسم",
      "type": "Text",
      "required": true
    },
    {
      "name": "رقم الهاتف",
      "type": "Phone",
      "required": true
    },
    {
      "name": "العمر",
      "type": "Number",
      "required": false
    }
  ]
}
```

**استجابة ناجحة (Response):**
```json
{
  "success": true,
  "message": "تم إنشاء الشيت بنجاح",
  "data": {
    "id": "uuid-string",
    "name": "العملاء",
    "fields": [...],
    "created_at": "2026-03-29T00:00:00.000Z",
    "updated_at": "2026-03-29T00:00:00.000Z",
    "created_by": "admin-uuid"
  }
}
```

### 1.2 جلب كل الشيتات
`GET /api/custom-sheets`

**استجابة ناجحة:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid-string",
      "name": "العملاء",
      "fields": [...],
      "created_at": "..."
    }
  ]
}
```

### 1.3 جلب شيت محدد
`GET /api/custom-sheets/:id`

**استجابة ناجحة:**
```json
{
  "success": true,
  "data": {
    "id": "uuid-string",
    "name": "العملاء",
    "fields": [...]
  }
}
```

### 1.4 التعديل على شيت (الاسم / الحقول)
`PUT /api/custom-sheets/:id`

**طلب (Request):**
(نفس هيكل إنشاء الشيت، يتم استبدال الحقول القديمة بالجديدة بالكامل).
```json
{
  "name": "بيانات العملاء المُحدثة",
  "fields": [
    {
      "name": "الاسم",
      "type": "Text",
      "required": true
    }
  ]
}
```

### 1.5 مسح شيت
`DELETE /api/custom-sheets/:id`

يحذف الشيت وجميع البيانات/السجلات (Rows) المرفوعة بداخله (يتم استخدام `ON DELETE CASCADE` في قاعدة البيانات).

**استجابة ناجحة:**
```json
{
  "success": true,
  "message": "تم حذف الشيت"
}
```

---

## 2. إدارة بيانات السجلات (Rows Management)

### 2.1 إضافة سجل جديد (Row) داخل الشيت
`POST /api/custom-sheets/:id/rows`

يتم التحقق من الحقول المطلوبة (Required) وأنواع البيانات (مثلاً Number أو Phone) أثناء الـ Validation. يتم إرسال القيم المطابقة لأسماء الحقول المعرفة مسبقاً في الـ `fields`.

**طلب (Request):**
```json
{
  "الاسم": "أحمد محمود",
  "رقم الهاتف": "01012345678",
  "العمر": 25
}
```

**استجابة ناجحة:**
```json
{
  "success": true,
  "message": "تمت إضافة السجل",
  "data": {
    "id": "row-uuid-string",
    "sheet_id": "sheet-uuid-string",
    "data": {
        "الاسم": "أحمد محمود",
        "رقم الهاتف": "01012345678",
        "العمر": 25
    },
    "created_at": "2026-03-29T00:00:00.000Z",
    "updated_at": "2026-03-29T00:00:00.000Z"
  }
}
```

### 2.2 عرض السجلات مع التصفح والبحث (Pagination & Search)
`GET /api/custom-sheets/:id/rows`

**معاملات الاستعلام المتاحة (Query Parameters):**
- `page`: رقم الصفحة (الافتراضي: 1)
- `limit`: عدد السجلات بالصفحة (الافتراضي: 20)
- `search`: كلمة للبحث عن بيانات معينة داخل السجل بخاصية `ILIKE`.

**مثال:**
`GET /api/custom-sheets/{id}/rows?page=1&limit=10&search=أحمد`

**استجابة ناجحة:**
```json
{
  "success": true,
  "data": [
    {
      "id": "row-uuid",
      "sheet_id": "sheet-uuid",
      "data": {
         "الاسم": "أحمد محمود",
         "رقم الهاتف": "01012345678"
      },
      "created_at": "...",
      "updated_at": "..."
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "totalCount": 1,
    "totalPages": 1
  }
}
```

### 2.3 تعديل سجل
`PUT /api/custom-sheets/:id/rows/:rowId`

**طلب (Request):**
يتم إرسال الـ JSON Object المحدث الذي يحتوي على البيانات.
```json
{
  "الاسم": "أحمد محمود (مُعدل)",
  "رقم الهاتف": "+201012345678",
  "العمر": 26
}
```

**استجابة ناجحة:**
```json
{
  "success": true,
  "message": "تم تعديل السجل",
  "data": { ... }
}
```

### 2.4 حذف سجل
`DELETE /api/custom-sheets/:id/rows/:rowId`

**استجابة ناجحة:**
```json
{
  "success": true,
  "message": "تم الحذف"
}
```

---

## 3. تفاصيل الـ Validation التلقائية:
النظام يقرأ ديناميكيًا حالة الـ `required` ونوع البيانات `type` المُخزن في الشيت:

- **الحقل من نوع "Number":** إذا تواجدت قيمة غير رقمية، يرجع أيرور `{ "success": false, "message": "بيانات غير صحيحة", "errors": ["الحقل العمر يجب أن يكون رقماً."] }`.
- **الحقل من نوع "Phone":** يتحقق من أن الإدخال يبدأ بـ `+` (اختياري) ويليه أرقام فقط، مثال لخطأ: `"الحقل رقم الهاتف غير صالح كرقم هاتف."`.
- **الحقول الإجبارية "Required":** إذا كان الحقل `required = true` ولم يُرسل، سيرد النظام بخطأ `"الحقل كذا مطلوب."`.
