import { Router } from 'express';
import { authMiddleware } from '../middleware/authentication';
import { asyncWrapper } from '../utils';
import pool from '../db/pool';

export const router = Router();

// إضافة درجة طالب في امتحان مجموعة
router.post(
  '/',
  authMiddleware(['teacher', 'admin']),
  asyncWrapper(async (req, res) => {
    const { exam_name, student_id, grade, notes } = req.body;
    const teacherId = req.user!.id;

    // التحقق من البيانات المطلوبة
    if (!exam_name || !student_id || grade === undefined) {
      return res.status(400).json({
        error: 'بيانات مطلوبة',
        message: 'اسم الامتحان ومعرف الطالب والدرجة مطلوبان',
      });
    }

    // التحقق من أن الطالب موجود وهو طالب
    const studentCheck = await pool.query('SELECT id, name, role FROM users WHERE id = $1', [
      student_id,
    ]);

    if (studentCheck.rows.length === 0) {
      return res.status(404).json({
        error: 'طالب غير موجود',
        message: `الطالب برقم ${student_id} غير موجود في النظام`,
      });
    }

    if (studentCheck.rows[0].role !== 'student') {
      return res.status(400).json({
        error: 'دور خاطئ',
        message: `المستخدم برقم ${student_id} ليس طالب (الدور: ${studentCheck.rows[0].role})`,
      });
    }

    // البحث عن امتحان بنفس الاسم في مجموعات المدرس
    const examCheck = await pool.query(
      `SELECT ge.id, ge.name, ge.total_grade, ge.group_id, sg.name as group_name
       FROM group_exams ge
       JOIN study_groups sg ON ge.group_id = sg.id
       WHERE ge.name = $1 AND sg.teacher_id = $2`,
      [exam_name, teacherId],
    );

    if (examCheck.rows.length === 0) {
      return res.status(404).json({
        error: 'امتحان غير موجود',
        message: `لا يوجد امتحان باسم "${exam_name}" في مجموعاتك`,
      });
    }

    const exam = examCheck.rows[0];

    // التحقق من أن الطالب في المجموعة
    const studentInGroup = await pool.query(
      'SELECT 1 FROM group_students WHERE group_id = $1 AND student_id = $2',
      [exam.group_id, student_id],
    );

    if (studentInGroup.rows.length === 0) {
      // جلب قائمة الطلاب في المجموعة للمساعدة
      const groupStudents = await pool.query(
        `SELECT gs.student_id, u.name 
         FROM group_students gs 
         JOIN users u ON gs.student_id = u.id 
         WHERE gs.group_id = $1`,
        [exam.group_id],
      );

      const studentList = groupStudents.rows
        .map((row) => `${row.name} (ID: ${row.student_id})`)
        .join(', ');

      return res.status(400).json({
        error: 'طالب غير موجود في المجموعة',
        message: `الطالب ${studentCheck.rows[0].name} (ID: ${student_id}) غير موجود في المجموعة "${exam.group_name}". الطلاب الموجودون في المجموعة: ${studentList || 'لا يوجد طلاب'}`,
      });
    }

    // التحقق من أن الدرجة لا تتجاوز الدرجة الكلية
    if (grade > exam.total_grade) {
      return res.status(400).json({
        error: 'درجة غير صحيحة',
        message: `الدرجة لا يمكن أن تتجاوز ${exam.total_grade}`,
      });
    }

    // التحقق من أن الدرجة موجبة
    if (grade < 0) {
      return res.status(400).json({
        error: 'درجة غير صحيحة',
        message: 'الدرجة لا يمكن أن تكون سالبة',
      });
    }

    // إضافة أو تحديث الدرجة
    const result = await pool.query(
      `INSERT INTO group_exam_grades 
       (exam_id, student_id, grade, notes) 
       VALUES ($1, $2, $3, $4) 
       ON CONFLICT (exam_id, student_id) 
       DO UPDATE SET 
         grade = EXCLUDED.grade,
         notes = EXCLUDED.notes,
         updated_at = NOW()
       RETURNING *`,
      [exam.id, student_id, grade, notes || null],
    );

    const gradeRecord = result.rows[0];

    res.status(201).json({
      message: 'تم إضافة الدرجة بنجاح',
      grade: {
        id: gradeRecord.id,
        exam_name: exam.name,
        group_name: exam.group_name,
        student_name: studentCheck.rows[0].name,
        student_id: student_id,
        grade: gradeRecord.grade,
        total_grade: exam.total_grade,
        notes: gradeRecord.notes,
        created_at: gradeRecord.created_at,
        updated_at: gradeRecord.updated_at,
      },
    });
  }),
);

