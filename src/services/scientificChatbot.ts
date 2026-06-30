import pool from '../db/pool';
import { MilvusService } from './milvusService';
import { EmbeddingService } from './embeddingService';
import { chunkText } from '../utils/textChunking';
import { config, logger } from '../utils';
import fs from 'fs/promises';
import path from 'path';


export interface CourseContentFile {
  id: number;
  course_id: number | null;
  teacher_id: number;
  file_name: string;
  file_path: string;
  file_size: number;
  file_type: string;
  content_text: string;
  uploaded_at: Date;
  updated_at: Date;
}

export interface ChatMessage {
  id: number;
  student_id: number;
  course_id: number | null;
  teacher_id: number | null;
  question: string;
  rewritten_question: string | null;
  answer: string;
  retrieved_chunks: any;
  images?: string[];
  created_at: Date;
}

export interface TeacherStudentChatSummary {
  student_id: number;
  student_name: string;
  student_avatar: string | null;
  course_id: number | null;
  course_name: string | null;
  message_count: number;
  last_question: string;
  last_answer: string;
  last_at: Date;
}

export interface TeacherStudentChatMessage extends ChatMessage {
  student_name: string;
  student_avatar: string | null;
  course_name: string | null;
}

export class ScientificChatbotService {
  static readonly COLLECTION_NAME = 'course_content_vectors';
  private static readonly TEACHER_CONTENT_COURSE_ID = 0;
  private static readonly CHUNK_SIZE = 500;
  private static readonly CHUNK_OVERLAP = 0.15;

  /**
   * Initialize Milvus collection
   */
  static async initializeCollection(): Promise<void> {
    try {
      // Create collection
      await MilvusService.createCollection({
        collectionName: this.COLLECTION_NAME,
        dimension: EmbeddingService.EMBEDDING_DIMENSION,
        metricType: 'IP',
        consistencyLevel: 'Bounded',
      });

      logger.info('✅ Scientific chatbot collection initialized');
    } catch (error: any) {
      logger.error('Error initializing collection:', error.message);
      throw error;
    }
  }

  /**
   * Upload and process course content file.
   */
  static async uploadCourseFile(
    courseId: number,
    teacherId: number,
    fileName: string,
    filePath: string,
    fileSize: number,
    fileType: string,
    contentText: string,
  ): Promise<CourseContentFile & { embeddingUnavailable?: boolean }> {
    const result = await pool.query<CourseContentFile>(
      `INSERT INTO course_content_files 
       (course_id, teacher_id, file_name, file_path, file_size, file_type, content_text)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [courseId, teacherId, fileName, filePath, fileSize, fileType, contentText],
    );

    const file = result.rows[0];

    try {
      await this.processAndStoreEmbeddings(file.id, courseId, teacherId, contentText);
      logger.info(`✅ Uploaded and processed file: ${fileName} for course ${courseId}`);
      return file;
    } catch (embeddingError: any) {
      const msg = embeddingError?.message ?? '';
      const isEmbeddingUnavailable =
        msg.includes('OpenAI Embedding API error') ||
        msg.includes('OPENAI_API_KEY') ||
        msg.includes('502') ||
        msg.includes('503') ||
        msg.includes('Bad Gateway') ||
        msg.includes('UNAVAILABLE') ||
        msg.includes('No connection');
      if (isEmbeddingUnavailable) {
        logger.warn(
          `Embedding service unavailable during upload (fileId=${file.id}). File saved; use "Reset embeddings" when OpenAI/Milvus is back.`,
          embeddingError?.message,
        );
        return { ...file, embeddingUnavailable: true };
      }
      logger.error('Error uploading course file:', embeddingError?.message);
      throw embeddingError;
    }
  }

  static async uploadTeacherFile(
    teacherId: number,
    fileName: string,
    filePath: string,
    fileSize: number,
    fileType: string,
    contentText: string,
  ): Promise<CourseContentFile & { embeddingUnavailable?: boolean }> {
    const result = await pool.query<CourseContentFile>(
      `INSERT INTO course_content_files
       (course_id, teacher_id, file_name, file_path, file_size, file_type, content_text)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [null, teacherId, fileName, filePath, fileSize, fileType, contentText],
    );

    const file = result.rows[0];

    try {
      await this.processAndStoreEmbeddings(
        file.id,
        this.TEACHER_CONTENT_COURSE_ID,
        teacherId,
        contentText,
      );
      logger.info(`✅ Uploaded and processed teacher-level file: ${fileName}`);
      return file;
    } catch (embeddingError: any) {
      const msg = embeddingError?.message ?? '';
      const isEmbeddingUnavailable =
        msg.includes('OpenAI Embedding API error') ||
        msg.includes('OPENAI_API_KEY') ||
        msg.includes('502') ||
        msg.includes('503') ||
        msg.includes('Bad Gateway') ||
        msg.includes('UNAVAILABLE') ||
        msg.includes('No connection');
      if (isEmbeddingUnavailable) {
        logger.warn(
          `Embedding service unavailable during teacher-level upload (fileId=${file.id}). File saved; use "Reset embeddings" when OpenAI/Milvus is back.`,
          embeddingError?.message,
        );
        return { ...file, embeddingUnavailable: true };
      }
      logger.error('Error uploading teacher-level file:', embeddingError?.message);
      throw embeddingError;
    }
  }

