# API المجموعات الدراسية

## نظرة عامة

هذا API يتيح للمدرسين إنشاء وإدارة المجموعات الدراسية. كل مجموعة تحتوي على اسم، وقت البداية والنهاية، وأيام المجموعة.

## الجداول

### جدول `study_groups`
```sql
CREATE TABLE study_groups (
    id SERIAL PRIMARY KEY,
    teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    days TEXT NOT NULL,
    grade_id INTEGER REFERENCES grades(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

### جدول `group_students`
```sql
CREATE TABLE group_students (
    id SERIAL PRIMARY KEY,
    group_id INTEGER NOT NULL REFERENCES study_groups(id) ON DELETE CASCADE,
    student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(group_id, student_id)
);
```

## النقاط النهائية (Endpoints)

### 1. إنشاء مجموعة دراسية جديدة

**POST** `/api/study-groups`

**الصلاحيات المطلوبة:** `admin` أو `teacher`

**البيانات المطلوبة:**
```json
{
  "name": "مجموعة الرياضيات المتقدمة",
  "start_time": "14:00",
  "end_time": "16:00",
  "days": "السبت,الثلاثاء",
  "grade_id": 1
}
```

**الاستجابة:**
```json
{
  "message": "تم إنشاء المجموعة بنجاح",
  "group": {
    "id": 1,
    "teacher_id": 5,
    "name": "مجموعة الرياضيات المتقدمة",
    "start_time": "14:00:00",
    "end_time": "16:00:00",
    "days": "السبت,الثلاثاء",
    "grade_id": 1,
    "grade_name": "الصف الأول",
    "created_at": "2024-01-15T10:30:00Z", 
    "updated_at": "2024-01-15T10:30:00Z"
  }
}
```

### 2. تحديث مجموعة دراسية

**PUT** `/api/study-groups/:id`

**الصلاحيات المطلوبة:** `admin` أو `teacher` (مالك المجموعة فقط)

**البيانات المطلوبة:**
```json
{
  "name": "مجموعة الرياضيات المتقدمة - المستوى الثاني",
  "start_time": "15:00",
  "end_time": "17:00",
  "days": "الأحد,الأربعاء",
  "grade_id": 2
}
```

**الاستجابة:**
```json
{
  "message": "تم تحديث المجموعة بنجاح",
  "group": {
    "id": 1,
    "teacher_id": 5,
    "name": "مجموعة الرياضيات المتقدمة - المستوى الثاني",
    "start_time": "15:00:00",
    "end_time": "17:00:00",
    "days": "الأحد,الأربعاء",
    "grade_id": 2,
    "grade_name": "الصف الثاني",
    "created_at": "2024-01-15T10:30:00Z",
    "updated_at": "2024-01-15T11:00:00Z"
  }
}
```

### 3. حذف مجموعة دراسية

**DELETE** `/api/study-groups/:id`

**الصلاحيات المطلوبة:** `admin` أو `teacher` (مالك المجموعة فقط)

**الاستجابة:**
```json
{
  "message": "تم حذف المجموعة بنجاح"
}
```

### 4. جلب مجموعة بواسطة ID

**GET** `/api/study-groups/:id`

**الصلاحيات المطلوبة:** لا توجد

**الاستجابة:**
```json
{
  "group": {
    "id": 1,
    "teacher_id": 5,
    "name": "مجموعة الرياضيات المتقدمة",
    "start_time": "14:00:00",
    "end_time": "16:00:00",
    "days": "السبت,الثلاثاء",
    "created_at": "2024-01-15T10:30:00Z",
    "updated_at": "2024-01-15T10:30:00Z",
    "teacher_name": "أحمد محمد",
    "students_count": 12
  }
}
```

### 5. جلب جميع مجموعات المدرس

**GET** `/api/study-groups/teacher/my-groups`

**الصلاحيات المطلوبة:** `admin` أو `teacher`

**الاستجابة:**
```json
{
  "groups": [
    {
      "id": 1,
      "teacher_id": 5,
      "name": "مجموعة الرياضيات المتقدمة",
      "start_time": "14:00:00",
      "end_time": "16:00:00",
      "days": "السبت,الثلاثاء",
      "created_at": "2024-01-15T10:30:00Z",
      "updated_at": "2024-01-15T10:30:00Z",
      "students_count": 12
    },
    {
      "id": 2,
      "teacher_id": 5,
      "name": "مجموعة الفيزياء",
      "start_time": "16:00:00",
      "end_time": "18:00:00",
      "days": "الأحد,الأربعاء",
      "created_at": "2024-01-15T11:00:00Z",
      "updated_at": "2024-01-15T11:00:00Z",
      "students_count": 8
    }
  ]
}
```

### 6. جلب جميع المجموعات

**GET** `/api/study-groups/all`

**الصلاحيات المطلوبة:** لا توجد

**الاستجابة:**
```json
{
  "groups": [
    {
      "id": 1,
      "teacher_id": 5,
      "name": "مجموعة الرياضيات المتقدمة",
      "start_time": "14:00:00",
      "end_time": "16:00:00",
      "days": "السبت,الثلاثاء",
      "created_at": "2024-01-15T10:30:00Z",
      "updated_at": "2024-01-15T10:30:00Z",
      "teacher_name": "أحمد محمد",
      "students_count": 12
    }
  ]
}
```

### 7. إضافة طالب للمجموعة

**POST** `/api/study-groups/:groupId/students`

**الصلاحيات المطلوبة:** `admin` أو `teacher` (مالك المجموعة فقط)

يمكن الإضافة بأحد طريقتين:

1) إضافة طالب موجود:
```json
{
  "student_id": 15
}
```

2) إنشاء طالب جديد ببيانات بسيطة (الاسم مطلوب فقط):
```json
{
  "name": "طالب جديد",
  "phone": "01000000000",         // اختياري
  "parent_phone": "01111111111"   // اختياري
}
```

**الاستجابة:**
```json
{
  "message": "تم إضافة الطالب للمجموعة بنجاح",
  "student": {
    "id": 1,
    "group_id": 1,
    "student_id": 15,
    "joined_at": "2024-01-15T12:00:00Z"
  }
}
```

**ملاحظات:**
- إذا تم إرسال `phone` وكان هناك طالب بنفس الرقم، سيتم استخدامه بدل إنشاء طالب جديد.
- عند عدم إرسال `student_id`، يصبح `name` مطلوبًا، و`phone` و`parent_phone` اختياريان.

### 8. إزالة طالب من المجموعة

**DELETE** `/api/study-groups/:groupId/students/:studentId`

**الصلاحيات المطلوبة:** `admin` أو `teacher` (مالك المجموعة فقط)

**الاستجابة:**
```json
{
  "message": "تم إزالة الطالب من المجموعة بنجاح",
  "student": {
    "id": 1,
    "group_id": 2,
    "student_id": 4,
    "joined_at": "2025-07-26T14:31:52.293Z"
  }
}
```

### 9. تعديل بيانات الطالب في المجموعة

**PUT** `/api/study-groups/:groupId/students/:studentId`

**الصلاحيات المطلوبة:** `admin` أو `teacher` (مالك المجموعة فقط)

**البيانات المطلوبة:**
```json
{
  "name": "أحمد محمد محمود",
  "phone": "01234567890",
  "parent_phone": "09876543210",
  "payment_status": "paid",
  "payment_amount": 500.00
}
```

**الاستجابة:**
```json
{
  "message": "تم تحديث بيانات الطالب بنجاح",
  "student": {
    "id": 4,
    "name": "أحمد محمد محمود",
    "phone": "01234567890",
    "parent_phone": "09876543210",
    "payment_status": "paid",
    "payment_amount": 500.00,
    "payment_date": "2025-07-26T15:00:00Z"
  }
}
```

**ملاحظات:**
- يمكن تحديث أي من الحقول (اختياري)
- إذا تم تغيير `payment_status` إلى `"paid"`، سيتم تسجيل تاريخ الدفع تلقائياً
- إذا لم يتم إرسال أي بيانات للتحديث، سيظهر خطأ

### 10. جلب طلاب المجموعة

**GET** `/api/study-groups/:groupId/students`

**الصلاحيات المطلوبة:** لا توجد

**الاستجابة:**
```json
{
  "students": [
    {
      "id": 1,
      "group_id": 1,
      "student_id": 15,
      "joined_at": "2024-01-15T12:00:00Z",
      "student_name": "محمد أحمد",
      "student_email": "mohamed@example.com"
    },
    {
      "id": 2,
      "group_id": 1,
      "student_id": 16,
      "joined_at": "2024-01-15T12:30:00Z",
      "student_name": "فاطمة علي",
      "student_email": "fatima@example.com"
    }
  ]
}
```

## أمثلة JavaScript

### إنشاء مجموعة دراسية
```javascript
const createGroup = async () => {
  const response = await fetch('/api/study-groups', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      name: 'مجموعة الرياضيات المتقدمة',
      start_time: '14:00',
      end_time: '16:00',
      days: 'السبت,الثلاثاء',
      grade_id: 1
    })
  });
  
  const data = await response.json();
  console.log(data);
};
```

### 12.b جلب سجل الحضور والغياب لمدى زمني (أسبوع/شهر/مُخصّص)

**GET** `/api/study-groups/:groupId/attendance-range?period=week|month` أو `?days=14` أو `?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD`

**الصلاحيات المطلوبة:** `admin` أو `teacher` (مالك المجموعة فقط)

**أمثلة:**
- آخر أسبوع: `/api/study-groups/10/attendance-range?period=week`
- آخر شهر: `/api/study-groups/10/attendance-range?period=month`
- آخر 14 يوم: `/api/study-groups/10/attendance-range?days=14`
- مدى مخصص: `/api/study-groups/10/attendance-range?start_date=2025-09-01&end_date=2025-09-30`

**الاستجابة:**
```json
{
  "range": {
    "from": "2025-09-01T00:00:00.000Z",
    "to": "2025-09-30T23:59:59.999Z",
    "period": "custom"
  },
  "summary": [
    {
      "student_id": 15,
      "student_name": "محمد أحمد",
      "total_days": 10,
      "present_days": 8,
      "absent_days": 2
    }
  ],
  "details": [
    { "student_id": 15, "student_name": "محمد أحمد", "date": "2025-09-01", "status": "present" },
    { "student_id": 15, "student_name": "محمد أحمد", "date": "2025-09-02", "status": "absent" }
  ]
}
```

### جلب مجموعات المدرس
```javascript
const getMyGroups = async () => {
  const response = await fetch('/api/study-groups/teacher/my-groups', {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  
  const data = await response.json();
  console.log(data.groups);
};
```

### إضافة طالب للمجموعة
```javascript
const addStudentToGroup = async (groupId, studentId) => {
  const response = await fetch(`/api/study-groups/${groupId}/students`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      student_id: studentId
    })
  });
  
  const data = await response.json();
  console.log(data);
};
```

## ملاحظات مهمة

1. **تنسيق الوقت:** يجب أن يكون الوقت بتنسيق `HH:MM` (مثل: `14:00`)
2. **أيام المجموعة:** يتم تخزينها كنص مفصول بفواصل (مثل: `السبت,الثلاثاء`)
3. **الصف الدراسي:** `grade_id` اختياري، يمكن إرساله أو تركه فارغاً
4. **الصلاحيات:** المدرس يمكنه فقط تعديل وحذف المجموعات التي أنشأها
5. **الطلاب:** لا يمكن إضافة طالب مرتين لنفس المجموعة
6. **الحذف:** عند حذف مجموعة، يتم حذف جميع الطلاب المرتبطين بها تلقائياً 
    }

  ]

}

```



