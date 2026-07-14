import pool from '../db/pool';

/** كورس مجاني أو طالب مسجّل — بدون اشتراك إلزامي للكورسات المجانية */
const studentCourseAccessSql = (studentParam: string) =>
  `(COALESCE(c.is_free, FALSE) = TRUE OR EXISTS (
    SELECT 1 FROM enrollments en_access
    WHERE en_access.course_id = c.id AND en_access.user_id = ${studentParam}
  ))`;

export interface LectureExam {
  id: number;
  lecture_id: number;
  type: string;
  total_grade: number;
  created_by: number;
  created_at: Date;
  title?: string;
  duration?: number;
  is_visible?: boolean;
  // الإعدادات الجديدة
  show_at?: Date | null;
  hide_at?: Date | null;
  lock_next_lectures?: boolean;
  show_answers_immediately?: boolean;
  show_answers_after_hours?: number;
}

export interface ExamQuestion {
  id: number;
  exam_id: number;
  question_text: string;
  grade: number;
}

export interface ExamSubmission {
  id: number;
  exam_id: number;
  student_id: number;
  submitted_at: Date;
  total_grade?: number;
  passed?: boolean;
}

export interface ExamAnswer {
  id: number;
  submission_id: number;
  question_id: number;
  answer_text?: string;
  grade?: number;
}

