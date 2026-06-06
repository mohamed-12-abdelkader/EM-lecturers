# توثيق API إدارة الأسئلة

## نظرة عامة

نظام إدارة الأسئلة يسمح للمدرسين بإدارة الأسئلة بشكل مركزي. يدعم إضافة أسئلة دفعة واحدة من نص منسق، وتحديث الإجابات الصحيحة، وحذف وتعديل الأسئلة.

## المميزات الرئيسية

- ✅ إضافة أسئلة دفعة واحدة من نص منسق
- ✅ جلب جميع الأسئلة مع خياراتها
- ✅ تحديث الإجابة الصحيحة لكل سؤال
- ✅ حذف وتعديل الأسئلة
- ✅ تخزين الخيارات كـ JSONB للمرونة

---

## APIs

جميع المسارات تتطلب مصادقة المدرس أو Admin وتبدأ بـ:
```
/api/questions
```

---

### 1. إضافة أسئلة دفعة واحدة

**POST** `/api/questions/bulk`

**الوصف:** إضافة عدة أسئلة دفعة واحدة من نص منسق

**الصلاحيات:** مدرس أو admin

**البيانات المطلوبة:**
```json
{
  "bulk_text": "To __________ is to spoil or destroy something severely or completely.\nA) compensated\nB) compensate\nC) occur\nD) ruin\n\nShe was __________ of murdering her drunken husband.\nA) convicted\nB) supported\nC) admitted\nD) punished\n\nSuch bad behaviour __________ all the rules of a civilized society.\nA) announces\nB) punishes\nC) violates\nD) demands"
}
```

**قواعد التنسيق:**
- كل سؤال يبدأ بسطر نص السؤال
- بعده 4 أسطر للاختيارات (A/B/C/D)
- يمكن استخدام أي فاصل بعد الحرف: `A)`, `A.`, `A:`, `A-`, أو حتى `A` فقط
- سطر فارغ بين كل سؤال
- **ملاحظة:** الإجابة الصحيحة تُحفظ كـ `null` افتراضياً (يمكن تحديثها لاحقاً)

**مثال على الطلب:**
```bash
curl -X POST http://localhost:8000/api/questions/bulk \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "bulk_text": "To __________ is to spoil or destroy something severely or completely.\nA) compensated\nB) compensate\nC) occur\nD) ruin\n\nShe was __________ of murdering her drunken husband.\nA) convicted\nB) supported\nC) admitted\nD) punished"
  }'
```

**الاستجابة:**
```json
{
  "success": true,
  "inserted": 2,
  "questions": [
    {
      "id": 1,
      "question_text": "To __________ is to spoil or destroy something severely or completely.",
      "options": {
        "A": "compensated",
        "B": "compensate", 
        "C": "occur",
        "D": "ruin"
      },
      "correct_option": null,
      "created_at": "2024-01-15T10:30:00.000Z",
      "updated_at": "2024-01-15T10:30:00.000Z"
    },
    {
      "id": 2,
      "question_text": "She was __________ of murdering her drunken husband.",
      "options": {
        "A": "convicted",
        "B": "supported",
        "C": "admitted", 
        "D": "punished"
      },
      "correct_option": null,
      "created_at": "2024-01-15T10:30:00.000Z",
      "updated_at": "2024-01-15T10:30:00.000Z"
    }
  ]
}
```

---

### 2. جلب جميع الأسئلة

**GET** `/api/questions`

**الوصف:** جلب جميع الأسئلة مع خياراتها

**الصلاحيات:** مدرس أو admin

**مثال على الطلب:**
```bash
curl -X GET http://localhost:8000/api/questions \
  -H "Authorization: Bearer <token>"
```

**الاستجابة:**
```json
[
  {
    "id": 1,
    "questionText": "To __________ is to spoil or destroy something severely or completely.",
    "options": {
      "A": "compensated",
      "B": "compensate",
      "C": "occur", 
      "D": "ruin"
    },
    "correctOption": "D",
    "createdAt": "2024-01-15T10:30:00.000Z",
    "updatedAt": "2024-01-15T10:35:00.000Z"
  },
  {
    "id": 2,
    "questionText": "She was __________ of murdering her drunken husband.",
    "options": {
      "A": "convicted",
      "B": "supported",
      "C": "admitted",
      "D": "punished"
    },
    "correctOption": "A",
    "createdAt": "2024-01-15T10:30:00.000Z",
    "updatedAt": "2024-01-15T10:40:00.000Z"
  }
]
```

---

### 3. جلب سؤال واحد

**GET** `/api/questions/:id`

**الوصف:** جلب سؤال معين بواسطة ID

**الصلاحيات:** مدرس أو admin

