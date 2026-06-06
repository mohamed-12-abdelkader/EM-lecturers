"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskService = void 0;
const pool_1 = __importDefault(require("../db/pool"));
const notifications_1 = require("./notifications");
const utils_1 = require("../utils");
class TaskService {
    static async notifySafe(fn, context) {
        try {
            const r = await fn();
            if (!r.success) {
                console.warn(`[tasks] notification skipped (${context})`);
            }
        }
        catch (e) {
            console.warn(`[tasks] notification error (${context}):`, e);
        }
    }
    /** تحديث حالة overdue للمهام المتأخرة (لا تغيّر المهام المعتمدة / الملغاة) */
    static async applyOverdueRules() {
        await pool_1.default.query(`UPDATE tasks
       SET status = 'overdue', updated_at = NOW()
       WHERE due_date IS NOT NULL
         AND due_date::date < CURRENT_DATE
         AND status IN ('pending', 'in_progress', 'rejected')`);
    }
    /**
     * تذكير قبل يوم من الموعد مرة واحدة + إشعار
     */
    static async runDeadlineReminders() {
        const dueRes = await pool_1.default.query(`SELECT t.id, t.title, t.due_date, e.user_id AS assignee_user_id
       FROM tasks t
       JOIN employees e ON e.id = t.assigned_to
       WHERE t.due_date IS NOT NULL
         AND t.due_date::date = (CURRENT_DATE + INTERVAL '1 day')::date
         AND t.status NOT IN ('approved', 'cancelled')
         AND t.deadline_reminder_sent_at IS NULL`);
        for (const row of dueRes.rows) {
            await TaskService.notifySafe(() => notifications_1.NotificationService.notifyUserAboutTask(row.assignee_user_id, row.id, 'اقتراب موعد تسليم مهمة', `تذكير: مهمة "${row.title}" موعد تسليمها غداً (${row.due_date}).`, 'task_deadline_reminder'), `deadline_reminder:${row.id}`);
            await pool_1.default.query(`UPDATE tasks SET deadline_reminder_sent_at = NOW() WHERE id = $1`, [row.id]);
        }
    }
    static async logTaskAction(taskId, userId, action, note, db) {
        const q = `INSERT INTO task_logs (task_id, user_id, action, note) VALUES ($1, $2, $3, $4)`;
        const params = [taskId, userId, action, note ?? null];
        if (db) {
            await db.query(q, params);
        }
        else {
            await pool_1.default.query(q, params);
        }
    }
    static async createTask(taskData, assignedByUserId) {
        const client = await pool_1.default.connect();
        try {
            await client.query('BEGIN');
            const due = taskData.deadline ?? null;
            const result = await client.query(`INSERT INTO tasks (title, description, priority, start_date, due_date, assigned_to, assigned_by, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
         RETURNING *`, [
                taskData.title,
                taskData.description ?? null,
                taskData.priority,
                taskData.start_date || null,
                due,
                taskData.assigned_to,
                assignedByUserId,
            ]);
            const task = result.rows[0];
            const empRes = await client.query(`SELECT user_id FROM employees WHERE id = $1`, [taskData.assigned_to]);
            const assigneeUserId = empRes.rows[0]?.user_id;
            await client.query('COMMIT');
            // بعد COMMIT: task_logs يشير إلى tasks — الإدراج قبل COMMIT من pool كان يخالف FK (اتصال لا يرى الصف المؤقت)
            try {
                await TaskService.logTaskAction(task.id, assignedByUserId, 'created', 'Task created');
            }
            catch (logErr) {
                utils_1.logger.warn({ err: logErr, taskId: task.id }, 'task_logs insert failed after task create');
            }
            if (assigneeUserId) {
                await TaskService.notifySafe(() => notifications_1.NotificationService.notifyUserAboutTask(assigneeUserId, task.id, 'مهمة جديدة', `تم تعيين مهمة لك: "${task.title}"`, 'task_assigned'), `assigned:${task.id}`);
            }
            return TaskService.mapTaskRow(task);
        }
        catch (error) {
            await client.query('ROLLBACK');
            throw error;
        }
        finally {
            client.release();
        }
    }
    /** صف مهمة مع user_id للموظف المكلف */
    static async getTaskAccessRow(taskId) {
        const result = await pool_1.default.query(`SELECT t.*, e.user_id AS assignee_user_id
       FROM tasks t
       JOIN employees e ON t.assigned_to = e.id
       WHERE t.id = $1`, [taskId]);
        return result.rows[0];
    }
    static async getTaskById(taskId) {
        const result = await pool_1.default.query(`SELECT 
         t.*,
         e.name as employee_name,
         e.email as employee_email,
         e.user_id as assignee_user_id,
         u.name as assigned_by_name,
         ce.name as completed_by_name
       FROM tasks t
       LEFT JOIN employees e ON t.assigned_to = e.id
       LEFT JOIN users u ON t.assigned_by = u.id
       LEFT JOIN employees ce ON t.completed_by = ce.id
       WHERE t.id = $1`, [taskId]);
        const row = result.rows[0];
        return row ? TaskService.mapTaskRow(row) : null;
    }
    /** موظف يملك المهمة؟ */
    static async assertEmployeeOwnsTask(taskId, userId) {
        const row = await TaskService.getTaskAccessRow(taskId);
        if (!row) {
            throw new Error('المهمة غير موجودة');
        }
        if (row.assignee_user_id !== userId) {
            throw new Error('غير مسموح لك بتعديل هذه المهمة');
        }
    }
    static buildTaskListQuery(filters, employeeId) {
        let query = `
      SELECT 
        t.*,
        e.name as employee_name,
        e.email as employee_email,
        e.user_id as assignee_user_id,
        u.name as assigned_by_name,
        COUNT(DISTINCT tc.id)::int as comments_count,
        COUNT(DISTINCT ta.id)::int as attachments_count
      FROM tasks t
      LEFT JOIN employees e ON t.assigned_to = e.id
      LEFT JOIN users u ON t.assigned_by = u.id
      LEFT JOIN task_comments tc ON t.id = tc.task_id
      LEFT JOIN task_attachments ta ON t.id = ta.task_id
    `;
        const whereConditions = [];
        const values = [];
        let counter = 1;
        if (employeeId != null) {
            whereConditions.push(`t.assigned_to = $${counter++}`);
            values.push(employeeId);
        }
        if (filters?.status) {
            whereConditions.push(`t.status = $${counter++}`);
            values.push(filters.status);
        }
        if (filters?.priority) {
            whereConditions.push(`t.priority = $${counter++}`);
            values.push(filters.priority);
        }
        if (filters?.assigned_to) {
            whereConditions.push(`t.assigned_to = $${counter++}`);
            values.push(filters.assigned_to);
        }
        if (filters?.deadline_from) {
            whereConditions.push(`t.due_date >= $${counter++}`);
            values.push(filters.deadline_from);
        }
        if (filters?.deadline_to) {
            whereConditions.push(`t.due_date <= $${counter++}`);
            values.push(filters.deadline_to);
        }
        if (filters?.created_from) {
            whereConditions.push(`t.created_at >= $${counter++}`);
            values.push(filters.created_from);
        }
        if (filters?.created_to) {
            whereConditions.push(`t.created_at <= $${counter++}`);
            values.push(filters.created_to);
        }
        if (whereConditions.length > 0) {
            query += ` WHERE ${whereConditions.join(' AND ')}`;
        }
        query += ` GROUP BY t.id, e.name, e.email, e.user_id, u.name`;
        query += ` ORDER BY t.created_at DESC`;
        if (filters?.limit) {
            query += ` LIMIT $${counter++}`;
            values.push(filters.limit);
        }
        if (filters?.skip) {
            query += ` OFFSET $${counter++}`;
            values.push(filters.skip);
        }
        return { query, values };
    }
    static async getAllTasks(filters) {
        await TaskService.applyOverdueRules();
        const { query, values } = TaskService.buildTaskListQuery(filters);
        const result = await pool_1.default.query(query, values);
        return result.rows.map((r) => TaskService.mapTaskRow(r));
    }
    static async getEmployeeTasks(employeeId, filters) {
        await TaskService.applyOverdueRules();
        const { query, values } = TaskService.buildTaskListQuery(filters, employeeId);
        const result = await pool_1.default.query(query, values);
        return result.rows.map((r) => TaskService.mapTaskRow(r));
    }
    /** لوحة موظف: نشطة / متأخرة / مكتملة سابقاً */
    static async getEmployeeDashboard(employeeId, assigneeUserId) {
        await TaskService.applyOverdueRules();
        const all = await TaskService.getEmployeeTasks(employeeId);
        const active = all.filter((t) => 
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        ['pending', 'in_progress', 'rejected', 'overdue', 'completed_by_employee'].includes(t.status));
        const overdue = active.filter((t) => {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            if (!t.deadline)
                return t.status === 'overdue';
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            const d = new Date(t.deadline);
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            return d < today && t.status !== 'approved';
        });
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        const completed_history = all.filter((t) => t.status === 'approved');
        return {
            employee_user_id: assigneeUserId,
            active,
            overdue,
            completed_history,
            counts: {
                active: active.length,
                overdue: overdue.length,
                completed: completed_history.length,
                total: all.length,
            },
        };
    }
    /** سجل أداء الموظف عبر المهام (للفترة الطويلة) */
    static async getEmployeeTaskHistory(employeeId) {
        await TaskService.applyOverdueRules();
        const result = await pool_1.default.query(`SELECT 
         t.id,
         t.title,
         t.status,
         t.priority,
         t.created_at,
         t.start_date,
         t.due_date AS deadline,
         t.completed_at,
         t.approved_at,
         t.admin_notes,
         CASE 
           WHEN t.completed_at IS NOT NULL AND t.created_at IS NOT NULL 
           THEN EXTRACT(EPOCH FROM (t.completed_at - t.created_at)) / 3600
           ELSE NULL
         END AS duration_hours_until_submit,
         CASE WHEN t.status = 'approved' THEN true ELSE false END AS was_approved
       FROM tasks t
       WHERE t.assigned_to = $1
       ORDER BY t.created_at DESC`, [employeeId]);
        return result.rows;
    }
    /** إحصائيات الأدمن: أداء كل موظف */
    static async getStatsByEmployee() {
        await TaskService.applyOverdueRules();
        const result = await pool_1.default.query(`SELECT 
         e.id AS employee_id,
         e.name AS employee_name,
         e.email AS employee_email,
         COUNT(t.id)::int AS total_tasks,
         COUNT(*) FILTER (WHERE t.status = 'approved')::int AS approved_tasks,
         COUNT(*) FILTER (WHERE t.status = 'rejected')::int AS rejected_tasks,
         COUNT(*) FILTER (WHERE t.status = 'completed_by_employee')::int AS awaiting_review,
         COUNT(*) FILTER (WHERE t.status IN ('pending','in_progress','overdue'))::int AS in_flight
       FROM employees e
       LEFT JOIN tasks t ON t.assigned_to = e.id
       WHERE e.is_active = true
       GROUP BY e.id, e.name, e.email
       ORDER BY e.name`);
        return result.rows;
    }
    static mapTaskRow(row) {
        const { due_date, employee_notes, ...rest } = row;
        return {
            ...rest,
            employee_notes: employee_notes ?? null,
            employee_message: employee_notes ?? null,
            deadline: due_date,
        };
    }
    static async updateTask(taskId, updateData) {
        const mapped = { ...updateData };
        let resetDeadlineReminder = false;
        if (updateData.deadline !== undefined) {
            mapped.due_date = updateData.deadline;
            delete mapped.deadline;
            resetDeadlineReminder = true;
        }
        const updates = [];
        const values = [];
        let counter = 1;
        for (const [key, value] of Object.entries(mapped)) {
            if (value !== undefined && key !== 'deadline') {
                updates.push(`${key} = $${counter++}`);
                values.push(value);
            }
        }
        if (resetDeadlineReminder) {
            updates.push(`deadline_reminder_sent_at = NULL`);
        }
        if (updates.length === 0) {
            throw new Error('لا توجد بيانات للتحديث');
        }
        updates.push(`updated_at = NOW()`);
        values.push(taskId);
        const idPlaceholder = values.length;
        const result = await pool_1.default.query(`UPDATE tasks 
       SET ${updates.join(', ')} 
       WHERE id = $${idPlaceholder}
       RETURNING *`, values);
        return TaskService.mapTaskRow(result.rows[0]);
    }
    static async startTask(taskId, userId) {
        await TaskService.assertEmployeeOwnsTask(taskId, userId);
        const row = await TaskService.getTaskAccessRow(taskId);
        if (!['pending', 'rejected', 'overdue'].includes(row.status)) {
            throw new Error('لا يمكن بدء المهمة في حالتها الحالية');
        }
        const result = await pool_1.default.query(`UPDATE tasks 
       SET status = 'in_progress', updated_at = NOW()
       WHERE id = $1
       RETURNING *`, [taskId]);
        await TaskService.logTaskAction(taskId, userId, 'started', 'Task started');
        return TaskService.mapTaskRow(result.rows[0]);
    }
    static async completeTask(taskId, userId, employeeMessage) {
        await TaskService.assertEmployeeOwnsTask(taskId, userId);
        const row = await TaskService.getTaskAccessRow(taskId);
        const normalizedMessage = typeof employeeMessage === 'string' && employeeMessage.trim().length > 0
            ? employeeMessage.trim()
            : null;
        if (row.status === 'completed_by_employee') {
            if (!normalizedMessage) {
                return TaskService.mapTaskRow(row);
            }
            const updateExisting = await pool_1.default.query(`UPDATE tasks
         SET employee_notes = $1, updated_at = NOW()
         WHERE id = $2
         RETURNING *`, [normalizedMessage, taskId]);
            await TaskService.logTaskAction(taskId, userId, 'completed', 'Employee updated completion message');
            return TaskService.mapTaskRow(updateExisting.rows[0]);
        }
        if (['approved', 'cancelled'].includes(row.status)) {
            throw new Error('لا يمكن إتمام المهمة في حالتها الحالية');
        }
        if (!['in_progress', 'pending', 'rejected', 'overdue'].includes(row.status)) {
            throw new Error('لا يمكن إتمام المهمة في حالتها الحالية');
        }
        const result = await pool_1.default.query(`UPDATE tasks 
       SET status = 'completed_by_employee',
           completed_at = NOW(),
           completed_by = $1,
           employee_notes = $2,
           updated_at = NOW()
       WHERE id = $3
       RETURNING *`, [row.assigned_to, normalizedMessage, taskId]);
        if (['pending', 'rejected', 'overdue'].includes(row.status)) {
            await TaskService.logTaskAction(taskId, userId, 'started', 'Auto-started before completion');
        }
        await TaskService.logTaskAction(taskId, userId, 'completed', normalizedMessage ? `Awaiting admin review | Employee message: ${normalizedMessage}` : 'Awaiting admin review');
        return TaskService.mapTaskRow(result.rows[0]);
    }
    static async approveTask(taskId, adminUserId, note) {
        const row = await TaskService.getTaskAccessRow(taskId);
        if (!row) {
            throw new Error('المهمة غير موجودة');
        }
        if (row.status !== 'completed_by_employee') {
            throw new Error('لا يمكن اعتماد مهمة لم يُرسل تنفيذها بعد');
        }
        const result = await pool_1.default.query(`UPDATE tasks 
       SET status = 'approved', approved_at = NOW(), admin_notes = COALESCE($1, admin_notes), updated_at = NOW() 
       WHERE id = $2 
       RETURNING *`, [note ?? null, taskId]);
        await TaskService.logTaskAction(taskId, adminUserId, 'approved', note || 'approved');
        const assigneeUserId = row.assignee_user_id;
        await TaskService.notifySafe(() => notifications_1.NotificationService.notifyUserAboutTask(assigneeUserId, taskId, 'تم اعتماد المهمة', `تم اعتماد المهمة: "${row.title}"`, 'task_approved', note || undefined), `approved:${taskId}`);
        return TaskService.mapTaskRow(result.rows[0]);
    }
    static async rejectTask(taskId, adminUserId, note) {
        const row = await TaskService.getTaskAccessRow(taskId);
        if (!row) {
            throw new Error('المهمة غير موجودة');
        }
        if (row.status !== 'completed_by_employee') {
            throw new Error('لا يمكن رفض مهمة ليست بانتظار المراجعة');
        }
        const result = await pool_1.default.query(`UPDATE tasks 
       SET status = 'rejected', 
           admin_notes = $1, 
           completed_at = NULL, 
           completed_by = NULL,
           updated_at = NOW() 
       WHERE id = $2 
       RETURNING *`, [note, taskId]);
        await TaskService.logTaskAction(taskId, adminUserId, 'rejected', note);
        const assigneeUserId = row.assignee_user_id;
        await TaskService.notifySafe(() => notifications_1.NotificationService.notifyUserAboutTask(assigneeUserId, taskId, 'تم رفض المهمة', `يرجى إعادة تنفيذ المهمة: "${row.title}". ملاحظات المدير: ${note}`, 'task_rejected', note), `rejected:${taskId}`);
        return TaskService.mapTaskRow(result.rows[0]);
    }
    static async deleteTask(taskId) {
        const result = await pool_1.default.query('DELETE FROM tasks WHERE id = $1 RETURNING *', [taskId]);
        return result.rows[0] ? TaskService.mapTaskRow(result.rows[0]) : null;
    }
    static async addTaskComment(taskId, authorUserId, employeeId, comment) {
        const result = await pool_1.default.query(`INSERT INTO task_comments (task_id, employee_id, author_user_id, comment)
       VALUES ($1, $2, $3, $4)
       RETURNING *`, [taskId, employeeId, authorUserId, comment]);
        return result.rows[0];
    }
    static async getTaskComments(taskId) {
        const result = await pool_1.default.query(`SELECT 
         tc.*,
         u.name AS author_name,
         u.role AS author_role,
         e.name AS employee_name
       FROM task_comments tc
       LEFT JOIN users u ON tc.author_user_id = u.id
       LEFT JOIN employees e ON tc.employee_id = e.id
       WHERE tc.task_id = $1
       ORDER BY tc.created_at ASC`, [taskId]);
        return result.rows;
    }
    static async addTaskAttachment(taskId, fileName, filePath, fileSize, uploaderUserId, employeeId) {
        const result = await pool_1.default.query(`INSERT INTO task_attachments (task_id, file_name, file_path, file_size, uploaded_by, uploaded_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`, [taskId, fileName, filePath, fileSize, employeeId, uploaderUserId]);
        return result.rows[0];
    }
    static async getTaskAttachments(taskId) {
        const result = await pool_1.default.query(`SELECT 
         ta.*,
         e.name AS uploaded_by_employee_name,
         u.name AS uploaded_by_user_name
       FROM task_attachments ta
       LEFT JOIN employees e ON ta.uploaded_by = e.id
       LEFT JOIN users u ON ta.uploaded_by_user_id = u.id
       WHERE ta.task_id = $1
       ORDER BY ta.created_at ASC`, [taskId]);
        return result.rows;
    }
    static async getTaskLogs(taskId) {
        const result = await pool_1.default.query(`SELECT 
         tl.*,
         u.name AS user_name,
         u.role AS user_role
       FROM task_logs tl
       JOIN users u ON tl.user_id = u.id
       WHERE tl.task_id = $1
       ORDER BY tl.created_at DESC`, [taskId]);
        return result.rows;
    }
    static async getTaskStats(employeeId) {
        let whereClause = '';
        const values = [];
        if (employeeId != null) {
            whereClause = 'WHERE assigned_to = $1';
            values.push(employeeId);
        }
        await TaskService.applyOverdueRules();
        const result = await pool_1.default.query(`SELECT 
        COUNT(*)::int AS total_tasks,
        COUNT(*) FILTER (WHERE status = 'pending')::int AS pending_tasks,
        COUNT(*) FILTER (WHERE status = 'in_progress')::int AS in_progress_tasks,
        COUNT(*) FILTER (WHERE status = 'completed_by_employee')::int AS completed_by_employee_tasks,
        COUNT(*) FILTER (WHERE status = 'approved')::int AS approved_tasks,
        COUNT(*) FILTER (WHERE status = 'rejected')::int AS rejected_tasks,
        COUNT(*) FILTER (WHERE status = 'overdue')::int AS overdue_tasks,
        COUNT(*) FILTER (
          WHERE due_date IS NOT NULL 
            AND due_date::date < CURRENT_DATE 
            AND status NOT IN ('approved','cancelled')
        )::int AS past_deadline_tasks
      FROM tasks
      ${whereClause}`, values);
        return result.rows[0];
    }
    static async assertUserCanViewTask(taskId, userId, role) {
        if (role === 'admin') {
            return;
        }
        if (role !== 'employee') {
            throw new Error('غير مصرح');
        }
        await TaskService.assertEmployeeOwnsTask(taskId, userId);
    }
}
exports.TaskService = TaskService;