export class LectureExamService {
  /**
   * إنشاء امتحان MCQ جديد للمحاضرة
   */
  static async createExam(
    lectureId: number,
    title: string,
    totalGrade: number,
    createdBy: number,
    options?: {
      type?: string;
      duration?: number;
      isVisible?: boolean;
      showAt?: Date | null;
      hideAt?: Date | null;
      lockNextLectures?: boolean;
      showAnswersImmediately?: boolean;
      showAnswersAfterHours?: number;
    },
  ): Promise<LectureExam> {
    const {
      type = 'exam',
      duration = null,
      isVisible = false,
      showAt = null,
      hideAt = null,
      lockNextLectures = false,
      showAnswersImmediately = true,
      showAnswersAfterHours = 0,
    } = options || {};

    const examType =
      typeof type === 'string' && type.trim().toLowerCase() === 'assignment'
        ? 'assignment'
        : 'exam';

    const result = await pool.query(
      `INSERT INTO exams (
        lecture_id, type, total_grade, created_by, title, duration, is_visible,
        show_at, hide_at, lock_next_lectures, 
        show_answers_immediately, show_answers_after_hours
      )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
      [
        lectureId,
        examType,
        totalGrade,
        createdBy,
        title,
        duration,
        isVisible,
        showAt,
        hideAt,
        lockNextLectures,
        showAnswersImmediately,
        showAnswersAfterHours,
      ],
    );
    return result.rows[0];
  }

  /**
   * تحديث امتحان MCQ للمحاضرة
   */
  static async updateExam(
    examId: number,
    updates: {
      title?: string;
      totalGrade?: number;
      duration?: number;
      isVisible?: boolean;
      showAt?: Date | null;
      hideAt?: Date | null;
      lockNextLectures?: boolean;
      showAnswersImmediately?: boolean;
      showAnswersAfterHours?: number;
    },
    updatedBy: number,
  ): Promise<LectureExam | null> {
    const setClause = [];
    const values = [];
    let paramIndex = 1;

    if (updates.title !== undefined) {
      setClause.push(`title = $${paramIndex++}`);
      values.push(updates.title);
    }
    if (updates.totalGrade !== undefined) {
      setClause.push(`total_grade = $${paramIndex++}`);
      values.push(updates.totalGrade);
    }
    if (updates.duration !== undefined) {
      setClause.push(`duration = $${paramIndex++}`);
      values.push(updates.duration);
    }
    if (updates.isVisible !== undefined) {
      setClause.push(`is_visible = $${paramIndex++}`);
      values.push(updates.isVisible);
    }
    if (updates.showAt !== undefined) {
      setClause.push(`show_at = $${paramIndex++}`);
      values.push(updates.showAt);
    }
    if (updates.hideAt !== undefined) {
      setClause.push(`hide_at = $${paramIndex++}`);
      values.push(updates.hideAt);
    }
    if (updates.lockNextLectures !== undefined) {
      setClause.push(`lock_next_lectures = $${paramIndex++}`);
      values.push(updates.lockNextLectures);
    }
    if (updates.showAnswersImmediately !== undefined) {
      setClause.push(`show_answers_immediately = $${paramIndex++}`);
      values.push(updates.showAnswersImmediately);
    }
    if (updates.showAnswersAfterHours !== undefined) {
      setClause.push(`show_answers_after_hours = $${paramIndex++}`);
      values.push(updates.showAnswersAfterHours);
    }

    if (setClause.length === 0) {
      return null;
    }

    values.push(examId, updatedBy);

    const result = await pool.query(
      `UPDATE exams 
       SET ${setClause.join(', ')}
       WHERE id = $${paramIndex++} AND created_by = $${paramIndex++}
       RETURNING *`,
      values,
    );
    return result.rows[0] || null;
  }

  /**
   * حذف امتحان MCQ للمحاضرة
   */
  static async deleteExam(examId: number, createdBy: number): Promise<boolean> {
    const result = await pool.query('DELETE FROM exams WHERE id = $1 AND created_by = $2', [
      examId,
      createdBy,
    ]);
    return result.rowCount! > 0;
  }

  /**
   * جلب امتحان MCQ للمحاضرة بالتفصيل
   */
  static async getExamById(
    examId: number,
    userId: number,
    userRole: string,
  ): Promise<LectureExam | null> {
    let query = `
      SELECT e.*, 
             COUNT(DISTINCT q.id) as questions_count,
             COUNT(DISTINCT s.id) as submissions_count
      FROM exams e
      LEFT JOIN exam_questions q ON q.exam_id = e.id
      LEFT JOIN exam_submissions s ON s.exam_id = e.id
      WHERE e.id = $1
    `;

    const params = [examId];

    // إضافة شروط الوصول حسب الدور
    if (userRole === 'student') {
      query += ` AND EXISTS (
        SELECT 1 FROM lectures l 
        JOIN courses c ON l.course_id = c.id 
        WHERE l.id = e.lecture_id AND ${studentCourseAccessSql('$2')}
      )`;
      params.push(userId);
    } else if (userRole === 'teacher') {
      query += ` AND EXISTS (
        SELECT 1 FROM lectures l 
        JOIN courses c ON l.course_id = c.id 
        WHERE l.id = e.lecture_id AND c.teacher_id = $2
      )`;
      params.push(userId);
    }

    query += ` GROUP BY e.id`;

    const result = await pool.query(query, params);
    return result.rows[0] || null;
  }

  /**
   * جلب امتحانات محاضرة معينة
   */
  static async getExamsByLectureId(
    lectureId: number,
    userId: number,
    userRole: string,
  ): Promise<LectureExam[]> {
    let query = `
      SELECT e.*, 
             COUNT(DISTINCT q.id) as questions_count,
             COUNT(DISTINCT s.id) as submissions_count
      FROM exams e
      LEFT JOIN exam_questions q ON q.exam_id = e.id
      LEFT JOIN exam_submissions s ON s.exam_id = e.id
      WHERE e.lecture_id = $1
    `;

    const params = [lectureId];

    // إضافة شروط الوصول حسب الدور
    if (userRole === 'student') {
      query += ` AND EXISTS (
        SELECT 1 FROM lectures l 
        JOIN courses c ON l.course_id = c.id 
        WHERE l.id = e.lecture_id AND ${studentCourseAccessSql('$2')}
      )`;
      params.push(userId);
    } else if (userRole === 'teacher') {
      query += ` AND EXISTS (
        SELECT 1 FROM lectures l 
        JOIN courses c ON l.course_id = c.id 
        WHERE l.id = e.lecture_id AND c.teacher_id = $2
      )`;
      params.push(userId);
    }

    query += ` GROUP BY e.id ORDER BY e.created_at DESC`;

    const result = await pool.query(query, params);
    return result.rows;
  }

  /**
   * التحقق من إمكانية الوصول للامتحان للطالب
   */
  static async canStudentAccessExam(examId: number, studentId: number): Promise<boolean> {
    const now = new Date();

    const result = await pool.query(
      `SELECT e.*, l.id as lecture_id
       FROM exams e
       JOIN lectures l ON l.id = e.lecture_id
       JOIN courses c ON c.id = l.course_id
       WHERE e.id = $1 AND ${studentCourseAccessSql('$2')}
       AND (e.show_at IS NULL OR e.show_at <= $3)
       AND (e.hide_at IS NULL OR e.hide_at >= $3)
       AND e.is_visible = true`,
      [examId, studentId, now],
    );

    return result.rowCount! > 0;
  }

  /**
   * التحقق من إمكانية الوصول للمحاضرات التالية للطالب
   * المحاضرة مقفلة فقط إذا كان الامتحان ظاهر للطالب ولم ينجح فيه
   */
  static async canStudentAccessNextLectures(
    lectureId: number,
    studentId: number,
  ): Promise<boolean> {
    const now = new Date();

    console.log(`Debug - canStudentAccessNextLectures for lecture ${lectureId}:`);
    console.log('Debug - Student ID:', studentId);
    console.log('Debug - Current time:', now);
    console.log('Debug - Current time ISO:', now.toISOString());

    // البحث عن امتحان في هذه المحاضرة يمنع الوصول للمحاضرات التالية
    // ولكن فقط إذا كان الامتحان مرئي للطالب حالياً والطالب مسجل في الكورس
    const examResult = await pool.query(
      `SELECT e.id FROM exams e
       JOIN lectures l ON l.id = e.lecture_id
       JOIN courses c ON c.id = l.course_id
       WHERE e.lecture_id = $1 
       AND ${studentCourseAccessSql('$2')}
       AND e.lock_next_lectures = true
       AND e.is_visible = true
       AND (e.show_at IS NULL OR e.show_at <= $3)
       AND (e.hide_at IS NULL OR e.hide_at >= $3)`,
      [lectureId, studentId, now],
    );

    console.log('Debug - Exam result:', examResult.rows.length);

    // فحص إضافي لمعرفة سبب عدم وجود امتحان مانع
    if (examResult.rowCount === 0) {
      const debugExamResult = await pool.query(
        `SELECT e.id, e.is_visible, e.lock_next_lectures, e.show_at, e.hide_at,
                CASE 
                  WHEN e.is_visible = false THEN 'hidden_by_teacher'
                  WHEN e.show_at IS NOT NULL AND e.show_at > $3 THEN 'not_yet_visible'
                  WHEN e.hide_at IS NOT NULL AND e.hide_at < $3 THEN 'expired'
                  WHEN e.lock_next_lectures = false THEN 'lock_disabled'
                  ELSE 'should_block'
                END as reason
         FROM exams e
         JOIN lectures l ON l.id = e.lecture_id
         JOIN courses c ON c.id = l.course_id
         WHERE e.lecture_id = $1 
         AND ${studentCourseAccessSql('$2')}`,
        [lectureId, studentId, now],
      );

      console.log('Debug - All exams in lecture:', debugExamResult.rows);

      // فحص خاص لحالة hide_at قبل show_at
      for (const exam of debugExamResult.rows) {
        if (exam.show_at && exam.hide_at) {
          const showAt = new Date(exam.show_at);
          const hideAt = new Date(exam.hide_at);
          if (hideAt < showAt) {
            console.log('Debug - Exam has invalid time range: hide_at before show_at');
            console.log('Debug - show_at:', exam.show_at);
            console.log('Debug - hide_at:', exam.hide_at);
          }
        }
      }

      console.log('Debug - No blocking exam found, next lectures accessible');
      return true; // لا يوجد امتحان يمنع الوصول أو الامتحان غير مرئي للطالب أو الطالب غير مسجل
    }

    console.log('Debug - Blocking exam found:', examResult.rows[0].id);

    // التحقق من نجاح الطالب في الامتحان
    const passResult = await pool.query(
      `SELECT s.passed FROM exam_submissions s
       WHERE s.exam_id = $1 AND s.student_id = $2
       ORDER BY s.submitted_at DESC LIMIT 1`,
      [examResult.rows[0].id, studentId],
    );

    console.log(
      'Debug - Pass result:',
      passResult.rows.length > 0 ? passResult.rows[0] : 'No submission',
    );

    if (passResult.rowCount === 0) {
      console.log('Debug - No submission found, blocking access (exam visible but not taken)');
      return false; // الامتحان ظاهر للطالب ولم يخضع له بعد - قفل المحاضرات التالية
    }

    const passed = passResult.rows[0].passed === true;
    console.log('Debug - Exam passed:', passed);
    return passed; // إذا نجح، المحاضرات مفتوحة. إذا فشل، المحاضرات مقفلة
  }

  /**
   * دالة debug لفحص حالة الامتحانات المانعة للوصول
   */
  static async debugBlockingExams(lectureId: number, studentId: number): Promise<any> {
    const now = new Date();

    console.log(`Debug - debugBlockingExams for lecture ${lectureId}:`);
    console.log('Debug - Student ID:', studentId);
    console.log('Debug - Current time:', now);

    // فحص جميع الامتحانات في المحاضرات السابقة
    const allExamsResult = await pool.query(
      `SELECT e.id, e.title, e.is_visible, e.lock_next_lectures, 
              e.show_at, e.hide_at, l.title as lecture_title, l.position,
              CASE 
                WHEN e.is_visible = false THEN 'hidden_by_teacher'
                WHEN e.show_at IS NOT NULL AND e.show_at > $3 THEN 'not_yet_visible'
                WHEN e.hide_at IS NOT NULL AND e.hide_at < $3 THEN 'expired'
                ELSE 'visible'
              END as visibility_status
       FROM lectures l
       JOIN courses c ON c.id = l.course_id
       JOIN exams e ON e.lecture_id = l.id
       WHERE c.id = (SELECT course_id FROM lectures WHERE id = $1)
       AND ${studentCourseAccessSql('$2')}
       AND (l.position, COALESCE(l.created_at, '1970-01-01'::timestamp), l.id) <
           (SELECT position, COALESCE(created_at, '1970-01-01'::timestamp), id FROM lectures WHERE id = $1)
       ORDER BY l.position DESC, l.created_at DESC NULLS LAST, l.id DESC`,
      [lectureId, studentId, now],
    );

    // فحص الامتحانات المانعة للوصول فقط
    const blockingExamsResult = await pool.query(
      `SELECT e.id, e.title, e.is_visible, e.lock_next_lectures, 
              e.show_at, e.hide_at, l.title as lecture_title, l.position
       FROM lectures l
       JOIN courses c ON c.id = l.course_id
       JOIN exams e ON e.lecture_id = l.id
       WHERE c.id = (SELECT course_id FROM lectures WHERE id = $1)
       AND ${studentCourseAccessSql('$2')}
       AND (l.position, COALESCE(l.created_at, '1970-01-01'::timestamp), l.id) <
           (SELECT position, COALESCE(created_at, '1970-01-01'::timestamp), id FROM lectures WHERE id = $1)
       AND e.lock_next_lectures = true
       AND e.is_visible = true
       AND (e.show_at IS NULL OR e.show_at <= $3)
       AND (e.hide_at IS NULL OR e.hide_at >= $3)
       ORDER BY l.position DESC, l.created_at DESC NULLS LAST, l.id DESC`,
      [lectureId, studentId, now],
    );

    return {
      current_time: now,
      target_lecture_id: lectureId,
      student_id: studentId,
      all_exams_in_previous_lectures: allExamsResult.rows,
      potentially_blocking_exams: blockingExamsResult.rows,
      can_access: blockingExamsResult.rowCount === 0,
      logic_explanation: {
        exam_not_taken:
          'إذا لم يخضع الطالب للامتحان بعد، المحاضرات التالية مقفلة (لأن الامتحان ظاهر)',
        exam_passed: 'إذا نجح الطالب في الامتحان، المحاضرات التالية مفتوحة',
        exam_failed: 'إذا فشل الطالب في الامتحان، المحاضرات التالية مقفلة',
        exam_hidden: 'إذا كان الامتحان مخفي، المحاضرات التالية مفتوحة',
        exam_expired: 'إذا انتهت صلاحية الامتحان، المحاضرات التالية مفتوحة',
      },
    };
  }

  /**
   * التحقق من إمكانية الوصول لمحاضرة معينة للطالب
   * يفحص إذا كان هناك امتحان في المحاضرات السابقة يمنع الوصول
   */
  static async canStudentAccessLecture(lectureId: number, studentId: number): Promise<boolean> {
    const now = new Date();

    console.log(`Debug - canStudentAccessLecture for lecture ${lectureId}:`);
    console.log('Debug - Student ID:', studentId);
    console.log('Debug - Current time:', now);

    // البحث عن المحاضرات السابقة التي تحتوي على امتحانات تمنع الوصول
    // ولكن فقط إذا كانت الامتحانات مرئية للطالب حالياً
    const blockingExamResult = await pool.query(
      `SELECT l.id as lecture_id, l.position
       FROM lectures l
       JOIN courses c ON c.id = l.course_id
       JOIN exams e ON e.lecture_id = l.id
       WHERE c.id = (SELECT course_id FROM lectures WHERE id = $1)
       AND ${studentCourseAccessSql('$2')}
       AND (l.position, COALESCE(l.created_at, '1970-01-01'::timestamp), l.id) <
           (SELECT position, COALESCE(created_at, '1970-01-01'::timestamp), id FROM lectures WHERE id = $1)
       AND e.lock_next_lectures = true
       AND e.is_visible = true
       AND (e.show_at IS NULL OR e.show_at <= $3)
       AND (e.hide_at IS NULL OR e.hide_at >= $3)
       ORDER BY l.position DESC, l.created_at DESC NULLS LAST, l.id DESC`,
      [lectureId, studentId, now],
    );

    console.log('Debug - Blocking exams found:', blockingExamResult.rows.length);

    if (blockingExamResult.rowCount === 0) {
      console.log('Debug - No blocking exams found, access allowed');

      // فحص إضافي لمعرفة سبب عدم وجود امتحانات مانعة
      const allExamsDebugResult = await pool.query(
        `SELECT e.id, e.title, e.is_visible, e.lock_next_lectures, 
                e.show_at, e.hide_at, l.title as lecture_title, l.position,
                CASE 
                  WHEN e.is_visible = false THEN 'hidden_by_teacher'
                  WHEN e.show_at IS NOT NULL AND e.show_at > $3 THEN 'not_yet_visible'
                  WHEN e.hide_at IS NOT NULL AND e.hide_at < $3 THEN 'expired'
                  WHEN e.lock_next_lectures = false THEN 'lock_disabled'
                  ELSE 'should_block'
                END as reason
         FROM lectures l
         JOIN courses c ON c.id = l.course_id
         JOIN exams e ON e.lecture_id = l.id
         WHERE c.id = (SELECT course_id FROM lectures WHERE id = $1)
         AND ${studentCourseAccessSql('$2')}
         AND (l.position, COALESCE(l.created_at, '1970-01-01'::timestamp), l.id) <
             (SELECT position, COALESCE(created_at, '1970-01-01'::timestamp), id FROM lectures WHERE id = $1)
         ORDER BY l.position DESC, l.created_at DESC NULLS LAST, l.id DESC`,
        [lectureId, studentId, now],
      );

      console.log('Debug - All exams in previous lectures:', allExamsDebugResult.rows);
      return true; // لا توجد امتحانات تمنع الوصول أو الامتحانات غير مرئية للطالب
    }

    console.log('Debug - Blocking exams found:', blockingExamResult.rows);

    // فحص كل امتحان يمنع الوصول
    for (const examLecture of blockingExamResult.rows) {
      const canAccess = await this.canStudentAccessNextLectures(examLecture.lecture_id, studentId);
      console.log(`Debug - Exam ${examLecture.lecture_id} access check:`, canAccess);
      if (!canAccess) {
        console.log('Debug - Access denied due to exam:', examLecture.lecture_id);
        return false; // هناك امتحان لم ينجح فيه الطالب بعد
      }
    }

    console.log('Debug - All exams passed, access allowed');
    return true; // نجح في جميع الامتحانات المطلوبة
  }

  /**
   * الحصول على معلومات الامتحانات التي تمنع الوصول لمحاضرة معينة
   */
  static async getBlockingExamsForLecture(lectureId: number, studentId: number): Promise<any[]> {
    const now = new Date();

    console.log(`Debug - getBlockingExamsForLecture for lecture ${lectureId}:`);
    console.log('Debug - Student ID:', studentId);
    console.log('Debug - Current time:', now);

    const result = await pool.query(
      `SELECT e.id, e.title, e.total_grade, l.title as lecture_title, l.position,
              CASE 
                WHEN s.id IS NULL THEN 'not_taken'
                WHEN s.passed = true THEN 'passed'
                ELSE 'failed'
              END as exam_status,
              s.submitted_at, s.total_grade as student_grade
       FROM lectures l
       JOIN courses c ON c.id = l.course_id
       JOIN exams e ON e.lecture_id = l.id
       LEFT JOIN exam_submissions s ON s.exam_id = e.id AND s.student_id = $2
       WHERE c.id = (SELECT course_id FROM lectures WHERE id = $1)
       AND ${studentCourseAccessSql('$2')}
       AND (l.position, COALESCE(l.created_at, '1970-01-01'::timestamp), l.id) <
           (SELECT position, COALESCE(created_at, '1970-01-01'::timestamp), id FROM lectures WHERE id = $1)
       AND e.lock_next_lectures = true
       AND e.is_visible = true
       AND (e.show_at IS NULL OR e.show_at <= $3)
       AND (e.hide_at IS NULL OR e.hide_at >= $3)
       ORDER BY l.position DESC, l.created_at DESC NULLS LAST, l.id DESC`,
      [lectureId, studentId, now],
    );

    console.log('Debug - Blocking exams result:', result.rows.length);
    return result.rows;
  }

  /**
   * التحقق من إمكانية رؤية الامتحان للطالب حالياً
   */
  static async isExamVisibleToStudent(examId: number, studentId: number): Promise<boolean> {
    const now = new Date();

    const result = await pool.query(
      `SELECT e.id FROM exams e
       JOIN lectures l ON l.id = e.lecture_id
       JOIN courses c ON c.id = l.course_id
       WHERE e.id = $1 
       AND ${studentCourseAccessSql('$2')}
       AND e.is_visible = true
       AND (e.show_at IS NULL OR e.show_at <= $3)
       AND (e.hide_at IS NULL OR e.hide_at >= $3)`,
      [examId, studentId, now],
    );

    return result.rowCount! > 0;
  }

  /**
   * التحقق من إمكانية إظهار الإجابات للطالب
   */
  static async canStudentSeeAnswers(examId: number, studentId: number): Promise<boolean> {
    const result = await pool.query(
      `SELECT e.show_answers_immediately, e.show_answers_after_hours,
              s.submitted_at
       FROM exams e
       LEFT JOIN exam_submissions s ON s.exam_id = e.id AND s.student_id = $2
       WHERE e.id = $1`,
      [examId, studentId],
    );

    if (result.rowCount === 0) {
      return false;
    }

    const exam = result.rows[0];

    if (exam.show_answers_immediately) {
      return true;
    }

    if (!exam.submitted_at) {
      return false; // لم يخضع للامتحان بعد
    }

    const hoursSinceSubmission =
      (Date.now() - new Date(exam.submitted_at).getTime()) / (1000 * 60 * 60);
    return hoursSinceSubmission >= exam.show_answers_after_hours;
  }
}