// جلب درجات طالب معين في مجموعة معينة
router.get(
  '/group/:groupId/student/:studentId',
  authMiddleware(['teacher', 'admin']),
  asyncWrapper(async (req, res) => {
    const { groupId, studentId } = req.params;
    const teacherId = req.user!.id;

    // التحقق من أن المجموعة موجودة وأن المدرس مالكها
    const groupCheck = await pool.query(
      'SELECT id, name, teacher_id FROM study_groups WHERE id = $1',
      [groupId],
    );

    if (groupCheck.rows.length === 0) {
      return res.status(404).json({
        error: 'مجموعة غير موجودة',
        message: 'المجموعة غير موجودة',
      });
    }

    if (groupCheck.rows[0].teacher_id !== teacherId) {
      return res.status(403).json({
        error: 'غير مصرح',
        message: 'لا يمكنك الوصول لمجموعة مدرس آخر',
      });
    }

    // التحقق من أن الطالب موجود وهو طالب
    const studentCheck = await pool.query('SELECT id, name, role FROM users WHERE id = $1', [
      studentId,
    ]);

    if (studentCheck.rows.length === 0) {
      return res.status(404).json({
        error: 'طالب غير موجود',
        message: `الطالب برقم ${studentId} غير موجود في النظام`,
      });
    }

    if (studentCheck.rows[0].role !== 'student') {
      return res.status(400).json({
        error: 'دور خاطئ',
        message: `المستخدم برقم ${studentId} ليس طالب`,
      });
    }

    // التحقق من أن الطالب في المجموعة
    const studentInGroup = await pool.query(
      'SELECT 1 FROM group_students WHERE group_id = $1 AND student_id = $2',
      [groupId, studentId],
    );

    if (studentInGroup.rows.length === 0) {
      return res.status(400).json({
        error: 'طالب غير موجود في المجموعة',
        message: `الطالب ${studentCheck.rows[0].name} غير موجود في المجموعة "${groupCheck.rows[0].name}"`,
      });
    }

    // جلب درجات الطالب في المجموعة
    const grades = await pool.query(
      `SELECT geg.id, geg.grade, geg.notes, geg.created_at, geg.updated_at,
              ge.name as exam_name, ge.total_grade, ge.exam_date
       FROM group_exam_grades geg
       JOIN group_exams ge ON geg.exam_id = ge.id
       WHERE geg.student_id = $1 AND ge.group_id = $2
       ORDER BY ge.created_at DESC`,
      [studentId, groupId],
    );

    res.json({
      group: {
        id: groupCheck.rows[0].id,
        name: groupCheck.rows[0].name,
      },
      student: {
        id: studentCheck.rows[0].id,
        name: studentCheck.rows[0].name,
      },
      grades: grades.rows,
      total_exams: grades.rows.length,
      average_grade:
        grades.rows.length > 0
          ? grades.rows.reduce((sum, grade) => sum + parseFloat(grade.grade), 0) /
            grades.rows.length
          : 0,
    });
  }),
);

// جلب درجات طالب معين في جميع امتحانات المدرس
router.get(
  '/student/:studentId',
  authMiddleware(['teacher', 'admin']),
  asyncWrapper(async (req, res) => {
    const { studentId } = req.params;
    const teacherId = req.user!.id;

    // التحقق من أن الطالب موجود
    const studentCheck = await pool.query('SELECT id, name, role FROM users WHERE id = $1', [
      studentId,
    ]);

    if (studentCheck.rows.length === 0) {
      return res.status(404).json({
        error: 'طالب غير موجود',
        message: `الطالب برقم ${studentId} غير موجود في النظام`,
      });
    }

    if (studentCheck.rows[0].role !== 'student') {
      return res.status(400).json({
        error: 'دور خاطئ',
        message: `المستخدم برقم ${studentId} ليس طالب`,
      });
    }

    // جلب درجات الطالب في امتحانات المدرس
    const grades = await pool.query(
      `SELECT geg.id, geg.grade, geg.notes, geg.created_at, geg.updated_at,
              ge.name as exam_name, ge.total_grade, ge.exam_date,
              sg.name as group_name, sg.id as group_id
       FROM group_exam_grades geg
       JOIN group_exams ge ON geg.exam_id = ge.id
       JOIN study_groups sg ON ge.group_id = sg.id
       WHERE geg.student_id = $1 AND sg.teacher_id = $2
       ORDER BY ge.created_at DESC`,
      [studentId, teacherId],
    );

    res.json({
      student: {
        id: studentCheck.rows[0].id,
        name: studentCheck.rows[0].name,
      },
      grades: grades.rows,
      total_exams: grades.rows.length,
      average_grade:
        grades.rows.length > 0
          ? grades.rows.reduce((sum, grade) => sum + parseFloat(grade.grade), 0) /
            grades.rows.length
          : 0,
    });
  }),
);

