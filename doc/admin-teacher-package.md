# Admin API - تحديد باقة المدرس

توثيق مختصر لـ API يسمح للأدمن بتحديد باقة المدرس وحفظها لاستخدامات مستقبلية.

## قواعد فتح اللايفات حسب الباقة

- `bronze`: لا يمكن إنشاء لايفات.
- `silver`: يمكن إنشاء 4 لايفات في كل دورة شهرية.
- `gold`: يمكن إنشاء 8 لايفات في كل دورة شهرية.
- `diamond`: عدد غير محدود.

> الدورة الشهرية يتم حسابها بداية من وقت تعيين الباقة (`subscription_package_assigned_at`).
> عند تغيير الباقة، يتم تحديث وقت التعيين وتبدأ دورة شهرية جديدة من هذا التاريخ.

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

- `bronze`
- `silver`
- `gold`
- `diamond`

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
