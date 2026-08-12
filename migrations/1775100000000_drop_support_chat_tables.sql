-- حذف جداول شات الدعم الفني نهائياً (طالب + مدرس + تذاكر)

BEGIN;

-- تذاكر الدعم أولاً (FK على teacher_support_chats)
DROP TABLE IF EXISTS support_tickets CASCADE;

-- رسائل وشات المدرس
DROP TABLE IF EXISTS teacher_support_messages CASCADE;
DROP TABLE IF EXISTS teacher_support_chats CASCADE;

-- رسائل وشات الطالب/الضيف
DROP TABLE IF EXISTS support_messages CASCADE;
DROP TABLE IF EXISTS support_chats CASCADE;

-- FAQ إن وُجدت من إصدارات قديمة
DROP TABLE IF EXISTS support_faqs CASCADE;
DROP TABLE IF EXISTS support_faq CASCADE;

COMMIT;
