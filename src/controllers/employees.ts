import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/authentication';
import { EmployeeService, EmployeeData } from '../services/employees';
import { logger, uploadToCloudinary } from '../utils';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import pool from '../db/pool';

const router = Router();

// إعداد multer لرفع الصور
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'uploads';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'employee-' + uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('يسمح فقط بملفات الصور (jpeg, jpg, png, gif)'));
    }
  },
});

// إنشاء موظف جديد
router.post('/', authMiddleware(['admin']), async (req: Request, res: Response) => {
  try {
    const { name, email, password, phone, permissions } = req.body;
    const createdBy = (req as any).user.id;

    if (!name || !email || !password || !permissions) {
      return res.status(400).json({
        error: 'الاسم والإيميل وكلمة المرور والصلاحيات مطلوبة',
      });
    }

    // التحقق من عدم وجود إيميل مكرر
    const tenantId = req.tenant!.id;
    const existingUser = await pool.query('SELECT id FROM users WHERE email = $1 AND tenant_id = $2', [
      email,
      tenantId,
    ]);
    if (existingUser.rowCount && existingUser.rowCount > 0) {
      return res.status(400).json({ error: 'الإيميل مستخدم بالفعل' });
    }

    const employeeData: EmployeeData = {
      name,
      email,
      password,
      phone,
      permissions: Array.isArray(permissions) ? permissions : [permissions],
    };

    const result = await EmployeeService.createEmployee(employeeData, createdBy, tenantId);

    res.status(201).json({
      message: 'تم إنشاء الموظف بنجاح',
      employee: {
        ...result.employee,
        user: result.user,
      },
    });
  } catch (error) {
    logger.error('Error creating employee:', error);
    res.status(500).json({
      error: 'خطأ في إنشاء الموظف',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// جلب جميع الموظفين
router.get('/', authMiddleware(['admin']), async (req: Request, res: Response) => {
  try {
    const employees = await EmployeeService.getAllEmployees();

    res.json({ employees });
  } catch (error) {
    logger.error('Error fetching employees:', error);
    res.status(500).json({
      error: 'خطأ في جلب الموظفين',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// جلب موظف بواسطة ID
router.get('/:id', authMiddleware(['admin']), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const employee = await EmployeeService.getEmployeeById(parseInt(id));

    if (!employee) {
      return res.status(404).json({ error: 'الموظف غير موجود' });
    }

    res.json({ employee });
  } catch (error) {
    logger.error('Error fetching employee:', error);
    res.status(500).json({
      error: 'خطأ في جلب الموظف',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// تحديث بيانات الموظف
router.put('/:id', authMiddleware(['admin']), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, phone, permissions, is_active } = req.body;

    const updateData: any = {};
    if (name !== undefined) updateData.name = name;
    if (phone !== undefined) updateData.phone = phone;
    if (permissions !== undefined) {
      updateData.permissions = Array.isArray(permissions) ? permissions : [permissions];
    }
    if (is_active !== undefined) updateData.is_active = is_active;

    const employee = await EmployeeService.updateEmployee(parseInt(id), updateData);

    res.json({
      message: 'تم تحديث بيانات الموظف بنجاح',
      employee,
    });
  } catch (error) {
    logger.error('Error updating employee:', error);
    res.status(500).json({
      error: 'خطأ في تحديث بيانات الموظف',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// رفع صورة الموظف
router.post(
  '/:id/avatar',
  authMiddleware(['admin']),
  upload.single('avatar'),
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const file = req.file;

      if (!file) {
        return res.status(400).json({ error: 'لم يتم رفع أي ملف' });
      }

      const avatarPath = (await uploadToCloudinary(file.path)).secure_url;

      const employee = await EmployeeService.updateEmployeeAvatar(parseInt(id), avatarPath);

      res.json({
        message: 'تم رفع الصورة بنجاح',
        employee: {
          ...employee,
          avatar: avatarPath,
        },
      });
    } catch (error) {
      logger.error('Error uploading employee avatar:', error);
      res.status(500).json({
        error: 'خطأ في رفع الصورة',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  },
);

// تحديث كلمة مرور الموظف
router.put('/:id/password', authMiddleware(['admin']), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { new_password } = req.body;

    if (!new_password) {
      return res.status(400).json({ error: 'كلمة المرور الجديدة مطلوبة' });
    }

    const user = await EmployeeService.updateEmployeePassword(parseInt(id), new_password);

    res.json({
      message: 'تم تحديث كلمة المرور بنجاح',
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
    });
  } catch (error) {
    logger.error('Error updating employee password:', error);
    res.status(500).json({
      error: 'خطأ في تحديث كلمة المرور',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// حذف موظف (تعطيل)
router.delete('/:id', authMiddleware(['admin']), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const employee = await EmployeeService.deactivateEmployee(parseInt(id));

    if (!employee) {
      return res.status(404).json({ error: 'الموظف غير موجود' });
    }

    res.json({
      message: 'تم حذف الموظف بنجاح',
      employee,
    });
  } catch (error) {
    logger.error('Error deleting employee:', error);
    res.status(500).json({
      error: 'خطأ في حذف الموظف',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// جلب صلاحيات الموظف الحالي
router.get('/me/permissions', authMiddleware(['admin']), async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const permissions = await EmployeeService.getEmployeePermissions(userId);

    if (!permissions) {
      return res.status(404).json({ error: 'الموظف غير موجود أو غير مفعل' });
    }

    res.json({ permissions });
  } catch (error) {
    logger.error('Error fetching employee permissions:', error);
    res.status(500).json({
      error: 'خطأ في جلب الصلاحيات',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// إنشاء employee record للـ admin الحالي
router.post(
  '/me/create-employee',
  authMiddleware(['admin']),
  async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user.id;
      const { phone, permissions } = req.body;

      // التحقق من وجود employee record بالفعل
      const existingEmployee = await EmployeeService.getEmployeeByUserId(userId);
      if (existingEmployee) {
        return res.status(400).json({ error: 'الموظف موجود بالفعل' });
      }

      // جلب بيانات المستخدم
      const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
      if (!userResult.rowCount) {
        return res.status(404).json({ error: 'المستخدم غير موجود' });
      }

      const user = userResult.rows[0];

      // إنشاء employee record
      const employeeResult = await pool.query(
        `INSERT INTO employees (user_id, name, email, phone, permissions, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [
          userId,
          user.name,
          user.email,
          phone || null,
          JSON.stringify(permissions || {}),
          userId, // created_by = نفس المستخدم
        ],
      );

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
    } catch (error) {
      logger.error('Error creating employee record:', error);
      res.status(500).json({
        error: 'خطأ في إنشاء employee record',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  },
);

export { router };
