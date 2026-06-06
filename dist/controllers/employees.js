"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const express_1 = require("express");
const authentication_1 = require("../middleware/authentication");
const employees_1 = require("../services/employees");
const utils_1 = require("../utils");
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const pool_1 = __importDefault(require("../db/pool"));
const router = (0, express_1.Router)();
exports.router = router;
// إعداد multer لرفع الصور
const storage = multer_1.default.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = 'uploads';
        if (!fs_1.default.existsSync(uploadDir)) {
            fs_1.default.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        cb(null, 'employee-' + uniqueSuffix + path_1.default.extname(file.originalname));
    },
});
const upload = (0, multer_1.default)({
    storage: storage,
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB
    },
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif/;
        const extname = allowedTypes.test(path_1.default.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        if (mimetype && extname) {
            return cb(null, true);
        }
        else {
            cb(new Error('يسمح فقط بملفات الصور (jpeg, jpg, png, gif)'));
        }
    },
});
// إنشاء موظف جديد
router.post('/', (0, authentication_1.authMiddleware)(['admin']), async (req, res) => {
    try {
        const { name, email, password, phone, permissions } = req.body;
        const createdBy = req.user.id;
        if (!name || !email || !password || !permissions) {
            return res.status(400).json({
                error: 'الاسم والإيميل وكلمة المرور والصلاحيات مطلوبة',
            });
        }
        // التحقق من عدم وجود إيميل مكرر
        const tenantId = req.tenant.id;
        const existingUser = await pool_1.default.query('SELECT id FROM users WHERE email = $1 AND tenant_id = $2', [
            email,
            tenantId,
        ]);
        if (existingUser.rowCount && existingUser.rowCount > 0) {
            return res.status(400).json({ error: 'الإيميل مستخدم بالفعل' });
        }
        const employeeData = {
            name,
            email,
            password,
            phone,
            permissions: Array.isArray(permissions) ? permissions : [permissions],
        };
        const result = await employees_1.EmployeeService.createEmployee(employeeData, createdBy, tenantId);
        res.status(201).json({
            message: 'تم إنشاء الموظف بنجاح',
            employee: {
                ...result.employee,
                user: result.user,
            },
        });
    }
    catch (error) {
        utils_1.logger.error('Error creating employee:', error);
        res.status(500).json({
            error: 'خطأ في إنشاء الموظف',
            details: error instanceof Error ? error.message : 'Unknown error',
        });
    }
});
// جلب جميع الموظفين
router.get('/', (0, authentication_1.authMiddleware)(['admin']), async (req, res) => {
    try {
        const employees = await employees_1.EmployeeService.getAllEmployees();
        res.json({ employees });
    }
    catch (error) {
        utils_1.logger.error('Error fetching employees:', error);
        res.status(500).json({
            error: 'خطأ في جلب الموظفين',
            details: error instanceof Error ? error.message : 'Unknown error',
        });
    }
});
// جلب موظف بواسطة ID
router.get('/:id', (0, authentication_1.authMiddleware)(['admin']), async (req, res) => {
    try {
        const { id } = req.params;
        const employee = await employees_1.EmployeeService.getEmployeeById(parseInt(id));
        if (!employee) {
            return res.status(404).json({ error: 'الموظف غير موجود' });
        }
        res.json({ employee });
    }
    catch (error) {
        utils_1.logger.error('Error fetching employee:', error);
        res.status(500).json({
            error: 'خطأ في جلب الموظف',
            details: error instanceof Error ? error.message : 'Unknown error',
        });
    }
});
// تحديث بيانات الموظف
router.put('/:id', (0, authentication_1.authMiddleware)(['admin']), async (req, res) => {
    try {
        const { id } = req.params;
        const { name, phone, permissions, is_active } = req.body;
        const updateData = {};
        if (name !== undefined)
            updateData.name = name;
        if (phone !== undefined)
            updateData.phone = phone;
        if (permissions !== undefined) {
            updateData.permissions = Array.isArray(permissions) ? permissions : [permissions];
        }
        if (is_active !== undefined)
            updateData.is_active = is_active;
        const employee = await employees_1.EmployeeService.updateEmployee(parseInt(id), updateData);
        res.json({
            message: 'تم تحديث بيانات الموظف بنجاح',
            employee,
        });
    }
    catch (error) {
        utils_1.logger.error('Error updating employee:', error);
        res.status(500).json({
            error: 'خطأ في تحديث بيانات الموظف',
            details: error instanceof Error ? error.message : 'Unknown error',
        });
    }
});
// رفع صورة الموظف
router.post('/:id/avatar', (0, authentication_1.authMiddleware)(['admin']), upload.single('avatar'), async (req, res) => {
    try {
        const { id } = req.params;
        const file = req.file;
        if (!file) {
            return res.status(400).json({ error: 'لم يتم رفع أي ملف' });
        }
        const avatarPath = (await (0, utils_1.uploadToCloudinary)(file.path)).secure_url;
        const employee = await employees_1.EmployeeService.updateEmployeeAvatar(parseInt(id), avatarPath);
        res.json({
            message: 'تم رفع الصورة بنجاح',
            employee: {
                ...employee,
                avatar: avatarPath,
            },
        });
    }
    catch (error) {
        utils_1.logger.error('Error uploading employee avatar:', error);
        res.status(500).json({
            error: 'خطأ في رفع الصورة',
            details: error instanceof Error ? error.message : 'Unknown error',
        });
    }
});
// تحديث كلمة مرور الموظف
router.put('/:id/password', (0, authentication_1.authMiddleware)(['admin']), async (req, res) => {
    try {
        const { id } = req.params;
        const { new_password } = req.body;
        if (!new_password) {
            return res.status(400).json({ error: 'كلمة المرور الجديدة مطلوبة' });
        }
        const user = await employees_1.EmployeeService.updateEmployeePassword(parseInt(id), new_password);
        res.json({
            message: 'تم تحديث كلمة المرور بنجاح',
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
            },
        });
    }
    catch (error) {
        utils_1.logger.error('Error updating employee password:', error);
        res.status(500).json({
            error: 'خطأ في تحديث كلمة المرور',
            details: error instanceof Error ? error.message : 'Unknown error',
        });
    }
});
// حذف موظف (تعطيل)
router.delete('/:id', (0, authentication_1.authMiddleware)(['admin']), async (req, res) => {
    try {
        const { id } = req.params;
        const employee = await employees_1.EmployeeService.deactivateEmployee(parseInt(id));
        if (!employee) {
            return res.status(404).json({ error: 'الموظف غير موجود' });
        }
        res.json({
            message: 'تم حذف الموظف بنجاح',
            employee,
        });
    }
    catch (error) {
        utils_1.logger.error('Error deleting employee:', error);
        res.status(500).json({
            error: 'خطأ في حذف الموظف',
            details: error instanceof Error ? error.message : 'Unknown error',
        });
    }
});
// جلب صلاحيات الموظف الحالي
router.get('/me/permissions', (0, authentication_1.authMiddleware)(['admin']), async (req, res) => {
    try {
        const userId = req.user.id;
        const permissions = await employees_1.EmployeeService.getEmployeePermissions(userId);
        if (!permissions) {
            return res.status(404).json({ error: 'الموظف غير موجود أو غير مفعل' });
        }
        res.json({ permissions });
    }
    catch (error) {
        utils_1.logger.error('Error fetching employee permissions:', error);
        res.status(500).json({
            error: 'خطأ في جلب الصلاحيات',
            details: error instanceof Error ? error.message : 'Unknown error',
        });
    }
});
// إنشاء employee record للـ admin الحالي
router.post('/me/create-employee', (0, authentication_1.authMiddleware)(['admin']), async (req, res) => {
    try {
        const userId = req.user.id;
        const { phone, permissions } = req.body;
        // التحقق من وجود employee record بالفعل
        const existingEmployee = await employees_1.EmployeeService.getEmployeeByUserId(userId);
        if (existingEmployee) {
            return res.status(400).json({ error: 'الموظف موجود بالفعل' });
        }
        // جلب بيانات المستخدم
        const userResult = await pool_1.default.query('SELECT * FROM users WHERE id = $1', [userId]);
        if (!userResult.rowCount) {
            return res.status(404).json({ error: 'المستخدم غير موجود' });
        }
        const user = userResult.rows[0];
        // إنشاء employee record
        const employeeResult = await pool_1.default.query(`INSERT INTO employees (user_id, name, email, phone, permissions, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`, [
            userId,
            user.name,
            user.email,
            phone || null,
            JSON.stringify(permissions || {}),
            userId, // created_by = نفس المستخدم
        ]);
        const employee = employeeResult.rows[0];
        res.status(201).json({
            message: 'تم إنشاء employee record بنجاح',
            employee: {
                ...employee,
                user: {
                    id: user.id,
                    name: user.name,
                    email: user.email,
                    role: user.role,
                },
            },
        });
    }
    catch (error) {
        utils_1.logger.error('Error creating employee record:', error);
        res.status(500).json({
            error: 'خطأ في إنشاء employee record',
            details: error instanceof Error ? error.message : 'Unknown error',
        });
    }
});
