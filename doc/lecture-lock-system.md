# نظام قفل المحاضرات

## نظرة عامة

نظام يتحكم في فتح وإغلاق المحاضرات بناءً على نجاح الطالب في الامتحانات السابقة. المحاضرة التالية تبقى مقفلة حتى ينجح الطالب في الامتحان السابق، ولكن فقط إذا كان الامتحان ظاهر (visible).

**ملاحظة مهمة:** هذا النظام يعمل مع الجداول القديمة (`lectures` و `exams`) وليس الجداول الجديدة.

## المنطق

1. **المحاضرة الأولى:** مفتوحة دائماً للطلاب
2. **المحاضرات التالية:** 
   - إذا كان الامتحان السابق **ظاهر** → يجب نجاح الطالب في الامتحان
   - إذا كان الامتحان السابق **غير ظاهر** → المحاضرة مفتوحة تلقائياً

## مثال توضيحي

```
المحاضرة الأولى: مفتوحة دائماً ✅
├── امتحان المحاضرة الأولى (مخفي) → المحاضرة الثانية: مفتوحة ✅
└── امتحان المحاضرة الأولى (ظاهر) → المحاضرة الثانية: مقفلة حتى النجاح 🔒

المحاضرة الثانية: 
├── امتحان المحاضرة الثانية (مخفي) → المحاضرة الثالثة: مفتوحة ✅
└── امتحان المحاضرة الثانية (ظاهر) → المحاضرة الثالثة: مقفلة حتى النجاح 🔒
```

## API

### 1. جلب محاضرات الكورس مع منطق القفل (للطلاب) - الجداول القديمة

**Endpoint:** `GET /api/course-content/old-courses/:courseId/lectures/student`

**الصلاحيات:** `student` فقط

**Headers:**
```
Authorization: Bearer <token>
```

**Response (200):**
```json
{
  "lectures": [
    {
      "id": 1,
      "course_id": 5,
      "title": "المحاضرة الأولى",
      "description": "مقدمة في الموضوع",
      "order_index": 1,
      "is_unlocked": true
    },
    {
      "id": 2,
      "course_id": 5,
      "title": "المحاضرة الثانية",
      "description": "الموضوع الأساسي",
      "order_index": 2,
      "is_unlocked": false
    },
    {
      "id": 3,
      "course_id": 5,
      "title": "المحاضرة الثالثة",
      "description": "تطبيقات عملية",
      "order_index": 3,
      "is_unlocked": true
    }
  ]
}
```

### 2. تغيير حالة ظهور الامتحان (للمدرسين) - الجداول القديمة

**Endpoint:** `PATCH /api/course-content/old-exams/:examId/visibility`

**الصلاحيات:** `teacher` أو `admin`

**Headers:**
```
Authorization: Bearer <token>
Content-Type: application/json
```

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
    "lecture_id": 5,
    "title": "امتحان المحاضرة الأولى",
    "is_visible": true,
    "created_at": "2024-01-15T10:30:00Z"
  }
}
```

### 3. إنشاء امتحان جديد مع حالة الظهور

**Endpoint:** `POST /api/course-content/exams`

**الصلاحيات:** `teacher` أو `admin`

**Headers:**
```
Authorization: Bearer <token>
Content-Type: application/json
```

**Request Body:**
```json
{
  "course_id": 5,
  "title": "امتحان المحاضرة الأولى",
  "description": "امتحان شامل للمحاضرة الأولى",
  "total_questions": 10,
  "total_grade": 100,
  "duration_minutes": 60,
  "passing_grade": 60,
  "is_comprehensive": false,
  "is_visible": false
}
```

**Response (201):**
```json
{
  "message": "تم إنشاء الامتحان بنجاح",
  "exam": {
    "id": 1,
    "course_id": 5,
    "title": "امتحان المحاضرة الأولى",
    "is_visible": false,
    "created_at": "2024-01-15T10:30:00Z"
  }
}
```

---

## 💻 مثال JavaScript

```javascript
// جلب محاضرات الكورس مع منطق القفل (للجداول القديمة)
const getLecturesWithLock = async (courseId) => {
  try {
    const response = await fetch(`/api/course-content/old-courses/${courseId}/lectures/student`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    return data.lectures;
  } catch (error) {
    console.error('خطأ في جلب المحاضرات:', error);
    throw error;
  }
};

// تغيير حالة ظهور الامتحان (للجداول القديمة)
const toggleExamVisibility = async (examId, isVisible) => {
  try {
    const response = await fetch(`/api/course-content/old-exams/${examId}/visibility`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ is_visible: isVisible })
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('خطأ في تغيير حالة الامتحان:', error);
    throw error;
  }
};

