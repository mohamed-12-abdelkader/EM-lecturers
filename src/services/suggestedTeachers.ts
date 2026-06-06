import pool from '../db/pool';

export interface SuggestedTeacher {
  id: number;
  teacher_id: number;
  suggested_teacher_id: number;
  suggested_teacher: {
    id: number;
    name: string;
    email: string;
    avatar: string | null;
    description: string | null;
    subject: string | null;
  };
  created_at: string;
}

export class SuggestedTeachersService {
  /**
   * إضافة مدرس مقترح
   */
  static async addSuggestedTeacher(
    teacherId: number,
    suggestedTeacherId: number,
  ): Promise<{ success: boolean; message: string; data?: SuggestedTeacher }> {
    try {
      // التحقق من أن المدرس المقترح موجود وله دور مدرس
      const suggestedTeacherCheck = await pool.query(
        'SELECT id, name, email, avatar, description, subject FROM users WHERE id = $1 AND role = $2',
        [suggestedTeacherId, 'teacher'],
      );

      if (!suggestedTeacherCheck.rowCount) {
        return {
          success: false,
          message: 'المدرس المقترح غير موجود أو ليس له دور مدرس',
        };
      }

      // التحقق من عدم وجود المدرس المقترح بالفعل
      const existingCheck = await pool.query(
        'SELECT id FROM suggested_teachers WHERE teacher_id = $1 AND suggested_teacher_id = $2',
        [teacherId, suggestedTeacherId],
      );

      if (existingCheck.rowCount && existingCheck.rowCount > 0) {
        return {
          success: false,
          message: 'المدرس مقترح بالفعل',
        };
      }

      // إضافة المدرس المقترح
      const result = await pool.query(
        `INSERT INTO suggested_teachers (teacher_id, suggested_teacher_id)
         VALUES ($1, $2)
         RETURNING id, teacher_id, suggested_teacher_id, created_at`,
        [teacherId, suggestedTeacherId],
      );

      const suggestedTeacher = suggestedTeacherCheck.rows[0];
      const data: SuggestedTeacher = {
        ...result.rows[0],
        suggested_teacher: {
          ...suggestedTeacher,
          avatar: suggestedTeacher.avatar,
        },
      };

      return {
        success: true,
        message: 'تم إضافة المدرس المقترح بنجاح',
        data,
      };
    } catch (error) {
      console.error('Error adding suggested teacher:', error);
      return {
        success: false,
        message: 'حدث خطأ أثناء إضافة المدرس المقترح',
      };
    }
  }

  /**
   * حذف مدرس مقترح
   */
  static async removeSuggestedTeacher(
    teacherId: number,
    suggestedTeacherId: number,
  ): Promise<{ success: boolean; message: string }> {
    try {
      const result = await pool.query(
        'DELETE FROM suggested_teachers WHERE teacher_id = $1 AND suggested_teacher_id = $2',
        [teacherId, suggestedTeacherId],
      );

      if (result.rowCount === 0) {
        return {
          success: false,
          message: 'المدرس المقترح غير موجود',
        };
      }

      return {
        success: true,
        message: 'تم حذف المدرس المقترح بنجاح',
      };
    } catch (error) {
      console.error('Error removing suggested teacher:', error);
      return {
        success: false,
        message: 'حدث خطأ أثناء حذف المدرس المقترح',
      };
    }
  }

  /**
   * جلب المدرسين المقترحين لمدرس معين (للمدرس نفسه)
   */
  static async getSuggestedTeachers(
    teacherId: number,
  ): Promise<{ success: boolean; data?: SuggestedTeacher[]; message?: string }> {
    try {
      const result = await pool.query(
        `SELECT 
          st.id,
          st.teacher_id,
          st.suggested_teacher_id,
          st.created_at,
          u.id as suggested_id,
          u.name as suggested_name,
          u.email as suggested_email,
          u.avatar as suggested_avatar,
          u.description as suggested_description,
          u.subject as suggested_subject
         FROM suggested_teachers st
         JOIN users u ON st.suggested_teacher_id = u.id
         WHERE st.teacher_id = $1
         ORDER BY st.created_at DESC`,
        [teacherId],
      );

      const suggestedTeachers: SuggestedTeacher[] = result.rows.map((row) => ({
        id: row.id,
        teacher_id: row.teacher_id,
        suggested_teacher_id: row.suggested_teacher_id,
        suggested_teacher: {
          id: row.suggested_id,
          name: row.suggested_name,
          email: row.suggested_email,
          avatar: row.suggested_avatar,
          description: row.suggested_description,
          subject: row.suggested_subject,
        },
        created_at: row.created_at,
      }));

      return {
        success: true,
        data: suggestedTeachers,
      };
    } catch (error) {
      console.error('Error getting suggested teachers:', error);
      return {
        success: false,
        message: 'حدث خطأ أثناء جلب المدرسين المقترحين',
      };
    }
  }

  /**
   * جلب المدرسين المقترحين للطالب (عرض في صفحة المدرس)
   */
  static async getSuggestedTeachersForStudent(
    teacherId: number,
  ): Promise<{ success: boolean; data?: any[]; message?: string }> {
    try {
      const result = await pool.query(
        `SELECT 
          u.id,
          u.name,
          u.email,
          u.avatar,
          u.description,
          u.subject,
          st.created_at as suggested_at
         FROM suggested_teachers st
         JOIN users u ON st.suggested_teacher_id = u.id
         WHERE st.teacher_id = $1
         ORDER BY st.created_at DESC`,
        [teacherId],
      );

      const suggestedTeachers = result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        email: row.email,
        avatar: row.avatar,
        description: row.description,
        subject: row.subject,
        suggested_at: row.suggested_at,
      }));

      return {
        success: true,
        data: suggestedTeachers,
      };
    } catch (error) {
      console.error('Error getting suggested teachers for student:', error);
      return {
        success: false,
        message: 'حدث خطأ أثناء جلب المدرسين المقترحين',
      };
    }
  }
}
