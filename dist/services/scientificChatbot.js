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
    static TEACHER_CONTENT_COURSE_ID = 0;
    static CHUNK_SIZE = 500;
    static CHUNK_OVERLAP = 0.15;
    /**
     * Initialize Milvus collection
     */
    static async initializeCollection() {
        try {
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
     */
    static async uploadCourseFile(courseId, teacherId, fileName, filePath, fileSize, fileType, contentText) {
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
            const isEmbeddingUnavailable = msg.includes('OpenAI Embedding API error') ||
                msg.includes('OPENAI_API_KEY') ||
                msg.includes('502') ||
                msg.includes('503') ||
                msg.includes('Bad Gateway') ||
                msg.includes('UNAVAILABLE') ||
                msg.includes('No connection');
            if (isEmbeddingUnavailable) {
                utils_1.logger.warn(`Embedding service unavailable during upload (fileId=${file.id}). File saved; use "Reset embeddings" when OpenAI/Milvus is back.`, embeddingError?.message);
                return { ...file, embeddingUnavailable: true };
            }
            utils_1.logger.error('Error uploading course file:', embeddingError?.message);
            throw embeddingError;
        }
    }
    static async uploadTeacherFile(teacherId, fileName, filePath, fileSize, fileType, contentText) {
        const result = await pool_1.default.query(`INSERT INTO course_content_files
       (course_id, teacher_id, file_name, file_path, file_size, file_type, content_text)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`, [null, teacherId, fileName, filePath, fileSize, fileType, contentText]);
        const file = result.rows[0];
        try {
            await this.processAndStoreEmbeddings(file.id, this.TEACHER_CONTENT_COURSE_ID, teacherId, contentText);
            utils_1.logger.info(`✅ Uploaded and processed teacher-level file: ${fileName}`);
            return file;
        }
        catch (embeddingError) {
            const msg = embeddingError?.message ?? '';
            const isEmbeddingUnavailable = msg.includes('OpenAI Embedding API error') ||
                msg.includes('OPENAI_API_KEY') ||
                msg.includes('502') ||
                msg.includes('503') ||
                msg.includes('Bad Gateway') ||
                msg.includes('UNAVAILABLE') ||
                msg.includes('No connection');
            if (isEmbeddingUnavailable) {
                utils_1.logger.warn(`Embedding service unavailable during teacher-level upload (fileId=${file.id}). File saved; use "Reset embeddings" when OpenAI/Milvus is back.`, embeddingError?.message);
                return { ...file, embeddingUnavailable: true };
            }
            utils_1.logger.error('Error uploading teacher-level file:', embeddingError?.message);
            throw embeddingError;
        }
    }
    /**
     * Process text and store embeddings in Milvus
     */
    static async processAndStoreEmbeddings(fileId, courseId, teacherId, text) {
        try {
            const chunkTexts = (0, textChunking_1.chunkText)(text, this.CHUNK_SIZE, this.CHUNK_OVERLAP);
            if (chunkTexts.length === 0) {
                utils_1.logger.warn(`No chunks generated for file ${fileId}`);
                return;
            }
            const embeddings = await embeddingService_1.EmbeddingService.generateEmbeddings(chunkTexts);
            const milvusData = chunkTexts.map((chunk, index) => ({
                chunk_text: chunk,
                vector: embeddings[index],
                teacher_id: teacherId,
                course_id: courseId,
                file_id: fileId,
                chunk_index: index,
            }));
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
    static async listTeacherFiles(teacherId) {
        try {
            const result = await pool_1.default.query(`SELECT * FROM course_content_files WHERE teacher_id = $1 AND course_id IS NULL ORDER BY uploaded_at DESC`, [teacherId]);
            return result.rows;
        }
        catch (error) {
            utils_1.logger.error('Error listing teacher files:', error.message);
            throw error;
        }
    }
    /**
     * Reset embeddings for a course
     */
    static async resetCourseEmbeddings(courseId, teacherId) {
        try {
            await milvusService_1.MilvusService.deleteCourseChunks(this.COLLECTION_NAME, teacherId, courseId);
            const files = await this.listCourseFiles(courseId, teacherId);
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
    static async resetTeacherEmbeddings(teacherId) {
        try {
            await milvusService_1.MilvusService.deleteTeacherChunks(this.COLLECTION_NAME, teacherId);
            // We re-process all teacher files AND course files because deleteTeacherChunks removes all chunks for a teacher
            const files = await pool_1.default.query(`SELECT * FROM course_content_files WHERE teacher_id = $1`, [teacherId]);
            for (const file of files.rows) {
                if (file.content_text) {
                    await this.processAndStoreEmbeddings(file.id, file.course_id ?? this.TEACHER_CONTENT_COURSE_ID, teacherId, file.content_text);
                }
            }
            utils_1.logger.info(`✅ Reset embeddings for teacher ${teacherId}`);
        }
        catch (error) {
            utils_1.logger.error('Error resetting teacher embeddings:', error.message);
            throw error;
        }
    }
    /**
     * Delete course content file.
     */
    static async deleteCourseFile(fileId, teacherId) {
        const result = {};
        const fileResult = await pool_1.default.query(`SELECT * FROM course_content_files WHERE id = $1 AND teacher_id = $2`, [fileId, teacherId]);
        if (fileResult.rows.length === 0) {
            throw new Error('File not found or access denied');
        }
        const file = fileResult.rows[0];
        try {
            await milvusService_1.MilvusService.deleteFileChunks(this.COLLECTION_NAME, teacherId, fileId);
        }
        catch (milvusError) {
            const isUnavailable = milvusError?.code === 14 ||
                milvusError?.message?.includes('UNAVAILABLE') ||
                milvusError?.message?.includes('No connection');
            if (isUnavailable) {
                utils_1.logger.warn(`Milvus unavailable during file delete (fileId=${fileId}). File removed from DB.`);
                result.milvusUnavailable = true;
            }
            else {
                throw milvusError;
            }
        }
        try {
            await promises_1.default.unlink(file.file_path);
        }
        catch (_fsError) {
            utils_1.logger.warn(`Could not delete physical file: ${file.file_path}`);
        }
        await pool_1.default.query(`DELETE FROM course_content_files WHERE id = $1`, [fileId]);
        utils_1.logger.info(`✅ Deleted file ${fileId}`);
        return result;
    }
    static async rewriteQuestion(currentQuestion, previousQuestions) {
        try {
            if (previousQuestions.length === 0)
                return currentQuestion;
            const systemPrompt = `You are a question rewriter. Convert the user's latest question into a fully standalone question using previous questions ONLY if it depends on them.
Previous questions:
${previousQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n')}
Latest question: ${currentQuestion}
Standalone question:`;
            const response = await fetch(`${utils_1.config.DEEPSEEK_API_URL}/v1/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${utils_1.config.DEEPSEEK_API_KEY}`,
                },
                body: JSON.stringify({
                    model: 'deepseek-chat',
                    messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: currentQuestion }],
                    temperature: 0.3,
                    max_tokens: 200,
                }),
            });
            if (!response.ok)
                throw new Error(`DeepSeek API error: ${response.status}`);
            const data = (await response.json());
            return data.choices[0]?.message?.content?.trim() || currentQuestion;
        }
        catch (error) {
            utils_1.logger.error('Error rewriting question:', error.message);
            return currentQuestion;
        }
    }
    static async getRecentQuestions(studentId, courseId, limit = 2) {
        try {
            const result = await pool_1.default.query(`SELECT question FROM scientific_chat_history WHERE student_id = $1 AND course_id = $2 ORDER BY created_at DESC LIMIT $3`, [studentId, courseId, limit]);
            return result.rows.map((row) => row.question).reverse();
        }
        catch (error) {
            utils_1.logger.error('Error getting recent questions:', error.message);
            return [];
        }
    }
    static async getRecentTeacherQuestions(studentId, teacherId, limit = 2) {
        try {
            const result = await pool_1.default.query(`SELECT question FROM scientific_chat_history WHERE student_id = $1 AND teacher_id = $2 ORDER BY created_at DESC LIMIT $3`, [studentId, teacherId, limit]);
            return result.rows.map((row) => row.question).reverse();
        }
        catch (error) {
            utils_1.logger.error('Error getting recent teacher questions:', error.message);
            return [];
        }
    }
    static async studentHasTeacherSubscription(studentId, teacherId) {
        try {
            const result = await pool_1.default.query(`SELECT 1 FROM enrollments e JOIN courses c ON c.id = e.course_id WHERE e.user_id = $1 AND c.teacher_id = $2 LIMIT 1`, [studentId, teacherId]);
            return (result.rowCount ?? 0) > 0;
        }
        catch (error) {
            utils_1.logger.error('Error checking teacher subscription:', error.message);
            return false;
        }
    }
    static async teacherHasAnyCourse(teacherId) {
        try {
            const result = await pool_1.default.query(`SELECT 1 FROM courses WHERE teacher_id = $1 LIMIT 1`, [teacherId]);
            return (result.rowCount ?? 0) > 0;
        }
        catch (error) {
            utils_1.logger.error('Error checking teacher courses:', error.message);
            return false;
        }
    }
    static isServiceUnavailableError(error) {
        const msg = error?.message ?? '';
        return (msg.includes('OpenAI Embedding API error') ||
            msg.includes('OPENAI_API_KEY') ||
            msg.includes('502') ||
            msg.includes('503') ||
            msg.includes('Bad Gateway') ||
            msg.includes('UNAVAILABLE') ||
            msg.includes('No connection'));
    }
    static async answerQuestion(studentId, courseId, question, images = []) {
        try {
            const recentQuestions = await this.getRecentQuestions(studentId, courseId, 2);
            const rewrittenQuestion = await this.rewriteQuestion(question, recentQuestions);
            let questionEmbedding;
            try {
                questionEmbedding = await embeddingService_1.EmbeddingService.generateEmbedding(rewrittenQuestion);
            }
            catch (embedError) {
                if (this.isServiceUnavailableError(embedError)) {
                    return {
                        answer: 'محتوى المادة متوفر، لكن خدمة الإجابة الآلية غير متاحة مؤقتاً. يرجى المحاولة بعد قليل أو إخبار المدرس.',
                        retrievedChunks: [],
                    };
                }
                throw embedError;
            }
            const courseResult = await pool_1.default.query(`SELECT teacher_id FROM courses WHERE id = $1`, [courseId]);
            if (courseResult.rows.length === 0)
                throw new Error('Course not found');
            const teacherId = courseResult.rows[0].teacher_id;
            let similarChunks;
            try {
                similarChunks = await milvusService_1.MilvusService.searchSimilarChunks(this.COLLECTION_NAME, questionEmbedding, teacherId, courseId, 3);
            }
            catch (milvusError) {
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
            let response;
            if (images && images.length > 0) {
                const mistralConfig = { apiBaseUrl: utils_1.config.MISTRAL_API_BASE_URL, apiKey: utils_1.config.MISTRAL_API_KEY };
                const contentArr = [{ type: 'text', text: rewrittenQuestion }];
                for (const imgPath of images) {
                    try {
                        const buffer = await promises_1.default.readFile(imgPath);
                        const base64 = buffer.toString('base64');
                        const mimeType = imgPath.endsWith('.png') ? 'image/png' : imgPath.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
                        contentArr.push({ type: 'image_url', image_url: `data:${mimeType};base64,${base64}` });
                    }
                    catch (err) {
                        utils_1.logger.warn(`Could not read image ${imgPath}:`, err.message);
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
            }
            else {
                response = await fetch(`${utils_1.config.DEEPSEEK_API_URL}/v1/chat/completions`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${utils_1.config.DEEPSEEK_API_KEY}` },
                    body: JSON.stringify({
                        model: 'deepseek-chat',
                        messages: [{ role: 'system', content: ragPrompt }, { role: 'user', content: rewrittenQuestion }],
                        temperature: 0.7,
                        max_tokens: 1000,
                    }),
                });
            }
            const data = (await response.json());
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
        }
        catch (error) {
            utils_1.logger.error('Error answering question:', error.message);
            throw error;
        }
    }
    static async answerTeacherQuestion(studentId, teacherId, question, images = []) {
        try {
            const recentQuestions = await this.getRecentTeacherQuestions(studentId, teacherId, 2);
            const rewrittenQuestion = await this.rewriteQuestion(question, recentQuestions);
            let questionEmbedding;
            try {
                questionEmbedding = await embeddingService_1.EmbeddingService.generateEmbedding(rewrittenQuestion);
            }
            catch (embedError) {
                if (this.isServiceUnavailableError(embedError)) {
                    return {
                        answer: 'محتوى المادة متوفر، لكن خدمة الإجابة الآلية غير متاحة مؤقتاً. يرجى المحاولة بعد قليل أو إخبار المدرس.',
                        retrievedChunks: [],
                    };
                }
                throw embedError;
            }
            let similarChunks;
            try {
                similarChunks = await milvusService_1.MilvusService.searchSimilarChunksByTeacher(this.COLLECTION_NAME, questionEmbedding, teacherId, 3);
            }
            catch (milvusError) {
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
            let response;
            if (images && images.length > 0) {
                const mistralConfig = { apiBaseUrl: utils_1.config.MISTRAL_API_BASE_URL, apiKey: utils_1.config.MISTRAL_API_KEY };
                const contentArr = [{ type: 'text', text: rewrittenQuestion }];
                for (const imgPath of images) {
                    try {
                        const buffer = await promises_1.default.readFile(imgPath);
                        const base64 = buffer.toString('base64');
                        const mimeType = imgPath.endsWith('.png') ? 'image/png' : imgPath.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
                        contentArr.push({ type: 'image_url', image_url: `data:${mimeType};base64,${base64}` });
                    }
                    catch (err) {
                        utils_1.logger.warn(`Could not read image ${imgPath}:`, err.message);
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
            }
            else {
                response = await fetch(`${utils_1.config.DEEPSEEK_API_URL}/v1/chat/completions`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${utils_1.config.DEEPSEEK_API_KEY}` },
                    body: JSON.stringify({
                        model: 'deepseek-chat',
                        messages: [{ role: 'system', content: ragPrompt }, { role: 'user', content: rewrittenQuestion }],
                        temperature: 0.7,
                        max_tokens: 1000,
                    }),
                });
            }
            const data = (await response.json());
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
        }
        catch (error) {
            utils_1.logger.error('Error answering teacher question:', error.message);
            throw error;
        }
    }
    static async saveChatHistory(studentId, courseId, question, rewrittenQuestion, answer, retrievedChunks, images = [], teacherId = null) {
        try {
            await pool_1.default.query(`INSERT INTO scientific_chat_history 
         (student_id, course_id, question, rewritten_question, answer, retrieved_chunks, images, teacher_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [studentId, courseId, question, rewrittenQuestion, answer, JSON.stringify(retrievedChunks), JSON.stringify(images), teacherId]);
        }
        catch (error) {
            utils_1.logger.error('Error saving chat history:', error.message);
        }
    }
    static async getChatHistory(studentId, courseId, limit = 50, beforeId) {
        try {
            let query = `SELECT * FROM scientific_chat_history WHERE student_id = $1 AND course_id = $2`;
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
    static async getTeacherChatHistory(studentId, teacherId, limit = 50, beforeId) {
        try {
            let query = `SELECT * FROM scientific_chat_history WHERE student_id = $1 AND teacher_id = $2 AND course_id IS NULL`;
            const params = [studentId, teacherId, limit];
            if (beforeId) {
                query += ` AND id < $4`;
                params.push(beforeId);
            }
            query += ` ORDER BY id DESC LIMIT $3`;
            const result = await pool_1.default.query(query, params);
            return result.rows.reverse();
        }
        catch (error) {
            utils_1.logger.error('Error getting teacher chat history:', error.message);
            throw error;
        }
    }
    /**
     * List student ↔ AI chat threads for a teacher (summary for review dashboard).
     */
    static async listTeacherStudentChats(teacherId, options = {}) {
        const { courseId, studentId, limit = 30, offset = 0 } = options;
        try {
            const params = [teacherId];
            let scopeFilter = `((c.teacher_id = $1) OR (h.course_id IS NULL AND h.teacher_id = $1))`;
            if (studentId) {
                params.push(studentId);
                scopeFilter += ` AND h.student_id = $${params.length}`;
            }
            if (courseId === null) {
                scopeFilter += ` AND h.course_id IS NULL`;
            }
            else if (courseId !== undefined) {
                params.push(courseId);
                scopeFilter += ` AND h.course_id = $${params.length}`;
            }
            params.push(limit, offset);
            const result = await pool_1.default.query(`WITH scoped AS (
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
         LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
            return result.rows;
        }
        catch (error) {
            utils_1.logger.error('Error listing teacher student chats:', error.message);
            throw error;
        }
    }
    /**
     * Get full Q&A history for a student thread visible to the teacher.
     * courseId omitted = all threads with this teacher; null = teacher-level scope only.
     */
    static async getTeacherViewStudentChatHistory(teacherId, studentId, options = {}) {
        const { courseId, limit = 50, beforeId } = options;
        const allowed = await this.teacherCanViewStudentChat(teacherId, studentId, courseId);
        if (!allowed) {
            throw new Error('Access denied');
        }
        try {
            const params = [studentId, teacherId];
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
            }
            else if (courseId !== undefined) {
                params.push(courseId);
                query += ` AND h.course_id = $${params.length}`;
            }
            params.push(limit);
            if (beforeId) {
                params.push(beforeId);
                query += ` AND h.id < $${params.length}`;
            }
            query += ` ORDER BY h.id DESC LIMIT $${params.length - (beforeId ? 1 : 0)}`;
            const result = await pool_1.default.query(query, params);
            return result.rows.reverse();
        }
        catch (error) {
            utils_1.logger.error('Error getting teacher view student chat history:', error.message);
            throw error;
        }
    }
    static async teacherCanViewStudentChat(teacherId, studentId, courseId) {
        try {
            if (typeof courseId === 'number') {
                const courseResult = await pool_1.default.query(`SELECT 1 FROM courses WHERE id = $1 AND teacher_id = $2 LIMIT 1`, [courseId, teacherId]);
                if ((courseResult.rowCount ?? 0) === 0)
                    return false;
            }
            const params = [studentId, teacherId];
            let query = `
        SELECT 1
        FROM scientific_chat_history h
        LEFT JOIN courses c ON c.id = h.course_id
        WHERE h.student_id = $1
          AND ((c.teacher_id = $2) OR (h.course_id IS NULL AND h.teacher_id = $2))
      `;
            if (courseId === null) {
                query += ` AND h.course_id IS NULL`;
            }
            else if (typeof courseId === 'number') {
                params.push(courseId);
                query += ` AND h.course_id = $${params.length}`;
            }
            query += ` LIMIT 1`;
            const result = await pool_1.default.query(query, params);
            return (result.rowCount ?? 0) > 0;
        }
        catch (error) {
            utils_1.logger.error('Error checking teacher chat access:', error.message);
            return false;
        }
    }
    static async courseHasContent(courseId) {
        try {
            const result = await pool_1.default.query(`SELECT COUNT(*) as count
         FROM course_content_files f
         JOIN courses c ON c.id = $1
         WHERE f.teacher_id = c.teacher_id
           AND (f.course_id = $1 OR f.course_id IS NULL)`, [courseId]);
            return parseInt(result.rows[0].count) > 0;
        }
        catch (error) {
            return false;
        }
    }
    static async teacherHasContent(teacherId) {
        try {
            const result = await pool_1.default.query(`SELECT COUNT(*) as count FROM course_content_files WHERE teacher_id = $1`, [teacherId]);
            return parseInt(result.rows[0].count) > 0;
        }
        catch (error) {
            return false;
        }
    }
}
exports.ScientificChatbotService = ScientificChatbotService;