### 7. إضافة طالب للمجموعة



**POST** `/api/study-groups/:groupId/students`



**الصلاحيات المطلوبة:** `admin` أو `teacher` (مالك المجموعة فقط)



**البيانات المطلوبة (لإضافة طالب جديد):**

```json

{

  "name": "أحمد محمد",

  "phone": "01234567890",

  "parent_phone": "09876543210",

  "payment_status": "paid",

  "payment_amount": 500.00

}

```



**البيانات المطلوبة (لإضافة طالب موجود):**

```json

{

  "student_id": 15

}

```



**الاستجابة:**

```json

{

  "message": "تم إضافة الطالب للمجموعة بنجاح",

  "student": {

    "id": 1,

    "group_id": 1,

    "student_id": 15,

    "joined_at": "2024-01-15T12:00:00Z"

  }

}

```



**ملاحظات:**

- `payment_status`: يمكن أن تكون `"paid"` أو `"unpaid"`

- `payment_amount`: مبلغ الدفع (اختياري)

- إذا كان `payment_status = "paid"`، سيتم تسجيل تاريخ الدفع تلقائياً

- سيتم إنشاء كلمة مرور عشوائية للطالب الجديد



### 8. إزالة طالب من المجموعة



**DELETE** `/api/study-groups/:groupId/students/:studentId`



