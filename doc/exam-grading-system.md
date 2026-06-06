# نظام الدرجات الجديد للامتحانات

## نظرة عامة

تم تحديث نظام الدرجات في الامتحانات (الشاملة والمحاضرات) ليكون أبسط وأكثر وضوحاً:

## التغييرات الرئيسية

### 1. درجة السؤال الواحد
- **كل سؤال = 1 درجة**
- لا يمكن تغيير درجة السؤال الفردي
- جميع الأسئلة متساوية في القيمة

### 2. مجموع درجة الامتحان
- **مجموع الدرجة = عدد الأسئلة**
- مثال: امتحان بـ 10 أسئلة = 10 درجات كاملة
- مثال: امتحان بـ 20 سؤال = 20 درجة كاملة

### 3. درجة النجاح
- **درجة النجاح = نصف الدرجة الكلية**
- مثال: امتحان بـ 10 أسئلة، النجاح من 5 درجات
- مثال: امتحان بـ 20 سؤال، النجاح من 10 درجات

## التطبيق على أنواع الامتحانات

### امتحان الكورس الشامل
```javascript
// مثال: امتحان بـ 15 سؤال
// الدرجة الكلية = 15
// درجة النجاح = 8 درجات (Math.ceil(15/2))
```

### امتحان المحاضرة
```javascript
// مثال: امتحان بـ 8 أسئلة
// الدرجة الكلية = 8
// درجة النجاح = 4 درجات (Math.ceil(8/2))
```

## التغييرات في الـ APIs

### 1. إنشاء أسئلة جديدة
**السلوك الجديد:**
- جميع الأسئلة تُنشأ بدرجة 1 تلقائياً
- لا يمكن تحديد درجة مختلفة للسؤال

**مثال:**
```javascript
// إضافة أسئلة من مكتبة الأسئلة
await fetch('/api/course/course-exam/123/add-questions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  },
  body: JSON.stringify({
    question_ids: [1, 2, 3, 4, 5] // 5 أسئلة = 5 درجات
  })
});
```

### 2. تعديل السؤال
**السلوك الجديد:**
- يمكن تعديل نص السؤال والاختيارات فقط
- درجة السؤال تبقى 1 دائماً

**مثال:**
```javascript
await fetch('/api/course/course-exam/question/123', {
  method: 'PUT',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  },
  body: JSON.stringify({
    text: "نص السؤال المحدث؟",
    choices: [
      {"text": "اختيار 1", "is_correct": false},
      {"text": "اختيار 2", "is_correct": true},
      {"text": "اختيار 3", "is_correct": false},
      {"text": "اختيار 4", "is_correct": false}
    ]
    // لا حاجة لـ grade - سيكون 1 تلقائياً
  })
});
```

### 3. إضافة أسئلة دفعة واحدة
**السلوك الجديد:**
- جميع الأسئلة تُنشأ بدرجة 1
- مجموع الدرجة = عدد الأسئلة المضافة

**مثال:**
```javascript
await fetch('/api/course/course-exam/123/bulk-questions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  },
  body: JSON.stringify({
    bulk_text: "سؤال 1\nA) اختيار 1\nB) اختيار 2\nC) اختيار 3\nD) اختيار 4\n\nسؤال 2\nA) اختيار 1\nB) اختيار 2\nC) اختيار 3\nD) اختيار 4"
    // سؤالان = درجتان
  })
});
```

## نتائج الامتحان

### Response عند حل الامتحان
```json
{
  "success": true,
  "totalGrade": 7,        // الدرجة التي حصل عليها الطالب
  "maxGrade": 10,         // الدرجة الكلية (عدد الأسئلة)
  "passed": true,         // نجح أم لا (من نصف الدرجة)
  "wrongQuestions": [...] // الأسئلة الخاطئة
}
```

### مثال عملي
```javascript
// امتحان بـ 10 أسئلة
// الطالب أجاب 7 أسئلة صحيحة
{
  "totalGrade": 7,    // 7 درجات
  "maxGrade": 10,     // 10 درجات كاملة
  "passed": true,     // نجح (7 >= 5)
  "percentage": 70    // 70%
}
```

## Migration

تم إنشاء migration لتحديث جميع الأسئلة الموجودة:

```sql
-- تحديث درجات أسئلة الامتحان الشامل
UPDATE course_exam_questions SET grade = 1 WHERE grade IS NULL OR grade != 1;

-- تحديث درجات أسئلة امتحانات المحاضرات
UPDATE exam_questions SET grade = 1 WHERE grade IS NULL OR grade != 1;
```

## الفوائد

1. **البساطة:** نظام درجات واضح ومفهوم
2. **العدالة:** جميع الأسئلة متساوية في القيمة
3. **الوضوح:** الطالب يعرف أن كل سؤال = درجة واحدة
4. **سهولة الحساب:** مجموع الدرجة = عدد الأسئلة
5. **معيار موحد:** نفس النظام لجميع أنواع الامتحانات

## ملاحظات مهمة

- جميع الأسئلة الموجودة ستصبح بدرجة 1 بعد تطبيق الـ migration
- لا يمكن تغيير درجة السؤال الفردي بعد التحديث
- درجة النجاح دائماً من نصف الدرجة الكلية
- النظام يعمل على جميع أنواع الامتحانات (شاملة ومحاضرات)

## أمثلة JavaScript كاملة

### إنشاء امتحان وإضافة أسئلة
```javascript
// 1. إنشاء امتحان
const exam = await fetch('/api/course/123/course-exam', {
  method: 'POST',
  headers: {
    'Content-Type': 'multipart/form-data',
    'Authorization': `Bearer ${token}`
  },
  body: formData // title, questions_count, duration, total_grade
});

// 2. إضافة 10 أسئلة
await fetch('/api/course/course-exam/123/bulk-questions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  },
  body: JSON.stringify({
    bulk_text: "10 أسئلة منسقة..."
  })
});

// النتيجة: امتحان بـ 10 أسئلة = 10 درجات كاملة
// درجة النجاح = 5 درجات
```

### حل الامتحان
```javascript
const result = await fetch('/api/course/course-exam/123/submit', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  },
  body: JSON.stringify({
    answers: [
      { questionId: 1, choiceId: 3 },
      { questionId: 2, choiceId: 1 },
      // ... باقي الإجابات
    ]
  })
});

const examResult = await result.json();
console.log(`الدرجة: ${examResult.totalGrade}/${examResult.maxGrade}`);
console.log(`النجاح: ${examResult.passed ? 'نعم' : 'لا'}`);
``` 