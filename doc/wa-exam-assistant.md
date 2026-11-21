# WhatsApp Exam Assistant (مساعد الامتحانات)

يوسّع خدمة `teacher_exam_builder_bot` الموجودة إلى Workflow حقيقي مع state machine محفوظة في DB.

## تشغيل

1. طبّق الـ migration: `1780970000000_wa_exam_assistant_workflow.sql`
2. من لوحة واتساب: فعّل خدمة **مساعد الامتحانات** واربط لها session.
3. المدرس يراسل من رقم واتساب المسجّل في حسابه.

## Flows المدعومة

### من بنك الأسئلة
طلب → (اختياري) تأكيد مهمة مجدولة اليوم → تحديد الدرس/الإعدادات → اقتراح أسئلة عبر `ExamBuilderChatbotService` → مراجعة عبر رابط `/exam-builder-chat/:sessionId/approve` → اختيار النوع (عام/واجب/شامل) → اختيار كورس/محاضرة → مسودة `is_visible=false` → نشر صريح.

### من ملفات/صور
إرسال PDF/صور → تجميع حتى «خلصت» → استخراج عبر `MistralQuestionExtractionService` → اختيار النوع والهدف → مسودة + استيراد أسئلة → مراجعة → نشر صريح.

## Admin

`GET /api/whatsapp/admin/exam-assistant/sessions`

## ملاحظات

- لا يُنشر امتحان بدون موافقة صريحة («انشر» / «موافق على النشر»).
- Tenant/Teacher isolation عبر رقم واتساب المدرس.
- الأسئلة العلمية/الدعم الفني خدمات منفصلة ولم تتأثر.
