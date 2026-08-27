# وصول المحاضرة (مرجع سريع)

> التوثيق الكامل: **[course-lectures-system.md](./course-lectures-system.md)**

## `access_mode` (لكل محاضرة)

| قيمة | المعنى |
|------|--------|
| `open` | مفتوحة للكل |
| `activation_code` | مقفولة للكل — كود تفعيل |
| `groups` | مفتوحة للمجموعات المحددة بدون كود، وظاهرة لباقي الطلاب بكود |

```
POST /api/course/:courseId/lectures
{ "title": "...", "access_mode": "groups", "group_ids": [1, 2] }
```

ثم أنشئ كودًا لغير أعضاء المجموعة:
```
POST /api/course/lecture/:lectureId/activation-codes
{ "duration_hours": 48 }
```