// جلب درجات امتحان معين
router.get(
  '/exam/:examName',
  authMiddleware(['teacher', 'admin']),
  asyncWrapper(async (req, res) => {
    const { examName } = req.params;
    const teacherId = req.user!.id;

    // البحث عن الامتحان
    const examCheck = await pool.query(
      `SELECT ge.id, ge.name, ge.total_grade, ge.exam_date, ge.group_id, sg.name as group_name
       FROM group_exams ge
       JOIN study_groups sg ON ge.group_id = sg.id
       WHERE ge.name = $1 AND sg.teacher_id = $2`,
      [examName, teacherId],
    );

    if (examCheck.rows.length === 0) {
      return res.status(404).json({
        error: 'امتحان غير موجود',
        message: `لا يوجد امتحان باسم "${examName}" في مجموعاتك`,
      });
    }

    const exam = examCheck.rows[0];

    // جلب درجات الامتحان
    const grades = await pool.query(
      `SELECT geg.id, geg.grade, geg.notes, geg.created_at, geg.updated_at,
              u.name as student_name, u.id as student_id
       FROM group_exam_grades geg
       JOIN users u ON geg.student_id = u.id
       WHERE geg.exam_id = $1
       ORDER BY u.name`,
      [exam.id],
    );

    // جلب إحصائيات الامتحان
    const stats = await pool.query(
      `SELECT 
         COUNT(*) as total_students,
         COUNT(geg.student_id) as graded_students,
         AVG(geg.grade) as average_grade,
         MAX(geg.grade) as highest_grade,
         MIN(geg.grade) as lowest_grade
       FROM group_students gs
       LEFT JOIN group_exam_grades geg ON gs.student_id = geg.student_id AND geg.exam_id = $1
       WHERE gs.group_id = $2`,
      [exam.id, exam.group_id],
    );

    res.json({
      exam: {
        id: exam.id,
        name: exam.name,
        total_grade: exam.total_grade,
        exam_date: exam.exam_date,
        group_name: exam.group_name,
        group_id: exam.group_id,
      },
      grades: grades.rows,
      stats: stats.rows[0],
    });
  }),
);

// تحديث درجة طالب
router.put(
  '/:gradeId',
  authMiddleware(['teacher', 'admin']),
  asyncWrapper(async (req, res) => {
    const { gradeId } = req.params;
    const { grade, notes } = req.body;
    const teacherId = req.user!.id;

    // التحقق من وجود الدرجة وأنها تخص المدرس
    const gradeCheck = await pool.query(
      `SELECT geg.*, ge.name as exam_name, ge.total_grade, sg.teacher_id
       FROM group_exam_grades geg
       JOIN group_exams ge ON geg.exam_id = ge.id
       JOIN study_groups sg ON ge.group_id = sg.id
       WHERE geg.id = $1`,
      [gradeId],
    );

    if (gradeCheck.rows.length === 0) {
      return res.status(404).json({
        error: 'درجة غير موجودة',
        message: 'الدرجة غير موجودة',
      });
    }

    if (gradeCheck.rows[0].teacher_id !== teacherId) {
      return res.status(403).json({
        error: 'غير مصرح',
        message: 'لا يمكنك تعديل درجة لامتحان مدرس آخر',
      });
    }

    const gradeRecord = gradeCheck.rows[0];

    // التحقق من الدرجة الجديدة
    if (grade !== undefined) {
      if (grade > gradeRecord.total_grade) {
        return res.status(400).json({
          error: 'درجة غير صحيحة',
          message: `الدرجة لا يمكن أن تتجاوز ${gradeRecord.total_grade}`,
        });
      }

      if (grade < 0) {
        return res.status(400).json({
          error: 'درجة غير صحيحة',
          message: 'الدرجة لا يمكن أن تكون سالبة',
        });
      }
    }

    // تحديث الدرجة
    const updateFields = [];
    const values = [];
    let paramIndex = 1;

    if (grade !== undefined) {
      updateFields.push(`grade = $${paramIndex++}`);
      values.push(grade);
    }
    if (notes !== undefined) {
      updateFields.push(`notes = $${paramIndex++}`);
      values.push(notes);
    }

    updateFields.push(`updated_at = NOW()`);
    values.push(gradeId);

    const result = await pool.query(
      `UPDATE group_exam_grades 
       SET ${updateFields.join(', ')} 
       WHERE id = $${paramIndex++} 
       RETURNING *`,
      values,
    );

    const updatedGrade = result.rows[0];

    res.json({
      message: 'تم تحديث الدرجة بنجاح',
      grade: {
        id: updatedGrade.id,
        exam_name: gradeRecord.exam_name,
        grade: updatedGrade.grade,
        total_grade: gradeRecord.total_grade,
        notes: updatedGrade.notes,
        updated_at: updatedGrade.updated_at,
      },
    });
  }),
);

// حذف درجة طالب
router.delete(
  '/:gradeId',
  authMiddleware(['teacher', 'admin']),
  asyncWrapper(async (req, res) => {
    const { gradeId } = req.params;
    const teacherId = req.user!.id;

    // التحقق من وجود الدرجة وأنها تخص المدرس
    const gradeCheck = await pool.query(
      `SELECT geg.*, ge.name as exam_name, sg.teacher_id
       FROM group_exam_grades geg
       JOIN group_exams ge ON geg.exam_id = ge.id
       JOIN study_groups sg ON ge.group_id = sg.id
       WHERE geg.id = $1`,
      [gradeId],
    );

    if (gradeCheck.rows.length === 0) {
      return res.status(404).json({
        error: 'درجة غير موجودة',
        message: 'الدرجة غير موجودة',
      });
    }

    if (gradeCheck.rows[0].teacher_id !== teacherId) {
      return res.status(403).json({
        error: 'غير مصرح',
        message: 'لا يمكنك حذف درجة لامتحان مدرس آخر',
      });
    }

    // حذف الدرجة
    await pool.query('DELETE FROM group_exam_grades WHERE id = $1', [gradeId]);

    res.json({
      message: 'تم حذف الدرجة بنجاح',
    });
  }),
);

