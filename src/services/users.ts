import pool from '../db/pool';

export const getAllUsers = async () => {
  const res = await pool.query('SELECT id, name, email FROM users');
  return res.rows;
};

export const getUserById = async (id: string) => {
  const res = await pool.query('SELECT id, name, email FROM users WHERE id = $1', [id]);
  return res.rows[0];
};

export const createUser = async (name: string, email: string, passwordHash: string) => {
  const res = await pool.query(
    'INSERT INTO users (name, email, password) VALUES ($1, $2, $3) RETURNING id, name, email',
    [name, email, passwordHash],
  );
  return res.rows[0];
};

export const findUserByEmail = async (email: string) => {
  const res = await pool.query('SELECT id, name, email, password FROM users WHERE email = $1', [
    email,
  ]);
  return res.rows[0];
};

export class TeacherGradesService {
  static async setTeacherGrades(teacherId: number, gradeIds: number[]) {
    // احذف القديم
    await pool.query('DELETE FROM teacher_grades WHERE teacher_id = $1', [teacherId]);

    // تحقق من وجود الصفوف الدراسية قبل إدراجها
    for (const gradeId of gradeIds) {
      const gradeExists = await pool.query('SELECT id FROM grades WHERE id = $1', [gradeId]);
      if (gradeExists.rows.length === 0) {
        throw new Error(`الصف الدراسي برقم ${gradeId} غير موجود`);
      }
      await pool.query('INSERT INTO teacher_grades (teacher_id, grade_id) VALUES ($1, $2)', [
        teacherId,
        gradeId,
      ]);
    }
  }

  static async getTeacherGrades(teacherId: number) {
    const res = await pool.query(
      `SELECT DISTINCT g.id, g.name, g.slug, g.stage, g.status
       FROM grades g
       WHERE g.id IN (
         SELECT tg.grade_id
         FROM teacher_grades tg
         WHERE tg.teacher_id = $1
         UNION
         SELECT ug.grade_id
         FROM user_grades ug
         WHERE ug.user_id = $1
       )
       ORDER BY g.id`,
      [teacherId],
    );
    return res.rows;
  }
}
