# API التحكم في الوصول إلى محتوى المقرر الدراسي

## نظرة عامة

نظام التحكم في الوصول يسمح للمعلمين والأدمن بحظر/إلغاء حظر محتوى المقرر الدراسي للطلاب بناءً على حالة الاشتراك. النظام يدعم:

- حظر المحتوى لجميع الطلاب المسجلين
- حظر المحتوى لطالب محدد
- حظر المحتوى لمجموعة من الطلاب
- إلغاء الحظر بشكل فردي أو جماعي
- التحقق التلقائي من صلاحية الوصول عند جلب المحتوى

---

## البنية التحتية

### جدول enrollments (تم تحديثه)

تم إضافة الحقول التالية لجدول `enrollments`:

```sql
- subscription_status VARCHAR(20) DEFAULT 'active'
  CHECK (subscription_status IN ('active', 'expired', 'suspended'))
- is_blocked_by_teacher BOOLEAN DEFAULT FALSE
- blocked_at TIMESTAMP
- blocked_by INTEGER REFERENCES users(id)
- expires_at TIMESTAMP
```

### حالات الاشتراك

- **active**: نشط - الطالب يمكنه الوصول للمحتوى
- **expired**: منتهي الصلاحية - لا يمكن الوصول
- **suspended**: معلق - لا يمكن الوصول

---

## APIs

### 1. حظر محتوى المقرر لجميع الطلاب

**Endpoint**: `POST /api/courses/:courseId/block-all`

**الوصف**: حظر محتوى المقرر لجميع الطلاب المسجلين فيه

**الصلاحيات**: `teacher`, `admin` (يجب أن يكون المعلم صاحب المقرر)

**Headers**:
```
Authorization: Bearer <teacher_or_admin_token>
```

**Response (200 OK)**:
```json
{
  "success": true,
  "message": "تم حظر المحتوى لـ 15 طالب",
  "blocked_count": 15
}
```

**Response (403 Forbidden)**:
```json
{
  "success": false,
  "message": "غير مصرح لك بحظر محتوى هذا المقرر"
}
```

**مثال**:
```bash
curl -X POST http://localhost:8000/api/courses/1/block-all \
  -H "Authorization: Bearer <teacher_token>"
```

---

### 2. إلغاء حظر محتوى المقرر لجميع الطلاب

**Endpoint**: `POST /api/courses/:courseId/unblock-all`

**الوصف**: إلغاء حظر محتوى المقرر لجميع الطلاب المسجلين فيه

**الصلاحيات**: `teacher`, `admin` (يجب أن يكون المعلم صاحب المقرر)

**Headers**:
```
Authorization: Bearer <teacher_or_admin_token>
```

**Response (200 OK)**:
```json
{
  "success": true,
  "message": "تم إلغاء حظر المحتوى لـ 15 طالب",
  "unblocked_count": 15
}
```

**مثال**:
```bash
curl -X POST http://localhost:8000/api/courses/1/unblock-all \
  -H "Authorization: Bearer <teacher_token>"
```

---

### 3. حظر محتوى المقرر لطالب محدد

**Endpoint**: `POST /api/courses/:courseId/block-student`

**الوصف**: حظر محتوى المقرر لطالب محدد

**الصلاحيات**: `teacher`, `admin` (يجب أن يكون المعلم صاحب المقرر)

**Headers**:
```
Authorization: Bearer <teacher_or_admin_token>
Content-Type: application/json
```

**Request Body**:
```json
{
  "student_id": 5
}
```

**Response (200 OK)**:
```json
{
  "success": true,
  "message": "تم حظر المحتوى للطالب بنجاح"
}
```

**Response (400 Bad Request)**:
```json
{
  "success": false,
  "message": "الطالب غير مسجل في هذا المقرر"
}
```

**مثال**:
```bash
curl -X POST http://localhost:8000/api/courses/1/block-student \
  -H "Authorization: Bearer <teacher_token>" \
  -H "Content-Type: application/json" \
  -d '{"student_id": 5}'
```

