"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TeacherPermissionController = void 0;
const teacherPermissions_1 = require("../services/teacherPermissions");
const questionBank_1 = require("../db/types/questionBank");
class TeacherPermissionController {
    // Grant permission to teacher
    static async grant(req, res) {
        try {
            const questionBankId = parseInt(req.params.bankId);
            const subjectId = parseInt(req.params.subjectId);
            if (isNaN(questionBankId) || isNaN(subjectId)) {
                return res.status(400).json({
                    success: false,
                    message: 'معرفات غير صحيحة',
                });
            }
            const adminId = req.user.id;
            const validatedData = questionBank_1.CreateTeacherPermissionSchema.parse(req.body);
            const permission = await teacherPermissions_1.TeacherPermissionService.grant(questionBankId, subjectId, adminId, validatedData);
            res.status(201).json({
                success: true,
                message: 'تم منح الصلاحية بنجاح',
                data: permission,
            });
        }
        catch (error) {
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
    static async getBySubject(req, res) {
        try {
            const questionBankId = parseInt(req.params.bankId);
            const subjectId = parseInt(req.params.subjectId);
            if (isNaN(questionBankId) || isNaN(subjectId)) {
                return res.status(400).json({
                    success: false,
                    message: 'معرفات غير صحيحة',
                });
            }
            const result = await teacherPermissions_1.TeacherPermissionService.getBySubject(questionBankId, subjectId);
            res.status(200).json({
                success: true,
                data: result,
            });
        }
        catch (error) {
            res.status(500).json({
                success: false,
                message: 'خطأ في جلب الصلاحيات',
                error: error.message,
            });
        }
    }
    // Get permission by ID
    static async getById(req, res) {
        try {
            const id = parseInt(req.params.permissionId);
            if (isNaN(id)) {
                return res.status(400).json({
                    success: false,
                    message: 'معرف الصلاحية غير صحيح',
                });
            }
            const permission = await teacherPermissions_1.TeacherPermissionService.getById(id);
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
        }
        catch (error) {
            res.status(500).json({
                success: false,
                message: 'خطأ في جلب الصلاحية',
                error: error.message,
            });
        }
    }
    // Update permission
    static async update(req, res) {
        try {
            const permissionId = parseInt(req.params.permissionId);
            if (isNaN(permissionId)) {
                return res.status(400).json({
                    success: false,
                    message: 'معرف الصلاحية غير صحيح',
                });
            }
            const validatedData = questionBank_1.CreateTeacherPermissionSchema.partial().parse(req.body);
            const permission = await teacherPermissions_1.TeacherPermissionService.update(permissionId, validatedData);
            res.status(200).json({
                success: true,
                message: 'تم تحديث الصلاحية بنجاح',
                data: permission,
            });
        }
        catch (error) {
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
    static async revoke(req, res) {
        try {
            const permissionId = parseInt(req.params.permissionId);
            if (isNaN(permissionId)) {
                return res.status(400).json({
                    success: false,
                    message: 'معرف الصلاحية غير صحيح',
                });
            }
            await teacherPermissions_1.TeacherPermissionService.revoke(permissionId);
            res.status(200).json({
                success: true,
                message: 'تم إلغاء الصلاحية بنجاح',
            });
        }
        catch (error) {
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
    static async delete(req, res) {
        try {
            const permissionId = parseInt(req.params.permissionId);
            if (isNaN(permissionId)) {
                return res.status(400).json({
                    success: false,
                    message: 'معرف الصلاحية غير صحيح',
                });
            }
            await teacherPermissions_1.TeacherPermissionService.delete(permissionId);
            res.status(200).json({
                success: true,
                message: 'تم حذف الصلاحية بنجاح',
            });
        }
        catch (error) {
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
    static async getByTeacher(req, res) {
        try {
            const teacherId = parseInt(req.params.teacherId);
            if (isNaN(teacherId)) {
                return res.status(400).json({
                    success: false,
                    message: 'معرف المدرس غير صحيح',
                });
            }
            const permissions = await teacherPermissions_1.TeacherPermissionService.getByTeacher(teacherId);
            res.status(200).json({
                success: true,
                data: {
                    permissions,
                    total: permissions.length,
                },
            });
        }
        catch (error) {
            res.status(500).json({
                success: false,
                message: 'خطأ في جلب صلاحيات المدرس',
                error: error.message,
            });
        }
    }
}
exports.TeacherPermissionController = TeacherPermissionController;
