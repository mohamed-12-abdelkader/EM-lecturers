import pool from '../db/pool';

export interface EssayExam {
  id: number;
  lecture_id: number;
  title: string;
  description?: string;
  is_visible: boolean;
  created_by: number;
  created_at: Date;
  updated_at: Date;
  questions_count?: number;
  students_count?: number;
}

export interface EssayQuestion {
  id: number;
  exam_id: number;
  question_text: string;
  order_index: number;
  created_at: Date;
}

export interface EssayAnswer {
  id: number;
  exam_id: number;
  student_id: number;
  question_id: number;
  answer_text: string;
  submitted_at: Date;
}

export interface EssayGrade {
  id: number;
  exam_id: number;
  student_id: number;
  total_grade: number;
  max_grade: number;
  graded_by: number;
  graded_at: Date;
  feedback?: string;
}

export class EssayExamService {
  /**
   * إنشاء امتحان مقالي جديد
   */
  static async createExam(
    lectureId: number,
    title: string,
    description: string | null,
    isVisible: boolean,
    createdBy: number,
  ): Promise<EssayExam> {
    const result = await pool.query(
      `INSERT INTO essay_exams (lecture_id, title, description, is_visible, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [lectureId, title, description, isVisible, createdBy],
    );
    return result.rows[0];
  }

  /**
   * تحديث امتحان مقالي
   */
  static async updateExam(
    examId: number,
    title: string,
    description: string | null,
    isVisible: boolean,
    updatedBy: number,
  ): Promise<EssayExam | null> {
    const result = await pool.query(
      `UPDATE essay_exams 
       SET title = $1, description = $2, is_visible = $3, updated_at = CURRENT_TIMESTAMP
       WHERE id = $4 AND created_by = $5
       RETURNING *`,
      [title, description, isVisible, examId, updatedBy],
    );
    return result.rows[0] || null;
  }

  /**
   * حذف امتحان مقالي
   */
  static async deleteExam(examId: number, createdBy: number): Promise<boolean> {
    const result = await pool.query('DELETE FROM essay_exams WHERE id = $1 AND created_by = $2', [
      examId,
      createdBy,
    ]);
    return result.rowCount! > 0;
  }

  /**
   * جلب امتحان مقالي بالتفصيل
   */
  static async getExamById(
    examId: number,
    userId: number,
    userRole: string,
  ): Promise<EssayExam | null> {
    let query = `
      SELECT e.*, 
             COUNT(DISTINCT q.id) as questions_count,
             COUNT(DISTINCT a.student_id) as students_count
      FROM essay_exams e
      LEFT JOIN essay_questions q ON e.id = q.exam_id
      LEFT JOIN essay_answers a ON e.id = a.exam_id
      WHERE e.id = $1
    `;

    const params = [examId];

    // إذا كان المستخدم طالب، يرى فقط الامتحانات الظاهرة
    if (userRole === 'student') {
      query += ' AND e.is_visible = true';
    } else if (userRole === 'teacher') {
      // المدرس يرى فقط امتحاناته
      query += ' AND e.created_by = $2';
      params.push(userId);
    }

    query += ' GROUP BY e.id';

    const result = await pool.query(query, params);
    return result.rows[0] || null;
  }

  /**
   * جلب امتحانات محاضرة معينة
   */
  static async getExamsByLecture(
    lectureId: number,
    userId: number,
    userRole: string,
  ): Promise<EssayExam[]> {
    let query = `
      SELECT e.*, 
             COUNT(DISTINCT q.id) as questions_count,
             COUNT(DISTINCT a.student_id) as students_count
      FROM essay_exams e
      LEFT JOIN essay_questions q ON e.id = q.exam_id
      LEFT JOIN essay_answers a ON e.id = a.exam_id
      WHERE e.lecture_id = $1
    `;

    const params = [lectureId];

    // إذا كان المستخدم طالب، يرى فقط الامتحانات الظاهرة
    if (userRole === 'student') {
      query += ' AND e.is_visible = true';
    } else if (userRole === 'teacher') {
      // المدرس يرى فقط امتحاناته
      query += ' AND e.created_by = $2';
      params.push(userId);
    }

    query += ' GROUP BY e.id ORDER BY e.created_at DESC';

    const result = await pool.query(query, params);
    return result.rows;
  }

  /**
   * إضافة سؤال مقالي
   */
  static async addQuestion(
    examId: number,
    questionText: string,
    orderIndex: number,
    createdBy: number,
  ): Promise<EssayQuestion | null> {
    // التحقق من أن المستخدم هو منشئ الامتحان
    const examCheck = await pool.query(
      'SELECT id FROM essay_exams WHERE id = $1 AND created_by = $2',
      [examId, createdBy],
    );

    if (examCheck.rowCount === 0) {
      return null;
    }

    const result = await pool.query(
      `INSERT INTO essay_questions (exam_id, question_text, order_index)
       VALUES ($1, $2, $3) RETURNING *`,
      [examId, questionText, orderIndex],
    );
    return result.rows[0];
  }

  /**
   * تحديث سؤال مقالي
   */
  static async updateQuestion(
    questionId: number,
    questionText: string,
    orderIndex: number,
    createdBy: number,
  ): Promise<EssayQuestion | null> {
    const result = await pool.query(
      `UPDATE essay_questions 
       SET question_text = $1, order_index = $2
       FROM essay_exams e
       WHERE essay_questions.id = $3 
       AND essay_questions.exam_id = e.id 
       AND e.created_by = $4
       RETURNING essay_questions.*`,
      [questionText, orderIndex, questionId, createdBy],
    );
    return result.rows[0] || null;
  }

  /**
   * حذف سؤال مقالي
   */
  static async deleteQuestion(questionId: number, createdBy: number): Promise<boolean> {
    const result = await pool.query(
      `DELETE FROM essay_questions 
       USING essay_exams e
       WHERE essay_questions.id = $1 
       AND essay_questions.exam_id = e.id 
       AND e.created_by = $2`,
      [questionId, createdBy],
    );
    return result.rowCount! > 0;
  }

  /**
   * جلب أسئلة امتحان معين
   */
  static async getQuestionsByExam(examId: number): Promise<EssayQuestion[]> {
    const result = await pool.query(
      'SELECT * FROM essay_questions WHERE exam_id = $1 ORDER BY order_index, id',
      [examId],
    );
    return result.rows;
  }

  /**
   * إرسال إجابة طالب
   */
  static async submitAnswer(
    examId: number,
    studentId: number,
    questionId: number,
    answerText: string,
  ): Promise<EssayAnswer> {
    const result = await pool.query(
      `INSERT INTO essay_answers (exam_id, student_id, question_id, answer_text)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (exam_id, student_id, question_id)
       DO UPDATE SET answer_text = $4, submitted_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [examId, studentId, questionId, answerText],
    );
    return result.rows[0];
  }

