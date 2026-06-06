# نظام أكواد تفعيل الكورسات

## نظرة عامة

نظام أكواد التفعيل يسمح للمدرسين بإنشاء أكواد تفعيل للكورسات الخاصة بهم، والطلاب يمكنهم استخدام هذه الأكواد لتفعيل الكورسات والوصول إلى محتواها.

## المميزات الرئيسية

- ✅ إنشاء عدة أكواد دفعة واحدة
- ✅ كل كود يستخدم مرة واحدة فقط
- ✅ تاريخ انتهاء صلاحية اختياري
- ✅ منع الاستخدام المتكرر للكود
- ✅ عرض حالة تفعيل الكورسات للطالب

---

## APIs للمدرسين

### 1. إنشاء أكواد تفعيل

**المسار:** `POST /course/activation-code`

**الوصف:** إنشاء أكواد تفعيل لكورس معين

**الصلاحيات:** مدرس فقط

**البيانات المطلوبة:**
```json
{
  "course_id": 1,
  "count": 5,
  "expires_at": "2024-12-31T23:59:59Z"
}
```

**البيانات:**
- `course_id` (مطلوب): معرف الكورس
- `count` (اختياري): عدد الأكواد المطلوبة (1-100، افتراضي: 1)
- `expires_at` (اختياري): تاريخ انتهاء الصلاحية (ISO format)

**مثال على الطلب:**
```bash
curl -X POST http://localhost:8000/course/activation-code \
  -H "Authorization: Bearer <teacher_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "course_id": 1,
    "count": 10,
    "expires_at": "2024-12-31T23:59:59Z"
  }'
```

**الاستجابة:**
```json
{
  "activation_codes": [
    {
      "id": 1,
      "code": "A1B2C3D4E5F6G7H8",
      "max_uses": 1,
      "expires_at": "2024-12-31T23:59:59Z",
      "created_at": "2024-01-15T10:30:00Z"
    },
    {
      "id": 2,
      "code": "I9J0K1L2M3N4O5P6",
      "max_uses": 1,
      "expires_at": "2024-12-31T23:59:59Z",
      "created_at": "2024-01-15T10:30:00Z"
    }
  ]
}
```

**حالات الخطأ:**
- `400`: بيانات غير صحيحة
- `404`: الكورس غير موجود أو لا يخص المدرس

---

### 2. عرض أكواد التفعيل

**المسار:** `GET /course/my-activation-codes`

**الوصف:** عرض جميع أكواد التفعيل الخاصة بالمدرس، ويمكن الفلترة حسب كورس معين عبر باراميتر `course_id`

**الصلاحيات:** مدرس فقط

**مثال على الطلب (كل الأكواد):**
```bash
curl -X GET http://localhost:8000/course/my-activation-codes \
  -H "Authorization: Bearer <teacher_token>"
```

**مثال على الطلب (أكواد كورس معين):**
```bash
curl -X GET "http://localhost:8000/api/course/my-activation-codes?course_id=1" \
  -H "Authorization: Bearer <teacher_token>"
```

**الاستجابة:**
```json
{
  "activation_codes": [
    {
      "id": 1,
      "code": "A1B2C3D4E5F6G7H8",
      "max_uses": 1,
      "uses": 0,
      "expires_at": "2024-12-31T23:59:59Z",
      "created_at": "2024-01-15T10:30:00Z",
      "course_title": "الرياضيات للصف الأول الثانوي",
      "course_id": 1,
      "is_expired": false,
      "is_fully_used": false,
      "qr_code": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA..."
    }
  ]
}
```

**الحقول الإضافية:**
- `uses`: عدد مرات الاستخدام الحالية
- `is_expired`: هل انتهت صلاحية الكود
- `is_fully_used`: هل تم استنفاذ الكود بالكامل
- `qr_code`: QR code بصيغة base64 للكود (مضاف حديثاً)

---

## APIs للطلاب

### 3. مسح QR Code وتفعيل الكورس

**المسار:** `POST /course/scan-qr-activate`

**الوصف:** مسح QR code وتفعيل الكورس مباشرة

**الصلاحيات:** طالب فقط

**البيانات المطلوبة:**
```json
{
  "qr_data": "{\"type\":\"activation_code\",\"code\":\"A1B2C3D4\",\"course_id\":8,\"expires_at\":\"2024-12-31T23:59:59Z\",\"created_at\":\"2024-01-15T10:30:00Z\"}"
}
```

**مثال على الطلب:**
```bash
curl -X POST http://localhost:8000/api/course/scan-qr-activate \
  -H "Authorization: Bearer <student_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "qr_data": "{\"type\":\"activation_code\",\"code\":\"A1B2C3D4\",\"course_id\":8,\"expires_at\":\"2024-12-31T23:59:59Z\",\"created_at\":\"2024-01-15T10:30:00Z\"}"
  }'
```

