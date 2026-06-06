"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChatService = void 0;
const pool_1 = __importDefault(require("../db/pool"));
class ChatService {
    static async getOrCreateTeacherGradeGroup(gradeId, teacherId) {
        const res = await pool_1.default.query(`INSERT INTO chat_groups (grade_id, owner_teacher_id, name)
       VALUES ($1, $2, (SELECT name FROM grades WHERE id = $1))
       ON CONFLICT (grade_id, owner_teacher_id) DO UPDATE SET name = EXCLUDED.name
       RETURNING *`, [gradeId, teacherId]);
        return res.rows[0];
    }
    static async getOrCreatePackageSubjectGroupChat(packageSubjectGroupId) {
        // Derive grade_id from package -> grade, and keep owner_teacher_id in sync with group.teacher_id
        const meta = await pool_1.default.query(`SELECT
         g.id AS package_subject_group_id,
         g.name AS group_name,
         g.teacher_id,
         psi.id AS subject_id,
         psi.name AS subject_name,
         p.grade_id
       FROM package_subject_item_groups g
       JOIN package_subject_items psi ON psi.id = g.package_subject_item_id
       JOIN packages p ON p.id = psi.package_id
       WHERE g.id = $1`, [packageSubjectGroupId]);
        if (!meta.rowCount)
            throw new Error('Package subject group not found');
        const row = meta.rows[0];
        const gradeId = Number(row.grade_id);
        const name = `${row.subject_name} - ${row.group_name}`;
        const res = await pool_1.default.query(`INSERT INTO chat_groups (grade_id, owner_teacher_id, name, package_subject_group_id, allow_student_send)
       -- IMPORTANT:
       -- For package-subject-group chats we keep owner_teacher_id = NULL to avoid clashing
       -- with the legacy UNIQUE(grade_id, owner_teacher_id) used by teacher-grade groups.
       -- Teacher access is verified via package_subject_item_groups.teacher_id instead.
       VALUES ($1, NULL, $2, $3, TRUE)
       ON CONFLICT (package_subject_group_id)
       DO UPDATE SET
         grade_id = EXCLUDED.grade_id,
         name = EXCLUDED.name
       RETURNING *`, [gradeId, name, packageSubjectGroupId]);
        return res.rows[0];
    }
    static async listDirectTeachersForStudent(studentId) {
        // Teachers from courses (enrollments) + teachers assigned to package subject groups the student belongs to (activated by code)
        // Returns teachers with last message and unread count, sorted by last message time
        const res = await pool_1.default.query(`WITH course_teachers AS (
         SELECT DISTINCT c.teacher_id
         FROM enrollments e
         JOIN courses c ON c.id = e.course_id
         WHERE e.user_id = $1
       ),
       package_teachers AS (
         SELECT DISTINCT g.teacher_id
         FROM package_subject_item_group_students gs
         JOIN package_subject_item_groups g ON g.id = gs.group_id
         JOIN package_subject_items psi ON psi.id = g.package_subject_item_id
         JOIN package_activations pa ON pa.package_id = psi.package_id
         WHERE gs.student_id = $1
           AND pa.student_id = $1
           AND pa.is_active = TRUE
           AND pa.activation_code_id IS NOT NULL
           AND g.teacher_id IS NOT NULL
       ),
       teacher_ids AS (
         SELECT teacher_id FROM course_teachers
         UNION
         SELECT teacher_id FROM package_teachers
       ),
       teachers_with_chat AS (
         SELECT
           u.id,
           u.name,
           u.avatar,
           (SELECT cg.id FROM chat_groups cg WHERE cg.direct_student_id = $1 AND cg.direct_teacher_id = u.id LIMIT 1) AS chat_group_id
         FROM teacher_ids t
         JOIN users u ON u.id = t.teacher_id
         WHERE u.role = 'teacher'
       ),
       last_messages AS (
         SELECT DISTINCT ON (twc.id)
           twc.id,
           twc.name,
           twc.avatar,
           twc.chat_group_id,
           cm.id AS last_message_id,
           cm.text AS last_message_text,
           cm.sender_id AS last_message_sender_id,
           cm.created_at AS last_message_created_at,
           cm.attachment_url AS last_message_attachment_url,
           cm.attachment_type AS last_message_attachment_type,
           cm.created_at AS last_message_time
         FROM teachers_with_chat twc
         LEFT JOIN chat_messages cm ON cm.group_id = twc.chat_group_id
         ORDER BY twc.id, cm.created_at DESC NULLS LAST
       ),
       student_last_messages AS (
         SELECT
           lm.chat_group_id,
           MAX(cm.created_at) AS last_student_message_time
         FROM last_messages lm
         LEFT JOIN chat_messages cm ON cm.group_id = lm.chat_group_id AND cm.sender_id = $1
         WHERE lm.chat_group_id IS NOT NULL
         GROUP BY lm.chat_group_id
       ),
       unread_counts AS (
         SELECT
           lm.id AS teacher_id,
           lm.chat_group_id,
           COUNT(DISTINCT cm.id)::INTEGER AS unread_count
         FROM last_messages lm
         LEFT JOIN student_last_messages slm ON slm.chat_group_id = lm.chat_group_id
         LEFT JOIN chat_messages cm ON cm.group_id = lm.chat_group_id
           AND cm.sender_id != $1
           AND cm.created_at > COALESCE(slm.last_student_message_time, '1970-01-01'::timestamp)
         WHERE lm.chat_group_id IS NOT NULL
         GROUP BY lm.id, lm.chat_group_id
       )
       SELECT
         lm.id,
         lm.name,
         lm.avatar,
         lm.chat_group_id,
         lm.last_message_id,
         lm.last_message_text,
         lm.last_message_sender_id,
         lm.last_message_created_at,
         lm.last_message_attachment_url,
         lm.last_message_attachment_type,
         COALESCE(uc.unread_count, 0) AS unread_count
       FROM last_messages lm
       LEFT JOIN unread_counts uc ON uc.teacher_id = lm.id AND uc.chat_group_id = lm.chat_group_id
       ORDER BY COALESCE(lm.last_message_time, '1970-01-01'::timestamp) DESC, lm.name`, [studentId]);
        return res.rows;
    }
    static async studentCanChatWithTeacher(studentId, teacherId) {
        const res = await pool_1.default.query(`SELECT 1
       FROM (
         SELECT 1
         FROM enrollments e
         JOIN courses c ON c.id = e.course_id
         WHERE e.user_id = $1 AND c.teacher_id = $2
         LIMIT 1
       ) x
       UNION ALL
       SELECT 1
       FROM package_subject_item_group_students gs
       JOIN package_subject_item_groups g ON g.id = gs.group_id
       JOIN package_subject_items psi ON psi.id = g.package_subject_item_id
       JOIN package_activations pa ON pa.package_id = psi.package_id
       WHERE gs.student_id = $1
         AND g.teacher_id = $2
         AND pa.student_id = $1
         AND pa.is_active = TRUE
         AND pa.activation_code_id IS NOT NULL
       LIMIT 1`, [studentId, teacherId]);
        return (res.rowCount ?? 0) > 0;
    }
    static async teacherCanChatWithStudent(teacherId, studentId) {
        // Eligible if:
        // 1) student enrolled in a course taught by teacher, OR
        // 2) student is in a package subject group assigned to teacher (and activated by code)
        const res = await pool_1.default.query(`SELECT 1
       FROM (
         SELECT 1
         FROM enrollments e
         JOIN courses c ON c.id = e.course_id
         WHERE c.teacher_id = $1 AND e.user_id = $2
         LIMIT 1
       ) x
       UNION ALL
       SELECT 1
       FROM package_subject_item_group_students gs
       JOIN package_subject_item_groups g ON g.id = gs.group_id
       JOIN package_subject_items psi ON psi.id = g.package_subject_item_id
       JOIN package_activations pa ON pa.package_id = psi.package_id
       WHERE g.teacher_id = $1
         AND gs.student_id = $2
         AND pa.student_id = $2
         AND pa.is_active = TRUE
         AND pa.activation_code_id IS NOT NULL
       LIMIT 1`, [teacherId, studentId]);
        return (res.rowCount ?? 0) > 0;
    }
    static async listDirectStudentsForTeacher(teacherId) {
        // Students from teacher courses + students in package groups assigned to teacher
        // plus any existing direct chats (so teacher sees ongoing conversations even if student no longer eligible).
        // Returns students sorted by last message time, with last message and unread count.
        const res = await pool_1.default.query(`WITH course_students AS (
         SELECT DISTINCT e.user_id AS student_id
         FROM enrollments e
         JOIN courses c ON c.id = e.course_id
         WHERE c.teacher_id = $1
       ),
       package_students AS (
         SELECT DISTINCT gs.student_id
         FROM package_subject_item_group_students gs
         JOIN package_subject_item_groups g ON g.id = gs.group_id
         JOIN package_subject_items psi ON psi.id = g.package_subject_item_id
         JOIN package_activations pa ON pa.package_id = psi.package_id
         WHERE g.teacher_id = $1
           AND pa.student_id = gs.student_id
           AND pa.is_active = TRUE
           AND pa.activation_code_id IS NOT NULL
       ),
       chatted_students AS (
         SELECT DISTINCT direct_student_id AS student_id
         FROM chat_groups
         WHERE direct_teacher_id = $1 AND direct_student_id IS NOT NULL
       ),
       student_ids AS (
         SELECT student_id FROM course_students
         UNION
         SELECT student_id FROM package_students
         UNION
         SELECT student_id FROM chatted_students
       ),
       students_with_chat AS (
         SELECT
           u.id,
           u.name,
           u.avatar,
           (SELECT cg.id FROM chat_groups cg WHERE cg.direct_student_id = u.id AND cg.direct_teacher_id = $1 LIMIT 1) AS chat_group_id
         FROM student_ids s
         JOIN users u ON u.id = s.student_id
         WHERE u.role = 'student'
       ),
       last_messages AS (
         SELECT DISTINCT ON (swc.id)
           swc.id AS student_id,
           swc.name,
           swc.avatar,
           swc.chat_group_id,
           cm.id AS last_message_id,
           cm.text AS last_message_text,
           cm.sender_id AS last_message_sender_id,
           cm.created_at AS last_message_created_at,
           cm.attachment_url AS last_message_attachment_url,
           cm.attachment_type AS last_message_attachment_type,
           cm.created_at AS last_message_time
         FROM students_with_chat swc
         LEFT JOIN chat_messages cm ON cm.group_id = swc.chat_group_id
         ORDER BY swc.id, cm.created_at DESC NULLS LAST
       ),
       teacher_last_messages AS (
         SELECT
           swc.chat_group_id,
           MAX(cm.created_at) AS last_teacher_message_time
         FROM students_with_chat swc
         LEFT JOIN chat_messages cm ON cm.group_id = swc.chat_group_id AND cm.sender_id = $1
         WHERE swc.chat_group_id IS NOT NULL
         GROUP BY swc.chat_group_id
       ),
       unread_counts AS (
         SELECT
           lm.student_id,
           lm.chat_group_id,
           COUNT(*) AS unread_count
         FROM last_messages lm
         JOIN chat_messages cm ON cm.group_id = lm.chat_group_id
         LEFT JOIN teacher_last_messages tlm ON tlm.chat_group_id = lm.chat_group_id
         WHERE cm.sender_id = lm.student_id
           AND lm.chat_group_id IS NOT NULL
           AND cm.created_at > COALESCE(tlm.last_teacher_message_time, '1970-01-01'::timestamp)
         GROUP BY lm.student_id, lm.chat_group_id
       )
       SELECT
         lm.student_id AS id,
         lm.name,
         lm.avatar,
         lm.chat_group_id,
         lm.last_message_id,
         lm.last_message_text,
         lm.last_message_sender_id,
         lm.last_message_created_at,
         lm.last_message_attachment_url,
         lm.last_message_attachment_type,
         COALESCE(uc.unread_count, 0) AS unread_count
       FROM last_messages lm
       LEFT JOIN unread_counts uc ON uc.student_id = lm.student_id AND uc.chat_group_id = lm.chat_group_id
       ORDER BY COALESCE(lm.last_message_time, '1970-01-01'::timestamp) DESC, lm.name`, [teacherId]);
        return res.rows;
    }
    static async getOrCreateDirectChat(studentId, teacherId) {
        // pick a grade_id (required by chat_groups schema): prefer student's first grade, fallback to teacher's first grade, else any grade
        const gradeRes = await pool_1.default.query(`SELECT grade_id FROM user_grades WHERE user_id = $1 ORDER BY grade_id LIMIT 1`, [studentId]);
        let gradeId = gradeRes.rowCount ? Number(gradeRes.rows[0].grade_id) : null;
        if (!gradeId) {
            const tGrade = await pool_1.default.query(`SELECT grade_id FROM teacher_grades WHERE teacher_id = $1 ORDER BY grade_id LIMIT 1`, [teacherId]);
            gradeId = tGrade.rowCount ? Number(tGrade.rows[0].grade_id) : null;
        }
        if (!gradeId) {
            const any = await pool_1.default.query(`SELECT id FROM grades ORDER BY id LIMIT 1`);
            gradeId = any.rowCount ? Number(any.rows[0].id) : 1;
        }
        const res = await pool_1.default.query(`INSERT INTO chat_groups (grade_id, owner_teacher_id, name, allow_student_send, direct_student_id, direct_teacher_id)
       VALUES ($1, NULL, $2, TRUE, $3, $4)
       ON CONFLICT (direct_student_id, direct_teacher_id)
       DO UPDATE SET name = EXCLUDED.name
       RETURNING *`, [gradeId, `Direct Chat`, studentId, teacherId]);
        const group = res.rows[0];
        await this.addMember(group.id, studentId, 'student');
        await this.addMember(group.id, teacherId, 'teacher');
        return group;
    }
    static async addMember(groupId, userId, role = 'student') {
        await pool_1.default.query(`INSERT INTO chat_group_members (group_id, user_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (group_id, user_id) DO UPDATE SET role = EXCLUDED.role`, [groupId, userId, role]);
    }
    static async removeMember(groupId, userId) {
        await pool_1.default.query(`DELETE FROM chat_group_members WHERE group_id = $1 AND user_id = $2`, [
            groupId,
            userId,
        ]);
    }
    static async listMembers(groupId) {
        const res = await pool_1.default.query(`SELECT u.id, u.name, u.role, cgm.joined_at
       FROM chat_group_members cgm
       JOIN users u ON u.id = cgm.user_id
       WHERE cgm.group_id = $1
       ORDER BY u.name`, [groupId]);
        return res.rows;
    }
    static async setStudentPermission(groupId, allow) {
        await pool_1.default.query(`UPDATE chat_groups SET allow_student_send = $1 WHERE id = $2`, [
            allow,
            groupId,
        ]);
    }
    static async canStudentSend(groupId) {
        const res = await pool_1.default.query(`SELECT allow_student_send FROM chat_groups WHERE id = $1`, [
            groupId,
        ]);
        return res.rowCount ? Boolean(res.rows[0].allow_student_send) : false;
    }
    static async saveMessage(groupId, senderId, text, replyTo) {
        const res = await pool_1.default.query(`INSERT INTO chat_messages (group_id, sender_id, text, reply_to_message_id)
       VALUES ($1, $2, $3, $4)
       RETURNING *`, [groupId, senderId, text, replyTo ?? null]);
        return res.rows[0];
    }
    static async saveAttachmentMessage(groupId, senderId, attachment) {
        const res = await pool_1.default.query(`INSERT INTO chat_messages (group_id, sender_id, text, attachment_url, attachment_type, attachment_name, attachment_mime, attachment_size, attachment_duration_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`, [
            groupId,
            senderId,
            attachment.text ?? null,
            attachment.url,
            attachment.type,
            attachment.name ?? null,
            attachment.mime ?? null,
            attachment.size ?? null,
            attachment.durationMs ?? null,
        ]);
        return res.rows[0];
    }
    static async getHistory(groupId, limit = 50, before) {
        const params = [groupId];
        let where = 'WHERE m.group_id = $1';
        if (before) {
            params.push(before);
            where += ` AND m.created_at < $2`;
        }
        params.push(limit);
        const res = await pool_1.default.query(`SELECT m.*, u.name as sender_name,
              rm.id as reply_id,
              ru.name as reply_sender_name,
              rm.sender_id as reply_sender_id,
              rm.text as reply_text,
              rm.attachment_type as reply_attachment_type,
              rm.attachment_url as reply_attachment_url,
              rm.attachment_name as reply_attachment_name,
              rm.attachment_mime as reply_attachment_mime,
              rm.attachment_size as reply_attachment_size,
              rm.created_at as reply_created_at
       FROM chat_messages m
       LEFT JOIN users u ON u.id = m.sender_id
       LEFT JOIN chat_messages rm ON rm.id = m.reply_to_message_id
       LEFT JOIN users ru ON ru.id = rm.sender_id
       ${where}
       ORDER BY m.created_at DESC
       LIMIT $${params.length}`, params);
        return res.rows.reverse().map((row) => ({
            ...row,
            reply_to_message_id: row.reply_to_message_id ?? null,
            reply: row.reply_id
                ? {
                    id: row.reply_id,
                    sender_id: row.reply_sender_id,
                    sender_name: row.reply_sender_name,
                    text: row.reply_text,
                    attachment_type: row.reply_attachment_type,
                    attachment_url: row.reply_attachment_url,
                    attachment_name: row.reply_attachment_name,
                    attachment_mime: row.reply_attachment_mime,
                    attachment_size: row.reply_attachment_size,
                    created_at: row.reply_created_at,
                }
                : null,
            reply_preview: row.reply_id
                ? {
                    id: row.reply_id,
                    sender_id: row.reply_sender_id,
                    sender_name: row.reply_sender_name,
                    text: row.reply_text,
                    attachment_type: row.reply_attachment_type,
                    attachment_url: row.reply_attachment_url,
                    attachment_name: row.reply_attachment_name,
                    attachment_mime: row.reply_attachment_mime,
                    attachment_size: row.reply_attachment_size,
                    created_at: row.reply_created_at,
                }
                : null,
        }));
    }
    static async getGroupsForStudent(userId) {
        const res = await pool_1.default.query(`SELECT DISTINCT cg.*
       FROM enrollments e
       JOIN courses c ON c.id = e.course_id
       JOIN chat_groups cg ON cg.grade_id = c.grade_id AND cg.owner_teacher_id = c.teacher_id
       WHERE e.user_id = $1
       ORDER BY cg.grade_id, cg.owner_teacher_id`, [userId]);
        return res.rows;
    }
    static async ensureStudentMembershipForEnrollments(userId) {
        // Ensure membership for each teacher-grade group where the student is enrolled
        const groups = await this.getGroupsForStudent(userId);
        for (const group of groups) {
            await this.addMember(group.id, userId, 'student');
        }
    }
    static async getTeacherContacts(studentId) {
        // Get teachers from courses the student is enrolled in
        const res = await pool_1.default.query(`SELECT DISTINCT u.id, u.name, u.role, u.avatar
       FROM enrollments e
       JOIN courses c ON c.id = e.course_id
       JOIN users u ON u.id = c.teacher_id
       WHERE e.user_id = $1`, [studentId]);
        return res.rows;
    }
    static async getStudentContacts(teacherId) {
        // Get students from groups owned by the teacher
        const res = await pool_1.default.query(`SELECT DISTINCT u.id, u.name, u.role, u.avatar
         FROM chat_groups cg
         JOIN chat_group_members cgm ON cgm.group_id = cg.id
         JOIN users u ON u.id = cgm.user_id
         WHERE cg.owner_teacher_id = $1 AND cgm.role = 'student'`, [teacherId]);
        return res.rows;
    }
    static async ensureStudentMembershipForPackageSubjectGroups(studentId) {
        const groupsRes = await pool_1.default.query(`SELECT DISTINCT gs.group_id
       FROM package_subject_item_group_students gs
       JOIN package_subject_item_groups g ON g.id = gs.group_id
       JOIN package_subject_items psi ON psi.id = g.package_subject_item_id
       JOIN package_activations pa ON pa.package_id = psi.package_id
       WHERE gs.student_id = $1
         AND pa.student_id = $1
         AND pa.is_active = TRUE
         AND pa.activation_code_id IS NOT NULL`, [studentId]);
        for (const r of groupsRes.rows) {
            const packageGroupId = Number(r.group_id);
            const teacherRes = await pool_1.default.query(`SELECT teacher_id FROM package_subject_item_groups WHERE id = $1`, [packageGroupId]);
            const teacherId = teacherRes.rowCount ? teacherRes.rows[0].teacher_id : null;
            const chatGroup = await this.getOrCreatePackageSubjectGroupChat(packageGroupId);
            await this.addMember(chatGroup.id, studentId, 'student');
            if (teacherId) {
                await this.addMember(chatGroup.id, teacherId, 'teacher');
            }
        }
    }
    /**
     * Get chat notifications for a user (student or teacher)
     * Returns list of chat groups with unread count and last message
     */
    static async getChatNotifications(params) {
        const limit = params.limit ?? 20;
        const offset = params.offset ?? 0;
        const unreadOnly = params.unreadOnly ?? false;
        if (params.role === 'student') {
            // For students: get direct chats with teachers + package groups + grade groups
            const res = await pool_1.default.query(`WITH user_groups AS (
          -- Direct chats
          SELECT 
            cg.id AS chat_group_id,
            'direct' AS chat_type,
            cg.direct_teacher_id AS other_user_id,
            u.name AS other_user_name,
            u.avatar AS other_user_avatar,
            NULL::INTEGER AS package_subject_group_id,
            NULL::INTEGER AS grade_id,
            NULL::INTEGER AS owner_teacher_id,
            cg.name AS group_name
          FROM chat_groups cg
          JOIN users u ON u.id = cg.direct_teacher_id
          JOIN chat_group_members cgm ON cgm.group_id = cg.id
          WHERE cg.direct_student_id = $1
            AND cgm.user_id = $1
            AND cg.direct_teacher_id IS NOT NULL
          
          UNION ALL
          
          -- Package subject groups
          SELECT 
            cg.id AS chat_group_id,
            'package_subject' AS chat_type,
            g.teacher_id AS other_user_id,
            tu.name AS other_user_name,
            tu.avatar AS other_user_avatar,
            g.id AS package_subject_group_id,
            cg.grade_id,
            NULL::INTEGER AS owner_teacher_id,
            psi.name AS group_name
          FROM chat_groups cg
          JOIN package_subject_item_groups g ON g.id = cg.package_subject_group_id
          JOIN package_subject_items psi ON psi.id = g.package_subject_item_id
          JOIN chat_group_members cgm ON cgm.group_id = cg.id
          LEFT JOIN users tu ON tu.id = g.teacher_id
          WHERE cgm.user_id = $1
            AND cg.package_subject_group_id IS NOT NULL
          
          UNION ALL
          
          -- Grade-based groups (legacy)
          SELECT 
            cg.id AS chat_group_id,
            'grade' AS chat_type,
            cg.owner_teacher_id AS other_user_id,
            tu.name AS other_user_name,
            tu.avatar AS other_user_avatar,
            NULL::INTEGER AS package_subject_group_id,
            cg.grade_id,
            cg.owner_teacher_id,
            cg.name AS group_name
          FROM chat_groups cg
          JOIN chat_group_members cgm ON cgm.group_id = cg.id
          JOIN enrollments e ON e.user_id = $1
          JOIN courses c ON c.id = e.course_id
          LEFT JOIN users tu ON tu.id = cg.owner_teacher_id
          WHERE cgm.user_id = $1
            AND cg.owner_teacher_id IS NOT NULL
            AND cg.package_subject_group_id IS NULL
            AND cg.direct_student_id IS NULL
            AND cg.grade_id = c.grade_id
            AND cg.owner_teacher_id = c.teacher_id
        ),
        last_messages AS (
          SELECT DISTINCT ON (ug.chat_group_id)
            ug.chat_group_id,
            ug.chat_type,
            ug.other_user_id,
            ug.other_user_name,
            ug.other_user_avatar,
            ug.package_subject_group_id,
            ug.grade_id,
            ug.owner_teacher_id,
            ug.group_name,
            cm.id AS last_message_id,
            cm.sender_id AS last_message_sender_id,
            cm.text AS last_message_text,
            cm.attachment_url AS last_message_attachment_url,
            cm.attachment_type AS last_message_attachment_type,
            cm.created_at AS last_message_created_at
          FROM user_groups ug
          LEFT JOIN chat_messages cm ON cm.group_id = ug.chat_group_id
          ORDER BY ug.chat_group_id, cm.created_at DESC NULLS LAST
        ),
        user_last_read AS (
          SELECT 
            lm.chat_group_id,
            MAX(cm.created_at) AS last_read_time
          FROM last_messages lm
          JOIN chat_messages cm ON cm.group_id = lm.chat_group_id AND cm.sender_id = $1
          WHERE lm.chat_group_id IS NOT NULL
          GROUP BY lm.chat_group_id
        ),
        unread_counts AS (
          SELECT 
            lm.chat_group_id,
            COUNT(DISTINCT cm.id)::INTEGER AS unread_count
          FROM last_messages lm
          LEFT JOIN user_last_read ulr ON ulr.chat_group_id = lm.chat_group_id
          LEFT JOIN chat_messages cm ON cm.group_id = lm.chat_group_id
            AND cm.sender_id != $1
            AND cm.created_at > COALESCE(ulr.last_read_time, '1970-01-01'::timestamp)
          WHERE lm.chat_group_id IS NOT NULL
          GROUP BY lm.chat_group_id
        )
        SELECT 
          lm.chat_group_id,
          lm.chat_type,
          lm.other_user_id,
          lm.other_user_name,
          lm.other_user_avatar,
          lm.package_subject_group_id,
          lm.grade_id,
          lm.owner_teacher_id,
          lm.group_name,
          lm.last_message_id,
          lm.last_message_sender_id,
          lm.last_message_text,
          lm.last_message_attachment_url,
          lm.last_message_attachment_type,
          lm.last_message_created_at,
          COALESCE(uc.unread_count, 0) AS unread_count
        FROM last_messages lm
        LEFT JOIN unread_counts uc ON uc.chat_group_id = lm.chat_group_id
        ${unreadOnly ? 'WHERE COALESCE(uc.unread_count, 0) > 0' : ''}
        ORDER BY COALESCE(lm.last_message_created_at, '1970-01-01'::timestamp) DESC
        LIMIT $2 OFFSET $3`, [params.userId, limit, offset]);
            const totalRes = await pool_1.default.query(`WITH user_groups AS (
          SELECT cg.id AS chat_group_id
          FROM chat_groups cg
          JOIN chat_group_members cgm ON cgm.group_id = cg.id
          WHERE cgm.user_id = $1
            AND (cg.direct_student_id = $1 OR cg.package_subject_group_id IS NOT NULL OR 
                 (cg.owner_teacher_id IS NOT NULL AND cg.package_subject_group_id IS NULL AND cg.direct_student_id IS NULL))
        ),
        unread_counts AS (
          SELECT 
            ug.chat_group_id,
            COUNT(DISTINCT cm.id)::INTEGER AS unread_count
          FROM user_groups ug
          LEFT JOIN (
            SELECT group_id AS chat_group_id, MAX(created_at) AS last_read_time
            FROM chat_messages
            WHERE sender_id = $1
            GROUP BY group_id
          ) ulr ON ulr.chat_group_id = ug.chat_group_id
          LEFT JOIN chat_messages cm ON cm.group_id = ug.chat_group_id
            AND cm.sender_id != $1
            AND cm.created_at > COALESCE(ulr.last_read_time, '1970-01-01'::timestamp)
          WHERE ug.chat_group_id IS NOT NULL
          GROUP BY ug.chat_group_id
        )
        SELECT COUNT(*) AS total
        FROM user_groups ug
        ${unreadOnly ? 'LEFT JOIN unread_counts uc ON uc.chat_group_id = ug.chat_group_id WHERE COALESCE(uc.unread_count, 0) > 0' : ''}`, [params.userId]);
            return {
                items: res.rows.map((row) => ({
                    chat_group_id: row.chat_group_id,
                    chat_type: row.chat_type,
                    other_user: row.other_user_id
                        ? {
                            id: row.other_user_id,
                            name: row.other_user_name,
                            avatar: row.other_user_avatar,
                        }
                        : null,
                    package_subject_group_id: row.package_subject_group_id,
                    grade_id: row.grade_id,
                    owner_teacher_id: row.owner_teacher_id,
                    group_name: row.group_name,
                    unread_count: Number(row.unread_count) || 0,
                    last_message: row.unread_count > 0 && row.last_message_id
                        ? {
                            id: row.last_message_id,
                            sender_id: row.last_message_sender_id,
                            text: row.last_message_text,
                            attachment_url: row.last_message_attachment_url,
                            attachment_type: row.last_message_attachment_type,
                            created_at: row.last_message_created_at,
                        }
                        : undefined,
                })),
                total: Number(totalRes.rows[0]?.total || 0),
            };
        }
        else {
            // For teachers: get direct chats with students + package groups + grade groups
            const res = await pool_1.default.query(`WITH user_groups AS (
          -- Direct chats
          SELECT 
            cg.id AS chat_group_id,
            'direct' AS chat_type,
            cg.direct_student_id AS other_user_id,
            u.name AS other_user_name,
            u.avatar AS other_user_avatar,
            NULL::INTEGER AS package_subject_group_id,
            NULL::INTEGER AS grade_id,
            NULL::INTEGER AS owner_teacher_id,
            cg.name AS group_name
          FROM chat_groups cg
          JOIN users u ON u.id = cg.direct_student_id
          JOIN chat_group_members cgm ON cgm.group_id = cg.id
          WHERE cg.direct_teacher_id = $1
            AND cgm.user_id = $1
            AND cg.direct_student_id IS NOT NULL
          
          UNION ALL
          
          -- Package subject groups
          SELECT 
            cg.id AS chat_group_id,
            'package_subject' AS chat_type,
            NULL::INTEGER AS other_user_id,
            NULL::TEXT AS other_user_name,
            NULL::TEXT AS other_user_avatar,
            g.id AS package_subject_group_id,
            cg.grade_id,
            NULL::INTEGER AS owner_teacher_id,
            psi.name AS group_name
          FROM chat_groups cg
          JOIN package_subject_item_groups g ON g.id = cg.package_subject_group_id
          JOIN package_subject_items psi ON psi.id = g.package_subject_item_id
          JOIN chat_group_members cgm ON cgm.group_id = cg.id
          WHERE cgm.user_id = $1
            AND cg.package_subject_group_id IS NOT NULL
            AND g.teacher_id = $1
          
          UNION ALL
          
          -- Grade-based groups (legacy)
          SELECT 
            cg.id AS chat_group_id,
            'grade' AS chat_type,
            NULL::INTEGER AS other_user_id,
            NULL::TEXT AS other_user_name,
            NULL::TEXT AS other_user_avatar,
            NULL::INTEGER AS package_subject_group_id,
            cg.grade_id,
            cg.owner_teacher_id,
            cg.name AS group_name
          FROM chat_groups cg
          JOIN chat_group_members cgm ON cgm.group_id = cg.id
          WHERE cgm.user_id = $1
            AND cg.owner_teacher_id = $1
            AND cg.package_subject_group_id IS NULL
            AND cg.direct_student_id IS NULL
        ),
        last_messages AS (
          SELECT DISTINCT ON (ug.chat_group_id)
            ug.chat_group_id,
            ug.chat_type,
            ug.other_user_id,
            ug.other_user_name,
            ug.other_user_avatar,
            ug.package_subject_group_id,
            ug.grade_id,
            ug.owner_teacher_id,
            ug.group_name,
            cm.id AS last_message_id,
            cm.sender_id AS last_message_sender_id,
            cm.text AS last_message_text,
            cm.attachment_url AS last_message_attachment_url,
            cm.attachment_type AS last_message_attachment_type,
            cm.created_at AS last_message_created_at
          FROM user_groups ug
          LEFT JOIN chat_messages cm ON cm.group_id = ug.chat_group_id
          ORDER BY ug.chat_group_id, cm.created_at DESC NULLS LAST
        ),
        user_last_read AS (
          SELECT 
            lm.chat_group_id,
            MAX(cm.created_at) AS last_read_time
          FROM last_messages lm
          JOIN chat_messages cm ON cm.group_id = lm.chat_group_id AND cm.sender_id = $1
          WHERE lm.chat_group_id IS NOT NULL
          GROUP BY lm.chat_group_id
        ),
        unread_counts AS (
          SELECT 
            lm.chat_group_id,
            COUNT(DISTINCT cm.id)::INTEGER AS unread_count
          FROM last_messages lm
          LEFT JOIN user_last_read ulr ON ulr.chat_group_id = lm.chat_group_id
          LEFT JOIN chat_messages cm ON cm.group_id = lm.chat_group_id
            AND cm.sender_id != $1
            AND cm.created_at > COALESCE(ulr.last_read_time, '1970-01-01'::timestamp)
          WHERE lm.chat_group_id IS NOT NULL
          GROUP BY lm.chat_group_id
        )
        SELECT 
          lm.chat_group_id,
          lm.chat_type,
          lm.other_user_id,
          lm.other_user_name,
          lm.other_user_avatar,
          lm.package_subject_group_id,
          lm.grade_id,
          lm.owner_teacher_id,
          lm.group_name,
          lm.last_message_id,
          lm.last_message_sender_id,
          lm.last_message_text,
          lm.last_message_attachment_url,
          lm.last_message_attachment_type,
          lm.last_message_created_at,
          COALESCE(uc.unread_count, 0) AS unread_count
        FROM last_messages lm
        LEFT JOIN unread_counts uc ON uc.chat_group_id = lm.chat_group_id
        ${unreadOnly ? 'WHERE COALESCE(uc.unread_count, 0) > 0' : ''}
        ORDER BY COALESCE(lm.last_message_created_at, '1970-01-01'::timestamp) DESC
        LIMIT $2 OFFSET $3`, [params.userId, limit, offset]);
            const totalRes = await pool_1.default.query(`WITH user_groups AS (
          SELECT cg.id AS chat_group_id
          FROM chat_groups cg
          JOIN chat_group_members cgm ON cgm.group_id = cg.id
          WHERE cgm.user_id = $1
            AND (cg.direct_teacher_id = $1 OR 
                 (cg.package_subject_group_id IS NOT NULL AND EXISTS (
                   SELECT 1 FROM package_subject_item_groups g 
                   WHERE g.id = cg.package_subject_group_id AND g.teacher_id = $1
                 )) OR 
                 (cg.owner_teacher_id = $1 AND cg.package_subject_group_id IS NULL AND cg.direct_student_id IS NULL))
        ),
        unread_counts AS (
          SELECT 
            ug.chat_group_id,
            COUNT(DISTINCT cm.id)::INTEGER AS unread_count
          FROM user_groups ug
          LEFT JOIN (
            SELECT group_id AS chat_group_id, MAX(created_at) AS last_read_time
            FROM chat_messages
            WHERE sender_id = $1
            GROUP BY group_id
          ) ulr ON ulr.chat_group_id = ug.chat_group_id
          LEFT JOIN chat_messages cm ON cm.group_id = ug.chat_group_id
            AND cm.sender_id != $1
            AND cm.created_at > COALESCE(ulr.last_read_time, '1970-01-01'::timestamp)
          WHERE ug.chat_group_id IS NOT NULL
          GROUP BY ug.chat_group_id
        )
        SELECT COUNT(*) AS total
        FROM user_groups ug
        ${unreadOnly ? 'LEFT JOIN unread_counts uc ON uc.chat_group_id = ug.chat_group_id WHERE COALESCE(uc.unread_count, 0) > 0' : ''}`, [params.userId]);
            return {
                items: res.rows.map((row) => ({
                    chat_group_id: row.chat_group_id,
                    chat_type: row.chat_type,
                    other_user: row.other_user_id
                        ? {
                            id: row.other_user_id,
                            name: row.other_user_name,
                            avatar: row.other_user_avatar,
                        }
                        : null,
                    package_subject_group_id: row.package_subject_group_id,
                    grade_id: row.grade_id,
                    owner_teacher_id: row.owner_teacher_id,
                    group_name: row.group_name,
                    unread_count: Number(row.unread_count) || 0,
                    last_message: row.unread_count > 0 && row.last_message_id
                        ? {
                            id: row.last_message_id,
                            sender_id: row.last_message_sender_id,
                            text: row.last_message_text,
                            attachment_url: row.last_message_attachment_url,
                            attachment_type: row.last_message_attachment_type,
                            created_at: row.last_message_created_at,
                        }
                        : undefined,
                })),
                total: Number(totalRes.rows[0]?.total || 0),
            };
        }
    }
}
exports.ChatService = ChatService;
