# Device IP Binding - Backend Documentation

## نظرة عامة

نظام ربط IP الجهاز للطلاب لمنع تسجيل الدخول من أجهزة مختلفة. هذا النظام يعمل **فقط للطلاب** (`role === 'student'`) ولا يؤثر على المدرسين أو المدراء.

---

## التغييرات في قاعدة البيانات

### Migration

**ملف Migration**: `migrations/1700000000600_add_device_ip_to_users.sql`

```sql
-- Up Migration
ALTER TABLE users ADD COLUMN IF NOT EXISTS device_ip TEXT;

-- Down Migration
ALTER TABLE users DROP COLUMN IF EXISTS device_ip;
```

**الحقل**:
- **الاسم**: `device_ip`
- **النوع**: `TEXT` (nullable)
- **الوصف**: يحفظ IP الجهاز للطالب

**لتطبيق التغييرات**:
```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS device_ip TEXT;
```

---

## API Endpoints

### 1. تسجيل طالب جديد (Register)

**Endpoint**: `POST /api/users/register`

**Headers**:
```
Content-Type: application/json
```

**Request Body** - مثال 1: تسجيل طالب في صف دراسي:
```json
{
  "phone": "+966501234567",
  "password": "123456",
  "name": "أحمد محمد",
  "parent_phone": "+966501234568",
  "grade_id": 1,
  "device_ip": "192.168.1.100"  // اختياري
}
```

**Request Body** - مثال 2: تسجيل طالب بتخصص (بدون صف دراسي):
```json
{
  "phone": "+966501234567",
  "password": "123456",
  "name": "أحمد محمد",
  "parent_phone": "+966501234568",
  "course_category": "برمجة",
  "device_ip": "192.168.1.100"  // اختياري
}
```

**⚠️ خطأ - لا يمكن إرسال كليهما معاً**:
```json
{
  "phone": "+966501234567",
  "password": "123456",
  "name": "أحمد محمد",
  "parent_phone": "+966501234568",
  "grade_id": 1,  // ❌ خطأ: لا يمكن إرساله مع course_category
  "course_category": "برمجة"  // ❌ خطأ: لا يمكن إرساله مع grade_id
}
```

**الحقول**:
- `phone` (string, required): رقم هاتف الطالب
- `password` (string, required): كلمة المرور (الحد الأدنى 6 أحرف)
- `name` (string, required): اسم الطالب
- `parent_phone` (string, required): رقم هاتف ولي الأمر
- `grade_id` (number, optional): معرف الصف الدراسي - **⚠️ لا يمكن إرساله مع `course_category`**
- `course_category` (string, optional): نوع الكورس المختار - **القيم المسموحة**: `برمجة`، `لغات`، `إدارة وتسويق`، `بيزنس`، `مهارات متنوعة` - **⚠️ لا يمكن إرساله مع `grade_id`**
- `device_ip` (string, optional): IP الجهاز - **إذا تم إرساله يتم حفظه، وإلا يتم حفظ `null`**

**⚠️ ملاحظة مهمة**: لا يمكن إرسال `grade_id` و `course_category` معاً. يجب اختيار إما صف دراسي (`grade_id`) أو تخصص (`course_category`).