**الصلاحيات المطلوبة:** `admin` أو `teacher` (مالك المجموعة فقط)



**الاستجابة:**

```json

{

  "message": "تم إزالة الطالب من المجموعة بنجاح",

  "student": {

    "id": 1,

    "group_id": 2,

    "student_id": 4,

    "joined_at": "2025-07-26T14:31:52.293Z"

  }

}

```



### 9. تعديل بيانات الطالب في المجموعة



**PUT** `/api/study-groups/:groupId/students/:studentId`



**الصلاحيات المطلوبة:** `admin` أو `teacher` (مالك المجموعة فقط)



**البيانات المطلوبة:**

```json

{

  "name": "أحمد محمد محمود",

  "phone": "01234567890",

  "parent_phone": "09876543210",

  "payment_status": "paid",

  "payment_amount": 500.00

}

```



**الاستجابة:**

```json

{

  "message": "تم تحديث بيانات الطالب بنجاح",

  "student": {

    "id": 4,

    "name": "أحمد محمد محمود",

    "phone": "01234567890",

    "parent_phone": "09876543210",

    "payment_status": "paid",

    "payment_amount": 500.00,

    "payment_date": "2025-07-26T15:00:00Z"

  }

}

```



**ملاحظات:**

- يمكن تحديث أي من الحقول (اختياري)

