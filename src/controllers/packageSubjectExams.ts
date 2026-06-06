import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/authentication';
import { PackageSubjectExamService } from '../services/packageSubjectExams';
import { PackageSubjectPermissionsService } from '../services/packageSubjectPermissions';
import { PackageSubjectItemService } from '../services/packageSubjectItems';
import { PackageActivationCodeService } from '../services/packageActivationCodes';
import { logger } from '../utils';

const router = Router();

// Middleware: Check Access (Read/Review)
const checkReadAccess = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const user = (req as any).user;
        const subjectId = parseInt(req.params.subjectId as string);

        if (user.role === 'admin') return next();

        if (user.role === 'teacher') {
            const hasPermission = await PackageSubjectPermissionsService.hasPermission(subjectId, user.id);
            if (!hasPermission) return res.status(403).json({ error: 'ليس لديك صلاحية لهذا المحتوى' });
            return next();
        }

        if (user.role === 'student') {
            const subject = await PackageSubjectItemService.getPackageSubjectItem(subjectId);
            if (!subject) return res.status(404).json({ error: 'المادة غير موجودة' });

            const isActivated = await PackageActivationCodeService.isActivated(subject.package_id, user.id);
            if (!isActivated) return res.status(403).json({ error: 'يجب تفعيل الباقة أولاً' });
            return next();
        }

        return res.status(403).json({ error: 'غير مصرح' });
    } catch (err) {
        next(err);
    }
};

// Middleware: Check Write Access (Admin & Authorized Teacher)
const checkWriteAccess = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const user = (req as any).user;
        let subjectId: number | null = null;

        if (req.params.subjectId) {
            subjectId = parseInt(req.params.subjectId as string);
        } else if (req.params.examId) {
            const exam = await PackageSubjectExamService.getExam(parseInt(req.params.examId as string));
            if (!exam) return res.status(404).json({ error: 'الامتحان غير موجود' });
            subjectId = exam.subject_id;
        }

        if (user.role === 'admin') return next();

        if (user.role === 'teacher') {
            if (!subjectId) return res.status(400).json({ error: 'معرف المادة مطلوب' });
            const hasPermission = await PackageSubjectPermissionsService.hasPermission(subjectId, user.id);
            if (!hasPermission) return res.status(403).json({ error: 'ليس لديك صلاحية تعديل هذا المحتوى' });
            return next();
        }

        return res.status(403).json({ error: 'غير مصرح للإجراءات الإدارية' });
    } catch (err) {
        next(err);
    }
};

// 1. Get Exams for Subject
router.get('/:subjectId/exams', authMiddleware(['admin', 'teacher', 'student']), checkReadAccess, async (req: Request, res: Response) => {
    try {
        const subjectId = parseInt(req.params.subjectId as string);
        const user = (req as any).user;

        // Pass studentId if user is student to get submission status & filtering
        const studentId = user.role === 'student' ? user.id : undefined;

        const exams = await PackageSubjectExamService.getExamsBySubject(subjectId, studentId);
        res.json({ exams });
    } catch (error) {
        logger.error('Error fetching exams:', error);
        res.status(500).json({ error: 'خطأ في جلب الامتحانات' });
    }
});

// 2. Create Exam
router.post('/:subjectId/exams', authMiddleware(['admin', 'teacher']), checkWriteAccess, async (req: Request, res: Response) => {
    try {
        const subjectId = parseInt(req.params.subjectId as string);
        const { name, duration, total_marks, question_count } = req.body;

        if (!name || !duration || !total_marks || !question_count) {
            return res.status(400).json({ error: 'جميع الحقول مطلوبة (الاسم، المدة، الدرجة، عدد الأسئلة)' });
        }

        const exam = await PackageSubjectExamService.createExam(subjectId, name, duration, total_marks, question_count);
        
        // إرسال إشعار للطلاب المشتركين في الباقة (فقط إذا كان visible)
        // ملاحظة: الامتحان يُنشأ مخفي افتراضياً، لذلك لن يتم إرسال إشعار
        try {
             // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
            const { PackageSubjectItemService } = await import('../services/packageSubjectItems');
            const subject = await PackageSubjectItemService.getPackageSubjectItem(subjectId);
            if (subject && exam.is_visible) {
                 // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
                const { NotificationService } = await import('../services/notifications');
                await NotificationService.notifyPackageExamAdded(
                    subject.package_id,
                    subjectId,
                    exam.id,
                    exam.name,
                    subject.name,
                    exam.is_visible
                );
            }
        } catch (notifError) {
            logger.error('Error sending notification:', notifError);
        }
        
        res.status(201).json({ message: 'تم إنشاء الامتحان بنجاح', exam });
    } catch (error) {
        logger.error('Error creating exam:', error);
        res.status(500).json({ error: 'خطأ في إنشاء الامتحان' });
    }
});

// 3. Update Exam
router.put('/exams/:examId', authMiddleware(['admin', 'teacher']), checkWriteAccess, async (req: Request, res: Response) => {
    try {
        const examId = parseInt(req.params.examId);
        const exam = await PackageSubjectExamService.updateExam(examId, req.body);
        res.json({ message: 'تم تحديث الامتحان', exam });
    } catch {
        res.status(500).json({ error: 'خطأ في تحديث الامتحان' });
    }
});

// 4. Delete Exam
router.delete('/exams/:examId', authMiddleware(['admin', 'teacher']), checkWriteAccess, async (req: Request, res: Response) => {
    try {
        const examId = parseInt(req.params.examId);
        await PackageSubjectExamService.deleteExam(examId);
        res.json({ message: 'تم حذف الامتحان' });
    } catch {
        res.status(500).json({ error: 'خطأ في حذف الامتحان' });
    }
});

// 5. Toggle Visibility
router.put('/exams/:examId/visibility', authMiddleware(['admin', 'teacher']), checkWriteAccess, async (req: Request, res: Response) => {
    try {
        const examId = parseInt(req.params.examId);
        const { is_visible } = req.body;

        if (typeof is_visible !== 'boolean') {
            return res.status(400).json({ error: 'is_visible must be a boolean' });
        }

        const exam = await PackageSubjectExamService.toggleVisibility(examId, is_visible);
        
        // إرسال إشعار للطلاب المشتركين في الباقة (فقط إذا أصبح visible)
        if (is_visible) {
            try {
                 // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
                const { PackageSubjectItemService } = await import('../services/packageSubjectItems');
                 // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
                const subject = await PackageSubjectItemService.getPackageSubjectItem(exam.subject_id);
                if (subject) {
                     // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
                    const { NotificationService } = await import('../services/notifications');
                    await NotificationService.notifyPackageExamAdded(
                        subject.package_id,
                         // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
                        exam.subject_id,
                        examId,
                         // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
                        exam.name,
                        subject.name,
                        true
                    );
                }
            } catch (notifError) {
                logger.error('Error sending notification:', notifError);
            }
        }
        
        res.json({ message: 'تم تحديث حالة الظهور', exam });
    } catch {
        res.status(500).json({ error: 'خطأ في التحديث' });
    }
});

export { router };