// جلب قائمة امتحانات المدرس
router.get(
  '/exams/list',
  authMiddleware(['teacher', 'admin']),
  asyncWrapper(async (req, res) => {
    const teacherId = req.user!.id;

    const exams = await pool.query(
      `SELECT ge.id, ge.name, ge.total_grade, ge.exam_date, ge.created_at,
              sg.name as group_name, sg.id as group_id,
              COUNT(geg.student_id) as graded_students,
              COUNT(gs.student_id) as total_students,
              AVG(geg.grade) as average_grade
       FROM group_exams ge
       JOIN study_groups sg ON ge.group_id = sg.id
       LEFT JOIN group_students gs ON sg.id = gs.group_id
       LEFT JOIN group_exam_grades geg ON ge.id = geg.exam_id AND gs.student_id = geg.student_id
       WHERE sg.teacher_id = $1
       GROUP BY ge.id, ge.name, ge.total_grade, ge.exam_date, ge.created_at, sg.name, sg.id
       ORDER BY ge.created_at DESC`,
      [teacherId],
    );

    res.json({
      exams: exams.rows,
    });
  }),
);

// إضافة درجة مباشرة للطالب في المجموعة (بدون امتحان فعلي)
router.post(
  '/direct',
  authMiddleware(['teacher', 'admin']),
  asyncWrapper(async (req, res) => {
    const { group_id, student_id, exam_name, grade, notes, total_grade } = req.body;
    const teacherId = req.user!.id;

    // التحقق من البيانات المطلوبة
    if (!group_id || !student_id || !exam_name || grade === undefined) {
      return res.status(400).json({
        error: 'بيانات مطلوبة',
        message: 'معرف المجموعة ومعرف الطالب واسم الامتحان والدرجة مطلوبان',
      });
    }

    // التحقق من أن المجموعة موجودة وأن المدرس مالكها
    const groupCheck = await pool.query(
      'SELECT id, name, teacher_id FROM study_groups WHERE id = $1',
      [group_id],
    );

    if (groupCheck.rows.length === 0) {
      return res.status(404).json({
        error: 'مجموعة غير موجودة',
        message: `المجموعة برقم ${group_id} غير موجودة في النظام`,
      });
    }

    if (groupCheck.rows[0].teacher_id !== teacherId) {
      return res.status(403).json({
        error: 'غير مصرح',
        message: 'لا يمكنك إضافة درجات لمجموعة مدرس آخر',
      });
    }

    // التحقق من أن الطالب موجود وهو طالب
    const studentCheck = await pool.query('SELECT id, name, role FROM users WHERE id = $1', [
      student_id,
    ]);

    if (studentCheck.rows.length === 0) {
      return res.status(404).json({
        error: 'طالب غير موجود',
        message: `الطالب برقم ${student_id} غير موجود في النظام`,
      });
    }

    if (studentCheck.rows[0].role !== 'student') {
      return res.status(400).json({
        error: 'دور خاطئ',
        message: `المستخدم برقم ${student_id} ليس طالب (الدور: ${studentCheck.rows[0].role})`,
      });
    }

    // التحقق من أن الطالب في المجموعة
    const studentInGroup = await pool.query(
      'SELECT 1 FROM group_students WHERE group_id = $1 AND student_id = $2',
      [group_id, student_id],
    );

    if (studentInGroup.rows.length === 0) {
      return res.status(400).json({
        error: 'طالب غير موجود في المجموعة',
        message: `الطالب ${studentCheck.rows[0].name} (ID: ${student_id}) غير موجود في المجموعة "${groupCheck.rows[0].name}"`,
      });
    }

    // استخدام total_grade المحدد أو 100 كقيمة افتراضية
    const examTotalGrade = total_grade || 100;

    // التحقق من أن الدرجة لا تتجاوز الدرجة الكلية
    if (grade > examTotalGrade) {
      return res.status(400).json({
        error: 'درجة غير صحيحة',
        message: `الدرجة لا يمكن أن تتجاوز ${examTotalGrade}`,
      });
    }

    // التحقق من أن الدرجة موجبة
    if (grade < 0) {
      return res.status(400).json({
        error: 'درجة غير صحيحة',
        message: 'الدرجة لا يمكن أن تكون سالبة',
      });
    }

    // إنشاء امتحان وهمي أو استخدام امتحان موجود
    let examId;
    const existingExam = await pool.query(
      'SELECT id FROM group_exams WHERE name = $1 AND group_id = $2',
      [exam_name, group_id],
    );

    if (existingExam.rows.length > 0) {
      examId = existingExam.rows[0].id;
    } else {
      // إنشاء امتحان وهمي
      const newExam = await pool.query(
        `INSERT INTO group_exams (name, group_id, total_grade, exam_date, created_at) 
         VALUES ($1, $2, $3, NOW(), NOW()) 
         RETURNING id`,
        [exam_name, group_id, examTotalGrade],
      );
      examId = newExam.rows[0].id;
    }

    // إضافة أو تحديث الدرجة
    const result = await pool.query(
      `INSERT INTO group_exam_grades 
       (exam_id, student_id, grade, notes) 
       VALUES ($1, $2, $3, $4) 
       ON CONFLICT (exam_id, student_id) 
       DO UPDATE SET 
         grade = EXCLUDED.grade,
         notes = EXCLUDED.notes,
         updated_at = NOW()
       RETURNING *`,
      [examId, student_id, grade, notes || null],
    );

    const gradeRecord = result.rows[0];

    res.status(201).json({
      message: 'تم إضافة الدرجة بنجاح',
      grade: {
        id: gradeRecord.id,
        exam_name: exam_name,
        group_name: groupCheck.rows[0].name,
        student_name: studentCheck.rows[0].name,
        student_id: student_id,
        grade: gradeRecord.grade,
        total_grade: examTotalGrade,
        notes: gradeRecord.notes,
        created_at: gradeRecord.created_at,
        updated_at: gradeRecord.updated_at,
      },
    });
  }),
);

