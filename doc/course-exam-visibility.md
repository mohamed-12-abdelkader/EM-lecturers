# ميزة إخفاء/إظهار الامتحانات الشاملة

## نظرة عامة

تم إضافة ميزة جديدة تسمح للمدرسين بإخفاء الامتحانات الشاملة عن الطلاب حتى يقرروا إظهارها. الامتحانات تكون مخفية افتراضياً عند إنشائها.

## المميزات

- ✅ **إخفاء افتراضي** - الامتحانات مخفية عند إنشائها
- ✅ **تحكم المدرس** - المدرس يتحكم في ظهور الامتحانات
- ✅ **حماية الطلاب** - الطلاب يرون فقط الامتحانات المرئية
- ✅ **API منفصل** - API خاص بتغيير حالة الظهور

## APIs

### 1. إنشاء امتحان شامل (محدث)

**Endpoint:** `POST /api/course/:courseId/course-exam`

**الصلاحيات:** `teacher` فقط

**Request Body (form-data):**
```json
{
  "title": "امتحان نهاية الكورس",
  "questions_count": 20,
  "duration": 60,
  "total_grade": 100,
  "is_visible": false  // اختياري، افتراضي false
}
```

**Response (201):**
```json
{
  "exam": {
    "id": 1,
    "course_id": 1,
    "title": "امتحان نهاية الكورس",
    "questions_count": 20,
    "duration": 60,
    "total_grade": 100,
    "is_visible": false,
    "created_at": "2024-01-15T10:30:00Z"
  }
}
```

---

### 2. جلب امتحانات الكورس (محدث)

**Endpoint:** `GET /api/course/:courseId/course-exams`

**الصلاحيات:** `teacher`, `student`, `admin`

**السلوك:**
- **للطلاب:** يعرض فقط الامتحانات المرئية (`is_visible = true`)
- **للمدرسين/الأدمن:** يعرض جميع الامتحانات

**Response للطلاب:**
```json
{
  "exams": [
    {
      "id": 1,
      "title": "امتحان نهاية الكورس",
      "questions_count": 20,
      "duration": 60,
      "total_grade": 100,
      "is_visible": true,
      "created_at": "2024-01-15T10:30:00Z"
    }
  ]
}
```

---

### 3. تغيير حالة ظهور الامتحان (جديد)

**Endpoint:** `PATCH /api/course/course-exam/:examId/visibility`

**الصلاحيات:** `teacher` فقط

**Request Body:**
```json
{
  "is_visible": true
}
```

**Response (200):**
```json
{
  "message": "تم إظهار الامتحان للطلاب",
  "exam": {
    "id": 1,
    "title": "امتحان نهاية الكورس",
    "is_visible": true
  }
}
```

---

### 4. تعديل امتحان شامل (محدث)

**Endpoint:** `PATCH /api/course/course-exam/:examId`

**الصلاحيات:** `teacher` فقط

**Request Body (form-data):**
```json
{
  "title": "امتحان نهاية الكورس - محدث",
  "is_visible": true  // يمكن تعديل حالة الظهور
}
```

---

## 💻 أمثلة JavaScript

### إنشاء امتحان مخفي
```javascript
const createHiddenExam = async (courseId, examData) => {
  const formData = new FormData();
  formData.append('title', examData.title);
  formData.append('questions_count', examData.questions_count);
  formData.append('duration', examData.duration);
  formData.append('total_grade', examData.total_grade);
  formData.append('is_visible', 'false'); // مخفي افتراضياً
  
  const response = await fetch(`/api/course/${courseId}/course-exam`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`
    },
    body: formData
  });
  
  return await response.json();
};
```

### إظهار امتحان للطلاب
```javascript
const showExamToStudents = async (examId) => {
  const response = await fetch(`/api/course/course-exam/${examId}/visibility`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ is_visible: true })
  });
  
  return await response.json();
};
```

### إخفاء امتحان عن الطلاب
```javascript
const hideExamFromStudents = async (examId) => {
  const response = await fetch(`/api/course/course-exam/${examId}/visibility`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ is_visible: false })
  });
  
  return await response.json();
};
```

### جلب الامتحانات (للطلاب)
```javascript
const getVisibleExams = async (courseId) => {
  const response = await fetch(`/api/course/${courseId}/course-exams`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  
  const data = await response.json();
  // الطلاب سيرون فقط الامتحانات المرئية
  return data.exams;
};
```

---

## 🔄 سير العمل المقترح

### للمدرس:
1. **إنشاء امتحان** - الامتحان مخفي افتراضياً
2. **إضافة الأسئلة** - تحضير الامتحان
3. **اختبار الامتحان** - التأكد من صحة الأسئلة
4. **إظهار الامتحان** - جعله مرئي للطلاب
5. **متابعة النتائج** - مراقبة أداء الطلاب

### للطالب:
1. **رؤية الامتحانات المرئية فقط** - لا يرى الامتحانات المخفية
2. **حل الامتحانات المتاحة** - فقط الامتحانات المصرح بها
3. **متابعة النتائج** - رؤية الدرجات

---

## ⚠️ ملاحظات مهمة

1. **الامتحانات مخفية افتراضياً** - عند إنشاء امتحان جديد
2. **الطلاب لا يرون الامتحانات المخفية** - حتى لو عرفوا الـ ID
3. **المدرسين يرون جميع الامتحانات** - مع حالة الظهور
4. **يمكن تغيير الحالة في أي وقت** - إظهار أو إخفاء
5. **الامتحانات المخفية لا تظهر في الإحصائيات** - للطلاب

---

## 🛠️ Migration

تم إضافة حقل `is_visible` لجدول `course_exams`:

```sql
ALTER TABLE course_exams ADD COLUMN IF NOT EXISTS is_visible BOOLEAN DEFAULT FALSE;
```

---

## 📊 مثال واجهة المستخدم

### للمدرس:
```
📝 الامتحانات الشاملة
├── ✅ امتحان نهاية الكورس (مرئي)
├── 🔒 امتحان تجريبي (مخفي)
└── ✅ امتحان الوحدة الأولى (مرئي)

[إظهار] [إخفاء] [تعديل] [حذف]
```

### للطالب:
```
📝 الامتحانات المتاحة
├── ✅ امتحان نهاية الكورس
└── ✅ امتحان الوحدة الأولى

[حل الامتحان] [عرض النتيجة]
```

هذه الميزة تضمن أن الطلاب لا يرون الامتحانات إلا عندما يكون المدرس جاهزاً لإظهارها! 🎯 