"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LessonPdfQuestionsService = void 0;
/**
 * نظام مستقل لاستيراد أسئلة من ملف PDF إلى درس في بنك الأسئلة.
 * لا يعدل أي مسار أو جدول أسئلة موجود.
 * كل صفحة PDF → سؤال واحد من نوع image_mcq (صورة السؤال، correct_answer = null).
 */
const pool_1 = __importDefault(require("../db/pool"));
const path = __importStar(require("path"));
const fs = __importStar(require("node:fs"));
const utils_1 = require("../utils");
const UPLOADS_DIR = path.join(__dirname, '../../uploads');
class LessonPdfQuestionsService {
    /** التحقق من وجود الدرس وصلاحية المدرس (بنك الأسئلة) */
    static async verifyLessonForPdf(lessonId, userId, userRole) {
        const res = await pool_1.default.query(`SELECT l.id, c.subject_id, s.question_bank_id
       FROM lessons l
       JOIN chapters c ON l.chapter_id = c.id
       JOIN subjects s ON c.subject_id = s.id
       WHERE l.id = $1`, [lessonId]);
        if (!res.rowCount) {
            const err = new Error('الدرس غير موجود في بنك الأسئلة');
            err.status = 404;
            throw err;
        }
        if (userRole === 'admin')
            return;
        const perm = await pool_1.default.query(`SELECT 1 FROM teacher_permissions
       WHERE teacher_id = $1 AND subject_id = $2 AND question_bank_id = $3 AND is_active = true`, [userId, res.rows[0].subject_id, res.rows[0].question_bank_id]);
        if (!perm.rowCount) {
            const err = new Error('ليس لديك صلاحية لإضافة أسئلة لهذا الدرس');
            err.status = 403;
            throw err;
        }
    }
    /**
     * تحويل ملف PDF إلى مصفوفة صور (buffer لكل صفحة).
     * يستخدم pdf-to-img (لا OCR).
     */
    static async pdfPagesToImageBuffers(pdfPath) {
        let pdfModule;
        try {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            pdfModule = await import('pdf-to-img');
        }
        catch (e) {
            if (e?.code === 'ERR_MODULE_NOT_FOUND' || e?.message?.includes("Cannot find package 'pdf-to-img'")) {
                const err = new Error('الحزمة pdf-to-img غير مثبتة. نفّذ في مجلد المشروع: pnpm add pdf-to-img');
                err.status = 503;
                throw err;
            }
            throw e;
        }
        const pdf = pdfModule.pdf;
        const doc = await pdf(pdfPath, { scale: 2 });
        const buffers = [];
        for await (const image of doc) {
            buffers.push(image);
        }
        return buffers;
    }
    /**
     * استيراد PDF لدرس: كل صفحة → سؤال image_mcq (صورة واحدة، correct_answer = null).
     */
    static async importPdfForLesson(lessonId, pdfPath, sourceFileName, userId, userRole) {
        await this.verifyLessonForPdf(lessonId, userId, userRole);
        const buffers = await this.pdfPagesToImageBuffers(pdfPath);
        if (buffers.length === 0) {
            const err = new Error('الملف لا يحتوي على صفحات');
            err.status = 400;
            throw err;
        }
        fs.mkdirSync(UPLOADS_DIR, { recursive: true });
        const prefix = `pdf-${Date.now()}`;
        const questions = [];
        for (let i = 0; i < buffers.length; i++) {
            const filename = `${prefix}-page-${i + 1}.png`;
            const uploaded = await (0, utils_1.uploadBufferToCloudinary)(buffers[i], filename, { resource_type: 'image' });
            const insert = await pool_1.default.query(`INSERT INTO lesson_pdf_questions (lesson_id, image_url, correct_answer, order_index, source_file_name)
         VALUES ($1, $2, NULL, $3, $4)
         RETURNING id, lesson_id, image_url, correct_answer, order_index, source_file_name, created_at`, [lessonId, uploaded.secure_url, i, sourceFileName]);
            questions.push(insert.rows[0]);
        }
        return { imported: questions.length, questions };
    }
    /** جلب أسئلة PDF لدرس (النظام المستقل فقط) */
    static async getByLesson(lessonId) {
        const res = await pool_1.default.query(`SELECT id, lesson_id, image_url, correct_answer, order_index, source_file_name, created_at
       FROM lesson_pdf_questions
       WHERE lesson_id = $1
       ORDER BY order_index ASC, id ASC`, [lessonId]);
        return res.rows;
    }
    /** تحديث الإجابة الصحيحة لسؤال PDF (يُحدد لاحقاً) */
    static async setCorrectAnswer(questionId, correctAnswer, userId, userRole) {
        const valid = ['أ', 'ب', 'ج', 'د', 'A', 'B', 'C', 'D'];
        if (!valid.includes(correctAnswer)) {
            const err = new Error('الإجابة الصحيحة يجب أن تكون أحد: أ، ب، ج، د');
            err.status = 400;
            throw err;
        }
        const row = await pool_1.default.query(`SELECT q.id, q.lesson_id FROM lesson_pdf_questions q WHERE q.id = $1`, [questionId]);
        if (!row.rowCount) {
            const err = new Error('السؤال غير موجود');
            err.status = 404;
            throw err;
        }
        await this.verifyLessonForPdf(row.rows[0].lesson_id, userId, userRole);
        const up = await pool_1.default.query(`UPDATE lesson_pdf_questions SET correct_answer = $1 WHERE id = $2
       RETURNING id, lesson_id, image_url, correct_answer, order_index, source_file_name, created_at`, [correctAnswer, questionId]);
        return up.rows[0];
    }
}
exports.LessonPdfQuestionsService = LessonPdfQuestionsService;
