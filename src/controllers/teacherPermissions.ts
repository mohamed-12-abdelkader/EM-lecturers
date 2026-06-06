import { Request, Response } from 'express';
import { TeacherPermissionService } from '../services/teacherPermissions';
import { CreateTeacherPermissionSchema } from '../db/types/questionBank';

export class TeacherPermissionController {
  // Grant permission to teacher
  static async grant(req: Request, res: Response) {
    try {
      const questionBankId = parseInt(req.params.bankId);
      const subjectId = parseInt(req.params.subjectId);

      if (isNaN(questionBankId) || isNaN(subjectId)) {
        return res.status(400).json({
          success: false,
          message: 'معرفات غير صحيحة',
        });
      }

      const adminId = (req as any).user.id;
      const validatedData = CreateTeacherPermissionSchema.parse(req.body);

      const permission = await TeacherPermissionService.grant(
        questionBankId,
        subjectId,
        adminId,
        validatedData,
      );

      res.status(201).json({
        success: true,
        message: 'تم منح الصلاحية بنجاح',
        data: permission,
      });
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return res.status(400).json({
          success: false,
          message: 'بيانات غير صحيحة',
          errors: error.errors,
        });
      }

      if (error.message === 'المادة غير موجودة أو لا تنتمي لهذا بنك الأسئلة') {
        return res.status(404).json({
          success: false,
          message: error.message,
        });
      }

      if (error.message === 'المدرس غير موجود أو ليس مدرساً') {
        return res.status(404).json({
          success: false,
          message: error.message,
        });
      }

      if (error.message === 'المدرس لديه صلاحية بالفعل لهذه المادة') {
        return res.status(409).json({
          success: false,
          message: error.message,
        });
      }

      res.status(500).json({
        success: false,
        message: 'خطأ في منح الصلاحية',
        error: error.message,
      });
    }
  }

  // Get permissions for a subject
  static async getBySubject(req: Request, res: Response) {
    try {
      const questionBankId = parseInt(req.params.bankId);
      const subjectId = parseInt(req.params.subjectId);

      if (isNaN(questionBankId) || isNaN(subjectId)) {
        return res.status(400).json({
          success: false,
          message: 'معرفات غير صحيحة',
        });
      }

      const result = await TeacherPermissionService.getBySubject(questionBankId, subjectId);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: 'خطأ في جلب الصلاحيات',
        error: error.message,
      });
    }
  }

  // Get permission by ID
  static async getById(req: Request, res: Response) {
    try {
      const id = parseInt(req.params.permissionId);
      if (isNaN(id)) {
        return res.status(400).json({
          success: false,
          message: 'معرف الصلاحية غير صحيح',
        });
      }

      const permission = await TeacherPermissionService.getById(id);
      if (!permission) {
        return res.status(404).json({
          success: false,
          message: 'الصلاحية غير موجودة',
        });
      }

      res.status(200).json({
        success: true,
        data: permission,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: 'خطأ في جلب الصلاحية',
        error: error.message,
      });
    }
  }

  // Update permission
  static async update(req: Request, res: Response) {
    try {
      const permissionId = parseInt(req.params.permissionId);
      if (isNaN(permissionId)) {
        return res.status(400).json({
          success: false,
          message: 'معرف الصلاحية غير صحيح',
        });
      }

      const validatedData = CreateTeacherPermissionSchema.partial().parse(req.body);
      const permission = await TeacherPermissionService.update(permissionId, validatedData);

      res.status(200).json({
        success: true,
        message: 'تم تحديث الصلاحية بنجاح',
        data: permission,
      });
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return res.status(400).json({
          success: false,
          message: 'بيانات غير صحيحة',
          errors: error.errors,
        });
      }

      if (error.message === 'الصلاحية غير موجودة') {
        return res.status(404).json({
          success: false,
          message: error.message,
        });
      }

      res.status(500).json({
        success: false,
        message: 'خطأ في تحديث الصلاحية',
        error: error.message,
      });
    }
  }

  // Revoke permission
  static async revoke(req: Request, res: Response) {
    try {
      const permissionId = parseInt(req.params.permissionId);
      if (isNaN(permissionId)) {
        return res.status(400).json({
          success: false,
          message: 'معرف الصلاحية غير صحيح',
        });
      }

      await TeacherPermissionService.revoke(permissionId);

      res.status(200).json({
        success: true,
        message: 'تم إلغاء الصلاحية بنجاح',
      });
    } catch (error: any) {
      if (error.message === 'الصلاحية غير موجودة') {
        return res.status(404).json({
          success: false,
          message: error.message,
        });
      }

      res.status(500).json({
        success: false,
        message: 'خطأ في إلغاء الصلاحية',
        error: error.message,
      });
    }
  }

  // Delete permission permanently
  static async delete(req: Request, res: Response) {
    try {
      const permissionId = parseInt(req.params.permissionId);
      if (isNaN(permissionId)) {
        return res.status(400).json({
          success: false,
          message: 'معرف الصلاحية غير صحيح',
        });
      }

      await TeacherPermissionService.delete(permissionId);

      res.status(200).json({
        success: true,
        message: 'تم حذف الصلاحية بنجاح',
      });
    } catch (error: any) {
      if (error.message === 'الصلاحية غير موجودة') {
        return res.status(404).json({
          success: false,
          message: error.message,
        });
      }

      res.status(500).json({
        success: false,
        message: 'خطأ في حذف الصلاحية',
        error: error.message,
      });
    }
  }

  // Get all permissions for a teacher
  static async getByTeacher(req: Request, res: Response) {
    try {
      const teacherId = parseInt(req.params.teacherId);
      if (isNaN(teacherId)) {
        return res.status(400).json({
          success: false,
          message: 'معرف المدرس غير صحيح',
        });
      }

      const permissions = await TeacherPermissionService.getByTeacher(teacherId);

      res.status(200).json({
        success: true,
        data: {
          permissions,
          total: permissions.length,
        },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: 'خطأ في جلب صلاحيات المدرس',
        error: error.message,
      });
    }
  }
}
