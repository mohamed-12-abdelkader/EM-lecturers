# API إضافة درجات الطلاب - دليل شامل

## نظرة عامة
هذا الدليل يشرح كيفية استخدام API إضافة درجات الطلاب في نظام إدارة السنتر. يتيح هذا النظام للمدرسين إضافة وتحديث درجات الطلاب في امتحانات المجموعات الدراسية.

## الطرق المتاحة لإضافة الدرجات

### 1. الطريقة التقليدية (تتطلب امتحان موجود)
- تتطلب وجود امتحان فعلي في قاعدة البيانات
- تستخدم `exam_name` للبحث عن الامتحان
- مناسبة للامتحانات الرسمية

### 2. الطريقة المباشرة (جديدة - لا تتطلب امتحان موجود)
- تسمح بإضافة درجات مباشرة للطلاب
- تستخدم `group_id` لتحديد المجموعة
- تنشئ امتحان وهمي تلقائياً إذا لم يكن موجوداً
- مناسبة لإضافة ملاحظات وإحصائيات للطلاب

## المتطلبات الأساسية

### 1. المصادقة (Authentication)
- يجب أن يكون المستخدم مسجل دخول
- يجب أن يكون لديه صلاحية `teacher` أو `admin`
- يتم إرسال التوكن في header: `Authorization: Bearer <token>`

### 2. البيانات المطلوبة
- `exam_name`: اسم الامتحان (نص)
- `student_id`: معرف الطالب (رقم)
- `grade`: الدرجة (رقم عشري)
- `notes`: ملاحظات (اختياري، نص)

## نقاط النهاية (Endpoints)

### 1. إضافة درجة طالب واحد (الطريقة التقليدية)

#### الطلب
```http
POST /api/student-grades/
Content-Type: application/json
Authorization: Bearer <your-token>

{
  "exam_name": "امتحان الوحدة الأولى",
  "student_id": 123,
  "grade": 85.5,
  "notes": "أداء ممتاز في الجزء النظري"
}
```

#### الاستجابة الناجحة (201)
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

#### الأخطاء المحتملة

**400 - بيانات مطلوبة**
```json
{
  "error": "بيانات مطلوبة",
  "message": "اسم الامتحان ومعرف الطالب والدرجة مطلوبان"
}
```

**404 - طالب غير موجود**
```json
{
  "error": "طالب غير موجود",
  "message": "الطالب برقم 123 غير موجود في النظام"
}
```

**400 - دور خاطئ**
```json
{
  "error": "دور خاطئ",
  "message": "المستخدم برقم 123 ليس طالب (الدور: teacher)"
}
```

**404 - امتحان غير موجود**
```json
{
  "error": "امتحان غير موجود",
  "message": "لا يوجد امتحان باسم \"امتحان الوحدة الأولى\" في مجموعاتك"
}
```

**400 - طالب غير موجود في المجموعة**
```json
{
  "error": "طالب غير موجود في المجموعة",
  "message": "الطالب أحمد محمد (ID: 123) غير موجود في المجموعة \"مجموعة الرياضيات\". الطلاب الموجودون في المجموعة: سارة أحمد (ID: 124), محمد علي (ID: 125)"
}
```

**400 - درجة غير صحيحة**
```json
{
  "error": "درجة غير صحيحة",
  "message": "الدرجة لا يمكن أن تتجاوز 100"
}
```

### 2. إضافة درجة طالب واحد (الطريقة المباشرة - الجديدة)

#### الطلب
```http
POST /api/student-grades/direct
Content-Type: application/json
Authorization: Bearer <your-token>

{
  "group_id": 5,
  "student_id": 123,
  "exam_name": "ملاحظة أداء الطالب",
  "grade": 85.5,
  "notes": "أداء ممتاز في المشاركة",
  "total_grade": 100
}
```