  /**
   * جلب إجابات طالب على امتحان معين
   */
  static async getStudentAnswers(examId: number, studentId: number): Promise<EssayAnswer[]> {
    const result = await pool.query(
      `SELECT a.*, q.question_text, q.order_index
       FROM essay_answers a
       JOIN essay_questions q ON a.question_id = q.id
       WHERE a.exam_id = $1 AND a.student_id = $2
       ORDER BY q.order_index, q.id`,
      [examId, studentId],
    );
    return result.rows;
  }

  /**
   * جلب جميع الطلاب الذين حلوا امتحان معين
   */
  static async getStudentsWhoAnswered(examId: number, createdBy: number): Promise<any[]> {
    const result = await pool.query(
      `SELECT DISTINCT 
         u.id as student_id,
         u.name as student_name,
         u.email as student_email,
         COUNT(a.id) as answered_questions,
         COUNT(q.id) as total_questions,
         eg.total_grade,
         eg.max_grade,
         eg.graded_at,
         eg.feedback
       FROM users u
       JOIN essay_answers a ON u.id = a.student_id
       JOIN essay_questions q ON a.exam_id = q.exam_id
       LEFT JOIN essay_grades eg ON u.id = eg.student_id AND eg.exam_id = a.exam_id
       JOIN essay_exams e ON a.exam_id = e.id
       WHERE a.exam_id = $1 AND e.created_by = $2
       GROUP BY u.id, u.name, u.email, eg.total_grade, eg.max_grade, eg.graded_at, eg.feedback
       ORDER BY u.name`,
      [examId, createdBy],
    );
    return result.rows;
  }

  /**
   * تصحيح إجابات طالب
   */
  static async gradeStudent(
    examId: number,
    studentId: number,
    totalGrade: number,
    maxGrade: number,
    feedback: string | null,
    gradedBy: number,
  ): Promise<EssayGrade> {
    const result = await pool.query(
      `INSERT INTO essay_grades (exam_id, student_id, total_grade, max_grade, graded_by, feedback)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (exam_id, student_id)
       DO UPDATE SET 
         total_grade = $3,
         max_grade = $4,
         graded_by = $5,
         feedback = $6,
         graded_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [examId, studentId, totalGrade, maxGrade, gradedBy, feedback],
    );
    return result.rows[0];
  }

  /**
   * جلب درجات طالب في امتحان معين
   */
  static async getStudentGrade(examId: number, studentId: number): Promise<EssayGrade | null> {
    const result = await pool.query(
      `SELECT eg.*, u.name as graded_by_name
       FROM essay_grades eg
       JOIN users u ON eg.graded_by = u.id
       WHERE eg.exam_id = $1 AND eg.student_id = $2`,
      [examId, studentId],
    );
    return result.rows[0] || null;
  }

  /**
   * جلب جميع درجات طالب
   */
  static async getStudentAllGrades(studentId: number): Promise<any[]> {
    const result = await pool.query(
      `SELECT eg.*, e.title as exam_title, l.title as lecture_title, c.title as course_title, u.name as graded_by_name
       FROM essay_grades eg
       JOIN essay_exams e ON eg.exam_id = e.id
       JOIN lectures l ON e.lecture_id = l.id
       JOIN courses c ON l.course_id = c.id
       JOIN users u ON eg.graded_by = u.id
       WHERE eg.student_id = $1
       ORDER BY eg.graded_at DESC`,
      [studentId],
    );
    return result.rows;
  }
}