- إذا تم تغيير `payment_status` إلى `"paid"`، سيتم تسجيل تاريخ الدفع تلقائياً

- إذا لم يتم إرسال أي بيانات للتحديث، سيظهر خطأ



### 10. جلب طلاب المجموعة



**GET** `/api/study-groups/:groupId/students`



**الصلاحيات المطلوبة:** لا توجد



**الاستجابة:**

```json

{

  "students": [

    {

      "id": 1,

      "group_id": 1,

      "student_id": 15,

      "joined_at": "2024-01-15T12:00:00Z",

      "student_name": "محمد أحمد",

      "student_email": "mohamed@example.com"

    },

    {

      "id": 2,

      "group_id": 1,

      "student_id": 16,

      "joined_at": "2024-01-15T12:30:00Z",

      "student_name": "فاطمة علي",

      "student_email": "fatima@example.com"

    }

  ]

}

```



## أمثلة JavaScript



### إنشاء مجموعة دراسية

```javascript

const createGroup = async () => {

  const response = await fetch('/api/study-groups', {

    method: 'POST',

    headers: {

      'Content-Type': 'application/json',

      'Authorization': `Bearer ${token}`

    },

    body: JSON.stringify({

      name: 'مجموعة الرياضيات المتقدمة',

      start_time: '14:00',

      end_time: '16:00',

      days: 'السبت,الثلاثاء',

      grade_id: 1

    })

  });

  

  const data = await response.json();

  console.log(data);

};

```



### جلب مجموعات المدرس

```javascript

const getMyGroups = async () => {

  const response = await fetch('/api/study-groups/teacher/my-groups', {

    headers: {

      'Authorization': `Bearer ${token}`

    }

  });

  

  const data = await response.json();

  console.log(data.groups);

};

```



### إضافة طالب للمجموعة

```javascript

const addStudentToGroup = async (groupId, studentId) => {

  const response = await fetch(`/api/study-groups/${groupId}/students`, {

    method: 'POST',

    headers: {

      'Content-Type': 'application/json',

      'Authorization': `Bearer ${token}`

    },

    body: JSON.stringify({

      student_id: studentId

    })

  });

  

  const data = await response.json();

  console.log(data);

};

```



## ملاحظات مهمة



1. **تنسيق الوقت:** يجب أن يكون الوقت بتنسيق `HH:MM` (مثل: `14:00`)

2. **أيام المجموعة:** يتم تخزينها كنص مفصول بفواصل (مثل: `السبت,الثلاثاء`)

3. **الصف الدراسي:** `grade_id` اختياري، يمكن إرساله أو تركه فارغاً