---

### 4. إلغاء حظر محتوى المقرر لطالب محدد

**Endpoint**: `POST /api/courses/:courseId/unblock-student`

**الوصف**: إلغاء حظر محتوى المقرر لطالب محدد

**الصلاحيات**: `teacher`, `admin` (يجب أن يكون المعلم صاحب المقرر)

**Headers**:
```
Authorization: Bearer <teacher_or_admin_token>
Content-Type: application/json
```

**Request Body**:
```json
{
  "student_id": 5
}
```

**Response (200 OK)**:
```json
{
  "success": true,
  "message": "تم إلغاء حظر المحتوى للطالب بنجاح"
}
```

**مثال**:
```bash
curl -X POST http://localhost:8000/api/courses/1/unblock-student \
  -H "Authorization: Bearer <teacher_token>" \
  -H "Content-Type: application/json" \
  -d '{"student_id": 5}'
```

---

### 5. حظر محتوى المقرر لمجموعة من الطلاب

**Endpoint**: `POST /api/courses/:courseId/block-students`

**الوصف**: حظر محتوى المقرر لمجموعة من الطلاب دفعة واحدة

**الصلاحيات**: `teacher`, `admin` (يجب أن يكون المعلم صاحب المقرر)

**Headers**:
```
Authorization: Bearer <teacher_or_admin_token>
Content-Type: application/json
```

**Request Body**:
```json
{
  "student_ids": [5, 10, 15, 20]
}
```

**Response (200 OK)**:
```json
{
  "success": true,
  "message": "تم حظر المحتوى لـ 4 طلاب",
  "blocked_count": 4,
  "failed_count": 0
}
```

**ملاحظات**:
- `blocked_count`: عدد الطلاب الذين تم حظرهم بنجاح
- `failed_count`: عدد الطلاب الذين فشل حظرهم (غير مسجلين في المقرر)

**مثال**:
```bash
curl -X POST http://localhost:8000/api/courses/1/block-students \
  -H "Authorization: Bearer <teacher_token>" \
  -H "Content-Type: application/json" \
  -d '{"student_ids": [5, 10, 15, 20]}'
```

---

### 6. إلغاء حظر محتوى المقرر لمجموعة من الطلاب

**Endpoint**: `POST /api/courses/:courseId/unblock-students`

**الوصف**: إلغاء حظر محتوى المقرر لمجموعة من الطلاب دفعة واحدة

**الصلاحيات**: `teacher`, `admin` (يجب أن يكون المعلم صاحب المقرر)

**Headers**:
```
Authorization: Bearer <teacher_or_admin_token>
Content-Type: application/json
```

**Request Body**:
```json
{
  "student_ids": [5, 10, 15, 20]
}
```

**Response (200 OK)**:
```json
{
  "success": true,
  "message": "تم إلغاء حظر المحتوى لـ 4 طلاب",
  "unblocked_count": 4,
  "failed_count": 0
}
```

**مثال**:
```bash
curl -X POST http://localhost:8000/api/courses/1/unblock-students \
  -H "Authorization: Bearer <teacher_token>" \
  -H "Content-Type: application/json" \
  -d '{"student_ids": [5, 10, 15, 20]}'
```

---

### 7. جلب قائمة الطلاب المحظورين

**Endpoint**: `GET /api/courses/:courseId/blocked-students`

**الوصف**: جلب قائمة جميع الطلاب المحظورين في المقرر

**الصلاحيات**: `teacher`, `admin` (يجب أن يكون المعلم صاحب المقرر)

**Headers**:
```
Authorization: Bearer <teacher_or_admin_token>
```

**Response (200 OK)**:
```json
{
  "success": true,
  "blocked_students": [
    {
      "student_id": 5,
      "student_name": "أحمد محمد",
      "student_email": "ahmed@example.com",
      "blocked_at": "2024-01-15T10:00:00Z",
      "blocked_by": 2,
      "blocked_by_name": "المعلم الأول"
    },
    {
      "student_id": 10,
      "student_name": "فاطمة علي",
      "student_email": "fatima@example.com",
      "blocked_at": "2024-01-14T15:30:00Z",
      "blocked_by": 2,
      "blocked_by_name": "المعلم الأول"
    }
  ],
  "count": 2
}
```

