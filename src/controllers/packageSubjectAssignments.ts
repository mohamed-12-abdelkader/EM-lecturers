import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/authentication';
import { asyncWrapper } from '../utils';
import { PackageSubjectAssignmentsService } from '../services/packageSubjectAssignments';
import { PackageSubjectLessonService } from '../services/packageSubjectLessons';
import { PackageSubjectGroupsService } from '../services/packageSubjectGroups';
import { PackageActivationCodeService } from '../services/packageActivationCodes';
import { AssignmentQuestionsService } from '../services/assignmentQuestions';
import { z } from 'zod';
import pool from '../db/pool';

const router = Router();

// Schema للتحقق من البيانات
const CreateAssignmentSchema = z.object({
  name: z.string().min(1, 'اسم الواجب مطلوب'),
  questions_count: z.number().int().min(0).optional(),
  duration_minutes: z.number().int().min(0).optional(),
});

const UpdateAssignmentSchema = z.object({
  name: z.string().min(1).optional(),
  questions_count: z.number().int().min(0).optional(),
  duration_minutes: z.number().int().min(0).optional(),
  is_visible: z.boolean().optional(),
});

// Helper function للتحقق من صلاحية المدرس على الدرس
async function checkLessonPermission(lessonId: number, userId: number, userRole: string) {
  if (userRole === 'admin') {
    return true;
  }

  if (userRole === 'teacher') {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const lesson = await PackageSubjectLessonService.getLessonById(lessonId);
    if (!lesson?.group_id) return false;
    return await PackageSubjectGroupsService.teacherOwnsGroup(lesson.group_id, userId);
  }

  return false;
}

async function checkStudentLessonAccess(lessonId: number, studentId: number): Promise<boolean> {
   // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
  const subjectId = await PackageSubjectLessonService.getSubjectIdByLessonId(lessonId);
  if (!subjectId) return false;

  const subjectResult = await pool.query(
    'SELECT package_id FROM package_subject_items WHERE id = $1',
    [subjectId]
  );
  if (!subjectResult.rowCount) return false;

  const packageId = subjectResult.rows[0].package_id;
  const activated = await PackageActivationCodeService.isActivated(packageId, studentId);
  if (!activated) return false;

  // enforce group isolation: student must be in a group, and lesson must belong to that group
   // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
  const lesson = await PackageSubjectLessonService.getLessonById(lessonId);
  if (!lesson?.group_id) return false;
  const studentGroupId = await PackageSubjectGroupsService.getStudentGroupForSubject(subjectId, studentId);
  if (!studentGroupId) return false;
  return lesson.group_id === studentGroupId;
}

// 1. إضافة واجب للدرس
router.post(
  '/lessons/:lessonId/assignments',
  authMiddleware(['admin', 'teacher']),
  asyncWrapper(async (req: Request, res: Response) => {
    try {
      const lessonId = parseInt(req.params.lessonId);
      if (isNaN(lessonId)) {
        return res.status(400).json({ error: 'Invalid lesson ID' });
      }

      // التحقق من وجود الدرس
       // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
      const lesson = await PackageSubjectLessonService.getLessonById(lessonId);
      if (!lesson) {
        return res.status(404).json({ error: 'الدرس غير موجود' });
      }

      const user = (req as any).user;

      // التحقق من الصلاحيات
      const hasPermission = await checkLessonPermission(lessonId, user.id, user.role);
      if (!hasPermission) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'ليس لديك صلاحية لإضافة واجب لهذا الدرس',
        });
      }

      // التحقق من صحة البيانات
      const parse = CreateAssignmentSchema.safeParse(req.body);
      if (!parse.success) {
        return res.status(400).json({
          error: 'Validation failed',
          errors: parse.error.errors,
        });
      }

      const assignment = await PackageSubjectAssignmentsService.createAssignment(
        lessonId,
        parse.data as any,
      );

      res.status(201).json({
        success: true,
        message: 'تم إضافة الواجب بنجاح',
        assignment,
      });
    } catch (error: any) {
      console.error('Error creating assignment:', error);
      res.status(500).json({ error: 'خطأ في إضافة الواجب', message: error.message });
    }
  }),
);

// 1.1 عرض واجبات الدرس + أسئلتها
router.get(
  '/lessons/:lessonId/assignments/questions',
  authMiddleware(['admin', 'teacher', 'student']),
  asyncWrapper(async (req: Request, res: Response) => {
    const lessonId = parseInt(req.params.lessonId);
    if (isNaN(lessonId)) {
      return res.status(400).json({ error: 'Invalid lesson ID' });
    }

     // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const lesson = await PackageSubjectLessonService.getLessonById(lessonId);
    if (!lesson) {
      return res.status(404).json({ error: 'الدرس غير موجود' });
    }

    const user = (req as any).user;

    // صلاحيات الوصول
    if (user.role === 'teacher') {
      const ok = await checkLessonPermission(lessonId, user.id, user.role);
      if (!ok) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'ليس لديك صلاحية لعرض واجبات هذا الدرس',
        });
      }
    } else if (user.role === 'student') {
      const ok = await checkStudentLessonAccess(lessonId, user.id);
      if (!ok) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'يجب تفعيل الباقة أولاً للوصول إلى واجبات هذا الدرس',
        });
      }
    }

    const forStudent = user.role === 'student';
    const assignments = await PackageSubjectAssignmentsService.getAssignmentsByLesson(lessonId, forStudent);

    const assignmentsWithQuestions = await Promise.all(
      assignments.map(async (a: any) => {
        const questions = await AssignmentQuestionsService.getQuestionsByAssignment(a.id);

        if (!forStudent) {
          return { ...a, questions };
        }

        // للطالب: إزالة الإجابات الصحيحة وإرجاع الخيارات بشكل آمن
        const questionsForStudent = questions.map((q: any) => {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { correct_answer, correct_option_id, ...rest } = q;
          if (rest.options) {
            rest.options = rest.options.map((opt: any) => ({
              id: opt.id,
              option_text: opt.option_text,
              option_letter: opt.option_letter,
              order_index: opt.order_index,
            }));
          }
          return rest;
        });

        return { ...a, questions: questionsForStudent };
      })
    );

    return res.json({
      success: true,
      lesson_id: lessonId,
      assignments: assignmentsWithQuestions,
      total: assignmentsWithQuestions.length,
    });
  })
);