// إضافة درجات متعددة مباشرة للطلاب في المجموعة (بدون امتحان فعلي)
router.post(
  '/direct/bulk',
  authMiddleware(['teacher', 'admin']),
  asyncWrapper(async (req, res) => {
    const { group_id, exam_name, grades, total_grade } = req.body;
    const teacherId = req.user!.id;

    // التحقق من البيانات المطلوبة
    if (!group_id || !exam_name || !grades || !Array.isArray(grades) || grades.length === 0) {
      return res.status(400).json({
        error: 'بيانات مطلوبة',
        message: 'معرف المجموعة واسم الامتحان وقائمة الدرجات مطلوبان',
      });
    }

    // التحقق من أن المجموعة موجودة وأن المدرس مالكها
    const groupCheck = await pool.query(
      'SELECT id, name, teacher_id FROM study_groups WHERE id = $1',
      [group_id],
    );

    if (groupCheck.rows.length === 0) {
      return res.status(404).json({
        error: 'مجموعة غير موجودة',
        message: `المجموعة برقم ${group_id} غير موجودة في النظام`,
      });
    }

    if (groupCheck.rows[0].teacher_id !== teacherId) {
      return res.status(403).json({
        error: 'غير مصرح',
        message: 'لا يمكنك إضافة درجات لمجموعة مدرس آخر',
      });
    }

    // استخدام total_grade المحدد أو 100 كقيمة افتراضية
    const examTotalGrade = total_grade || 100;

    // إنشاء امتحان وهمي أو استخدام امتحان موجود
    let examId;
    const existingExam = await pool.query(
      'SELECT id FROM group_exams WHERE name = $1 AND group_id = $2',
      [exam_name, group_id],
    );

    if (existingExam.rows.length > 0) {
      examId = existingExam.rows[0].id;
    } else {
      // إنشاء امتحان وهمي
      const newExam = await pool.query(
        `INSERT INTO group_exams (name, group_id, total_grade, exam_date, created_at) 
         VALUES ($1, $2, $3, NOW(), NOW()) 
         RETURNING id`,
        [exam_name, group_id, examTotalGrade],
      );
      examId = newExam.rows[0].id;
    }

    const results = [];
    const errors = [];

    // معالجة كل درجة
    for (let i = 0; i < grades.length; i++) {
      const { student_id, grade, notes } = grades[i];

      try {
        // التحقق من البيانات المطلوبة
        if (!student_id || grade === undefined) {
          errors.push({
            index: i,
            student_id,
            error: 'بيانات مطلوبة',
            message: 'معرف الطالب والدرجة مطلوبان',
          });
          continue;
        }

        // التحقق من أن الطالب موجود وهو طالب
        const studentCheck = await pool.query('SELECT id, name, role FROM users WHERE id = $1', [
          student_id,
        ]);

        if (studentCheck.rows.length === 0) {
          errors.push({
            index: i,
            student_id,
            error: 'طالب غير موجود',
            message: `الطالب برقم ${student_id} غير موجود في النظام`,
          });
          continue;
        }

        if (studentCheck.rows[0].role !== 'student') {
          errors.push({
            index: i,
            student_id,
            error: 'دور خاطئ',
            message: `المستخدم برقم ${student_id} ليس طالب`,
          });
          continue;
        }

        // التحقق من أن الطالب في المجموعة
        const studentInGroup = await pool.query(
          'SELECT 1 FROM group_students WHERE group_id = $1 AND student_id = $2',
          [group_id, student_id],
        );

        if (studentInGroup.rows.length === 0) {
          errors.push({
            index: i,
            student_id,
            error: 'طالب غير موجود في المجموعة',
            message: `الطالب ${studentCheck.rows[0].name} غير موجود في المجموعة "${groupCheck.rows[0].name}"`,
          });
          continue;
        }

        // التحقق من الدرجة
        if (grade > examTotalGrade) {
          errors.push({
            index: i,
            student_id,
            error: 'درجة غير صحيحة',
            message: `الدرجة لا يمكن أن تتجاوز ${examTotalGrade}`,
          });
          continue;
        }

        if (grade < 0) {
          errors.push({
            index: i,
            student_id,
            error: 'درجة غير صحيحة',
            message: 'الدرجة لا يمكن أن تكون سالبة',
          });
          continue;
        }

        // إضافة أو تحديث الدرجة
        const result = await pool.query(
          `INSERT INTO group_exam_grades 
           (exam_id, student_id, grade, notes) 
           VALUES ($1, $2, $3, $4) 
           ON CONFLICT (exam_id, student_id) 
           DO UPDATE SET 
             grade = EXCLUDED.grade,
             notes = EXCLUDED.notes,
             updated_at = NOW()
           RETURNING *`,
          [examId, student_id, grade, notes || null],
        );

        results.push({
          index: i,
          student_id,
          student_name: studentCheck.rows[0].name,
          grade: result.rows[0].grade,
          notes: result.rows[0].notes,
          status: 'success',
        });
      } catch (error: any) {
        errors.push({
          index: i,
          student_id,
          error: 'خطأ في المعالجة',
          message: error.message,
        });
      }
    }

    res.status(201).json({
      message: `تم معالجة ${grades.length} درجة`,
      exam: {
        name: exam_name,
        group_name: groupCheck.rows[0].name,
        total_grade: examTotalGrade,
      },
      success_count: results.length,
      error_count: errors.length,
      results,
      errors,
    });
  }),
);