4. **الصلاحيات:** المدرس يمكنه فقط تعديل وحذف المجموعات التي أنشأها

5. **الطلاب:** لا يمكن إضافة طالب مرتين لنفس المجموعة

6. **الحذف:** عند حذف مجموعة، يتم حذف جميع الطلاب المرتبطين بها تلقائياً 


    }

  ]

}

```



### 7. إضافة طالب للمجموعة



**POST** `/api/study-groups/:groupId/students`



**الصلاحيات المطلوبة:** `admin` أو `teacher` (مالك المجموعة فقط)



**البيانات المطلوبة (لإضافة طالب جديد):**

```json

{

  "name": "أحمد محمد",

  "phone": "01234567890",

  "parent_phone": "09876543210",

  "payment_status": "paid",

  "payment_amount": 500.00

}

```



**البيانات المطلوبة (لإضافة طالب موجود):**

```json

{

  "student_id": 15

}

```



**الاستجابة:**

```json

{

  "message": "تم إضافة الطالب للمجموعة بنجاح",

  "student": {

    "id": 1,

    "group_id": 1,

    "student_id": 15,

    "joined_at": "2024-01-15T12:00:00Z"

  }

}

```



**ملاحظات:**

- `payment_status`: يمكن أن تكون `"paid"` أو `"unpaid"`

- `payment_amount`: مبلغ الدفع (اختياري)

- إذا كان `payment_status = "paid"`، سيتم تسجيل تاريخ الدفع تلقائياً

- سيتم إنشاء كلمة مرور عشوائية للطالب الجديد



### 8. إزالة طالب من المجموعة



**DELETE** `/api/study-groups/:groupId/students/:studentId`



**الصلاحيات المطلوبة:** `admin` أو `teacher` (مالك المجموعة فقط)



**الاستجابة:**

```json

{

  "message": "تم إزالة الطالب من المجموعة بنجاح",

  "student": {

    "id": 1,

    "group_id": 2,

    "student_id": 4,

    "joined_at": "2025-07-26T14:31:52.293Z"

  }

}

```



### 9. تعديل بيانات الطالب في المجموعة



**PUT** `/api/study-groups/:groupId/students/:studentId`



**الصلاحيات المطلوبة:** `admin` أو `teacher` (مالك المجموعة فقط)



**البيانات المطلوبة:**

```json

{

  "name": "أحمد محمد محمود",

  "phone": "01234567890",

  "parent_phone": "09876543210",

  "payment_status": "paid",

  "payment_amount": 500.00

}

```



**الاستجابة:**

```json

{

  "message": "تم تحديث بيانات الطالب بنجاح",

  "student": {

    "id": 4,

    "name": "أحمد محمد محمود",

    "phone": "01234567890",

    "parent_phone": "09876543210",

    "payment_status": "paid",

    "payment_amount": 500.00,

    "payment_date": "2025-07-26T15:00:00Z"

  }

}

```



**ملاحظات:**

- يمكن تحديث أي من الحقول (اختياري)

- إذا تم تغيير `payment_status` إلى `"paid"`، سيتم تسجيل تاريخ الدفع تلقائياً

- إذا لم يتم إرسال أي بيانات للتحديث، سيظهر خطأ



### 10. جلب طلاب المجموعة



**GET** `/api/study-groups/:groupId/students`



**الصلاحيات المطلوبة:** لا توجد



**الاستجابة:**

```json

{

  "students": [

    {

      "id": 1,

      "group_id": 1,

      "student_id": 15,

      "joined_at": "2024-01-15T12:00:00Z",

      "student_name": "محمد أحمد",

      "student_email": "mohamed@example.com"

    },

    {

      "id": 2,

      "group_id": 1,

      "student_id": 16,

      "joined_at": "2024-01-15T12:30:00Z",

      "student_name": "فاطمة علي",

      "student_email": "fatima@example.com"

    }

  ]

}

```



## أمثلة JavaScript



### إنشاء مجموعة دراسية

```javascript

const createGroup = async () => {

  const response = await fetch('/api/study-groups', {

    method: 'POST',

    headers: {

      'Content-Type': 'application/json',

      'Authorization': `Bearer ${token}`

    },

    body: JSON.stringify({

      name: 'مجموعة الرياضيات المتقدمة',

      start_time: '14:00',

      end_time: '16:00',

      days: 'السبت,الثلاثاء',

      grade_id: 1

    })

  });

  

  const data = await response.json();

  console.log(data);

};

