"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GroupExamService = void 0;
const pool_1 = __importDefault(require("../db/pool"));
const bcrypt_1 = __importDefault(require("bcrypt"));
class GroupExamService {
    // إنشاء امتحان جديد للمجموعة
    static async createGroupExam(examData) {
        const result = await pool_1.default.query(`INSERT INTO group_exams 
       (group_id, name, total_grade, exam_date) 
       VALUES ($1, $2, $3, $4) 
       RETURNING *`, [examData.group_id, examData.name, examData.total_grade || 100, examData.exam_date || null]);
        return result.rows[0];
    }
    // تحديث امتحان
    static async updateGroupExam(examId, teacherId, updateData) {
        // التحقق من ملكية المجموعة
        const exam = await this.getGroupExamById(examId);
        if (!exam) {
            throw new Error('الامتحان غير موجود');
        }
        const groupResult = await pool_1.default.query('SELECT teacher_id FROM study_groups WHERE id = $1', [
            exam.group_id,
        ]);
        if (groupResult.rows.length === 0 || groupResult.rows[0].teacher_id !== teacherId) {
            throw new Error('لا يمكنك تعديل امتحان لمجموعة مدرس آخر');
        }
        const updateFields = [];
        const values = [];
        let paramIndex = 1;
        if (updateData.name !== undefined) {
            updateFields.push(`name = $${paramIndex++}`);
            values.push(updateData.name);
        }
        if (updateData.total_grade !== undefined) {
            updateFields.push(`total_grade = $${paramIndex++}`);
            values.push(updateData.total_grade);
        }
        if (updateData.exam_date !== undefined) {
            updateFields.push(`exam_date = $${paramIndex++}`);
            values.push(updateData.exam_date);
        }
        updateFields.push(`updated_at = NOW()`);
        values.push(examId);
        const result = await pool_1.default.query(`UPDATE group_exams 
       SET ${updateFields.join(', ')} 
       WHERE id = $${paramIndex++} 
       RETURNING *`, values);
        return result.rows[0];
    }
    // حذف امتحان
    static async deleteGroupExam(examId, teacherId) {
        // التحقق من ملكية المجموعة
        const exam = await this.getGroupExamById(examId);
        if (!exam) {
            throw new Error('الامتحان غير موجود');
        }
        const groupResult = await pool_1.default.query('SELECT teacher_id FROM study_groups WHERE id = $1', [
            exam.group_id,
        ]);
        if (groupResult.rows.length === 0 || groupResult.rows[0].teacher_id !== teacherId) {
            throw new Error('لا يمكنك حذف امتحان لمجموعة مدرس آخر');
        }
        const result = await pool_1.default.query('DELETE FROM group_exams WHERE id = $1 RETURNING *', [examId]);
        return result.rows[0];
    }
    // جلب امتحان بواسطة ID
    static async getGroupExamById(examId) {
        const result = await pool_1.default.query(`SELECT ge.*, sg.name as group_name, sg.teacher_id
       FROM group_exams ge
       JOIN study_groups sg ON ge.group_id = sg.id
       WHERE ge.id = $1`, [examId]);
        return result.rows[0];
    }
    // جلب جميع امتحانات المجموعة
    static async getGroupExams(groupId) {
        const result = await pool_1.default.query(`SELECT ge.*, 
              COUNT(geg.student_id) as students_count,
              AVG(geg.grade) as average_grade
       FROM group_exams ge
       LEFT JOIN group_exam_grades geg ON ge.id = geg.exam_id
       WHERE ge.group_id = $1
       GROUP BY ge.id
       ORDER BY ge.created_at DESC`, [groupId]);
        return result.rows;
    }
    // إضافة درجة طالب في امتحان
    static async addStudentGrade(gradeData, teacherId) {
        // التحقق من ملكية الامتحان
        const exam = await this.getGroupExamById(gradeData.exam_id);
        if (!exam) {
            throw new Error('الامتحان غير موجود');
        }
        if (exam.teacher_id !== teacherId) {
            throw new Error('لا يمكنك إضافة درجة لامتحان مدرس آخر');
        }
        // التحقق من وجود الطالب
        const studentExists = await pool_1.default.query('SELECT id, name, role FROM users WHERE id = $1', [
            gradeData.student_id,
        ]);
        if (studentExists.rows.length === 0) {
            throw new Error(`الطالب برقم ${gradeData.student_id} غير موجود في النظام`);
        }
        if (studentExists.rows[0].role !== 'student') {
            throw new Error(`المستخدم برقم ${gradeData.student_id} ليس طالب (الدور: ${studentExists.rows[0].role})`);
        }
        // التحقق من أن الطالب في المجموعة
        const studentInGroup = await pool_1.default.query('SELECT 1 FROM group_students WHERE group_id = $1 AND student_id = $2', [exam.group_id, gradeData.student_id]);
        if (studentInGroup.rows.length === 0) {
            // إضافة معلومات debugging
            const groupStudents = await pool_1.default.query('SELECT gs.student_id, u.name FROM group_students gs JOIN users u ON gs.student_id = u.id WHERE gs.group_id = $1', [exam.group_id]);
            const studentList = groupStudents.rows
                .map((row) => `${row.name} (ID: ${row.student_id})`)
                .join(', ');
            throw new Error(`الطالب ${studentExists.rows[0].name} (ID: ${gradeData.student_id}) غير موجود في المجموعة. الطلاب الموجودون في المجموعة: ${studentList || 'لا يوجد طلاب'}`);
        }
        // التحقق من أن الدرجة لا تتجاوز الدرجة الكلية
        if (gradeData.grade > exam.total_grade) {
            throw new Error(`الدرجة لا يمكن أن تتجاوز ${exam.total_grade}`);
        }
        const result = await pool_1.default.query(`INSERT INTO group_exam_grades 
       (exam_id, student_id, grade, notes) 
       VALUES ($1, $2, $3, $4) 
       ON CONFLICT (exam_id, student_id) 
       DO UPDATE SET 
         grade = EXCLUDED.grade,
         notes = EXCLUDED.notes,
         updated_at = NOW()
       RETURNING *`, [gradeData.exam_id, gradeData.student_id, gradeData.grade, gradeData.notes || null]);
        return result.rows[0];
    }
    // تحديث درجة طالب
    static async updateStudentGrade(examId, studentId, teacherId, updateData) {
        // التحقق من ملكية الامتحان
        const exam = await this.getGroupExamById(examId);
        if (!exam) {
            throw new Error('الامتحان غير موجود');
        }
        if (exam.teacher_id !== teacherId) {
            throw new Error('لا يمكنك تعديل درجة لامتحان مدرس آخر');
        }
        const updateFields = [];
        const values = [];
        let paramIndex = 1;
        if (updateData.grade !== undefined) {
            if (updateData.grade > exam.total_grade) {
                throw new Error(`الدرجة لا يمكن أن تتجاوز ${exam.total_grade}`);
            }
            updateFields.push(`grade = $${paramIndex++}`);
            values.push(updateData.grade);
        }
        if (updateData.notes !== undefined) {
            updateFields.push(`notes = $${paramIndex++}`);
            values.push(updateData.notes);
        }
        updateFields.push(`updated_at = NOW()`);
        values.push(examId, studentId);
        const result = await pool_1.default.query(`UPDATE group_exam_grades 
       SET ${updateFields.join(', ')} 
       WHERE exam_id = $${paramIndex++} AND student_id = $${paramIndex++} 
       RETURNING *`, values);
        return result.rows[0];
    }
    // حذف درجة طالب
    static async deleteStudentGrade(examId, studentId, teacherId) {
        // التحقق من ملكية الامتحان
        const exam = await this.getGroupExamById(examId);
        if (!exam) {
            throw new Error('الامتحان غير موجود');
        }
        if (exam.teacher_id !== teacherId) {
            throw new Error('لا يمكنك حذف درجة لامتحان مدرس آخر');
        }
        const result = await pool_1.default.query('DELETE FROM group_exam_grades WHERE exam_id = $1 AND student_id = $2 RETURNING *', [examId, studentId]);
        return result.rows[0];
    }
    // جلب درجات امتحان معين
    static async getExamGrades(examId) {
        const result = await pool_1.default.query(`SELECT geg.*, 
              u.name as student_name,
              u.email as student_email,
              ge.name as exam_name,
              ge.total_grade
       FROM group_exam_grades geg
       JOIN users u ON geg.student_id = u.id
       JOIN group_exams ge ON geg.exam_id = ge.id
       WHERE geg.exam_id = $1
       ORDER BY u.name`, [examId]);
        return result.rows;
    }
    // جلب درجات طالب في جميع امتحانات المجموعة
    static async getStudentGrades(groupId, studentId) {
        const result = await pool_1.default.query(`SELECT geg.*, 
              ge.name as exam_name,
              ge.total_grade,
              ge.exam_date
       FROM group_exam_grades geg
       JOIN group_exams ge ON geg.exam_id = ge.id
       WHERE ge.group_id = $1 AND geg.student_id = $2
       ORDER BY ge.created_at DESC`, [groupId, studentId]);
        return result.rows;
    }
    // جلب إحصائيات امتحان
    static async getExamStats(examId) {
        const result = await pool_1.default.query(`SELECT 
         COUNT(*) as total_students,
         COUNT(geg.student_id) as graded_students,
         AVG(geg.grade) as average_grade,
         MAX(geg.grade) as highest_grade,
         MIN(geg.grade) as lowest_grade,
         ge.total_grade,
         ge.name as exam_name
       FROM group_exams ge
       LEFT JOIN group_students gs ON ge.group_id = gs.group_id
       LEFT JOIN group_exam_grades geg ON ge.id = geg.exam_id AND gs.student_id = geg.student_id
       WHERE ge.id = $1
       GROUP BY ge.id, ge.total_grade, ge.name`, [examId]);
        return result.rows[0];
    }
    // جلب طلاب المجموعة (للتحقق)
    static async getGroupStudents(groupId) {
        const result = await pool_1.default.query(`SELECT gs.student_id, u.name as student_name, u.email
       FROM group_students gs
       JOIN users u ON gs.student_id = u.id
       WHERE gs.group_id = $1
       ORDER BY u.name`, [groupId]);
        return result.rows;
    }
    // جلب جميع الطلاب في النظام (للتحقق)
    static async getAllStudents() {
        const result = await pool_1.default.query(`SELECT id, name, email, role, created_at
       FROM users 
       WHERE role = 'student'
       ORDER BY name`, []);
        return result.rows;
    }
    // تشخيص مشكلة عدم تطابق ID الطلاب
    static async diagnoseStudentIds(examId) {
        const exam = await this.getGroupExamById(examId);
        if (!exam) {
            throw new Error('الامتحان غير موجود');
        }
        // جلب الطلاب في المجموعة مع تفاصيلهم
        const groupStudents = await pool_1.default.query(`SELECT 
         gs.student_id as current_id,
         gs.joined_at,
         u.name as student_name,
         u.email,
         u.role,
         u.id as correct_id,
         CASE 
           WHEN u.id IS NULL THEN 'orphaned'
           WHEN u.role != 'student' THEN 'wrong_role'
           ELSE 'valid'
         END as status
       FROM group_students gs
       LEFT JOIN users u ON gs.student_id = u.id
       WHERE gs.group_id = $1`, [exam.group_id]);
        // جلب جميع الطلاب المتاحين في النظام
        const allStudents = await pool_1.default.query(`SELECT id, name, email, phone, role, created_at
       FROM users 
       WHERE role = 'student'
       ORDER BY name`, []);
        // جلب السجلات اليتيمة
        const orphanedRecords = await pool_1.default.query(`SELECT gs.student_id, gs.group_id, gs.joined_at
       FROM group_students gs
       LEFT JOIN users u ON gs.student_id = u.id
       WHERE u.id IS NULL AND gs.group_id = $1`, [exam.group_id]);
        return {
            group_students: groupStudents.rows,
            available_students: allStudents.rows,
            orphaned_records: orphanedRecords.rows,
            summary: {
                total_group_students: groupStudents.rows.length,
                valid_students: groupStudents.rows.filter((s) => s.status === 'valid').length,
                orphaned_records: orphanedRecords.rows.length,
                wrong_role_students: groupStudents.rows.filter((s) => s.status === 'wrong_role').length,
                available_students_count: allStudents.rows.length,
            },
        };
    }
    // إصلاح مشكلة عدم تطابق ID الطلاب
    static async fixStudentIds(examId, studentMappings) {
        const exam = await this.getGroupExamById(examId);
        if (!exam) {
            throw new Error('الامتحان غير موجود');
        }
        const details = [];
        let fixedCount = 0;
        for (const mapping of studentMappings) {
            try {
                // التحقق من وجود الطالب الجديد
                const newStudent = await pool_1.default.query('SELECT id, name, role FROM users WHERE id = $1', [
                    mapping.new_id,
                ]);
                if (newStudent.rows.length === 0) {
                    details.push({
                        old_id: mapping.old_id,
                        new_id: mapping.new_id,
                        status: 'failed',
                        error: 'الطالب الجديد غير موجود في النظام',
                    });
                    continue;
                }
                if (newStudent.rows[0].role !== 'student') {
                    details.push({
                        old_id: mapping.old_id,
                        new_id: mapping.new_id,
                        status: 'failed',
                        error: 'المستخدم الجديد ليس طالب',
                    });
                    continue;
                }
                // التحقق من عدم وجود الطالب الجديد في المجموعة بالفعل
                const existingStudent = await pool_1.default.query('SELECT 1 FROM group_students WHERE group_id = $1 AND student_id = $2', [exam.group_id, mapping.new_id]);
                if (existingStudent.rows.length > 0) {
                    details.push({
                        old_id: mapping.old_id,
                        new_id: mapping.new_id,
                        status: 'failed',
                        error: 'الطالب الجديد موجود في المجموعة بالفعل',
                    });
                    continue;
                }
                // تحديث ID الطالب
                const result = await pool_1.default.query('UPDATE group_students SET student_id = $1 WHERE group_id = $2 AND student_id = $3 RETURNING *', [mapping.new_id, exam.group_id, mapping.old_id]);
                if (result.rows.length > 0) {
                    details.push({
                        old_id: mapping.old_id,
                        new_id: mapping.new_id,
                        student_name: newStudent.rows[0].name,
                        status: 'success',
                    });
                    fixedCount++;
                }
                else {
                    details.push({
                        old_id: mapping.old_id,
                        new_id: mapping.new_id,
                        status: 'failed',
                        error: 'لم يتم العثور على الطالب القديم في المجموعة',
                    });
                }
            }
            catch (error) {
                details.push({
                    old_id: mapping.old_id,
                    new_id: mapping.new_id,
                    status: 'failed',
                    error: error instanceof Error ? error.message : 'خطأ غير معروف',
                });
            }
        }
        return {
            fixed_count: fixedCount,
            details,
        };
    }
    // إصلاح مشكلة إضافة مدرس بدلاً من طالب في المجموعة
    static async fixWrongRoleStudents(examId, replacements) {
        const exam = await this.getGroupExamById(examId);
        if (!exam) {
            throw new Error('الامتحان غير موجود');
        }
        const details = [];
        let fixedCount = 0;
        for (const replacement of replacements) {
            try {
                // التحقق من وجود المستخدم الخاطئ في المجموعة
                const wrongUser = await pool_1.default.query('SELECT gs.*, u.name, u.role FROM group_students gs JOIN users u ON gs.student_id = u.id WHERE gs.group_id = $1 AND gs.student_id = $2', [exam.group_id, replacement.wrong_id]);
                if (wrongUser.rows.length === 0) {
                    details.push({
                        wrong_id: replacement.wrong_id,
                        status: 'failed',
                        error: 'المستخدم الخاطئ غير موجود في المجموعة',
                    });
                    continue;
                }
                const wrongUserData = wrongUser.rows[0];
                if (wrongUserData.role === 'student') {
                    details.push({
                        wrong_id: replacement.wrong_id,
                        status: 'skipped',
                        message: 'المستخدم بالفعل طالب، لا حاجة للإصلاح',
                    });
                    continue;
                }
                // إنشاء طالب جديد
                const hashedPassword = await bcrypt_1.default.hash('123456', 10); // كلمة مرور افتراضية
                const newStudent = await pool_1.default.query(`INSERT INTO users (name, phone, parent_phone, password, role, payment_status, payment_amount, payment_date)
           VALUES ($1, $2, $3, $4, 'student', $5, $6, $7)
           RETURNING id, name, phone`, [
                    replacement.correct_student_data.name,
                    replacement.correct_student_data.phone,
                    replacement.correct_student_data.parent_phone,
                    hashedPassword,
                    replacement.correct_student_data.payment_status,
                    replacement.correct_student_data.payment_amount || 0,
                    replacement.correct_student_data.payment_status === 'paid' ? new Date() : null,
                ]);
                if (newStudent.rows.length === 0) {
                    details.push({
                        wrong_id: replacement.wrong_id,
                        status: 'failed',
                        error: 'فشل في إنشاء الطالب الجديد',
                    });
                    continue;
                }
                const newStudentId = newStudent.rows[0].id;
                // تحديث المجموعة لاستخدام الطالب الجديد
                const updateResult = await pool_1.default.query('UPDATE group_students SET student_id = $1 WHERE group_id = $2 AND student_id = $3 RETURNING *', [newStudentId, exam.group_id, replacement.wrong_id]);
                if (updateResult.rows.length > 0) {
                    details.push({
                        wrong_id: replacement.wrong_id,
                        new_student_id: newStudentId,
                        new_student_name: newStudent.rows[0].name,
                        wrong_user_name: wrongUserData.name,
                        wrong_user_role: wrongUserData.role,
                        status: 'success',
                    });
                    fixedCount++;
                }
                else {
                    details.push({
                        wrong_id: replacement.wrong_id,
                        status: 'failed',
                        error: 'فشل في تحديث المجموعة',
                    });
                }
            }
            catch (error) {
                details.push({
                    wrong_id: replacement.wrong_id,
                    status: 'failed',
                    error: error instanceof Error ? error.message : 'خطأ غير معروف',
                });
            }
        }
        return {
            fixed_count: fixedCount,
            details,
        };
    }
}
exports.GroupExamService = GroupExamService;