// إضافة درجات متعددة للطلاب دفعة واحدة
router.post(
  '/bulk',
  authMiddleware(['teacher', 'admin']),
  asyncWrapper(async (req, res) => {
    const { exam_name, grades } = req.body;
    const teacherId = req.user!.id;

    // التحقق من البيانات المطلوبة
    if (!exam_name || !grades || !Array.isArray(grades) || grades.length === 0) {
      return res.status(400).json({
        error: 'بيانات مطلوبة',
        message: 'اسم الامتحان وقائمة الدرجات مطلوبان',
      });
    }

    // البحث عن الامتحان
    const examCheck = await pool.query(
      `SELECT ge.id, ge.name, ge.total_grade, ge.group_id, sg.name as group_name
       FROM group_exams ge
       JOIN study_groups sg ON ge.group_id = sg.id
       WHERE ge.name = $1 AND sg.teacher_id = $2`,
      [exam_name, teacherId],
    );

    if (examCheck.rows.length === 0) {
      return res.status(404).json({
        error: 'امتحان غير موجود',
        message: `لا يوجد امتحان باسم "${exam_name}" في مجموعاتك`,
      });
    }

    const exam = examCheck.rows[0];
    const results = [];
    const errors = [];

    // معالجة كل درجة
    for (let i = 0; i < grades.length; i++) {
      const { student_id, grade, notes } = grades[i];

      try {
        // التحقق من البيانات المطلوبة
        if (!student_id || grade === undefined) {
          errors.push({
            index: i,
            student_id,
            error: 'بيانات مطلوبة',
            message: 'معرف الطالب والدرجة مطلوبان',
          });
          continue;
        }

        // التحقق من أن الطالب موجود وهو طالب
        const studentCheck = await pool.query('SELECT id, name, role FROM users WHERE id = $1', [
          student_id,
        ]);

        if (studentCheck.rows.length === 0) {
          errors.push({
            index: i,
            student_id,
            error: 'طالب غير موجود',
            message: `الطالب برقم ${student_id} غير موجود في النظام`,
          });
          continue;
        }

        if (studentCheck.rows[0].role !== 'student') {
          errors.push({
            index: i,
            student_id,
            error: 'دور خاطئ',
            message: `المستخدم برقم ${student_id} ليس طالب`,
          });
          continue;
        }

        // التحقق من أن الطالب في المجموعة
        const studentInGroup = await pool.query(
          'SELECT 1 FROM group_students WHERE group_id = $1 AND student_id = $2',
          [exam.group_id, student_id],
        );

        if (studentInGroup.rows.length === 0) {
          errors.push({
            index: i,
            student_id,
            error: 'طالب غير موجود في المجموعة',
            message: `الطالب ${studentCheck.rows[0].name} غير موجود في المجموعة "${exam.group_name}"`,
          });
          continue;
        }

        // التحقق من الدرجة
        if (grade > exam.total_grade) {
          errors.push({
            index: i,
            student_id,
            error: 'درجة غير صحيحة',
            message: `الدرجة لا يمكن أن تتجاوز ${exam.total_grade}`,
          });
          continue;
        }

        if (grade < 0) {
          errors.push({
            index: i,
            student_id,
            error: 'درجة غير صحيحة',
            message: 'الدرجة لا يمكن أن تكون سالبة',
          });
          continue;
        }

        // إضافة أو تحديث الدرجة
        const result = await pool.query(
          `INSERT INTO group_exam_grades 
           (exam_id, student_id, grade, notes) 
           VALUES ($1, $2, $3, $4) 
           ON CONFLICT (exam_id, student_id) 
           DO UPDATE SET 
             grade = EXCLUDED.grade,
             notes = EXCLUDED.notes,
             updated_at = NOW()
           RETURNING *`,
          [exam.id, student_id, grade, notes || null],
        );

        results.push({
          index: i,
          student_id,
          student_name: studentCheck.rows[0].name,
          grade: result.rows[0].grade,
          notes: result.rows[0].notes,
          status: 'success',
        });
      } catch (error: any) {
        errors.push({
          index: i,
          student_id,
          error: 'خطأ في المعالجة',
          message: error.message,
        });
      }
    }

    res.status(201).json({
      message: `تم معالجة ${grades.length} درجة`,
      exam: {
        name: exam.name,
        group_name: exam.group_name,
        total_grade: exam.total_grade,
      },
      success_count: results.length,
      error_count: errors.length,
      results,
      errors,
    });
  }),
);

