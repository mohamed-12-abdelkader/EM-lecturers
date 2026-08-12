import pool from '../db/pool';
import { SubjectCourseService } from './subjectCourses';
import { LectureExamService } from './lectureExam';
import { CourseAccessService } from './courseAccess';
import { CourseAccessControl } from './courseAccessControl';
import { LectureAccessService } from './lectureAccess';
import { CourseGroupAccessService } from './courseGroupAccess';

export interface LectureData {
  course_id: number;
  title: string;
  description?: string;
  content?: string;
  video_url?: string;
  video_duration?: number;
  order_index?: number;
  is_free?: boolean;
}

export class CourseContentService {
  /** ملكية الكورس للمدرس / الأكاديمية / المسند */
  private static async userCanManageCourse(userId: number, courseId: number): Promise<boolean> {
    const roleRes = await pool.query<{ role: string; tenant_id: number | null }>(
      `SELECT role, tenant_id FROM users WHERE id = $1`,
      [userId],
    );
    if (!roleRes.rowCount) return false;
    const u = roleRes.rows[0];
    return CourseAccessControl.canManageCourse(
      { id: userId, role: u.role, tenant_id: u.tenant_id },
      courseId,
    );
  }

  // ===== إدارة المحاضرات =====

  // التحقق من صلاحية الطالب للوصول لمحتوى الكورس
  // يدعم الكورسات العادية (courses)
  static async canStudentAccessCourseContent(
    courseId: number,
    studentId: number,
  ): Promise<boolean> {
    if (await CourseAccessService.isFreePublicCourse(courseId)) {
      return true;
    }

    // التحقق من الكورسات العادية
    const enrollmentCheck = await pool.query(
      'SELECT 1 FROM enrollments WHERE course_id = $1 AND user_id = $2',
      [courseId, studentId],
    );
    return (enrollmentCheck.rowCount ?? 0) > 0;
  }

  // تحديد نوع الكورس وإرجاع معلوماته
  static async getCourseInfo(courseId: number): Promise<{
    type: 'regular' | 'subject';
    course: any;
  } | null> {
    // التحقق من subject_courses
    const subjectCourse = await SubjectCourseService.getCourseById(courseId);
    if (subjectCourse) {
      return { type: 'subject', course: subjectCourse };
    }

    // التحقق من courses
    const courseResult = await pool.query('SELECT * FROM courses WHERE id = $1', [courseId]);
    if (courseResult.rows[0]) {
      return { type: 'regular', course: courseResult.rows[0] };
    }

    return null;
  }

  // إنشاء محاضرة جديدة
  static async createLecture(teacherId: number, lectureData: LectureData) {
    // التحقق من ملكية الكورس أو صلاحيات الأدمن
    const courseInfo = await this.getCourseInfo(lectureData.course_id);

    if (!courseInfo) {
      throw new Error('الكورس غير موجود');
    }

    if (!(await this.userCanManageCourse(teacherId, lectureData.course_id))) {
      throw new Error('لا يمكنك إضافة محاضرة لكورس مدرس آخر');
    }

    // تحديد الجدول المناسب بناءً على نوع الكورس
    let insertQuery = `
      INSERT INTO course_lectures 
      (course_id, title, description, content, video_url, video_duration, order_index, is_free) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
      RETURNING *
    `;

    // إذا كان الكورس في جدول courses، استخدم جدول lectures
    if (courseInfo.type === 'regular') {
      insertQuery = `
        INSERT INTO lectures 
        (course_id, title, description, position, created_at) 
        VALUES ($1, $2, $3, $4, NOW()) 
        RETURNING *
      `;

      const result = await pool.query(insertQuery, [
        lectureData.course_id,
        lectureData.title,
        lectureData.description || null,
        lectureData.order_index || 0,
      ]);
      return result.rows[0];
    }

    // للكورسات في المواد الدراسية أو subject_courses، استخدم course_lectures
    const result = await pool.query(insertQuery, [
      lectureData.course_id,
      lectureData.title,
      lectureData.description,
      lectureData.content,
      lectureData.video_url,
      lectureData.video_duration,
      lectureData.order_index || 0,
      lectureData.is_free !== false, // true افتراضياً
    ]);
    return result.rows[0];
  }

