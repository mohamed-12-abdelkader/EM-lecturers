# توثيق APIs الكورسات العامة (التحديثات الجديدة)

يغطي هذا الملف APIs الجديدة التي تمت إضافتها مؤخراً لـ:
1. نظام أكواد التفعيل
2. نظام المجموعات (Groups)

---

## أولاً: نظام أكواد التفعيل والاشتراكات

### 1. توليد أكواد تفعيل لكورس
**Endpoint**: `POST /api/general-courses/:id/codes`
**الصلاحيات**: `admin`

**Body**:
```json
{
  "count": 50
}
```

**Response**:
```json
{
  "success": true,
  "message": "تم إنشاء 50 كود بنجاح",
  "codes": ["12345678", "87654321", ...],
  "requested_count": 50
}
```

### 2. جلب أكواد التفعيل لكورس (مع حالتها)
**Endpoint**: `GET /api/general-courses/:id/codes`
**الصلاحيات**: `admin`

**Response**:
```json
{
  "success": true,
  "codes": [
    {
      "id": 1,
      "code": "12345678",
      "is_used": true,
      "created_at": "...",
      "used_at": "...",
      "used_by_name": "اسم الطالب",
      "used_by_phone": "010xxxx"
    },
    ...
  ],
  "total": 50
}
```

### 3. تفعيل كورس (للطالب)
**Endpoint**: `POST /api/general-courses/activate`
**الصلاحيات**: `student`

**Body**:
```json
{
  "courseId": 1,
  "code": "12345678"
}
```

**Response**:
```json
{
  "success": true,
  "message": "تم تفعيل الكورس بنجاح"
}
```

### 4. عرض الطلاب المشتركين في كورس
**Endpoint**: `GET /api/general-courses/:id/students`
**الصلاحيات**: `admin`

**Response**:
```json
{
  "success": true,
  "students": [
    {
      "id": 101,
      "name": "علي محمد",
      "email": "ali@example.com",
      "phone": "0123456789",
      "enrolled_at": "...",
      "enrollment_type": "code"
    }
  ],
  "total": 1
}
```

---

## ثانياً: نظام المجموعات (Groups)

### 1. إنشاء مجموعة جديدة
**Endpoint**: `POST /api/general-courses/:courseId/groups`
**الصلاحيات**: `admin`

**Body**:
```json
{
  "name": "المجموعة A",
  "max_students": 50  // اختياري، 0 يعني غير محدود
}
```

### 2. عرض مجموعات الكورس
**Endpoint**: `GET /api/general-courses/:courseId/groups`
**الصلاحيات**: `admin`

يرجع المجموعات مع عدد الطلاب (`student_count`) في كل مجموعة.

### 3. تعديل مجموعة
**Endpoint**: `PUT /api/general-courses/groups/:groupId`
**الصلاحيات**: `admin`

**Body**: (جميع الحقول اختيارية)
```json
{
  "name": "اسم جديد",
  "max_students": 100
}
```

### 4. حذف مجموعة
**Endpoint**: `DELETE /api/general-courses/groups/:groupId`
**الصلاحيات**: `admin`

**ملاحظة**: عند حذف المجموعة، يتم إعادة طلابها تلقائياً إلى "قائمة الانتظار" (Waitlist).

### 5. عرض قائمة الانتظار (الطلاب غير المعينين)
**Endpoint**: `GET /api/general-courses/:courseId/waitlist`
**الصلاحيات**: `admin`

يعرض الطلاب المشتركين في الكورس ولكن ليس لديهم مجموعة.

### 6. تعيين طلاب لمجموعة
**Endpoint**: `POST /api/general-courses/groups/:groupId/assign`
**الصلاحيات**: `admin`

ينقل الطلاب من قائمة الانتظار (أو من مجموعة أخرى) إلى هذه المجموعة.

**Body**:
```json
{
  "studentIds": [101, 102, 105]
}
```

### 7. إزالة طلاب من مجموعة
**Endpoint**: `POST /api/general-courses/groups/:groupId/remove`
**الصلاحيات**: `admin`

يزيل الطلاب من المجموعة ويعيدهم إلى قائمة الانتظار.

**Body**:
```json
{
  "studentIds": [101]
}
```

### 8. عرض طلاب مجموعة محددة
**Endpoint**: `GET /api/general-courses/groups/:groupId/students`
**الصلاحيات**: `admin`

يعرض قائمة الطلاب المنضمين لهذه المجموعة تحديداً.

---

## ملاحظات هامة في التنفيذ

1. **الاشتراك والمجموعات**:
   - الطالب يشترك في الكورس أولاً (عبر التفعيل بالكود أو الشراء).
   - بمجرد الاشتراك، يدخل الطالب في حالة `group_id = NULL` (قائمة الانتظار).
   - المشرف يقوم بتوزيع الطلاب على المجموعات باستخدام API الـ `assign`.

2. **الوصول للمحتوى**:
   - جميع الطلاب المشتركين (سواء في مجموعة أو في الانتظار) يمكنهم الوصول لمحتوى الكورس المسجل عبر `GET /api/general-courses/:id` (تم تحديثه ليسمح للطلاب المشتركين بالدخول).
   - الجلسات المباشرة (Live Sessions) ستكون مرتبطة بالمجموعة لاحقاً.

3. **حذف المجموعات**:
   - لا يؤدي حذف المجموعة إلى طرد الطالب من الكورس، بل يعيده فقط إلى وضع الانتظار.

---

## ثالثاً: تحديثات المدرسين والجداول (Schedules)

### 1. تعيين مدرس للمجموعة
عند إنشاء أو تحديث مجموعة، يمكن تحديد `teacher_id`.

**Payload (Create/Update Group):**
```json
{
  "name": "المجموعة الذهبية",
  "teacher_id": 5, // معرف المدرس (اختياري)
  "max_students": 50
}
```

### 2. إضافة جدول مواعيد للمجموعة
يمكن للأدمن إضافة مواعيد أسبوعية ثابتة للمجموعة.

**Endpoint**: `POST /api/general-courses/groups/:groupId/schedules`
**الصلاحيات**: `admin`

**Body**:
```json
{
  "schedules": [
    {
      "day_of_week": 0,       // 0 = الأحد، 6 = السبت
      "start_time": "14:30",  // التوقيت بصيغة 24 ساعة
      "duration_minutes": 90  // المدة بالدقائق
    },
    {
      "day_of_week": 2,       // 2 = الثلاثاء
      "start_time": "16:00"
    }
  ]
}
```

### 3. حذف موعد من الجدول
**Endpoint**: `DELETE /api/general-courses/schedules/:scheduleId`
**الصلاحيات**: `admin`

### 4. صلاحيات المدرس
- المدرس **المعين للمجموعة** يمكنه:
    - عرض تفاصيل مجموعته (شاملة الجدول والطلاب) عبر: `GET /api/general-courses/groups/:groupId`
    - عرض قائمة طلاب مجموعته عبر: `GET /api/general-courses/groups/:groupId/students`
- المدرس **غير المعين** سيحصل على `403 Forbidden`.