#### الاستجابة الناجحة (201)
```json
{
  "message": "تم إضافة الدرجة بنجاح",
  "grade": {
    "id": 1,
    "exam_name": "ملاحظة أداء الطالب",
    "group_name": "مجموعة الرياضيات",
    "student_name": "أحمد محمد",
    "student_id": 123,
    "grade": 85.5,
    "total_grade": 100,
    "notes": "أداء ممتاز في المشاركة",
    "created_at": "2024-01-15T10:30:00Z",
    "updated_at": "2024-01-15T10:30:00Z"
  }
}
```

#### الأخطاء المحتملة

**400 - بيانات مطلوبة**
```json
{
  "error": "بيانات مطلوبة",
  "message": "معرف المجموعة ومعرف الطالب واسم الامتحان والدرجة مطلوبان"
}
```

**404 - مجموعة غير موجودة**
```json
{
  "error": "مجموعة غير موجودة",
  "message": "المجموعة برقم 5 غير موجودة في النظام"
}
```

**403 - غير مصرح**
```json
{
  "error": "غير مصرح",
  "message": "لا يمكنك إضافة درجات لمجموعة مدرس آخر"
}
```

### 3. إضافة درجات متعددة مباشرة (الطريقة المباشرة - الجديدة)

#### الطلب
```http
POST /api/student-grades/direct/bulk
Content-Type: application/json
Authorization: Bearer <your-token>

{
  "group_id": 5,
  "exam_name": "تقييم أداء الطلاب",
  "total_grade": 100,
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

#### الاستجابة الناجحة (201)
```json
{
  "message": "تم معالجة 3 درجة",
  "exam": {
    "name": "تقييم أداء الطلاب",
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
    },
    {
      "index": 1,
      "student_id": 124,
      "student_name": "سارة أحمد",
      "grade": 92.0,
      "notes": "أداء رائع",
      "status": "success"
    },
    {
      "index": 2,
      "student_id": 125,
      "student_name": "محمد علي",
      "grade": 78.5,
      "notes": "أداء جيد",
      "status": "success"
    }
  ],
  "errors": []
}
```

### 4. جلب درجات طالب في مجموعة معينة (جديد)

#### الطلب
```http
GET /api/student-grades/group/5/student/123
Authorization: Bearer <your-token>
```

#### الاستجابة الناجحة (200)
```json
{
  "group": {
    "id": 5,
    "name": "مجموعة الرياضيات"
  },
  "student": {
    "id": 123,
    "name": "أحمد محمد"
  },
  "grades": [
    {
      "id": 1,
      "grade": 85.5,
      "notes": "أداء ممتاز في المشاركة",
      "created_at": "2024-01-15T10:30:00Z",
      "updated_at": "2024-01-15T10:30:00Z",
      "exam_name": "ملاحظة أداء الطالب",
      "total_grade": 100,
      "exam_date": "2024-01-15T10:30:00Z"
    }
  ],
  "total_exams": 1,
  "average_grade": 85.5
}
```

### 5. إضافة درجات متعددة دفعة واحدة (الطريقة التقليدية)

#### الطلب
```http
POST /api/student-grades/bulk
Content-Type: application/json
Authorization: Bearer <your-token>

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

