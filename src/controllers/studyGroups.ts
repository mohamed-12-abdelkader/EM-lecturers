import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/authentication';
import { StudyGroupService, StudyGroupData } from '../services/studyGroups';
import { logger } from '../utils';
import pool from '../db/pool';
import * as QRCode from 'qrcode';

const router = Router();

// 1. إنشاء مجموعة دراسية جديدة
router.post('/', authMiddleware(['admin', 'teacher']), async (req: Request, res: Response) => {
  try {
    const { name, start_time, end_time, days, grade_id } = req.body;
    const teacherId = (req as any).user.id;

    if (!name || !start_time || !end_time || !days) {
      return res.status(400).json({
        error: 'اسم المجموعة ووقت البداية والنهاية وأيام المجموعة مطلوبة',
      });
    }

    const groupData: StudyGroupData = {
      teacher_id: teacherId,
      name,
      start_time,
      end_time,
      days,
      grade_id: grade_id ? parseInt(grade_id) : undefined,
    };

    const group = await StudyGroupService.createStudyGroup(groupData);

    res.status(201).json({
      message: 'تم إنشاء المجموعة بنجاح',
      group,
    });
  } catch (error) {
    logger.error('Error creating study group:', error);
    res.status(500).json({
      error: 'خطأ في إنشاء المجموعة',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// 2. تحديث مجموعة دراسية
router.put('/:id', authMiddleware(['admin', 'teacher']), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, start_time, end_time, days, grade_id } = req.body;
    const teacherId = (req as any).user.id;

    const updateData: Partial<StudyGroupData> = {};
    if (name !== undefined) updateData.name = name;
    if (start_time !== undefined) updateData.start_time = start_time;
    if (end_time !== undefined) updateData.end_time = end_time;
    if (days !== undefined) updateData.days = days;
    if (grade_id !== undefined) updateData.grade_id = grade_id ? parseInt(grade_id) : undefined;

    const group = await StudyGroupService.updateStudyGroup(parseInt(id), teacherId, updateData);

    if (!group) {
      return res.status(404).json({ error: 'المجموعة غير موجودة أو لا يمكنك تعديلها' });
    }

    res.json({
      message: 'تم تحديث المجموعة بنجاح',
      group,
    });
  } catch (error) {
    logger.error('Error updating study group:', error);
    res.status(500).json({ error: 'خطأ في تحديث المجموعة' });
  }
});

// 3. حذف مجموعة دراسية
router.delete('/:id', authMiddleware(['admin', 'teacher']), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const teacherId = (req as any).user.id;

    const group = await StudyGroupService.deleteStudyGroup(parseInt(id), teacherId);

    if (!group) {
      return res.status(404).json({ error: 'المجموعة غير موجودة أو لا يمكنك حذفها' });
    }

    res.json({ message: 'تم حذف المجموعة بنجاح' });
  } catch (error) {
    logger.error('Error deleting study group:', error);
    res.status(500).json({ error: 'خطأ في حذف المجموعة' });
  }
});

