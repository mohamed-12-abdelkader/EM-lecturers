## نظام السوشيال (منشورات، تعليقات بردود، تفاعلات)

### المصادقة
- كل الطلبات عبر JWT في ترويسة Authorization: `Bearer <TOKEN>`

### المكونات
- المنشور Post: نص اختياري و/أو وسيط (صورة/فيديو/ملف)، ورؤية `public|grades|teachers|students`.
- التعليق Comment: على منشور أو رد على تعليق (`parent_comment_id`).
- التفاعل Reaction: `like|love|support` على منشور أو تعليق (تفاعل واحد لكل مستخدم).

## إنشاء منشور
- المسار: POST `/api/social/posts`
- النوع: `multipart/form-data`
- الحقول:
  - `content`: نص اختياري (إذا لا يوجد ملف يجب إرسال نص)
  - `visibility`: `public|grades|teachers|students` (افتراضي `public`)
  - `media`: ملف اختياري (صورة/فيديو/ملف). لرفع أكثر من ملف كرر الحقل `media` (حتى 10 ملفات)
- رد مثال:
```json
{ "post": { "id": 1, "author_id": 7, "content": "مرحبا", "media_url": "https://.../image.jpg", "media_type": "image", "visibility": "public", "created_at": "2025-01-01T10:00:00.000Z" } }
```

أمثلة curl:
```bash
# نص فقط (بدون ملفات) - بديل JSON
curl -X POST http://localhost:8000/api/social/posts \
 -H "Authorization: Bearer $TOKEN" \
 -H "Content-Type: application/json" \
 -d '{"content":"بوست نصي","visibility":"public"}'

# صورة من الجهاز
curl -X POST http://localhost:8000/api/social/posts \
 -H "Authorization: Bearer $TOKEN" \
 -F "content=بوست بصورة" \
 -F "media=@/path/to/image.jpg" \
 -F "visibility=public"

# عدة صور (كرر media)
curl -X POST http://localhost:8000/api/social/posts \
 -H "Authorization: Bearer $TOKEN" \
 -F "content=بوست بعدة صور" \
 -F "media=@/path/img1.jpg" \
 -F "media=@/path/img2.jpg" \
 -F "visibility=public"
```

## جلب المنشورات (Feed)
- GET `/api/social/posts?limit=20&before=<ISO>`
- رد:
```json
{ "posts": [
  {
    "id": 1,
    "author_id": 7,
    "author_name": "محمد",
    "content": "...",
    "media_url": null,
    "media_type": null,
    "media_list": [ { "id": 5, "url": "https://.../img1.jpg", "type": "image", "name": "img1.jpg" } ],
    "visibility": "public",
    "likes": 3,
    "loves": 1,
    "supports": 2,
    "comments_count": 4,
    "created_at": "..."
  }
] }
```

## التعليقات والردود
- إنشاء: POST `/api/social/posts/:postId/comments`
```json
{ "content": "تعليق", "media_url": null, "media_type": null, "parent_comment_id": null }
```
- جلب: GET `/api/social/posts/:postId/comments`
```json
{ "comments": [ { "id": 10, "post_id": 1, "author_id": 7, "author_name": "محمد", "content": "...", "parent_comment_id": null, "created_at": "..." } ] }
```

### تعديل/حذف
- تعديل بوست (المالك أو admin):
  - PUT `/api/social/posts/:postId`
  - الجسم: `{ "content": "نص محدث", "visibility": "public" }`
- حذف بوست (المالك أو admin):
  - DELETE `/api/social/posts/:postId`
- تعديل تعليق (المالك أو admin):
  - PUT `/api/social/comments/:commentId`
  - الجسم: `{ "content": "تعليق محدث" }`
- حذف تعليق (المالك أو admin):
  - DELETE `/api/social/comments/:commentId`

## التفاعلات
- POST `/api/social/reactions`
```json
{ "post_id": 1, "reaction": "like" }
```
أو
```json
{ "comment_id": 10, "reaction": "support" }
```
- يُحدّث التفاعل السابق لنفس المستخدم على نفس الهدف.

## Realtime (Socket.IO)
- أحداث البث:
  - `social:post-created` الحمولة: `{ post }`
  - `social:comment-created` الحمولة: `{ post_id, comment }`
- اشترك من الواجهة بمجرد الاتصال عبر Socket.IO لاستقبال التحديثات فوراً.

مثال (عميل):
```javascript
socket.on('social:post-created', ({ post }) => {
  // أضف البوست للأعلى. يمكن جلب media_list بالتفصيل من الفيد إذا لم تُرسل هنا.
});
socket.on('social:comment-created', ({ post_id, comment }) => {
  // أضف التعليق تحت البوست المناسب
});
```


