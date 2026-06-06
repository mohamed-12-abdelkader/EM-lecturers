import pool from '../db/pool';
import { TeacherPermission, CreateTeacherPermission } from '../db/types/questionBank';

export class TeacherPermissionService {
  // Grant permission to teacher
  static async grant(
    questionBankId: number,
    subjectId: number,
    adminId: number,
    data: CreateTeacherPermission,
  ): Promise<TeacherPermission> {
    const { teacher_id } = data;

    // Verify subject exists and belongs to the question bank
    const verifyQuery = `
      SELECT id FROM subjects 
      WHERE id = $1 AND question_bank_id = $2
    `;
    const verifyResult = await pool.query(verifyQuery, [subjectId, questionBankId]);

    if (verifyResult.rows.length === 0) {
      throw new Error('المادة غير موجودة أو لا تنتمي لهذا بنك الأسئلة');
    }

    // Verify teacher exists and is a teacher
    const teacherQuery = `
      SELECT id FROM users 
      WHERE id = $1 AND role = 'teacher'
    `;
    const teacherResult = await pool.query(teacherQuery, [teacher_id]);

    if (teacherResult.rows.length === 0) {
      throw new Error('المدرس غير موجود أو ليس مدرساً');
    }

    // Check if permission already exists
    const existingQuery = `
      SELECT id FROM teacher_permissions 
      WHERE teacher_id = $1 AND subject_id = $2 AND question_bank_id = $3
    `;
    const existingResult = await pool.query(existingQuery, [teacher_id, subjectId, questionBankId]);

    if (existingResult.rows.length > 0) {
      throw new Error('المدرس لديه صلاحية بالفعل لهذه المادة');
    }

    const query = `
      INSERT INTO teacher_permissions (teacher_id, subject_id, question_bank_id, granted_by, granted_at)
      VALUES ($1, $2, $3, $4, NOW())
      RETURNING *
    `;

    const values = [teacher_id, subjectId, questionBankId, adminId];
    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      throw new Error('فشل في منح الصلاحية');
    }

    const permission = result.rows[0];