// 4. جلب جميع المجموعات
router.get('/all', async (req: Request, res: Response) => {
  try {
    const groups = await StudyGroupService.getAllGroups();

    res.json({ groups });
  } catch (error) {
    logger.error('Error fetching all groups:', error);
    res.status(500).json({
      error: 'خطأ في جلب المجموعات',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// 5. جلب جميع مجموعات المدرس
router.get(
  '/teacher/my-groups',
  authMiddleware(['admin', 'teacher']),
  async (req: Request, res: Response) => {
    try {
      const teacherId = (req as any).user.id;
      const groups = await StudyGroupService.getTeacherGroups(teacherId);

      res.json({ groups });
    } catch (error) {
      logger.error('Error fetching teacher groups:', error);
      res.status(500).json({
        error: 'خطأ في جلب مجموعات المدرس',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  },
);

// 5.b جلب جميع طلاب المدرس عبر كل المجموعات مع الصف الدراسي لكل طالب
router.get(
  '/teacher/my-students',
  authMiddleware(['admin', 'teacher']),
  async (req: Request, res: Response) => {
    try {
      const teacherId = (req as any).user.id;

      const result = await pool.query(
        `SELECT 
           u.id AS student_id,
           u.name AS student_name,
           u.phone,
           u.parent_phone,
           ARRAY_AGG(DISTINCT g.id) FILTER (WHERE g.id IS NOT NULL) AS grade_ids,
           ARRAY_AGG(DISTINCT g.name) FILTER (WHERE g.id IS NOT NULL) AS grade_names
         FROM study_groups sg
         JOIN group_students gs ON gs.group_id = sg.id
         JOIN users u ON u.id = gs.student_id
         LEFT JOIN grades g ON g.id = sg.grade_id
         WHERE sg.teacher_id = $1
         GROUP BY u.id, u.name, u.phone, u.parent_phone
         ORDER BY u.name`,
        [teacherId],
      );

      const students = result.rows.map((row) => ({
        id: row.student_id,
        name: row.student_name,
        phone: row.phone,
        parent_phone: row.parent_phone,
        grades:
          Array.isArray(row.grade_ids) && row.grade_ids.length
            ? row.grade_ids.map((id: number, idx: number) => ({ id, name: row.grade_names[idx] }))
            : [],
      }));

      res.json({ students, total: students.length });
    } catch (error) {
      logger.error('Error fetching teacher students:', error);
      res.status(500).json({ error: 'خطأ في جلب طلاب المدرس' });
    }
  },
);

// 6. جلب مجموعة بواسطة ID
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const group = await StudyGroupService.getStudyGroupById(parseInt(id));

    if (!group) {
      return res.status(404).json({ error: 'المجموعة غير موجودة' });
    }

    // جلب عدد الطلاب
    const studentsCount = await StudyGroupService.getGroupStudentsCount(parseInt(id));

    res.json({
      group: {
        ...group,
        students_count: studentsCount,
      },
    });
  } catch (error) {
    logger.error('Error fetching study group:', error);
    res.status(500).json({
      error: 'خطأ في جلب المجموعة',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// 7. إضافة طالب للمجموعة — الاسم مطلوب، رقم التليفون وولي الأمر اختياري
router.post(
  '/:groupId/students',
  authMiddleware(['admin', 'teacher']),
  async (req: Request, res: Response) => {
    try {
      const { groupId } = req.params;
      const { student_id, name, phone, parent_phone } = req.body as {
        student_id?: string | number;
        name?: string;
        phone?: string;
        parent_phone?: string;
      };
      const teacherId = (req as any).user.id;
      const tenantId = req.tenant!.id;

      // التحقق من ملكية المجموعة
      const group = await StudyGroupService.getStudyGroupById(parseInt(groupId));
      if (!group) {
        return res.status(404).json({ error: 'المجموعة غير موجودة' });
      }
      if (group.teacher_id !== teacherId) {
        return res.status(403).json({ error: 'لا يمكنك إضافة طالب لمجموعة مدرس آخر' });
      }

      let studentId: number | undefined;

      if (student_id) {
        studentId = parseInt(String(student_id));
        const existingStudent = await pool.query(
          'SELECT id FROM users WHERE id = $1 AND role = $2 AND tenant_id = $3',
          [studentId, 'student', tenantId],
        );
        if (existingStudent.rows.length === 0) {
          return res.status(404).json({ error: 'الطالب غير موجود' });
        }
      } else {
        // إضافة بالاسم فقط — phone و parent_phone اختياري
        if (!name || name.trim().length === 0) {
          return res.status(400).json({ error: 'name مطلوب عند عدم إرسال student_id' });
        }

        // لو فيه هاتف مرسل، جرّب تبحث عن طالب بنفس الرقم لتجنب التكرار
        if (phone) {
          const duplicate = await StudyGroupService.findStudentByPhone(phone, tenantId);
          if (duplicate) {
            studentId = duplicate.id;
          }
        }

        if (!studentId) {
          const newStudent = await StudyGroupService.createStudentMinimal(
            name,
            phone,
            parent_phone,
            tenantId,
          );
          studentId = newStudent.id;
        }
      }

      // التحقق من عدم وجود الطالب في المجموعة
      const isStudentInGroup = await StudyGroupService.isStudentInGroup(
        parseInt(groupId),
        studentId!,
      );
      if (isStudentInGroup) {
        return res.status(400).json({ error: 'الطالب موجود بالفعل في المجموعة' });
      }

      const student = await StudyGroupService.addStudentToGroup(parseInt(groupId), studentId!);

      res.status(201).json({
        message: 'تم إضافة الطالب للمجموعة بنجاح',
        student,
      });
    } catch (error) {
      logger.error('Error adding student to group:', error);
      res.status(500).json({
        error: 'خطأ في إضافة الطالب للمجموعة',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  },
);

// 8. إزالة طالب من المجموعة
router.delete(
  '/:groupId/students/:studentId',
  authMiddleware(['admin', 'teacher']),
  async (req: Request, res: Response) => {
    try {
      const { groupId, studentId } = req.params;
      const teacherId = (req as any).user.id;

      // التحقق من ملكية المجموعة
      const group = await StudyGroupService.getStudyGroupById(parseInt(groupId));
      if (!group) {
        return res.status(404).json({ error: 'المجموعة غير موجودة' });
      }

      if (group.teacher_id !== teacherId) {
        return res.status(403).json({ error: 'لا يمكنك إزالة طالب من مجموعة مدرس آخر' });
      }

      const groupIdNum = parseInt(groupId, 10);
      const studentIdentifier = parseInt(studentId, 10);
      if (Number.isNaN(groupIdNum) || Number.isNaN(studentIdentifier)) {
        return res.status(400).json({ error: 'معرف المجموعة أو الطالب غير صحيح' });
      }

      // يدعم الحذف باستخدام:
      // 1) student_id (id من users)
      // 2) id صف العضوية في group_students (للتوافق مع بعض الشاشات القديمة)
      const student = await pool.query(
        `DELETE FROM group_students
         WHERE group_id = $1
           AND (student_id = $2 OR id = $2)
         RETURNING *`,
        [groupIdNum, studentIdentifier],
      );

      if (student.rows.length === 0) {
        return res.status(404).json({ error: 'الطالب غير موجود في هذه المجموعة' });
      }

      res.json({ message: 'تم إزالة الطالب من المجموعة بنجاح', student: student.rows[0] });
    } catch (error) {
      logger.error('Error removing student from group:', error);
      res.status(500).json({
        error: 'خطأ في إزالة الطالب من المجموعة',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  },
);

// 9. جلب طلاب المجموعة
router.get('/:groupId/students', async (req: Request, res: Response) => {
  try {
    const { groupId } = req.params;
    const groupIdNum = parseInt(groupId);
    const { date } = req.query;

    const group = await StudyGroupService.getStudyGroupById(groupIdNum);
    if (!group) {
      return res.status(404).json({ error: 'المجموعة غير موجودة' });
    }

    const students = await StudyGroupService.getGroupStudents(
      groupIdNum,
      date as string | undefined,
    );

    const groupName = group.name ?? '';

    // توليد QR لكل طالب (استخدام student_id = id المستخدم في users وليس id صف group_students)
    const studentsWithQr = await Promise.all(
      students.map(async (student: any) => {
        try {
          const payload = `student_id=${student.student_id}&group_id=${groupId}`;
          const qr_code = await QRCode.toDataURL(payload); // Data URL (base64 image)
          return { ...student, qr_code, group_name: groupName };
        } catch (qrErr) {
          logger.error('Error generating QR for student', { studentId: student.student_id, err: qrErr });
          return { ...student, qr_code: null, group_name: groupName };
        }
      }),
    );

    res.json({
      group: { id: group.id, name: groupName },
      students: studentsWithQr,
    });
  } catch (error) {
    logger.error('Error fetching group students:', error);
    res.status(500).json({ error: 'خطأ في جلب طلاب المجموعة' });
  }
});

// 10. تعديل بيانات الطالب في المجموعة
router.put(
  '/:groupId/students/:studentId',
  authMiddleware(['admin', 'teacher']),
  async (req: Request, res: Response) => {
    try {
      const { groupId, studentId } = req.params;
      const {
        name,
        phone,
        parent_phone,
        payment_status,
        payment_amount
      } = req.body;
      const teacherId = (req as any).user.id;

      // التحقق من ملكية المجموعة
      const group = await StudyGroupService.getStudyGroupById(parseInt(groupId));
      if (!group) {
        return res.status(404).json({ error: 'المجموعة غير موجودة' });
      }

      if (group.teacher_id !== teacherId) {
        return res.status(403).json({ error: 'لا يمكنك تعديل طالب في مجموعة مدرس آخر' });
      }

      // تحقق من وجود الطالب في المجموعة
      const isStudentInGroup = await StudyGroupService.isStudentInGroup(
        parseInt(groupId),
        parseInt(studentId),
      );
      if (!isStudentInGroup) {
        return res.status(404).json({ error: 'الطالب غير موجود في هذه المجموعة' });
      }

      // تحديث بيانات الطالب
      const updateFields = [];
      const values = [];
      let paramIndex = 1;

      if (name !== undefined) {
        updateFields.push(`name = $${paramIndex++}`);
        values.push(name);
      }
      if (phone !== undefined) {
        updateFields.push(`phone = $${paramIndex++}`);
        values.push(phone);
      }
      if (parent_phone !== undefined) {
        updateFields.push(`parent_phone = $${paramIndex++}`);
        values.push(parent_phone);
      }
      if (payment_status !== undefined) {
        updateFields.push(`payment_status = $${paramIndex++}`);
        values.push(payment_status);
      }
      if (payment_amount !== undefined) {
        updateFields.push(`payment_amount = $${paramIndex++}`);
        values.push(parseFloat(payment_amount));
      }
      if (payment_status === 'paid') {
        updateFields.push(`payment_date = NOW()`);
      }

      if (updateFields.length === 0) {
        return res.status(400).json({ error: 'لا توجد بيانات للتحديث' });
      }

      values.push(parseInt(studentId));

      const result = await pool.query(
        `UPDATE users 
         SET ${updateFields.join(', ')} 
         WHERE id = $${paramIndex++} AND role = 'student' 
         RETURNING id, name, phone, parent_phone, payment_status, payment_amount, payment_date`,
        values,
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'الطالب غير موجود' });
      }

      res.json({
        message: 'تم تحديث بيانات الطالب بنجاح',
        student: result.rows[0],
      });
    } catch (error) {
      logger.error('Error updating student:', error);
      res.status(500).json({
        error: 'خطأ في تحديث بيانات الطالب',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  },
);

// 11. تسجيل حضور وغياب الطلاب في مجموعة ليوم معين
router.post(
  '/:groupId/attendance',
  authMiddleware(['admin', 'teacher']),
  async (req: Request, res: Response) => {
    try {
      const { groupId } = req.params;
      const { date, attendance } = req.body; // attendance: [{student_id, status}]
      const teacherId = (req as any).user.id;

      if (!date || !attendance || !Array.isArray(attendance)) {
        return res.status(400).json({ error: 'التاريخ وقائمة الحضور مطلوبة' });
      }

      // التحقق من ملكية المجموعة
      const group = await StudyGroupService.getStudyGroupById(parseInt(groupId));
      if (!group) {
        return res.status(404).json({ error: 'المجموعة غير موجودة' });
      }
      if (group.teacher_id !== teacherId) {
        return res.status(403).json({ error: 'لا يمكنك تسجيل الحضور لمجموعة مدرس آخر' });
      }

      // تسجيل الحضور
      for (const entry of attendance) {
        if (!entry.student_id || !['present', 'absent'].includes(entry.status)) continue;
        await pool.query(
          `INSERT INTO group_attendance (group_id, student_id, date, status)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (group_id, student_id, date)
           DO UPDATE SET status = EXCLUDED.status, updated_at = NOW()`,
          [groupId, entry.student_id, date, entry.status],
        );
      }

      res.json({ message: 'تم تسجيل الحضور بنجاح' });
    } catch (error) {
      logger.error('Error recording attendance:', error);
      res.status(500).json({ error: 'خطأ في تسجيل الحضور' });
    }
  },
);

// 12. جلب حضور الطلاب في مجموعة ليوم معين
router.get(
  '/:groupId/attendance',
  authMiddleware(['admin', 'teacher']),
  async (req: Request, res: Response) => {
    try {
      const { groupId } = req.params;
      const { date } = req.query;
      const teacherId = (req as any).user.id;

      if (!date) {
        return res.status(400).json({ error: 'التاريخ مطلوب' });
      }

      // التحقق من ملكية المجموعة
      const group = await StudyGroupService.getStudyGroupById(parseInt(groupId));
      if (!group) {
        return res.status(404).json({ error: 'المجموعة غير موجودة' });
      }
      if (group.teacher_id !== teacherId) {
        return res.status(403).json({ error: 'لا يمكنك جلب الحضور لمجموعة مدرس آخر' });
      }

      // جلب الحضور
      const result = await pool.query(
        `SELECT ga.student_id, u.name, ga.status
         FROM group_attendance ga
         JOIN users u ON ga.student_id = u.id
         WHERE ga.group_id = $1 AND ga.date = $2`,
        [groupId, date],
      );

      res.json({ attendance: result.rows });
    } catch (error) {
      logger.error('Error fetching attendance:', error);
      res.status(500).json({ error: 'خطأ في جلب الحضور' });
    }
  },
);

// 12.b جلب سجل الحضور والغياب لمدى زمني (آخر أسبوع/شهر...)
router.get(
  '/:groupId/attendance-range',
  authMiddleware(['admin', 'teacher']),
  async (req: Request, res: Response) => {
    try {
      const { groupId } = req.params;
      const { period, days, start_date, end_date } = req.query as {
        period?: string;
        days?: string;
        start_date?: string;
        end_date?: string;
      };
      const teacherId = (req as any).user.id;

      // التحقق من ملكية المجموعة
      const group = await StudyGroupService.getStudyGroupById(parseInt(groupId));
      if (!group) {
        return res.status(404).json({ error: 'المجموعة غير موجودة' });
      }
      if (group.teacher_id !== teacherId) {
        return res.status(403).json({ error: 'لا يمكنك جلب الحضور لمجموعة مدرس آخر' });
      }

      // حساب المدى الزمني
      const now = new Date();
      let from = new Date(now);
      let to = new Date(now);

      if (start_date && end_date) {
        from = new Date(start_date);
        to = new Date(end_date);
      } else {
        let n = 7; // الافتراضي: آخر 7 أيام
        if (period === 'week') n = 7;
        else if (period === 'month') n = 30;
        else if (days && !isNaN(parseInt(days))) n = Math.max(1, parseInt(days));

        from.setDate(now.getDate() - (n - 1));
      }

      // تسوية الوقت إلى منتصف الليل لضمان مقارنة التواريخ فقط
      from.setHours(0, 0, 0, 0);
      to.setHours(23, 59, 59, 999);

      // جلب السجل التفصيلي
      const details = await pool.query(
        `SELECT 
           ga.student_id,
           u.name AS student_name,
           ga.date,
           ga.status
         FROM group_attendance ga
         JOIN users u ON u.id = ga.student_id
         WHERE ga.group_id = $1 AND ga.date BETWEEN $2 AND $3
         ORDER BY u.name ASC, ga.date ASC`,
        [groupId, from, to],
      );

      // جلب ملخص حسب الطالب
      const summary = await pool.query(
        `SELECT 
           ga.student_id,
           u.name AS student_name,
           COUNT(*) AS total_days,
           COUNT(CASE WHEN ga.status = 'present' THEN 1 END) AS present_days,
           COUNT(CASE WHEN ga.status = 'absent' THEN 1 END) AS absent_days
         FROM group_attendance ga
         JOIN users u ON u.id = ga.student_id
         WHERE ga.group_id = $1 AND ga.date BETWEEN $2 AND $3
         GROUP BY ga.student_id, u.name
         ORDER BY u.name ASC`,
        [groupId, from, to],
      );

      res.json({
        range: {
          from: from,
          to: to,
          period: start_date && end_date ? 'custom' : period || `${days || '7'}-days`,
        },
        summary: summary.rows,
        details: details.rows,
      });
    } catch (error) {
      logger.error('Error fetching attendance range:', error);
      res.status(500).json({ error: 'خطأ في جلب سجل الحضور للمدى الزمني' });
    }
  },
);

// 13. جلب تفاصيل حضور طالب معين في مجموعة
router.get(
  '/:groupId/students/:studentId/attendance-details',
  authMiddleware(['admin', 'teacher']),
  async (req: Request, res: Response) => {
    try {
      const { groupId, studentId } = req.params;
      const { month, year, all_time, start_date, end_date } = req.query;
      const teacherId = (req as any).user.id;

      logger.info(`Fetching attendance details for group ${groupId}, student ${studentId}`, { query: req.query });

      const parsedGroupId = parseInt(groupId);
      const parsedStudentId = parseInt(studentId);

      if (isNaN(parsedGroupId) || isNaN(parsedStudentId)) {
        return res.status(400).json({ error: 'معرف المجموعة أو الطالب غير صحيح' });
      }

      // التحقق من ملكية المجموعة
      const group = await StudyGroupService.getStudyGroupById(parsedGroupId);
      if (!group) {
        return res.status(404).json({ error: 'المجموعة غير موجودة' });
      }
      if (group.teacher_id !== teacherId) {
        return res.status(403).json({ error: 'لا يمكنك جلب تفاصيل الحضور لمجموعة مدرس آخر' });
      }

      // التحقق من أن الطالب موجود في المجموعة
      const studentCheck = await pool.query(
        `SELECT 1 FROM (
          SELECT student_id FROM group_students WHERE group_id = $1 AND student_id = $2
          UNION
          SELECT student_id FROM group_attendance WHERE group_id = $1 AND student_id = $2
        ) as student_check`,
        [parsedGroupId, parsedStudentId]
      );
      if (studentCheck.rows.length === 0) {
        logger.warn(`Student ${parsedStudentId} not found in group ${parsedGroupId}`);
        return res.status(404).json({ error: 'الطالب غير موجود في هذه المجموعة', debug: { groupId: parsedGroupId, studentId: parsedStudentId } });
      }

      // بناء استعلام الفلتر
      let dateFilterClause = '';
      const queryParams: any[] = [parsedGroupId, parsedStudentId];
      let paramIndex = 3;
      let rangeInfo: any = {};

      if (all_time === 'true') {
        // جلب كل السجل
        dateFilterClause = ''; // لا يوجد فلتر للتاريخ
        rangeInfo = { type: 'all_time' };
      } else if (start_date && end_date) {
        // جلب فترة محددة
        dateFilterClause = `AND ga.date BETWEEN $${paramIndex} AND $${paramIndex + 1}`;
        queryParams.push(start_date, end_date);
        paramIndex += 2;
        rangeInfo = { type: 'custom_range', start: start_date, end: end_date };
      } else {
        // الوضع الافتراضي: شهر وسنة
        const currentDate = new Date();
        const targetMonth = month ? parseInt(month as string) : currentDate.getMonth() + 1;
        const targetYear = year ? parseInt(year as string) : currentDate.getFullYear();

        dateFilterClause = `AND EXTRACT(MONTH FROM ga.date) = $${paramIndex} AND EXTRACT(YEAR FROM ga.date) = $${paramIndex + 1}`;
        queryParams.push(targetMonth, targetYear);
        paramIndex += 2;
        rangeInfo = { type: 'month', month: targetMonth, year: targetYear };
      }

      // جلب تفاصيل الحضور
      const attendanceResult = await pool.query(
        `SELECT 
           ga.date,
           ga.status,
           EXTRACT(DAY FROM ga.date) as day,
           EXTRACT(DOW FROM ga.date) as day_of_week,
           CASE 
             WHEN EXTRACT(DOW FROM ga.date) = 0 THEN 'الأحد'
             WHEN EXTRACT(DOW FROM ga.date) = 1 THEN 'الاثنين'
             WHEN EXTRACT(DOW FROM ga.date) = 2 THEN 'الثلاثاء'
             WHEN EXTRACT(DOW FROM ga.date) = 3 THEN 'الأربعاء'
             WHEN EXTRACT(DOW FROM ga.date) = 4 THEN 'الخميس'
             WHEN EXTRACT(DOW FROM ga.date) = 5 THEN 'الجمعة'
             WHEN EXTRACT(DOW FROM ga.date) = 6 THEN 'السبت'
           END as day_name
         FROM group_attendance ga
         WHERE ga.group_id = $1 
           AND ga.student_id = $2
           ${dateFilterClause}
         ORDER BY ga.date ASC`,
        queryParams
      );

      // حساب الإحصائيات
      const totalDays = attendanceResult.rows.length;
      const presentDays = attendanceResult.rows.filter((row) => row.status === 'present').length;
      const absentDays = attendanceResult.rows.filter((row) => row.status === 'absent').length;
      const attendanceRate = totalDays > 0 ? Math.round((presentDays / totalDays) * 100) : 0;

      // جلب معلومات الطالب
      const studentInfo = await pool.query(
        'SELECT id, name, phone, parent_phone FROM users WHERE id = $1',
        [studentId],
      );

      // جلب أيام الحضور والغياب
      const presentDates = attendanceResult.rows
        .filter((row) => row.status === 'present')
        .map((row) => ({
          date: row.date,
          day: row.day,
          day_name: row.day_name,
        }));

      const absentDates = attendanceResult.rows
        .filter((row) => row.status === 'absent')
        .map((row) => ({
          date: row.date,
          day: row.day,
          day_name: row.day_name,
        }));

      // جلب معلومات المجموعة
      const groupInfo = {
        id: group.id,
        name: group.name,
        course_name: group.course_name,
        teacher_name: group.teacher_name,
      };

      res.json({
        student_info: studentInfo.rows[0],
        group_info: groupInfo,
        filter_info: rangeInfo,
        statistics: {
          total_days: totalDays,
          present_days: presentDays,
          absent_days: absentDays,
          attendance_rate: attendanceRate,
        },
        attendance_details: {
          present_dates: presentDates,
          absent_dates: absentDates,
          all_attendance: attendanceResult.rows,
        },
      });
    } catch (error) {
      logger.error('Error fetching student attendance details:', error);
      res.status(500).json({
        error: 'خطأ في جلب تفاصيل حضور الطالب',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  },
);

// 14. جلب تفاصيل حضور جميع الطلاب في مجموعة
router.get(
  '/:groupId/attendance-summary',
  authMiddleware(['admin', 'teacher']),
  async (req: Request, res: Response) => {
    try {
      const { groupId } = req.params;
      const { month, year } = req.query; // اختياري - إذا لم يتم تحديدهما، سيتم استخدام الشهر الحالي
      const teacherId = (req as any).user.id;

      // التحقق من ملكية المجموعة
      const group = await StudyGroupService.getStudyGroupById(parseInt(groupId));
      if (!group) {
        return res.status(404).json({ error: 'المجموعة غير موجودة' });
      }
      if (group.teacher_id !== teacherId) {
        return res.status(403).json({ error: 'لا يمكنك جلب تفاصيل الحضور لمجموعة مدرس آخر' });
      }

      // تحديد الشهر والسنة
      const currentDate = new Date();
      const targetMonth = month ? parseInt(month as string) : currentDate.getMonth() + 1;
      const targetYear = year ? parseInt(year as string) : currentDate.getFullYear();

      // جلب جميع الطلاب في المجموعة مع تفاصيل الحضور (يشمل الطلاب في group_students و group_attendance)
      const studentsAttendanceResult = await pool.query(
        `SELECT 
           u.id as student_id,
           u.name as student_name,
           u.phone as student_phone,
           u.parent_phone,
           COUNT(ga.date) as total_days,
           COUNT(CASE WHEN ga.status = 'present' THEN 1 END) as present_days,
           COUNT(CASE WHEN ga.status = 'absent' THEN 1 END) as absent_days,
           CASE 
             WHEN COUNT(ga.date) > 0 
             THEN ROUND((COUNT(CASE WHEN ga.status = 'present' THEN 1 END)::DECIMAL / COUNT(ga.date)::DECIMAL) * 100, 2)
             ELSE 0 
           END as attendance_rate
         FROM (
           SELECT DISTINCT student_id FROM group_students WHERE group_id = $1
           UNION
           SELECT DISTINCT student_id FROM group_attendance WHERE group_id = $1
         ) all_students
         JOIN users u ON all_students.student_id = u.id
         LEFT JOIN group_attendance ga ON ga.group_id = $1 
           AND ga.student_id = all_students.student_id
           AND EXTRACT(MONTH FROM ga.date) = $2
           AND EXTRACT(YEAR FROM ga.date) = $3
         GROUP BY u.id, u.name, u.phone, u.parent_phone
         ORDER BY attendance_rate DESC, u.name ASC`,
        [groupId, targetMonth, targetYear],
      );

      // جلب إحصائيات المجموعة ككل
      const groupStatsResult = await pool.query(
        `SELECT 
           COUNT(DISTINCT ga.student_id) as students_with_attendance,
           COUNT(ga.date) as total_attendance_records,
           COUNT(CASE WHEN ga.status = 'present' THEN 1 END) as total_present,
           COUNT(CASE WHEN ga.status = 'absent' THEN 1 END) as total_absent,
           CASE 
             WHEN COUNT(ga.date) > 0 
             THEN ROUND((COUNT(CASE WHEN ga.status = 'present' THEN 1 END)::DECIMAL / COUNT(ga.date)::DECIMAL) * 100, 2)
             ELSE 0 
           END as overall_attendance_rate
         FROM group_attendance ga
         WHERE ga.group_id = $1
           AND EXTRACT(MONTH FROM ga.date) = $2
           AND EXTRACT(YEAR FROM ga.date) = $3`,
        [groupId, targetMonth, targetYear],
      );

      // جلب عدد الطلاب الكلي في المجموعة (يشمل الطلاب في group_students و group_attendance)
      const totalStudentsResult = await pool.query(
        `SELECT COUNT(DISTINCT student_id) as total_students FROM (
          SELECT student_id FROM group_students WHERE group_id = $1
          UNION
          SELECT student_id FROM group_attendance WHERE group_id = $1
        ) all_students`,
        [groupId],
      );

      const groupStats = groupStatsResult.rows[0] || {
        students_with_attendance: 0,
        total_attendance_records: 0,
        total_present: 0,
        total_absent: 0,
        overall_attendance_rate: 0,
      };

      res.json({
        group_info: {
          id: group.id,
          name: group.name,
          course_name: group.course_name,
          teacher_name: group.teacher_name,
        },
        month: targetMonth,
        year: targetYear,
        group_statistics: {
          total_students: parseInt(totalStudentsResult.rows[0].total_students),
          students_with_attendance: parseInt(groupStats.students_with_attendance),
          total_attendance_records: parseInt(groupStats.total_attendance_records),
          total_present: parseInt(groupStats.total_present),
          total_absent: parseInt(groupStats.total_absent),
          overall_attendance_rate: parseFloat(groupStats.overall_attendance_rate),
        },
        students_attendance: studentsAttendanceResult.rows,
      });
    } catch (error) {
      logger.error('Error fetching group attendance summary:', error);
      res.status(500).json({
        error: 'خطأ في جلب ملخص حضور المجموعة',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  },
);

// 15. إضافة درجة امتحان لطالب في مجموعة
router.post(
  '/:groupId/students/:studentId/exam-grades',
  authMiddleware(['admin', 'teacher']),
  async (req: Request, res: Response) => {
    try {
      const { groupId, studentId } = req.params;
      const { exam_name, grade, notes, exam_date, total_grade } = req.body;
      const teacherId = (req as any).user.id;

      // التحقق من ملكية المجموعة
      const group = await StudyGroupService.getStudyGroupById(parseInt(groupId));
      if (!group) {
        return res.status(404).json({ error: 'المجموعة غير موجودة' });
      }
      if (group.teacher_id !== teacherId) {
        return res.status(403).json({ error: 'لا يمكنك إضافة درجة لطالب في مجموعة مدرس آخر' });
      }

      // التحقق من أن الطالب موجود في المجموعة (إما في group_students أو group_attendance)
      const studentCheck = await pool.query(
        `SELECT 1 FROM (
          SELECT student_id FROM group_students WHERE group_id = $1 AND student_id = $2
          UNION
          SELECT student_id FROM group_attendance WHERE group_id = $1 AND student_id = $2
        ) as student_check`,
        [groupId, studentId],
      );
      if (studentCheck.rows.length === 0) {
        return res.status(404).json({ error: 'الطالب غير موجود في هذه المجموعة' });
      }

      // التحقق من صحة البيانات
      if (!exam_name || !grade) {
        return res.status(400).json({ error: 'اسم الامتحان والدرجة مطلوبان' });
      }

      if (grade < 0 || grade > (total_grade || 100)) {
        return res.status(400).json({ error: `الدرجة يجب أن تكون بين 0 و ${total_grade || 100}` });
      }

      // البحث عن امتحان موجود أو إنشاء امتحان جديد
      let examId;
      const existingExam = await pool.query(
        'SELECT id FROM group_exams WHERE group_id = $1 AND name = $2',
        [groupId, exam_name],
      );

      if (existingExam.rows.length > 0) {
        examId = existingExam.rows[0].id;
      } else {
        // إنشاء امتحان جديد
        const newExam = await pool.query(
          `INSERT INTO group_exams (group_id, name, total_grade, exam_date, created_at, updated_at)
           VALUES ($1, $2, $3, $4, NOW(), NOW())
           RETURNING id`,
          [groupId, exam_name, total_grade || 100, exam_date || new Date()],
        );
        examId = newExam.rows[0].id;
      }

      // إضافة أو تحديث درجة الطالب
      const gradeResult = await pool.query(
        `INSERT INTO group_exam_grades (exam_id, student_id, grade, notes, created_at, updated_at)
         VALUES ($1, $2, $3, $4, NOW(), NOW())
         ON CONFLICT (exam_id, student_id) 
         DO UPDATE SET 
           grade = EXCLUDED.grade,
           notes = EXCLUDED.notes,
           updated_at = NOW()
         RETURNING id, grade, notes, created_at, updated_at`,
        [examId, studentId, grade, notes || null],
      );

      // جلب معلومات الطالب
      const studentInfo = await pool.query('SELECT id, name FROM users WHERE id = $1', [studentId]);

      res.json({
        message: 'تم إضافة درجة الامتحان بنجاح',
        exam_info: {
          id: examId,
          name: exam_name,
          total_grade: total_grade || 100,
          exam_date: exam_date || new Date(),
        },
        student_info: studentInfo.rows[0],
        grade_info: {
          id: gradeResult.rows[0].id,
          grade: gradeResult.rows[0].grade,
          notes: gradeResult.rows[0].notes,
          created_at: gradeResult.rows[0].created_at,
          updated_at: gradeResult.rows[0].updated_at,
        },
      });
    } catch (error) {
      logger.error('Error adding exam grade:', error);
      res.status(500).json({
        error: 'خطأ في إضافة درجة الامتحان',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  },
);

// 16. جلب درجات طالب معين في جميع الامتحانات
router.get(
  '/:groupId/students/:studentId/exam-grades',
  authMiddleware(['admin', 'teacher']),
  async (req: Request, res: Response) => {
    try {
      const { groupId, studentId } = req.params;
      const teacherId = (req as any).user.id;

      // التحقق من ملكية المجموعة
      const group = await StudyGroupService.getStudyGroupById(parseInt(groupId));
      if (!group) {
        return res.status(404).json({ error: 'المجموعة غير موجودة' });
      }
      if (group.teacher_id !== teacherId) {
        return res.status(403).json({ error: 'لا يمكنك جلب درجات طالب في مجموعة مدرس آخر' });
      }

      // التحقق من أن الطالب موجود في المجموعة (إما في group_students أو group_attendance)
      const studentCheck = await pool.query(
        `SELECT 1 FROM (
          SELECT student_id FROM group_students WHERE group_id = $1 AND student_id = $2
          UNION
          SELECT student_id FROM group_attendance WHERE group_id = $1 AND student_id = $2
        ) as student_check`,
        [groupId, studentId],
      );
      if (studentCheck.rows.length === 0) {
        return res.status(404).json({ error: 'الطالب غير موجود في هذه المجموعة' });
      }

      // جلب درجات الطالب في جميع الامتحانات
      const gradesResult = await pool.query(
        `SELECT 
           ge.id as exam_id,
           ge.name as exam_name,
           ge.total_grade,
           ge.exam_date,
           geg.grade,
           geg.notes,
           geg.created_at as grade_created_at,
           geg.updated_at as grade_updated_at,
           CASE 
             WHEN geg.grade IS NOT NULL 
             THEN ROUND((geg.grade::DECIMAL / ge.total_grade::DECIMAL) * 100, 2)
             ELSE NULL 
           END as percentage
         FROM group_exams ge
         LEFT JOIN group_exam_grades geg ON ge.id = geg.exam_id AND geg.student_id = $2
         WHERE ge.group_id = $1
         ORDER BY ge.exam_date DESC, ge.created_at DESC`,
        [groupId, studentId],
      );

      // جلب معلومات الطالب
      const studentInfo = await pool.query(
        'SELECT id, name, phone, parent_phone FROM users WHERE id = $1',
        [studentId],
      );

      // حساب الإحصائيات
      const gradesWithScores = gradesResult.rows.filter((row) => row.grade !== null);
      const totalExams = gradesResult.rows.length;
      const completedExams = gradesWithScores.length;
      const averageGrade = gradesWithScores.length > 0
        ? gradesWithScores.reduce((sum, row) => sum + parseFloat(row.grade), 0) / gradesWithScores.length
        : 0;
      const averagePercentage = gradesWithScores.length > 0
        ? gradesWithScores.reduce((sum, row) => sum + parseFloat(row.percentage), 0) / gradesWithScores.length
        : 0;

      res.json({
        student_info: studentInfo.rows[0],
        group_info: {
          id: group.id,
          name: group.name,
          course_name: group.course_name,
          teacher_name: group.teacher_name,
        },
        statistics: {
          total_exams: totalExams,
          completed_exams: completedExams,
          pending_exams: totalExams - completedExams,
          average_grade: Math.round(averageGrade * 100) / 100,
          average_percentage: Math.round(averagePercentage * 100) / 100,
        },
        exam_grades: gradesResult.rows.map((row) => ({
          exam_id: row.exam_id,
          exam_name: row.exam_name,
          total_grade: row.total_grade,
          exam_date: row.exam_date,
          grade: row.grade,
          notes: row.notes,
          percentage: row.percentage,
          grade_created_at: row.grade_created_at,
          grade_updated_at: row.grade_updated_at,
          status: row.grade !== null ? 'completed' : 'pending',
        })),
      });
    } catch (error) {
      logger.error('Error fetching student exam grades:', error);
      res.status(500).json({
        error: 'خطأ في جلب درجات الامتحان',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  },
);

// --- جديد: تسجيل حضور عبر مسح QR ---
router.post(
  '/:groupId/scan-qr',
  authMiddleware(['admin', 'teacher']),
  async (req: Request, res: Response) => {
    try {
      const { groupId } = req.params;
      const { date, qr_data, status } = req.body as { date?: string; qr_data?: string; status?: 'present' | 'absent' };
      const teacherId = (req as any).user.id;

      if (!date || !qr_data) {
        return res.status(400).json({ error: 'date و qr_data مطلوبان' });
      }

      // تحقق من وجود المجموعة وملكية المدرس
      const group = await StudyGroupService.getStudyGroupById(parseInt(groupId));
      if (!group) return res.status(404).json({ error: 'المجموعة غير موجودة' });
      if (group.teacher_id !== teacherId)
        return res.status(403).json({ error: 'لا يمكنك تسجيل الحضور لمجموعة مدرس آخر' });

      // تحليل qr_data المتوقع "student_id=32&group_id=2" أو رابط يحتوي على الاستعلام
      let studentId: number | null = null;
      try {
        const queryString = qr_data.includes('?') ? qr_data.split('?')[1] : qr_data;
        const params = new URLSearchParams(queryString);

        if (params.has('student_id')) {
          studentId = parseInt(params.get('student_id')!, 10);
        } else {
          // محاولة تحليل كـ JSON كاحتياط
          const maybeJson = JSON.parse(qr_data);
          if (maybeJson && maybeJson.student_id) studentId = parseInt(maybeJson.student_id, 10);
        }
      } catch (parseErr) {
        logger.error('QR parse error', { qr_data, err: parseErr });
      }

      if (!studentId || isNaN(studentId)) {
        return res.status(400).json({ error: 'qr_data غير صالح: لم يتم العثور على student_id' });
      }

      // إذا احتوى الـ QR على group_id ضمناً فتأكد أنه يطابق المسار
      try {
        const queryString = qr_data.includes('?') ? qr_data.split('?')[1] : qr_data;
        const params = new URLSearchParams(queryString);
        if (params.has('group_id')) {
          const qrGroupId = parseInt(params.get('group_id')!, 10);
          if (!isNaN(qrGroupId) && qrGroupId !== parseInt(groupId, 10)) {
            return res.status(400).json({ error: 'group_id في QR لا يتطابق مع المجموعة المطلوبة' });
          }
        }
      } catch (_) {
        /* لا توقف التنفيذ لو فشل الاختبار الاختياري */
      }

      // تحقق من وجود الطالب
      const studentRes = await pool.query('SELECT id FROM users WHERE id = $1 AND role = $2', [
        studentId,
        'student',
      ]);
      if (studentRes.rows.length === 0) return res.status(404).json({ error: 'الطالب غير موجود' });

      // تحقق أن الطالب موجود في المجموعة (group_students أو سابقًا في group_attendance)
      const studentCheck = await pool.query(
        `SELECT 1 FROM (
           SELECT student_id FROM group_students WHERE group_id = $1 AND student_id = $2
           UNION
           SELECT student_id FROM group_attendance WHERE group_id = $1 AND student_id = $2
         ) as student_check`,
        [groupId, studentId],
      );
      if (studentCheck.rows.length === 0) {
        return res.status(404).json({ error: 'الطالب غير موجود في هذه المجموعة' });
      }

      const attendanceStatus = status && ['present', 'absent'].includes(status) ? status : 'present';

      // إدخال / تحديث الحضور
      await pool.query(
        `INSERT INTO group_attendance (group_id, student_id, date, status)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (group_id, student_id, date)
         DO UPDATE SET status = EXCLUDED.status, updated_at = NOW()`,
        [groupId, studentId, date, attendanceStatus],
      );

      res.json({
        message: 'تم تسجيل حضور الطالب عبر QR بنجاح',
        student_id: studentId,
        group_id: parseInt(groupId, 10),
        date,
        status: attendanceStatus,
      });
    } catch (error) {
      logger.error('Error scanning QR attendance:', error);
      res.status(500).json({ error: 'خطأ في تسجيل الحضور عبر QR' });
    }
  },
);

export { router };