**الاستجابة الناجحة:**
```json
{
  "success": true,
  "message": "Course activated successfully",
  "course": {
    "id": 8,
    "title": "الرياضيات للصف الأول الثانوي",
    "teacher_id": 5
  }
}
```

**حالات الخطأ:**
- `400`: بيانات QR code غير صحيحة أو منتهية الصلاحية
- `404`: كود التفعيل غير موجود
- `400`: الكود مستنفذ أو تم استخدامه من قبل

---

### 4. تفعيل الكورس (الطريقة التقليدية)

**المسار:** `POST /course/activate`

**الوصف:** تفعيل كورس باستخدام كود التفعيل

**الصلاحيات:** طالب فقط

**البيانات المطلوبة:**
```json
{
  "code": "A1B2C3D4E5F6G7H8",
  "course_id": 1
}
```

**البيانات:**
- `code` (مطلوب): كود التفعيل
- `course_id` (مطلوب): معرف الكورس المراد تفعيله

**مثال على الطلب:**
```bash
curl -X POST http://localhost:8000/course/activate \
  -H "Authorization: Bearer <student_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "code": "A1B2C3D4E5F6G7H8",
    "course_id": 1
  }'
```

**الاستجابة:**
```json
{
  "message": "Course activated successfully",
  "course": {
    "id": 1,
    "title": "الرياضيات للصف الأول الثانوي"
  }
}
```

**حالات الخطأ:**
- `400`: كود غير صحيح أو منتهي الصلاحية أو مستنفذ
- `404`: كود التفعيل غير موجود أو لا ينتمي للكورس المحدد

---

### 4. عرض الكورسات مع حالة التفعيل

**المسار:** `GET /course/teacher/:teacherId`

**الوصف:** عرض كورسات مدرس معين مع حالة تفعيلها للطالب

**الصلاحيات:** طالب فقط

**مثال على الطلب:**
```bash
curl -X GET http://localhost:8000/course/teacher/5 \
  -H "Authorization: Bearer <student_token>"
```

**الاستجابة:**
```json
{
  "courses": [
    {
      "id": 1,
      "title": "الرياضيات للصف الأول الثانوي",
      "price": 150.00,
      "description": "شرح شامل لمنهج الرياضيات",
      "grade_id": 4,
      "created_at": "2024-01-15T10:30:00Z",
      "is_activated": true
    },
    {
      "id": 2,
      "title": "الجبر والهندسة",
      "price": 100.00,
      "description": "مفاهيم الجبر والهندسة",
      "grade_id": 4,
      "created_at": "2024-01-20T14:00:00Z",
      "is_activated": false
    }
  ]
}
```

**الحقول:**
- `is_activated`: `true` إذا كان الكورس مفعل للطالب، `false` إذا لم يكن مفعل

---

## قواعد النظام

### للمدرسين:
1. يمكن إنشاء أكواد لكورساتهم فقط
2. كل كود يستخدم مرة واحدة فقط
3. يمكن تحديد عدد الأكواد (1-100)
4. يمكن تحديد تاريخ انتهاء الصلاحية

### للطلاب:
1. لا يمكن استخدام نفس الكود مرتين
2. لا يمكن استخدام كود منتهي الصلاحية
3. لا يمكن استخدام كود مستنفذ
4. الكورسات غير المفعلة لا يمكن الوصول لمحتواها

### الأكواد:
1. كل كود فريد ومكون من 16 حرف
2. تنسيق الكود: أحرف وأرقام كبيرة
3. مثال: `A1B2C3D4E5F6G7H8`

---

## أمثلة على الاستخدام

### سيناريو كامل:

1. **المدرس ينشئ أكواد:**
```bash
POST /course/activation-code
{
  "course_id": 1,
  "count": 5,
  "expires_at": "2024-12-31T23:59:59Z"
}
```

2. **المدرس يشارك الأكواد مع الطلاب**

3. **الطالب يفعّل الكورس:**
```bash
POST /course/activate
{
  "code": "A1B2C3D4E5F6G7H8",
  "course_id": 1
}
```

4. **الطالب يرى الكورسات المفعلة:**
```bash
GET /course/teacher/5
```

---

## ملاحظات مهمة

- ⚠️ الأكواد حساسة للأحرف الكبيرة والصغيرة
- ⚠️ لا يمكن استرداد الأكواد بعد إنشائها
- ⚠️ لا يمكن تعديل الأكواد بعد إنشائها
- ⚠️ الكورسات غير المفعلة تظهر للطالب لكن لا يمكن الوصول لمحتواها
- ✅ يمكن إنشاء أكواد جديدة في أي وقت
- ✅ يمكن تتبع استخدام الأكواد عبر API عرض الأكواد
