-- ===== حذف جميع بيانات امتحانات المجموعة =====
-- تحذير: هذا الكود سيحذف جميع امتحانات المجموعة ودرجاتها نهائياً
-- تأكد من عمل نسخة احتياطية قبل التنفيذ

-- 1. عرض البيانات الموجودة قبل الحذف
SELECT '=== امتحانات المجموعة الموجودة ===' as info;
SELECT id, group_id, name, total_grade, exam_date, created_at 
FROM group_exams 
ORDER BY id;

SELECT '=== درجات امتحانات المجموعة الموجودة ===' as info;
SELECT geg.id, geg.exam_id, geg.student_id, geg.grade, geg.notes, geg.created_at,
       ge.name as exam_name, u.name as student_name
FROM group_exam_grades geg
JOIN group_exams ge ON geg.exam_id = ge.id
JOIN users u ON geg.student_id = u.id
ORDER BY geg.exam_id, geg.student_id;

-- 2. حذف درجات امتحانات المجموعة (يجب حذفها أولاً بسبب foreign key)
SELECT '=== حذف درجات امتحانات المجموعة ===' as info;
DELETE FROM group_exam_grades;

-- 3. حذف امتحانات المجموعة
SELECT '=== حذف امتحانات المجموعة ===' as info;
DELETE FROM group_exams;

-- 4. التحقق من الحذف
SELECT '=== التحقق من الحذف ===' as info;
SELECT COUNT(*) as remaining_exams FROM group_exams;
SELECT COUNT(*) as remaining_grades FROM group_exam_grades;

-- 5. إعادة تعيين التسلسل (sequence) إذا لزم الأمر
SELECT '=== إعادة تعيين التسلسل ===' as info;
-- يمكن إضافة هذا إذا كنت تريد إعادة تعيين ID
-- ALTER SEQUENCE group_exams_id_seq RESTART WITH 1;
-- ALTER SEQUENCE group_exam_grades_id_seq RESTART WITH 1;

SELECT '=== تم حذف جميع بيانات امتحانات المجموعة بنجاح ===' as success; 