# Student Grades API - Enhanced Documentation

## نظرة عامة
هذا الـ API المحسن يتيح للمدرسين إدارة درجات الطلاب في امتحانات المجموعات الدراسية مع ميزات متقدمة مثل إضافة درجات متعددة دفعة واحدة وتقارير شاملة.

## نقاط النهاية (Endpoints)

### 1. إضافة درجة طالب في امتحان

**POST** `/api/student-grades/`

**الوصف:** إضافة درجة طالب في امتحان مجموعة معين

**الصلاحيات:** المدرس أو المدير فقط

**Request Body:**
```json
{
  "exam_name": "امتحان الوحدة الأولى",
  "student_id": 123,
  "grade": 85.5,
  "notes": "أداء ممتاز في الجزء النظري"
}
```

**الحقول المطلوبة:**
- `exam_name`: اسم الامتحان (نص)
- `student_id`: معرف الطالب (رقم)
- `grade`: الدرجة (رقم عشري)
- `notes`: ملاحظات (اختياري، نص)

**Response (201):**
```json
{
  "message": "تم إضافة الدرجة بنجاح",
  "grade": {
    "id": 1,
    "exam_name": "امتحان الوحدة الأولى",
    "group_name": "مجموعة الرياضيات",
    "student_name": "أحمد محمد",
    "student_id": 123,
    "grade": 85.5,
    "total_grade": 100,
    "notes": "أداء ممتاز في الجزء النظري",
    "created_at": "2024-01-15T10:30:00Z",
    "updated_at": "2024-01-15T10:30:00Z"
  }
}
```

### 2. إضافة درجات متعددة دفعة واحدة

**POST** `/api/student-grades/bulk`

**الوصف:** إضافة درجات متعددة للطلاب في امتحان واحد دفعة واحدة

**الصلاحيات:** المدرس أو المدير فقط

**Request Body:**
```json
{
  "exam_name": "امتحان الوحدة الأولى",
  "grades": [
    {
      "student_id": 123,
      "grade": 85.5,
      "notes": "أداء ممتاز"
    },
    {
      "student_id": 124,
      "grade": 92.0,
      "notes": "أداء رائع"
    },
    {
      "student_id": 125,
      "grade": 78.5,
      "notes": "أداء جيد"
    }
  ]
}
```

**Response (201):**
```json
{
  "message": "تم معالجة 3 درجة",
  "exam": {
    "name": "امتحان الوحدة الأولى",
    "group_name": "مجموعة الرياضيات",
    "total_grade": 100
  },
  "success_count": 3,
  "error_count": 0,
  "results": [
    {
      "index": 0,
      "student_id": 123,
      "student_name": "أحمد محمد",
      "grade": 85.5,
      "notes": "أداء ممتاز",
      "status": "success"
    }
  ],
  "errors": []
}
```

### 3. جلب درجات طالب معين

**GET** `/api/student-grades/student/:studentId`

**الوصف:** جلب جميع درجات طالب معين في امتحانات المدرس

**الصلاحيات:** المدرس أو المدير فقط

**Response (200):**
```json
{
  "student": {
    "id": 123,
    "name": "أحمد محمد"
  },
  "grades": [
    {
      "id": 1,
      "grade": 85.5,
      "notes": "أداء ممتاز",
      "created_at": "2024-01-15T10:30:00Z",
      "updated_at": "2024-01-15T10:30:00Z",
      "exam_name": "امتحان الوحدة الأولى",
      "total_grade": 100,
      "exam_date": "2024-01-20",
      "group_name": "مجموعة الرياضيات",
      "group_id": 1
    }
  ],
  "total_exams": 1,
  "average_grade": 85.5
}
```

### 4. جلب درجات امتحان معين

**GET** `/api/student-grades/exam/:examName`

**الوصف:** جلب جميع درجات طلاب امتحان معين مع الإحصائيات

**الصلاحيات:** المدرس أو المدير فقط

**Response (200):**
```json
{
  "exam": {
    "id": 1,
    "name": "امتحان الوحدة الأولى",
    "total_grade": 100,
    "exam_date": "2024-01-20",
    "group_name": "مجموعة الرياضيات",
    "group_id": 1
  },
  "grades": [
    {
      "id": 1,
      "grade": 85.5,
      "notes": "أداء ممتاز",
      "created_at": "2024-01-15T10:30:00Z",
      "updated_at": "2024-01-15T10:30:00Z",
      "student_name": "أحمد محمد",
      "student_id": 123
    }
  ],
  "stats": {
    "total_students": 25,
    "graded_students": 20,
    "average_grade": 78.5,
    "highest_grade": 95.0,
    "lowest_grade": 45.0
  }
}
```

### 5. تحديث درجة طالب

**PUT** `/api/student-grades/:gradeId`

**الوصف:** تحديث درجة طالب موجودة

**الصلاحيات:** المدرس أو المدير فقط

**Request Body:**
```json
{
  "grade": 88.0,
  "notes": "تم تحسين الدرجة"
}
```

**Response (200):**
```json
{
  "message": "تم تحديث الدرجة بنجاح",
  "grade": {
    "id": 1,
    "exam_name": "امتحان الوحدة الأولى",
    "grade": 88.0,
    "total_grade": 100,
    "notes": "تم تحسين الدرجة",
    "updated_at": "2024-01-15T11:30:00Z"
  }
}
```

### 6. حذف درجة طالب

**DELETE** `/api/student-grades/:gradeId`

**الوصف:** حذف درجة طالب

**الصلاحيات:** المدرس أو المدير فقط

**Response (200):**
```json
{
  "message": "تم حذف الدرجة بنجاح"
}
```

