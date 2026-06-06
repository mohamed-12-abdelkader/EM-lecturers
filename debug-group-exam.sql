-- Debug Group Exam Issue - Student ID Mismatch
-- Run these queries to understand the mismatch between student IDs

-- 1. Check if group exam exists
SELECT 
    ge.id as exam_id,
    ge.name as exam_name,
    ge.group_id,
    ge.total_grade,
    sg.name as group_name,
    sg.teacher_id,
    u.name as teacher_name
FROM group_exams ge
JOIN study_groups sg ON ge.group_id = sg.id
JOIN users u ON sg.teacher_id = u.id
WHERE ge.id = 1;

-- 2. Check students in the group (with their details)
SELECT 
    gs.student_id as group_student_id,
    u.name as student_name,
    u.email,
    u.role,
    gs.joined_at,
    CASE 
        WHEN u.id IS NULL THEN '❌ Student ID not found in users table'
        WHEN u.role != 'student' THEN '❌ User exists but not a student'
        ELSE '✅ Student exists and is valid'
    END as status
FROM group_students gs
LEFT JOIN users u ON gs.student_id = u.id
WHERE gs.group_id = (
    SELECT group_id FROM group_exams WHERE id = 1
);

-- 3. Check all users with role 'student' (to see available student IDs)
SELECT 
    id,
    name,
    email,
    phone,
    role,
    created_at
FROM users 
WHERE role = 'student'
ORDER BY id;

-- 4. Find orphaned group_students records (student_id not in users table)
SELECT 
    gs.student_id,
    gs.group_id,
    gs.joined_at,
    '❌ Orphaned record - student_id not in users table' as issue
FROM group_students gs
LEFT JOIN users u ON gs.student_id = u.id
WHERE u.id IS NULL;

-- 5. Check if there are any group_exam_grades for this exam
SELECT 
    geg.*,
    u.name as student_name,
    CASE 
        WHEN u.id IS NULL THEN '❌ Student not found'
        ELSE '✅ Student found'
    END as status
FROM group_exam_grades geg
LEFT JOIN users u ON geg.student_id = u.id
WHERE geg.exam_id = 1; 