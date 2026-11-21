# Social Media Auto-Publishing (Facebook + Instagram)

نظام ربط حسابات المدرّس عبر Meta OAuth، وجدولة/نشر البوستات تلقائيًا من داخل EM Lecture.

## Environment Variables

أضف إلى `.env` (ولا ترفع القيم إلى Git):

```env
META_APP_ID=
META_APP_SECRET=
META_API_VERSION=v21.0
META_OAUTH_REDIRECT_URL=https://YOUR_PUBLIC_API/api/teacher/social-publishing/oauth/callback
META_FRONTEND_RETURN_URL=https://YOUR_FRONTEND/social?tab=connections
META_TOKEN_ENCRYPTION_KEY=long-random-secret-for-aes
```

ملاحظات مهمة:

- `BASE_URL` يجب أن يكون HTTPS عامًا حتى تتمكن Meta من تحميل صور البوست (`image_url`).
- محليًا استخدم ngrok/`USE_NGROK` واجعل Redirect URI يطابق `META_OAUTH_REDIRECT_URL`.
- التشفير يستخدم `META_TOKEN_ENCRYPTION_KEY` أو يسقط إلى `SECRET_KEY`.

## Meta Developer App Setup

1. أنشئ تطبيقًا من [Meta for Developers](https://developers.facebook.com/).
2. أضف منتجات: **Facebook Login** و **Instagram Graph API**.
3. Valid OAuth Redirect URIs: نفس قيمة `META_OAUTH_REDIRECT_URL`.
4. Permissions المطلوبة (App Review للإنتاج):
   - `pages_show_list`
   - `pages_manage_posts`
   - `pages_read_engagement`
   - `instagram_basic`
   - `instagram_content_publish`
   - `business_management` (عند الحاجة لصفحات Business)
5. اربط Instagram Professional Account بصفحة Facebook.
6. للتطوير: أضف حسابات الاختبار. للإنتاج: App Review + Business Verification عند طلب Meta.

## Migrations

```bash
npm run migrate
# أو أداة الـ migrate المستخدمة في المشروع
```

الجداول:

- `teacher_meta_connections`
- `teacher_meta_targets`
- `teacher_social_settings`
- `teacher_social_posts`
- `teacher_social_post_targets`
- `teacher_social_publish_jobs`
- `teacher_social_publishing_logs`

## APIs (Teacher)

Base: `/api/teacher/social-publishing`

| Method | Path | وصف |
|--------|------|-----|
| GET | `/oauth/callback` | OAuth callback (بدون Bearer) |
| GET | `/connect` | رابط Meta OAuth |
| GET | `/connections` | الحسابات المرتبطة |
| DELETE | `/targets/:id` | فصل حساب |
| POST | `/targets/:id/default` | تعيين أساسي |
| GET/PUT | `/settings` | إعدادات النشر التلقائي |
| GET/POST | `/posts` | قائمة / إنشاء بوست |
| POST | `/posts/from-generation/:id` | من توليد AI |
| POST | `/posts/:id/publish-now` | نشر فوري |
| POST | `/posts/:id/schedule` | جدولة |
| POST | `/posts/:id/approve` | موافقة |
| POST | `/posts/:id/retry` | إعادة محاولة |
| GET | `/dashboard` | ملخص |
| GET | `/logs` | سجل |
| GET | `/admin/overview` | نظرة Admin |

## Workers (Production)

عند تشغيل السيرفر (`npm start` / process الرئيسي) يتم تشغيل:

1. **Social publish worker** — يدّعي jobs من `teacher_social_publish_jobs` عبر `FOR UPDATE SKIP LOCKED` كل ~4 ثوانٍ.
2. **Auto-publish sweeper** — كل دقيقة يولّد بوستات للمدرسين ذوي `auto_publish_enabled` حسب المواعيد والـ timezone.

لا حاجة لـ worker منفصل في MVP؛ نفس process التطبيق يكفي. لفصل الـ workers لاحقًا يمكن تشغيل نفس دوال `startSocialPublishWorker` / `startTeacherSocialAutoPublishSweeper` في process مستقل.

## Frontend

صفحة `/social`:

- تبويب **المساعد الذكي** (السلوك السابق).
- تبويب **النشر التلقائي**: حسابات، تقويم، بوستات، موافقة، إعدادات.
- من المحفوظات: **أضف للنشر التلقائي** على التصاميم.

## Local run

1. عيّن متغيرات Meta + `BASE_URL` عام.
2. شغّل الـ migrations.
3. `npm run dev` للـ backend.
4. افتح Frontend → `/social` → النشر التلقائي → ربط Facebook/Instagram.
5. ولّد صورة من المساعد → أضف للنشر → نشر الآن.

## Security notes

- Tokens مشفّرة في DB ولا تُعاد للـ Frontend.
- OAuth state موقّع JWT (15 دقيقة).
- كل استعلامات البوستات/الحسابات مقيّدة بـ `teacher_id`.
- فصل الحساب يلغي jobs المعلّقة دون حذف السجل التاريخي.
