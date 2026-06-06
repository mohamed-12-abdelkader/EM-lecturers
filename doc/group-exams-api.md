# API امتحانات المجموعات الدراسية

## نظرة عامة

هذا API يتيح للمدرسين إنشاء وإدارة امتحانات للمجموعات الدراسية، مع إمكانية إضافة درجات الطلاب وتتبع أدائهم.

## الجداول

### جدول `group_exams`
```sql
CREATE TABLE group_exams (
    id SERIAL PRIMARY KEY,
    group_id INTEGER NOT NULL REFERENCES study_groups(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    total_grade INTEGER NOT NULL DEFAULT 100,
    exam_date DATE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

### جدول `group_exam_grades`
```sql
CREATE TABLE group_exam_grades (
    id SERIAL PRIMARY KEY,
    exam_id INTEGER NOT NULL REFERENCES group_exams(id) ON DELETE CASCADE,
    student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    grade DECIMAL(5,2) NOT NULL,
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(exam_id, student_id)
);
```

## النقاط النهائية (Endpoints)

### 1. إنشاء امتحان جديد للمجموعة

**POST** `/api/group-exams`

**الصلاحيات المطلوبة:** `admin` أو `teacher`

**البيانات المطلوبة:**
```json
{
  "group_id": 1,
  "name": "امتحان الوحدة الأولى",
  "total_grade": 100,
  "exam_date": "2024-01-20"
}
```

**الاستجابة:**
```json
{
  "message": "تم إنشاء الامتحان بنجاح",
  "exam": {
    "id": 1,
    "group_id": 1,
    "name": "امتحان الوحدة الأولى",
    "total_grade": 100,
    "exam_date": "2024-01-20",
    "created_at": "2024-01-15T10:30:00Z",
    "updated_at": "2024-01-15T10:30:00Z"
  }
}
```

### 2. تحديث امتحان

**PUT** `/api/group-exams/:id`

**الصلاحيات المطلوبة:** `admin` أو `teacher` (مالك المجموعة فقط)

**البيانات المطلوبة:**
```json
{
  "name": "امتحان الوحدة الأولى - محدث",
  "total_grade": 50,
  "exam_date": "2024-01-25"
}
```

**الاستجابة:**
```json
{
  "message": "تم تحديث الامتحان بنجاح",
  "exam": {
    "id": 1,
    "group_id": 1,
    "name": "امتحان الوحدة الأولى - محدث",
    "total_grade": 50,
    "exam_date": "2024-01-25",
    "created_at": "2024-01-15T10:30:00Z",
    "updated_at": "2024-01-15T11:00:00Z"
  }
}
```

### 3. حذف امتحان

**DELETE** `/api/group-exams/:id`

**الصلاحيات المطلوبة:** `admin` أو `teacher` (مالك المجموعة فقط)

**الاستجابة:**
```json
{
  "message": "تم حذف الامتحان بنجاح"
}
```

### 4. جلب امتحان بواسطة ID

**GET** `/api/group-exams/:id`

**الصلاحيات المطلوبة:** لا توجد

**الاستجابة:**
```json
{
  "exam": {
    "id": 1,
    "group_id": 1,
    "name": "امتحان الوحدة الأولى",
    "total_grade": 100,
    "exam_date": "2024-01-20",
    "created_at": "2024-01-15T10:30:00Z",
    "updated_at": "2024-01-15T10:30:00Z",
    "group_name": "مجموعة الرياضيات المتقدمة",
    "teacher_id": 5
  }
}
```

### 5. جلب جميع امتحانات المجموعة

**GET** `/api/group-exams/group/:groupId`

**الصلاحيات المطلوبة:** لا توجد

**الاستجابة:**
```json
{
  "exams": [
    {
      "id": 1,
      "group_id": 1,
      "name": "امتحان الوحدة الأولى",
      "total_grade": 100,
      "exam_date": "2024-01-20",
      "created_at": "2024-01-15T10:30:00Z",
      "updated_at": "2024-01-15T10:30:00Z",
      "students_count": 12,
      "average_grade": 85.5
    },
    {
      "id": 2,
      "group_id": 1,
      "name": "امتحان الوحدة الثانية",
      "total_grade": 50,
      "exam_date": "2024-01-25",
      "created_at": "2024-01-16T10:30:00Z",
      "updated_at": "2024-01-16T10:30:00Z",
      "students_count": 8,
      "average_grade": 42.3
    }
  ]
}
```

### 6. إضافة درجة طالب في امتحان

**POST** `/api/group-exams/:examId/grades`

**الصلاحيات المطلوبة:** `admin` أو `teacher` (مالك المجموعة فقط)

**البيانات المطلوبة:**
```json
{
  "student_id": 15,
  "grade": 85.5,
  "notes": "أداء ممتاز في الجزء العملي"
}
```

**الاستجابة:**
```json
{
  "message": "تم إضافة الدرجة بنجاح",
  "grade": {
    "id": 1,
    "exam_id": 1,
    "student_id": 15,
    "grade": 85.5,
    "notes": "أداء ممتاز في الجزء العملي",
    "created_at": "2024-01-15T12:00:00Z",
    "updated_at": "2024-01-15T12:00:00Z"
  }
}
```

### 7. تحديث درجة طالب

**PUT** `/api/group-exams/:examId/grades/:studentId`

**الصلاحيات المطلوبة:** `admin` أو `teacher` (مالك المجموعة فقط)

**البيانات المطلوبة:**
```json
{
  "grade": 90.0,
  "notes": "تم تصحيح الدرجة بعد مراجعة إضافية"
}
```

**الاستجابة:**
```json
{
  "message": "تم تحديث الدرجة بنجاح",
  "grade": {
    "id": 1,
    "exam_id": 1,
    "student_id": 15,
    "grade": 90.0,
    "notes": "تم تصحيح الدرجة بعد مراجعة إضافية",
    "created_at": "2024-01-15T12:00:00Z",
    "updated_at": "2024-01-15T13:00:00Z"
  }
}
```

### 8. حذف درجة طالب

**DELETE** `/api/group-exams/:examId/grades/:studentId`

**الصلاحيات المطلوبة:** `admin` أو `teacher` (مالك المجموعة فقط)

**الاستجابة:**
```json
{
  "message": "تم حذف الدرجة بنجاح",
  "grade": {
    "id": 1,
    "exam_id": 1,
    "student_id": 15,
    "grade": 90.0,
    "notes": "تم تصحيح الدرجة بعد مراجعة إضافية",
    "created_at": "2024-01-15T12:00:00Z",
    "updated_at": "2024-01-15T13:00:00Z"
  }
}
```

### 9. جلب درجات امتحان معين

**GET** `/api/group-exams/:examId/grades`

**الصلاحيات المطلوبة:** لا توجد

**الاستجابة:**
```json
{
  "grades": [
    {
      "id": 1,
      "exam_id": 1,
      "student_id": 15,
      "grade": 90.0,
      "notes": "أداء ممتاز",
      "created_at": "2024-01-15T12:00:00Z",
      "updated_at": "2024-01-15T12:00:00Z",
      "student_name": "محمد أحمد",
      "student_email": "mohamed@example.com",
      "exam_name": "امتحان الوحدة الأولى",
      "total_grade": 100
    },
    {
      "id": 2,
      "exam_id": 1,
      "student_id": 16,
      "grade": 75.5,
      "notes": "أداء جيد",
      "created_at": "2024-01-15T12:30:00Z",
      "updated_at": "2024-01-15T12:30:00Z",
      "student_name": "فاطمة علي",
      "student_email": "fatima@example.com",
      "exam_name": "امتحان الوحدة الأولى",
      "total_grade": 100
    }
  ]
}
```

### 10. جلب درجات طالب في جميع امتحانات المجموعة

**GET** `/api/group-exams/group/:groupId/student/:studentId/grades`

**الصلاحيات المطلوبة:** لا توجد

**الاستجابة:**
```json
{
  "grades": [
    {
      "id": 1,
      "exam_id": 1,
      "student_id": 15,
      "grade": 90.0,
      "notes": "أداء ممتاز",
      "created_at": "2024-01-15T12:00:00Z",
      "updated_at": "2024-01-15T12:00:00Z",
      "exam_name": "امتحان الوحدة الأولى",
      "total_grade": 100,
      "exam_date": "2024-01-20"
    },
    {
      "id": 3,
      "exam_id": 2,
      "student_id": 15,
      "grade": 45.0,
      "notes": "أداء مقبول",
      "created_at": "2024-01-16T12:00:00Z",
      "updated_at": "2024-01-16T12:00:00Z",
      "exam_name": "امتحان الوحدة الثانية",
      "total_grade": 50,
      "exam_date": "2024-01-25"
    }
  ]
}
```

### 11. جلب إحصائيات امتحان

**GET** `/api/group-exams/:examId/stats`

**الصلاحيات المطلوبة:** لا توجد

**الاستجابة:**
```json
{
  "stats": {
    "total_students": 12,
    "graded_students": 10,
    "average_grade": 85.5,
    "highest_grade": 95.0,
    "lowest_grade": 65.0,
    "total_grade": 100,
    "exam_name": "امتحان الوحدة الأولى"
  }
}
```

### 12. جلب طلاب المجموعة (للتحقق)

**GET** `/api/group-exams/group/:groupId/students`

**الصلاحيات المطلوبة:** لا توجد

**الاستجابة:**
```json
{
  "students": [
    {
      "student_id": 15,
      "student_name": "محمد أحمد",
      "email": "mohamed@example.com"
    },
    {
      "student_id": 16,
      "student_name": "فاطمة علي",
      "email": "fatima@example.com"
    }
  ]
}
```

### 13. جلب جميع الطلاب في النظام (للتحقق)

**GET** `/api/group-exams/students/all`

**الصلاحيات المطلوبة:** لا توجد

**الاستجابة:**
```json
{
  "students": [
    {
      "id": 15,
      "name": "محمد أحمد",
      "email": "mohamed@example.com",
      "role": "student",
      "created_at": "2024-01-15T10:30:00Z"
    },
    {
      "id": 16,
      "name": "فاطمة علي",
      "email": "fatima@example.com",
      "role": "student",
      "created_at": "2024-01-15T11:00:00Z"
    }
  ]
}
```

## أمثلة JavaScript

### إنشاء امتحان جديد
```javascript
const createExam = async () => {
  const response = await fetch('/api/group-exams', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      group_id: 1,
      name: 'امتحان الوحدة الأولى',
      total_grade: 100,
      exam_date: '2024-01-20'
    })
  });
  
  const data = await response.json();
  console.log(data);
};
```

### إضافة درجة طالب
```javascript
const addGrade = async (examId, studentId, grade, notes) => {
  const response = await fetch(`/api/group-exams/${examId}/grades`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      student_id: studentId,
      grade: grade,
      notes: notes
    })
  });
  
  const data = await response.json();
  console.log(data);
};
```

### جلب درجات امتحان
```javascript
const getExamGrades = async (examId) => {
  const response = await fetch(`/api/group-exams/${examId}/grades`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  
  const data = await response.json();
  console.log(data.grades);
};
```

### جلب إحصائيات امتحان
```javascript
const getExamStats = async (examId) => {
  const response = await fetch(`/api/group-exams/${examId}/stats`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  
  const data = await response.json();
  console.log(data.stats);
};
```

## ملاحظات مهمة

1. **الدرجة الكلية:** `total_grade` افتراضياً 100، يمكن تغييرها
2. **تاريخ الامتحان:** `exam_date` اختياري
3. **الدرجة:** لا يمكن أن تتجاوز الدرجة الكلية للامتحان
4. **الصلاحيات:** المدرس يمكنه فقط تعديل وحذف امتحانات مجموعاته
5. **الطلاب:** يمكن إضافة درجات فقط للطلاب الموجودين في المجموعة
6. **التحديث:** إذا أضفت درجة لطالب موجود، سيتم تحديث الدرجة القديمة
7. **الإحصائيات:** تشمل متوسط الدرجات وأعلى وأقل درجة

## حالات الاستخدام

### للمدرسين:
- إنشاء امتحانات للمجموعات
- إضافة درجات الطلاب
- تتبع أداء الطلاب
- مراجعة إحصائيات الامتحانات

### للطلاب:
- رؤية درجاتهم في الامتحانات
- تتبع تقدمهم في المجموعة

### للإدارة:
- مراجعة أداء المجموعات
- تحليل إحصائيات الامتحانات 