  /**
   * Process text and store embeddings in Milvus
   */
  private static async processAndStoreEmbeddings(
    fileId: number,
    courseId: number,
    teacherId: number,
    text: string,
  ): Promise<void> {
    try {
      const chunkTexts = chunkText(text, this.CHUNK_SIZE, this.CHUNK_OVERLAP);
      if (chunkTexts.length === 0) {
        logger.warn(`No chunks generated for file ${fileId}`);
        return;
      }

      const embeddings = await EmbeddingService.generateEmbeddings(chunkTexts);

      const milvusData = chunkTexts.map((chunk, index) => ({
        chunk_text: chunk,
        vector: embeddings[index],
        teacher_id: teacherId,
        course_id: courseId,
        file_id: fileId,
        chunk_index: index,
      }));

      await MilvusService.insertChunks(this.COLLECTION_NAME, milvusData);
      logger.info(`✅ Stored ${chunkTexts.length} chunks for file ${fileId}`);
    } catch (error: any) {
      logger.error('Error processing embeddings:', error.message);
      throw error;
    }
  }

  /**
   * List course content files
   */
  static async listCourseFiles(courseId: number, teacherId?: number): Promise<CourseContentFile[]> {
    try {
      let query = `SELECT * FROM course_content_files WHERE course_id = $1`;
      const params: any[] = [courseId];

      if (teacherId) {
        query += ` AND teacher_id = $2`;
        params.push(teacherId);
      }

      query += ` ORDER BY uploaded_at DESC`;

      const result = await pool.query<CourseContentFile>(query, params);
      return result.rows;
    } catch (error: any) {
      logger.error('Error listing course files:', error.message);
      throw error;
    }
  }

  static async listTeacherFiles(teacherId: number): Promise<CourseContentFile[]> {
    try {
      const result = await pool.query<CourseContentFile>(
        `SELECT * FROM course_content_files WHERE teacher_id = $1 AND course_id IS NULL ORDER BY uploaded_at DESC`,
        [teacherId],
      );
      return result.rows;
    } catch (error: any) {
      logger.error('Error listing teacher files:', error.message);
      throw error;
    }
  }

  /**
   * Reset embeddings for a course
   */
  static async resetCourseEmbeddings(courseId: number, teacherId: number): Promise<void> {
    try {
      await MilvusService.deleteCourseChunks(this.COLLECTION_NAME, teacherId, courseId);
      const files = await this.listCourseFiles(courseId, teacherId);
      for (const file of files) {
        if (file.content_text) {
          await this.processAndStoreEmbeddings(file.id, courseId, teacherId, file.content_text);
        }
      }
      logger.info(`✅ Reset embeddings for course ${courseId}`);
    } catch (error: any) {
      logger.error('Error resetting embeddings:', error.message);
      throw error;
    }
  }

  static async resetTeacherEmbeddings(teacherId: number): Promise<void> {
    try {
      await MilvusService.deleteTeacherChunks(this.COLLECTION_NAME, teacherId);

      // We re-process all teacher files AND course files because deleteTeacherChunks removes all chunks for a teacher
      const files = await pool.query<CourseContentFile>(`SELECT * FROM course_content_files WHERE teacher_id = $1`, [teacherId]);
      for (const file of files.rows) {
        if (file.content_text) {
          await this.processAndStoreEmbeddings(
            file.id,
            file.course_id ?? this.TEACHER_CONTENT_COURSE_ID,
            teacherId,
            file.content_text,
          );
        }
      }
      logger.info(`✅ Reset embeddings for teacher ${teacherId}`);
    } catch (error: any) {
      logger.error('Error resetting teacher embeddings:', error.message);
      throw error;
    }
  }