**مثال**:
```bash
curl -X GET http://localhost:8000/api/courses/1/blocked-students \
  -H "Authorization: Bearer <teacher_token>"
```

---

### 8. جلب محتوى المقرر الدراسي (مع التحقق من الصلاحية)

**Endpoint**: `GET /api/courses/:courseId/content`

**الوصف**: جلب محتوى المقرر الدراسي مع التحقق التلقائي من صلاحية الوصول

**الصلاحيات**: `student`, `teacher`, `admin`

**Headers**:
```
Authorization: Bearer <token>
```

**Response (200 OK) - للطالب النشط**:
```json
{
  "access": true,
  "content": {
    "lectures": [
      {
        "id": 1,
        "title": "المحاضرة الأولى",
        "description": "مقدمة في المقرر",
        "video_url": "https://...",
        "position": 1
      }
    ]
  }
}
```

**Response (403 Forbidden) - للطالب المحظور**:
```json
{
  "access": false,
  "message": "تم حجب محتوى لحين انتهاء الاشتراك"
}
```

**Response (403 Forbidden) - غير مسجل**:
```json
{
  "access": false,
  "message": "غير مسجل في هذا المقرر الدراسي"
}
```

**مثال**:
```bash
curl -X GET http://localhost:8000/api/courses/1/content \
  -H "Authorization: Bearer <student_token>"
```

---

## منطق التحقق من الوصول

يتم التحقق من صلاحية الوصول بناءً على:

1. **التسجيل**: يجب أن يكون الطالب مسجل في المقرر
2. **الحظر بواسطة المعلم**: إذا كان `is_blocked_by_teacher = TRUE`
3. **حالة الاشتراك**: يجب أن تكون `active`
4. **انتهاء الصلاحية**: إذا كان `expires_at` موجود، يجب أن يكون في المستقبل

### ترتيب التحقق:

1. التحقق من التسجيل
2. التحقق من الحظر بواسطة المعلم
3. التحقق من حالة الاشتراك
4. التحقق من انتهاء الصلاحية

---

## أمثلة الاستخدام

### JavaScript (Fetch API)

#### حظر جميع الطلاب
```javascript
const response = await fetch('/api/courses/1/block-all', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${teacherToken}`
  }
});

const data = await response.json();
console.log(data.message); // "تم حظر المحتوى لـ 15 طالب"
```

#### حظر طالب محدد
```javascript
const response = await fetch('/api/courses/1/block-student', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${teacherToken}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    student_id: 5
  })
});

const data = await response.json();
console.log(data.message); // "تم حظر المحتوى للطالب بنجاح"
```

#### حظر مجموعة من الطلاب
```javascript
const response = await fetch('/api/courses/1/block-students', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${teacherToken}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    student_ids: [5, 10, 15, 20]
  })
});

const data = await response.json();
console.log(`تم حظر ${data.blocked_count} طالب`);
```

#### جلب محتوى المقرر (للطالب)
```javascript
const response = await fetch('/api/courses/1/content', {
  headers: {
    'Authorization': `Bearer ${studentToken}`
  }
});

const data = await response.json();

