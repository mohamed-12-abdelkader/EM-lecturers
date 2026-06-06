import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/authentication';
import { asyncWrapper } from '../utils';
import { AssignmentSubmissionsService } from '../services/assignmentSubmissions';
import { AssignmentQuestionsService } from '../services/assignmentQuestions';
import { PackageSubjectLessonService } from '../services/packageSubjectLessons';
import { PackageActivationCodeService } from '../services/packageActivationCodes';
import { PackageSubjectGroupsService } from '../services/packageSubjectGroups';
import pool from '../db/pool';
import { z } from 'zod';

const router = Router();

// Schema للتحقق من بيانات التسليم
const SubmitAssignmentSchema = z.object({
  answers: z
    .array(
      z.object({
        question_id: z.union([
          z.number().int().positive('question_id يجب أن يكون رقماً صحيحاً موجباً'),
          z.string().transform((val) => {
            const num = parseInt(val, 10);
            if (isNaN(num) || num <= 0) {
              throw new Error('question_id يجب أن يكون رقماً صحيحاً موجباً');
            }
            return num;
          }),
        ]),
        option_id: z.union([
          z.number().int().positive('option_id يجب أن يكون رقماً صحيحاً موجباً'),
          z.string().transform((val) => {
            const num = parseInt(val, 10);
            if (isNaN(num) || num <= 0) {
              throw new Error('option_id يجب أن يكون رقماً صحيحاً موجباً');
            }
            return num;
          }),
        ]),
      }),
    )
    .min(1, 'يجب الإجابة على سؤال واحد على الأقل'),
});

// Helper function للتحقق من اشتراك الطالب في الباقة

async function checkStudentPackageAccess(assignmentId: number, studentId: number): Promise<boolean> {
  try {
    // جلب lesson_id من الواجب
    const assignment = await AssignmentQuestionsService.getAssignmentById(assignmentId);
    if (!assignment) {
      console.error('[checkStudentPackageAccess] Assignment not found:', assignmentId);
      return false;
    }

    if (!assignment.lesson_id) {
      console.error('[checkStudentPackageAccess] Assignment has no lesson_id:', assignmentId);
      return false;
    }

    // جلب lesson
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error
    const lesson = await PackageSubjectLessonService.getLessonById(assignment.lesson_id);
    if (!lesson) {
      console.error('[checkStudentPackageAccess] Lesson not found:', assignment.lesson_id);
      return false;
    }

    // جلب subject_id من الدرس (package_subject_item_id)
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error
    const subjectId = await PackageSubjectLessonService.getSubjectIdByLessonId(lesson.id);
    if (!subjectId) {
      console.error('[checkStudentPackageAccess] Subject not found for lesson:', lesson.id);
      return false;
    }

    // جلب package_id من المادة
    const subjectResult = await pool.query(
      'SELECT package_id FROM package_subject_items WHERE id = $1',
      [subjectId]
    );

    if (!subjectResult.rowCount) {
      console.error('[checkStudentPackageAccess] Package not found for subject:', subjectId);
      return false;
    }

    const packageId = subjectResult.rows[0].package_id;

    console.log('[checkStudentPackageAccess]', {
      assignmentId,
      lessonId: assignment.lesson_id,
      subjectId,
      packageId,
      studentId,
    });

    // التحقق من تفعيل الباقة
    const isActivated = await PackageActivationCodeService.isActivated(packageId, studentId);
    if (!isActivated) return false;

    // enforce group isolation: student must be in a group in this subject, and lesson must belong to that group
    if (!lesson.group_id) return false;
    const studentGroupId = await PackageSubjectGroupsService.getStudentGroupForSubject(subjectId, studentId);
    if (!studentGroupId) return false;
    if (lesson.group_id !== studentGroupId) return false;

    console.log('[checkStudentPackageAccess Result]', {
      assignmentId,
      packageId,
      studentId,
      isActivated,
    });

    return true;
  } catch (error: any) {
    console.error('[checkStudentPackageAccess Error]', {
      assignmentId,
      studentId,
      error: error.message,
      stack: error.stack,
    });
    return false;
  }

}

