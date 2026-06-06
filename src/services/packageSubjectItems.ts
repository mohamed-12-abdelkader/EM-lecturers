import pool from '../db/pool';

export class PackageSubjectItemService {
  // جلب جميع مواد الباقة
  static async getPackageSubjectItems(packageId: number) {
    const result = await pool.query(
      'SELECT * FROM package_subject_items WHERE package_id = $1 ORDER BY created_at',
      [packageId],
    );
    return result.rows;
  }

  // جلب مادة باقة محددة
  static async getPackageSubjectItem(id: number) {
    const result = await pool.query('SELECT * FROM package_subject_items WHERE id = $1', [id]);
    return result.rows[0];
  }

  // إنشاء مادة باقة جديدة
  static async createPackageSubjectItem(packageId: number, name: string, image?: string) {
    const result = await pool.query(
      'INSERT INTO package_subject_items (package_id, name, image) VALUES ($1, $2, $3) RETURNING *',
      [packageId, name, image],
    );
    return result.rows[0];
  }

  // تحديث مادة باقة
  static async updatePackageSubjectItem(id: number, name: string, image?: string) {
    const result = await pool.query(
      'UPDATE package_subject_items SET name = $1, image = $2 WHERE id = $3 RETURNING *',
      [name, image, id],
    );
    return result.rows[0];
  }

  // حذف مادة باقة
  static async deletePackageSubjectItem(id: number) {
    const result = await pool.query('DELETE FROM package_subject_items WHERE id = $1 RETURNING *', [
      id,
    ]);
    return result.rows[0];
  }

  // التحقق من وجود الباقة
  static async packageExists(packageId: number) {
    const result = await pool.query('SELECT id FROM packages WHERE id = $1', [packageId]);
    return result.rows.length > 0;
  }

  // جلب تفاصيل المادة مع معلومات الباقة
  static async getSubjectWithPackage(id: number) {
    const result = await pool.query(
      `SELECT 
         psi.*,
         p.id as package_id,
         p.name as package_name,
         p.price as package_price,
         p.image as package_image,
         p.grade_id,
         g.name as grade_name
       FROM package_subject_items psi
       JOIN packages p ON psi.package_id = p.id
       LEFT JOIN grades g ON p.grade_id = g.id
       WHERE psi.id = $1`,
      [id],
    );
    return result.rows[0];
  }
}