// جلب قائمة الطلاب في مجموعة معينة
router.get(
  '/group/:groupId/students',
  authMiddleware(['teacher', 'admin']),
  asyncWrapper(async (req, res) => {
    const { groupId } = req.params;
    const teacherId = req.user!.id;

    // التحقق من ملكية المجموعة
    const groupCheck = await pool.query(
      'SELECT id, name, teacher_id FROM study_groups WHERE id = $1',
      [groupId],
    );

    if (groupCheck.rows.length === 0) {
      return res.status(404).json({
        error: 'مجموعة غير موجودة',
        message: 'المجموعة غير موجودة',
      });
    }

    if (groupCheck.rows[0].teacher_id !== teacherId) {
      return res.status(403).json({
        error: 'غير مصرح',
        message: 'لا يمكنك الوصول لمجموعة مدرس آخر',
      });
    }

    const students = await pool.query(
      `SELECT gs.student_id, gs.joined_at,
              u.name as student_name, u.email, u.phone
       FROM group_students gs
       JOIN users u ON gs.student_id = u.id
       WHERE gs.group_id = $1
       ORDER BY u.name`,
      [groupId],
    );

    res.json({
      group: {
        id: groupCheck.rows[0].id,
        name: groupCheck.rows[0].name,
      },
      students: students.rows,
    });
  }),
);

// تقرير درجات المجموعة
router.get(
  '/group/:groupId/report',
  authMiddleware(['teacher', 'admin']),
  asyncWrapper(async (req, res) => {
    const { groupId } = req.params;
    const teacherId = req.user!.id;

    // التحقق من ملكية المجموعة
    const groupCheck = await pool.query(
      'SELECT id, name, teacher_id FROM study_groups WHERE id = $1',
      [groupId],
    );

    if (groupCheck.rows.length === 0) {
      return res.status(404).json({
        error: 'مجموعة غير موجودة',
        message: 'المجموعة غير موجودة',
      });
    }

    if (groupCheck.rows[0].teacher_id !== teacherId) {
      return res.status(403).json({
        error: 'غير مصرح',
        message: 'لا يمكنك الوصول لمجموعة مدرس آخر',
      });
    }

    // جلب إحصائيات المجموعة
    const groupStats = await pool.query(
      `SELECT 
         COUNT(DISTINCT gs.student_id) as total_students,
         COUNT(DISTINCT ge.id) as total_exams,
         COUNT(geg.id) as total_grades,
         AVG(geg.grade) as average_grade,
         MAX(geg.grade) as highest_grade,
         MIN(geg.grade) as lowest_grade
       FROM group_students gs
       LEFT JOIN group_exams ge ON ge.group_id = gs.group_id
       LEFT JOIN group_exam_grades geg ON ge.id = geg.exam_id AND gs.student_id = geg.student_id
       WHERE gs.group_id = $1`,
      [groupId],
    );

    // جلب درجات الطلاب في جميع الامتحانات
    const studentGrades = await pool.query(
      `SELECT 
         gs.student_id,
         u.name as student_name,
         COUNT(geg.id) as exams_taken,
         AVG(geg.grade) as average_grade,
         MAX(geg.grade) as highest_grade,
         MIN(geg.grade) as lowest_grade,
         SUM(geg.grade) as total_grade
       FROM group_students gs
       JOIN users u ON gs.student_id = u.id
       LEFT JOIN group_exam_grades geg ON gs.student_id = geg.student_id
       LEFT JOIN group_exams ge ON geg.exam_id = ge.id AND ge.group_id = gs.group_id
       WHERE gs.group_id = $1
       GROUP BY gs.student_id, u.name
       ORDER BY average_grade DESC NULLS LAST`,
      [groupId],
    );

    // جلب تفاصيل الامتحانات
    const examDetails = await pool.query(
      `SELECT 
         ge.id,
         ge.name,
         ge.total_grade,
         ge.exam_date,
         COUNT(geg.student_id) as graded_students,
         AVG(geg.grade) as average_grade,
         MAX(geg.grade) as highest_grade,
         MIN(geg.grade) as lowest_grade
       FROM group_exams ge
       LEFT JOIN group_exam_grades geg ON ge.id = geg.exam_id
       WHERE ge.group_id = $1
       GROUP BY ge.id, ge.name, ge.total_grade, ge.exam_date
       ORDER BY ge.exam_date DESC`,
      [groupId],
    );

    res.json({
      group: {
        id: groupCheck.rows[0].id,
        name: groupCheck.rows[0].name,
      },
      stats: groupStats.rows[0],
      student_grades: studentGrades.rows,
      exam_details: examDetails.rows,
    });
  }),
);