// 1. عرض أسئلة الواجب للطالب (بدون الإجابات الصحيحة)
router.get(
  '/assignments/:assignmentId/questions',
  // مهم: نفس المسار له handler للأدمن/المدرس داخل assignmentQuestions.ts
  // لذلك نسمح هنا بـ admin/teacher/student، ونمرر للأمام لو مش طالب.
  authMiddleware(['admin', 'teacher', 'student']),
  asyncWrapper(async (req: Request, res: Response, next) => {
    try {
      const user = (req as any).user;
      // لو أدمن/مدرس: سيب المسار يكمل للراوتر التالي (assignmentQuestions)
      if (user?.role && user.role !== 'student') {
        return next();
      }

      console.log('[Student Questions Endpoint] Request received', {
        assignmentId: req.params.assignmentId,
        url: req.url,
        method: req.method,
      });

      const assignmentId = parseInt(req.params.assignmentId);
      if (isNaN(assignmentId)) {
        return res.status(400).json({ error: 'Invalid assignment ID' });
      }

      // التحقق من وجود الواجب
      const assignment = await AssignmentQuestionsService.getAssignmentById(assignmentId);
      if (!assignment) {
        console.error('[Student Questions Endpoint] Assignment not found:', assignmentId);
        return res.status(404).json({ error: 'الواجب غير موجود' });
      }

      // هنا user.role === 'student'
      console.log('[Student Questions Endpoint] User info', {
        userId: user.id,
        userRole: user.role,
        assignmentId,
        lessonId: assignment.lesson_id,
      });

      // التحقق من اشتراك الطالب في الباقة
      const hasAccess = await checkStudentPackageAccess(assignmentId, user.id);
      if (!hasAccess) {
        // جلب معلومات إضافية للمساعدة في التشخيص
        let packageId = null;
        try {
          const assignment = await AssignmentQuestionsService.getAssignmentById(assignmentId);
          if (assignment?.lesson_id) {
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error
            const lesson = await PackageSubjectLessonService.getLessonById(assignment.lesson_id);
            if (lesson) {
                  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error
              const subjectId = await PackageSubjectLessonService.getSubjectIdByLessonId(lesson.id);
              if (subjectId) {
                const subjectResult = await pool.query(
                  'SELECT package_id FROM package_subject_items WHERE id = $1',
                  [subjectId]
                );
                if (subjectResult.rowCount) {
                  packageId = subjectResult.rows[0].package_id;
                }
              }
            }
          }
        } catch {
          // تجاهل الأخطاء في جلب المعلومات الإضافية
        }

        return res.status(403).json({
          error: 'Forbidden',
          message: 'يجب تفعيل الباقة أولاً للوصول إلى أسئلة الواجب',
          details: {
            assignment_id: assignmentId,
            student_id: user.id,
            package_id: packageId,
          },
        });
      }

      // التحقق من أن الطالب لم يسلم الواجب من قبل
      const hasSubmitted = await AssignmentSubmissionsService.hasStudentSubmitted(
        assignmentId,
        user.id,
      );

      // جلب الأسئلة
      const questions = await AssignmentQuestionsService.getQuestionsByAssignment(assignmentId);

      // إزالة الإجابات الصحيحة من الأسئلة (للطالب)
      const questionsForStudent = questions.map((q: any) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { correct_answer, correct_option_id, ...questionWithoutAnswer } = q;
        // إزالة correct_option_id من الخيارات أيضاً
        if (questionWithoutAnswer.options) {
          questionWithoutAnswer.options = questionWithoutAnswer.options.map((opt: any) => {
            // نعرض الخيارات مع IDs للطالب
            return {
              id: opt.id,
              option_text: opt.option_text,
              option_letter: opt.option_letter,
              order_index: opt.order_index,
            };
          });
        }
        return questionWithoutAnswer;
      });

      res.json({
        success: true,
        assignment_id: assignmentId,
        questions: questionsForStudent,
        total: questionsForStudent.length,
        has_submitted: hasSubmitted,
      });
    } catch (error: any) {
      console.error('Error fetching questions:', error);
      res.status(500).json({
        error: 'خطأ في جلب الأسئلة',
        message: error.message,
      });
    }
  }),
);