if (data.access) {
  console.log('المحتوى:', data.content);
} else {
  console.error('تم حجب المحتوى:', data.message);
}
```

---

## ملاحظات مهمة

1. ✅ **الصلاحيات**: فقط المعلم صاحب المقرر أو الأدمن يمكنهم حظر/إلغاء حظر المحتوى
2. ✅ **التحقق التلقائي**: عند جلب المحتوى، يتم التحقق تلقائياً من صلاحية الوصول
3. ✅ **حالة الاشتراك**: يمكن تحديث `subscription_status` عند تجديد الاشتراك
4. ✅ **إعادة التفعيل**: عند تجديد الاشتراك، يتم إلغاء الحظر تلقائياً
5. ✅ **الرسائل**: جميع الرسائل بالعربية لسهولة الفهم

---

## Migration

لتفعيل النظام، قم بتشغيل Migration:

```bash
# Migration موجود في:
migrations/1700000000140_add_enrollment_access_control.sql
```

---

## Service Methods

### CourseAccessService

- `checkStudentAccess(studentId, courseId)`: التحقق من صلاحية الوصول
- `blockAllStudents(courseId, blockedBy)`: حظر جميع الطلاب
- `unblockAllStudents(courseId)`: إلغاء حظر جميع الطلاب
- `blockStudent(courseId, studentId, blockedBy)`: حظر طالب محدد
- `unblockStudent(courseId, studentId)`: إلغاء حظر طالب محدد
- `blockStudents(courseId, studentIds, blockedBy)`: حظر مجموعة من الطلاب
- `unblockStudents(courseId, studentIds)`: إلغاء حظر مجموعة من الطلاب
- `renewSubscription(courseId, studentId, expiresAt)`: تجديد الاشتراك وإعادة التفعيل
- `getBlockedStudents(courseId)`: جلب قائمة الطلاب المحظورين

---

## Middleware

### checkCourseAccess()

Middleware للتحقق من صلاحية الوصول. يمكن استخدامه في أي endpoint يحتاج للتحقق من صلاحية الطالب:

```typescript
import { checkCourseAccess } from '../middleware/courseAccess';

router.get('/courses/:courseId/content', 
  authMiddleware(['student']),
  checkCourseAccess(),
  async (req, res) => {
    // الكود هنا
  }
);
```

---

## حالات الاستخدام

### 1. حظر جميع الطلاب عند مشكلة في الدفع
```javascript
// المعلم يحظر جميع الطلاب
await fetch('/api/courses/1/block-all', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${teacherToken}` }
});
```

### 2. حظر طالب محدد بسبب سلوك غير لائق
```javascript
await fetch('/api/courses/1/block-student', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${teacherToken}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ student_id: 5 })
});
```

### 3. إعادة تفعيل المحتوى عند تجديد الاشتراك
```javascript
// عند تجديد الاشتراك
await CourseAccessService.renewSubscription(courseId, studentId, newExpiresAt);
```

### 4. جلب المحتوى مع التحقق التلقائي
```javascript
const response = await fetch('/api/courses/1/content', {
  headers: { 'Authorization': `Bearer ${studentToken}` }
});

const data = await response.json();
if (!data.access) {
  alert(data.message); // "تم حجب محتوى لحين انتهاء الاشتراك"
}
```

---

## رموز الحالة HTTP

- **200 OK**: العملية نجحت
- **400 Bad Request**: بيانات غير صحيحة
- **401 Unauthorized**: غير مصرح به
- **403 Forbidden**: غير مسموح بالوصول
- **404 Not Found**: المقرر غير موجود
- **500 Internal Server Error**: خطأ في الخادم

---

## الأمان

1. ✅ **التحقق من الصلاحيات**: فقط المعلم صاحب المقرر أو الأدمن يمكنهم الحظر
2. ✅ **التحقق من التسجيل**: يتم التحقق من أن الطالب مسجل قبل الحظر
3. ✅ **التحقق من الوصول**: يتم التحقق تلقائياً عند جلب المحتوى
4. ✅ **التسجيل**: يتم تسجيل من قام بالحظر ومتى

---

## التكامل مع النظام الحالي

النظام متكامل مع:
- ✅ نظام المصادقة (`authMiddleware`)
- ✅ نظام الكورسات (`courses`)
- ✅ نظام المحتوى (`courseContent`)
- ✅ نظام التسجيلات (`enrollments`)

---

## الدعم الفني

للمساعدة أو الإبلاغ عن مشاكل، يرجى التواصل مع فريق الدعم الفني.