### 7. جلب قائمة امتحانات المدرس

**GET** `/api/student-grades/exams/list`

**الوصف:** جلب قائمة جميع امتحانات المدرس مع الإحصائيات

**الصلاحيات:** المدرس أو المدير فقط

**Response (200):**
```json
{
  "exams": [
    {
      "id": 1,
      "name": "امتحان الوحدة الأولى",
      "total_grade": 100,
      "exam_date": "2024-01-20",
      "created_at": "2024-01-15T10:30:00Z",
      "group_name": "مجموعة الرياضيات",
      "group_id": 1,
      "graded_students": 20,
      "total_students": 25,
      "average_grade": 78.5
    }
  ]
}
```

### 8. جلب قائمة طلاب المجموعة

**GET** `/api/student-grades/group/:groupId/students`

**الوصف:** جلب قائمة جميع الطلاب في مجموعة معينة

**الصلاحيات:** المدرس أو المدير فقط

**Response (200):**
```json
{
  "group": {
    "id": 1,
    "name": "مجموعة الرياضيات"
  },
  "students": [
    {
      "student_id": 123,
      "student_name": "أحمد محمد",
      "email": "ahmed@example.com",
      "phone": "01234567890",
      "joined_at": "2024-01-10T10:30:00Z"
    }
  ]
}
```

### 9. تقرير درجات المجموعة

**GET** `/api/student-grades/group/:groupId/report`

**الوصف:** جلب تقرير شامل لدرجات جميع الطلاب في المجموعة

**الصلاحيات:** المدرس أو المدير فقط

**Response (200):**
```json
{
  "group": {
    "id": 1,
    "name": "مجموعة الرياضيات"
  },
  "stats": {
    "total_students": 25,
    "total_exams": 3,
    "total_grades": 60,
    "average_grade": 78.5,
    "highest_grade": 95.0,
    "lowest_grade": 45.0
  },
  "student_grades": [
    {
      "student_id": 123,
      "student_name": "أحمد محمد",
      "exams_taken": 3,
      "average_grade": 85.5,
      "highest_grade": 92.0,
      "lowest_grade": 78.0,
      "total_grade": 256.5
    }
  ],
  "exam_details": [
    {
      "id": 1,
      "name": "امتحان الوحدة الأولى",
      "total_grade": 100,
      "exam_date": "2024-01-20",
      "graded_students": 20,
      "average_grade": 78.5,
      "highest_grade": 95.0,
      "lowest_grade": 45.0
    }
  ]
}
```

### 10. تقرير درجات امتحان معين

**GET** `/api/student-grades/exam/:examName/report`

**الوصف:** جلب تقرير شامل لدرجات امتحان معين مع توزيع الدرجات

**الصلاحيات:** المدرس أو المدير فقط

**Response (200):**
```json
{
  "exam": {
    "id": 1,
    "name": "امتحان الوحدة الأولى",
    "total_grade": 100,
    "exam_date": "2024-01-20",
    "group_name": "مجموعة الرياضيات",
    "group_id": 1
  },
  "stats": {
    "total_students": 25,
    "graded_students": 20,
    "average_grade": 78.5,
    "highest_grade": 95.0,
    "lowest_grade": 45.0,
    "passed_students": 15,
    "failed_students": 5
  },
  "student_grades": [
    {
      "id": 1,
      "grade": 95.0,
      "notes": "أداء ممتاز",
      "created_at": "2024-01-15T10:30:00Z",
      "updated_at": "2024-01-15T10:30:00Z",
      "student_name": "أحمد محمد",
      "student_id": 123,
      "status": "ناجح"
    }
  ],
  "grade_distribution": [
    {
      "grade_range": "90-100",
      "student_count": 5
    },
    {
      "grade_range": "80-89",
      "student_count": 8
    },
    {
      "grade_range": "70-79",
      "student_count": 4
    },
    {
      "grade_range": "60-69",
      "student_count": 2
    },
    {
      "grade_range": "50-59",
      "student_count": 1
    },
    {
      "grade_range": "لم يختبر",
      "student_count": 5
    }
  ]
}
```

## أخطاء محتملة

### 400 - Bad Request
- `بيانات مطلوبة`: إذا كانت البيانات المطلوبة غير مكتملة
- `درجة غير صحيحة`: إذا كانت الدرجة تتجاوز الدرجة الكلية أو سالبة
- `دور خاطئ`: إذا كان المستخدم ليس طالب

### 403 - Forbidden
- `غير مصرح`: إذا حاول المدرس الوصول لمجموعة أو امتحان مدرس آخر
- `طالب غير موجود في المجموعة`: إذا كان الطالب ليس في المجموعة

### 404 - Not Found
- `طالب غير موجود`: إذا كان الطالب غير موجود في النظام
- `امتحان غير موجود`: إذا كان الامتحان غير موجود في مجموعات المدرس
- `مجموعة غير موجودة`: إذا كانت المجموعة غير موجودة
- `درجة غير موجودة`: إذا كانت الدرجة غير موجودة

## ملاحظات مهمة

1. **الصلاحيات**: جميع العمليات تتطلب صلاحيات مدرس أو مدير
2. **التحقق من الملكية**: المدرس يمكنه فقط إدارة درجات مجموعاته الخاصة
3. **التحقق من البيانات**: يتم التحقق من صحة جميع البيانات قبل المعالجة
4. **التحديث التلقائي**: عند إضافة درجة موجودة، يتم تحديثها تلقائياً
5. **التقارير**: التقارير توفر إحصائيات شاملة لتحليل أداء الطلاب
6. **إضافة متعددة**: يمكن إضافة درجات متعددة دفعة واحدة مع معالجة الأخطاء

