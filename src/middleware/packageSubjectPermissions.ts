import { Request, Response, NextFunction } from 'express';
import pool from '../db/pool';
import { PackageSubjectPermissionsService } from '../services/packageSubjectPermissions';
import { PackageActivationCodeService } from '../services/packageActivationCodes';

/**
 * Middleware للتحقق من صلاحية المدرس على مادة معينة
 * يستخدم للأدمن والمدرسين
 */
export async function checkTeacherSubjectPermission(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const user = (req as any).user;
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // الأدمن لديه صلاحية كاملة
    if (user.role === 'admin') {
      return next();
    }

    // المدرسون يحتاجون للتحقق من الصلاحية
    if (user.role === 'teacher') {
      const subjectId = parseInt(req.params.subjectId || req.body.subjectId || req.params.id);
      if (isNaN(subjectId)) {
        return res.status(400).json({ error: 'Invalid subject ID' });
      }

      const hasPermission = await PackageSubjectPermissionsService.hasPermission(
        subjectId,
        user.id,
      );

      if (!hasPermission) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'ليس لديك صلاحية للوصول إلى هذه المادة',
        });
      }

      return next();
    }

    return res.status(403).json({ error: 'Forbidden', message: 'غير مصرح لك بالوصول' });
  } catch (error: any) {
    console.error('Error checking teacher subject permission:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Middleware للتحقق من اشتراك الطالب في الباقة
 */
export async function checkStudentPackageAccess(req: Request, res: Response, next: NextFunction) {
  try {
    const user = (req as any).user;
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // الأدمن والمدرسون لديهم صلاحية كاملة
    if (user.role === 'admin' || user.role === 'teacher') {
      return next();
    }

    // الطلاب يحتاجون للتحقق من الاشتراك
    if (user.role === 'student') {
      const subjectId = parseInt(req.params.subjectId || req.params.id);
      if (isNaN(subjectId)) {
        return res.status(400).json({ error: 'Invalid subject ID' });
      }

      // جلب package_id من المادة
      const subjectResult = await pool.query(
        'SELECT package_id FROM package_subject_items WHERE id = $1',
        [subjectId],
      );

      if (!subjectResult.rowCount) {
        return res.status(404).json({ error: 'المادة غير موجودة' });
      }

      const packageId = subjectResult.rows[0].package_id;

      // التحقق من تفعيل الباقة
      const isActivated = await PackageActivationCodeService.isActivated(packageId, user.id);

      if (!isActivated) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'يجب تفعيل الباقة أولاً للوصول إلى هذه المادة',
        });
      }

      return next();
    }

    return res.status(403).json({ error: 'Forbidden', message: 'غير مصرح لك بالوصول' });
  } catch (error: any) {
    console.error('Error checking student package access:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
