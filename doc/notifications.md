# نظام الإشعارات

## نظرة عامة

نظام الإشعارات يسمح للطلاب المشتركين في الكورسات بتلقي إشعارات تلقائية عند إضافة محتوى جديد من قبل المدرس.

## أنواع الإشعارات

### 1. إشعار محاضرة جديدة
- **الحدث**: إضافة محاضرة جديدة لكورس
- **المستقبلون**: جميع الطلاب المشتركين في الكورس
- **الرسالة**: "تم إضافة محاضرة جديدة [اسم المحاضرة] في كورس [اسم الكورس]"

### 2. إشعار فيديو جديد
- **الحدث**: إضافة فيديو جديد لمحاضرة
- **المستقبلون**: جميع الطلاب المشتركين في الكورس
- **الرسالة**: "تم إضافة فيديو جديد [اسم الفيديو] في محاضرة [اسم المحاضرة] من كورس [اسم الكورس]"

### 3. إشعار ملف جديد
- **الحدث**: إضافة ملف PDF جديد لمحاضرة
- **المستقبلون**: جميع الطلاب المشتركين في الكورس
- **الرسالة**: "تم إضافة ملف جديد [اسم الملف] في محاضرة [اسم المحاضرة] من كورس [اسم الكورس]"

## API Endpoints

### جلب إشعارات المستخدم
```
GET /notifications
```

**المعاملات:**
- `limit` (اختياري): عدد الإشعارات المطلوبة (الافتراضي: 20)
- `offset` (اختياري): عدد الإشعارات للتخطي (الافتراضي: 0)

**الاستجابة:**
```json
{
  "notifications": [
    {
      "id": 1,
      "title": "محاضرة جديدة",
      "message": "تم إضافة محاضرة جديدة \"الرياضيات الأساسية\" في كورس \"الرياضيات للصف الأول\"",
      "type": "lecture_added",
      "course_id": 1,
      "lecture_id": 5,
      "is_read": false,
      "created_at": "2024-01-15T10:30:00Z",
      "course_title": "الرياضيات للصف الأول",
      "lecture_title": "الرياضيات الأساسية"
    }
  ],
  "pagination": {
    "limit": 20,
    "offset": 0,
    "hasMore": true
  }
}
```

### تحديث إشعار كمقروء
```
PUT /notifications/:notificationId/read
```

**الاستجابة:**
```json
{
  "message": "Notification marked as read"
}
```

### تحديث جميع الإشعارات كمقروءة
```
PUT /notifications/read-all
```

**الاستجابة:**
```json
{
  "message": "All notifications marked as read"
}
```

### جلب عدد الإشعارات غير المقروءة
```
GET /notifications/unread-count
```

**الاستجابة:**
```json
{
  "count": 5
}
```

## بنية قاعدة البيانات

### جدول notifications
```sql
CREATE TABLE notifications (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    type TEXT NOT NULL, -- 'lecture_added', 'video_added', 'file_added'
    course_id INTEGER REFERENCES courses (id) ON DELETE CASCADE,
    lecture_id INTEGER REFERENCES lectures (id) ON DELETE CASCADE,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW ()
);
```

## التكامل مع النظام الحالي

### إضافة محاضرة جديدة
عند إضافة محاضرة جديدة، يتم إرسال إشعار تلقائي لجميع الطلاب المشتركين في الكورس.

### إضافة فيديو جديد
عند إضافة فيديو جديد لمحاضرة، يتم إرسال إشعار تلقائي لجميع الطلاب المشتركين في الكورس.

### إضافة ملف PDF جديد
عند إضافة ملف PDF جديد لمحاضرة، يتم إرسال إشعار تلقائي لجميع الطلاب المشتركين في الكورس.

## الأمان

- جميع نقاط النهاية تتطلب مصادقة
- يمكن للمستخدم الوصول فقط لإشعاراته الخاصة
- يتم التحقق من صحة البيانات المدخلة

## الاستخدام في الواجهة الأمامية

### عرض الإشعارات
```javascript
// جلب إشعارات المستخدم
const response = await fetch('/api/notifications?limit=10&offset=0', {
  headers: {
    'Authorization': `Bearer ${token}`
  }
});
const { notifications } = await response.json();
```

### تحديث حالة الإشعار
```javascript
// تحديث إشعار كمقروء
await fetch(`/api/notifications/${notificationId}/read`, {
  method: 'PUT',
  headers: {
    'Authorization': `Bearer ${token}`
  }
});
```

### عرض عدد الإشعارات غير المقروءة
```javascript
// جلب عدد الإشعارات غير المقروءة
const response = await fetch('/api/notifications/unread-count', {
  headers: {
    'Authorization': `Bearer ${token}`
  }
});
const { count } = await response.json();
``` 