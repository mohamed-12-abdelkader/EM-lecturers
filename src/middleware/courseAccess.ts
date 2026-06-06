import { RequestHandler } from 'express';
import { CourseAccessService } from '../services/courseAccess';

/**
 * Middleware للتحقق من صلاحية الطالب للوصول إلى محتوى المقرر الدراسي
 * يجب استخدامه قبل أي endpoint يعرض محتوى المقرر للطلاب
 */
export function checkCourseAccess(): RequestHandler {
  return async (req, res, next) => {
    try {
      const user = req.user;

      // التحقق من أن المستخدم موجود ومصادق عليه
      if (!user) {
        return res.status(401).json({
          access: false,
          message: 'غير مصرح به',
        });
      }

      // إذا كان المستخدم ليس طالباً، السماح بالوصول (للمعلمين والأدمن)
      if (user.role !== 'student') {
        return next();
      }

      // الحصول على معرف المقرر من params أو body
      const courseId = parseInt(req.params.courseId || req.body.course_id || req.query.course_id);

      if (!courseId || isNaN(courseId)) {
        return res.status(400).json({
          access: false,
          message: 'معرف المقرر الدراسي غير صحيح',
        });
      }

      // التحقق من صلاحية الوصول
      const accessCheck = await CourseAccessService.checkStudentAccess(user.id, courseId);

      // إذا لم يكن لديه صلاحية الوصول
      if (!accessCheck.hasAccess) {
        return res.status(403).json({
          access: false,
          message: accessCheck.message || 'تم حجب المحتوي لحين تجديد الاشتراك',
        });
      }

      // إضافة معلومات الوصول إلى request للاستخدام لاحقاً
      (req as any).courseAccess = accessCheck;

      // السماح بالوصول
      next();
    } catch (error) {
      console.error('Error in checkCourseAccess middleware:', error);
      return res.status(500).json({
        access: false,
        message: 'خطأ في التحقق من صلاحية الوصول',
      });
    }
  };
}
