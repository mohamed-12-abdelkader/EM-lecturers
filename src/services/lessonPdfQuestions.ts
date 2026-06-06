/**
 * نظام مستقل لاستيراد أسئلة من ملف PDF إلى درس في بنك الأسئلة.
 * لا يعدل أي مسار أو جدول أسئلة موجود.
 * كل صفحة PDF → سؤال واحد من نوع image_mcq (صورة السؤال، correct_answer = null).
 */
import pool from '../db/pool';
import * as path from 'path';
import * as fs from 'node:fs';
import { uploadBufferToCloudinary } from '../utils';

const UPLOADS_DIR = path.join(__dirname, '../../uploads');

export interface LessonPdfQuestionRow {
  id: number;
  lesson_id: number;
  image_url: string;
  correct_answer: string | null;
  order_index: number;
  source_file_name: string | null;
  created_at: Date;
}

export class LessonPdfQuestionsService {
  /** التحقق من وجود الدرس وصلاحية المدرس (بنك الأسئلة) */
  static async verifyLessonForPdf(lessonId: number, userId: number, userRole?: string): Promise<void> {
    const res = await pool.query(
      `SELECT l.id, c.subject_id, s.question_bank_id
       FROM lessons l
       JOIN chapters c ON l.chapter_id = c.id
       JOIN subjects s ON c.subject_id = s.id
       WHERE l.id = $1`,
      [lessonId],
    );
    if (!res.rowCount) {
      const err: Error & { status?: number } = new Error('الدرس غير موجود في بنك الأسئلة');
      err.status = 404;
      throw err;
    }
    if (userRole === 'admin') return;
    const perm = await pool.query(
      `SELECT 1 FROM teacher_permissions
       WHERE teacher_id = $1 AND subject_id = $2 AND question_bank_id = $3 AND is_active = true`,
      [userId, res.rows[0].subject_id, res.rows[0].question_bank_id],
    );
    if (!perm.rowCount) {
      const err: Error & { status?: number } = new Error('ليس لديك صلاحية لإضافة أسئلة لهذا الدرس');
      err.status = 403;
      throw err;
    }
  }

  /**
   * تحويل ملف PDF إلى مصفوفة صور (buffer لكل صفحة).
   * يستخدم pdf-to-img (لا OCR).
   */
  static async pdfPagesToImageBuffers(pdfPath: string): Promise<Buffer[]> {
    let pdfModule: { pdf: (path: string, opts?: { scale?: number }) => AsyncIterable<Buffer> };
    try {
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
      pdfModule = await import('pdf-to-img');
    } catch (e: any) {
      if (e?.code === 'ERR_MODULE_NOT_FOUND' || e?.message?.includes("Cannot find package 'pdf-to-img'")) {
        const err: Error & { status?: number } = new Error(
          'الحزمة pdf-to-img غير مثبتة. نفّذ في مجلد المشروع: pnpm add pdf-to-img',
        );
        err.status = 503;
        throw err;
      }
      throw e;
    }
    const pdf = pdfModule.pdf;
    const doc = await pdf(pdfPath, { scale: 2 });
    const buffers: Buffer[] = [];
    for await (const image of doc) {
      buffers.push(image as Buffer);
    }
    return buffers;
  }

  /**
   * استيراد PDF لدرس: كل صفحة → سؤال image_mcq (صورة واحدة، correct_answer = null).
   */
  static async importPdfForLesson(
    lessonId: number,
    pdfPath: string,
    sourceFileName: string,
    userId: number,
    userRole?: string,
  ): Promise<{ imported: number; questions: LessonPdfQuestionRow[] }> {
    await this.verifyLessonForPdf(lessonId, userId, userRole);
    const buffers = await this.pdfPagesToImageBuffers(pdfPath);
    if (buffers.length === 0) {
      const err: Error & { status?: number } = new Error('الملف لا يحتوي على صفحات');
      err.status = 400;
      throw err;
    }
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    const prefix = `pdf-${Date.now()}`;
    const questions: LessonPdfQuestionRow[] = [];
    for (let i = 0; i < buffers.length; i++) {
      const filename = `${prefix}-page-${i + 1}.png`;
      const uploaded = await uploadBufferToCloudinary(buffers[i], filename, { resource_type: 'image' });
      const insert = await pool.query(
        `INSERT INTO lesson_pdf_questions (lesson_id, image_url, correct_answer, order_index, source_file_name)
         VALUES ($1, $2, NULL, $3, $4)
         RETURNING id, lesson_id, image_url, correct_answer, order_index, source_file_name, created_at`,
        [lessonId, uploaded.secure_url, i, sourceFileName],
      );
      questions.push(insert.rows[0] as LessonPdfQuestionRow);
    }
    return { imported: questions.length, questions };
  }

  /** جلب أسئلة PDF لدرس (النظام المستقل فقط) */
  static async getByLesson(lessonId: number): Promise<LessonPdfQuestionRow[]> {
    const res = await pool.query(
      `SELECT id, lesson_id, image_url, correct_answer, order_index, source_file_name, created_at
       FROM lesson_pdf_questions
       WHERE lesson_id = $1
       ORDER BY order_index ASC, id ASC`,
      [lessonId],
    );
    return res.rows as LessonPdfQuestionRow[];
  }

  /** تحديث الإجابة الصحيحة لسؤال PDF (يُحدد لاحقاً) */
  static async setCorrectAnswer(
    questionId: number,
    correctAnswer: string,
    userId: number,
    userRole?: string,
  ): Promise<LessonPdfQuestionRow> {
    const valid = ['أ', 'ب', 'ج', 'د', 'A', 'B', 'C', 'D'];
    if (!valid.includes(correctAnswer)) {
      const err: Error & { status?: number } = new Error('الإجابة الصحيحة يجب أن تكون أحد: أ، ب، ج، د');
      err.status = 400;
      throw err;
    }
    const row = await pool.query(
      `SELECT q.id, q.lesson_id FROM lesson_pdf_questions q WHERE q.id = $1`,
      [questionId],
    );
    if (!row.rowCount) {
      const err: Error & { status?: number } = new Error('السؤال غير موجود');
      err.status = 404;
      throw err;
    }
    await this.verifyLessonForPdf(row.rows[0].lesson_id, userId, userRole);
    const up = await pool.query(
      `UPDATE lesson_pdf_questions SET correct_answer = $1 WHERE id = $2
       RETURNING id, lesson_id, image_url, correct_answer, order_index, source_file_name, created_at`,
      [correctAnswer, questionId],
    );
    return up.rows[0] as LessonPdfQuestionRow;
  }
}
