# API تسجيل الطالب

## نظرة عامة

API لتسجيل طالب جديد في النظام مع إضافة رقم ولي الأمر كحقل إجباري.

## API

### تسجيل طالب جديد

**Endpoint:** `POST /api/users/register`

**Headers:**
```
Content-Type: application/json
```

**Request Body:**
```json
{
  "phone": "+966501234567",
  "password": "123456",
  "name": "أحمد محمد",
  "parent_phone": "+966501234568",
  "grade_id": 1
}
```

**الحقول المطلوبة:**
- `phone` (string): رقم هاتف الطالب (إجباري)
- `password` (string): كلمة المرور (الحد الأدنى 6 أحرف)
- `name` (string): اسم الطالب (إجباري)
- `parent_phone` (string): رقم هاتف ولي الأمر (إجباري)
- `grade_id` (number): معرف الصف الدراسي (اختياري)

**Response (201):**
```json
{
  "user": {
    "id": 123,
    "phone": "+966501234567",
    "name": "أحمد محمد",
    "parent_phone": "+966501234568",
    "role": "student",
    "avatar": null
  },
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Response (400):**
```json
{
  "message": "Phone number already registered"
}
```

---

## 💻 مثال JavaScript

```javascript
const registerStudent = async (studentData) => {
  try {
    const response = await fetch('/api/users/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        phone: studentData.phone,
        password: studentData.password,
        name: studentData.name,
        parent_phone: studentData.parentPhone,
        grade_id: studentData.gradeId
      })
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message);
    }
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('خطأ في تسجيل الطالب:', error);
    throw error;
  }
};

// استخدام
const studentData = {
  phone: '+966501234567',
  password: '123456',
  name: 'أحمد محمد',
  parentPhone: '+966501234568',
  gradeId: 1
};

registerStudent(studentData).then(data => {
  console.log('تم التسجيل بنجاح:', data.user);
  console.log('Token:', data.token);
}).catch(error => {
  console.error('خطأ:', error.message);
});
```

---

## 📱 مثال React Form

```jsx
import React, { useState } from 'react';

const StudentRegistrationForm = () => {
  const [formData, setFormData] = useState({
    phone: '',
    password: '',
    name: '',
    parentPhone: '',
    gradeId: ''
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/users/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          phone: formData.phone,
          password: formData.password,
          name: formData.name,
          parent_phone: formData.parentPhone,
          grade_id: formData.gradeId ? parseInt(formData.gradeId) : undefined
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message);
      }

      // تم التسجيل بنجاح
      console.log('تم التسجيل:', data);
      // يمكن حفظ الـ token في localStorage
      localStorage.setItem('token', data.token);
      
    } catch (error) {
      setError(error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
  };

  return (
    <form onSubmit={handleSubmit} className="registration-form">
      <h2>تسجيل طالب جديد</h2>
      
      {error && <div className="error">{error}</div>}
      
      <div className="form-group">
        <label>رقم هاتف الطالب:</label>
        <input
          type="tel"
          name="phone"
          value={formData.phone}
          onChange={handleChange}
          placeholder="+966501234567"
          required
        />
      </div>

      <div className="form-group">
        <label>كلمة المرور:</label>
        <input
          type="password"
          name="password"
          value={formData.password}
          onChange={handleChange}
          minLength="6"
          required
        />
      </div>

      <div className="form-group">
        <label>اسم الطالب:</label>
        <input
          type="text"
          name="name"
          value={formData.name}
          onChange={handleChange}
          required
        />
      </div>

      <div className="form-group">
        <label>رقم هاتف ولي الأمر:</label>
        <input
          type="tel"
          name="parentPhone"
          value={formData.parentPhone}
          onChange={handleChange}
          placeholder="+966501234568"
          required
        />
      </div>

      <div className="form-group">
        <label>الصف الدراسي:</label>
        <select
          name="gradeId"
          value={formData.gradeId}
          onChange={handleChange}
        >
          <option value="">اختر الصف</option>
          <option value="1">الصف الأول</option>
          <option value="2">الصف الثاني</option>
          <option value="3">الصف الثالث</option>
        </select>
      </div>

      <button type="submit" disabled={loading}>
        {loading ? 'جاري التسجيل...' : 'تسجيل'}
      </button>
    </form>
  );
};

export default StudentRegistrationForm;
```

---

## ⚠️ الأخطاء المحتملة

### 400 - بيانات غير صحيحة:
```json
{
  "message": "Phone number already registered"
}
```

### 400 - تحقق من البيانات:
```json
{
  "message": "Invalid phone number"
}
```

### 400 - كلمة مرور قصيرة:
```json
{
  "message": "String must contain at least 6 character(s)"
}
```

---

## 🔧 ملاحظات تقنية

1. **رقم ولي الأمر إجباري:** يجب إدخال رقم هاتف ولي الأمر عند التسجيل
2. **تنسيق الأرقام:** يدعم الأرقام مع أو بدون رمز البلد (+966)
3. **التحقق من التكرار:** لا يمكن تسجيل رقم هاتف مستخدم مسبقاً
4. **الصف الدراسي:** اختياري، يمكن إضافته لاحقاً
5. **التشفير:** كلمة المرور مشفرة باستخدام bcrypt
6. **الـ Token:** يتم إرجاع JWT token للدخول التلقائي

---

## 📋 التحقق من البيانات

- **رقم الهاتف:** يجب أن يكون بين 8-15 رقم
- **كلمة المرور:** الحد الأدنى 6 أحرف
- **الاسم:** لا يمكن أن يكون فارغاً
- **رقم ولي الأمر:** نفس تنسيق رقم الطالب

هذا API يوفر تسجيل آمن للطلاب مع ربطهم بولي الأمر! 🎓 