#### الاستجابة الناجحة (201)
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
    },
    {
      "index": 1,
      "student_id": 124,
      "student_name": "سارة أحمد",
      "grade": 92.0,
      "notes": "أداء رائع",
      "status": "success"
    },
    {
      "index": 2,
      "student_id": 125,
      "student_name": "محمد علي",
      "grade": 78.5,
      "notes": "أداء جيد",
      "status": "success"
    }
  ],
  "errors": []
}
```

#### الاستجابة مع أخطاء
```json
{
  "message": "تم معالجة 3 درجة",
  "exam": {
    "name": "امتحان الوحدة الأولى",
    "group_name": "مجموعة الرياضيات",
    "total_grade": 100
  },
  "success_count": 2,
  "error_count": 1,
  "results": [
    {
      "index": 0,
      "student_id": 123,
      "student_name": "أحمد محمد",
      "grade": 85.5,
      "notes": "أداء ممتاز",
      "status": "success"
    },
    {
      "index": 2,
      "student_id": 125,
      "student_name": "محمد علي",
      "grade": 78.5,
      "notes": "أداء جيد",
      "status": "success"
    }
  ],
  "errors": [
    {
      "index": 1,
      "student_id": 999,
      "error": "طالب غير موجود",
      "message": "الطالب برقم 999 غير موجود في النظام"
    }
  ]
}
```

## مقارنة بين الطريقتين

### الطريقة التقليدية
- **المميزات:**
  - مناسبة للامتحانات الرسمية
  - تحقق من وجود الامتحان مسبقاً
  - تتبع دقيق للامتحانات

- **العيوب:**
  - تتطلب إنشاء امتحان مسبقاً
  - لا تسمح بإضافة ملاحظات سريعة
  - معقدة للاستخدام البسيط

### الطريقة المباشرة (الجديدة)
- **المميزات:**
  - سهلة الاستخدام
  - لا تتطلب امتحان مسبق
  - مناسبة للملاحظات والإحصائيات
  - تنشئ امتحان وهمي تلقائياً

- **العيوب:**
  - قد تخلق امتحانات وهمية كثيرة
  - أقل تنظيماً من الطريقة التقليدية

## أمثلة عملية

### مثال 1: إضافة درجة طالب واحد باستخدام الطريقة المباشرة (JavaScript)

```javascript
// الطريقة المباشرة (الجديدة)
const addStudentGradeDirect = async (groupId, studentId, examName, grade, notes = '', totalGrade = 100) => {
  try {
    const response = await fetch('/api/student-grades/direct', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('token')}`
      },
      body: JSON.stringify({
        group_id: groupId,
        student_id: studentId,
        exam_name: examName,
        grade: grade,
        notes: notes,
        total_grade: totalGrade
      })
    });

    const data = await response.json();

    if (response.ok) {
      console.log('تم إضافة الدرجة بنجاح:', data);
      return data;
    } else {
      console.error('خطأ في إضافة الدرجة:', data);
      throw new Error(data.message);
    }
  } catch (error) {
    console.error('خطأ في الاتصال:', error);
    throw error;
  }
};

// استخدام المثال
addStudentGradeDirect(5, 123, 'ملاحظة أداء الطالب', 85.5, 'أداء ممتاز في المشاركة', 100)
  .then(result => console.log('النتيجة:', result))
  .catch(error => console.error('الخطأ:', error));
```

### مثال 2: إضافة درجات متعددة باستخدام الطريقة المباشرة (Python)

```python
import requests
import json

def add_bulk_grades_direct(group_id, exam_name, grades, token, total_grade=100):
    url = "http://localhost:8000/api/student-grades/direct/bulk"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {token}"
    }
    
    data = {
        "group_id": group_id,
        "exam_name": exam_name,
        "total_grade": total_grade,
        "grades": grades
    }
    
    try:
        response = requests.post(url, headers=headers, json=data)
        response.raise_for_status()
        return response.json()
    except requests.exceptions.RequestException as e:
        print(f"خطأ في الطلب: {e}")
        return None

# مثال على الاستخدام
grades = [
    {"student_id": 123, "grade": 85.5, "notes": "أداء ممتاز"},
    {"student_id": 124, "grade": 92.0, "notes": "أداء رائع"},
    {"student_id": 125, "grade": 78.5, "notes": "أداء جيد"}
]

result = add_bulk_grades_direct(5, "تقييم أداء الطلاب", grades, "your-token-here", 100)
if result:
    print(f"تم معالجة {result['success_count']} درجة بنجاح")
    print(f"عدد الأخطاء: {result['error_count']}")
```

### مثال 3: إضافة درجات باستخدام cURL (الطريقة المباشرة)

```bash
# إضافة درجة واحدة مباشرة
curl -X POST http://localhost:8000/api/student-grades/direct \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-token-here" \
  -d '{
    "group_id": 5,
    "student_id": 123,
    "exam_name": "ملاحظة أداء الطالب",
    "grade": 85.5,
    "notes": "أداء ممتاز في المشاركة",
    "total_grade": 100
  }'

# إضافة درجات متعددة مباشرة
curl -X POST http://localhost:8000/api/student-grades/direct/bulk \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-token-here" \
  -d '{
    "group_id": 5,
    "exam_name": "تقييم أداء الطلاب",
    "total_grade": 100,
    "grades": [
      {"student_id": 123, "grade": 85.5, "notes": "أداء ممتاز"},
      {"student_id": 124, "grade": 92.0, "notes": "أداء رائع"}
    ]
  }'

# جلب درجات طالب في مجموعة معينة
curl -X GET http://localhost:8000/api/student-grades/group/5/student/123 \
  -H "Authorization: Bearer your-token-here"
```

## قواعد التحقق من البيانات

### 1. التحقق من اسم الامتحان
- يجب أن يكون الامتحان موجود في مجموعات المدرس
- يجب أن يكون المدرس مالك المجموعة

### 2. التحقق من معرف الطالب
- يجب أن يكون الطالب موجود في النظام
- يجب أن يكون دور المستخدم `student`
- يجب أن يكون الطالب مسجل في المجموعة

### 3. التحقق من الدرجة
- يجب أن تكون الدرجة رقم صحيح أو عشري
- يجب أن تكون الدرجة أكبر من أو تساوي 0
- يجب أن تكون الدرجة أقل من أو تساوي الدرجة الكلية للامتحان

### 4. التحقق من الملاحظات
- الملاحظات اختيارية
- إذا تم إرسالها، يجب أن تكون نص

## نصائح للاستخدام

### 1. إضافة درجات متعددة
- استخدم `/bulk` endpoint لإضافة درجات متعددة دفعة واحدة
- هذا يوفر الوقت ويقلل عدد الطلبات للخادم
- يتم معالجة كل درجة بشكل منفصل، فإذا فشلت إحداها، تستمر المعالجة

### 2. التعامل مع الأخطاء
- تحقق من `error_count` في الاستجابة
- راجع قائمة `errors` لمعرفة الأخطاء التفصيلية
- استخدم `index` لتحديد موضع الخطأ في القائمة الأصلية

### 3. تحديث الدرجات
- إذا كانت الدرجة موجودة مسبقاً، سيتم تحديثها تلقائياً
- لا حاجة لاستخدام endpoint منفصل للتحديث

### 4. الأداء
- استخدم `/bulk` endpoint بدلاً من إرسال طلبات متعددة
- تجمع الدرجات حسب الامتحان قبل الإرسال

## استكشاف الأخطاء

### مشاكل شائعة وحلولها

#### 1. خطأ "امتحان غير موجود"
- تأكد من أن اسم الامتحان صحيح
- تأكد من أن الامتحان يخص مجموعات المدرس

#### 2. خطأ "طالب غير موجود في المجموعة"
- تأكد من أن الطالب مسجل في المجموعة
- استخدم `/group/:groupId/students` لرؤية قائمة الطلاب

#### 3. خطأ "درجة غير صحيحة"
- تأكد من أن الدرجة لا تتجاوز الدرجة الكلية
- تأكد من أن الدرجة موجبة

#### 4. خطأ "غير مصرح"
- تأكد من صحة التوكن
- تأكد من أن المستخدم لديه صلاحيات مدرس أو مدير

## الدعم والمساعدة

إذا واجهت أي مشاكل أو لديك أسئلة حول استخدام API، يرجى:
1. مراجعة هذا الدليل أولاً
2. التحقق من رسائل الخطأ التفصيلية
3. التأكد من صحة البيانات المرسلة
4. التواصل مع فريق التطوير للحصول على المساعدة
