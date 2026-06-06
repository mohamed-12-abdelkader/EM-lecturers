"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const express_1 = require("express");
const authentication_1 = require("../middleware/authentication");
const utils_1 = require("../utils");
const GameService_1 = require("../services/GameService");
const pool_1 = __importDefault(require("../db/pool"));
exports.router = (0, express_1.Router)();
// API لإرسال دعوة لعبة
exports.router.post('/invite', (0, authentication_1.authMiddleware)(['student']), (0, utils_1.asyncWrapper)(async (req, res) => {
    try {
        const inviterId = req.user.id;
        const { inviteeIds, lessonIds, questionsCount = 10 } = req.body;
        console.log(`[invite API] Creating bulk invitations:`);
        console.log(`  - inviterId (from JWT): ${inviterId} (type: ${typeof inviterId})`);
        console.log(`  - inviteeIds:`, inviteeIds);
        console.log(`  - lessonIds:`, lessonIds);
        console.log(`  - req.user object:`, { id: req.user?.id, role: req.user?.role });
        // التحقق من صحة البيانات
        if (!inviteeIds || !Array.isArray(inviteeIds) || inviteeIds.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'يجب تحديد الطلاب المدعوين',
            });
        }
        if (!lessonIds || !Array.isArray(lessonIds) || lessonIds.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'يجب تحديد الدروس',
            });
        }
        // التحقق من الحد الأقصى للطلاب (8 طلاب)
        if (inviteeIds.length > 8) {
            return res.status(400).json({
                success: false,
                message: 'لا يمكن إرسال دعوة لأكثر من 8 طلاب في المرة الواحدة',
            });
        }
        // التحقق من أن المستخدم لا يرسل دعوة لنفسه
        if (inviteeIds.includes(inviterId)) {
            return res.status(400).json({
                success: false,
                message: 'لا يمكنك إرسال دعوة لنفسك',
            });
        }
        // التحقق من عدم تكرار الطلاب
        const uniqueInviteeIds = [...new Set(inviteeIds)];
        if (uniqueInviteeIds.length !== inviteeIds.length) {
            return res.status(400).json({
                success: false,
                message: 'لا يمكن إرسال دعوة لنفس الطالب أكثر من مرة',
            });
        }
        if (questionsCount < 5 || questionsCount > 50) {
            return res.status(400).json({
                success: false,
                message: 'عدد الأسئلة يجب أن يكون بين 5 و 50',
            });
        }
        const invitations = await GameService_1.GameService.createBulkInvitations(inviterId, inviteeIds, lessonIds, questionsCount);
        console.log(`[invite API] Bulk invitations created successfully:`);
        console.log(`  - Total invitations: ${invitations.length}`);
        console.log(`  - Successfully sent to: ${invitations.filter((inv) => inv.success).length} students`);
        console.log(`  - Failed to send to: ${invitations.filter((inv) => !inv.success).length} students`);
        // Support both column names (selected_lessons or lesson_ids)
        const responseLessonIds = (invitations[0]?.invitation?.lesson_ids ||
            invitations[0]?.invitation?.selected_lessons ||
            []).map((id) => parseInt(id));
        res.json({
            success: true,
            message: `تم إرسال الدعوات بنجاح لـ ${invitations.filter((inv) => inv.success).length} من ${inviteeIds.length} طالب`,
            data: {
                totalInvited: inviteeIds.length,
                successfulInvitations: invitations.filter((inv) => inv.success).length,
                failedInvitations: invitations.filter((inv) => !inv.success).length,
                lessonIds: responseLessonIds,
                questionsCount: questionsCount,
                invitations: invitations.map((inv) => ({
                    inviteeId: inv.inviteeId,
                    success: inv.success,
                    invitationId: inv.invitation?.id || null,
                    error: inv.error || null,
                })),
            },
        });
    }
    catch (error) {
        console.error('Error in invite API:', error);
        res.status(400).json({
            success: false,
            message: error.message,
        });
    }
}));
// API لقبول الدعوة
exports.router.post('/accept/:invitationId', (0, authentication_1.authMiddleware)(['student']), (0, utils_1.asyncWrapper)(async (req, res) => {
    try {
        const inviteeId = req.user.id;
        const invitationId = Number(req.params.invitationId);
        if (isNaN(invitationId)) {
            return res.status(400).json({
                success: false,
                message: 'معرف الدعوة غير صحيح',
            });
        }
        // جلب معلومات الدعوة قبل القبول
        const invitationBefore = await pool_1.default.query(`SELECT inviter_id, invitee_id FROM game_invitations WHERE id = $1`, [invitationId]);
        const room = await GameService_1.GameService.acceptInvitation(invitationId, inviteeId);
        // فقط بعد نجاح العملية - إرسال تحديث real-time للطالب المرسل (inviter)
        if (invitationBefore.rowCount && invitationBefore.rowCount > 0) {
            const inviterId = invitationBefore.rows[0].inviter_id;
            const emitInvitationUpdate = global.app?.emitInvitationStatusUpdate;
            if (emitInvitationUpdate) {
                // استخدام setTimeout لتأخير الإرسال قليلاً للتأكد من نجاح العملية
                setImmediate(async () => {
                    try {
                        await emitInvitationUpdate(inviterId, invitationId);
                    }
                    catch (err) {
                        console.error('Error emitting invitation update:', err);
                    }
                });
            }
        }
        // إرسال تحديث real-time للطالب المستلم (invitee) - تحديث latest incoming
        const emitLatestIncoming = global.app?.emitLatestIncomingUpdate;
        if (emitLatestIncoming) {
            setImmediate(async () => {
                try {
                    await emitLatestIncoming(inviteeId);
                }
                catch (err) {
                    console.error('Error emitting latest incoming update:', err);
                }
            });
        }
        res.json({
            success: true,
            message: 'تم قبول الدعوة وإنشاء غرفة اللعبة',
            data: {
                roomId: room.id,
                player1Id: room.player1_id,
                player2Id: room.player2_id,
                questionsCount: room.questions_count,
                timePerQuestion: room.time_per_question,
                totalTime: room.total_time,
            },
        });
    }
    catch (error) {
        console.error('Error in accept API:', error);
        res.status(400).json({
            success: false,
            message: error.message,
        });
    }
}));
// API لرفض الدعوة
exports.router.post('/reject/:invitationId', (0, authentication_1.authMiddleware)(['student']), (0, utils_1.asyncWrapper)(async (req, res) => {
    try {
        const inviteeId = req.user.id;
        const invitationId = Number(req.params.invitationId);
        if (isNaN(invitationId)) {
            return res.status(400).json({
                success: false,
                message: 'معرف الدعوة غير صحيح',
            });
        }
        // جلب معلومات الدعوة قبل الرفض
        const invitationBefore = await pool_1.default.query(`SELECT inviter_id, invitee_id FROM game_invitations WHERE id = $1`, [invitationId]);
        await GameService_1.GameService.rejectInvitation(invitationId, inviteeId);
        // إرسال تحديث real-time للطالب المرسل (inviter)
        if (invitationBefore.rowCount && invitationBefore.rowCount > 0) {
            const inviterId = invitationBefore.rows[0].inviter_id;
            const emitInvitationUpdate = global.app?.emitInvitationStatusUpdate;
            if (emitInvitationUpdate) {
                await emitInvitationUpdate(inviterId, invitationId);
            }
        }
        // إرسال تحديث real-time للطالب المستلم (invitee) - تحديث latest incoming
        const emitLatestIncoming = global.app?.emitLatestIncomingUpdate;
        if (emitLatestIncoming) {
            await emitLatestIncoming(inviteeId);
        }
        res.json({
            success: true,
            message: 'تم رفض الدعوة',
        });
    }
    catch (error) {
        console.error('Error in reject API:', error);
        res.status(400).json({
            success: false,
            message: error.message,
        });
    }
}));
// API لجلب آخر دعوة واردة (pending) فقط
exports.router.get('/invitations/latest', (0, authentication_1.authMiddleware)(['student']), (0, utils_1.asyncWrapper)(async (req, res) => {
    try {
        const playerId = req.user.id;
        // جلب آخر دعوة واردة فقط (pending, لم تقبل, لم ترفض, لم تنته صلاحيتها)
        // جلب العمودين lesson_ids و selected_lessons بشكل صريح
        const latestInvitation = await pool_1.default.query(`SELECT gi.id, gi.inviter_id, gi.invitee_id, gi.questions_count, gi.status,
                gi.created_at, gi.expires_at, gi.accepted_at, gi.rejected_at,
                gi.lesson_ids, gi.selected_lessons,
                u.name as inviter_name
         FROM game_invitations gi
         JOIN users u ON u.id = gi.inviter_id
         WHERE gi.invitee_id = $1::INTEGER
           AND gi.status = 'pending'
           AND gi.accepted_at IS NULL
           AND gi.rejected_at IS NULL
           AND gi.expires_at > NOW()
         ORDER BY gi.created_at DESC
         LIMIT 1`, [playerId]);
        if (latestInvitation.rowCount === 0) {
            return res.json({
                success: true,
                data: null,
                message: 'لا توجد دعوات معلقة',
            });
        }
        const invitation = latestInvitation.rows[0];
        // Debug: Get raw data directly from database to see what's actually stored
        const rawDbCheck = await pool_1.default.query(`SELECT id, lesson_ids, selected_lessons, 
                pg_typeof(lesson_ids) as lesson_ids_type,
                pg_typeof(selected_lessons) as selected_lessons_type,
                array_length(lesson_ids, 1) as lesson_ids_length,
                array_length(selected_lessons, 1) as selected_lessons_length
         FROM game_invitations 
         WHERE id = $1::INTEGER`, [invitation.id]);
        const rawRow = rawDbCheck.rows[0];
        console.log(`[latest API] Raw DB data for invitation ${invitation.id}:`, {
            id: rawRow?.id,
            lesson_ids: rawRow?.lesson_ids,
            lesson_ids_stringified: rawRow?.lesson_ids ? JSON.stringify(rawRow.lesson_ids) : 'NULL',
            lesson_ids_type: rawRow?.lesson_ids_type,
            lesson_ids_length: rawRow?.lesson_ids_length,
            selected_lessons: rawRow?.selected_lessons,
            selected_lessons_stringified: rawRow?.selected_lessons
                ? JSON.stringify(rawRow.selected_lessons)
                : 'NULL',
            selected_lessons_type: rawRow?.selected_lessons_type,
            selected_lessons_length: rawRow?.selected_lessons_length,
            is_lesson_ids_array: Array.isArray(rawRow?.lesson_ids),
            is_selected_lessons_array: Array.isArray(rawRow?.selected_lessons),
            lesson_ids_null: rawRow?.lesson_ids === null,
            selected_lessons_null: rawRow?.selected_lessons === null,
        });
        console.log(`[latest API] From JOIN query:`, {
            lesson_ids: invitation.lesson_ids,
            selected_lessons: invitation.selected_lessons,
        });
        // Handle both column names and types
        // Use the raw DB data (most reliable)
        const rawData = rawDbCheck.rows[0];
        let lessonIds = [];
        // Priority 1: Use raw DB data
        if (rawData) {
            // Check lesson_ids first
            if (rawData.lesson_ids !== null && rawData.lesson_ids !== undefined) {
                if (Array.isArray(rawData.lesson_ids)) {
                    lessonIds = rawData.lesson_ids;
                    console.log(`[latest API] Using lesson_ids from raw DB (array):`, lessonIds);
                }
                else {
                    // If it's a string, try to parse it
                    try {
                        const parsed = JSON.parse(rawData.lesson_ids);
                        if (Array.isArray(parsed)) {
                            lessonIds = parsed;
                            console.log(`[latest API] Parsed lesson_ids from string:`, lessonIds);
                        }
                    }
                    catch {
                        console.log(`[latest API] lesson_ids is not an array or parseable string:`, rawData.lesson_ids);
                    }
                }
            }
            // If lesson_ids is empty/null, try selected_lessons
            if (lessonIds.length === 0 &&
                rawData.selected_lessons !== null &&
                rawData.selected_lessons !== undefined) {
                if (Array.isArray(rawData.selected_lessons)) {
                    lessonIds = rawData.selected_lessons;
                    console.log(`[latest API] Using selected_lessons from raw DB (array):`, lessonIds);
                }
            }
        }
        // Fallback to JOIN query data
        if (lessonIds.length === 0) {
            if (invitation.lesson_ids && Array.isArray(invitation.lesson_ids)) {
                lessonIds = invitation.lesson_ids;
                console.log(`[latest API] Using lesson_ids from JOIN query:`, lessonIds);
            }
            else if (invitation.selected_lessons && Array.isArray(invitation.selected_lessons)) {
                lessonIds = invitation.selected_lessons;
                console.log(`[latest API] Using selected_lessons from JOIN query:`, lessonIds);
            }
        }
        console.log(`[latest API] Final lessonIds before processing (length: ${lessonIds.length}):`, lessonIds);
        // Convert to array of numbers
        const lessonIdsArray = lessonIds
            .map((id) => {
            // Handle different types: number, string, or already parsed
            if (typeof id === 'number') {
                return id;
            }
            if (typeof id === 'string') {
                const parsed = parseInt(id);
                return isNaN(parsed) ? null : parsed;
            }
            return null;
        })
            .filter((id) => id !== null);
        console.log(`[latest API] Processed lessonIdsArray (length: ${lessonIdsArray.length}):`, lessonIdsArray);
        // Fetch lesson names
        let lessonNames = [];
        if (lessonIdsArray.length > 0) {
            try {
                const lessonsResult = await pool_1.default.query(`SELECT id, name FROM lessons WHERE id = ANY($1::INTEGER[])`, [lessonIdsArray]);
                lessonNames = lessonsResult.rows.map((lesson) => ({
                    id: parseInt(lesson.id),
                    name: lesson.name,
                }));
                console.log(`[latest API] Fetched ${lessonNames.length} lesson names`);
            }
            catch (error) {
                console.error(`Error fetching lesson names:`, error);
            }
        }
        else {
            console.log(`[latest API] No lesson IDs found to fetch names for`);
        }
        res.json({
            success: true,
            data: {
                id: invitation.id,
                inviterId: invitation.inviter_id,
                inviterName: invitation.inviter_name || 'غير معروف',
                lessonIds: lessonIdsArray,
                lessonNames: lessonNames,
                questionsCount: invitation.questions_count,
                status: invitation.status,
                createdAt: invitation.created_at,
                expiresAt: invitation.expires_at,
            },
        });
    }
    catch (error) {
        console.error('Error in latest invitation API:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في جلب الدعوة',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined,
        });
    }
}));
// API لجلب الدعوات الواردة
exports.router.get('/invitations/incoming', (0, authentication_1.authMiddleware)(['student']), (0, utils_1.asyncWrapper)(async (req, res) => {
    try {
        const playerId = req.user.id;
        const invitations = await GameService_1.GameService.getIncomingInvitations(playerId);
        res.json({
            success: true,
            data: invitations.map((invitation) => {
                const lessonIds = Array.isArray(invitation.lesson_ids)
                    ? invitation.lesson_ids
                    : invitation.selected_lessons || [];
                // lesson_names already fetched in service
                const lessonNames = invitation.lesson_names || [];
                return {
                    id: invitation.id,
                    inviterId: invitation.inviter_id,
                    inviterName: invitation.inviter_name,
                    lessonIds: lessonIds
                        .map((id) => parseInt(String(id)))
                        .filter((id) => !isNaN(id)),
                    lessonNames: lessonNames, // Array of { id, name }
                    questionsCount: invitation.questions_count,
                    status: invitation.status,
                    createdAt: invitation.created_at,
                    expiresAt: invitation.expires_at,
                };
            }),
        });
    }
    catch (error) {
        console.error('Error in incoming invitations API:', error);
        console.error('Error details:', {
            message: error.message,
            stack: error.stack,
            playerId: req.user?.id,
        });
        res.status(500).json({
            success: false,
            message: 'خطأ في جلب الدعوات',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined,
        });
    }
}));
// Temporary debug endpoint (remove in production)
exports.router.get('/invitations/debug/all', (0, authentication_1.authMiddleware)(['student']), (0, utils_1.asyncWrapper)(async (req, res) => {
    try {
        const allInvitations = await pool_1.default.query(`SELECT gi.*, 
                u1.name as inviter_name,
                u2.name as invitee_name
         FROM game_invitations gi
         LEFT JOIN users u1 ON u1.id = gi.inviter_id
         LEFT JOIN users u2 ON u2.id = gi.invitee_id
         ORDER BY gi.created_at DESC 
         LIMIT 50`);
        res.json({
            success: true,
            current_user_id: req.user.id,
            total_invitations: allInvitations.rowCount,
            data: allInvitations.rows.map((inv) => ({
                id: inv.id,
                inviter_id: inv.inviter_id,
                inviter_name: inv.inviter_name,
                invitee_id: inv.invitee_id,
                invitee_name: inv.invitee_name,
                status: inv.status,
                lesson_ids: inv.lesson_ids || inv.selected_lessons || [],
                created_at: inv.created_at,
                expires_at: inv.expires_at,
            })),
        });
    }
    catch (error) {
        res.status(500).json({
            success: false,
            message: 'خطأ في جلب الدعوات',
            error: error.message,
        });
    }
}));
// API لجلب الدعوات الصادرة
exports.router.get('/invitations/outgoing', (0, authentication_1.authMiddleware)(['student']), (0, utils_1.asyncWrapper)(async (req, res) => {
    try {
        const playerId = req.user.id;
        console.log(`[outgoing API] Request received, user id: ${playerId} (type: ${typeof playerId})`);
        console.log(`[outgoing API] Full user object:`, {
            id: req.user?.id,
            role: req.user?.role,
            jti: req.user?.jti,
        });
        // Debug: Check all invitations for this user
        const debugAll = await pool_1.default.query(`SELECT id, inviter_id, invitee_id, status, created_at 
         FROM game_invitations 
         ORDER BY created_at DESC`);
        // Check specifically for invitations sent BY this user (outgoing)
        const outgoingCheck = await pool_1.default.query(`SELECT id, inviter_id, invitee_id, status, created_at 
         FROM game_invitations 
         WHERE inviter_id = $1
         ORDER BY created_at DESC`, [playerId]);
        // Check for invitations received BY this user (incoming)
        const incomingCheck = await pool_1.default.query(`SELECT id, inviter_id, invitee_id, status, created_at 
         FROM game_invitations 
         WHERE invitee_id = $1
         ORDER BY created_at DESC`, [playerId]);
        console.log(`[outgoing API] Debug Summary for user ${playerId}:`);
        console.log(`  - Total invitations in DB: ${debugAll.rowCount}`);
        console.log(`  - Invitations sent BY user ${playerId} (outgoing): ${outgoingCheck.rowCount}`);
        console.log(`  - Invitations received BY user ${playerId} (incoming): ${incomingCheck.rowCount}`);
        if (outgoingCheck.rowCount === 0 && incomingCheck.rowCount && incomingCheck.rowCount > 0) {
            console.log(`[outgoing API] WARNING: User ${playerId} has ${incomingCheck.rowCount} incoming invitations but 0 outgoing invitations.`);
            console.log(`[outgoing API] The user might be looking for outgoing invitations but the invitations were sent as user ${incomingCheck.rows[0]?.inviter_id}`);
        }
        console.log(`[outgoing API] Sample outgoing invitations:`, outgoingCheck.rows.map((r) => ({
            id: r.id,
            inviter_id: r.inviter_id,
            invitee_id: r.invitee_id,
            status: r.status,
        })));
        const invitations = await GameService_1.GameService.getOutgoingInvitations(playerId);
        console.log(`[outgoing API] Service returned ${invitations.length} invitations`);
        console.log(`[outgoing API] Invitations array type:`, Array.isArray(invitations));
        console.log(`[outgoing API] Invitations data:`, invitations.map((inv) => ({
            id: inv.id,
            inviter_id: inv.inviter_id,
            invitee_id: inv.invitee_id,
            invitee_name: inv.invitee_name,
        })));
        // Ensure we always return an array, even if empty or single item
        const responseData = Array.isArray(invitations) && invitations.length > 0
            ? invitations.map((invitation) => {
                const lessonIds = Array.isArray(invitation.lesson_ids)
                    ? invitation.lesson_ids
                    : invitation.selected_lessons || [];
                // lesson_names already fetched in service
                const lessonNames = invitation.lesson_names || [];
                // تحديد رسالة الحالة
                let statusMessage = '';
                let canResend = false;
                if (invitation.status === 'pending') {
                    if (invitation.expires_at && new Date(invitation.expires_at) < new Date()) {
                        statusMessage = 'الدعوة منتهية الصلاحية';
                        canResend = true;
                    }
                    else {
                        statusMessage = 'في انتظار الرد';
                        canResend = false;
                    }
                }
                else if (invitation.status === 'accepted') {
                    statusMessage = 'تم قبول الدعوة';
                    canResend = true;
                }
                else if (invitation.status === 'rejected') {
                    statusMessage = 'تم رفض الدعوة';
                    canResend = true;
                }
                else if (invitation.status === 'expired') {
                    statusMessage = 'الدعوة منتهية الصلاحية';
                    canResend = true;
                }
                else {
                    statusMessage = 'حالة غير معروفة';
                    canResend = true;
                }
                return {
                    id: invitation.id,
                    inviteeId: invitation.invitee_id,
                    inviteeName: invitation.invitee_name || 'غير معروف',
                    lessonIds: lessonIds
                        .map((id) => parseInt(String(id)))
                        .filter((id) => !isNaN(id)),
                    lessonNames: lessonNames, // Array of { id, name }
                    questionsCount: invitation.questions_count,
                    status: invitation.status,
                    statusMessage: statusMessage,
                    canResend: canResend,
                    createdAt: invitation.created_at,
                    expiresAt: invitation.expires_at,
                    acceptedAt: invitation.accepted_at,
                    rejectedAt: invitation.rejected_at,
                };
            })
            : [];
        console.log(`[outgoing API] Final response data count: ${responseData.length}`);
        res.json({
            success: true,
            data: responseData,
        });
    }
    catch (error) {
        console.error('Error in outgoing invitations API:', error);
        console.error('Error details:', {
            message: error.message,
            stack: error.stack,
            playerId: req.user?.id,
        });
        res.status(500).json({
            success: false,
            message: 'خطأ في جلب الدعوات',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined,
        });
    }
}));
// API للتحقق من إمكانية إرسال دعوة لطالب معين
exports.router.get('/invitations/can-invite/:inviteeId', (0, authentication_1.authMiddleware)(['student']), (0, utils_1.asyncWrapper)(async (req, res) => {
    try {
        const inviterId = req.user.id;
        const inviteeId = Number(req.params.inviteeId);
        if (isNaN(inviteeId)) {
            return res.status(400).json({
                success: false,
                message: 'معرف الطالب غير صحيح',
            });
        }
        if (inviterId === inviteeId) {
            return res.json({
                success: true,
                canInvite: false,
                reason: 'لا يمكنك إرسال دعوة لنفسك',
            });
        }
        // التحقق من وجود الطالب
        const inviteeCheck = await pool_1.default.query('SELECT id, name FROM users WHERE id = $1::INTEGER AND role = $2', [inviteeId, 'student']);
        if (!inviteeCheck.rowCount) {
            return res.json({
                success: true,
                canInvite: false,
                reason: 'الطالب غير موجود',
            });
        }
        // التحقق من وجود دعوة معلقة للمستقبل (من أي شخص)
        const existingInvitationForInvitee = await pool_1.default.query(`SELECT id FROM game_invitations 
         WHERE invitee_id = $1::INTEGER
           AND status = 'pending'
           AND accepted_at IS NULL
           AND rejected_at IS NULL
           AND expires_at > NOW()`, [inviteeId]);
        if (existingInvitationForInvitee.rowCount && existingInvitationForInvitee.rowCount > 0) {
            return res.json({
                success: true,
                canInvite: false,
                reason: 'الطالب لديه دعوة معلقة بالفعل',
            });
        }
        // التحقق من وجود دعوة معلقة بين نفس الطالبين (من أي اتجاه)
        const existingInvitationBetween = await pool_1.default.query(`SELECT id, inviter_id, invitee_id, status, expires_at 
         FROM game_invitations 
         WHERE ((inviter_id = $1::INTEGER AND invitee_id = $2::INTEGER) OR (inviter_id = $2::INTEGER AND invitee_id = $1::INTEGER))
           AND status = 'pending' 
           AND expires_at > NOW()`, [inviterId, inviteeId]);
        if (existingInvitationBetween.rowCount && existingInvitationBetween.rowCount > 0) {
            const pendingInvitation = existingInvitationBetween.rows[0];
            const isOutgoing = pendingInvitation.inviter_id === inviterId;
            const reason = isOutgoing
                ? 'لديك دعوة معلقة مع هذا الطالب. يجب انتظار الرد أولاً'
                : 'هذا الطالب لديه دعوة معلقة معك. يجب انتظار الرد أولاً';
            return res.json({
                success: true,
                canInvite: false,
                reason: reason,
                pendingInvitation: {
                    id: pendingInvitation.id,
                    isOutgoing: isOutgoing,
                },
            });
        }
        return res.json({
            success: true,
            canInvite: true,
            inviteeName: inviteeCheck.rows[0].name,
        });
    }
    catch (error) {
        console.error('Error in can-invite API:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في التحقق من إمكانية الإرسال',
        });
    }
}));
// API لعرض تفاصيل مجموعة دعوات (المرسلة لنفس الوقت) مع حالات جميع المدعوين
exports.router.get('/invitations/group/:invitationId', (0, authentication_1.authMiddleware)(['student']), (0, utils_1.asyncWrapper)(async (req, res) => {
    try {
        const inviterId = req.user.id;
        const referenceInvitationId = Number(req.params.invitationId);
        if (isNaN(referenceInvitationId)) {
            return res.status(400).json({
                success: false,
                message: 'معرف الدعوة غير صحيح',
            });
        }
        // جلب الدعوة المرجعية للتحقق من أنها للمستخدم
        const referenceInvitation = await pool_1.default.query(`SELECT inviter_id, lesson_ids, selected_lessons, created_at, questions_count
         FROM game_invitations 
         WHERE id = $1::INTEGER`, [referenceInvitationId]);
        if (referenceInvitation.rowCount === 0) {
            return res.status(404).json({
                success: false,
                message: 'الدعوة غير موجودة',
            });
        }
        const refInv = referenceInvitation.rows[0];
        // التحقق من أن المستخدم هو المرسل
        if (refInv.inviter_id !== inviterId) {
            return res.status(403).json({
                success: false,
                message: 'ليس لديك صلاحية لعرض هذه الدعوات',
            });
        }
        // جلب جميع الدعوات المرسلة في نفس الوقت (نفس inviter_id، created_at في نطاق 10 ثوان)
        // نستخدم نطاق زمني للبحث عن الدعوات المرسلة معاً
        const createdAtStart = new Date(new Date(refInv.created_at).getTime() - 10000); // 10 ثوان قبل
        const createdAtEnd = new Date(new Date(refInv.created_at).getTime() + 10000); // 10 ثوان بعد
        const groupInvitations = await pool_1.default.query(`SELECT gi.id, gi.invitee_id, gi.status, gi.created_at, gi.expires_at, 
                gi.accepted_at, gi.rejected_at, gi.questions_count,
                gi.lesson_ids, gi.selected_lessons,
                u.name as invitee_name,
                gr.id as room_id,
                (CASE 
                  WHEN gi.expires_at < NOW() AND gi.status = 'pending' THEN 'expired'
                  WHEN gi.status = 'pending' AND gi.accepted_at IS NULL AND gi.rejected_at IS NULL THEN 'pending'
                  WHEN gi.status = 'accepted' THEN 'accepted'
                  WHEN gi.status = 'rejected' THEN 'rejected'
                  ELSE gi.status
                END) as current_status
         FROM game_invitations gi
         LEFT JOIN users u ON u.id = gi.invitee_id
         LEFT JOIN game_rooms gr ON gr.invitation_id = gi.id
         WHERE gi.inviter_id = $1::INTEGER
           AND gi.created_at >= $2::TIMESTAMP
           AND gi.created_at <= $3::TIMESTAMP
           AND gi.questions_count = $4::INTEGER
         ORDER BY gi.created_at DESC, gi.id`, [inviterId, createdAtStart, createdAtEnd, refInv.questions_count]);
        if (groupInvitations.rowCount === 0) {
            return res.json({
                success: true,
                data: {
                    invitationGroupId: referenceInvitationId,
                    totalInvited: 0,
                    invitations: [],
                    summary: {
                        accepted: 0,
                        rejected: 0,
                        pending: 0,
                        expired: 0,
                    },
                },
            });
        }
        // تجميع البيانات
        const invitations = groupInvitations.rows.map((inv) => {
            let statusMessage = '';
            if (inv.current_status === 'pending') {
                statusMessage = 'في انتظار الرد';
            }
            else if (inv.current_status === 'accepted') {
                statusMessage = 'تم قبول الدعوة';
            }
            else if (inv.current_status === 'rejected') {
                statusMessage = 'تم رفض الدعوة';
            }
            else if (inv.current_status === 'expired') {
                statusMessage = 'الدعوة منتهية الصلاحية';
            }
            return {
                id: inv.id,
                inviteeId: inv.invitee_id,
                inviteeName: inv.invitee_name || 'غير معروف',
                status: inv.current_status,
                statusMessage: statusMessage,
                createdAt: inv.created_at,
                expiresAt: inv.expires_at,
                acceptedAt: inv.accepted_at,
                rejectedAt: inv.rejected_at,
                questionsCount: inv.questions_count,
                roomId: inv.room_id || null, // إضافة roomId للدعوات المقبولة
            };
        });
        // حساب الملخص
        const summary = {
            accepted: invitations.filter((inv) => inv.status === 'accepted').length,
            rejected: invitations.filter((inv) => inv.status === 'rejected').length,
            pending: invitations.filter((inv) => inv.status === 'pending').length,
            expired: invitations.filter((inv) => inv.status === 'expired').length,
        };
        // التحقق من إمكانية بدء اللعبة (إذا انتهت 3 دقائق وكان هناك من قبل)
        const canStartGame = summary.accepted > 0 &&
            groupInvitations.rows[0].expires_at &&
            new Date(groupInvitations.rows[0].expires_at) < new Date();
        // جلب roomId الأول المقبولة (للاستخدام في GET /api/game/room/:roomId/questions)
        const firstAcceptedInvitation = invitations.find((inv) => inv.status === 'accepted' && inv.roomId);
        const roomId = firstAcceptedInvitation?.roomId || null;
        res.json({
            success: true,
            data: {
                invitationGroupId: referenceInvitationId,
                totalInvited: invitations.length,
                questionsCount: refInv.questions_count,
                createdAt: refInv.created_at,
                expiresAt: groupInvitations.rows[0]?.expires_at,
                canStartGame: canStartGame,
                roomId: roomId, // إضافة roomId للاستجابة الرئيسية (أول غرفة مقبولة)
                invitations: invitations,
                summary: summary,
            },
        });
    }
    catch (error) {
        console.error('Error in invitation group API:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في جلب تفاصيل الدعوات',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined,
        });
    }
}));
// API لعرض تفاصيل آخر دعوة مرسلة
exports.router.get('/invitations/latest-outgoing', (0, authentication_1.authMiddleware)(['student']), (0, utils_1.asyncWrapper)(async (req, res) => {
    try {
        const inviterId = req.user.id;
        // جلب آخر دعوة مرسلة
        const latestInvitation = await pool_1.default.query(`SELECT id, inviter_id, lesson_ids, selected_lessons, created_at, questions_count, expires_at
         FROM game_invitations 
         WHERE inviter_id = $1::INTEGER
         ORDER BY created_at DESC
         LIMIT 1`, [inviterId]);
        if (latestInvitation.rowCount === 0) {
            return res.json({
                success: true,
                data: null,
                message: 'لا توجد دعوات مرسلة',
            });
        }
        const refInv = latestInvitation.rows[0];
        // جلب جميع الدعوات المرسلة في نفس الوقت (نفس inviter_id، created_at في نطاق 10 ثوان)
        const createdAtStart = new Date(new Date(refInv.created_at).getTime() - 10000); // 10 ثوان قبل
        const createdAtEnd = new Date(new Date(refInv.created_at).getTime() + 10000); // 10 ثوان بعد
        const groupInvitations = await pool_1.default.query(`SELECT gi.id, gi.invitee_id, gi.status, gi.created_at, gi.expires_at, 
                gi.accepted_at, gi.rejected_at, gi.questions_count,
                gi.lesson_ids, gi.selected_lessons,
                u.name as invitee_name,
                gr.id as room_id,
                (CASE 
                  WHEN gi.expires_at < NOW() AND gi.status = 'pending' THEN 'expired'
                  WHEN gi.status = 'pending' AND gi.accepted_at IS NULL AND gi.rejected_at IS NULL THEN 'pending'
                  WHEN gi.status = 'accepted' THEN 'accepted'
                  WHEN gi.status = 'rejected' THEN 'rejected'
                  ELSE gi.status
                END) as current_status
         FROM game_invitations gi
         LEFT JOIN users u ON u.id = gi.invitee_id
         LEFT JOIN game_rooms gr ON gr.invitation_id = gi.id
         WHERE gi.inviter_id = $1::INTEGER
           AND gi.created_at >= $2::TIMESTAMP
           AND gi.created_at <= $3::TIMESTAMP
           AND gi.questions_count = $4::INTEGER
         ORDER BY gi.created_at DESC, gi.id`, [inviterId, createdAtStart, createdAtEnd, refInv.questions_count]);
        if (groupInvitations.rowCount === 0) {
            return res.json({
                success: true,
                data: {
                    invitationGroupId: refInv.id,
                    totalInvited: 0,
                    invitations: [],
                    summary: {
                        accepted: 0,
                        rejected: 0,
                        pending: 0,
                        expired: 0,
                    },
                },
            });
        }
        // تجميع البيانات
        const invitations = groupInvitations.rows.map((inv) => {
            let statusMessage = '';
            if (inv.current_status === 'pending') {
                statusMessage = 'في انتظار الرد';
            }
            else if (inv.current_status === 'accepted') {
                statusMessage = 'تم قبول الدعوة';
            }
            else if (inv.current_status === 'rejected') {
                statusMessage = 'تم رفض الدعوة';
            }
            else if (inv.current_status === 'expired') {
                statusMessage = 'الدعوة منتهية الصلاحية';
            }
            // جلب أسماء الدروس
            const lessonIds = inv.lesson_ids || inv.selected_lessons || [];
            const lessonIdsArray = Array.isArray(lessonIds)
                ? lessonIds.map((id) => parseInt(String(id))).filter((id) => !isNaN(id))
                : [];
            return {
                id: inv.id,
                inviteeId: inv.invitee_id,
                inviteeName: inv.invitee_name || 'غير معروف',
                status: inv.current_status,
                statusMessage: statusMessage,
                createdAt: inv.created_at,
                expiresAt: inv.expires_at,
                acceptedAt: inv.accepted_at,
                rejectedAt: inv.rejected_at,
                questionsCount: inv.questions_count,
                lessonIds: lessonIdsArray,
                roomId: inv.room_id || null, // إضافة roomId للدعوات المقبولة
            };
        });
        // جلب أسماء الدروس للمجموعة
        const allLessonIds = [...new Set(invitations.flatMap((inv) => inv.lessonIds))];
        let lessonNames = [];
        if (allLessonIds.length > 0) {
            try {
                const lessonsResult = await pool_1.default.query(`SELECT id, name FROM lessons WHERE id = ANY($1::INTEGER[])`, [allLessonIds]);
                lessonNames = lessonsResult.rows.map((lesson) => ({
                    id: parseInt(lesson.id),
                    name: lesson.name,
                }));
            }
            catch (error) {
                console.error('Error fetching lesson names:', error);
            }
        }
        // حساب الملخص
        const summary = {
            accepted: invitations.filter((inv) => inv.status === 'accepted').length,
            rejected: invitations.filter((inv) => inv.status === 'rejected').length,
            pending: invitations.filter((inv) => inv.status === 'pending').length,
            expired: invitations.filter((inv) => inv.status === 'expired').length,
        };
        // التحقق من إمكانية بدء اللعبة (إذا انتهت 3 دقائق وكان هناك من قبل)
        const canStartGame = summary.accepted > 0 &&
            groupInvitations.rows[0].expires_at &&
            new Date(groupInvitations.rows[0].expires_at) < new Date();
        // جلب roomId الأول المقبولة (للاستخدام في GET /api/game/room/:roomId/questions)
        const firstAcceptedInvitation = invitations.find((inv) => inv.status === 'accepted' && inv.roomId);
        const roomId = firstAcceptedInvitation?.roomId || null;
        res.json({
            success: true,
            data: {
                invitationGroupId: refInv.id,
                totalInvited: invitations.length,
                questionsCount: refInv.questions_count,
                lessonIds: allLessonIds,
                lessonNames: lessonNames,
                createdAt: refInv.created_at,
                expiresAt: groupInvitations.rows[0]?.expires_at,
                canStartGame: canStartGame,
                roomId: roomId, // إضافة roomId للاستجابة الرئيسية (أول غرفة مقبولة)
                invitations: invitations,
                summary: summary,
            },
        });
    }
    catch (error) {
        console.error('Error in latest outgoing invitation API:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في جلب آخر دعوة',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined,
        });
    }
}));
// API لجلب تفاصيل الغرفة
exports.router.get('/room/:roomId', (0, authentication_1.authMiddleware)(['student']), (0, utils_1.asyncWrapper)(async (req, res) => {
    try {
        const playerId = req.user.id;
        const roomId = Number(req.params.roomId);
        if (isNaN(roomId)) {
            return res.status(400).json({
                success: false,
                message: 'معرف الغرفة غير صحيح',
            });
        }
        const room = await GameService_1.GameService.getRoomDetails(roomId, playerId);
        if (!room) {
            return res.status(404).json({
                success: false,
                message: 'الغرفة غير موجودة أو غير متاحة',
            });
        }
        // جلب أسئلة الغرفة
        let questions = [];
        try {
            questions = await GameService_1.GameService.getRoomQuestions(roomId);
            console.log(`[room API] Found ${questions.length} questions for room ${roomId}`);
            console.log(`[room API] Room has invitation_id: ${room.invitation_id}`);
            // إذا لم تكن هناك أسئلة، حاول إنشاءها من الدعوة
            if (questions.length === 0) {
                if (room.invitation_id) {
                    console.log(`[room API] No questions found, attempting to generate from invitation ${room.invitation_id}`);
                    try {
                        // جلب بيانات الدعوة
                        const invitationResult = await pool_1.default.query(`SELECT lesson_ids, selected_lessons, questions_count, inviter_id, invitee_id
                 FROM game_invitations 
                 WHERE id = $1::INTEGER`, [room.invitation_id]);
                        console.log(`[room API] Invitation query returned ${invitationResult.rowCount} rows`);
                        if (invitationResult.rowCount && invitationResult.rowCount > 0) {
                            const invitation = invitationResult.rows[0];
                            console.log(`[room API] Invitation raw data:`, {
                                lesson_ids_raw: invitation.lesson_ids,
                                lesson_ids_stringified: JSON.stringify(invitation.lesson_ids),
                                selected_lessons_raw: invitation.selected_lessons,
                                selected_lessons_stringified: JSON.stringify(invitation.selected_lessons),
                                questions_count: invitation.questions_count,
                            });
                            // استخراج lesson_ids - جلب البيانات المباشرة من قاعدة البيانات
                            let lessonIds = [];
                            // محاولة جلب البيانات مباشرة من قاعدة البيانات
                            const directCheck = await pool_1.default.query(`SELECT lesson_ids, selected_lessons,
                          pg_typeof(lesson_ids) as lesson_ids_type,
                          pg_typeof(selected_lessons) as selected_lessons_type,
                          array_length(lesson_ids, 1) as lesson_ids_length,
                          array_length(selected_lessons, 1) as selected_lessons_length
                   FROM game_invitations 
                   WHERE id = $1::INTEGER`, [room.invitation_id]);
                            if (directCheck.rowCount && directCheck.rowCount > 0) {
                                const rawData = directCheck.rows[0];
                                console.log(`[room API] Direct DB check:`, {
                                    lesson_ids: rawData.lesson_ids,
                                    lesson_ids_type: rawData.lesson_ids_type,
                                    lesson_ids_length: rawData.lesson_ids_length,
                                    selected_lessons: rawData.selected_lessons,
                                    selected_lessons_type: rawData.selected_lessons_type,
                                    selected_lessons_length: rawData.selected_lessons_length,
                                });
                                // Priority 1: Use lesson_ids from raw DB data
                                if (rawData.lesson_ids !== null && rawData.lesson_ids !== undefined) {
                                    if (Array.isArray(rawData.lesson_ids)) {
                                        // Filter out null, undefined, empty strings, and convert to numbers
                                        lessonIds = rawData.lesson_ids
                                            .map((id) => {
                                            if (id === null || id === undefined || id === '')
                                                return null;
                                            const num = typeof id === 'string' ? parseInt(id) : id;
                                            return isNaN(num) ? null : num;
                                        })
                                            .filter((id) => id !== null);
                                        console.log(`[room API] Extracted from lesson_ids array:`, lessonIds);
                                    }
                                    else if (typeof rawData.lesson_ids === 'string') {
                                        try {
                                            const parsed = JSON.parse(rawData.lesson_ids);
                                            if (Array.isArray(parsed)) {
                                                lessonIds = parsed
                                                    .map((id) => {
                                                    const num = typeof id === 'string' ? parseInt(id) : id;
                                                    return isNaN(num) ? null : num;
                                                })
                                                    .filter((id) => id !== null);
                                                console.log(`[room API] Parsed from lesson_ids string:`, lessonIds);
                                            }
                                        }
                                        catch {
                                            lessonIds = rawData.lesson_ids
                                                .split(',')
                                                .map((id) => {
                                                const trimmed = id.trim();
                                                const num = parseInt(trimmed);
                                                return isNaN(num) ? null : num;
                                            })
                                                .filter((id) => id !== null);
                                            console.log(`[room API] Parsed from comma-separated lesson_ids:`, lessonIds);
                                        }
                                    }
                                }
                                // If lesson_ids is empty, try selected_lessons
                                if (lessonIds.length === 0 &&
                                    rawData.selected_lessons !== null &&
                                    rawData.selected_lessons !== undefined) {
                                    if (Array.isArray(rawData.selected_lessons)) {
                                        lessonIds = rawData.selected_lessons
                                            .map((id) => {
                                            if (id === null || id === undefined || id === '')
                                                return null;
                                            const num = typeof id === 'string' ? parseInt(id) : id;
                                            return isNaN(num) ? null : num;
                                        })
                                            .filter((id) => id !== null);
                                        console.log(`[room API] Extracted from selected_lessons array:`, lessonIds);
                                    }
                                }
                            }
                            // Fallback to invitation object data
                            if (lessonIds.length === 0) {
                                if (invitation.lesson_ids) {
                                    if (Array.isArray(invitation.lesson_ids)) {
                                        lessonIds = invitation.lesson_ids.filter((id) => id !== null && id !== undefined && id !== '');
                                    }
                                    else if (typeof invitation.lesson_ids === 'string') {
                                        try {
                                            lessonIds = JSON.parse(invitation.lesson_ids).filter((id) => id !== null && id !== undefined && id !== '');
                                        }
                                        catch {
                                            lessonIds = invitation.lesson_ids
                                                .split(',')
                                                .map((id) => id.trim())
                                                .filter((id) => id.length > 0);
                                        }
                                    }
                                }
                                else if (invitation.selected_lessons) {
                                    if (Array.isArray(invitation.selected_lessons)) {
                                        lessonIds = invitation.selected_lessons.filter((id) => id !== null && id !== undefined && id !== '');
                                    }
                                }
                            }
                            console.log(`[room API] Final extracted lessonIds:`, lessonIds, `(length: ${lessonIds.length})`);
                            if (lessonIds.length > 0) {
                                const lessonIdsAsStrings = lessonIds.map((id) => String(id));
                                const questionsCount = invitation.questions_count || room.questions_count || 10;
                                console.log(`[room API] Calling generateGameQuestions with:`, {
                                    roomId,
                                    lessonIds: lessonIdsAsStrings,
                                    questionsCount,
                                });
                                try {
                                    await GameService_1.GameService.generateGameQuestions(roomId, lessonIdsAsStrings, questionsCount);
                                    console.log(`[room API] generateGameQuestions completed successfully`);
                                    // إعادة جلب الأسئلة بعد الإنشاء
                                    questions = await GameService_1.GameService.getRoomQuestions(roomId);
                                    console.log(`[room API] Successfully generated and fetched ${questions.length} questions`);
                                }
                                catch (genError) {
                                    console.error(`[room API] generateGameQuestions failed:`, genError);
                                    console.error(`[room API] generateGameQuestions error stack:`, genError.stack);
                                    throw genError;
                                }
                            }
                            else {
                                console.warn(`[room API] No lessonIds extracted from invitation ${room.invitation_id}`);
                            }
                        }
                        else {
                            console.warn(`[room API] Invitation ${room.invitation_id} not found in database`);
                        }
                    }
                    catch (error) {
                        console.error(`[room API] Error generating questions:`, error);
                        console.error(`[room API] Error message:`, error.message);
                        console.error(`[room API] Error stack:`, error.stack);
                        // نستمر بدون أسئلة إذا فشل الإنشاء
                    }
                }
                else {
                    console.warn(`[room API] Cannot generate questions: room has no invitation_id`);
                }
            }
        }
        catch (error) {
            console.error(`[room API] Error getting questions:`, error);
            console.error(`[room API] Error stack:`, error.stack);
            // نستمر بدون أسئلة إذا فشل الجلب
        }
        // تنسيق الأسئلة للإرجاع (بدون الإجابة الصحيحة)
        const formattedQuestions = Array.isArray(questions)
            ? questions.map((question) => {
                // تحويل options من JSONB/object إلى array إذا لزم الأمر
                let optionsFormatted = question.options || null;
                if (optionsFormatted &&
                    typeof optionsFormatted === 'object' &&
                    !Array.isArray(optionsFormatted)) {
                    // إذا كان options كـ object {A: '...', B: '...'}، نحوله إلى array
                    const optionsArray = [
                        optionsFormatted.A || '',
                        optionsFormatted.B || '',
                        optionsFormatted.C || '',
                        optionsFormatted.D || '',
                    ].filter((opt) => opt !== '');
                    optionsFormatted = optionsArray.length > 0 ? optionsArray : null;
                }
                else if (typeof optionsFormatted === 'string') {
                    try {
                        const parsed = JSON.parse(optionsFormatted);
                        if (typeof parsed === 'object' && !Array.isArray(parsed)) {
                            optionsFormatted = [
                                parsed.A || '',
                                parsed.B || '',
                                parsed.C || '',
                                parsed.D || '',
                            ].filter((opt) => opt !== '');
                        }
                        else if (Array.isArray(parsed)) {
                            optionsFormatted = parsed;
                        }
                    }
                    catch {
                        // إذا فشل التحليل، نتركه كما هو
                    }
                }
                return {
                    id: question.id,
                    questionOrder: question.question_order,
                    questionText: question.question_text || '',
                    questionImage: question.question_image || null,
                    options: optionsFormatted,
                    points: question.points || 1,
                    // لا نرسل الإجابة الصحيحة للاعبين
                };
            })
            : [];
        res.json({
            success: true,
            data: {
                id: room.id,
                player1Id: room.player1_id,
                player2Id: room.player2_id,
                status: room.status,
                questionsCount: room.questions_count,
                timePerQuestion: room.time_per_question,
                totalTime: room.total_time,
                currentQuestion: room.current_question,
                startedAt: room.started_at,
                completedAt: room.completed_at,
                createdAt: room.created_at,
                questions: formattedQuestions, // إضافة الأسئلة
            },
        });
    }
    catch (error) {
        console.error('Error in room details API:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في جلب تفاصيل الغرفة',
        });
    }
}));
// API لجلب أسئلة الغرفة
exports.router.get('/room/:roomId/questions', (0, authentication_1.authMiddleware)(['student']), (0, utils_1.asyncWrapper)(async (req, res) => {
    try {
        // التحقق من وجود المستخدم المصادق عليه
        if (!req.user || !req.user.id) {
            return res.status(401).json({
                success: false,
                message: 'غير مصرح لك بالوصول',
            });
        }
        const playerId = req.user.id;
        const roomId = Number(req.params.roomId);
        if (isNaN(roomId)) {
            return res.status(400).json({
                success: false,
                message: 'معرف الغرفة غير صحيح',
            });
        }
        console.log(`[room questions API] Request received for room ${roomId} by player ${playerId}`);
        // التحقق من أن اللاعب جزء من الغرفة
        let room;
        try {
            room = await GameService_1.GameService.getRoomDetails(roomId, playerId);
            console.log(`[room questions API] Room details:`, room ? { id: room.id, invitation_id: room.invitation_id } : 'not found');
        }
        catch (error) {
            console.error(`[room questions API] Error getting room details:`, error);
            throw new Error(`فشل في جلب بيانات الغرفة: ${error.message}`);
        }
        if (!room) {
            return res.status(404).json({
                success: false,
                message: 'الغرفة غير موجودة أو غير متاحة',
            });
        }
        let questions;
        try {
            questions = await GameService_1.GameService.getRoomQuestions(roomId);
            console.log(`[room questions API] Found ${questions.length} questions`);
        }
        catch (error) {
            console.error(`[room questions API] Error getting room questions:`, error);
            throw new Error(`فشل في جلب الأسئلة: ${error.message}`);
        }
        // إذا لم تكن هناك أسئلة، حاول إنشاءها من الدعوة
        if (questions.length === 0) {
            console.log(`[room questions API] No questions found for room ${roomId}`);
            console.log(`[room questions API] Room details:`, room
                ? {
                    id: room.id,
                    invitation_id: room.invitation_id,
                    has_invitation_id: !!room.invitation_id,
                }
                : 'room is null');
            if (room && room.invitation_id) {
                console.log(`[room questions API] Attempting to generate questions from invitation ${room.invitation_id}`);
                try {
                    // جلب بيانات الدعوة
                    const invitationResult = await pool_1.default.query(`SELECT lesson_ids, selected_lessons, questions_count, inviter_id, invitee_id
               FROM game_invitations 
               WHERE id = $1::INTEGER`, [room.invitation_id]);
                    console.log(`[room questions API] Invitation query result: ${invitationResult.rowCount} rows`);
                    if (invitationResult.rowCount && invitationResult.rowCount > 0) {
                        const invitation = invitationResult.rows[0];
                        console.log(`[room questions API] Invitation data:`, {
                            has_lesson_ids: !!invitation.lesson_ids,
                            has_selected_lessons: !!invitation.selected_lessons,
                            questions_count: invitation.questions_count,
                            lesson_ids_type: typeof invitation.lesson_ids,
                            selected_lessons_type: typeof invitation.selected_lessons,
                        });
                        // استخراج lesson_ids
                        let lessonIds = [];
                        try {
                            if (invitation.lesson_ids) {
                                if (Array.isArray(invitation.lesson_ids)) {
                                    lessonIds = invitation.lesson_ids;
                                    console.log(`[room questions API] lesson_ids is array:`, lessonIds);
                                }
                                else if (typeof invitation.lesson_ids === 'string') {
                                    try {
                                        lessonIds = JSON.parse(invitation.lesson_ids);
                                        console.log(`[room questions API] Parsed lesson_ids from JSON:`, lessonIds);
                                    }
                                    catch {
                                        // إذا فشل parsing، حاول split إذا كان comma-separated
                                        lessonIds = invitation.lesson_ids
                                            .split(',')
                                            .map((id) => id.trim())
                                            .filter((id) => id.length > 0);
                                        console.log(`[room questions API] Parsed lesson_ids from comma-separated:`, lessonIds);
                                    }
                                }
                            }
                            else if (invitation.selected_lessons) {
                                lessonIds = Array.isArray(invitation.selected_lessons)
                                    ? invitation.selected_lessons
                                    : [];
                                console.log(`[room questions API] Using selected_lessons:`, lessonIds);
                            }
                            console.log(`[room questions API] Final extracted lessonIds:`, lessonIds, `(length: ${lessonIds.length})`);
                        }
                        catch (parseError) {
                            console.error(`[room questions API] Error parsing lesson_ids:`, parseError);
                            throw new Error(`فشل في استخراج معرفات الدروس: ${parseError.message}`);
                        }
                        if (lessonIds.length > 0) {
                            const lessonIdsAsStrings = lessonIds.map((id) => String(id));
                            const questionsCount = invitation.questions_count || room.questions_count || 10;
                            console.log(`[room questions API] Calling generateGameQuestions with:`, {
                                roomId,
                                lessonIds: lessonIdsAsStrings,
                                questionsCount,
                            });
                            try {
                                await GameService_1.GameService.generateGameQuestions(roomId, lessonIdsAsStrings, questionsCount);
                                console.log(`[room questions API] generateGameQuestions completed successfully`);
                                // إعادة جلب الأسئلة بعد الإنشاء
                                questions = await GameService_1.GameService.getRoomQuestions(roomId);
                                console.log(`[room questions API] Successfully generated ${questions.length} questions for room ${roomId}`);
                            }
                            catch (genError) {
                                console.error(`[room questions API] generateGameQuestions failed:`, genError);
                                console.error(`[room questions API] generateGameQuestions error stack:`, genError.stack);
                                throw genError; // نرمي الخطأ حتى يظهر في console
                            }
                        }
                        else {
                            console.warn(`[room questions API] No lessonIds found in invitation ${room.invitation_id}`);
                        }
                    }
                    else {
                        console.warn(`[room questions API] Invitation ${room.invitation_id} not found`);
                    }
                }
                catch (error) {
                    console.error(`[room questions API] Error generating questions for room ${roomId}:`, error);
                    console.error(`[room questions API] Error stack:`, error.stack);
                    console.error(`[room questions API] Error message:`, error.message);
                    // نستمر ونرجع array فارغ بدلاً من إرجاع error
                    // لكن نسجل الخطأ بشكل مفصل للتحقق
                }
            }
            else {
                console.warn(`[room questions API] Cannot generate questions: room is ${room ? 'missing invitation_id' : 'null'}`);
            }
        }
        // التأكد من أن questions هو array
        if (!Array.isArray(questions)) {
            console.error(`[room questions API] Questions is not an array:`, typeof questions, questions);
            questions = [];
        }
        res.json({
            success: true,
            data: questions
                .map((question) => {
                try {
                    return {
                        id: question.id,
                        questionOrder: question.question_order,
                        questionText: question.question_text || '',
                        questionImage: question.question_image || null,
                        options: question.options || null,
                        points: question.points || 1,
                        // لا نرسل الإجابة الصحيحة للاعبين
                    };
                }
                catch (mapError) {
                    console.error(`[room questions API] Error mapping question:`, mapError, question);
                    return null;
                }
            })
                .filter((q) => q !== null),
        });
    }
    catch (error) {
        console.error('Error in room questions API:', error);
        console.error('Error stack:', error.stack);
        // محاولة الحصول على roomId و playerId بأمان
        let roomIdSafe;
        let playerIdSafe;
        try {
            roomIdSafe = Number(req.params.roomId);
            if (isNaN(roomIdSafe))
                roomIdSafe = undefined;
        }
        catch {
            roomIdSafe = undefined;
        }
        try {
            playerIdSafe = req.user?.id;
        }
        catch {
            playerIdSafe = undefined;
        }
        console.error('Error details:', {
            roomId: roomIdSafe,
            playerId: playerIdSafe,
            errorMessage: error.message,
            errorCode: error.code,
        });
        res.status(500).json({
            success: false,
            message: 'خطأ في جلب أسئلة الغرفة',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined,
            details: process.env.NODE_ENV === 'development'
                ? {
                    roomId: roomIdSafe,
                    errorCode: error.code,
                    errorStack: error.stack,
                }
                : undefined,
        });
    }
}));
// API لتسجيل إجابة اللاعب
exports.router.post('/room/:roomId/answer', (0, authentication_1.authMiddleware)(['student']), (0, utils_1.asyncWrapper)(async (req, res) => {
    try {
        const playerId = req.user.id;
        const roomId = Number(req.params.roomId);
        const { questionId, answer, timeTaken } = req.body;
        if (isNaN(roomId)) {
            return res.status(400).json({
                success: false,
                message: 'معرف الغرفة غير صحيح',
            });
        }
        if (!questionId || !answer || timeTaken === undefined) {
            return res.status(400).json({
                success: false,
                message: 'بيانات الإجابة غير مكتملة',
            });
        }
        const gameAnswer = await GameService_1.GameService.submitAnswer(roomId, questionId, playerId, answer, timeTaken);
        res.json({
            success: true,
            message: 'تم تسجيل الإجابة بنجاح',
            data: {
                questionId: gameAnswer.question_id,
                answer: gameAnswer.answer,
                isCorrect: gameAnswer.is_correct,
                timeTaken: gameAnswer.time_taken,
                answeredAt: gameAnswer.answered_at,
            },
        });
    }
    catch (error) {
        console.error('Error in submit answer API:', error);
        res.status(400).json({
            success: false,
            message: error.message,
        });
    }
}));
// API لجلب نتيجة اللعبة
exports.router.get('/room/:roomId/result', (0, authentication_1.authMiddleware)(['student']), (0, utils_1.asyncWrapper)(async (req, res) => {
    try {
        const playerId = req.user.id;
        const roomId = Number(req.params.roomId);
        if (isNaN(roomId)) {
            return res.status(400).json({
                success: false,
                message: 'معرف الغرفة غير صحيح',
            });
        }
        // التحقق من أن اللاعب جزء من الغرفة
        const room = await GameService_1.GameService.getRoomDetails(roomId, playerId);
        if (!room) {
            return res.status(404).json({
                success: false,
                message: 'الغرفة غير موجودة أو غير متاحة',
            });
        }
        const result = await GameService_1.GameService.getGameResult(roomId);
        if (!result) {
            return res.status(404).json({
                success: false,
                message: 'النتيجة غير متاحة بعد',
            });
        }
        res.json({
            success: true,
            data: {
                player1Score: result.player1_score,
                player2Score: result.player2_score,
                player1CorrectAnswers: result.player1_correct_answers,
                player2CorrectAnswers: result.player2_correct_answers,
                player1TotalTime: result.player1_total_time,
                player2TotalTime: result.player2_total_time,
                winnerId: result.winner_id,
                isTie: result.is_tie,
                completedAt: result.completed_at,
            },
        });
    }
    catch (error) {
        console.error('Error in game result API:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في جلب نتيجة اللعبة',
        });
    }
}));
// API لجلب إحصائيات اللاعب
exports.router.get('/stats', (0, authentication_1.authMiddleware)(['student']), (0, utils_1.asyncWrapper)(async (req, res) => {
    try {
        const playerId = req.user.id;
        const stats = await GameService_1.GameService.getPlayerStats(playerId);
        res.json({
            success: true,
            data: {
                totalGames: stats.total_games,
                gamesWon: stats.games_won,
                gamesLost: stats.games_lost,
                gamesTied: stats.games_tied,
                totalScore: stats.total_score,
                totalCorrectAnswers: stats.total_correct_answers,
                totalQuestionsAnswered: stats.total_questions_answered,
                averageTimePerQuestion: stats.average_time_per_question,
                winRate: stats.win_rate,
                lastPlayedAt: stats.last_played_at,
            },
        });
    }
    catch (error) {
        console.error('Error in player stats API:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في جلب إحصائيات اللاعب',
        });
    }
}));
// API لتنظيف الدعوات المنتهية الصلاحية
exports.router.post('/cleanup', (0, authentication_1.authMiddleware)(['admin']), (0, utils_1.asyncWrapper)(async (req, res) => {
    try {
        await GameService_1.GameService.cleanupExpiredInvitations();
        res.json({
            success: true,
            message: 'تم تنظيف الدعوات المنتهية الصلاحية',
        });
    }
    catch (error) {
        console.error('Error in cleanup API:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في تنظيف الدعوات',
        });
    }
}));