    return {
      ...permission,
      granted_at: new Date(permission.granted_at),
      created_at: new Date(permission.created_at),
      updated_at: new Date(permission.updated_at),
    };
  }

  // Get permissions for a subject
  static async getBySubject(
    questionBankId: number,
    subjectId: number,
  ): Promise<TeacherPermission[]> {
    const query = `
      SELECT 
        tp.*,
        u.name as teacher_name,
        u.email as teacher_email,
        s.name as subject_name,
        qb.name as question_bank_name,
        admin.name as admin_name
      FROM teacher_permissions tp
      LEFT JOIN users u ON tp.teacher_id = u.id
      LEFT JOIN subjects s ON tp.subject_id = s.id
      LEFT JOIN question_banks qb ON tp.question_bank_id = qb.id
      LEFT JOIN users admin ON tp.granted_by = admin.id
      WHERE tp.subject_id = $1 AND tp.question_bank_id = $2
      ORDER BY tp.created_at DESC
    `;

    const result = await pool.query(query, [subjectId, questionBankId]);

    return result.rows.map((permission: any) => ({
      ...permission,
      granted_at: new Date(permission.granted_at),
      created_at: new Date(permission.created_at),
      updated_at: new Date(permission.updated_at),
    }));
  }

  // Get permission by ID
  static async getById(id: number): Promise<TeacherPermission | null> {
    const query = `
      SELECT 
        tp.*,
        u.name as teacher_name,
        u.email as teacher_email,
        s.name as subject_name,
        qb.name as question_bank_name,
        admin.name as admin_name
      FROM teacher_permissions tp
      LEFT JOIN users u ON tp.teacher_id = u.id
      LEFT JOIN subjects s ON tp.subject_id = s.id
      LEFT JOIN question_banks qb ON tp.question_bank_id = qb.id
      LEFT JOIN users admin ON tp.granted_by = admin.id
      WHERE tp.id = $1
    `;

    const result = await pool.query(query, [id]);

    if (result.rows.length === 0) {
      return null;
    }

    const permission = result.rows[0];

    return {
      ...permission,
      granted_at: new Date(permission.granted_at),
      created_at: new Date(permission.created_at),
      updated_at: new Date(permission.updated_at),
    };
  }

  // Update permission
  static async update(
    permissionId: number,
    data: Partial<CreateTeacherPermission>,
  ): Promise<TeacherPermission> {
    const { teacher_id } = data;

    // Check if permission exists
    const existingPermission = await this.getById(permissionId);
    if (!existingPermission) {
      throw new Error('الصلاحية غير موجودة');
    }

    // Build update query dynamically
    const updateFields = [];
    const values: any[] = [];
    let valueIndex = 1;

    if (teacher_id !== undefined) {
      // Verify teacher exists and is a teacher
      const teacherQuery = `
        SELECT id FROM users 
        WHERE id = $1 AND role = 'teacher'
      `;
      const teacherResult = await pool.query(teacherQuery, [teacher_id]);

      if (teacherResult.rows.length === 0) {
        throw new Error('المدرس غير موجود أو ليس مدرساً');
      }

      updateFields.push(`teacher_id = $${valueIndex}`);
      values.push(teacher_id);
      valueIndex++;
    }

    if (updateFields.length === 0) {
      throw new Error('لا توجد بيانات للتحديث');
    }

    updateFields.push(`updated_at = NOW()`);
    values.push(permissionId);

    const query = `
      UPDATE teacher_permissions 
      SET ${updateFields.join(', ')}
      WHERE id = $${valueIndex}
      RETURNING *
    `;

    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      throw new Error('فشل في تحديث الصلاحية');
    }

    const permission = result.rows[0];

    return {
      ...permission,
      granted_at: new Date(permission.granted_at),
      created_at: new Date(permission.created_at),
      updated_at: new Date(permission.updated_at),
    };
  }

  // Revoke permission
  static async revoke(permissionId: number): Promise<void> {
    // Check if permission exists
    const existingPermission = await this.getById(permissionId);
    if (!existingPermission) {
      throw new Error('الصلاحية غير موجودة');
    }

    const query = `
      UPDATE teacher_permissions 
      SET is_active = false, updated_at = NOW()
      WHERE id = $1
    `;

    const result = await pool.query(query, [permissionId]);

    if (result.rowCount === 0) {
      throw new Error('فشل في إلغاء الصلاحية');
    }
  }

  // Delete permission permanently
  static async delete(permissionId: number): Promise<void> {
    // Check if permission exists
    const existingPermission = await this.getById(permissionId);
    if (!existingPermission) {
      throw new Error('الصلاحية غير موجودة');
    }

    const query = `DELETE FROM teacher_permissions WHERE id = $1`;
    const result = await pool.query(query, [permissionId]);

    if (result.rowCount === 0) {
      throw new Error('فشل في حذف الصلاحية');
    }
  }

  // Get all permissions for a teacher
  static async getByTeacher(teacherId: number): Promise<TeacherPermission[]> {
    const query = `
      SELECT 
        tp.*,
        s.name as subject_name,
        qb.name as question_bank_name,
        admin.name as admin_name
      FROM teacher_permissions tp
      LEFT JOIN subjects s ON tp.subject_id = s.id
      LEFT JOIN question_banks qb ON tp.question_bank_id = qb.id
      LEFT JOIN users admin ON tp.granted_by = admin.id
      WHERE tp.teacher_id = $1 AND tp.is_active = true
      ORDER BY tp.created_at DESC
    `;

    const result = await pool.query(query, [teacherId]);

    return result.rows.map((permission: any) => ({
      ...permission,
      granted_at: new Date(permission.granted_at),
      created_at: new Date(permission.created_at),
      updated_at: new Date(permission.updated_at),
    }));
  }
}
