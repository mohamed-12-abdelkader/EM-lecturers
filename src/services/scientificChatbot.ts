import pool from '../db/pool';
import { MilvusService } from './milvusService';
import { EmbeddingService } from './embeddingService';
import { chunkText } from '../utils/textChunking';
import { config, logger } from '../utils';
import fs from 'fs/promises';

export interface CourseContentFile {
  id: number;
  course_id: number;
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
  course_id: number;
  question: string;
  rewritten_question: string | null;
  answer: string;
  retrieved_chunks: any;
  images?: string[];
  created_at: Date;
}

export class ScientificChatbotService {
  private static readonly COLLECTION_NAME = 'course_content_vectors';
  private static readonly CHUNK_SIZE = 500;
  private static readonly CHUNK_OVERLAP = 0.15;

  /**
   * Initialize Milvus collection
   */
  static async initializeCollection(): Promise<void> {
    try {
      // Create database
      // Use "default" db
      // await MilvusService.createDatabase(config.MILVUS_DB_NAME);

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
   * If embedding service (Ollama) or Milvus is unavailable, file is still saved; returns embeddingUnavailable.
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
    // Save file metadata to SQL DB first (so file is stored even if embeddings fail)
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
        msg.includes('Ollama API error') ||
        msg.includes('502') ||
        msg.includes('503') ||
        msg.includes('Bad Gateway') ||
        msg.includes('UNAVAILABLE') ||
        msg.includes('No connection');
      if (isEmbeddingUnavailable) {
        logger.warn(
          `Embedding service unavailable during upload (fileId=${file.id}). File saved; use "Reset embeddings" when Ollama/Milvus is back.`,
          embeddingError?.message,
        );
        return { ...file, embeddingUnavailable: true };
      }
      logger.error('Error uploading course file:', embeddingError?.message);
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
      // Chunk the text
      const chunkTexts = chunkText(text, this.CHUNK_SIZE, this.CHUNK_OVERLAP);
      console.log("chunkTexts", chunkTexts);

      if (chunkTexts.length === 0) {
        logger.warn(`No chunks generated for file ${fileId}`);
        return;
      }

      // Generate embeddings for all chunks
      const embeddings = await EmbeddingService.generateEmbeddings(chunkTexts);
      console.log("embeddings", embeddings);

      // Prepare data for Milvus
      const milvusData = chunkTexts.map((chunk, index) => ({
        chunk_text: chunk,
        vector: embeddings[index],
        teacher_id: teacherId,
        course_id: courseId,
        file_id: fileId,
        chunk_index: index,
      }));
      console.log("milvusData", JSON.stringify(milvusData));

      // Insert into Milvus
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

  /**
   * Reset embeddings for a course (delete and regenerate)
   */
  static async resetCourseEmbeddings(courseId: number, teacherId: number): Promise<void> {
    try {
      // Delete existing embeddings from Milvus
      await MilvusService.deleteCourseChunks(this.COLLECTION_NAME, teacherId, courseId);

      // Get all files for this course
      const files = await this.listCourseFiles(courseId, teacherId);

      // Reprocess all files
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

  /**
   * Delete course content file.
   * If Milvus is unavailable, still removes file from DB and disk; returns milvusUnavailable so caller can warn.
   */
  static async deleteCourseFile(
    fileId: number,
    teacherId: number,
  ): Promise<{ milvusUnavailable?: boolean }> {
    const result: { milvusUnavailable?: boolean } = {};

    // Get file info
    const fileResult = await pool.query<CourseContentFile>(
      `SELECT * FROM course_content_files WHERE id = $1 AND teacher_id = $2`,
      [fileId, teacherId],
    );

    if (fileResult.rows.length === 0) {
      throw new Error('File not found or access denied');
    }

    const file = fileResult.rows[0];

    // Delete embeddings from Milvus (optional if Milvus is down)
    try {
      await MilvusService.deleteCourseChunks(this.COLLECTION_NAME, teacherId, file.course_id);

      // Reprocess remaining files for this course to restore embeddings (only when Milvus is up)
      const remainingFiles = await this.listCourseFiles(file.course_id, teacherId);
      const remainingAfterDelete = remainingFiles.filter((f) => f.id !== fileId);
      for (const remainingFile of remainingAfterDelete) {
        if (remainingFile.content_text) {
          await this.processAndStoreEmbeddings(
            remainingFile.id,
            remainingFile.course_id,
            teacherId,
            remainingFile.content_text,
          );
        }
      }
    } catch (milvusError: any) {
      const isUnavailable =
        milvusError?.code === 14 ||
        milvusError?.message?.includes('UNAVAILABLE') ||
        milvusError?.message?.includes('No connection');
      if (isUnavailable) {
        logger.warn(
          `Milvus unavailable during file delete (fileId=${fileId}). File removed from DB; run "Reset embeddings" for course ${file.course_id} when Milvus is back.`,
        );
        result.milvusUnavailable = true;
      } else {
        throw milvusError;
      }
    }

    // Delete physical file
    try {
      await fs.unlink(file.file_path);
    } catch (_fsError) {
      logger.warn(`Could not delete physical file: ${file.file_path}`);
    }

    // Delete from SQL DB (always, so the file is gone from the app)
    await pool.query(`DELETE FROM course_content_files WHERE id = $1`, [fileId]);

    logger.info(`✅ Deleted file ${fileId}`);
    return result;
  }

  /**
   * Rewrite question to be standalone using previous context
   */
  static async rewriteQuestion(
    currentQuestion: string,
    previousQuestions: string[],
  ): Promise<string> {
    try {
      if (previousQuestions.length === 0) {
        return currentQuestion; // Already standalone
      }

      const systemPrompt = `You are a question rewriter.

Task:
- Convert the user's latest question into a fully standalone question.
- Use previous questions ONLY if the latest question depends on them.
- If the latest question is already standalone, return it unchanged.
- Do NOT add new information.
- Do NOT answer the question.

Previous questions:
${previousQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n')}

Latest question:
${currentQuestion}

Standalone question:`;

      const response = await fetch(`${config.DEEPSEEK_API_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.DEEPSEEK_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: currentQuestion },
          ],
          temperature: 0.3,
          max_tokens: 200,
        }),
      });

      if (!response.ok) {
        throw new Error(`DeepSeek API error: ${response.status}`);
      }

      const data = (await response.json()) as any;
      const rewrittenQuestion = data.choices[0]?.message?.content?.trim() || currentQuestion;

      return rewrittenQuestion;
    } catch (error: any) {
      logger.error('Error rewriting question:', error.message);
      return currentQuestion; // Fallback to original
    }
  }

  /**
   * Get chat history for question rewriting
   */
  static async getRecentQuestions(
    studentId: number,
    courseId: number,
    limit: number = 2,
  ): Promise<string[]> {
    try {
      const result = await pool.query<ChatMessage>(
        `SELECT question FROM scientific_chat_history
         WHERE student_id = $1 AND course_id = $2
         ORDER BY created_at DESC
         LIMIT $3`,
        [studentId, courseId, limit],
      );

      return result.rows.map((row) => row.question).reverse(); // Reverse to get chronological order
    } catch (error: any) {
      logger.error('Error getting recent questions:', error.message);
      return [];
    }
  }

  /** Detect if error is due to embedding/Milvus service being unavailable (502, 503, etc.) */
  private static isServiceUnavailableError(error: any): boolean {
    const msg = error?.message ?? '';
    return (
      msg.includes('Ollama API error') ||
      msg.includes('502') ||
      msg.includes('503') ||
      msg.includes('Bad Gateway') ||
      msg.includes('UNAVAILABLE') ||
      msg.includes('No connection')
    );
  }

  /**
   * Answer student question using RAG
   */
  static async answerQuestion(
    studentId: number,
    courseId: number,
    question: string,
    images: string[] = [],
  ): Promise<{ answer: string; retrievedChunks: any[] }> {
    try {
      // Get recent questions for rewriting
      const recentQuestions = await this.getRecentQuestions(studentId, courseId, 2);
      console.log('Recent questions:', recentQuestions);

      // Rewrite question to be standalone
      const rewrittenQuestion = await this.rewriteQuestion(question, recentQuestions);
      console.log('Rewritten question:', rewrittenQuestion);

      // Generate embedding for the question
      let questionEmbedding: number[];
      try {
        questionEmbedding = await EmbeddingService.generateEmbedding(rewrittenQuestion);
      } catch (embedError: any) {
        if (this.isServiceUnavailableError(embedError)) {
          logger.warn('Embedding service unavailable in answerQuestion:', embedError?.message);
          return {
            answer:
              'محتوى المادة متوفر، لكن خدمة الإجابة الآلية غير متاحة مؤقتاً. يرجى المحاولة بعد قليل أو إخبار المدرس.',
            retrievedChunks: [],
          };
        }
        throw embedError;
      }
      console.log('Question embedding:', questionEmbedding);

      // Get course teacher_id (needed for filtering)
      const courseResult = await pool.query(
        `SELECT teacher_id FROM courses WHERE id = $1`,
        [courseId],
      );

      if (courseResult.rows.length === 0) {
        throw new Error('Course not found');
      }

      // eslint-disable-next-line no-constant-binary-expression
      const teacherId = courseResult.rows[0].teacher_id;
      console.log("course id", courseId)
      console.log("teacher id", teacherId)

      // Search for similar chunks
      let similarChunks: Array<{
        score: number;
        chunk_text: string;
        teacher_id: number;
        course_id: number;
        file_id: number;
        chunk_index: number;
      }>;
      try {
        similarChunks = await MilvusService.searchSimilarChunks(
          this.COLLECTION_NAME,
          questionEmbedding,
          teacherId,
          courseId,
          3,
        );
      } catch (milvusError: any) {
        if (this.isServiceUnavailableError(milvusError)) {
          logger.warn('Milvus unavailable in answerQuestion:', milvusError?.message);
          return {
            answer:
              'محتوى المادة متوفر، لكن خدمة الإجابة الآلية غير متاحة مؤقتاً. يرجى المحاولة بعد قليل أو إخبار المدرس.',
            retrievedChunks: [],
          };
        }
        throw milvusError;
      }
      console.log('Similar chunks:', similarChunks);

      if (similarChunks.length === 0) {
        return {
          answer: 'لا يمكنني العثور على هذه المعلومات في مواد الدورة التدريبية.',
          retrievedChunks: [],
        };
      }

      // Build RAG prompt
      const retrievedChunksText = similarChunks
        .map((chunk, index) => `[${index + 1}]\n${chunk.chunk_text}`)
        .join('\n\n');

      const ragPrompt = `You are an educational scientific tutor for the EM-Academy platform.

Language rules:
- Answer in the SAME language as the student's question.
- If the question is in Arabic, answer in clear Modern Standard Arabic.
- If the question is in another language, answer in that language.

Task:
Answer the question clearly and directly for a student.
Use ONLY the provided study material to determine the answer.

STRICT RULES:
- Answer ONLY using the provided study material.
- Do NOT mention the study material, text, chunks, or sources.
- Do NOT quote the passage unless the question explicitly asks for a quote.
- Do NOT add explanations unless the question asks "why" or "how".
- Give a complete factual answer.
- Include directly relevant details that clarify the fact (such as counts or composition) when they are explicitly stated.

If the answer is not found in the material:
- Respond in the SAME language as the question.
- Say exactly:
  - In English: "I cannot find this in your course material."
  - In Arabic: "لا يمكنني العثور على هذه المعلومة في مواد الدورة."

If the question is NOT related to the study material (for example: "كيف حالك؟" or "Who are you?"):
Respond politely as EM-Academy’s AI tutor, in the same language as the question, without using the study material.

Study Material:
${retrievedChunksText}

Question:
${rewrittenQuestion}`;

      // Generate answer using DeepSeek
      const response = await fetch(`${config.DEEPSEEK_API_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.DEEPSEEK_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [
            { role: 'system', content: ragPrompt },
            { role: 'user', content: rewrittenQuestion },
          ],
          temperature: 0.7,
          max_tokens: 1000,
        }),
      });

      if (!response.ok) {
        throw new Error(`DeepSeek API error: ${response.status}`);
      }

      const data = (await response.json()) as any;
      const answer =
        data.choices[0]?.message?.content?.trim() ||
        'عذراً، لم أتمكن من إنشاء إجابة. يرجى المحاولة مرة أخرى.';

      // Save to chat history
      await this.saveChatHistory(
        studentId,
        courseId,
        question,
        rewrittenQuestion,
        answer,
        similarChunks,
        images,
      );

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

  /**
   * Save chat history
   */
  private static async saveChatHistory(
    studentId: number,
    courseId: number,
    question: string,
    rewrittenQuestion: string,
    answer: string,
    retrievedChunks: any[],
    images: string[] = [],
  ): Promise<void> {
    try {
      await pool.query(
        `INSERT INTO scientific_chat_history 
         (student_id, course_id, question, rewritten_question, answer, retrieved_chunks, images)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [studentId, courseId, question, rewrittenQuestion, answer, JSON.stringify(retrievedChunks), JSON.stringify(images)],
      );
    } catch (error: any) {
      logger.error('Error saving chat history:', error.message);
      // Don't throw - chat history is not critical
    }
  }

  /**
   * Get chat history for a student and course
   */
  static async getChatHistory(
    studentId: number,
    courseId: number,
    limit: number = 50,
    beforeId?: number,
  ): Promise<ChatMessage[]> {
    try {
      let query = `SELECT * FROM scientific_chat_history
         WHERE student_id = $1 AND course_id = $2`;
      const params: any[] = [studentId, courseId, limit];

      if (beforeId) {
        query += ` AND id < $4`;
        params.push(beforeId);
      }

      query += ` ORDER BY id DESC LIMIT $3`;

      const result = await pool.query<ChatMessage>(query, params);

      return result.rows.reverse();
    } catch (error: any) {
      logger.error('Error getting chat history:', error.message);
      throw error;
    }
  }

  /**
   * Check if course has content uploaded
   */
  static async courseHasContent(courseId: number): Promise<boolean> {
    try {
      const result = await pool.query(
        `SELECT COUNT(*) as count FROM course_content_files WHERE course_id = $1`,
        [courseId],
      );

      return parseInt(result.rows[0].count) > 0;
    } catch (error: any) {
      logger.error('Error checking course content:', error.message);
      return false;
    }
  }
}