**Response (201 Created)**:
```json
{
  "user": {
    "id": 123,
    "phone": "+966501234567",
    "name": "أحمد محمد",
    "parent_phone": "+966501234568",
    "role": "student",
    "avatar": null,
    "device_ip": "192.168.1.100"
  },
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Response (400 Bad Request)**:
```json
{
  "message": "Phone number already registered"
}
```

**السلوك**:
- إذا تم إرسال `device_ip`: يتم حفظه في قاعدة البيانات
- إذا لم يتم إرسال `device_ip`: يتم حفظ `null`
- **ملاحظة**: IP غير مطلوب في التسجيل، يمكن التسجيل بدون IP

---

### 2. تسجيل الدخول (Login)

**Endpoint**: `POST /api/auth/login`

**Headers**:
```
Content-Type: application/json
```

**Request Body**:
```json
{
  "phone": "+966501234567",
  "password": "123456",
  "device_ip": "192.168.1.100"  // مطلوب للطلاب
}
```

أو باستخدام email:
```json
{
  "email": "student@example.com",
  "password": "123456",
  "device_ip": "192.168.1.100"  // مطلوب للطلاب
}
```

**الحقول**:
- `phone` (string, optional): رقم الهاتف (يجب إرسال `phone` أو `email`)
- `email` (string, optional): البريد الإلكتروني (يجب إرسال `phone` أو `email`)
- `password` (string, required): كلمة المرور
- `device_ip` (string, optional): IP الجهاز - **مطلوب للطلاب**

**Response (200 OK)** - نجح تسجيل الدخول:
```json
{
  "user": {
    "id": 123,
    "name": "أحمد محمد",
    "email": null,
    "phone": "+966501234567",
    "role": "student",
    "avatar": null
  },
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "employee_permissions": null,
  "employee_data": null
}
```

**Response (400 Bad Request)** - بيانات خاطئة:
```json
{
  "message": "Invalid credentials"
}
```

**Response (403 Forbidden)** - IP مختلف (للطلاب فقط):
```json
{
  "success": false,
  "message": "غير مسموح لك بتسجيل الدخول من جهاز مختلف"
}
```

---

## منطق التحقق من IP

### للطلاب فقط (`role === 'student'`)

#### الحالة A: الطالب لديه IP محفوظ (`device_ip` موجود)

1. يتم مقارنة `device_ip` المحفوظ مع `device_ip` المرسل في الطلب
2. **إذا كانا متطابقين**: يتم السماح بتسجيل الدخول بشكل طبيعي
3. **إذا كانا مختلفين**: يتم رفض الطلب مع رسالة:
   ```json
   {
     "success": false,
     "message": "غير مسموح لك بتسجيل الدخول من جهاز مختلف"
   }
   ```
   - **Status Code**: `403 Forbidden`

#### الحالة B: الطالب لا يملك IP محفوظ (`device_ip` = `null`)

1. يتم قبول تسجيل الدخول
2. يتم حفظ `device_ip` المرسل في قاعدة البيانات
3. يتم السماح بتسجيل الدخول بشكل طبيعي
4. **ملاحظة**: هذا يحدث للحسابات القديمة التي تم إنشاؤها قبل تطبيق هذا النظام

### للمدرسين والمدراء

- **لا يوجد تحقق من IP**: المدرسون والمدراء يمكنهم تسجيل الدخول من أي جهاز
- `device_ip` **غير مطلوب** في طلب تسجيل الدخول
- حتى لو تم إرسال `device_ip`، لن يتم التحقق منه أو حفظه

---

## أمثلة الاستخدام

### مثال 1: تسجيل طالب جديد مع IP

```bash
curl -X POST http://localhost:8000/api/users/register \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "+966501234567",
    "password": "123456",
    "name": "أحمد محمد",
    "parent_phone": "+966501234568",
    "grade_id": 1,
    "device_ip": "192.168.1.100"
  }'
```

**Response**:
```json
{
  "user": {
    "id": 123,
    "phone": "+966501234567",
    "name": "أحمد محمد",
    "parent_phone": "+966501234568",
    "role": "student",
    "avatar": null,
    "device_ip": "192.168.1.100"
  },
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

### مثال 2: تسجيل طالب جديد بدون IP

```bash
curl -X POST http://localhost:8000/api/users/register \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "+966501234567",
    "password": "123456",
    "name": "أحمد محمد",
    "parent_phone": "+966501234568",
    "grade_id": 1
  }'
```

**Response**: نفس الاستجابة لكن `device_ip` سيكون `null`

### مثال 3: تسجيل دخول طالب بنفس IP (نجاح)

```bash
curl -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "+966501234567",
    "password": "123456",
    "device_ip": "192.168.1.100"
  }'
```

**Response (200)**:
```json
{
  "user": {
    "id": 123,
    "name": "أحمد محمد",
    "phone": "+966501234567",
    "role": "student",
    "avatar": null
  },
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

### مثال 4: تسجيل دخول طالب بـ IP مختلف (فشل)

```bash
curl -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "+966501234567",
    "password": "123456",
    "device_ip": "192.168.1.200"
  }'
