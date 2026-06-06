import pool from '../db/pool';
import { CourseContentService } from '../services/courseContent';

/**
 * التحقق من صلاحية المستخدم للوصول لمحتوى الكورس
 * يدعم الكورسات العادية والكورسات في المواد الدراسية
 */
export async function canAccessCourseContent(
  courseId: number,
  userId: number,
  userRole: string,
): Promise<boolean> {
  // Admin دائماً لديه صلاحية
  if (userRole === 'admin') {
    return true;
  }

  // Teacher - التحقق من ملكية الكورس
  if (userRole === 'teacher') {
    // التحقق من courses العادية
    const courseResult = await pool.query(
      'SELECT 1 FROM courses WHERE id = $1 AND teacher_id = $2',
      [courseId, userId],
    );
    if (courseResult.rowCount) {
      return true;
    }

    // التحقق من subject_courses
    const subjectCourseResult = await pool.query(
      'SELECT 1 FROM subject_courses WHERE id = $1 AND teacher_id = $2',
      [courseId, userId],
    );
    return (subjectCourseResult.rowCount ?? 0) > 0;
  }

  // Student - التحقق من الاشتراك أو تفعيل الباقة
  if (userRole === 'student') {
    return await CourseContentService.canStudentAccessCourseContent(courseId, userId);
  }

  return false;
}

/**
 * التحقق من صلاحية المستخدم للوصول لمحاضرة معينة
 * @param lectureId - معرف المحاضرة
 * @param userId - معرف المستخدم
 * @param userRole - دور المستخدم
 */
export async function canAccessLecture(
  lectureId: number,
  userId: number,
  userRole: string,
): Promise<boolean> {
  // Admin دائماً لديه صلاحية
  if (userRole === 'admin') {
    return true;
  }

  // جلب معلومات المحاضرة والكورس
  // المحاضرات قد تكون في lectures أو course_lectures
  let courseId: number | null = null;
  let lectureTable = 'lectures';

  // التحقق من course_lectures أولاً
  const courseLectureResult = await pool.query(
    'SELECT course_id FROM course_lectures WHERE id = $1',
    [lectureId],
  );

  if (courseLectureResult.rowCount) {
    courseId = courseLectureResult.rows[0].course_id;
    lectureTable = 'course_lectures';
  } else {
    // التحقق من lectures
    const lectureResult = await pool.query('SELECT course_id FROM lectures WHERE id = $1', [
      lectureId,
    ]);
    if (lectureResult.rowCount) {
      courseId = lectureResult.rows[0].course_id;
      lectureTable = 'lectures';
    }
  }

  if (!courseId) {
    return false;
  }

  // استخدام canAccessCourseContent للتحقق من صلاحية الوصول للكورس
  return await canAccessCourseContent(courseId, userId, userRole);
}