// 1.1 عرض أسئلة واجب معين للطالب (Endpoint واضح للطالب فقط)
// نفس منطق /assignments/:assignmentId/questions لكن بمسار غير متعارض
router.get(
  '/me/assignments/:assignmentId/questions',
  authMiddleware(['student']),
  asyncWrapper(async (req: Request, res: Response) => {
    try {
      const assignmentId = parseInt(req.params.assignmentId);
      if (isNaN(assignmentId)) {
        return res.status(400).json({ error: 'Invalid assignment ID' });
      }

      // التحقق من وجود الواجب
      const assignment = await AssignmentQuestionsService.getAssignmentById(assignmentId);
      if (!assignment) {
        return res.status(404).json({ error: 'الواجب غير موجود' });
      }

      const user = (req as any).user;

      // التحقق من اشتراك الطالب في الباقة (تفعيل بالكود)
      const hasAccess = await checkStudentPackageAccess(assignmentId, user.id);
      if (!hasAccess) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'يجب تفعيل الباقة أولاً للوصول إلى أسئلة الواجب',
        });
      }

      // التحقق من أن الطالب لم يسلم الواجب من قبل
      const hasSubmitted = await AssignmentSubmissionsService.hasStudentSubmitted(
        assignmentId,
        user.id
      );

      // جلب الأسئلة
      const questions = await AssignmentQuestionsService.getQuestionsByAssignment(assignmentId);

      // إزالة الإجابات الصحيحة من الأسئلة (للطالب)
      const questionsForStudent = questions.map((q: any) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { correct_answer, correct_option_id, ...questionWithoutAnswer } = q;
        if (questionWithoutAnswer.options) {
          questionWithoutAnswer.options = questionWithoutAnswer.options.map((opt: any) => ({
            id: opt.id,
            option_text: opt.option_text,
            option_letter: opt.option_letter,
            order_index: opt.order_index,
          }));
        }
        return questionWithoutAnswer;
      });

      return res.json({
        success: true,
        assignment_id: assignmentId,
        questions: questionsForStudent,
        total: questionsForStudent.length,
        has_submitted: hasSubmitted,
      });
    } catch (error: any) {
      console.error('Error fetching questions (student endpoint):', error);
      return res.status(500).json({
        error: 'خطأ في جلب الأسئلة',
        message: error.message,
      });
    }
  })
);

// 2. تسليم الواجب
router.post(
  '/assignments/:assignmentId/submit',
  authMiddleware(['student']),
  asyncWrapper(async (req: Request, res: Response) => {
    try {
      const assignmentId = parseInt(req.params.assignmentId);
      if (isNaN(assignmentId)) {
        return res.status(400).json({ error: 'Invalid assignment ID' });
      }

      // التحقق من وجود الواجب
      const assignment = await AssignmentQuestionsService.getAssignmentById(assignmentId);
      if (!assignment) {
        return res.status(404).json({ error: 'الواجب غير موجود' });
      }

      const user = (req as any).user;

      // التحقق من اشتراك الطالب في الباقة
      const hasAccess = await checkStudentPackageAccess(assignmentId, user.id);
      if (!hasAccess) {
        return res.status(403).json({
          success: false,
          error: 'Forbidden',
          message: 'غير مسموح الوصول، فعل الباقة أولاً لتسليم الواجب',
        });
      }

      // التحقق من أن الطالب لم يسلم الواجب من قبل
      const hasSubmitted = await AssignmentSubmissionsService.hasStudentSubmitted(
        assignmentId,
        user.id,
      );
      if (hasSubmitted) {
        return res.status(400).json({
          error: 'لقد قمت بتسليم هذا الواجب من قبل',
        });
      }

      // التحقق من وجود البيانات
      if (!req.body || !req.body.answers) {
        return res.status(400).json({
          error: 'Missing data',
          message: 'يجب إرسال مصفوفة answers مع إجابات الطالب',
        });
      }

      // التحقق من صحة البيانات
      console.log('Request body:', JSON.stringify(req.body, null, 2));
      const parse = SubmitAssignmentSchema.safeParse(req.body);
      if (!parse.success) {
        console.error('Validation errors:', JSON.stringify(parse.error.errors, null, 2));
        return res.status(400).json({
          error: 'Validation failed',
          message: 'البيانات المرسلة غير صحيحة',
          errors: parse.error.errors.map((err) => ({
            path: err.path.join('.'),
            message: err.message,
            code: err.code,
          })),
        });
      }

      // تسليم الواجب
      const submission = await AssignmentSubmissionsService.submitAssignment(
        assignmentId,
        user.id,
        parse.data,
      );

      res.status(201).json({
        success: true,
        message: 'تم تسليم الواجب بنجاح',
        submission: {
          id: submission.id,
          assignment_id: submission.assignment_id,
          total_questions: submission.total_questions,
          correct_answers: submission.correct_answers,
          wrong_answers: submission.wrong_answers,
          score: submission.score,
          submitted_at: submission.submitted_at,
        },
      });
    } catch (error: any) {
      console.error('Error submitting assignment:', error);

      // تحديد نوع الخطأ وإرجاع الـ status code المناسب
      if (error.message && error.message.includes('لقد قمت بتسليم')) {
        return res.status(400).json({
          error: 'لقد قمت بتسليم هذا الواجب من قبل',
        });
      }

      if (
        error.message &&
        (error.message.includes('يجب الإجابة على جميع الأسئلة') ||
          error.message.includes('إجابة مفقودة') ||
          error.message.includes('إجابة مكررة') ||
          error.message.includes('الخيار المحدد') ||
          error.message.includes('لا ينتمي'))
      ) {
        return res.status(400).json({
          error: error.message,
        });
      }

      if (
        error.message &&
        (error.message.includes('الواجب غير موجود') || error.message.includes('لا توجد أسئلة'))
      ) {
        return res.status(404).json({
          error: error.message,
        });
      }

      res.status(500).json({
        error: 'خطأ في تسليم الواجب',
        message: error.message || 'حدث خطأ غير متوقع',
      });
    }
  }),
);