  // تحديث محاضرة
  static async updateLecture(
    lectureId: number,
    teacherId: number,
    lectureData: Partial<LectureData>,
  ) {
    const lecture = await this.getLectureById(lectureId);

    if (!lecture) {
      throw new Error('المحاضرة غير موجودة');
    }

    // التحقق من ملكية الكورس
    let course;
    if (lecture.table_name === 'course_lectures') {
      course = await SubjectCourseService.getCourseById(lecture.course_id);
    } else {
      // للجدول lectures، استخدم courses مباشرة
      const courseResult = await pool.query('SELECT * FROM courses WHERE id = $1', [
        lecture.course_id,
      ]);
      course = courseResult.rows[0];
    }

    if (!course || !(await this.userCanManageCourse(teacherId, lecture.course_id))) {
      throw new Error('لا يمكنك تعديل محاضرة لكورس مدرس آخر');
    }

    const updateFields = [];
    const values = [];
    let paramIndex = 1;

    if (lectureData.title !== undefined) {
      updateFields.push(`title = $${paramIndex++}`);
      values.push(lectureData.title);
    }
    if (lectureData.description !== undefined) {
      updateFields.push(`description = $${paramIndex++}`);
      values.push(lectureData.description);
    }
    if (lectureData.content !== undefined) {
      updateFields.push(`content = $${paramIndex++}`);
      values.push(lectureData.content);
    }
    if (lectureData.video_url !== undefined) {
      updateFields.push(`video_url = $${paramIndex++}`);
      values.push(lectureData.video_url);
    }
    if (lectureData.video_duration !== undefined) {
      updateFields.push(`video_duration = $${paramIndex++}`);
      values.push(lectureData.video_duration);
    }
    if (lectureData.order_index !== undefined) {
      updateFields.push(`order_index = $${paramIndex++}`);
      values.push(lectureData.order_index);
    }
    if (lectureData.is_free !== undefined) {
      updateFields.push(`is_free = $${paramIndex++}`);
      values.push(lectureData.is_free);
    }

    // تحديث في الجدول المناسب
    let tableName = 'course_lectures';
    if (lecture.table_name === 'lectures') {
      tableName = 'lectures';
    } else {
      // إضافة updated_at فقط لجدول course_lectures
      updateFields.push(`updated_at = NOW()`);
    }

    values.push(lectureId);

    const result = await pool.query(
      `UPDATE ${tableName} 
       SET ${updateFields.join(', ')} 
       WHERE id = $${paramIndex++} 
       RETURNING *`,
      values,
    );

    return result.rows[0];
  }