// تقرير درجات امتحان معين
router.get(
  '/exam/:examName/report',
  authMiddleware(['teacher', 'admin']),
  asyncWrapper(async (req, res) => {
    const { examName } = req.params;
    const teacherId = req.user!.id;

    // البحث عن الامتحان
    const examCheck = await pool.query(
      `SELECT ge.id, ge.name, ge.total_grade, ge.exam_date, ge.group_id, sg.name as group_name
       FROM group_exams ge
       JOIN study_groups sg ON ge.group_id = sg.id
       WHERE ge.name = $1 AND sg.teacher_id = $2`,
      [examName, teacherId],
    );

    if (examCheck.rows.length === 0) {
      return res.status(404).json({
        error: 'امتحان غير موجود',
        message: `لا يوجد امتحان باسم "${examName}" في مجموعاتك`,
      });
    }

    const exam = examCheck.rows[0];

    // جلب إحصائيات الامتحان
    const examStats = await pool.query(
      `SELECT 
         COUNT(gs.student_id) as total_students,
         COUNT(geg.student_id) as graded_students,
         AVG(geg.grade) as average_grade,
         MAX(geg.grade) as highest_grade,
         MIN(geg.grade) as lowest_grade,
         COUNT(CASE WHEN geg.grade >= (ge.total_grade * 0.6) THEN 1 END) as passed_students,
         COUNT(CASE WHEN geg.grade < (ge.total_grade * 0.6) THEN 1 END) as failed_students
       FROM group_students gs
       LEFT JOIN group_exam_grades geg ON gs.student_id = geg.student_id AND geg.exam_id = $1
       JOIN group_exams ge ON ge.id = $1
       WHERE gs.group_id = $2`,
      [exam.id, exam.group_id],
    );

    // جلب درجات الطلاب مرتبة
    const studentGrades = await pool.query(
      `SELECT 
         geg.id,
         geg.grade,
         geg.notes,
         geg.created_at,
         geg.updated_at,
         u.name as student_name,
         u.id as student_id,
         CASE 
           WHEN geg.grade >= (ge.total_grade * 0.6) THEN 'ناجح'
           WHEN geg.grade IS NULL THEN 'لم يختبر'
           ELSE 'راسب'
         END as status
       FROM group_students gs
       JOIN users u ON gs.student_id = u.id
       LEFT JOIN group_exam_grades geg ON gs.student_id = geg.student_id AND geg.exam_id = $1
       JOIN group_exams ge ON ge.id = $1
       WHERE gs.group_id = $2
       ORDER BY geg.grade DESC NULLS LAST`,
      [exam.id, exam.group_id],
    );

    // جلب توزيع الدرجات
    const gradeDistribution = await pool.query(
      `SELECT 
         CASE 
           WHEN geg.grade >= 90 THEN '90-100'
           WHEN geg.grade >= 80 THEN '80-89'
           WHEN geg.grade >= 70 THEN '70-79'
           WHEN geg.grade >= 60 THEN '60-69'
           WHEN geg.grade >= 50 THEN '50-59'
           WHEN geg.grade IS NOT NULL THEN 'أقل من 50'
           ELSE 'لم يختبر'
         END as grade_range,
         COUNT(*) as student_count
       FROM group_students gs
       LEFT JOIN group_exam_grades geg ON gs.student_id = geg.student_id AND geg.exam_id = $1
       WHERE gs.group_id = $2
       GROUP BY 
         CASE 
           WHEN geg.grade >= 90 THEN '90-100'
           WHEN geg.grade >= 80 THEN '80-89'
           WHEN geg.grade >= 70 THEN '70-79'
           WHEN geg.grade >= 60 THEN '60-69'
           WHEN geg.grade >= 50 THEN '50-59'
           WHEN geg.grade IS NOT NULL THEN 'أقل من 50'
           ELSE 'لم يختبر'
         END
       ORDER BY 
         CASE 
           WHEN geg.grade >= 90 THEN 1
           WHEN geg.grade >= 80 THEN 2
           WHEN geg.grade >= 70 THEN 3
           WHEN geg.grade >= 60 THEN 4
           WHEN geg.grade >= 50 THEN 5
           WHEN geg.grade IS NOT NULL THEN 6
           ELSE 7
         END`,
      [exam.id, exam.group_id],
    );

    res.json({
      exam: {
        id: exam.id,
        name: exam.name,
        total_grade: exam.total_grade,
        exam_date: exam.exam_date,
        group_name: exam.group_name,
        group_id: exam.group_id,
      },
      stats: examStats.rows[0],
      student_grades: studentGrades.rows,
      grade_distribution: gradeDistribution.rows,
    });
  }),
);
