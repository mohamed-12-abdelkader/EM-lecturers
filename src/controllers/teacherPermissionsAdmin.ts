import { Request, Response, Router } from 'express';
import { authMiddleware } from '../middleware/authentication';
import pool from '../db/pool';
import { TeacherSubjectService } from '../services/teacherSubjects';

const router = Router();

// مهم: تقييد الحماية بمسارات /admin فقط حتى لا تعترض راوترات أخرى
router.use('/admin', authMiddleware(['admin']));

// POST /api/admin/assign-subject
router.post('/admin/assign-subject', async (req: Request, res: Response) => {
  try {
    const { teacherId, subjectId } = req.body as { teacherId: number; subjectId: number };
    if (!Number.isInteger(teacherId) || !Number.isInteger(subjectId)) {
      return res
        .status(400)
        .json({ success: false, message: 'teacherId and subjectId must be integers' });
    }

    // ensure teacher exists and role is teacher
    const teacherOk = await TeacherSubjectService.teacherExists(teacherId);
    if (!teacherOk) return res.status(404).json({ success: false, message: 'المدرس غير موجود' });
    // ensure subject exists
    const subjectOk = await TeacherSubjectService.subjectExists(subjectId);
    if (!subjectOk) return res.status(404).json({ success: false, message: 'المادة غير موجودة' });

    const adminId = req.user?.id as number;
    const permissions = {
      can_edit: true,
      can_delete: false,
      can_create_content: true,
      can_view: true,
    };
    const assigned = await TeacherSubjectService.assignSubjectToTeacher(
      teacherId,
      subjectId,
      permissions,
      adminId,
    );
    return res
      .status(201)
      .json({ success: true, message: 'تم تعيين المدرس للمادة بنجاح', data: assigned });
  } catch (error: any) {
    return res
      .status(500)
      .json({ success: false, message: 'خطأ في تعيين المدرس', error: error.message });
  }
});

// GET /api/admin/teachers/:id/subjects
router.get('/admin/teachers/:id/subjects', async (req: Request, res: Response) => {
  try {
    const teacherId = Number(req.params.id);
    if (Number.isNaN(teacherId))
      return res.status(400).json({ success: false, message: 'معرف المدرس غير صحيح' });
    const subjects = await TeacherSubjectService.getTeacherSubjects(teacherId);
    return res.status(200).json({ success: true, data: subjects });
  } catch (error: any) {
    return res
      .status(500)
      .json({ success: false, message: 'خطأ في جلب المواد', error: error.message });
  }
});

// GET /api/admin/questions/pending
router.get('/admin/questions/pending', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT q.* FROM questions q WHERE q.status = 'pending' ORDER BY q.created_at DESC`,
    );
    return res.status(200).json({ success: true, data: result.rows });
  } catch (error: any) {
    return res
      .status(500)
      .json({ success: false, message: 'خطأ في جلب الأسئلة المعلقة', error: error.message });
  }
});

// PUT /api/admin/questions/:id/approve
router.put('/admin/questions/:id/approve', async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id))
      return res.status(400).json({ success: false, message: 'معرف السؤال غير صحيح' });
    const result = await pool.query(
      `UPDATE questions SET status = 'approved', updated_at = NOW() WHERE id = $1 AND status = 'pending' RETURNING *`,
      [id],
    );
    if (!result.rowCount)
      return res.status(404).json({ success: false, message: 'السؤال غير موجود أو غير معلق' });
    return res
      .status(200)
      .json({ success: true, message: 'تمت الموافقة على السؤال', data: result.rows[0] });
  } catch (error: any) {
    return res
      .status(500)
      .json({ success: false, message: 'خطأ في الموافقة على السؤال', error: error.message });
  }
});

// PUT /api/admin/questions/:id/reject
router.put('/admin/questions/:id/reject', async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id))
      return res.status(400).json({ success: false, message: 'معرف السؤال غير صحيح' });
    const result = await pool.query(
      `UPDATE questions SET status = 'rejected', updated_at = NOW() WHERE id = $1 AND status = 'pending' RETURNING *`,
      [id],
    );
    if (!result.rowCount)
      return res.status(404).json({ success: false, message: 'السؤال غير موجود أو غير معلق' });
    return res.status(200).json({ success: true, message: 'تم رفض السؤال', data: result.rows[0] });
  } catch (error: any) {
    return res
      .status(500)
      .json({ success: false, message: 'خطأ في رفض السؤال', error: error.message });
  }
});

export { router };