  /**
   * Delete course content file.
   */
  static async deleteCourseFile(
    fileId: number,
    teacherId: number,
  ): Promise<{ milvusUnavailable?: boolean }> {
    const result: { milvusUnavailable?: boolean } = {};
    const fileResult = await pool.query<CourseContentFile>(
      `SELECT * FROM course_content_files WHERE id = $1 AND teacher_id = $2`,
      [fileId, teacherId],
    );

    if (fileResult.rows.length === 0) {
      throw new Error('File not found or access denied');
    }

    const file = fileResult.rows[0];

    try {
      await MilvusService.deleteFileChunks(this.COLLECTION_NAME, teacherId, fileId);
    } catch (milvusError: any) {
      const isUnavailable =
        milvusError?.code === 14 ||
        milvusError?.message?.includes('UNAVAILABLE') ||
        milvusError?.message?.includes('No connection');
      if (isUnavailable) {
        logger.warn(
          `Milvus unavailable during file delete (fileId=${fileId}). File removed from DB.`,
        );
        result.milvusUnavailable = true;
      } else {
        throw milvusError;
      }
    }

    try {
      await fs.unlink(file.file_path);
    } catch (_fsError) {
      logger.warn(`Could not delete physical file: ${file.file_path}`);
    }

    await pool.query(`DELETE FROM course_content_files WHERE id = $1`, [fileId]);
    logger.info(`✅ Deleted file ${fileId}`);
    return result;
  }

