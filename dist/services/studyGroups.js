"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.StudyGroupService = void 0;
const pool_1 = __importDefault(require("../db/pool"));
class StudyGroupService {
    // إنشاء مجموعة دراسية جديدة
    static async createStudyGroup(groupData) {
        const result = await pool_1.default.query(`INSERT INTO study_groups 
       (teacher_id, name, start_time, end_time, days, grade_id) 
       VALUES ($1, $2, $3, $4, $5, $6) 
       RETURNING *`, [
            groupData.teacher_id,
            groupData.name,
            groupData.start_time,
            groupData.end_time,
            groupData.days,
            groupData.grade_id || null,
        ]);
        return result.rows[0];
    }
    // تحديث مجموعة دراسية
    static async updateStudyGroup(groupId, teacherId, updateData) {
        const updateFields = [];
        const values = [];
        let paramIndex = 1;
        if (updateData.name !== undefined) {
            updateFields.push(`name = $${paramIndex++}`);
            values.push(updateData.name);
        }
        if (updateData.start_time !== undefined) {
            updateFields.push(`start_time = $${paramIndex++}`);
            values.push(updateData.start_time);
        }
        if (updateData.end_time !== undefined) {
            updateFields.push(`end_time = $${paramIndex++}`);
            values.push(updateData.end_time);
        }
        if (updateData.days !== undefined) {
            updateFields.push(`days = $${paramIndex++}`);
            values.push(updateData.days);
        }
        if (updateData.grade_id !== undefined) {
            updateFields.push(`grade_id = $${paramIndex++}`);
            values.push(updateData.grade_id);
        }
        updateFields.push(`updated_at = NOW()`);
        values.push(groupId);
        const result = await pool_1.default.query(`UPDATE study_groups 
       SET ${updateFields.join(', ')} 
       WHERE id = $${paramIndex++} AND teacher_id = $${paramIndex++} 
       RETURNING *`, [...values, teacherId]);
        return result.rows[0];
    }
    // حذف مجموعة دراسية
    static async deleteStudyGroup(groupId, teacherId) {
        const result = await pool_1.default.query('DELETE FROM study_groups WHERE id = $1 AND teacher_id = $2 RETURNING *', [groupId, teacherId]);
        return result.rows[0];
    }
    // جلب مجموعة بواسطة ID
    static async getStudyGroupById(groupId) {
        const result = await pool_1.default.query(`SELECT sg.*, u.name as teacher_name, g.name as grade_name
       FROM study_groups sg
       LEFT JOIN users u ON sg.teacher_id = u.id
       LEFT JOIN grades g ON sg.grade_id = g.id
       WHERE sg.id = $1`, [groupId]);
        return result.rows[0];
    }
    // جلب جميع مجموعات المدرس
    static async getTeacherGroups(teacherId) {
        const result = await pool_1.default.query(`SELECT sg.*, 
              COUNT(gs.student_id) as students_count,
              g.name as grade_name
       FROM study_groups sg
       LEFT JOIN group_students gs ON sg.id = gs.group_id
       LEFT JOIN grades g ON sg.grade_id = g.id
       WHERE sg.teacher_id = $1
       GROUP BY sg.id, g.name
       ORDER BY sg.created_at DESC`, [teacherId]);
        return result.rows;
    }
    // جلب جميع المجموعات
    static async getAllGroups() {
        const result = await pool_1.default.query(`SELECT sg.*, u.name as teacher_name,
              COUNT(gs.student_id) as students_count,
              g.name as grade_name
       FROM study_groups sg
       LEFT JOIN users u ON sg.teacher_id = u.id
       LEFT JOIN group_students gs ON sg.id = gs.group_id
       LEFT JOIN grades g ON sg.grade_id = g.id
       GROUP BY sg.id, u.name, g.name
       ORDER BY sg.created_at DESC`);
        return result.rows;
    }
    // إضافة طالب للمجموعة (number_in_group يبدأ من 1 في كل مجموعة)
    static async addStudentToGroup(groupId, studentId) {
        const nextNumRes = await pool_1.default.query(`SELECT COALESCE(MAX(number_in_group), 0) + 1 AS next_num FROM group_students WHERE group_id = $1`, [groupId]);
        const numberInGroup = nextNumRes.rows[0].next_num;
        const result = await pool_1.default.query(`INSERT INTO group_students (group_id, student_id, number_in_group) 
       VALUES ($1, $2, $3) 
       RETURNING *`, [groupId, studentId, numberInGroup]);
        return result.rows[0];
    }
    // إزالة طالب من المجموعة
    static async removeStudentFromGroup(groupId, studentId) {
        const result = await pool_1.default.query('DELETE FROM group_students WHERE group_id = $1 AND student_id = $2 RETURNING *', [groupId, studentId]);
        return result.rows[0];
    }
    // جلب طلاب المجموعة مع حالة الحضور/الغياب إذا تم إرسال تاريخ
    static async getGroupStudents(groupId, date) {
        let result;
        if (date) {
            result = await pool_1.default.query(`SELECT gs.*, 
                u.name as student_name, 
                u.email as student_email,
                u.phone,
                u.parent_phone,
                u.payment_status,
                u.payment_amount,
                u.payment_date,
                ga.status as attendance_status
         FROM group_students gs
         JOIN users u ON gs.student_id = u.id
         LEFT JOIN group_attendance ga ON ga.group_id = gs.group_id AND ga.student_id = gs.student_id AND ga.date = $2
         WHERE gs.group_id = $1
         ORDER BY gs.number_in_group ASC`, [groupId, date]);
        }
        else {
            result = await pool_1.default.query(`SELECT gs.*, 
                u.name as student_name, 
                u.email as student_email,
                u.phone,
                u.parent_phone,
                u.payment_status,
                u.payment_amount,
                u.payment_date
         FROM group_students gs
         JOIN users u ON gs.student_id = u.id
         WHERE gs.group_id = $1
         ORDER BY gs.number_in_group ASC`, [groupId]);
        }
        return result.rows;
    }
    // جلب عدد طلاب المجموعة
    static async getGroupStudentsCount(groupId) {
        const result = await pool_1.default.query('SELECT COUNT(*) as count FROM group_students WHERE group_id = $1', [groupId]);
        return parseInt(result.rows[0].count);
    }
    // التحقق من وجود الطالب في المجموعة
    static async isStudentInGroup(groupId, studentId) {
        const result = await pool_1.default.query('SELECT * FROM group_students WHERE group_id = $1 AND student_id = $2', [groupId, studentId]);
        return result.rows.length > 0;
    }
    // إنشاء طالب جديد (بيانات بسيطة) عند الحاجة داخل نظام السنتر
    static async createStudentMinimal(name, phone, parent_phone, tenantId) {
        // كلمة مرور عشوائية بسيطة (ينبغي لاحقاً إرسال SMS/تحديثها من لوحة التحكم)
        const randomPassword = Math.random().toString(36).slice(-8);
        const result = await pool_1.default.query(`INSERT INTO users (name, phone, password, role, parent_phone, tenant_id)
       VALUES ($1, $2, $3, 'student', $4, COALESCE($5, (SELECT id FROM tenants WHERE subdomain = 'default' LIMIT 1)))
       RETURNING id, name, phone, parent_phone`, [name || 'طالب', phone || null, randomPassword, parent_phone || null, tenantId ?? null]);
        return result.rows[0];
    }
    static async findStudentByPhone(phone, tenantId) {
        const result = await pool_1.default.query(`SELECT id, name FROM users WHERE phone = $1 AND role = $2
       AND tenant_id = COALESCE($3::INTEGER, (SELECT id FROM tenants WHERE subdomain = 'default' LIMIT 1))`, [phone, 'student', tenantId ?? null]);
        return result.rows[0];
    }
}
exports.StudyGroupService = StudyGroupService;
