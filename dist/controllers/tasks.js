"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const express_1 = require("express");
const authentication_1 = require("../middleware/authentication");
const tasks_1 = require("../services/tasks");
const employees_1 = require("../services/employees");
const utils_1 = require("../utils");
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const pool_1 = __importDefault(require("../db/pool"));
const router = (0, express_1.Router)();
exports.router = router;
// دالة مساعدة لتحليل صلاحيات الموظف
function parseEmployeePermissions(permissions) {
    try {
        return permissions ? JSON.parse(permissions) : [];
    }
    catch (error) {
        utils_1.logger.error('Error parsing employee permissions:', error);
        return [];
    }
}
/**
 * يحل معرف الموظف للتعيين: إما employees.id أو users.id (للتطبيقات التي ترسل user id بالخطأ).
 * الأولوية: assigned_user_id إن وُجد، وإلا assigned_to (يُجرّب كـ employee id ثم كـ user id).
 */
async function resolveTaskAssigneeEmployeeId(body) {
    const rawUser = body.assigned_user_id;
    if (rawUser !== undefined && rawUser !== null && String(rawUser).trim() !== '') {
        const uid = parseInt(String(rawUser), 10);
        if (Number.isNaN(uid))
            return null;
        const e = await employees_1.EmployeeService.getEmployeeByUserId(uid);
        return e ? e.id : null;
    }
    const rawEmp = body.assigned_to;
    if (rawEmp === undefined || rawEmp === null || String(rawEmp).trim() === '') {
        return null;
    }
    const n = parseInt(String(rawEmp), 10);
    if (Number.isNaN(n))
        return null;
    let e = await employees_1.EmployeeService.getEmployeeById(n);
    if (e)
        return e.id;
    e = await employees_1.EmployeeService.getEmployeeByUserId(n);
    return e ? e.id : null;
}
// إعداد multer لرفع الملفات
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
        cb(null, 'task-' + uniqueSuffix + path_1.default.extname(file.originalname));
    },
});
const upload = (0, multer_1.default)({
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB
    },
});
// إنشاء مهمة جديدة (للادمن فقط) — الحالة الافتراضية pending دائماً
router.post('/', (0, authentication_1.authMiddleware)(['admin']), async (req, res) => {
    try {
        const { title, description, priority, due_date, deadline, start_date, assigned_to, assigned_user_id } = req.body;
        const assignedBy = req.user.id;
        if (!title || typeof title !== 'string' || !title.trim()) {
            return res.status(400).json({
                error: 'عنوان المهمة مطلوب',
            });
        }
        const assigneeEmployeeId = await resolveTaskAssigneeEmployeeId({
            assigned_to,
            assigned_user_id,
        });
        if (assigneeEmployeeId == null) {
            return res.status(400).json({
                error: 'الموظف غير موجود أو غير مفعّل',
                code: 'ASSIGNEE_NOT_FOUND',
                hint: 'أرسل assigned_to = معرف سجل الموظف (employees.id) أو assigned_user_id = معرف المستخدم (users.id). التطبيقات التي ترسل users.id في assigned_to تُدعم تلقائياً إذا لم يُوجد employees.id بهذا الرقم.',
            });
        }
        const taskDeadline = deadline ?? due_date ?? null;
        const taskData = {
            title: title.trim(),
            description,
            priority: priority || 'medium',
            start_date: start_date || null,
            deadline: taskDeadline,
            assigned_to: assigneeEmployeeId,
        };
        const task = await tasks_1.TaskService.createTask(taskData, assignedBy);
        res.status(201).json({
            message: 'تم إنشاء المهمة بنجاح',
            task,
        });
    }
    catch (error) {
        utils_1.logger.error('Error creating task:', error);
        res.status(500).json({
            error: 'خطأ في إنشاء المهمة',
            details: error instanceof Error ? error.message : 'Unknown error',
        });
    }
});
// جلب جميع المهام (للادمن)
router.get('/', (0, authentication_1.authMiddleware)(['admin']), async (req, res) => {
    try {
        const { status, priority, assigned_to, limit, skip, deadline_from, deadline_to, created_from, created_to, } = req.query;
        const filters = {
            status: status,
            priority: priority,
            assigned_to: assigned_to ? parseInt(assigned_to, 10) : undefined,
            limit: limit ? parseInt(limit, 10) : undefined,
            skip: skip ? parseInt(skip, 10) : undefined,
            deadline_from: deadline_from,
            deadline_to: deadline_to,
            created_from: created_from,
            created_to: created_to,
        };
        const tasks = await tasks_1.TaskService.getAllTasks(filters);
        res.json({
            tasks,
            message: 'جميع المهام (عرض المدير)',
        });
    }
    catch (error) {
        utils_1.logger.error('Error fetching tasks:', error);
        res.status(500).json({
            error: 'خطأ في جلب المهام',
            details: error instanceof Error ? error.message : 'Unknown error',
        });
    }
});
// جلب مهام الموظف الحالي
router.get('/my-tasks', (0, authentication_1.authMiddleware)(['admin', 'employee']), async (req, res) => {
    try {
        const userId = req.user.id;
        // جلب بيانات الموظف
        const employee = await employees_1.EmployeeService.getEmployeeByUserId(userId);
        // إذا لم يكن لديه employee record، نرجع خطأ
        if (!employee) {
            return res.status(404).json({
                error: 'الموظف غير موجود',
                message: 'يجب إنشاء employee record أولاً للوصول إلى مهامك',
            });
        }
        const { status, priority, limit, skip } = req.query;
        const filters = {
            status: status,
            priority: priority,
            limit: limit ? parseInt(limit) : undefined,
            skip: skip ? parseInt(skip) : undefined,
        };
        // جلب مهام الموظف الحالي فقط
        const tasks = await tasks_1.TaskService.getEmployeeTasks(employee.id, filters);
        res.json({
            tasks,
            employee: {
                id: employee.id,
                name: employee.name,
                email: employee.email,
                permissions: parseEmployeePermissions(employee.permissions),
            },
        });
    }
    catch (error) {
        utils_1.logger.error('Error fetching employee tasks:', error);
        res.status(500).json({
            error: 'خطأ في جلب المهام',
            details: error instanceof Error ? error.message : 'Unknown error',
        });
    }
});
// لوحة موظف: مهام نشطة / متأخرة / مكتملة سابقاً
router.get('/my-tasks/dashboard', (0, authentication_1.authMiddleware)(['employee']), async (req, res) => {
    try {
        const userId = req.user.id;
        const employee = await employees_1.EmployeeService.getEmployeeByUserId(userId);
        if (!employee) {
            return res.status(404).json({
                error: 'الموظف غير موجود',
                message: 'يجب إنشاء employee record أولاً',
            });
        }
        const dashboard = await tasks_1.TaskService.getEmployeeDashboard(employee.id, userId);
        res.json(dashboard);
    }
    catch (error) {
        utils_1.logger.error('Error fetching employee task dashboard:', error);
        res.status(500).json({
            error: 'خطأ في جلب لوحة المهام',
            details: error instanceof Error ? error.message : 'Unknown error',
        });
    }
});
// سجل مهام الموظف (History) مع مدة التنفيذ وما إذا وُقعت أم لا
router.get('/my-tasks/history', (0, authentication_1.authMiddleware)(['employee']), async (req, res) => {
    try {
        const userId = req.user.id;
        const employee = await employees_1.EmployeeService.getEmployeeByUserId(userId);
        if (!employee) {
            return res.status(404).json({
                error: 'الموظف غير موجود',
                message: 'يجب إنشاء employee record أولاً',
            });
        }
        const history = await tasks_1.TaskService.getEmployeeTaskHistory(employee.id);
        res.json({ history, total: history.length });
    }
    catch (error) {
        utils_1.logger.error('Error fetching employee task history:', error);
        res.status(500).json({
            error: 'خطأ في جلب سجل المهام',
            details: error instanceof Error ? error.message : 'Unknown error',
        });
    }
});
// إحصائيات المهام للموظف الحالي
router.get('/stats/my-stats', (0, authentication_1.authMiddleware)(['admin', 'employee']), async (req, res) => {
    try {
        const userId = req.user.id;
        // جلب بيانات الموظف
        const employee = await employees_1.EmployeeService.getEmployeeByUserId(userId);
        // إذا لم يكن لديه employee record، نرجع خطأ
        if (!employee) {
            return res.status(404).json({
                error: 'الموظف غير موجود',
                message: 'يجب إنشاء employee record أولاً للوصول إلى إحصائياتك',
            });
        }
        // إحصائيات الموظف الحالي فقط
        const stats = await tasks_1.TaskService.getTaskStats(employee.id);
        res.json({
            stats,
            employee: {
                id: employee.id,
                name: employee.name,
                email: employee.email,
                permissions: parseEmployeePermissions(employee.permissions),
            },
            message: 'إحصائيات الموظف الحالي',
        });
    }
    catch (error) {
        utils_1.logger.error('Error fetching task stats:', error);
        res.status(500).json({
            error: 'خطأ في جلب الإحصائيات',
            details: error instanceof Error ? error.message : 'Unknown error',
        });
    }
});
// إحصائيات جميع المهام (للادمن)
router.get('/stats/overview', (0, authentication_1.authMiddleware)(['admin']), async (req, res) => {
    try {
        // إحصائيات عامة لجميع المهام
        const stats = await tasks_1.TaskService.getTaskStats();
        res.json({
            stats,
            message: 'إحصائيات جميع المهام (عرض المدير)',
        });
    }
    catch (error) {
        utils_1.logger.error('Error fetching task stats:', error);
        res.status(500).json({
            error: 'خطأ في جلب الإحصائيات',
            details: error instanceof Error ? error.message : 'Unknown error',
        });
    }
});
// أداء كل موظف (للادمن)
router.get('/stats/by-employee', (0, authentication_1.authMiddleware)(['admin']), async (_req, res) => {
    try {
        const rows = await tasks_1.TaskService.getStatsByEmployee();
        res.json({ employees: rows, message: 'أداء الموظفين حسب المهام' });
    }
    catch (error) {
        utils_1.logger.error('Error fetching task stats by employee:', error);
        res.status(500).json({
            error: 'خطأ في جلب إحصائيات الموظفين',
            details: error instanceof Error ? error.message : 'Unknown error',
        });
    }
});
// إنشاء employee record للمستخدم الحالي
router.post('/create-employee-record', (0, authentication_1.authMiddleware)(['admin']), async (req, res) => {
    try {
        const userId = req.user.id;
        // التحقق من وجود employee record بالفعل
        const existingEmployee = await employees_1.EmployeeService.getEmployeeByUserId(userId);
        if (existingEmployee) {
            return res.status(400).json({
                error: 'الموظف موجود بالفعل',
                message: 'لديك employee record بالفعل',
            });
        }
        // جلب بيانات المستخدم
        const userResult = await pool_1.default.query('SELECT id, name, email FROM users WHERE id = $1', [
            userId,
        ]);
        if (userResult.rowCount === 0) {
            return res.status(404).json({ error: 'المستخدم غير موجود' });
        }
        const user = userResult.rows[0];
        // تحديث role المستخدم إلى employee
        await pool_1.default.query('UPDATE users SET role = $1 WHERE id = $2', ['employee', userId]);
        // إنشاء employee record
        const employeeResult = await pool_1.default.query(`INSERT INTO employees (user_id, name, email, permissions, created_by)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`, [
            userId,
            user.name,
            user.email,
            JSON.stringify([
                'can_add_teachers',
                'can_edit_teachers',
                'can_delete_teachers',
                'can_manage_students',
                'can_manage_courses',
                'can_manage_accounting',
                'can_manage_study_groups',
                'can_view_reports',
                'can_manage_employees',
                'can_manage_tasks',
            ]),
            userId, // created_by = نفس المستخدم
        ]);
        res.status(201).json({
            message: 'تم إنشاء employee record بنجاح',
            employee: employeeResult.rows[0],
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
// إنشاء موظف جديد مباشرة
router.post('/register-employee', (0, authentication_1.authMiddleware)(['admin']), async (req, res) => {
    try {
        const { name, email, phone, password, permissions } = req.body;
        const createdBy = req.user.id;
        const tenantId = req.tenant.id;
        if (!name || !email || !password) {
            return res.status(400).json({
                error: 'الاسم والبريد الإلكتروني وكلمة المرور مطلوبة',
            });
        }
        // التحقق من عدم وجود المستخدم
        const existingUser = await pool_1.default.query(`SELECT id FROM users WHERE tenant_id = $3
         AND (email = $1 OR ($2::text IS NOT NULL AND length(trim($2::text)) > 0 AND phone = $2))`, [email, phone ?? null, tenantId]);
        if (existingUser.rowCount && existingUser.rowCount > 0) {
            return res.status(400).json({
                error: 'المستخدم موجود بالفعل',
                message: 'البريد الإلكتروني أو رقم الهاتف مستخدم بالفعل',
            });
        }
        // إنشاء المستخدم مع role employee
        const bcrypt = require('bcrypt');
        const hashedPassword = await bcrypt.hash(password, 10);
        const userResult = await pool_1.default.query(`INSERT INTO users (name, email, phone, password, role, tenant_id)
         VALUES ($1, $2, $3, $4, 'employee', $5)
         RETURNING id, name, email, phone, role`, [name, email, phone, hashedPassword, tenantId]);
        const user = userResult.rows[0];
        // إنشاء employee record
        const employeeResult = await pool_1.default.query(`INSERT INTO employees (user_id, name, email, phone, permissions, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`, [
            user.id,
            user.name,
            user.email,
            user.phone,
            JSON.stringify(permissions || ['can_manage_tasks', 'can_view_reports']),
            createdBy,
        ]);
        res.status(201).json({
            message: 'تم إنشاء الموظف بنجاح',
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                phone: user.phone,
                role: user.role,
            },
            employee: {
                ...employeeResult.rows[0],
                permissions: parseEmployeePermissions(employeeResult.rows[0].permissions),
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
// جلب مهمة واحدة (الأدمن أي مهمة — الموظف مهامه فقط)
router.get('/:id', (0, authentication_1.authMiddleware)(['admin', 'employee']), async (req, res) => {
    try {
        const { id } = req.params;
        const taskId = parseInt(id, 10);
        const user = req.user;
        const task = await tasks_1.TaskService.getTaskById(taskId);
        if (!task) {
            return res.status(404).json({ error: 'المهمة غير موجودة' });
        }
        try {
            await tasks_1.TaskService.assertUserCanViewTask(taskId, user.id, user.role);
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : '';
            if (msg.includes('غير موجودة')) {
                return res.status(404).json({ error: 'المهمة غير موجودة' });
            }
            return res.status(403).json({ error: msg || 'غير مصرح' });
        }
        res.json({ task });
    }
    catch (error) {
        utils_1.logger.error('Error fetching task:', error);
        res.status(500).json({
            error: 'خطأ في جلب المهمة',
            details: error instanceof Error ? error.message : 'Unknown error',
        });
    }
});
// تحديث مهمة
router.put('/:id', (0, authentication_1.authMiddleware)(['admin']), async (req, res) => {
    try {
        const { id } = req.params;
        const body = req.body;
        const updateData = {
            ...body,
            deadline: body.deadline ?? body.due_date,
        };
        delete updateData.due_date;
        const task = await tasks_1.TaskService.updateTask(parseInt(id, 10), updateData);
        res.json({
            message: 'تم تحديث المهمة بنجاح',
            task,
        });
    }
    catch (error) {
        utils_1.logger.error('Error updating task:', error);
        res.status(500).json({
            error: 'خطأ في تحديث المهمة',
            details: error instanceof Error ? error.message : 'Unknown error',
        });
    }
});
// بداية التنفيذ (الموظف المكلف فقط)
router.patch('/:id/start', (0, authentication_1.authMiddleware)(['employee']), async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;
        const task = await tasks_1.TaskService.startTask(parseInt(id, 10), userId);
        res.json({ message: 'تم البدء في تنفيذ المهمة', task });
    }
    catch (error) {
        utils_1.logger.error('Error starting task:', error);
        const msg = error instanceof Error ? error.message : 'Unknown error';
        const code = msg.includes('غير مسموح') || msg.includes('غير مصرح') ? 403 : 400;
        res.status(code).json({ error: msg });
    }
});
// إكمال مهمة — بانتظار مراجعة الأدمن (الموظف المكلف فقط)
router.patch('/:id/complete', (0, authentication_1.authMiddleware)(['employee']), async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;
        const message = typeof req.body?.message === 'string' ? req.body.message : null;
        const task = await tasks_1.TaskService.completeTask(parseInt(id, 10), userId, message);
        res.json({ message: 'تم إكمال المهمة مؤقتاً في انتظار المراجعة', task });
    }
    catch (error) {
        utils_1.logger.error('Error completing task:', error);
        const msg = error instanceof Error ? error.message : 'Unknown error';
        const code = msg.includes('غير مسموح') || msg.includes('غير مصرح') ? 403 : 400;
        res.status(code).json({ error: msg });
    }
});
// اعتماد المهمة (للأدمن)
router.patch('/:id/approve', (0, authentication_1.authMiddleware)(['admin']), async (req, res) => {
    try {
        const { id } = req.params;
        const { admin_notes } = req.body;
        const userId = req.user.id;
        const task = await tasks_1.TaskService.approveTask(parseInt(id, 10), userId, admin_notes);
        res.json({ message: 'تم اعتماد المهمة بنجاح', task });
    }
    catch (error) {
        utils_1.logger.error('Error approving task:', error);
        res.status(500).json({ error: 'خطأ', details: error instanceof Error ? error.message : 'Unknown error' });
    }
});
// رفض المهمة (للأدمن)
router.patch('/:id/reject', (0, authentication_1.authMiddleware)(['admin']), async (req, res) => {
    try {
        const { id } = req.params;
        const { admin_notes } = req.body;
        const userId = req.user.id;
        if (!admin_notes)
            return res.status(400).json({ error: 'برجاء كتابة سبب الرفض' });
        const task = await tasks_1.TaskService.rejectTask(parseInt(id, 10), userId, admin_notes);
        res.json({ message: 'تم رفض المهمة وإرجاعها للموظف', task });
    }
    catch (error) {
        utils_1.logger.error('Error rejecting task:', error);
        res.status(500).json({ error: 'خطأ', details: error instanceof Error ? error.message : 'Unknown error' });
    }
});
// جلب Logs المهمة
router.get('/:id/logs', (0, authentication_1.authMiddleware)(['admin', 'employee']), async (req, res) => {
    try {
        const { id } = req.params;
        const taskId = parseInt(id, 10);
        const user = req.user;
        try {
            await tasks_1.TaskService.assertUserCanViewTask(taskId, user.id, user.role);
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : '';
            const code = msg.includes('غير موجودة') ? 404 : 403;
            return res.status(code).json({ error: msg || 'غير مصرح' });
        }
        const logs = await tasks_1.TaskService.getTaskLogs(taskId);
        res.json({ logs });
    }
    catch (error) {
        utils_1.logger.error('Error fetching task logs:', error);
        res.status(500).json({ error: 'خطأ', details: error instanceof Error ? error.message : 'Unknown error' });
    }
});
// حذف مهمة (للادمن فقط)
router.delete('/:id', (0, authentication_1.authMiddleware)(['admin']), async (req, res) => {
    try {
        const { id } = req.params;
        const task = await tasks_1.TaskService.deleteTask(parseInt(id));
        if (!task) {
            return res.status(404).json({ error: 'المهمة غير موجودة' });
        }
        res.json({
            message: 'تم حذف المهمة بنجاح',
            task,
        });
    }
    catch (error) {
        utils_1.logger.error('Error deleting task:', error);
        res.status(500).json({
            error: 'خطأ في حذف المهمة',
            details: error instanceof Error ? error.message : 'Unknown error',
        });
    }
});
// إضافة تعليق على مهمة (أدمن أو موظف مكلف)
router.post('/:id/comments', (0, authentication_1.authMiddleware)(['admin', 'employee']), async (req, res) => {
    try {
        const { id } = req.params;
        const { comment } = req.body;
        const user = req.user;
        const taskId = parseInt(id, 10);
        try {
            await tasks_1.TaskService.assertUserCanViewTask(taskId, user.id, user.role);
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : '';
            const code = msg.includes('غير موجودة') ? 404 : 403;
            return res.status(code).json({ error: msg || 'غير مصرح' });
        }
        if (!comment || typeof comment !== 'string' || !comment.trim()) {
            return res.status(400).json({ error: 'التعليق مطلوب' });
        }
        let employeeId = null;
        if (user.role === 'employee') {
            const employee = await employees_1.EmployeeService.getEmployeeByUserId(user.id);
            employeeId = employee ? employee.id : null;
        }
        const taskComment = await tasks_1.TaskService.addTaskComment(taskId, user.id, employeeId, comment.trim());
        res.status(201).json({
            message: 'تم إضافة التعليق بنجاح',
            comment: taskComment,
        });
    }
    catch (error) {
        utils_1.logger.error('Error adding task comment:', error);
        res.status(500).json({
            error: 'خطأ في إضافة التعليق',
            details: error instanceof Error ? error.message : 'Unknown error',
        });
    }
});
// جلب تعليقات مهمة
router.get('/:id/comments', (0, authentication_1.authMiddleware)(['admin', 'employee']), async (req, res) => {
    try {
        const { id } = req.params;
        const taskId = parseInt(id, 10);
        const user = req.user;
        try {
            await tasks_1.TaskService.assertUserCanViewTask(taskId, user.id, user.role);
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : '';
            const code = msg.includes('غير موجودة') ? 404 : 403;
            return res.status(code).json({ error: msg || 'غير مصرح' });
        }
        const comments = await tasks_1.TaskService.getTaskComments(taskId);
        res.json({ comments });
    }
    catch (error) {
        utils_1.logger.error('Error fetching task comments:', error);
        res.status(500).json({
            error: 'خطأ في جلب التعليقات',
            details: error instanceof Error ? error.message : 'Unknown error',
        });
    }
});
// رفع ملف لمهمة (أدمن أو موظف مكلف)
router.post('/:id/attachments', (0, authentication_1.authMiddleware)(['admin', 'employee']), upload.single('file'), async (req, res) => {
    try {
        const { id } = req.params;
        const file = req.file;
        const user = req.user;
        const taskId = parseInt(id, 10);
        try {
            await tasks_1.TaskService.assertUserCanViewTask(taskId, user.id, user.role);
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : '';
            const code = msg.includes('غير موجودة') ? 404 : 403;
            return res.status(code).json({ error: msg || 'غير مصرح' });
        }
        if (!file) {
            return res.status(400).json({ error: 'لم يتم رفع أي ملف' });
        }
        let employeeId = null;
        if (user.role === 'employee') {
            const employee = await employees_1.EmployeeService.getEmployeeByUserId(user.id);
            employeeId = employee ? employee.id : null;
        }
        const filePath = `/uploads/${file.filename}`;
        const attachment = await tasks_1.TaskService.addTaskAttachment(taskId, file.originalname, filePath, file.size, user.id, employeeId);
        res.status(201).json({
            message: 'تم رفع الملف بنجاح',
            attachment,
        });
    }
    catch (error) {
        utils_1.logger.error('Error uploading task attachment:', error);
        res.status(500).json({
            error: 'خطأ في رفع الملف',
            details: error instanceof Error ? error.message : 'Unknown error',
        });
    }
});
// جلب ملفات مهمة
router.get('/:id/attachments', (0, authentication_1.authMiddleware)(['admin', 'employee']), async (req, res) => {
    try {
        const { id } = req.params;
        const taskId = parseInt(id, 10);
        const user = req.user;
        try {
            await tasks_1.TaskService.assertUserCanViewTask(taskId, user.id, user.role);
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : '';
            const code = msg.includes('غير موجودة') ? 404 : 403;
            return res.status(code).json({ error: msg || 'غير مصرح' });
        }
        const attachments = await tasks_1.TaskService.getTaskAttachments(taskId);
        res.json({ attachments });
    }
    catch (error) {
        utils_1.logger.error('Error fetching task attachments:', error);
        res.status(500).json({
            error: 'خطأ في جلب الملفات',
            details: error instanceof Error ? error.message : 'Unknown error',
        });
    }
});
