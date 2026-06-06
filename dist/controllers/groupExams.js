"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const router = (0, express_1.Router)();
// ===== نظام امتحان المجموعة معطل مؤقتاً =====
// لإعادة تفعيل النظام، احذف هذا الكود
// Middleware لتعطيل جميع نقاط النهاية
router.use('*', (req, res) => {
    res.status(503).json({
        error: 'نظام امتحان المجموعة معطل مؤقتاً',
        message: 'تم إلغاء نظام امتحان المجموعة بناءً على طلب الإدارة',
        details: 'لإعادة تفعيل النظام، يرجى التواصل مع المطور',
    });
});
// ===== الكود الأصلي (معطل) =====
/*
// 1. إنشاء امتحان جديد للمجموعة
router.post('/',
  authMiddleware(['admin', 'teacher']),
  async (req: Request, res: Response) => {
    try {
      const { group_id, name, total_grade, exam_date } = req.body;
      const teacherId = (req as any).user.id;

      if (!group_id || !name) {
        return res.status(400).json({
          error: 'معرف المجموعة واسم الامتحان مطلوبان'
        });
      }

      const examData: GroupExamData = {
        group_id: parseInt(group_id),
        name,
        total_grade: total_grade ? parseInt(total_grade) : 100,
        exam_date: exam_date || null
      };

      const exam = await GroupExamService.createGroupExam(examData);

      res.status(201).json({
        message: 'تم إنشاء الامتحان بنجاح',
        exam
      });
    } catch (error) {
      logger.error('Error creating group exam:', error);
      res.status(500).json({
        error: 'خطأ في إنشاء الامتحان',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
);

// 2. تحديث امتحان
router.put('/:id',
  authMiddleware(['admin', 'teacher']),
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { name, total_grade, exam_date } = req.body;
      const teacherId = (req as any).user.id;

      const updateData: Partial<GroupExamData> = {};
      if (name !== undefined) updateData.name = name;
      if (total_grade !== undefined) updateData.total_grade = parseInt(total_grade);
      if (exam_date !== undefined) updateData.exam_date = exam_date;

      const exam = await GroupExamService.updateGroupExam(parseInt(id), teacherId, updateData);

      res.json({
        message: 'تم تحديث الامتحان بنجاح',
        exam
      });
    } catch (error) {
      logger.error('Error updating group exam:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'خطأ في تحديث الامتحان'
      });
    }
  }
);

// 3. حذف امتحان
router.delete('/:id',
  authMiddleware(['admin', 'teacher']),
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const teacherId = (req as any).user.id;

      const exam = await GroupExamService.deleteGroupExam(parseInt(id), teacherId);

      res.json({ message: 'تم حذف الامتحان بنجاح' });
    } catch (error) {
      logger.error('Error deleting group exam:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'خطأ في حذف الامتحان'
      });
    }
  }
);

// 4. جلب امتحان بواسطة ID
router.get('/:id',
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const exam = await GroupExamService.getGroupExamById(parseInt(id));

      if (!exam) {
        return res.status(404).json({ error: 'الامتحان غير موجود' });
      }

      res.json({ exam });
    } catch (error) {
      logger.error('Error fetching group exam:', error);
      res.status(500).json({ error: 'خطأ في جلب الامتحان' });
    }
  }
);

// 5. جلب جميع امتحانات المجموعة
router.get('/group/:groupId',
  async (req: Request, res: Response) => {
    try {
      const { groupId } = req.params;
      const exams = await GroupExamService.getGroupExams(parseInt(groupId));

      res.json({ exams });
    } catch (error) {
      logger.error('Error fetching group exams:', error);
      res.status(500).json({ error: 'خطأ في جلب امتحانات المجموعة' });
    }
  }
);

// 6. إضافة درجة طالب في امتحان
router.post('/:examId/grades',
  authMiddleware(['admin', 'teacher']),
  async (req: Request, res: Response) => {
    try {
      const { examId } = req.params;
      const { student_id, grade, notes } = req.body;
      const teacherId = (req as any).user.id;

      if (!student_id || grade === undefined) {
        return res.status(400).json({
          error: 'معرف الطالب والدرجة مطلوبان'
        });
      }

      const gradeData: ExamGradeData = {
        exam_id: parseInt(examId),
        student_id: parseInt(student_id),
        grade: parseFloat(grade),
        notes: notes || null
      };

      const result = await GroupExamService.addStudentGrade(gradeData, teacherId);

      res.status(201).json({
        message: 'تم إضافة الدرجة بنجاح',
        grade: result
      });
    } catch (error) {
      logger.error('Error adding student grade:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'خطأ في إضافة الدرجة'
      });
    }
  }
);

// 7. تحديث درجة طالب
router.put('/:examId/grades/:studentId',
  authMiddleware(['admin', 'teacher']),
  async (req: Request, res: Response) => {
    try {
      const { examId, studentId } = req.params;
      const { grade, notes } = req.body;
      const teacherId = (req as any).user.id;

      const updateData: { grade?: number; notes?: string } = {};
      if (grade !== undefined) updateData.grade = parseFloat(grade);
      if (notes !== undefined) updateData.notes = notes;

      const result = await GroupExamService.updateStudentGrade(
        parseInt(examId),
        parseInt(studentId),
        teacherId,
        updateData
      );

      res.json({
        message: 'تم تحديث الدرجة بنجاح',
        grade: result
      });
    } catch (error) {
      logger.error('Error updating student grade:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'خطأ في تحديث الدرجة'
      });
    }
  }
);

// 8. حذف درجة طالب
router.delete('/:examId/grades/:studentId',
  authMiddleware(['admin', 'teacher']),
  async (req: Request, res: Response) => {
    try {
      const { examId, studentId } = req.params;
      const teacherId = (req as any).user.id;

      const result = await GroupExamService.deleteStudentGrade(
        parseInt(examId),
        parseInt(studentId),
        teacherId
      );

      res.json({
        message: 'تم حذف الدرجة بنجاح',
        grade: result
      });
    } catch (error) {
      logger.error('Error deleting student grade:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'خطأ في حذف الدرجة'
      });
    }
  }
);

// 9. جلب درجات امتحان معين
router.get('/:examId/grades',
  async (req: Request, res: Response) => {
    try {
      const { examId } = req.params;
      const grades = await GroupExamService.getExamGrades(parseInt(examId));

      res.json({ grades });
    } catch (error) {
      logger.error('Error fetching exam grades:', error);
      res.status(500).json({ error: 'خطأ في جلب درجات الامتحان' });
    }
  }
);

// 10. جلب درجات طالب في جميع امتحانات المجموعة
router.get('/group/:groupId/student/:studentId/grades',
  async (req: Request, res: Response) => {
    try {
      const { groupId, studentId } = req.params;
      const grades = await GroupExamService.getStudentGrades(
        parseInt(groupId),
        parseInt(studentId)
      );

      res.json({ grades });
    } catch (error) {
      logger.error('Error fetching student grades:', error);
      res.status(500).json({ error: 'خطأ في جلب درجات الطالب' });
    }
  }
);

// 11. جلب إحصائيات امتحان
router.get('/:examId/stats',
  async (req: Request, res: Response) => {
    try {
      const { examId } = req.params;
      const stats = await GroupExamService.getExamStats(parseInt(examId));

      res.json({ stats });
    } catch (error) {
      logger.error('Error fetching exam stats:', error);
      res.status(500).json({ error: 'خطأ في جلب إحصائيات الامتحان' });
    }
  }
);

// 12. جلب طلاب المجموعة (للتحقق)
router.get('/group/:groupId/students',
  async (req: Request, res: Response) => {
    try {
      const { groupId } = req.params;
      const students = await GroupExamService.getGroupStudents(parseInt(groupId));

      res.json({ students });
    } catch (error) {
      logger.error('Error fetching group students:', error);
      res.status(500).json({ error: 'خطأ في جلب طلاب المجموعة' });
    }
  }
);

// 13. جلب جميع الطلاب في النظام (للتحقق)
router.get('/students/all',
  async (req: Request, res: Response) => {
    try {
      const students = await GroupExamService.getAllStudents();

      res.json({ students });
    } catch (error) {
      logger.error('Error fetching all students:', error);
      res.status(500).json({ error: 'خطأ في جلب الطلاب' });
    }
  }
);

// 13. إصلاح مشكلة عدم تطابق ID الطلاب في المجموعة
router.post('/:examId/fix-student-ids',
  authMiddleware(['admin', 'teacher']),
  async (req: Request, res: Response) => {
    try {
      const { examId } = req.params;
      const { student_mappings } = req.body; // Array of {old_id: number, new_id: number}
      const teacherId = (req as any).user.id;

      // التحقق من ملكية الامتحان
      const exam = await GroupExamService.getGroupExamById(parseInt(examId));
      if (!exam) {
        return res.status(404).json({ error: 'الامتحان غير موجود' });
      }

      if (exam.teacher_id !== teacherId) {
        return res.status(403).json({ error: 'لا يمكنك تعديل امتحان مدرس آخر' });
      }

      const result = await GroupExamService.fixStudentIds(parseInt(examId), student_mappings);

      res.json({
        message: 'تم إصلاح ID الطلاب بنجاح',
        fixed_count: result.fixed_count,
        details: result.details
      });
    } catch (error) {
      logger.error('Error fixing student IDs:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'خطأ في إصلاح ID الطلاب'
      });
    }
  }
);

// 14. جلب معلومات تشخيص مشكلة ID الطلاب
router.get('/:examId/diagnose-student-ids',
  authMiddleware(['admin', 'teacher']),
  async (req: Request, res: Response) => {
    try {
      const { examId } = req.params;
      const teacherId = (req as any).user.id;

      // التحقق من ملكية الامتحان
      const exam = await GroupExamService.getGroupExamById(parseInt(examId));
      if (!exam) {
        return res.status(404).json({ error: 'الامتحان غير موجود' });
      }

      if (exam.teacher_id !== teacherId) {
        return res.status(403).json({ error: 'لا يمكنك الوصول لامتحان مدرس آخر' });
      }

      const diagnosis = await GroupExamService.diagnoseStudentIds(parseInt(examId));

      res.json({
        exam_info: {
          id: exam.id,
          name: exam.name,
          group_id: exam.group_id,
          group_name: exam.group_name
        },
        diagnosis
      });
    } catch (error) {
      logger.error('Error diagnosing student IDs:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'خطأ في تشخيص ID الطلاب'
      });
    }
  }
);

// 15. إصلاح مشكلة إضافة مدرس بدلاً من طالب في المجموعة
router.post('/:examId/fix-wrong-role-students',
  authMiddleware(['admin', 'teacher']),
  async (req: Request, res: Response) => {
    try {
      const { examId } = req.params;
      const { replacements } = req.body; // Array of {wrong_id: number, correct_student_data: {name, phone, parent_phone, payment_status, payment_amount}}
      const teacherId = (req as any).user.id;

      // التحقق من ملكية الامتحان
      const exam = await GroupExamService.getGroupExamById(parseInt(examId));
      if (!exam) {
        return res.status(404).json({ error: 'الامتحان غير موجود' });
      }

      if (exam.teacher_id !== teacherId) {
        return res.status(403).json({ error: 'لا يمكنك تعديل امتحان مدرس آخر' });
      }

      const result = await GroupExamService.fixWrongRoleStudents(parseInt(examId), replacements);

      res.json({
        message: 'تم إصلاح مشكلة الطلاب ذوي الأدوار الخاطئة بنجاح',
        fixed_count: result.fixed_count,
        details: result.details
      });
    } catch (error) {
      logger.error('Error fixing wrong role students:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'خطأ في إصلاح الطلاب ذوي الأدوار الخاطئة'
      });
    }
  }
);
*/
exports.default = router;
