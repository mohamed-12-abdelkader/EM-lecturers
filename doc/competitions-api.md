# API المسابقات (Competitions API)

## نظرة عامة
نظام المسابقات يسمح للأدمن بإنشاء وإدارة المسابقات التعليمية للطلاب. كل مسابقة مرتبطة بصف دراسي معين ويمكن التحكم في ظهورها ونشاطها.

## الجداول

### جدول المسابقات (competitions)
- `id`: المعرف الفريد (تلقائي)
- `title`: عنوان المسابقة
- `description`: وصف المسابقة
- `image_url`: رابط صورة المسابقة
- `duration`: مدة المسابقة بالدقائق
- `grade_id`: معرف الصف الدراسي
- `is_visible`: حالة الرؤية (true/false)
- `is_active`: حالة النشاط (true/false)
- `created_at`: تاريخ الإنشاء
- `updated_at`: تاريخ آخر تحديث
- `created_by`: معرف المستخدم المنشئ

## النقاط النهائية (Endpoints)

### 1. إنشاء مسابقة جديدة
**POST** `/competitions`

**الصلاحيات:** أدمن فقط

**المعاملات:**
- `title` (مطلوب): عنوان المسابقة
- `description` (اختياري): وصف المسابقة
- `image` (اختياري): صورة المسابقة (ملف)
- `duration` (مطلوب): مدة المسابقة بالدقائق
- `grade_id` (مطلوب): معرف الصف الدراسي
- `is_visible` (اختياري): حالة الرؤية (true/false)
- `is_active` (اختياري): حالة النشاط (true/false)

**مثال:**
```bash
curl -X POST /competitions \
  -H "Authorization: Bearer {token}" \
  -F "title=مسابقة الرياضيات" \
  -F "description=مسابقة في الجبر والهندسة" \
  -F "image=@math.jpg" \
  -F "duration=60" \
  -F "grade_id=1" \
  -F "is_visible=true" \
  -F "is_active=true"
```

### 2. الحصول على جميع المسابقات (للأدمن)
**GET** `/competitions/admin`

**الصلاحيات:** أدمن فقط

**الاستجابة:**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "title": "مسابقة الرياضيات",
      "description": "مسابقة في الجبر والهندسة",
      "image_url": "https://example.com/image.jpg",
      "duration": 60,
      "grade_id": 1,
      "grade_name": "الصف الأول",
      "is_visible": true,
      "is_active": true,
      "created_at": "2024-01-01T00:00:00Z",
      "updated_at": "2024-01-01T00:00:00Z",
      "created_by": 1,
      "creator_name": "أحمد محمد"
    }
  ]
}
```

### 3. الحصول على المسابقات المرئية (للطلاب)
**GET** `/competitions`

**الصلاحيات:** جميع المستخدمين

**المعاملات:**
- `grade_id` (اختياري): معرف الصف الدراسي

**مثال:**
```bash
# جميع المسابقات المرئية
GET /competitions

# مسابقات صف معين
GET /competitions?grade_id=1
```

### 4. الحصول على مسابقة بواسطة المعرف
**GET** `/competitions/{id}`

**الصلاحيات:** جميع المستخدمين

**مثال:**
```bash
GET /competitions/1
```

### 5. تحديث مسابقة
**PUT** `/competitions/{id}`

**الصلاحيات:** أدمن فقط

**المعاملات:** نفس معاملات الإنشاء (جميعها اختيارية)

**مثال:**
```bash
curl -X PUT /competitions/1 \
  -H "Authorization: Bearer {token}" \
  -F "title=مسابقة الرياضيات المحدثة" \
  -F "duration=90"
```

### 6. حذف مسابقة
**DELETE** `/competitions/{id}`

**الصلاحيات:** أدمن فقط

**مثال:**
```bash
curl -X DELETE /competitions/1 \
  -H "Authorization: Bearer {token}"
```

### 7. تغيير حالة الرؤية
**PATCH** `/competitions/{id}/toggle-visibility`

**الصلاحيات:** أدمن فقط

**مثال:**
```bash
curl -X PATCH /competitions/1/toggle-visibility \
  -H "Authorization: Bearer {token}"
```

### 8. تغيير حالة النشاط
**PATCH** `/competitions/{id}/toggle-active`

**الصلاحيات:** أدمن فقط

**مثال:**
```bash
curl -X PATCH /competitions/1/toggle-active \
  -H "Authorization: Bearer {token}"
```

## رفع الصور

- **الأنواع المدعومة:** JPEG, JPG, PNG, GIF, WebP
- **الحد الأقصى:** 5 ميجابايت
- **المجلد:** `uploads/competitions/`
- **التخزين:** يتم رفع الصور إلى Bunny.net Storage

## الأمان

- جميع عمليات الإنشاء والتحديث والحذف تتطلب صلاحيات أدمن
- عمليات القراءة متاحة لجميع المستخدمين
- يتم التحقق من صحة البيانات باستخدام Zod
- يتم التحقق من وجود المسابقة قبل التحديث أو الحذف

## رسائل الخطأ

```json
{
  "success": false,
  "message": "رسالة الخطأ باللغة العربية",
  "error": "تفاصيل الخطأ (اختياري)"
}
```

## أمثلة الاستخدام

### إنشاء مسابقة جديدة
```javascript
const formData = new FormData();
formData.append('title', 'مسابقة العلوم');
formData.append('description', 'مسابقة في الفيزياء والكيمياء');
formData.append('image', imageFile);
formData.append('duration', '45');
formData.append('grade_id', '2');
formData.append('is_visible', 'true');

fetch('/competitions', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`
  },
  body: formData
});
```

### تحديث مسابقة
```javascript
const formData = new FormData();
formData.append('title', 'مسابقة العلوم المحدثة');
formData.append('duration', '60');

fetch('/competitions/1', {
  method: 'PUT',
  headers: {
    'Authorization': `Bearer ${token}`
  },
  body: formData
});
```

### تغيير حالة الرؤية
```javascript
fetch('/competitions/1/toggle-visibility', {
  method: 'PATCH',
  headers: {
    'Authorization': `Bearer ${token}`
  }
});
```




