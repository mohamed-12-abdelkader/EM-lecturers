"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SubjectCourseService = void 0;
const pool_1 = __importDefault(require("../db/pool"));
const teacherSubjects_1 = require("./teacherSubjects");
class SubjectCourseService {
    // إنشاء كورس جديد
    static async createCourse(teacherId, courseData) {
        // التحقق من صلاحيات المدرس على المادة
        const hasPermission = await teacherSubjects_1.TeacherSubjectService.checkTeacherPermission(teacherId, courseData.subject_id, 'can_create_content');
        if (!hasPermission) {
            throw new Error('ليس لديك صلاحية لإنشاء محتوى لهذه المادة');
        }
        const result = await pool_1.default.query(`INSERT INTO subject_courses 
       (subject_id, teacher_id, title, description, image, price, duration_hours, level, status) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) 
       RETURNING *`, [
            courseData.subject_id,
            teacherId,
            courseData.title,
            courseData.description,
            courseData.image,
            courseData.price || 0,
            courseData.duration_hours || 0,
            courseData.level || 'مبتدئ',
            courseData.status || 'draft',
        ]);
        return result.rows[0];
    }
    // تحديث كورس
    static async updateCourse(courseId, teacherId, courseData) {
        // التحقق من ملكية الكورس أو صلاحيات الأدمن
        const course = await this.getCourseById(courseId);
        if (!course) {
            throw new Error('الكورس غير موجود');
        }
        if (course.teacher_id !== teacherId) {
            throw new Error('لا يمكنك تعديل كورس مدرس آخر');
        }
        const updateFields = [];
        const values = [];
        let paramIndex = 1;
        if (courseData.title !== undefined) {
            updateFields.push(`title = $${paramIndex++}`);
            values.push(courseData.title);
        }
        if (courseData.description !== undefined) {
            updateFields.push(`description = $${paramIndex++}`);
            values.push(courseData.description);
        }
        if (courseData.image !== undefined) {
            updateFields.push(`image = $${paramIndex++}`);
            values.push(courseData.image);
        }
        if (courseData.price !== undefined) {
            updateFields.push(`price = $${paramIndex++}`);
            values.push(courseData.price);
        }
        if (courseData.duration_hours !== undefined) {
            updateFields.push(`duration_hours = $${paramIndex++}`);
            values.push(courseData.duration_hours);
        }
        if (courseData.level !== undefined) {
            updateFields.push(`level = $${paramIndex++}`);
            values.push(courseData.level);
        }
        if (courseData.status !== undefined) {
            updateFields.push(`status = $${paramIndex++}`);
            values.push(courseData.status);
        }
        updateFields.push(`updated_at = NOW()`);
        values.push(courseId);
        const result = await pool_1.default.query(`UPDATE subject_courses 
       SET ${updateFields.join(', ')} 
       WHERE id = $${paramIndex++} 
       RETURNING *`, values);
        return result.rows[0];
    }
    // حذف كورس
    static async deleteCourse(courseId, teacherId) {
        // التحقق من ملكية الكورس أو صلاحيات الأدمن
        const course = await this.getCourseById(courseId);
        if (!course) {
            throw new Error('الكورس غير موجود');
        }
        if (course.teacher_id !== teacherId) {
            throw new Error('لا يمكنك حذف كورس مدرس آخر');
        }
        const result = await pool_1.default.query('DELETE FROM subject_courses WHERE id = $1 RETURNING *', [
            courseId,
        ]);
        return result.rows[0];
    }
    // دالة مساعدة لتطبيق Base URL على صورة الكورس
    static addBaseUrlToCourseImage(course) {
        return course;
    }
    // جلب كورس بواسطة ID
    static async getCourseById(courseId) {
        const result = await pool_1.default.query(`SELECT sc.*, s.name as subject_name, s.description as subject_description,
              u.name as teacher_name, u.email as teacher_email
       FROM subject_courses sc
       JOIN subjects s ON sc.subject_id = s.id
       JOIN users u ON sc.teacher_id = u.id
       WHERE sc.id = $1`, [courseId]);
        return this.addBaseUrlToCourseImage(result.rows[0]);
    }
    // جلب جميع كورسات مادة محددة
    static async getCoursesBySubject(subjectId, status) {
        let query = `
      SELECT sc.*, s.name as subject_name, s.description as subject_description,
             u.name as teacher_name, u.email as teacher_email
      FROM subject_courses sc
      JOIN subjects s ON sc.subject_id = s.id
      JOIN users u ON sc.teacher_id = u.id
      WHERE sc.subject_id = $1
    `;
        const values = [subjectId];
        if (status) {
            query += ' AND sc.status = $2';
            values.push(status);
        }
        query += ' ORDER BY sc.created_at DESC';
        const result = await pool_1.default.query(query, values);
        return result.rows.map((course) => this.addBaseUrlToCourseImage(course));
    }
    // جلب جميع كورسات مدرس
    static async getCoursesByTeacher(teacherId, status) {
        let query = `
      SELECT sc.*, s.name as subject_name, s.description as subject_description
      FROM subject_courses sc
      JOIN subjects s ON sc.subject_id = s.id
      WHERE sc.teacher_id = $1
    `;
        const values = [teacherId];
        if (status) {
            query += ' AND sc.status = $2';
            values.push(status);
        }
        query += ' ORDER BY sc.created_at DESC';
        const result = await pool_1.default.query(query, values);
        return result.rows.map((course) => this.addBaseUrlToCourseImage(course));
    }
    // جلب جميع الكورسات المنشورة
    static async getPublishedCourses() {
        const result = await pool_1.default.query(`SELECT sc.*, s.name as subject_name, s.description as subject_description,
              u.name as teacher_name, u.email as teacher_email
       FROM subject_courses sc
       JOIN subjects s ON sc.subject_id = s.id
       JOIN users u ON sc.teacher_id = u.id
       WHERE sc.status = 'published'
       ORDER BY sc.created_at DESC`);
        return result.rows.map((course) => this.addBaseUrlToCourseImage(course));
    }
    // جلب الكورسات المجانية
    static async getFreeCourses() {
        const result = await pool_1.default.query(`SELECT sc.*, s.name as subject_name, s.description as subject_description,
              u.name as teacher_name, u.email as teacher_email
       FROM subject_courses sc
       JOIN subjects s ON sc.subject_id = s.id
       JOIN users u ON sc.teacher_id = u.id
       WHERE sc.status = 'published' AND sc.price = 0.00
       ORDER BY sc.created_at DESC`);
        return result.rows.map((course) => this.addBaseUrlToCourseImage(course));
    }
    // جلب الكورسات المدفوعة
    static async getPaidCourses() {
        const result = await pool_1.default.query(`SELECT sc.*, s.name as subject_name, s.description as subject_description,
              u.name as teacher_name, u.email as teacher_email
       FROM subject_courses sc
       JOIN subjects s ON sc.subject_id = s.id
       JOIN users u ON sc.teacher_id = u.id
       WHERE sc.status = 'published' AND sc.price > 0.00
       ORDER BY sc.created_at DESC`);
        return result.rows.map((course) => this.addBaseUrlToCourseImage(course));
    }
    // البحث في الكورسات
    static async searchCourses(searchTerm, filters) {
        let query = `
      SELECT sc.*, s.name as subject_name, s.description as subject_description,
             u.name as teacher_name, u.email as teacher_email
      FROM subject_courses sc
      JOIN subjects s ON sc.subject_id = s.id
      JOIN users u ON sc.teacher_id = u.id
      WHERE (sc.title ILIKE $1 OR sc.description ILIKE $1 OR s.name ILIKE $1)
    `;
        const values = [`%${searchTerm}%`];
        let paramIndex = 2;
        if (filters?.subject_id) {
            query += ` AND sc.subject_id = $${paramIndex++}`;
            values.push(filters.subject_id);
        }
        if (filters?.teacher_id) {
            query += ` AND sc.teacher_id = $${paramIndex++}`;
            values.push(filters.teacher_id);
        }
        if (filters?.level) {
            query += ` AND sc.level = $${paramIndex++}`;
            values.push(filters.level);
        }
        if (filters?.status) {
            query += ` AND sc.status = $${paramIndex++}`;
            values.push(filters.status);
        }
        if (filters?.min_price !== undefined) {
            query += ` AND sc.price >= $${paramIndex++}`;
            values.push(filters.min_price);
        }
        if (filters?.max_price !== undefined) {
            query += ` AND sc.price <= $${paramIndex++}`;
            values.push(filters.max_price);
        }
        query += ' ORDER BY sc.created_at DESC';
        const result = await pool_1.default.query(query, values);
        return result.rows;
    }
    // جلب إحصائيات الكورسات
    static async getCourseStats(teacherId) {
        let query = `
      SELECT 
        COUNT(*) as total_courses,
        COUNT(CASE WHEN status = 'published' THEN 1 END) as published_courses,
        COUNT(CASE WHEN status = 'draft' THEN 1 END) as draft_courses,
        COUNT(CASE WHEN status = 'archived' THEN 1 END) as archived_courses,
        AVG(price) as average_price,
        SUM(duration_hours) as total_duration
      FROM subject_courses
    `;
        const values = [];
        if (teacherId) {
            query += ' WHERE teacher_id = $1';
            values.push(teacherId);
        }
        const result = await pool_1.default.query(query, values);
        return result.rows[0];
    }
    // التحقق من وجود المادة
    static async subjectExists(subjectId) {
        const result = await pool_1.default.query('SELECT id FROM subjects WHERE id = $1', [subjectId]);
        return result.rows.length > 0;
    }
}
exports.SubjectCourseService = SubjectCourseService;
