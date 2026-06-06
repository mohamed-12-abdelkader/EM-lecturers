"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScientificChatbotService = void 0;
const pool_1 = __importDefault(require("../db/pool"));
const milvusService_1 = require("./milvusService");
const embeddingService_1 = require("./embeddingService");
const textChunking_1 = require("../utils/textChunking");
const utils_1 = require("../utils");
const promises_1 = __importDefault(require("fs/promises"));
class ScientificChatbotService {
    static COLLECTION_NAME = 'course_content_vectors';
    static CHUNK_SIZE = 500;
    static CHUNK_OVERLAP = 0.15;
    /**
     * Initialize Milvus collection
     */
    static async initializeCollection() {
        try {
            // Create database
            // Use "default" db
            // await MilvusService.createDatabase(config.MILVUS_DB_NAME);
            // Create collection
            await milvusService_1.MilvusService.createCollection({
                collectionName: this.COLLECTION_NAME,
                dimension: embeddingService_1.EmbeddingService.EMBEDDING_DIMENSION,
                metricType: 'IP',
                consistencyLevel: 'Bounded',
            });
            utils_1.logger.info('✅ Scientific chatbot collection initialized');
        }
        catch (error) {
            utils_1.logger.error('Error initializing collection:', error.message);
            throw error;
        }
    }
    /**
     * Upload and process course content file.
     * If embedding service (Ollama) or Milvus is unavailable, file is still saved; returns embeddingUnavailable.
     */
    static async uploadCourseFile(courseId, teacherId, fileName, filePath, fileSize, fileType, contentText) {
        // Save file metadata to SQL DB first (so file is stored even if embeddings fail)
        const result = await pool_1.default.query(`INSERT INTO course_content_files 
       (course_id, teacher_id, file_name, file_path, file_size, file_type, content_text)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`, [courseId, teacherId, fileName, filePath, fileSize, fileType, contentText]);
        const file = result.rows[0];
        try {
            await this.processAndStoreEmbeddings(file.id, courseId, teacherId, contentText);
            utils_1.logger.info(`✅ Uploaded and processed file: ${fileName} for course ${courseId}`);
            return file;
        }
        catch (embeddingError) {
            const msg = embeddingError?.message ?? '';
            const isEmbeddingUnavailable = msg.includes('Ollama API error') ||
                msg.includes('502') ||
                msg.includes('503') ||
                msg.includes('Bad Gateway') ||
                msg.includes('UNAVAILABLE') ||
                msg.includes('No connection');
            if (isEmbeddingUnavailable) {
                utils_1.logger.warn(`Embedding service unavailable during upload (fileId=${file.id}). File saved; use "Reset embeddings" when Ollama/Milvus is back.`, embeddingError?.message);
                return { ...file, embeddingUnavailable: true };
            }
            utils_1.logger.error('Error uploading course file:', embeddingError?.message);
            throw embeddingError;
        }
    }
    /**
     * Process text and store embeddings in Milvus
     */
    static async processAndStoreEmbeddings(fileId, courseId, teacherId, text) {
        try {
            // Chunk the text
            const chunkTexts = (0, textChunking_1.chunkText)(text, this.CHUNK_SIZE, this.CHUNK_OVERLAP);
            console.log("chunkTexts", chunkTexts);
            if (chunkTexts.length === 0) {
                utils_1.logger.warn(`No chunks generated for file ${fileId}`);
                return;
            }
            // Generate embeddings for all chunks
            const embeddings = await embeddingService_1.EmbeddingService.generateEmbeddings(chunkTexts);
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
            await milvusService_1.MilvusService.insertChunks(this.COLLECTION_NAME, milvusData);
            utils_1.logger.info(`✅ Stored ${chunkTexts.length} chunks for file ${fileId}`);
        }
        catch (error) {
            utils_1.logger.error('Error processing embeddings:', error.message);
            throw error;
        }
    }
    /**
     * List course content files
     */
    static async listCourseFiles(courseId, teacherId) {
        try {
            let query = `SELECT * FROM course_content_files WHERE course_id = $1`;
            const params = [courseId];
            if (teacherId) {
                query += ` AND teacher_id = $2`;
                params.push(teacherId);
            }
            query += ` ORDER BY uploaded_at DESC`;
            const result = await pool_1.default.query(query, params);
            return result.rows;
        }
        catch (error) {
            utils_1.logger.error('Error listing course files:', error.message);
            throw error;
        }
    }
    /**
     * Reset embeddings for a course (delete and regenerate)
     */
    static async resetCourseEmbeddings(courseId, teacherId) {
        try {
            // Delete existing embeddings from Milvus
            await milvusService_1.MilvusService.deleteCourseChunks(this.COLLECTION_NAME, teacherId, courseId);
            // Get all files for this course
            const files = await this.listCourseFiles(courseId, teacherId);
            // Reprocess all files
            for (const file of files) {
                if (file.content_text) {
                    await this.processAndStoreEmbeddings(file.id, courseId, teacherId, file.content_text);
                }
            }
            utils_1.logger.info(`✅ Reset embeddings for course ${courseId}`);
        }
        catch (error) {
            utils_1.logger.error('Error resetting embeddings:', error.message);
            throw error;
        }
    }
    /**
     * Delete course content file.
     * If Milvus is unavailable, still removes file from DB and disk; returns milvusUnavailable so caller can warn.
     */
    static async deleteCourseFile(fileId, teacherId) {
        const result = {};
        // Get file info
        const fileResult = await pool_1.default.query(`SELECT * FROM course_content_files WHERE id = $1 AND teacher_id = $2`, [fileId, teacherId]);
        if (fileResult.rows.length === 0) {
            throw new Error('File not found or access denied');
        }
        const file = fileResult.rows[0];
        // Delete embeddings from Milvus (optional if Milvus is down)
        try {
            await milvusService_1.MilvusService.deleteCourseChunks(this.COLLECTION_NAME, teacherId, file.course_id);
            // Reprocess remaining files for this course to restore embeddings (only when Milvus is up)
            const remainingFiles = await this.listCourseFiles(file.course_id, teacherId);
            const remainingAfterDelete = remainingFiles.filter((f) => f.id !== fileId);
            for (const remainingFile of remainingAfterDelete) {
                if (remainingFile.content_text) {
                    await this.processAndStoreEmbeddings(remainingFile.id, remainingFile.course_id, teacherId, remainingFile.content_text);
                }
            }
        }
        catch (milvusError) {
            const isUnavailable = milvusError?.code === 14 ||
                milvusError?.message?.includes('UNAVAILABLE') ||
                milvusError?.message?.includes('No connection');
            if (isUnavailable) {
                utils_1.logger.warn(`Milvus unavailable during file delete (fileId=${fileId}). File removed from DB; run "Reset embeddings" for course ${file.course_id} when Milvus is back.`);
                result.milvusUnavailable = true;
            }
            else {
                throw milvusError;
            }
        }
        // Delete physical file
        try {
            await promises_1.default.unlink(file.file_path);
        }
        catch (_fsError) {
            utils_1.logger.warn(`Could not delete physical file: ${file.file_path}`);
        }
        // Delete from SQL DB (always, so the file is gone from the app)
        await pool_1.default.query(`DELETE FROM course_content_files WHERE id = $1`, [fileId]);
        utils_1.logger.info(`✅ Deleted file ${fileId}`);
        return result;
    }
    /**
     * Rewrite question to be standalone using previous context
     */
    static async rewriteQuestion(currentQuestion, previousQuestions) {
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
            const response = await fetch(`${utils_1.config.DEEPSEEK_API_URL}/v1/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${utils_1.config.DEEPSEEK_API_KEY}`,
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
            const data = (await response.json());
            const rewrittenQuestion = data.choices[0]?.message?.content?.trim() || currentQuestion;
            return rewrittenQuestion;
        }
        catch (error) {
            utils_1.logger.error('Error rewriting question:', error.message);
            return currentQuestion; // Fallback to original
        }
    }
    /**
     * Get chat history for question rewriting
     */
    static async getRecentQuestions(studentId, courseId, limit = 2) {
        try {
            const result = await pool_1.default.query(`SELECT question FROM scientific_chat_history
         WHERE student_id = $1 AND course_id = $2
         ORDER BY created_at DESC
         LIMIT $3`, [studentId, courseId, limit]);
            return result.rows.map((row) => row.question).reverse(); // Reverse to get chronological order
        }
        catch (error) {
            utils_1.logger.error('Error getting recent questions:', error.message);
            return [];
        }
    }
    /** Detect if error is due to embedding/Milvus service being unavailable (502, 503, etc.) */
    static isServiceUnavailableError(error) {
        const msg = error?.message ?? '';
        return (msg.includes('Ollama API error') ||
            msg.includes('502') ||
            msg.includes('503') ||
            msg.includes('Bad Gateway') ||
            msg.includes('UNAVAILABLE') ||
            msg.includes('No connection'));
    }
    /**
     * Answer student question using RAG
     */
    static async answerQuestion(studentId, courseId, question, images = []) {
        try {
            // Get recent questions for rewriting
            const recentQuestions = await this.getRecentQuestions(studentId, courseId, 2);
            console.log('Recent questions:', recentQuestions);
            // Rewrite question to be standalone
            const rewrittenQuestion = await this.rewriteQuestion(question, recentQuestions);
            console.log('Rewritten question:', rewrittenQuestion);
            // Generate embedding for the question
            let questionEmbedding;
            try {
                questionEmbedding = await embeddingService_1.EmbeddingService.generateEmbedding(rewrittenQuestion);
            }
            catch (embedError) {
                if (this.isServiceUnavailableError(embedError)) {
                    utils_1.logger.warn('Embedding service unavailable in answerQuestion:', embedError?.message);
                    return {
                        answer: 'محتوى المادة متوفر، لكن خدمة الإجابة الآلية غير متاحة مؤقتاً. يرجى المحاولة بعد قليل أو إخبار المدرس.',
                        retrievedChunks: [],
                    };
                }
                throw embedError;
            }
            console.log('Question embedding:', questionEmbedding);
            // Get course teacher_id (needed for filtering)
            const courseResult = await pool_1.default.query(`SELECT teacher_id FROM courses WHERE id = $1`, [courseId]);
            if (courseResult.rows.length === 0) {
                throw new Error('Course not found');
            }
            // eslint-disable-next-line no-constant-binary-expression
            const teacherId = courseResult.rows[0].teacher_id;
            console.log("course id", courseId);
            console.log("teacher id", teacherId);
            // Search for similar chunks
            let similarChunks;
            try {
                similarChunks = await milvusService_1.MilvusService.searchSimilarChunks(this.COLLECTION_NAME, questionEmbedding, teacherId, courseId, 3);
            }
            catch (milvusError) {
                if (this.isServiceUnavailableError(milvusError)) {
                    utils_1.logger.warn('Milvus unavailable in answerQuestion:', milvusError?.message);
                    return {
                        answer: 'محتوى المادة متوفر، لكن خدمة الإجابة الآلية غير متاحة مؤقتاً. يرجى المحاولة بعد قليل أو إخبار المدرس.',
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
            const response = await fetch(`${utils_1.config.DEEPSEEK_API_URL}/v1/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${utils_1.config.DEEPSEEK_API_KEY}`,
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
            const data = (await response.json());
            const answer = data.choices[0]?.message?.content?.trim() ||
                'عذراً، لم أتمكن من إنشاء إجابة. يرجى المحاولة مرة أخرى.';
            // Save to chat history
            await this.saveChatHistory(studentId, courseId, question, rewrittenQuestion, answer, similarChunks, images);
            return {
                answer,
                retrievedChunks: similarChunks.map((chunk) => ({
                    chunk_text: chunk.chunk_text,
                    file_id: chunk.file_id,
                    chunk_index: chunk.chunk_index,
                })),
            };
        }
        catch (error) {
            utils_1.logger.error('Error answering question:', error.message);
            throw error;
        }
    }
    /**
     * Save chat history
     */
    static async saveChatHistory(studentId, courseId, question, rewrittenQuestion, answer, retrievedChunks, images = []) {
        try {
            await pool_1.default.query(`INSERT INTO scientific_chat_history 
         (student_id, course_id, question, rewritten_question, answer, retrieved_chunks, images)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`, [studentId, courseId, question, rewrittenQuestion, answer, JSON.stringify(retrievedChunks), JSON.stringify(images)]);
        }
        catch (error) {
            utils_1.logger.error('Error saving chat history:', error.message);
            // Don't throw - chat history is not critical
        }
    }
    /**
     * Get chat history for a student and course
     */
    static async getChatHistory(studentId, courseId, limit = 50, beforeId) {
        try {
            let query = `SELECT * FROM scientific_chat_history
         WHERE student_id = $1 AND course_id = $2`;
            const params = [studentId, courseId, limit];
            if (beforeId) {
                query += ` AND id < $4`;
                params.push(beforeId);
            }
            query += ` ORDER BY id DESC LIMIT $3`;
            const result = await pool_1.default.query(query, params);
            return result.rows.reverse();
        }
        catch (error) {
            utils_1.logger.error('Error getting chat history:', error.message);
            throw error;
        }
    }
    /**
     * Check if course has content uploaded
     */
    static async courseHasContent(courseId) {
        try {
            const result = await pool_1.default.query(`SELECT COUNT(*) as count FROM course_content_files WHERE course_id = $1`, [courseId]);
            return parseInt(result.rows[0].count) > 0;
        }
        catch (error) {
            utils_1.logger.error('Error checking course content:', error.message);
            return false;
        }
    }
}
exports.ScientificChatbotService = ScientificChatbotService;
