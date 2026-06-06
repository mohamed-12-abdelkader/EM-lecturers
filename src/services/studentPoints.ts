import pool from '../db/pool';

export class StudentPointsService {
  // إضافة نقاط للطالب
  static async addPoints(
    userId: number,
    points: number,
    sourceType: 'lecture_watched' | 'exam_solved',
    sourceId?: number,
    description?: string,
  ): Promise<number> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // إنشاء أو تحديث سجل النقاط
      const result = await client.query(
        `INSERT INTO student_points (user_id, total_points)
         VALUES ($1, $2)
         ON CONFLICT (user_id) 
         DO UPDATE SET 
           total_points = student_points.total_points + $2,
           updated_at = NOW()
         RETURNING total_points`,
        [userId, points],
      );

      const newTotalPoints = result.rows[0].total_points;

      // إضافة سجل في التاريخ
      await client.query(
        `INSERT INTO student_points_history (user_id, points, source_type, source_id, description)
         VALUES ($1, $2, $3, $4, $5)`,
        [userId, points, sourceType, sourceId || null, description || null],
      );

      await client.query('COMMIT');
      return parseInt(newTotalPoints);
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error adding points:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  // حساب نقاط الامتحان بناءً على النسبة (من 20 نقطة)
  static calculateExamPoints(obtainedGrade: number, totalGrade: number): number {
    if (totalGrade === 0) return 0;
    const percentage = (obtainedGrade / totalGrade) * 100;
    // حساب النقاط من 20 حسب النسبة
    const points = Math.round((percentage / 100) * 20);
    return points;
  }

  // إضافة نقاط لمشاهدة محاضرة (10 نقاط)
  static async addLectureWatchPoints(
    userId: number,
    lectureId: number,
    lectureTitle?: string,
  ): Promise<number> {
    const points = 10;
    const description = lectureTitle
      ? `مشاهدة محاضرة: ${lectureTitle}`
      : `مشاهدة محاضرة #${lectureId}`;
    return await this.addPoints(userId, points, 'lecture_watched', lectureId, description);
  }

  // إضافة نقاط لحل امتحان (من 20 نقطة حسب النسبة)
  static async addExamPoints(
    userId: number,
    examId: number,
    obtainedGrade: number,
    totalGrade: number,
    examTitle?: string,
    examType: 'lecture_exam' | 'course_exam' = 'lecture_exam',
  ): Promise<number> {
    const points = this.calculateExamPoints(obtainedGrade, totalGrade);
    const description = examTitle
      ? `حل امتحان: ${examTitle} (${obtainedGrade}/${totalGrade})`
      : `حل امتحان #${examId} (${obtainedGrade}/${totalGrade})`;
    return await this.addPoints(userId, points, 'exam_solved', examId, description);
  }

  // جلب نقاط الطالب
  static async getStudentPoints(userId: number): Promise<{
    total_points: number;
    last_reset_at: Date | null;
    created_at: Date;
    updated_at: Date;
  } | null> {
    const result = await pool.query(
      'SELECT total_points, last_reset_at, created_at, updated_at FROM student_points WHERE user_id = $1',
      [userId],
    );

    if (!result.rowCount) {
      // إنشاء سجل جديد بصفر نقاط
      await pool.query(
        'INSERT INTO student_points (user_id, total_points) VALUES ($1, 0) ON CONFLICT DO NOTHING',
        [userId],
      );
      return {
        total_points: 0,
        last_reset_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      };
    }

    return {
      total_points: parseInt(result.rows[0].total_points),
      last_reset_at: result.rows[0].last_reset_at,
      created_at: result.rows[0].created_at,
      updated_at: result.rows[0].updated_at,
    };
  }

  // إعادة النقاط لصفر (للأدمن)
  static async resetPoints(userId: number, resetBy: number): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // جلب النقاط الحالية
      const currentPoints = await client.query(
        'SELECT total_points FROM student_points WHERE user_id = $1',
        [userId],
      );

      if (currentPoints.rowCount && currentPoints.rows[0].total_points > 0) {
        // تحديث النقاط لصفر
        await client.query(
          `UPDATE student_points 
           SET total_points = 0, 
               last_reset_at = NOW(),
               updated_at = NOW()
           WHERE user_id = $1`,
          [userId],
        );

        // إضافة سجل في التاريخ
        await client.query(
          `INSERT INTO student_points_history (user_id, points, source_type, description)
           VALUES ($1, $2, 'admin_reset', $3)`,
          [
            userId,
            -parseInt(currentPoints.rows[0].total_points),
            `إعادة النقاط لصفر بواسطة الأدمن #${resetBy}`,
          ],
        );
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error resetting points:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  // التحقق من أن الطالب لم يحصل على نقاط للمحاضرة من قبل
  static async hasLecturePoints(userId: number, lectureId: number): Promise<boolean> {
    const result = await pool.query(
      `SELECT COUNT(*) as count 
       FROM student_points_history 
       WHERE user_id = $1 AND source_type = 'lecture_watched' AND source_id = $2`,
      [userId, lectureId],
    );
    return parseInt(result.rows[0].count) > 0;
  }

  // التحقق من أن الطالب لم يحصل على نقاط للامتحان من قبل
  static async hasExamPoints(userId: number, examId: number): Promise<boolean> {
    const result = await pool.query(
      `SELECT COUNT(*) as count 
       FROM student_points_history 
       WHERE user_id = $1 AND source_type = 'exam_solved' AND source_id = $2`,
      [userId, examId],
    );
    return parseInt(result.rows[0].count) > 0;
  }
}
