-- Up Migration
-- تحديث درجات أسئلة امتحانات المحاضرات لتكون 1
UPDATE exam_questions SET grade = 1 WHERE grade IS NULL OR grade != 1;

-- Down Migration
-- لا يمكن التراجع عن هذا التغيير لأنه تغيير في منطق النظام 