```



### جلب مجموعات المدرس

```javascript

const getMyGroups = async () => {

  const response = await fetch('/api/study-groups/teacher/my-groups', {

    headers: {

      'Authorization': `Bearer ${token}`

    }

  });

  

  const data = await response.json();

  console.log(data.groups);

};

```



### إضافة طالب للمجموعة

```javascript

const addStudentToGroup = async (groupId, studentId) => {

  const response = await fetch(`/api/study-groups/${groupId}/students`, {

    method: 'POST',

    headers: {

      'Content-Type': 'application/json',

      'Authorization': `Bearer ${token}`

    },

    body: JSON.stringify({

      student_id: studentId

    })

  });

  

  const data = await response.json();

  console.log(data);

};

```



## ملاحظات مهمة



1. **تنسيق الوقت:** يجب أن يكون الوقت بتنسيق `HH:MM` (مثل: `14:00`)

2. **أيام المجموعة:** يتم تخزينها كنص مفصول بفواصل (مثل: `السبت,الثلاثاء`)

3. **الصف الدراسي:** `grade_id` اختياري، يمكن إرساله أو تركه فارغاً

4. **الصلاحيات:** المدرس يمكنه فقط تعديل وحذف المجموعات التي أنشأها

5. **الطلاب:** لا يمكن إضافة طالب مرتين لنفس المجموعة

6. **الحذف:** عند حذف مجموعة، يتم حذف جميع الطلاب المرتبطين بها تلقائياً 

    }

  ]

}

```



### 7. إضافة طالب للمجموعة



**POST** `/api/study-groups/:groupId/students`



**الصلاحيات المطلوبة:** `admin` أو `teacher` (مالك المجموعة فقط)



**البيانات المطلوبة (لإضافة طالب جديد):**

```json

{

  "name": "أحمد محمد",

  "phone": "01234567890",

  "parent_phone": "09876543210",

  "payment_status": "paid",

  "payment_amount": 500.00

}

```



**البيانات المطلوبة (لإضافة طالب موجود):**

```json

{

  "student_id": 15

}

```



**الاستجابة:**

```json

{

  "message": "تم إضافة الطالب للمجموعة بنجاح",

  "student": {

    "id": 1,

    "group_id": 1,

    "student_id": 15,

    "joined_at": "2024-01-15T12:00:00Z"

  }

}

```



**ملاحظات:**

- `payment_status`: يمكن أن تكون `"paid"` أو `"unpaid"`

- `payment_amount`: مبلغ الدفع (اختياري)

- إذا كان `payment_status = "paid"`، سيتم تسجيل تاريخ الدفع تلقائياً

- سيتم إنشاء كلمة مرور عشوائية للطالب الجديد



### 8. إزالة طالب من المجموعة



**DELETE** `/api/study-groups/:groupId/students/:studentId`



**الصلاحيات المطلوبة:** `admin` أو `teacher` (مالك المجموعة فقط)



**الاستجابة:**

```json

{

  "message": "تم إزالة الطالب من المجموعة بنجاح",

  "student": {

    "id": 1,

    "group_id": 2,

    "student_id": 4,

    "joined_at": "2025-07-26T14:31:52.293Z"

  }

}

```



### 9. تعديل بيانات الطالب في المجموعة



**PUT** `/api/study-groups/:groupId/students/:studentId`



**الصلاحيات المطلوبة:** `admin` أو `teacher` (مالك المجموعة فقط)



**البيانات المطلوبة:**

```json

{

  "name": "أحمد محمد محمود",

  "phone": "01234567890",

  "parent_phone": "09876543210",

  "payment_status": "paid",

  "payment_amount": 500.00

}

```



**الاستجابة:**

```json

{

  "message": "تم تحديث بيانات الطالب بنجاح",

  "student": {

    "id": 4,

    "name": "أحمد محمد محمود",

    "phone": "01234567890",

    "parent_phone": "09876543210",

    "payment_status": "paid",

    "payment_amount": 500.00,

    "payment_date": "2025-07-26T15:00:00Z"

  }

}

```



**ملاحظات:**

- يمكن تحديث أي من الحقول (اختياري)

