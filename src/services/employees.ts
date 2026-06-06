import pool from '../db/pool';
import bcrypt from 'bcrypt';

export interface EmployeeData {
  name: string;
  email: string;
  password: string;
  phone?: string;
  permissions: string[];
}

export interface EmployeePermissions {
  can_add_teachers: boolean; // إضافة مدرس جديد
  can_edit_teachers: boolean; // تعديل بيانات المدرسين
  can_delete_teachers: boolean; // حذف المدرسين
  can_manage_students: boolean;
  can_manage_courses: boolean;
  can_manage_accounting: boolean;
  can_manage_study_groups: boolean;
  can_view_reports: boolean;
  can_manage_employees: boolean;
  can_manage_tasks: boolean; // إدارة المهام
}

export class EmployeeService {
  // إنشاء موظف جديد
  static async createEmployee(employeeData: EmployeeData, createdBy: number, tenantId: number) {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // إنشاء حساب المستخدم
      const hashedPassword = await bcrypt.hash(employeeData.password, 10);
      const userResult = await client.query(
        `INSERT INTO users (email, password, name, role, tenant_id)
         VALUES ($1, $2, $3, 'employee', $4)
         RETURNING id, email, name, role`,
        [employeeData.email, hashedPassword, employeeData.name, tenantId],
      );

      const user = userResult.rows[0];

      // إنشاء الموظف
      const employeeResult = await client.query(
        `INSERT INTO employees (user_id, name, email, phone, permissions, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [
          user.id,
          employeeData.name,
          employeeData.email,
          employeeData.phone,
          JSON.stringify(employeeData.permissions),
          createdBy,
        ],
      );

      await client.query('COMMIT');

      return {
        user,
        employee: employeeResult.rows[0],
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // جلب جميع الموظفين
  static async getAllEmployees() {
    const result = await pool.query(
      `SELECT e.*, u.name as user_name, u.email as user_email, u.role as user_role
       FROM employees e
       JOIN users u ON e.user_id = u.id
       WHERE e.is_active = true
       ORDER BY e.created_at DESC`,
    );
    return result.rows;
  }

  // جلب موظف بواسطة ID
  static async getEmployeeById(employeeId: number) {
    const result = await pool.query(
      `SELECT e.*, u.name as user_name, u.email as user_email, u.role as user_role
       FROM employees e
       JOIN users u ON e.user_id = u.id
       WHERE e.id = $1 AND e.is_active = true`,
      [employeeId],
    );
    return result.rows[0];
  }

  // جلب موظف بواسطة user_id
  static async getEmployeeByUserId(userId: number) {
    const result = await pool.query(
      `SELECT e.*, u.name as user_name, u.email as user_email, u.role as user_role
       FROM employees e
       JOIN users u ON e.user_id = u.id
       WHERE e.user_id = $1 AND e.is_active = true`,
      [userId],
    );
    return result.rows[0];
  }

  // تحديث بيانات الموظف
  static async updateEmployee(
    employeeId: number,
    updateData: {
      name?: string;
      phone?: string;
      permissions?: string[];
      is_active?: boolean;
    },
  ) {
    const updates: string[] = [];
    const values: any[] = [];
    let counter = 1;

    if (updateData.name !== undefined) {
      updates.push(`name = $${counter++}`);
      values.push(updateData.name);
    }
    if (updateData.phone !== undefined) {
      updates.push(`phone = $${counter++}`);
      values.push(updateData.phone);
    }
    if (updateData.permissions !== undefined) {
      updates.push(`permissions = $${counter++}`);
      values.push(JSON.stringify(updateData.permissions));
    }
    if (updateData.is_active !== undefined) {
      updates.push(`is_active = $${counter++}`);
      values.push(updateData.is_active);
    }

    if (updates.length === 0) {
      throw new Error('لا توجد بيانات للتحديث');
    }

    updates.push(`updated_at = NOW()`);
    values.push(employeeId);

    const result = await pool.query(
      `UPDATE employees 
       SET ${updates.join(', ')} 
       WHERE id = $${counter++}
       RETURNING *`,
      values,
    );

    return result.rows[0];
  }

  // تحديث صورة الموظف
  static async updateEmployeeAvatar(employeeId: number, avatarPath: string) {
    const result = await pool.query(
      `UPDATE employees 
       SET avatar = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [avatarPath, employeeId],
    );
    return result.rows[0];
  }

  // حذف موظف (تعطيل)
  static async deactivateEmployee(employeeId: number) {
    const result = await pool.query(
      `UPDATE employees 
       SET is_active = false, updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [employeeId],
    );
    return result.rows[0];
  }

  // التحقق من صلاحيات الموظف
  static async checkEmployeePermissions(
    userId: number,
    requiredPermissions: string[],
  ): Promise<boolean> {
    const employee = await this.getEmployeeByUserId(userId);

    if (!employee || !employee.is_active) {
      return false;
    }

    const permissions = employee.permissions || {};

    for (const permission of requiredPermissions) {
      if (!permissions[permission]) {
        return false;
      }
    }

    return true;
  }

  // جلب صلاحيات الموظف
  static async getEmployeePermissions(userId: number) {
    const employee = await this.getEmployeeByUserId(userId);

    if (!employee || !employee.is_active) {
      return null;
    }

    return employee.permissions || {};
  }

  // تحديث كلمة مرور الموظف
  static async updateEmployeePassword(employeeId: number, newPassword: string) {
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    const result = await pool.query(
      `UPDATE users 
       SET password = $1 
       WHERE id = (SELECT user_id FROM employees WHERE id = $2)
       RETURNING id, email, name, role`,
      [hashedPassword, employeeId],
    );

    return result.rows[0];
  }
}
