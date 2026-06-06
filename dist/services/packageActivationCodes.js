"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PackageActivationCodeService = void 0;
const pool_1 = __importDefault(require("../db/pool"));
class PackageActivationCodeService {
    // Generate random 8-digit code
    static generateCode() {
        return Math.floor(10000000 + Math.random() * 90000000).toString();
    }
    // Create activation code for package
    static async create(data, createdBy) {
        // Verify package exists
        const packageCheck = await pool_1.default.query('SELECT id, name FROM packages WHERE id = $1', [
            data.package_id,
        ]);
        if (!packageCheck.rowCount) {
            throw new Error('الباقة غير موجودة');
        }
        // Generate unique code
        let code;
        let isUnique = false;
        let attempts = 0;
        const maxAttempts = 10;
        while (!isUnique && attempts < maxAttempts) {
            code = this.generateCode();
            const existing = await pool_1.default.query('SELECT id FROM package_activation_codes WHERE code = $1', [
                code,
            ]);
            if (!existing.rowCount) {
                isUnique = true;
            }
            attempts++;
        }
        if (!isUnique) {
            throw new Error('فشل في إنشاء كود فريد');
        }
        const result = await pool_1.default.query(`INSERT INTO package_activation_codes 
       (package_id, code, max_uses, expires_at, created_by) 
       VALUES ($1, $2, $3, $4, $5) 
       RETURNING *`, [data.package_id, code, data.max_uses || 1, data.expires_at || null, createdBy]);
        return result.rows[0];
    }
    // Get activation code by code string
    static async getByCode(code) {
        const result = await pool_1.default.query('SELECT * FROM package_activation_codes WHERE code = $1', [
            code,
        ]);
        return result.rows[0] || null;
    }
    // Get activation codes for a package
    static async getByPackage(packageId) {
        const result = await pool_1.default.query(`SELECT pac.*, p.name as package_name, u.name as created_by_name
       FROM package_activation_codes pac
       JOIN packages p ON pac.package_id = p.id
       LEFT JOIN users u ON pac.created_by = u.id
       WHERE pac.package_id = $1
       ORDER BY pac.created_at DESC`, [packageId]);
        return result.rows;
    }
    // Activate package for student
    static async activate(packageId, code, studentId) {
        const client = await pool_1.default.connect();
        try {
            await client.query('BEGIN');
            // Get activation code
            const codeResult = await client.query(`SELECT pac.*, p.name as package_name
         FROM package_activation_codes pac
         JOIN packages p ON pac.package_id = p.id
         WHERE pac.code = $1 AND pac.package_id = $2`, [code, packageId]);
            if (!codeResult.rowCount) {
                await client.query('ROLLBACK');
                return {
                    success: false,
                    message: 'كود التفعيل غير صحيح أو لا ينتمي لهذه الباقة',
                };
            }
            const activationCode = codeResult.rows[0];
            // Check if code is expired
            if (activationCode.expires_at && new Date(activationCode.expires_at) < new Date()) {
                await client.query('ROLLBACK');
                return {
                    success: false,
                    message: 'كود التفعيل منتهي الصلاحية',
                };
            }
            // Check if code is fully used
            if (activationCode.uses >= activationCode.max_uses) {
                await client.query('ROLLBACK');
                return {
                    success: false,
                    message: 'كود التفعيل مستنفذ',
                };
            }
            // Check if student already activated this package
            const existingActivation = await client.query('SELECT id FROM package_activations WHERE package_id = $1 AND student_id = $2', [packageId, studentId]);
            if ((existingActivation.rowCount ?? 0) > 0) {
                await client.query('ROLLBACK');
                return {
                    success: false,
                    message: 'لقد قمت بتفعيل هذه الباقة من قبل',
                };
            }
            // Create activation
            await client.query(`INSERT INTO package_activations (package_id, student_id, activation_code_id)
         VALUES ($1, $2, $3)`, [packageId, studentId, activationCode.id]);
            // Increment uses
            await client.query('UPDATE package_activation_codes SET uses = uses + 1 WHERE id = $1', [
                activationCode.id,
            ]);
            await client.query('COMMIT');
            return {
                success: true,
                message: 'تم تفعيل الباقة بنجاح',
                package: {
                    id: packageId,
                    name: activationCode.package_name,
                },
            };
        }
        catch (error) {
            await client.query('ROLLBACK');
            console.error('Error activating package:', error);
            throw new Error(error.message || 'فشل في تفعيل الباقة');
        }
        finally {
            client.release();
        }
    }
    // Check if student has activated package
    static async isActivated(packageId, studentId) {
        // السماح فقط للتفعيل الناتج من كود (activation_code_id NOT NULL) + is_active = TRUE
        // هذا يمنع أي تفعيل "يدوي" أو سجلات قديمة غير مرتبطة بكود.
        const result = await pool_1.default.query(`SELECT 1
       FROM package_activations
       WHERE package_id = $1
         AND student_id = $2
         AND is_active = TRUE
         AND activation_code_id IS NOT NULL
       LIMIT 1`, [packageId, studentId]);
        return (result.rowCount ?? 0) > 0;
    }
    // Get student's activated packages
    static async getStudentPackages(studentId) {
        const result = await pool_1.default.query(`SELECT p.*, pa.activated_at, pa.is_active
       FROM package_activations pa
       JOIN packages p ON pa.package_id = p.id
       WHERE pa.student_id = $1 AND pa.is_active = TRUE
       ORDER BY pa.activated_at DESC`, [studentId]);
        return result.rows;
    }
    // Get students who have activated a package
    static async getPackageStudents(packageId) {
        const result = await pool_1.default.query(`SELECT 
         u.id,
         u.name,
         u.email,
         u.avatar,
         u.phone,
         pa.activated_at,
         pa.is_active,
         pac.code as activation_code,
         g.name as grade_name
       FROM package_activations pa
       JOIN users u ON pa.student_id = u.id
       LEFT JOIN package_activation_codes pac ON pa.activation_code_id = pac.id
       LEFT JOIN user_grades ug ON u.id = ug.user_id
       LEFT JOIN grades g ON ug.grade_id = g.id
       WHERE pa.package_id = $1 AND pa.is_active = TRUE
       ORDER BY pa.activated_at DESC`, [packageId]);
        return result.rows;
    }
}
exports.PackageActivationCodeService = PackageActivationCodeService;