- إذا تم تغيير `payment_status` إلى `"paid"`، سيتم تسجيل تاريخ الدفع تلقائياً

- إذا لم يتم إرسال أي بيانات للتحديث، سيظهر خطأ



### 10. جلب طلاب المجموعة



**GET** `/api/study-groups/:groupId/students`



**الصلاحيات المطلوبة:** لا توجد



**الاستجابة:**

```json

{

  "students": [

    {

      "id": 1,

      "group_id": 1,

      "student_id": 15,

      "joined_at": "2024-01-15T12:00:00Z",

      "student_name": "محمد أحمد",

      "student_email": "mohamed@example.com"

    },

    {

      "id": 2,

      "group_id": 1,

      "student_id": 16,

      "joined_at": "2024-01-15T12:30:00Z",

      "student_name": "فاطمة علي",

      "student_email": "fatima@example.com"

    }

  ]

}

```



## أمثلة JavaScript



### إنشاء مجموعة دراسية

```javascript

const createGroup = async () => {

  const response = await fetch('/api/study-groups', {

    method: 'POST',

    headers: {

      'Content-Type': 'application/json',

      'Authorization': `Bearer ${token}`

    },

    body: JSON.stringify({

      name: 'مجموعة الرياضيات المتقدمة',

      start_time: '14:00',

      end_time: '16:00',

      days: 'السبت,الثلاثاء',

      grade_id: 1

    })

  });

  

  const data = await response.json();

  console.log(data);

};

```



### جلب مجموعات المدرس

```javascript

const getMyGroups = async () => {

  const response = await fetch('/api/study-groups/teacher/my-groups', {

    headers: {

      'Authorization': `Bearer ${token}`

    }

  });

  

  const data = await response.json();

  console.log(data.groups);

};

```



### إضافة طالب للمجموعة

```javascript

const addStudentToGroup = async (groupId, studentId) => {

  const response = await fetch(`/api/study-groups/${groupId}/students`, {

    method: 'POST',

    headers: {

      'Content-Type': 'application/json',

      'Authorization': `Bearer ${token}`

    },

    body: JSON.stringify({

      student_id: studentId

    })

  });

  

  const data = await response.json();

  console.log(data);

};

```



## ملاحظات مهمة



1. **تنسيق الوقت:** يجب أن يكون الوقت بتنسيق `HH:MM` (مثل: `14:00`)

2. **أيام المجموعة:** يتم تخزينها كنص مفصول بفواصل (مثل: `السبت,الثلاثاء`)

3. **الصف الدراسي:** `grade_id` اختياري، يمكن إرساله أو تركه فارغاً

4. **الصلاحيات:** المدرس يمكنه فقط تعديل وحذف المجموعات التي أنشأها

5. **الطلاب:** لا يمكن إضافة طالب مرتين لنفس المجموعة

6. **الحذف:** عند حذف مجموعة، يتم حذف جميع الطلاب المرتبطين بها تلقائياً 

    }

  ]

}

```



### 7. إضافة طالب للمجموعة



**POST** `/api/study-groups/:groupId/students`



**الصلاحيات المطلوبة:** `admin` أو `teacher` (مالك المجموعة فقط)



**البيانات المطلوبة (لإضافة طالب جديد):**

```json

{

  "name": "أحمد محمد",

  "phone": "01234567890",

  "parent_phone": "09876543210",

  "payment_status": "paid",

  "payment_amount": 500.00

}

```



**البيانات المطلوبة (لإضافة طالب موجود):**

```json

{

  "student_id": 15

}

```



**الاستجابة:**

```json

{

  "message": "تم إضافة الطالب للمجموعة بنجاح",

  "student": {

    "id": 1,

    "group_id": 1,

    "student_id": 15,

    "joined_at": "2024-01-15T12:00:00Z"

  }

}

```



**ملاحظات:**

- `payment_status`: يمكن أن تكون `"paid"` أو `"unpaid"`

- `payment_amount`: مبلغ الدفع (اختياري)

- إذا كان `payment_status = "paid"`، سيتم تسجيل تاريخ الدفع تلقائياً

- سيتم إنشاء كلمة مرور عشوائية للطالب الجديد



### 8. إزالة طالب من المجموعة



**DELETE** `/api/study-groups/:groupId/students/:studentId`



**الصلاحيات المطلوبة:** `admin` أو `teacher` (مالك المجموعة فقط)



**الاستجابة:**

```json