```

**Response (403)**:
```json
{
  "success": false,
  "message": "غير مسموح لك بتسجيل الدخول من جهاز مختلف"
}
```

### مثال 5: تسجيل دخول طالب قديم بدون IP محفوظ (نجاح + حفظ IP)

```bash
# الطالب لديه device_ip = null في قاعدة البيانات
curl -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "+966501234567",
    "password": "123456",
    "device_ip": "192.168.1.100"
  }'
```

**Response (200)**:
```json
{
  "user": {
    "id": 123,
    "name": "أحمد محمد",
    "phone": "+966501234567",
    "role": "student",
    "avatar": null
  },
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**ملاحظة**: بعد هذا الطلب، سيتم حفظ `device_ip = "192.168.1.100"` في قاعدة البيانات

### مثال 6: تسجيل دخول مدرس (لا يوجد تحقق من IP)

```bash
curl -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "teacher@example.com",
    "password": "123456"
  }'
```

**Response (200)**: نجح حتى بدون `device_ip`

### مثال 7: السماح للطالب باستخدام جهاز آخر (Admin)

```bash
curl -X PATCH http://localhost:8000/api/users/students/allow-device \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <admin_token>" \
  -d '{
    "phone": "+966501234567"
  }'
```

**Response (200)**:
```json
{
  "success": true,
  "message": "تم السماح للطالب باستخدام جهاز آخر بنجاح",
  "data": {
    "student_id": 123,
    "student_name": "أحمد محمد",
    "student_phone": "+966501234567",
    "old_device_ip": "192.168.1.100",
    "new_device_ip": null,
    "note": "يمكن للطالب الآن تسجيل الدخول من أي جهاز. سيتم حفظ IP الجهاز الجديد تلقائياً عند أول تسجيل دخول.",
    "updated_at": "2024-01-15T10:30:00.000Z"
  }
}
```

**ملاحظة**: 
- بعد استدعاء هذا API، يتم إزالة قيد IP (`device_ip = null`)
- يمكن للطالب الآن تسجيل الدخول من أي جهاز
- عند أول تسجيل دخول، سيتم حفظ IP الجهاز الجديد تلقائياً
- بعد ذلك، سيتم تطبيق القيد على IP الجديد

---

## Schema Validation

### RegisterStudent Schema

```typescript
{
  phone: string (regex: /^\+?[0-9]{8,15}$/),
  password: string (min: 6),
  name: string (min: 1),
  parent_phone: string (regex: /^\+?[0-9]{8,15}$/),
  grade_id: number (optional),
  student_level_id: number (optional),
  device_ip: string (optional)  // جديد
}
```

### Login Schema

```typescript
{
  email: string (email, optional),
  phone: string (regex: /^\+?[0-9]{8,15}$/, optional),
  password: string (required),
  device_ip: string (optional)  // جديد
}
```

**ملاحظة**: يجب إرسال `email` أو `phone` (واحد على الأقل)

---

## ملاحظات مهمة

1. **الطلاب فقط**: النظام يعمل فقط للطلاب (`role === 'student'`). المدرسون والمدراء غير متأثرين.

2. **IP اختياري في التسجيل**: يمكن التسجيل بدون `device_ip`. إذا لم يتم إرساله، سيتم حفظ `null`.

3. **IP مطلوب في Login للطلاب**: يجب إرسال `device_ip` في طلب تسجيل الدخول للطلاب. إذا لم يتم إرساله، قد لا يعمل التحقق بشكل صحيح.

4. **الحسابات القديمة**: الحسابات التي تم إنشاؤها قبل تطبيق هذا النظام لن يكون لديها `device_ip` محفوظ. عند أول تسجيل دخول، سيتم حفظ IP تلقائياً.

5. **رسالة الخطأ**: عند محاولة تسجيل الدخول من جهاز مختلف، يتم إرجاع:
   - **Status Code**: `403 Forbidden`
   - **Message**: `"غير مسموح لك بتسجيل الدخول من جهاز مختلف"`

6. **تحديث IP**: يمكن للادمن تحديث IP الطالب من خلال API مخصص (`PATCH /api/users/students/device-ip`).

---

## 3. السماح للطالب باستخدام جهاز آخر (Admin Only)

**Endpoint**: `PATCH /api/users/students/allow-device`

**الصلاحيات**: `admin` فقط

**Headers**:
```
Content-Type: application/json
Authorization: Bearer <admin_token>
```

**Request Body**:
```json
{
  "phone": "+966501234567"
}
```

**الحقول**:
- `phone` (string, required): رقم هاتف الطالب

**Response (200 OK)**:
```json
{
  "success": true,
  "message": "تم السماح للطالب باستخدام جهاز آخر بنجاح",
  "data": {
    "student_id": 123,
    "student_name": "أحمد محمد",
    "student_phone": "+966501234567",
    "old_device_ip": "192.168.1.100",
    "new_device_ip": null,
    "note": "يمكن للطالب الآن تسجيل الدخول من أي جهاز. سيتم حفظ IP الجهاز الجديد تلقائياً عند أول تسجيل دخول.",
    "updated_at": "2024-01-15T10:30:00.000Z"
  }
}
```

**Response (400 Bad Request)** - رقم الهاتف مفقود:
```json
{
  "success": false,
  "message": "رقم الهاتف مطلوب"
}
```

**Response (404 Not Found)** - الطالب غير موجود:
```json
{
  "success": false,
  "message": "الطالب غير موجود"
}
```

**السلوك**:
- يتم البحث عن الطالب برقم الهاتف فقط
- يتم إزالة قيد IP (device_ip = null)
- يمكن للطالب الآن تسجيل الدخول من أي جهاز
- عند أول تسجيل دخول، سيتم حفظ IP الجهاز الجديد تلقائياً
- يتم إرجاع IP القديم في الاستجابة

**ملاحظات**:
- هذا API للادمن فقط
- يزيل القيد تماماً (device_ip = null)
- عند تسجيل الدخول التالي، سيتم حفظ IP الجديد تلقائياً
- بعد ذلك، سيتم تطبيق القيد على IP الجديد

---

## استكشاف الأخطاء

### المشكلة: Migration لم يتم تطبيقه

**الأعراض**: خطأ في قاعدة البيانات عند محاولة حفظ `device_ip`

**الحل**:
```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS device_ip TEXT;
```

### المشكلة: تسجيل الدخول يفشل دائماً للطلاب

**الأسباب المحتملة**:
1. `device_ip` غير مرسل في الطلب
2. IP المرسل مختلف عن IP المحفوظ
3. المستخدم ليس طالباً (يجب التحقق من `role`)

**الحل**: تأكد من:
- إرسال `device_ip` في طلب تسجيل الدخول
- استخدام نفس IP الذي تم التسجيل به
- التحقق من أن المستخدم لديه `role = 'student'`

### المشكلة: IP لا يتم حفظه عند التسجيل

**الأسباب المحتملة**:
1. Migration لم يتم تطبيقه
2. `device_ip` غير مرسل في الطلب (هذا طبيعي، سيتم حفظ `null`)

**الحل**: 
- تأكد من تطبيق Migration
- إذا أردت حفظ IP، تأكد من إرساله في طلب التسجيل

---

## الكود المصدري

### Register Endpoint
**الملف**: `src/controllers/user.ts`
**الدالة**: `POST /register`

### Login Endpoint
**الملف**: `src/controllers/auth.ts`
**الدالة**: `POST /login`

### Allow Device Endpoint (Admin)
**الملف**: `src/controllers/user.ts`
**الدالة**: `PATCH /students/allow-device`

### Schema Validation
**الملف**: `src/controllers/auth.modules.ts`
- `RegisterStudent`
- `Login`

### Migration
**الملف**: `migrations/1700000000600_add_device_ip_to_users.sql`