  static async rewriteQuestion(
    currentQuestion: string,
    previousQuestions: string[],
  ): Promise<string> {
    try {
      if (previousQuestions.length === 0) return currentQuestion;

      const systemPrompt = `You are a question rewriter. Convert the user's latest question into a fully standalone question using previous questions ONLY if it depends on them.
Previous questions:
${previousQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n')}
Latest question: ${currentQuestion}
Standalone question:`;

      const response = await fetch(`${config.DEEPSEEK_API_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.DEEPSEEK_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: currentQuestion }],
          temperature: 0.3,
          max_tokens: 200,
        }),
      });

      if (!response.ok) throw new Error(`DeepSeek API error: ${response.status}`);
      const data = (await response.json()) as any;
      return data.choices[0]?.message?.content?.trim() || currentQuestion;
    } catch (error: any) {
      logger.error('Error rewriting question:', error.message);
      return currentQuestion;
    }
  }

  static async getRecentQuestions(studentId: number, courseId: number, limit: number = 2): Promise<string[]> {
    try {
      const result = await pool.query<ChatMessage>(
        `SELECT question FROM scientific_chat_history WHERE student_id = $1 AND course_id = $2 ORDER BY created_at DESC LIMIT $3`,
        [studentId, courseId, limit],
      );
      return result.rows.map((row) => row.question).reverse();
    } catch (error: any) {
      logger.error('Error getting recent questions:', error.message);
      return [];
    }
  }

  static async getRecentTeacherQuestions(studentId: number, teacherId: number, limit: number = 2): Promise<string[]> {
    try {
      const result = await pool.query<ChatMessage>(
        `SELECT question FROM scientific_chat_history WHERE student_id = $1 AND teacher_id = $2 ORDER BY created_at DESC LIMIT $3`,
        [studentId, teacherId, limit],
      );
      return result.rows.map((row) => row.question).reverse();
    } catch (error: any) {
      logger.error('Error getting recent teacher questions:', error.message);
      return [];
    }
  }

  static async studentHasTeacherSubscription(studentId: number, teacherId: number): Promise<boolean> {
    try {
      const result = await pool.query(
        `SELECT 1 FROM enrollments e JOIN courses c ON c.id = e.course_id WHERE e.user_id = $1 AND c.teacher_id = $2 LIMIT 1`,
        [studentId, teacherId],
      );
      return (result.rowCount ?? 0) > 0;
    } catch (error: any) {
      logger.error('Error checking teacher subscription:', error.message);
      return false;
    }
  }

  static async teacherHasAnyCourse(teacherId: number): Promise<boolean> {
    try {
      const result = await pool.query(`SELECT 1 FROM courses WHERE teacher_id = $1 LIMIT 1`, [teacherId]);
      return (result.rowCount ?? 0) > 0;
    } catch (error: any) {
      logger.error('Error checking teacher courses:', error.message);
      return false;
    }
  }

  private static isServiceUnavailableError(error: any): boolean {
    const msg = error?.message ?? '';
    return (
      msg.includes('OpenAI Embedding API error') ||
      msg.includes('OPENAI_API_KEY') ||
      msg.includes('502') ||
      msg.includes('503') ||
      msg.includes('Bad Gateway') ||
      msg.includes('UNAVAILABLE') ||
      msg.includes('No connection')
    );
  }

  static async answerQuestion(
    studentId: number,
    courseId: number,
    question: string,
    images: string[] = [],
  ): Promise<{ answer: string; retrievedChunks: any[] }> {
    try {
      const recentQuestions = await this.getRecentQuestions(studentId, courseId, 2);
      const rewrittenQuestion = await this.rewriteQuestion(question, recentQuestions);

      let questionEmbedding: number[];
      try {
        questionEmbedding = await EmbeddingService.generateEmbedding(rewrittenQuestion);
      } catch (embedError: any) {
        if (this.isServiceUnavailableError(embedError)) {
          return {
            answer: 'محتوى المادة متوفر، لكن خدمة الإجابة الآلية غير متاحة مؤقتاً. يرجى المحاولة بعد قليل أو إخبار المدرس.',
            retrievedChunks: [],
          };
        }
        throw embedError;
      }

      const courseResult = await pool.query(`SELECT teacher_id FROM courses WHERE id = $1`, [courseId]);
      if (courseResult.rows.length === 0) throw new Error('Course not found');
      const teacherId = courseResult.rows[0].teacher_id;

      let similarChunks: any[];
      try {
        similarChunks = await MilvusService.searchSimilarChunks(this.COLLECTION_NAME, questionEmbedding, teacherId, courseId, 3);
      } catch (milvusError: any) {
        if (this.isServiceUnavailableError(milvusError)) {
          return {
            answer: 'محتوى المادة متوفر، لكن خدمة الإجابة الآلية غير متاحة مؤقتاً. يرجى المحاولة بعد قليل أو إخبار المدرس.',
            retrievedChunks: [],
          };
        }
        throw milvusError;
      }

      if (similarChunks.length === 0) {
        return { answer: 'لا يمكنني العثور على هذه المعلومات في مواد الدورة التدريبية.', retrievedChunks: [] };
      }

      const retrievedChunksText = similarChunks.map((chunk, index) => `[${index + 1}]\n${chunk.chunk_text}`).join('\n\n');
      const ragPrompt = `You are an educational scientific tutor for the EM-Academy platform.
Answer in the SAME language as the student's question.
Use ONLY the provided study material to determine the answer. Do NOT add explanations unless asked.

Study Material:
${retrievedChunksText}

Question:
${rewrittenQuestion}`;

      let response: Response;
      if (images && images.length > 0) {
        const mistralConfig = { apiBaseUrl: config.MISTRAL_API_BASE_URL, apiKey: config.MISTRAL_API_KEY };
        const contentArr: any[] = [{ type: 'text', text: rewrittenQuestion }];
        for (const imgPath of images) {
          try {
            const buffer = await fs.readFile(imgPath);
            const base64 = buffer.toString('base64');
            const mimeType = imgPath.endsWith('.png') ? 'image/png' : imgPath.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
            contentArr.push({ type: 'image_url', image_url: `data:${mimeType};base64,${base64}` });
          } catch (err: any) {
            logger.warn(`Could not read image ${imgPath}:`, err.message);
          }
        }
        response = await fetch(`${mistralConfig.apiBaseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${mistralConfig.apiKey}` },
          body: JSON.stringify({
            model: 'pixtral-12b-2409',
            messages: [{ role: 'system', content: ragPrompt }, { role: 'user', content: contentArr }],
            temperature: 0.7,
            max_tokens: 1000,
          }),
        });
      } else {
        response = await fetch(`${config.DEEPSEEK_API_URL}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.DEEPSEEK_API_KEY}` },
          body: JSON.stringify({
            model: 'deepseek-chat',
            messages: [{ role: 'system', content: ragPrompt }, { role: 'user', content: rewrittenQuestion }],
            temperature: 0.7,
            max_tokens: 1000,
          }),
        });
      }

      const data = (await response.json()) as any;
      const answer = data.choices[0]?.message?.content?.trim() || 'عذراً، لم أتمكن من إنشاء إجابة. يرجى المحاولة مرة أخرى.';

      await this.saveChatHistory(studentId, courseId, question, rewrittenQuestion, answer, similarChunks, images, teacherId);

      return {
        answer,
        retrievedChunks: similarChunks.map((chunk) => ({
          chunk_text: chunk.chunk_text,
          file_id: chunk.file_id,
          chunk_index: chunk.chunk_index,
        })),
      };
    } catch (error: any) {
      logger.error('Error answering question:', error.message);
      throw error;
    }
  }

  static async answerTeacherQuestion(
    studentId: number,
    teacherId: number,
    question: string,
    images: string[] = [],
  ): Promise<{ answer: string; retrievedChunks: any[] }> {
    try {
      const recentQuestions = await this.getRecentTeacherQuestions(studentId, teacherId, 2);
      const rewrittenQuestion = await this.rewriteQuestion(question, recentQuestions);

      let questionEmbedding: number[];
      try {
        questionEmbedding = await EmbeddingService.generateEmbedding(rewrittenQuestion);
      } catch (embedError: any) {
        if (this.isServiceUnavailableError(embedError)) {
          return {
            answer: 'محتوى المادة متوفر، لكن خدمة الإجابة الآلية غير متاحة مؤقتاً. يرجى المحاولة بعد قليل أو إخبار المدرس.',
            retrievedChunks: [],
          };
        }
        throw embedError;
      }

      let similarChunks: any[];
      try {
        similarChunks = await MilvusService.searchSimilarChunksByTeacher(this.COLLECTION_NAME, questionEmbedding, teacherId, 3);
      } catch (milvusError: any) {
        if (this.isServiceUnavailableError(milvusError)) {
          return {
            answer: 'محتوى المادة متوفر، لكن خدمة الإجابة الآلية غير متاحة مؤقتاً. يرجى المحاولة بعد قليل أو إخبار المدرس.',
            retrievedChunks: [],
          };
        }
        throw milvusError;
      }

      if (similarChunks.length === 0) {
        return { answer: 'لا يمكنني العثور على هذه المعلومات في مواد الدورة التدريبية.', retrievedChunks: [] };
      }

      const retrievedChunksText = similarChunks.map((chunk, index) => `[${index + 1}]\n${chunk.chunk_text}`).join('\n\n');
      const ragPrompt = `You are an educational scientific tutor for the EM-Academy platform.
Answer in the SAME language as the student's question.
Use ONLY the provided study material to determine the answer. Do NOT add explanations unless asked.

Study Material:
${retrievedChunksText}

Question:
${rewrittenQuestion}`;

      let response: Response;
      if (images && images.length > 0) {
        const mistralConfig = { apiBaseUrl: config.MISTRAL_API_BASE_URL, apiKey: config.MISTRAL_API_KEY };
        const contentArr: any[] = [{ type: 'text', text: rewrittenQuestion }];
        for (const imgPath of images) {
          try {
            const buffer = await fs.readFile(imgPath);
            const base64 = buffer.toString('base64');
            const mimeType = imgPath.endsWith('.png') ? 'image/png' : imgPath.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
            contentArr.push({ type: 'image_url', image_url: `data:${mimeType};base64,${base64}` });
          } catch (err: any) {
            logger.warn(`Could not read image ${imgPath}:`, err.message);
          }
        }
        response = await fetch(`${mistralConfig.apiBaseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${mistralConfig.apiKey}` },
          body: JSON.stringify({
            model: 'pixtral-12b-2409',
            messages: [{ role: 'system', content: ragPrompt }, { role: 'user', content: contentArr }],
            temperature: 0.7,
            max_tokens: 1000,
          }),
        });
      } else {
        response = await fetch(`${config.DEEPSEEK_API_URL}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.DEEPSEEK_API_KEY}` },
          body: JSON.stringify({
            model: 'deepseek-chat',
            messages: [{ role: 'system', content: ragPrompt }, { role: 'user', content: rewrittenQuestion }],
            temperature: 0.7,
            max_tokens: 1000,
          }),
        });
      }

      const data = (await response.json()) as any;
      const answer = data.choices[0]?.message?.content?.trim() || 'عذراً، لم أتمكن من إنشاء إجابة. يرجى المحاولة مرة أخرى.';

      await this.saveChatHistory(studentId, null, question, rewrittenQuestion, answer, similarChunks, images, teacherId);

      return {
        answer,
        retrievedChunks: similarChunks.map((chunk) => ({
          chunk_text: chunk.chunk_text,
          file_id: chunk.file_id,
          chunk_index: chunk.chunk_index,
        })),
      };
    } catch (error: any) {
      logger.error('Error answering teacher question:', error.message);
      throw error;
    }
  }

  private static async saveChatHistory(
    studentId: number,
    courseId: number | null,
    question: string,
    rewrittenQuestion: string,
    answer: string,
    retrievedChunks: any[],
    images: string[] = [],
    teacherId: number | null = null,
  ): Promise<void> {
    try {
      await pool.query(
        `INSERT INTO scientific_chat_history 
         (student_id, course_id, question, rewritten_question, answer, retrieved_chunks, images, teacher_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [studentId, courseId, question, rewrittenQuestion, answer, JSON.stringify(retrievedChunks), JSON.stringify(images), teacherId],
      );
    } catch (error: any) {
      logger.error('Error saving chat history:', error.message);
    }
  }

  static async getChatHistory(studentId: number, courseId: number, limit: number = 50, beforeId?: number): Promise<ChatMessage[]> {
    try {
      let query = `SELECT * FROM scientific_chat_history WHERE student_id = $1 AND course_id = $2`;
      const params: any[] = [studentId, courseId, limit];
      if (beforeId) { query += ` AND id < $4`; params.push(beforeId); }
      query += ` ORDER BY id DESC LIMIT $3`;
      const result = await pool.query<ChatMessage>(query, params);
      return result.rows.reverse();
    } catch (error: any) {
      logger.error('Error getting chat history:', error.message);
      throw error;
    }
  }

  static async getTeacherChatHistory(studentId: number, teacherId: number, limit: number = 50, beforeId?: number): Promise<ChatMessage[]> {
    try {
      let query = `SELECT * FROM scientific_chat_history WHERE student_id = $1 AND teacher_id = $2 AND course_id IS NULL`;
      const params: any[] = [studentId, teacherId, limit];
      if (beforeId) { query += ` AND id < $4`; params.push(beforeId); }
      query += ` ORDER BY id DESC LIMIT $3`;
      const result = await pool.query<ChatMessage>(query, params);
      return result.rows.reverse();
    } catch (error: any) {
      logger.error('Error getting teacher chat history:', error.message);
      throw error;
    }
  }

  /**
   * List student ↔ AI chat threads for a teacher (summary for review dashboard).
   */
  static async listTeacherStudentChats(
    teacherId: number,
    options: {
      courseId?: number | null;
      studentId?: number;
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<TeacherStudentChatSummary[]> {
    const { courseId, studentId, limit = 30, offset = 0 } = options;

    try {
      const params: any[] = [teacherId];
      let scopeFilter = `((c.teacher_id = $1) OR (h.course_id IS NULL AND h.teacher_id = $1))`;

      if (studentId) {
        params.push(studentId);
        scopeFilter += ` AND h.student_id = $${params.length}`;
      }

      if (courseId === null) {
        scopeFilter += ` AND h.course_id IS NULL`;
      } else if (courseId !== undefined) {
        params.push(courseId);
        scopeFilter += ` AND h.course_id = $${params.length}`;
      }

      params.push(limit, offset);

      const result = await pool.query<TeacherStudentChatSummary>(
        `WITH scoped AS (
           SELECT
             h.*,
             u.name AS student_name,
             u.avatar AS student_avatar,
             c.title AS course_name
           FROM scientific_chat_history h
           JOIN users u ON u.id = h.student_id
           LEFT JOIN courses c ON c.id = h.course_id
           WHERE ${scopeFilter}
         ),
         with_stats AS (
           SELECT
             s.*,
             COUNT(*) OVER (PARTITION BY s.student_id, COALESCE(s.course_id, -1)) AS message_count,
             ROW_NUMBER() OVER (
               PARTITION BY s.student_id, COALESCE(s.course_id, -1)
               ORDER BY s.created_at DESC
             ) AS rn
           FROM scoped s
         )
         SELECT
           student_id,
           student_name,
           student_avatar,
           course_id,
           course_name,
           question AS last_question,
           answer AS last_answer,
           created_at AS last_at,
           message_count::int AS message_count
         FROM with_stats
         WHERE rn = 1
         ORDER BY created_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );

      return result.rows;
    } catch (error: any) {
      logger.error('Error listing teacher student chats:', error.message);
      throw error;
    }
  }

  /**
   * Get full Q&A history for a student thread visible to the teacher.
   * courseId omitted = all threads with this teacher; null = teacher-level scope only.
   */
  static async getTeacherViewStudentChatHistory(
    teacherId: number,
    studentId: number,
    options: {
      courseId?: number | null;
      limit?: number;
      beforeId?: number;
    } = {},
  ): Promise<TeacherStudentChatMessage[]> {
    const { courseId, limit = 50, beforeId } = options;

    const allowed = await this.teacherCanViewStudentChat(teacherId, studentId, courseId);
    if (!allowed) {
      throw new Error('Access denied');
    }

    try {
      const params: any[] = [studentId, teacherId];
      let query = `
        SELECT
          h.*,
          u.name AS student_name,
          u.avatar AS student_avatar,
          c.title AS course_name
        FROM scientific_chat_history h
        JOIN users u ON u.id = h.student_id
        LEFT JOIN courses c ON c.id = h.course_id
        WHERE h.student_id = $1
          AND ((c.teacher_id = $2) OR (h.course_id IS NULL AND h.teacher_id = $2))
      `;

      if (courseId === null) {
        query += ` AND h.course_id IS NULL`;
      } else if (courseId !== undefined) {
        params.push(courseId);
        query += ` AND h.course_id = $${params.length}`;
      }

      params.push(limit);
      if (beforeId) {
        params.push(beforeId);
        query += ` AND h.id < $${params.length}`;
      }

      query += ` ORDER BY h.id DESC LIMIT $${params.length - (beforeId ? 1 : 0)}`;

      const result = await pool.query<TeacherStudentChatMessage>(query, params);
      return result.rows.reverse();
    } catch (error: any) {
      logger.error('Error getting teacher view student chat history:', error.message);
      throw error;
    }
  }

  private static async teacherCanViewStudentChat(
    teacherId: number,
    studentId: number,
    courseId?: number | null,
  ): Promise<boolean> {
    try {
      if (typeof courseId === 'number') {
        const courseResult = await pool.query(
          `SELECT 1 FROM courses WHERE id = $1 AND teacher_id = $2 LIMIT 1`,
          [courseId, teacherId],
        );
        if ((courseResult.rowCount ?? 0) === 0) return false;
      }

      const params: any[] = [studentId, teacherId];
      let query = `
        SELECT 1
        FROM scientific_chat_history h
        LEFT JOIN courses c ON c.id = h.course_id
        WHERE h.student_id = $1
          AND ((c.teacher_id = $2) OR (h.course_id IS NULL AND h.teacher_id = $2))
      `;

      if (courseId === null) {
        query += ` AND h.course_id IS NULL`;
      } else if (typeof courseId === 'number') {
        params.push(courseId);
        query += ` AND h.course_id = $${params.length}`;
      }

      query += ` LIMIT 1`;
      const result = await pool.query(query, params);
      return (result.rowCount ?? 0) > 0;
    } catch (error: any) {
      logger.error('Error checking teacher chat access:', error.message);
      return false;
    }
  }

  static async courseHasContent(courseId: number): Promise<boolean> {
    try {
      const result = await pool.query(
        `SELECT COUNT(*) as count
         FROM course_content_files f
         JOIN courses c ON c.id = $1
         WHERE f.teacher_id = c.teacher_id
           AND (f.course_id = $1 OR f.course_id IS NULL)`,
        [courseId],
      );
      return parseInt(result.rows[0].count) > 0;
    } catch (error: any) {
      return false;
    }
  }

  static async teacherHasContent(teacherId: number): Promise<boolean> {
    try {
      const result = await pool.query(`SELECT COUNT(*) as count FROM course_content_files WHERE teacher_id = $1`, [teacherId]);
      return parseInt(result.rows[0].count) > 0;
    } catch (error: any) { return false; }
  }
}