{

  "message": "تم إزالة الطالب من المجموعة بنجاح",

  "student": {

    "id": 1,

    "group_id": 2,

    "student_id": 4,

    "joined_at": "2025-07-26T14:31:52.293Z"

  }

}

```



### 9. تعديل بيانات الطالب في المجموعة



**PUT** `/api/study-groups/:groupId/students/:studentId`



**الصلاحيات المطلوبة:** `admin` أو `teacher` (مالك المجموعة فقط)



**البيانات المطلوبة:**

```json

{

  "name": "أحمد محمد محمود",

  "phone": "01234567890",

  "parent_phone": "09876543210",

  "payment_status": "paid",

  "payment_amount": 500.00

}

```



**الاستجابة:**

```json

{

  "message": "تم تحديث بيانات الطالب بنجاح",

  "student": {

    "id": 4,

    "name": "أحمد محمد محمود",

    "phone": "01234567890",

    "parent_phone": "09876543210",

    "payment_status": "paid",

    "payment_amount": 500.00,

    "payment_date": "2025-07-26T15:00:00Z"

  }

}

```



**ملاحظات:**

- يمكن تحديث أي من الحقول (اختياري)

- إذا تم تغيير `payment_status` إلى `"paid"`، سيتم تسجيل تاريخ الدفع تلقائياً

- إذا لم يتم إرسال أي بيانات للتحديث، سيظهر خطأ



### 10. جلب طلاب المجموعة



**GET** `/api/study-groups/:groupId/students`



**الصلاحيات المطلوبة:** لا توجد



**الاستجابة:**

```json

{

  "students": [

    {

      "id": 1,

      "group_id": 1,

      "student_id": 15,

      "joined_at": "2024-01-15T12:00:00Z",

      "student_name": "محمد أحمد",

      "student_email": "mohamed@example.com"

    },

    {

      "id": 2,

      "group_id": 1,

      "student_id": 16,

      "joined_at": "2024-01-15T12:30:00Z",

      "student_name": "فاطمة علي",

      "student_email": "fatima@example.com"

    }

  ]

}

```



## أمثلة JavaScript



### إنشاء مجموعة دراسية

```javascript

const createGroup = async () => {

  const response = await fetch('/api/study-groups', {

    method: 'POST',

    headers: {

      'Content-Type': 'application/json',

      'Authorization': `Bearer ${token}`

    },

    body: JSON.stringify({

      name: 'مجموعة الرياضيات المتقدمة',

      start_time: '14:00',

      end_time: '16:00',

      days: 'السبت,الثلاثاء',

      grade_id: 1

    })

  });

  

  const data = await response.json();

  console.log(data);

};

```



### جلب مجموعات المدرس

```javascript

const getMyGroups = async () => {

  const response = await fetch('/api/study-groups/teacher/my-groups', {

    headers: {

      'Authorization': `Bearer ${token}`

    }

  });

  

  const data = await response.json();

  console.log(data.groups);

};

```



### إضافة طالب للمجموعة

```javascript

const addStudentToGroup = async (groupId, studentId) => {

  const response = await fetch(`/api/study-groups/${groupId}/students`, {

    method: 'POST',

    headers: {

      'Content-Type': 'application/json',

      'Authorization': `Bearer ${token}`

    },

    body: JSON.stringify({

      student_id: studentId

    })

  });

  

  const data = await response.json();

  console.log(data);

};

```



## ملاحظات مهمة



1. **تنسيق الوقت:** يجب أن يكون الوقت بتنسيق `HH:MM` (مثل: `14:00`)

2. **أيام المجموعة:** يتم تخزينها كنص مفصول بفواصل (مثل: `السبت,الثلاثاء`)

3. **الصف الدراسي:** `grade_id` اختياري، يمكن إرساله أو تركه فارغاً

4. **الصلاحيات:** المدرس يمكنه فقط تعديل وحذف المجموعات التي أنشأها

5. **الطلاب:** لا يمكن إضافة طالب مرتين لنفس المجموعة

6. **الحذف:** عند حذف مجموعة، يتم حذف جميع الطلاب المرتبطين بها تلقائياً 