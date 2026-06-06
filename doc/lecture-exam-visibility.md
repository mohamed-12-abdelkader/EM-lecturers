# نظام إظهار/إخفاء امتحانات المحاضرات

## نظرة عامة

تم تحديث نظام امتحانات المحاضرات ليكون **مخفي افتراضياً** عند الإنشاء، ويتم إظهاره أو إخفاؤه من قبل المدرس حسب الحاجة.

## التغييرات الرئيسية

### 1. إضافة عمود `is_visible` لجدول `exams`

تم إضافة عمود `is_visible` لجدول `exams` مع القيمة الافتراضية `false`:

```sql
ALTER TABLE exams ADD COLUMN IF NOT EXISTS is_visible BOOLEAN DEFAULT FALSE;
```

### 2. إنشاء امتحان محاضرة (مخفي افتراضياً)

**Endpoint:** `POST /api/course/lecture/:lectureId/exam`

**الصلاحيات:** `teacher` فقط

**Request Body:**
```json
{
  "title": "امتحان المحاضرة الأولى",
  "total_grade": 50,
  "is_visible": false  // اختياري، افتراضي: false
}
```

**ملاحظات:**
- `is_visible` اختياري، إذا لم يُرسل سيكون `false` افتراضياً
- يمكن إرسال `is_visible: true` لإنشاء امتحان ظاهر مباشرة

**Response:**
```json
{
  "exam": {
    "id": 1,
    "lecture_id": 12,
    "type": "exam",
    "total_grade": 50,
    "created_by": 1,
    "title": "امتحان المحاضرة الأولى",
    "is_visible": false,
    "created_at": "2024-01-15T10:30:00.000Z"
  }
}
```

### 3. تغيير حالة ظهور امتحان المحاضرة

**Endpoint:** `PATCH /api/course/lecture/exam/:examId/visibility`

**الصلاحيات:** `teacher` فقط

**Request Body:**
```json
{
  "is_visible": true  // أو false
}
```

**Response:**
```json
{
  "message": "تم إظهار الامتحان للطلاب",
  "exam": {
    "id": 1,
    "lecture_id": 12,
    "type": "exam",
    "total_grade": 50,
    "created_by": 1,
    "title": "امتحان المحاضرة الأولى",
    "is_visible": true,
    "created_at": "2024-01-15T10:30:00.000Z"
  }
}
```

### 4. جلب امتحان محاضرة (مع مراعاة حالة الظهور)

**Endpoint:** `GET /api/course/lecture/:lectureId/exam`

**الصلاحيات:** `teacher`, `student`

**السلوك:**
- **المدرس:** يرى الامتحان حتى لو كان مخفي (`is_visible = false`)
- **الطالب:** يرى الامتحان فقط إذا كان ظاهر (`is_visible = true`)

**Response للمدرس:**
```json
{
  "exam": {
    "id": 1,
    "lecture_id": 12,
    "type": "exam",
    "total_grade": 50,
    "created_by": 1,
    "title": "امتحان المحاضرة الأولى",
    "is_visible": false,
    "created_at": "2024-01-15T10:30:00.000Z"
  }
}
```

**Response للطالب (إذا كان الامتحان ظاهر):**
```json
{
  "exam": {
    "id": 1,
    "lecture_id": 12,
    "type": "exam",
    "total_grade": 50,
    "created_by": 1,
    "title": "امتحان المحاضرة الأولى",
    "is_visible": true,
    "created_at": "2024-01-15T10:30:00.000Z"
  }
}
```

**Response للطالب (إذا كان الامتحان مخفي):**
```json
{
  "message": "Exam not found or not visible"
}
```

### 5. عرض المحاضرات مع الامتحانات

**Endpoint:** `GET /api/course/:courseId/details`

**السلوك المحدث:**
- **المدرس:** يرى جميع المحاضرات والامتحانات (حتى المخفية)
- **الطالب:** يرى فقط المحاضرات الظاهرة والامتحانات الظاهرة

## أمثلة JavaScript

### إنشاء امتحان مخفي
```javascript
const createHiddenExam = async (lectureId) => {
  const response = await fetch(`/api/course/lecture/${lectureId}/exam`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      title: "امتحان المحاضرة الأولى",
      total_grade: 50
      // is_visible سيصبح false افتراضياً
    })
  });
  
  return await response.json();
};
```

### إنشاء امتحان ظاهر مباشرة
```javascript
const createVisibleExam = async (lectureId) => {
  const response = await fetch(`/api/course/lecture/${lectureId}/exam`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      title: "امتحان المحاضرة الأولى",
      total_grade: 50,
      is_visible: true
    })
  });
  
  return await response.json();
};
```

### إظهار امتحان مخفي
```javascript
const showExam = async (examId) => {
  const response = await fetch(`/api/course/lecture/exam/${examId}/visibility`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      is_visible: true
    })
  });
  
  return await response.json();
};
```

### إخفاء امتحان ظاهر
```javascript
const hideExam = async (examId) => {
  const response = await fetch(`/api/course/lecture/exam/${examId}/visibility`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      is_visible: false
    })
  });
  
  return await response.json();
};
```

## Migration

تم إنشاء migration جديد لإضافة عمود `is_visible`:

```sql
-- Up Migration
ALTER TABLE exams ADD COLUMN IF NOT EXISTS is_visible BOOLEAN DEFAULT FALSE;
UPDATE exams SET is_visible = FALSE WHERE is_visible IS NULL;

-- Down Migration
ALTER TABLE exams DROP COLUMN IF EXISTS is_visible;
```

## الفوائد

1. **التحكم الكامل:** المدرس يتحكم في متى يظهر الامتحان للطلاب
2. **الأمان:** الامتحانات لا تظهر للطلاب إلا بعد أن يكون المدرس جاهزاً
3. **المرونة:** يمكن إنشاء امتحان ظاهر مباشرة إذا لزم الأمر
4. **الوضوح:** حالة الامتحان واضحة في جميع الـ responses

## ملاحظات مهمة

- جميع الامتحانات الموجودة ستصبح مخفية افتراضياً بعد تطبيق الـ migration
- المدرسون يمكنهم رؤية جميع الامتحانات (حتى المخفية) لإدارة المحتوى
- الطلاب يرون فقط الامتحانات الظاهرة (`is_visible = true`)
- يمكن تغيير حالة الامتحان في أي وقت من قبل المدرس 