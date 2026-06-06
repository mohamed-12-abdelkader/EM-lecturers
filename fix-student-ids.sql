-- Fix Student ID Mismatch Issue
-- This script helps fix the mismatch between student IDs in group_students and users tables

-- Step 1: Backup current data (optional but recommended)
-- CREATE TABLE group_students_backup AS SELECT * FROM group_students;

-- Step 2: Show the current problematic data
SELECT 'Current problematic data:' as info;
SELECT 
    gs.student_id as current_student_id,
    gs.group_id,
    gs.joined_at,
    u.name as actual_student_name,
    u.id as correct_student_id,
    CASE 
        WHEN u.id IS NULL THEN '❌ No matching user found'
        WHEN u.role != 'student' THEN '❌ User exists but not a student'
        ELSE '✅ Valid student found'
    END as status
FROM group_students gs
LEFT JOIN users u ON gs.student_id = u.id
WHERE gs.group_id = (
    SELECT group_id FROM group_exams WHERE id = 1
);

-- Step 3: Show all available students in the system
SELECT 'Available students in the system:' as info;
SELECT 
    id as student_id,
    name as student_name,
    email,
    phone,
    role,
    created_at
FROM users 
WHERE role = 'student'
ORDER BY id;

-- Step 4: Manual fix - Update specific student IDs
-- Replace the student_id values with the correct ones from the users table
-- Example: If student "أحمد محمد" has ID 5 in users table but ID 1 in group_students

-- UPDATE group_students 
-- SET student_id = 5  -- Correct student ID from users table
-- WHERE student_id = 1  -- Wrong student ID currently in group_students
-- AND group_id = (SELECT group_id FROM group_exams WHERE id = 1);

-- Step 5: Remove orphaned records (student_id not in users table)
-- DELETE FROM group_students 
-- WHERE student_id NOT IN (SELECT id FROM users WHERE role = 'student');

-- Step 6: Verify the fix
SELECT 'After fix - verify the data:' as info;
SELECT 
    gs.student_id,
    u.name as student_name,
    u.email,
    u.role,
    gs.joined_at,
    '✅ Valid student' as status
FROM group_students gs
JOIN users u ON gs.student_id = u.id
WHERE gs.group_id = (
    SELECT group_id FROM group_exams WHERE id = 1
);

-- Step 7: Test adding a grade (replace with actual student_id)
-- This should work after the fix
-- INSERT INTO group_exam_grades (exam_id, student_id, grade, notes)
-- VALUES (1, 5, 85.5, 'Test grade after fix'); 