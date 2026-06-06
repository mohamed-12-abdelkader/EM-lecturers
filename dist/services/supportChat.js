"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SupportChatService = void 0;
const crypto_1 = require("crypto");
const pool_1 = __importDefault(require("../db/pool"));
class SupportChatService {
    // الحصول على شات الطالب أو إنشاؤه (SELECT ثم INSERT عند الغياب — يتجنب مشاكل ON CONFLICT مع الفهارس الجزئية)
    static async getOrCreateStudentChat(studentId) {
        let chat;
        const existing = await pool_1.default.query(`SELECT * FROM support_chats WHERE student_id = $1 LIMIT 1`, [studentId]);
        if (existing.rowCount && existing.rows[0]) {
            chat = existing.rows[0];
        }
        else {
            const insertResult = await pool_1.default.query(`INSERT INTO support_chats (student_id, status)
         VALUES ($1, 'bot_handling')
         RETURNING *`, [studentId]);
            if (!insertResult.rowCount || !insertResult.rows[0]) {
                const retry = await pool_1.default.query(`SELECT * FROM support_chats WHERE student_id = $1 LIMIT 1`, [studentId]);
                if (!retry.rowCount || !retry.rows[0]) {
                    throw new Error('فشل إنشاء أو جلب شات الدعم');
                }
                chat = retry.rows[0];
            }
            else {
                chat = insertResult.rows[0];
            }
        }
        const studentResult = await pool_1.default.query(`SELECT name, email FROM users WHERE id = $1`, [
            studentId,
        ]);
        if (studentResult.rows[0]) {
            return {
                ...chat,
                student_name: studentResult.rows[0].name,
                student_email: studentResult.rows[0].email,
            };
        }
        return chat;
    }
    /** شات الضيف (غير المسجل): إنشاء أو جلب بالـ guest_token */
    static async getOrCreateGuestChat(guestToken) {
        const token = (guestToken || '').trim();
        if (token) {
            const found = await pool_1.default.query(`SELECT * FROM support_chats WHERE guest_token = $1`, [token]);
            if (found.rowCount && found.rows[0]) {
                return { ...found.rows[0], guest_token: token };
            }
        }
        const newToken = (0, crypto_1.randomUUID)();
        const result = await pool_1.default.query(`INSERT INTO support_chats (guest_token, student_id, status)
       VALUES ($1, NULL, 'bot_handling')
       RETURNING *`, [newToken]);
        const chat = result.rows[0];
        return { ...chat, guest_token: newToken };
    }
    /** جلب شات الضيف بالـ token (للتحقق) */
    static async getChatByGuestToken(guestToken) {
        const r = await pool_1.default.query(`SELECT * FROM support_chats WHERE guest_token = $1`, [guestToken]);
        if (!r.rowCount || !r.rows[0])
            return null;
        return { ...r.rows[0], guest_token: guestToken };
    }
    // جلب جميع الشاتات (للأدمن)
    static async getAllChats(limit = 50, offset = 0, status) {
        let query = `
      SELECT 
        sc.*,
        u.name AS student_name,
        u.email AS student_email,
        COUNT(DISTINCT CASE WHEN sm.read_at IS NULL AND sm.sender_role = 'student' THEN sm.id END) AS unread_count
      FROM support_chats sc
      JOIN users u ON u.id = sc.student_id
      LEFT JOIN support_messages sm ON sm.chat_id = sc.id
    `;
        const params = [];
        const conditions = [];
        if (status) {
            conditions.push(`sc.status = $${params.length + 1}`);
            params.push(status);
        }
        if (conditions.length > 0) {
            query += ` WHERE ${conditions.join(' AND ')}`;
        }
        query += `
      GROUP BY sc.id, u.name, u.email
      ORDER BY sc.last_message_at DESC NULLS LAST, sc.created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;
        params.push(limit, offset);
        const result = await pool_1.default.query(query, params);
        // جلب العدد الإجمالي
        let countQuery = `SELECT COUNT(*) FROM support_chats sc`;
        const countParams = [];
        const countConditions = [];
        if (status) {
            countConditions.push(`sc.status = $${countParams.length + 1}`);
            countParams.push(status);
        }
        if (countConditions.length > 0) {
            countQuery += ` WHERE ${countConditions.join(' AND ')}`;
        }
        const countResult = await pool_1.default.query(countQuery, countParams);
        const total = parseInt(countResult.rows[0].count);
        return {
            chats: result.rows.map((row) => ({
                id: row.id,
                student_id: row.student_id,
                admin_id: row.admin_id,
                status: row.status,
                last_message_at: row.last_message_at,
                created_at: row.created_at,
                updated_at: row.updated_at,
                student_name: row.student_name,
                student_email: row.student_email,
                unread_count: parseInt(row.unread_count) || 0,
                current_intent: row.current_intent,
                bot_attempts: row.bot_attempts ? parseInt(row.bot_attempts) : 0,
                escalation_reason: row.escalation_reason,
                escalated_at: row.escalated_at,
            })),
            total,
        };
    }
    // جلب رسائل الشات
    static async getChatMessages(chatId, limit = 50, before) {
        let query = `
      SELECT 
        sm.*,
        COALESCE(u.name, 'زائر') AS sender_name
      FROM support_messages sm
      LEFT JOIN users u ON u.id = sm.sender_id
      WHERE sm.chat_id = $1
    `;
        const params = [chatId];
        if (before) {
            query += ` AND sm.created_at < $${params.length + 1}`;
            params.push(before);
        }
        query += `
      ORDER BY sm.created_at DESC
      LIMIT $${params.length + 1}
    `;
        params.push(limit);
        const result = await pool_1.default.query(query, params);
        return result.rows
            .map((row) => ({
            id: row.id,
            chat_id: row.chat_id,
            sender_id: row.sender_id,
            sender_role: row.sender_role,
            message_type: row.message_type,
            text: row.text,
            media_url: row.media_url,
            media_type: row.media_type,
            media_name: row.media_name,
            media_size: row.media_size,
            duration: row.duration,
            is_auto_reply: row.is_auto_reply,
            faq_id: row.faq_id,
            delivered_at: row.delivered_at,
            read_at: row.read_at,
            created_at: row.created_at,
            sender_name: row.sender_name,
            status: row.read_at ? 'read' : row.delivered_at ? 'delivered' : 'sent',
        }))
            .reverse(); // عكس الترتيب لعرض الأقدم أولاً
    }
    // حفظ رسالة
    static async saveMessage(chatId, senderId, senderRole, messageData) {
        const { text, message_type = 'text', media_url, media_type, media_name, media_size, duration, is_auto_reply = false, faq_id, } = messageData;
        const result = await pool_1.default.query(`INSERT INTO support_messages (
        chat_id, sender_id, sender_role, message_type, text,
        media_url, media_type, media_name, media_size, duration,
        is_auto_reply, faq_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *`, [
            chatId,
            senderId ?? null,
            senderRole,
            message_type,
            text,
            media_url,
            media_type,
            media_name,
            media_size,
            duration,
            is_auto_reply,
            faq_id,
        ]);
        // تحديث last_message_at في الشات
        await pool_1.default.query(`UPDATE support_chats SET last_message_at = NOW() WHERE id = $1`, [chatId]);
        const message = result.rows[0];
        // جلب اسم المرسل (ضيف = زائر)
        let senderName = 'مستخدم';
        if (is_auto_reply) {
            senderName = 'رد تلقائي';
        }
        else if (senderId == null) {
            senderName = 'زائر';
        }
        else {
            const userResult = await pool_1.default.query(`SELECT name FROM users WHERE id = $1`, [senderId]);
            senderName = userResult.rows[0]?.name || 'مستخدم';
        }
        return {
            ...message,
            sender_name: senderName,
            status: 'sent',
        };
    }
    // تحديث حالة الشات
    static async updateChatStatus(chatId, status) {
        await pool_1.default.query(`UPDATE support_chats SET status = $1 WHERE id = $2`, [status, chatId]);
    }
    // تحديث معلومات البوت (intent, attempts, escalation)
    static async updateChatBotInfo(chatId, data) {
        const updates = [];
        const params = [];
        let paramIndex = 1;
        if (data.current_intent !== undefined) {
            updates.push(`current_intent = $${paramIndex++}`);
            params.push(data.current_intent);
        }
        if (data.bot_attempts !== undefined) {
            updates.push(`bot_attempts = $${paramIndex++}`);
            params.push(data.bot_attempts);
        }
        if (data.escalation_reason !== undefined) {
            updates.push(`escalation_reason = $${paramIndex++}`);
            params.push(data.escalation_reason);
        }
        if (data.escalated_at !== undefined) {
            updates.push(`escalated_at = $${paramIndex++}`);
            params.push(data.escalated_at);
        }
        if (updates.length === 0)
            return;
        params.push(chatId);
        await pool_1.default.query(`UPDATE support_chats SET ${updates.join(', ')} WHERE id = $${paramIndex}`, params);
    }
    // تصعيد الشات إلى الأدمن
    static async escalateChat(chatId, reason) {
        await pool_1.default.query(`UPDATE support_chats 
       SET status = 'waiting_for_admin',
           escalation_reason = $1,
           escalated_at = NOW()
       WHERE id = $2`, [reason, chatId]);
    }
    // تعيين أدمن للشات
    static async assignAdmin(chatId, adminId) {
        await pool_1.default.query(`UPDATE support_chats SET admin_id = $1 WHERE id = $2`, [adminId, chatId]);
    }
    // تحديث حالة الرسالة (delivered/read)
    static async updateMessageStatus(messageId, status) {
        if (status === 'delivered') {
            await pool_1.default.query(`UPDATE support_messages SET delivered_at = NOW() WHERE id = $1 AND delivered_at IS NULL`, [messageId]);
        }
        else if (status === 'read') {
            await pool_1.default.query(`UPDATE support_messages SET read_at = NOW() WHERE id = $1 AND read_at IS NULL`, [messageId]);
        }
    }
    // تحديد كل الرسائل الواردة (من الأدمن/البوت) كمقروءة — استخدام sender_role = 'admin' ليشمل رسائل البوت (sender_id = NULL)
    static async markChatAsRead(chatId, _readerId) {
        await pool_1.default.query(`UPDATE support_messages 
       SET read_at = NOW() 
       WHERE chat_id = $1 
         AND sender_role = 'admin' 
         AND read_at IS NULL`, [chatId]);
    }
    // جلب عدد الرسائل غير المقروءة (طالب: شات الدعم؛ أدمن: شات الطلاب؛ مدرس: شات دعم المدرس)
    static async getUnreadCount(userId, userRole) {
        if (userRole === 'admin') {
            const result = await pool_1.default.query(`SELECT COUNT(*) 
         FROM support_messages sm
         JOIN support_chats sc ON sc.id = sm.chat_id
         WHERE sm.sender_role = 'student' 
           AND sm.read_at IS NULL`, []);
            return parseInt(result.rows[0].count) || 0;
        }
        if (userRole === 'teacher') {
            const result = await pool_1.default.query(`SELECT COUNT(*) 
         FROM teacher_support_messages tsm
         JOIN teacher_support_chats tsc ON tsc.id = tsm.chat_id
         WHERE tsc.teacher_id = $1 
           AND tsm.sender_role = 'admin' 
           AND tsm.read_at IS NULL`, [userId]);
            return parseInt(result.rows[0].count) || 0;
        }
        // student
        const result = await pool_1.default.query(`SELECT COUNT(*) 
       FROM support_messages sm
       JOIN support_chats sc ON sc.id = sm.chat_id
       WHERE sc.student_id = $1 
         AND sm.sender_role = 'admin' 
         AND sm.read_at IS NULL`, [userId]);
        return parseInt(result.rows[0].count) || 0;
    }
    // البحث عن FAQ مطابق (محسّن)
    static async findMatchingFAQ(question) {
        const result = await pool_1.default.query(`SELECT * FROM support_faq 
       WHERE is_active = TRUE
       ORDER BY priority DESC, id DESC`);
        if (result.rows.length === 0)
            return null;
        const questionLower = question.toLowerCase().trim();
        const questionWords = questionLower.split(/\s+/).filter((w) => w.length > 2); // كلمات أكثر من حرفين
        let bestMatch = null;
        let bestScore = 0;
        for (const faq of result.rows) {
            let score = 0;
            const faqQuestionLower = faq.question.toLowerCase();
            // 1. مطابقة مباشرة كاملة (أعلى درجة)
            if (questionLower === faqQuestionLower) {
                return faq; // تطابق كامل - نرجع فوراً
            }
            // 2. مطابقة جزئية في السؤال (درجة عالية)
            if (faqQuestionLower.includes(questionLower) || questionLower.includes(faqQuestionLower)) {
                score += 50;
            }
            // 3. مطابقة الكلمات المفتاحية (درجة متوسطة)
            if (faq.keywords && faq.keywords.length > 0) {
                const matchedKeywords = faq.keywords.filter((keyword) => {
                    const keywordLower = keyword.toLowerCase();
                    return (questionLower.includes(keywordLower) ||
                        questionWords.some((word) => word.includes(keywordLower) || keywordLower.includes(word)));
                }).length;
                if (matchedKeywords > 0) {
                    score += matchedKeywords * 20; // كل كلمة مفتاحية = 20 نقطة
                }
            }
            // 4. مطابقة كلمات من السؤال في FAQ (درجة منخفضة)
            const matchedWords = questionWords.filter((word) => faqQuestionLower.includes(word)).length;
            score += matchedWords * 5;
            // 5. مطابقة كلمات من FAQ في السؤال
            const faqWords = faqQuestionLower.split(/\s+/).filter((w) => w.length > 2);
            const matchedFaqWords = faqWords.filter((word) => questionLower.includes(word)).length;
            score += matchedFaqWords * 5;
            // إذا كانت النتيجة أفضل من السابقة، نحفظها
            if (score > bestScore && score >= 20) {
                // الحد الأدنى 20 نقطة
                bestScore = score;
                bestMatch = faq;
            }
        }
        return bestMatch;
    }
    // جلب جميع FAQs
    static async getAllFAQs(activeOnly = false) {
        let query = `SELECT * FROM support_faq`;
        const params = [];
        if (activeOnly) {
            query += ` WHERE is_active = TRUE`;
        }
        query += ` ORDER BY priority DESC, id DESC`;
        const result = await pool_1.default.query(query, params);
        return result.rows;
    }
    // إنشاء FAQ
    static async createFAQ(question, answer, keywords, priority, createdBy) {
        const result = await pool_1.default.query(`INSERT INTO support_faq (question, answer, keywords, priority, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`, [question, answer, keywords, priority, createdBy]);
        return result.rows[0];
    }
    // تحديث FAQ
    static async updateFAQ(id, data) {
        const updates = [];
        const params = [];
        let paramIndex = 1;
        if (data.question !== undefined) {
            updates.push(`question = $${paramIndex++}`);
            params.push(data.question);
        }
        if (data.answer !== undefined) {
            updates.push(`answer = $${paramIndex++}`);
            params.push(data.answer);
        }
        if (data.keywords !== undefined) {
            updates.push(`keywords = $${paramIndex++}`);
            params.push(data.keywords);
        }
        if (data.is_active !== undefined) {
            updates.push(`is_active = $${paramIndex++}`);
            params.push(data.is_active);
        }
        if (data.priority !== undefined) {
            updates.push(`priority = $${paramIndex++}`);
            params.push(data.priority);
        }
        updates.push(`updated_at = NOW()`);
        params.push(id);
        const result = await pool_1.default.query(`UPDATE support_faq 
       SET ${updates.join(', ')}
       WHERE id = $${paramIndex}
       RETURNING *`, params);
        return result.rows[0];
    }
    // حذف FAQ
    static async deleteFAQ(id) {
        await pool_1.default.query(`DELETE FROM support_faq WHERE id = $1`, [id]);
    }
    // جلب الشات مع جميع المعلومات
    static async getChatById(chatId) {
        const result = await pool_1.default.query(`SELECT 
        sc.*,
        u.name AS student_name,
        u.email AS student_email
      FROM support_chats sc
      LEFT JOIN users u ON u.id = sc.student_id
      WHERE sc.id = $1`, [chatId]);
        if (result.rows.length === 0)
            return null;
        const row = result.rows[0];
        return {
            id: row.id,
            student_id: row.student_id,
            admin_id: row.admin_id,
            status: row.status,
            last_message_at: row.last_message_at,
            created_at: row.created_at,
            updated_at: row.updated_at,
            student_name: row.student_name,
            student_email: row.student_email,
            current_intent: row.current_intent,
            bot_attempts: row.bot_attempts ? parseInt(row.bot_attempts) : 0,
            escalation_reason: row.escalation_reason,
            escalated_at: row.escalated_at,
        };
    }
    // جلب إشعارات الرسائل (الرسائل الواردة من الأدمن/البوت)
    // unreadOnly: عند true للطالب نرجع غير المقروءة فقط؛ عند false نرجع الكل مع is_unread (مقروء = دخل الشات وشاف الرسالة)
    static async getMessageNotifications(userId, userRole, limit = 20, offset = 0, unreadOnly = true) {
        let query;
        let countQuery;
        const params = [];
        if (userRole === 'student') {
            // للطالب: جلب الرسائل الواردة له (من الأدمن أو البوت)، مع أو بدون المقروءة حسب unreadOnly
            query = `
        SELECT 
          sm.id as message_id,
          sm.chat_id,
          sm.sender_id,
          sm.sender_role,
          sm.message_type,
          sm.text,
          sm.media_url,
          sm.media_type,
          sm.is_auto_reply,
          sm.created_at,
          sm.read_at,
          CASE WHEN sm.is_auto_reply THEN 'رد تلقائي' ELSE u.name END as sender_name,
          sc.status as chat_status,
          sc.student_id,
          CASE 
            WHEN sm.read_at IS NULL THEN true 
            ELSE false 
          END as is_unread
        FROM support_messages sm
        JOIN support_chats sc ON sc.id = sm.chat_id
        LEFT JOIN users u ON u.id = sm.sender_id
        WHERE sc.student_id = $1
          AND sm.sender_role = 'admin'
          ${unreadOnly ? 'AND sm.read_at IS NULL' : ''}
        ORDER BY sm.created_at DESC
        LIMIT $${params.length + 2} OFFSET $${params.length + 3}
      `;
            countQuery = `
        SELECT COUNT(*) as total
        FROM support_messages sm
        JOIN support_chats sc ON sc.id = sm.chat_id
        WHERE sc.student_id = $1
          AND sm.sender_role = 'admin'
          ${unreadOnly ? 'AND sm.read_at IS NULL' : ''}
      `;
            params.push(userId);
        }
        else {
            // للأدمن: جلب الرسائل من الطلاب غير المقروءة في جميع الشاتات
            query = `
        SELECT 
          sm.id as message_id,
          sm.chat_id,
          sm.sender_id,
          sm.sender_role,
          sm.message_type,
          sm.text,
          sm.media_url,
          sm.media_type,
          sm.is_auto_reply,
          sm.created_at,
          u.name as sender_name,
          u.email as sender_email,
          sc.status as chat_status,
          sc.student_id,
          sc.admin_id,
          CASE 
            WHEN sm.read_at IS NULL THEN true 
            ELSE false 
          END as is_unread
        FROM support_messages sm
        JOIN support_chats sc ON sc.id = sm.chat_id
        JOIN users u ON u.id = sm.sender_id
        WHERE sm.sender_role = 'student'
          AND sm.read_at IS NULL
          AND sm.is_auto_reply = false
        ORDER BY sm.created_at DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}
      `;
            countQuery = `
        SELECT COUNT(*) as total
        FROM support_messages sm
        JOIN support_chats sc ON sc.id = sm.chat_id
        WHERE sm.sender_role = 'student'
          AND sm.read_at IS NULL
          AND sm.is_auto_reply = false
      `;
        }
        params.push(limit, offset);
        const result = await pool_1.default.query(query, params);
        const countResult = await pool_1.default.query(countQuery, userRole === 'student' ? [userId] : []);
        const notifications = result.rows.map(row => {
            const base = {
                message_id: row.message_id,
                chat_id: row.chat_id,
                sender_id: row.sender_id,
                sender_role: row.sender_role,
                sender_name: row.sender_name,
                sender_email: row.sender_email || null,
                message_type: row.message_type,
                text: row.text,
                media_url: row.media_url,
                media_type: row.media_type,
                is_auto_reply: row.is_auto_reply,
                chat_status: row.chat_status,
                student_id: row.student_id,
                admin_id: row.admin_id || null,
                is_unread: row.is_unread,
                read_at: row.read_at || null,
                created_at: row.created_at,
            };
            if (userRole === 'student') {
                const title = row.is_auto_reply ? 'دعم فني' : (row.sender_name || 'دعم فني');
                const body = (row.text || '').slice(0, 120) + (row.text && row.text.length > 120 ? '...' : '');
                return {
                    ...base,
                    title,
                    body,
                    data: {
                        type: 'student_support_chat',
                        chat_id: row.chat_id,
                        message_id: row.message_id,
                        ...(row.sender_id != null && { sender_id: row.sender_id }),
                    },
                };
            }
            return base;
        });
        return {
            notifications,
            total: parseInt(countResult.rows[0].total)
        };
    }
    /** جلب معرف شات الطالب فقط (بدون إنشاء) — لاستخدامه عند مسح الإشعارات */
    static async getStudentChatId(studentId) {
        const row = await pool_1.default.query(`SELECT id FROM support_chats WHERE student_id = $1 LIMIT 1`, [studentId]);
        if (!row.rowCount || !row.rows[0])
            return null;
        return row.rows[0].id;
    }
    /**
     * آخر إشعار واحد غير مقروء للطالب — مناسب لـ Expo Push والبادج.
     * يرجع null إذا لا يوجد إشعار غير مقروء.
     */
    static async getStudentLatestUnreadNotification(studentId) {
        const chatRow = await pool_1.default.query(`SELECT id FROM support_chats WHERE student_id = $1 LIMIT 1`, [studentId]);
        if (!chatRow.rowCount || !chatRow.rows[0])
            return null;
        const chatId = chatRow.rows[0].id;
        const row = await pool_1.default.query(`SELECT 
        sm.id AS message_id,
        sm.chat_id,
        sm.sender_id,
        sm.sender_role,
        sm.message_type,
        sm.text,
        sm.media_url,
        sm.media_type,
        sm.is_auto_reply,
        sm.created_at,
        CASE WHEN sm.is_auto_reply THEN 'رد تلقائي' ELSE u.name END AS sender_name
       FROM support_messages sm
       LEFT JOIN users u ON u.id = sm.sender_id
       WHERE sm.chat_id = $1 AND sm.sender_role = 'admin' AND sm.read_at IS NULL
       ORDER BY sm.created_at DESC
       LIMIT 1`, [chatId]);
        if (!row.rowCount)
            return null;
        const r = row.rows[0];
        const title = r.is_auto_reply ? 'دعم فني' : (r.sender_name || 'دعم فني');
        const body = (r.text || '').slice(0, 120) + (r.text && r.text.length > 120 ? '...' : '');
        return {
            message_id: r.message_id,
            chat_id: r.chat_id,
            sender_id: r.sender_id,
            sender_role: r.sender_role,
            sender_name: r.sender_name || 'رد تلقائي',
            message_type: r.message_type,
            text: r.text,
            media_url: r.media_url,
            media_type: r.media_type,
            is_auto_reply: !!r.is_auto_reply,
            created_at: r.created_at,
            title,
            body,
            data: {
                type: 'student_support_chat',
                chat_id: r.chat_id,
                message_id: r.message_id,
                ...(r.sender_id != null && { sender_id: r.sender_id }),
            },
        };
    }
    // ---------- شات دعم المدرس ----------
    static async getOrCreateTeacherChat(teacherId) {
        const result = await pool_1.default.query(`INSERT INTO teacher_support_chats (teacher_id, status)
       VALUES ($1, 'bot_handling')
       ON CONFLICT (teacher_id) DO UPDATE SET teacher_id = EXCLUDED.teacher_id
       RETURNING *`, [teacherId]);
        const chat = result.rows[0];
        const userRes = await pool_1.default.query(`SELECT name, email FROM users WHERE id = $1`, [teacherId]);
        if (userRes.rows[0]) {
            return {
                ...chat,
                teacher_name: userRes.rows[0].name,
                teacher_email: userRes.rows[0].email,
            };
        }
        return chat;
    }
    static async getTeacherChatById(chatId) {
        const result = await pool_1.default.query(`SELECT tsc.*, u.name AS teacher_name, u.email AS teacher_email
       FROM teacher_support_chats tsc
       JOIN users u ON u.id = tsc.teacher_id
       WHERE tsc.id = $1`, [chatId]);
        return result.rows[0] || null;
    }
    static async getTeacherChatByTeacherId(teacherId) {
        const result = await pool_1.default.query(`SELECT tsc.*, u.name AS teacher_name, u.email AS teacher_email
       FROM teacher_support_chats tsc
       JOIN users u ON u.id = tsc.teacher_id
       WHERE tsc.teacher_id = $1`, [teacherId]);
        return result.rows[0] || null;
    }
    static async getTeacherChatMessages(chatId, limit = 50, before) {
        let query = `
      SELECT tsm.*, u.name AS sender_name
      FROM teacher_support_messages tsm
      JOIN users u ON u.id = tsm.sender_id
      WHERE tsm.chat_id = $1
    `;
        const params = [chatId];
        if (before) {
            query += ` AND tsm.created_at < $${params.length + 1}`;
            params.push(before);
        }
        query += ` ORDER BY tsm.created_at DESC LIMIT $${params.length + 1}`;
        params.push(limit);
        const result = await pool_1.default.query(query, params);
        return result.rows
            .map((row) => ({
            id: row.id,
            chat_id: row.chat_id,
            sender_id: row.sender_id,
            sender_role: row.sender_role,
            message_type: row.message_type,
            text: row.text,
            media_url: row.media_url,
            media_type: row.media_type,
            media_name: row.media_name,
            media_size: row.media_size,
            duration: row.duration,
            is_auto_reply: row.is_auto_reply,
            faq_id: row.faq_id,
            delivered_at: row.delivered_at,
            read_at: row.read_at,
            created_at: row.created_at,
            sender_name: row.sender_name,
        }))
            .reverse();
    }
    /** إشعارات شات الدعم للمدرس: الرسائل الواردة له (من الأدمن أو البوت) */
    static async getTeacherSupportNotifications(teacherId, limit = 20, offset = 0, unreadOnly = false) {
        const chat = await this.getTeacherChatByTeacherId(teacherId);
        if (!chat) {
            return { notifications: [], total: 0 };
        }
        let query = `
      SELECT 
        tsm.id AS message_id,
        tsm.chat_id,
        tsm.sender_id,
        tsm.sender_role,
        tsm.message_type,
        tsm.text,
        tsm.media_url,
        tsm.media_type,
        tsm.is_auto_reply,
        tsm.created_at,
        tsm.read_at,
        CASE WHEN tsm.is_auto_reply THEN 'رد تلقائي' ELSE u.name END AS sender_name,
        CASE WHEN tsm.read_at IS NULL THEN true ELSE false END AS is_unread
      FROM teacher_support_messages tsm
      LEFT JOIN users u ON u.id = tsm.sender_id
      WHERE tsm.chat_id = $1 AND tsm.sender_role = 'admin'
    `;
        const params = [chat.id];
        if (unreadOnly) {
            query += ` AND tsm.read_at IS NULL`;
        }
        const countQuery = `
      SELECT COUNT(*) AS total
      FROM teacher_support_messages tsm
      WHERE tsm.chat_id = $1 AND tsm.sender_role = 'admin'
      ${unreadOnly ? ' AND tsm.read_at IS NULL' : ''}
    `;
        query += ` ORDER BY tsm.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
        params.push(limit, offset);
        const result = await pool_1.default.query(query, params);
        const countResult = await pool_1.default.query(countQuery, unreadOnly ? [chat.id] : [chat.id]);
        const total = parseInt(countResult.rows[0].total, 10) || 0;
        const notifications = result.rows.map((row) => ({
            message_id: row.message_id,
            chat_id: row.chat_id,
            sender_id: row.sender_id,
            sender_role: row.sender_role,
            sender_name: row.sender_name,
            message_type: row.message_type,
            text: row.text,
            media_url: row.media_url,
            media_type: row.media_type,
            is_auto_reply: row.is_auto_reply,
            is_unread: row.is_unread,
            read_at: row.read_at || null,
            created_at: row.created_at,
        }));
        return { notifications, total };
    }
    /**
     * آخر إشعار واحد غير مقروء للمدرس — مناسب لـ Expo Push وعرض بادج.
     * يرجع null إذا لا يوجد إشعار غير مقروء.
     */
    static async getTeacherLatestUnreadNotification(teacherId) {
        const chat = await this.getTeacherChatByTeacherId(teacherId);
        if (!chat)
            return null;
        const row = await pool_1.default.query(`SELECT 
        tsm.id AS message_id,
        tsm.chat_id,
        tsm.sender_id,
        tsm.sender_role,
        tsm.message_type,
        tsm.text,
        tsm.media_url,
        tsm.media_type,
        tsm.is_auto_reply,
        tsm.created_at,
        CASE WHEN tsm.is_auto_reply THEN 'رد تلقائي' ELSE u.name END AS sender_name
       FROM teacher_support_messages tsm
       LEFT JOIN users u ON u.id = tsm.sender_id
       WHERE tsm.chat_id = $1 AND tsm.sender_role = 'admin' AND tsm.read_at IS NULL
       ORDER BY tsm.created_at DESC
       LIMIT 1`, [chat.id]);
        if (!row.rowCount)
            return null;
        const r = row.rows[0];
        const title = r.is_auto_reply ? 'دعم فني' : (r.sender_name || 'دعم فني');
        const body = (r.text || '').slice(0, 120) + (r.text && r.text.length > 120 ? '...' : '');
        return {
            message_id: r.message_id,
            chat_id: r.chat_id,
            sender_id: r.sender_id,
            sender_role: r.sender_role,
            sender_name: r.sender_name || 'رد تلقائي',
            message_type: r.message_type,
            text: r.text,
            media_url: r.media_url,
            media_type: r.media_type,
            is_auto_reply: !!r.is_auto_reply,
            created_at: r.created_at,
            title,
            body,
            data: {
                type: 'teacher_support_chat',
                chat_id: r.chat_id,
                message_id: r.message_id,
                ...(r.sender_id != null && { sender_id: r.sender_id }),
            },
        };
    }
    /** تحديد رسائل شات المدرس كمقروءة (الرسائل الواردة من الأدمن/البوت) */
    static async markTeacherChatAsRead(chatId) {
        await pool_1.default.query(`UPDATE teacher_support_messages 
       SET read_at = NOW() 
       WHERE chat_id = $1 AND sender_role = 'admin' AND read_at IS NULL`, [chatId]);
    }
    static async saveTeacherMessage(chatId, senderId, senderRole, messageData) {
        const { text, message_type = 'text', media_url, media_type, media_name, media_size, duration, is_auto_reply = false, } = messageData;
        const result = await pool_1.default.query(`INSERT INTO teacher_support_messages (
        chat_id, sender_id, sender_role, message_type, text,
        media_url, media_type, media_name, media_size, duration, is_auto_reply
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *`, [
            chatId,
            senderId,
            senderRole,
            message_type,
            text ?? null,
            media_url ?? null,
            media_type ?? null,
            media_name ?? null,
            media_size ?? null,
            duration ?? null,
            is_auto_reply,
        ]);
        await pool_1.default.query(`UPDATE teacher_support_chats SET last_message_at = NOW(), updated_at = NOW() WHERE id = $1`, [chatId]);
        const msg = result.rows[0];
        let senderName = 'مستخدم';
        if (is_auto_reply)
            senderName = 'رد تلقائي';
        else {
            const u = await pool_1.default.query(`SELECT name FROM users WHERE id = $1`, [senderId]);
            senderName = u.rows[0]?.name || 'مستخدم';
        }
        return { ...msg, sender_name: senderName };
    }
    static async updateTeacherChatStatus(chatId, status) {
        await pool_1.default.query(`UPDATE teacher_support_chats SET status = $1, updated_at = NOW() WHERE id = $2`, [status, chatId]);
    }
    static async escalateTeacherChat(chatId, reason) {
        await pool_1.default.query(`UPDATE teacher_support_chats
       SET status = 'waiting_for_admin', escalation_reason = $1, escalated_at = NOW(), updated_at = NOW()
       WHERE id = $2`, [reason, chatId]);
    }
    static async createSupportTicket(teacherSupportChatId, teacherId, messageText) {
        const result = await pool_1.default.query(`INSERT INTO support_tickets (teacher_support_chat_id, teacher_id, message_text, status)
       VALUES ($1, $2, $3, 'open')
       RETURNING id`, [teacherSupportChatId, teacherId, messageText]);
        return result.rows[0].id;
    }
    /** قائمة تذاكر الدعم (مشاكل المدرسين) للأدمن */
    static async getAllSupportTickets(limit = 50, offset = 0, status) {
        let where = '';
        const params = [];
        if (status) {
            where = ' WHERE st.status = $1';
            params.push(status);
        }
        const query = `
      SELECT st.id, st.teacher_support_chat_id AS chat_id, st.teacher_id,
             st.message_text, st.status, st.admin_notes, st.created_at, st.updated_at,
             u.name AS teacher_name, u.email AS teacher_email
      FROM support_tickets st
      JOIN users u ON u.id = st.teacher_id
      ${where}
      ORDER BY st.created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;
        params.push(limit, offset);
        const result = await pool_1.default.query(query, params);
        const countQuery = status
            ? 'SELECT COUNT(*) FROM support_tickets WHERE status = $1'
            : 'SELECT COUNT(*) FROM support_tickets';
        const countResult = await pool_1.default.query(countQuery, status ? [status] : []);
        const total = parseInt(countResult.rows[0].count, 10);
        return {
            tickets: result.rows,
            total,
        };
    }
    /** جلب تذكرة واحدة (للأدمن) */
    static async getSupportTicketById(ticketId) {
        const result = await pool_1.default.query(`SELECT st.id, st.teacher_support_chat_id AS chat_id, st.teacher_id,
              st.message_text, st.status, st.admin_notes, st.created_at, st.updated_at,
              u.name AS teacher_name, u.email AS teacher_email
       FROM support_tickets st
       JOIN users u ON u.id = st.teacher_id
       WHERE st.id = $1`, [ticketId]);
        return result.rows[0] || null;
    }
    /** تحديث حالة التذكرة (وليس إرسال الرسالة للمدرس — يتم في الـ controller) */
    static async updateSupportTicket(ticketId, data) {
        const updates = [];
        const params = [];
        let i = 1;
        if (data.status !== undefined) {
            updates.push(`status = $${i++}`);
            params.push(data.status);
        }
        if (data.admin_notes !== undefined) {
            updates.push(`admin_notes = $${i++}`);
            params.push(data.admin_notes);
        }
        if (updates.length === 0)
            return this.getSupportTicketById(ticketId);
        updates.push(`updated_at = NOW()`);
        params.push(ticketId);
        await pool_1.default.query(`UPDATE support_tickets SET ${updates.join(', ')} WHERE id = $${i}`, params);
        return this.getSupportTicketById(ticketId);
    }
    static async getAllTeacherChats(limit = 50, offset = 0, status) {
        let query = `
      SELECT tsc.*, u.name AS teacher_name, u.email AS teacher_email
      FROM teacher_support_chats tsc
      JOIN users u ON u.id = tsc.teacher_id
    `;
        const params = [];
        if (status) {
            query += ` WHERE tsc.status = $1`;
            params.push(status);
        }
        query += ` ORDER BY tsc.last_message_at DESC NULLS LAST, tsc.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
        params.push(limit, offset);
        const result = await pool_1.default.query(query, params);
        const countQuery = status
            ? `SELECT COUNT(*) FROM teacher_support_chats WHERE status = $1`
            : `SELECT COUNT(*) FROM teacher_support_chats`;
        const countResult = await pool_1.default.query(countQuery, status ? [status] : []);
        const total = parseInt(countResult.rows[0].count, 10);
        return {
            chats: result.rows,
            total,
        };
    }
}
exports.SupportChatService = SupportChatService;