**مثال على الطلب:**
```bash
curl -X GET http://localhost:8000/api/questions/1 \
  -H "Authorization: Bearer <token>"
```

**الاستجابة:**
```json
{
  "id": 1,
  "questionText": "To __________ is to spoil or destroy something severely or completely.",
  "options": {
    "A": "compensated",
    "B": "compensate",
    "C": "occur",
    "D": "ruin"
  },
  "correctOption": "D",
  "createdAt": "2024-01-15T10:30:00.000Z",
  "updatedAt": "2024-01-15T10:35:00.000Z"
}
```

---

### 4. تحديث الإجابة الصحيحة

**PATCH** `/api/questions/:id/answer`

**الوصف:** تحديث الإجابة الصحيحة لسؤال معين

**الصلاحيات:** مدرس أو admin

**البيانات المطلوبة:**
```json
{
  "correctOption": "D"
}
```

**مثال على الطلب:**
```bash
curl -X PATCH http://localhost:8000/api/questions/1/answer \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "correctOption": "D"
  }'
```

**الاستجابة:**
```json
{
  "id": 1,
  "questionText": "To __________ is to spoil or destroy something severely or completely.",
  "options": {
    "A": "compensated",
    "B": "compensate",
    "C": "occur",
    "D": "ruin"
  },
  "correctOption": "D",
  "createdAt": "2024-01-15T10:30:00.000Z",
  "updatedAt": "2024-01-15T10:35:00.000Z"
}
```

---

### 5. حذف سؤال

**DELETE** `/api/questions/:id`

**الوصف:** حذف سؤال معين بواسطة ID

**الصلاحيات:** مدرس أو admin

**مثال على الطلب:**
```bash
curl -X DELETE http://localhost:8000/api/questions/1 \
  -H "Authorization: Bearer <token>"
```

**الاستجابة:**
```json
{
  "message": "تم حذف السؤال بنجاح"
}
```

---

### 6. تحديث سؤال كامل

**PUT** `/api/questions/:id`

**الوصف:** تحديث السؤال والخيارات كاملة

**الصلاحيات:** مدرس أو admin

**البيانات المطلوبة:**
```json
{
  "questionText": "Updated question text?",
  "options": {
    "A": "option A",
    "B": "option B", 
    "C": "option C",
    "D": "option D"
  }
}
```

**مثال على الطلب:**
```bash
curl -X PUT http://localhost:8000/api/questions/1 \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "questionText": "What is the capital of Egypt?",
    "options": {
      "A": "Alexandria",
      "B": "Giza", 
      "C": "Luxor",
      "D": "Cairo"
    }
  }'
```

**الاستجابة:**
```json
{
  "id": 1,
  "questionText": "What is the capital of Egypt?",
  "options": {
    "A": "Alexandria",
    "B": "Giza",
    "C": "Luxor", 
    "D": "Cairo"
  },
  "correctOption": "D",
  "createdAt": "2024-01-15T10:30:00.000Z",
  "updatedAt": "2024-01-15T10:45:00.000Z"
}
```

---

## ملاحظات مهمة

### تنسيق النص للـ bulk upload:
```
سؤال 1
A) خيار أ
B) خيار ب  
C) خيار ج
D) خيار د

سؤال 2
A) خيار أ
B) خيار ب
C) خيار ج
D) خيار د
```

### قواعد التنسيق:
- كل سؤال يبدأ بسطر نص السؤال
- بعده 4 أسطر للاختيارات (A/B/C/D)
- يمكن استخدام أي فاصل بعد الحرف: `A)`, `A.`, `A:`, `A-`, أو حتى `A` فقط
- سطر فارغ بين كل سؤال
- الإجابة الصحيحة تُحفظ كـ `null` افتراضياً

### التحقق من الأخطاء:
- إذا كان هناك خطأ في تنسيق السؤال، سيتم إرجاع رسالة خطأ واضحة
- التحقق من أن الخيارات تحتوي على A, B, C, D جميعاً
- التحقق من أن correctOption يكون A, B, C, أو D فقط

---

## أمثلة استخدام

### إضافة أسئلة جديدة:
```bash
curl -X POST http://localhost:8000/api/questions/bulk \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "bulk_text": "To __________ is to spoil or destroy something severely or completely.\nA) compensated\nB) compensate\nC) occur\nD) ruin\n\nShe was __________ of murdering her drunken husband.\nA) convicted\nB) supported\nC) admitted\nD) punished"
  }'
```

### تحديث الإجابة الصحيحة:
```bash
curl -X PATCH http://localhost:8000/api/questions/1/answer \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"correctOption": "D"}'
```

### جلب جميع الأسئلة:
```bash
curl -X GET http://localhost:8000/api/questions \
  -H "Authorization: Bearer <token>"
``` 