# Admin API - تحديد باقة المدرس

توثيق مختصر لـ API يسمح للأدمن بتحديد باقة المدرس وحفظها لاستخدامات مستقبلية.

## الباقات (الكود الداخلي → الاسم)

| code | الاسم | لايف/شهر | الطلاب |
|------|-------|----------|--------|
| `bronze` | الانطلاقة | 6 | 80 |
| `silver` | التوسع | 10 | 150 |
| `gold` | الاحتراف | 16 | 300 |
| `diamond` | التميز | غير محدود | غير محدود |

## صلاحيات الخدمات حسب الباقة

| الخدمة | bronze / silver | gold | diamond |
|--------|-----------------|------|---------|
| إنشاء امتحانات بالـ AI | — | ✓ | ✓ |
| الدعم العلمي للطلاب | — | ✓ | ✓ |
| محلل البيانات (المدرس) | — | — | ✓ |
| مساعد السوشيال ميديا | — | — | ✓ |

> الدورة الشهرية للايفات تُحسب من `subscription_package_assigned_at`. عند تغيير الباقة تبدأ دورة جديدة.

## Endpoint

- `PATCH /api/admin/teachers/:id/package`

## Authorization

- مطلوب `Bearer Token` لمستخدم بصلاحية `admin`.

## Path Params

- `id` (number): رقم المدرس.

## Request Body

```json
{
  "subscription_package": "gold"
}
```

## القيم المسموحة للباقة

- `bronze` — الانطلاقة
- `silver` — التوسع
- `gold` — الاحتراف
- `diamond` — التميز

## للمدرس — معرفة صلاحيات باقته

```http
GET /api/teacher/subscription/plan-access
```

## Success Response

```json
{
  "success": true,
  "message": "Teacher package updated"
}
```

## Error Cases

- `400` عند إرسال قيمة باقة غير صحيحة.
- `400` عند إرسال `id` غير صالح.
- `404` إذا المدرس غير موجود.

## مثال cURL

```bash
curl -X PATCH "http://localhost:8000/api/admin/teachers/25/package" ^
  -H "Content-Type: application/json" ^
  -H "Authorization: Bearer YOUR_ADMIN_JWT" ^
  -H "X-Tenant-Subdomain: your-tenant" ^
  -d "{\"subscription_package\":\"diamond\"}"
```