// 2. تحديث واجب
router.put(
  '/assignments/:assignmentId',
  authMiddleware(['admin', 'teacher']),
  asyncWrapper(async (req: Request, res: Response) => {
    try {
      const assignmentId = parseInt(req.params.assignmentId);
      if (isNaN(assignmentId)) {
        return res.status(400).json({ error: 'Invalid assignment ID' });
      }

      // التحقق من وجود الواجب
      const existingAssignment =
        await PackageSubjectAssignmentsService.getAssignmentById(assignmentId);
      if (!existingAssignment) {
        return res.status(404).json({ error: 'الواجب غير موجود' });
      }

      const user = (req as any).user;

      // التحقق من الصلاحيات
      const hasPermission = await checkLessonPermission(
        existingAssignment.lesson_id,
        user.id,
        user.role,
      );
      if (!hasPermission) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'ليس لديك صلاحية لتعديل هذا الواجب',
        });
      }

      // التحقق من صحة البيانات
      const parse = UpdateAssignmentSchema.safeParse(req.body);
      if (!parse.success) {
        return res.status(400).json({
          error: 'Validation failed',
          errors: parse.error.errors,
        });
      }

      const updatedAssignment = await PackageSubjectAssignmentsService.updateAssignment(
        assignmentId,
        parse.data,
      );

      res.json({
        success: true,
        message: 'تم تحديث الواجب بنجاح',
        assignment: updatedAssignment,
      });
    } catch (error: any) {
      console.error('Error updating assignment:', error);
      res.status(500).json({ error: 'خطأ في تحديث الواجب', message: error.message });
    }
  }),
);

// 3. حذف واجب
router.delete(
  '/assignments/:assignmentId',
  authMiddleware(['admin', 'teacher']),
  asyncWrapper(async (req: Request, res: Response) => {
    try {
      const assignmentId = parseInt(req.params.assignmentId);
      if (isNaN(assignmentId)) {
        return res.status(400).json({ error: 'Invalid assignment ID' });
      }

      // التحقق من وجود الواجب
      const existingAssignment =
        await PackageSubjectAssignmentsService.getAssignmentById(assignmentId);
      if (!existingAssignment) {
        return res.status(404).json({ error: 'الواجب غير موجود' });
      }

      const user = (req as any).user;

      // التحقق من الصلاحيات
      const hasPermission = await checkLessonPermission(
        existingAssignment.lesson_id,
        user.id,
        user.role,
      );
      if (!hasPermission) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'ليس لديك صلاحية لحذف هذا الواجب',
        });
      }

      await PackageSubjectAssignmentsService.deleteAssignment(assignmentId);

      res.json({
        success: true,
        message: 'تم حذف الواجب بنجاح',
      });
    } catch (error: any) {
      console.error('Error deleting assignment:', error);
      res.status(500).json({ error: 'خطأ في حذف الواجب', message: error.message });
    }
  }),
);

// 4. التحكم في إظهار/إخفاء الواجب
router.patch(
  '/assignments/:assignmentId/visibility',
  authMiddleware(['admin', 'teacher']),
  asyncWrapper(async (req: Request, res: Response) => {
    try {
      const assignmentId = parseInt(req.params.assignmentId);
      if (isNaN(assignmentId)) {
        return res.status(400).json({ error: 'Invalid assignment ID' });
      }

      // التحقق من وجود الواجب
      const existingAssignment =
        await PackageSubjectAssignmentsService.getAssignmentById(assignmentId);
      if (!existingAssignment) {
        return res.status(404).json({ error: 'الواجب غير موجود' });
      }

      const user = (req as any).user;

      // التحقق من الصلاحيات
      const hasPermission = await checkLessonPermission(
        existingAssignment.lesson_id,
        user.id,
        user.role,
      );
      if (!hasPermission) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'ليس لديك صلاحية للتحكم في إظهار هذا الواجب',
        });
      }

      // التحقق من صحة البيانات
      const parse = z
        .object({
          is_visible: z.boolean(),
        })
        .safeParse(req.body);

      if (!parse.success) {
        return res.status(400).json({
          error: 'Validation failed',
          errors: parse.error.errors,
        });
      }

      const updatedAssignment = await PackageSubjectAssignmentsService.toggleAssignmentVisibility(
        assignmentId,
        parse.data.is_visible,
      );

      res.json({
        success: true,
        message: parse.data.is_visible ? 'تم إظهار الواجب بنجاح' : 'تم إخفاء الواجب بنجاح',
        assignment: updatedAssignment,
      });
    } catch (error: any) {
      console.error('Error toggling assignment visibility:', error);
      res.status(500).json({ error: 'خطأ في التحكم في إظهار الواجب', message: error.message });
    }
  }),
);

export { router };
