# API إحصائيات المدرس

## نظرة عامة

API يعرض إحصائيات شاملة للمدرس تشمل عدد الكورسات والطلاب والأسئلة والمحاضرات والامتحانات.

## API

### جلب إحصائيات المدرس

**Endpoint:** `GET /api/teacher/stats`

**الصلاحيات:** `teacher` فقط

**Headers:**
```
Authorization: Bearer <token>
```

**Response (200):**
```json
{
  "success": true,
  "stats": {
    "total_courses": 5,
    "courses_with_students": 4,
    "total_students": 120,
    "total_questions": 250,
    "total_lectures": 45,
    "total_exams": 8
  }
}
```

### شرح الإحصائيات:

| الإحصائية | الوصف |
|-----------|-------|
| `total_courses` | إجمالي عدد الكورسات التي أنشأها المدرس |
| `courses_with_students` | عدد الكورسات التي لها طلاب مشتركين |
| `total_students` | إجمالي عدد الطلاب المشتركين في كورسات المدرس |
| `total_questions` | إجمالي عدد الأسئلة في مكتبة الأسئلة |
| `total_lectures` | إجمالي عدد المحاضرات في جميع الكورسات |
| `total_exams` | إجمالي عدد الامتحانات الشاملة |

---

## 💻 مثال JavaScript

```javascript
const getTeacherStats = async () => {
  try {
    const response = await fetch('/api/teacher/stats', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    return data.stats;
  } catch (error) {
    console.error('خطأ في جلب إحصائيات المدرس:', error);
    throw error;
  }
};

// استخدام
getTeacherStats().then(stats => {
  console.log('إجمالي الكورسات:', stats.total_courses);
  console.log('إجمالي الطلاب:', stats.total_students);
  console.log('إجمالي الأسئلة:', stats.total_questions);
  console.log('إجمالي المحاضرات:', stats.total_lectures);
  console.log('إجمالي الامتحانات:', stats.total_exams);
}).catch(error => {
  console.error('خطأ:', error);
});
```

---

## 📊 مثال واجهة المستخدم

```javascript
// React مثال
const TeacherDashboard = () => {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const data = await getTeacherStats();
        setStats(data);
      } catch (error) {
        console.error('خطأ في جلب الإحصائيات:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, []);

  if (loading) return <div>جاري التحميل...</div>;

  return (
    <div className="teacher-dashboard">
      <h2>لوحة تحكم المدرس</h2>
      
      <div className="stats-grid">
                 <div className="stat-card">
           <h3>الكورسات</h3>
           <div className="stat-number">{stats.total_courses}</div>
           <div className="stat-subtitle">لها طلاب: {stats.courses_with_students}</div>
         </div>
        
        <div className="stat-card">
          <h3>الطلاب</h3>
          <div className="stat-number">{stats.total_students}</div>
          <div className="stat-subtitle">إجمالي المشتركين</div>
        </div>
        
        <div className="stat-card">
          <h3>الأسئلة</h3>
          <div className="stat-number">{stats.total_questions}</div>
          <div className="stat-subtitle">في مكتبة الأسئلة</div>
        </div>
        
        <div className="stat-card">
          <h3>المحاضرات</h3>
          <div className="stat-number">{stats.total_lectures}</div>
          <div className="stat-subtitle">إجمالي المحاضرات</div>
        </div>
        
        <div className="stat-card">
          <h3>الامتحانات</h3>
          <div className="stat-number">{stats.total_exams}</div>
          <div className="stat-subtitle">الامتحانات الشاملة</div>
        </div>
      </div>
    </div>
  );
};
```

---

## ⚠️ الأخطاء المحتملة

### 401 - غير مصرح:
```json
{
  "message": "Unauthorized"
}
```

### 500 - خطأ في الخادم:
```json
{
  "success": false,
  "message": "خطأ في جلب الإحصائيات",
  "error": "تفاصيل الخطأ"
}
```

---

## 🔧 ملاحظات تقنية

1. **الصلاحيات:** يتطلب صلاحية `teacher`
2. **الأداء:** يستخدم queries محسنة مع JOIN
3. **الأمان:** يتحقق من أن المدرس يرى إحصائياته فقط
4. **التحديث:** الإحصائيات محدثة في الوقت الفعلي
5. **التوسع:** يمكن إضافة إحصائيات أخرى بسهولة

---

## 📈 إحصائيات إضافية مقترحة

يمكن إضافة إحصائيات أخرى مثل:
- متوسط درجات الطلاب
- عدد الطلاب النشطين هذا الشهر
- عدد الكورسات المكتملة
- معدل إكمال الكورسات
- إحصائيات حسب الصف الدراسي

هذا API يوفر للمدرس نظرة شاملة على أدائه ومحتواه! 🎯 