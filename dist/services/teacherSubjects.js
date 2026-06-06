"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TeacherSubjectService = void 0;
const pool_1 = __importDefault(require("../db/pool"));
class TeacherSubjectService {
    // منح صلاحيات لمدرس على مادة
    static async assignSubjectToTeacher(teacherId, subjectId, permissions, assignedBy) {
        const result = await pool_1.default.query(`INSERT INTO teacher_subjects 
       (teacher_id, subject_id, can_edit, can_delete, can_create_content, can_view, assigned_by) 
       VALUES ($1, $2, $3, $4, $5, $6, $7) 
       ON CONFLICT (teacher_id, subject_id) 
       DO UPDATE SET 
         can_edit = $3, 
         can_delete = $4, 
         can_create_content = $5, 
         can_view = $6, 
         assigned_by = $7, 
         assigned_at = NOW()
       RETURNING *`, [
            teacherId,
            subjectId,
            permissions.can_edit,
            permissions.can_delete,
            permissions.can_create_content,
            permissions.can_view,
            assignedBy,
        ]);
        return result.rows[0];
    }
    // إزالة صلاحيات مدرس من مادة
    static async removeSubjectFromTeacher(teacherId, subjectId) {
        const result = await pool_1.default.query('DELETE FROM teacher_subjects WHERE teacher_id = $1 AND subject_id = $2 RETURNING *', [teacherId, subjectId]);
        return result.rows[0];
    }
    // جلب جميع المواد المخصصة لمدرس
    static async getTeacherSubjects(teacherId) {
        const result = await pool_1.default.query(`SELECT ts.*, s.name as subject_name, s.description as subject_description, s.image as subject_image,
              u.name as assigned_by_name
       FROM teacher_subjects ts
       JOIN subjects s ON ts.subject_id = s.id
       LEFT JOIN users u ON ts.assigned_by = u.id
       WHERE ts.teacher_id = $1
       ORDER BY ts.assigned_at DESC`, [teacherId]);
        return result.rows;
    }
    // جلب جميع المدرسين المخصصين لمادة
    static async getSubjectTeachers(subjectId) {
        const result = await pool_1.default.query(`SELECT ts.*, u.name as teacher_name, u.email as teacher_email,
              a.name as assigned_by_name
       FROM teacher_subjects ts
       JOIN users u ON ts.teacher_id = u.id
       LEFT JOIN users a ON ts.assigned_by = a.id
       WHERE ts.subject_id = $1
       ORDER BY ts.assigned_at DESC`, [subjectId]);
        return result.rows;
    }
    // التحقق من صلاحيات مدرس على مادة
    static async checkTeacherPermission(teacherId, subjectId, permission) {
        const result = await pool_1.default.query(`SELECT ${permission} FROM teacher_subjects 
       WHERE teacher_id = $1 AND subject_id = $2`, [teacherId, subjectId]);
        if (result.rows.length === 0) {
            return false;
        }
        return result.rows[0][permission];
    }
    // تحديث صلاحيات مدرس على مادة
    static async updateTeacherPermissions(teacherId, subjectId, permissions, updatedBy) {
        const updateFields = [];
        const values = [];
        let paramIndex = 1;
        if (permissions.can_edit !== undefined) {
            updateFields.push(`can_edit = $${paramIndex++}`);
            values.push(permissions.can_edit);
        }
        if (permissions.can_delete !== undefined) {
            updateFields.push(`can_delete = $${paramIndex++}`);
            values.push(permissions.can_delete);
        }
        if (permissions.can_create_content !== undefined) {
            updateFields.push(`can_create_content = $${paramIndex++}`);
            values.push(permissions.can_create_content);
        }
        if (permissions.can_view !== undefined) {
            updateFields.push(`can_view = $${paramIndex++}`);
            values.push(permissions.can_view);
        }
        updateFields.push(`assigned_by = $${paramIndex++}`);
        values.push(updatedBy);
        updateFields.push(`assigned_at = NOW()`);
        values.push(teacherId, subjectId);
        const result = await pool_1.default.query(`UPDATE teacher_subjects 
       SET ${updateFields.join(', ')} 
       WHERE teacher_id = $${paramIndex++} AND subject_id = $${paramIndex++} 
       RETURNING *`, values);
        return result.rows[0];
    }
    // جلب إحصائيات المواد للمدرس
    static async getTeacherSubjectStats(teacherId) {
        const result = await pool_1.default.query(`SELECT 
         COUNT(*) as total_subjects,
         COUNT(CASE WHEN can_edit = true THEN 1 END) as editable_subjects,
         COUNT(CASE WHEN can_delete = true THEN 1 END) as deletable_subjects,
         COUNT(CASE WHEN can_create_content = true THEN 1 END) as content_creation_subjects
       FROM teacher_subjects 
       WHERE teacher_id = $1`, [teacherId]);
        return result.rows[0];
    }
    // التحقق من وجود المدرس
    static async teacherExists(teacherId) {
        const result = await pool_1.default.query('SELECT id FROM users WHERE id = $1 AND role = $2', [
            teacherId,
            'teacher',
        ]);
        return result.rows.length > 0;
    }
    // التحقق من وجود المادة
    static async subjectExists(subjectId) {
        const result = await pool_1.default.query('SELECT id FROM subjects WHERE id = $1', [subjectId]);
        return result.rows.length > 0;
    }
    // جلب المواد مع الفصول والدروس (Hierarchy)
    static async getTeacherSubjectsWithContent(teacherId) {
        const result = await pool_1.default.query(`SELECT
         s.id, s.name, s.description, s.image_url, s.question_bank_id,
         COALESCE(
           json_agg(
             json_build_object(
               'id', c.id,
               'name', c.name,
               'lessons', (
                 SELECT COALESCE(json_agg(l.* ORDER BY l.id), '[]')
                 FROM lessons l
                 WHERE l.chapter_id = c.id
               )
             ) ORDER BY c.id
           ) FILTER (WHERE c.id IS NOT NULL),
           '[]'
         ) as chapters
       FROM teacher_subjects ts
       JOIN subjects s ON s.id = ts.subject_id
       LEFT JOIN chapters c ON c.subject_id = s.id
       WHERE ts.teacher_id = $1
       GROUP BY s.id
       ORDER BY s.id`, [teacherId]);
        return result.rows;
    }
}
exports.TeacherSubjectService = TeacherSubjectService;