  // حذف محاضرة
  static async deleteLecture(lectureId: number, teacherId: number) {
    const lecture = await this.getLectureById(lectureId);
    if (!lecture) {
      throw new Error('المحاضرة غير موجودة');
    }

    // التحقق من ملكية الكورس
    let course;
    if (lecture.table_name === 'course_lectures') {
      course = await SubjectCourseService.getCourseById(lecture.course_id);
    } else {
      // للجدول lectures، استخدم courses مباشرة
      const courseResult = await pool.query('SELECT * FROM courses WHERE id = $1', [
        lecture.course_id,
      ]);
      course = courseResult.rows[0];
    }

    if (!course || !(await this.userCanManageCourse(teacherId, lecture.course_id))) {
      throw new Error('لا يمكنك حذف محاضرة لكورس مدرس آخر');
    }

    // بدء transaction لحذف البيانات المرتبطة
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      if (lecture.table_name === 'course_lectures') {
        // حذف من course_lectures
        await client.query('DELETE FROM course_lecture_attachments WHERE lecture_id = $1', [
          lectureId,
        ]);

        const result = await client.query('DELETE FROM course_lectures WHERE id = $1 RETURNING *', [
          lectureId,
        ]);

        await client.query('COMMIT');
        return result.rows[0];
      } else {
        // حذف من lectures
        // حذف الامتحانات المرتبطة بالمحاضرة أولاً
        await client.query('DELETE FROM exams WHERE lecture_id = $1', [lectureId]);

        // حذف المحاضرة نفسها
        const result = await client.query('DELETE FROM lectures WHERE id = $1 RETURNING *', [
          lectureId,
        ]);

        await client.query('COMMIT');
        return result.rows[0];
      }
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // جلب محاضرة بواسطة ID
  static async getLectureById(lectureId: number) {
    // البحث في جدول course_lectures أولاً
    // course_id قد يشير إلى subject_courses
    let result = await pool.query(
      `SELECT cl.*, 
              sc.title as course_title, 
              sc.price as course_price, 
              'course_lectures' as table_name,
              'subject' as course_type
       FROM course_lectures cl
       LEFT JOIN subject_courses sc ON cl.course_id = sc.id
       WHERE cl.id = $1`,
      [lectureId],
    );

    if (result.rows.length > 0) {
      return result.rows[0];
    }

    // إذا لم توجد في course_lectures، ابحث في جدول lectures
    result = await pool.query(
      `SELECT l.*, c.title as course_title, c.price as course_price, 'lectures' as table_name, 'regular' as course_type
       FROM lectures l
       JOIN courses c ON l.course_id = c.id
       WHERE l.id = $1`,
      [lectureId],
    );

    return result.rows[0];
  }

  // جلب جميع محاضرات الكورس
  static async getCourseLectures(courseId: number) {
    const result = await pool.query(
      `SELECT cl.*, 
              COUNT(cla.id) as attachments_count
       FROM course_lectures cl
       LEFT JOIN course_lecture_attachments cla ON cl.id = cla.lecture_id
       WHERE cl.course_id = $1
       GROUP BY cl.id
       ORDER BY cl.order_index, cl.created_at`,
      [courseId],
    );
    return result.rows;
  }

  // جلب محاضرات الكورس مع منطق القفل للطلاب (جدول lectures - كورسات عادية)
  // المحاضرات التالية لمحاضرة فيها امتحان بـ "قفل المحاضرات التالية" تظل مقفلة حتى نجاح الطالب
  static async getCourseLecturesWithLock(courseId: number, studentId?: number) {
    let lectures: any[];
    if (studentId) {
      const courseTeacherId = await CourseGroupAccessService.resolveCourseTeacherId(courseId);
      if (courseTeacherId) {
        const filter = CourseGroupAccessService.buildStudentLectureFilterClause(
          studentId,
          courseTeacherId,
          'l',
          2,
        );
        const result = await pool.query(
          `SELECT l.* FROM lectures l
           WHERE l.course_id = $1 AND ${filter.sql}
           ORDER BY l.position, l.created_at`,
          [courseId, ...filter.params],
        );
        lectures = result.rows;
      } else {
        const result = await pool.query(
          `SELECT * FROM lectures WHERE course_id = $1 ORDER BY position, created_at`,
          [courseId],
        );
        lectures = result.rows;
      }
    } else {
      const result = await pool.query(
        `SELECT * FROM lectures WHERE course_id = $1 ORDER BY position, created_at`,
        [courseId],
      );
      lectures = result.rows;
    }

    if (!studentId) {
      return lectures.map((l: any) => ({ ...l, is_unlocked: true }));
    }

    const withLock = await Promise.all(
      lectures.map(async (l: any) => {
        const modeAccess = await LectureAccessService.checkStudentLectureAccess(l.id, studentId);
        if (!modeAccess.can_access) {
          return {
            ...l,
            is_unlocked: false,
            locked: true,
            access_status: modeAccess.status,
            lecture_access_mode: modeAccess.lecture_access_mode,
            access_message: modeAccess.message,
            activation: modeAccess.activation ?? null,
            expires_at: modeAccess.expires_at ?? l.expires_at ?? null,
          };
        }
        const canAccess = await LectureExamService.canStudentAccessLecture(l.id, studentId);
        return {
          ...l,
          is_unlocked: canAccess,
          locked: !canAccess,
          access_status: canAccess ? modeAccess.status : 'locked',
          lecture_access_mode: modeAccess.lecture_access_mode,
          activation: modeAccess.activation ?? null,
          expires_at: modeAccess.expires_at ?? l.expires_at ?? null,
        };
      }),
    );
    return withLock;
  }

  // ===== إدارة الملفات المرفقة =====

  // إضافة ملف مرفق للمحاضرة
  static async addLectureAttachment(
    lectureId: number,
    teacherId: number,
    attachmentData: {
      file_name: string;
      file_url: string;
      file_size?: number;
      file_type?: string;
      description?: string;
    },
  ) {
    const lecture = await this.getLectureById(lectureId);
    if (!lecture) {
      throw new Error('المحاضرة غير موجودة');
    }

    const course = await SubjectCourseService.getCourseById(lecture.course_id);
    if (!course || !(await this.userCanManageCourse(teacherId, lecture.course_id))) {
      throw new Error('لا يمكنك إضافة ملف لكورس مدرس آخر');
    }

    const result = await pool.query(
      `INSERT INTO course_lecture_attachments 
       (lecture_id, file_name, file_url, file_size, file_type, description) 
       VALUES ($1, $2, $3, $4, $5, $6) 
       RETURNING *`,
      [
        lectureId,
        attachmentData.file_name,
        attachmentData.file_url,
        attachmentData.file_size,
        attachmentData.file_type,
        attachmentData.description,
      ],
    );
    return result.rows[0];
  }

  // جلب ملفات مرفقة المحاضرة
  static async getLectureAttachments(lectureId: number) {
    const result = await pool.query(
      'SELECT * FROM course_lecture_attachments WHERE lecture_id = $1 ORDER BY created_at',
      [lectureId],
    );
    return result.rows;
  }

  // ===== إحصائيات الكورس =====

  // جلب إحصائيات محتوى الكورس
  static async getCourseContentStats(courseId: number) {
    const result = await pool.query(
      `SELECT 
         (SELECT COUNT(*) FROM course_lectures WHERE course_id = $1) as total_lectures,
         (SELECT COUNT(*) FROM course_lectures WHERE course_id = $1 AND is_free = true) as free_lectures,
         (SELECT COUNT(*) FROM course_lecture_attachments cla 
          JOIN course_lectures cl ON cla.lecture_id = cl.id 
          WHERE cl.course_id = $1) as total_attachments,
         (SELECT COALESCE(SUM(video_duration), 0) FROM course_lectures WHERE course_id = $1) as total_video_duration
       `,
      [courseId],
    );
    return result.rows[0];
  }
}
