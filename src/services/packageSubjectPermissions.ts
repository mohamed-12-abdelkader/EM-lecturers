import pool from '../db/pool';

export class PackageSubjectPermissionsService {
  // Grant permission to a teacher
  static async grantPermission(subjectId: number, teacherId: number, grantedBy: number) {
    const result = await pool.query(
      `INSERT INTO package_subject_permissions (subject_id, teacher_id, granted_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (subject_id, teacher_id) DO NOTHING
       RETURNING *`,
      [subjectId, teacherId, grantedBy]
    );
    return result.rows[0];
  }

  // Revoke permission
  static async revokePermission(subjectId: number, teacherId: number) {
    const result = await pool.query(
      'DELETE FROM package_subject_permissions WHERE subject_id = $1 AND teacher_id = $2 RETURNING id',
      [subjectId, teacherId]
    );
    return (result.rowCount ?? 0) > 0;
  }

  // Check if teacher has permission
  static async hasPermission(subjectId: number, teacherId: number): Promise<boolean> {
    const result = await pool.query(
      'SELECT id FROM package_subject_permissions WHERE subject_id = $1 AND teacher_id = $2',
      [subjectId, teacherId]
    );
    return (result.rowCount ?? 0) > 0;
  }

  // Get all teachers with permission for a subject
  static async getTeachersWithPermission(subjectId: number) {
    const result = await pool.query(
      `SELECT u.id, u.name, u.email, u.phone, p.granted_at
       FROM package_subject_permissions p
       JOIN users u ON p.teacher_id = u.id
       WHERE p.subject_id = $1`,
      [subjectId]
    );
    return result.rows;
  }
  // Get all subjects a teacher has permission for
  static async getTeacherSubjects(teacherId: number) {
    const result = await pool.query(
      `SELECT 
         psi.*, 
         p.name as package_name, 
         p.grade_id,
         g.name as grade_name,
         p.image as package_image
       FROM package_subject_permissions psp
       JOIN package_subject_items psi ON psp.subject_id = psi.id
       JOIN packages p ON psi.package_id = p.id
       LEFT JOIN grades g ON p.grade_id = g.id
       WHERE psp.teacher_id = $1
       ORDER BY psi.created_at DESC`,
      [teacherId]
    );
    return result.rows;
  }
}