// 3. عرض التصحيح والنتيجة
router.get(
  '/assignments/:assignmentId/submission',
  authMiddleware(['student']),
  asyncWrapper(async (req: Request, res: Response) => {
    try {
      const assignmentId = parseInt(req.params.assignmentId);
      if (isNaN(assignmentId)) {
        return res.status(400).json({ error: 'Invalid assignment ID' });
      }

      // التحقق من وجود الواجب
      const assignment = await AssignmentQuestionsService.getAssignmentById(assignmentId);
      if (!assignment) {
        return res.status(404).json({ error: 'الواجب غير موجود' });
      }

      const user = (req as any).user;

      // التحقق من اشتراك الطالب في الباقة
      const hasAccess = await checkStudentPackageAccess(assignmentId, user.id);
      if (!hasAccess) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'يجب تفعيل الباقة أولاً للوصول إلى التصحيح',
        });
      }

      // جلب تسليم الطالب
      const submission = await AssignmentSubmissionsService.getStudentSubmission(
        assignmentId,
        user.id,
      );

      if (!submission) {
        return res.status(404).json({
          error: 'لم تقم بتسليم هذا الواجب بعد',
        });
      }

      // تنسيق الإجابات مع تفاصيل الأخطاء
      const formattedAnswers = submission.answers.map((answer: any) => {
        const formatted: any = {
          question_id: answer.question_id,
          question_type: answer.question_type,
          question_text: answer.question_text,
          options: answer.options || [], // جميع الخيارات مع IDs
          images: answer.images || [],
          student_option_id: answer.student_option_id,
          student_answer: answer.student_answer,
          student_option: answer.student_option || null,
          correct_option_id: answer.correct_option_id,
          correct_answer: answer.correct_answer,
          correct_option: answer.correct_option || null,
          is_correct: answer.is_correct,
        };

        // إضافة معلومات الخطأ إذا كانت الإجابة خاطئة
        if (!answer.is_correct) {
          formatted.error = {
            message: 'إجابة خاطئة',
            your_option_id: answer.student_option_id,
            your_answer: answer.student_answer,
            your_option_text: answer.student_option?.option_text || null,
            correct_option_id: answer.correct_option_id,
            correct_answer: answer.correct_answer,
            correct_option_text: answer.correct_option?.option_text || null,
          };
        }

        return formatted;
      });

      res.json({
        success: true,
        submission: {
          id: submission.id,
          assignment_id: submission.assignment_id,
          total_questions: submission.total_questions,
          correct_answers: submission.correct_answers,
          wrong_answers: submission.wrong_answers,
          score: parseFloat(submission.score),
          submitted_at: submission.submitted_at,
          answers: formattedAnswers,
        },
      });
    } catch (error: any) {
      console.error('Error fetching submission:', error);
      res.status(500).json({
        error: 'خطأ في جلب التصحيح',
        message: error.message,
      });
    }
  }),
);

export { router };