// استخدام
getLecturesWithLock(5).then(lectures => {
  lectures.forEach(lecture => {
    if (lecture.is_unlocked) {
      console.log(`✅ ${lecture.title} - مفتوحة`);
    } else {
      console.log(`🔒 ${lecture.title} - مقفلة`);
    }
  });
});
```

---

## 📱 مثال React

```jsx
import React, { useState, useEffect } from 'react';

const CourseLectures = ({ courseId }) => {
  const [lectures, setLectures] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchLectures = async () => {
      try {
        const response = await fetch(`/api/course-content/old-courses/${courseId}/lectures/student`, {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`
          }
        });
        
        if (!response.ok) throw new Error('فشل في جلب المحاضرات');
        
        const data = await response.json();
        setLectures(data.lectures);
      } catch (error) {
        console.error('خطأ:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchLectures();
  }, [courseId]);

  if (loading) return <div>جاري التحميل...</div>;

  return (
    <div className="lectures-container">
      <h2>محاضرات الكورس</h2>
      
      {lectures.map((lecture, index) => (
        <div 
          key={lecture.id} 
          className={`lecture-card ${lecture.is_unlocked ? 'unlocked' : 'locked'}`}
        >
          <div className="lecture-header">
            <h3>{lecture.title}</h3>
            <span className={`status ${lecture.is_unlocked ? 'unlocked' : 'locked'}`}>
              {lecture.is_unlocked ? '🔓 مفتوحة' : '🔒 مقفلة'}
            </span>
          </div>
          
          <p>{lecture.description}</p>
          
          {lecture.is_unlocked ? (
            <button className="btn-primary">
              مشاهدة المحاضرة
            </button>
          ) : (
            <div className="lock-message">
              <p>يجب النجاح في الامتحان السابق لفتح هذه المحاضرة</p>
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

export default CourseLectures;
```

---

## 🎯 مثال للمدرسين

```jsx
const ExamVisibilityToggle = ({ examId, isVisible, onToggle }) => {
  const [loading, setLoading] = useState(false);

  const handleToggle = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/course-content/old-exams/${examId}/visibility`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ is_visible: !isVisible })
      });
      
      if (!response.ok) throw new Error('فشل في تغيير الحالة');
      
      onToggle(!isVisible);
    } catch (error) {
      console.error('خطأ:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="exam-visibility">
      <label className="toggle-switch">
        <input
          type="checkbox"
          checked={isVisible}
          onChange={handleToggle}
          disabled={loading}
        />
        <span className="slider"></span>
      </label>
      <span className="status-text">
        {isVisible ? 'ظاهر للطلاب' : 'مخفي عن الطلاب'}
      </span>
    </div>
  );
};
```

---

## ⚠️ الأخطاء المحتملة

### 403 - غير مصرح:
```json
{
  "error": "لا يمكنك تعديل امتحان لكورس مدرس آخر"
}
```

### 404 - الامتحان غير موجود:
```json
{
  "error": "الامتحان غير موجود"
}
```

### 400 - بيانات غير صحيحة:
```json
{
  "error": "is_visible يجب أن يكون boolean"
}
```

---

## 🔧 ملاحظات تقنية

1. **المنطق:** المحاضرة الأولى مفتوحة دائماً
2. **التحقق:** يتم التحقق من نجاح الطالب في الامتحان السابق فقط إذا كان ظاهر
3. **الأداء:** يستخدم queries محسنة مع JOIN
4. **الأمان:** يتحقق من ملكية الكورس للمدرسين
5. **المرونة:** يمكن للمدرسين التحكم في ظهور الامتحانات

---

## 📋 حالات الاستخدام

### للمدرسين:
- إنشاء امتحان مخفي افتراضياً
- إظهار الامتحان عندما يكون جاهزاً
- إخفاء الامتحان إذا كان يحتاج تعديل

### للطلاب:
- رؤية المحاضرات المفتوحة والمقفلة
- فهم سبب قفل المحاضرة
- التركيز على الامتحانات المطلوبة

هذا النظام يوفر تحكماً دقيقاً في تقدم الطلاب! 🎓🔒 