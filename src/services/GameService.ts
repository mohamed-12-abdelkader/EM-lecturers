import pool from '../db/pool';

// ==================== Game Configuration Constants ====================
/**
 * إعدادات النظام القابلة للتخصيص
 * يمكن تعديل هذه القيم بسهولة لتغيير سلوك النظام
 *
 * مثال:
 * - لتغيير عدد الأسئلة الافتراضي: غيّر DEFAULT_QUESTIONS_COUNT
 * - لتغيير الوقت لكل سؤال: غيّر DEFAULT_TIME_PER_QUESTION
 * - لتغيير مدة صلاحية الدعوة: غيّر INVITATION_EXPIRY_MINUTES
 */
export const GAME_CONFIG = {
  // الوقت الافتراضي لكل سؤال في الغرفة (بالثواني)
  DEFAULT_TIME_PER_QUESTION: 120, // 2 دقائق

  // الوقت الافتراضي للإجابة على سؤال في game_questions (بالثواني)
  DEFAULT_QUESTION_TIME_LIMIT: 120, // 2 دقائق

  // عدد الأسئلة الافتراضي إذا لم يتم تحديده
  DEFAULT_QUESTIONS_COUNT: 10,

  // الحالات المقبولة للأسئلة (الأسئلة المقبولة فقط يتم استخدامها)
  APPROVED_QUESTION_STATUS: ['approved', null, ''] as (string | null)[],

  // الحد الأقصى لعدد الطلاب المدعوين في دعوة واحدة
  MAX_INVITEES: 8,

  // مدة صلاحية الدعوة (بالدقائق)
  INVITATION_EXPIRY_MINUTES: 3,
} as const;

// ==================== Type Definitions ====================
export interface GameInvitation {
  id: number;
  inviter_id: number;
  invitee_id: number;
  lesson_ids: string[];
  questions_count: number;
  status: 'pending' | 'accepted' | 'rejected' | 'expired';
  created_at: Date;
  expires_at: Date;
  accepted_at?: Date;
  rejected_at?: Date;
}

export interface GameRoom {
  id: number;
  invitation_id: number;
  player1_id: number;
  player2_id: number;
  status: 'waiting' | 'active' | 'completed' | 'abandoned';
  questions_count: number;
  time_per_question: number;
  total_time: number;
  current_question: number;
  started_at?: Date;
  completed_at?: Date;
  created_at: Date;
}

export interface GameQuestion {
  id: number;
  room_id: number;
  question_id: number;
  question_order: number;
  question_text?: string;
  question_image?: string;
  options?: any;
  correct_answer?: string;
  points: number;
  created_at: Date;
}

export interface GameAnswer {
  id: number;
  room_id: number;
  question_id: number;
  player_id: number;
  answer: string;
  is_correct: boolean;
  answered_at: Date;
  time_taken: number;
}

export interface GameResult {
  id: number;
  room_id: number;
  player1_id: number;
  player2_id: number;
  player1_score: number;
  player2_score: number;
  player1_correct_answers: number;
  player2_correct_answers: number;
  player1_total_time: number;
  player2_total_time: number;
  winner_id?: number;
  is_tie: boolean;
  completed_at: Date;
}

export class GameService {
  /**
   * إنشاء دعوة لعبة جديدة
   *
   * @param inviterId - معرف الطالب المرسل للدعوة
   * @param inviteeId - معرف الطالب المدعو
   * @param lessonIds - مصفوفة معرفات الدروس المحددة من بنك الأسئلة
   * @param questionsCount - عدد الأسئلة المطلوب في اللعبة (افتراضي: من GAME_CONFIG)
   *
   * العملية:
   * 1️⃣ الطالب يحدد الدروس (IDs) من بنك الأسئلة
   * 2️⃣ يحدد عدد الأسئلة المطلوبة
   * 3️⃣ يتم حفظ هذه المعلومات في الدعوة
   * 4️⃣ عند قبول الدعوة، يتم استخدام هذه القيم لجلب الأسئلة
   */
  static async createInvitation(
    inviterId: number,
    inviteeId: number,
    lessonIds: number[],
    questionsCount: number = GAME_CONFIG.DEFAULT_QUESTIONS_COUNT,
  ): Promise<GameInvitation> {
    console.log(
      `[createInvitation] Creating invitation with inviterId: ${inviterId} (type: ${typeof inviterId}), inviteeId: ${inviteeId}`,
    );
    // التحقق من أن الطالب المدعو موجود
    const inviteeCheck = await pool.query(
      'SELECT id, name FROM users WHERE id = $1::INTEGER AND role = $2',
      [inviteeId, 'student'],
    );

    if (!inviteeCheck.rowCount) {
      throw new Error('الطالب المدعو غير موجود');
    }

    // التحقق من أن الدروس موجودة في بنك الأسئلة
    // تحسين الاستعلام ليكون أسرع - استخدام EXISTS بدلاً من JOIN متعددة
    try {
      const lessonsCheck = await pool.query(
        `SELECT l.id 
         FROM lessons l
         WHERE l.id = ANY($1::INTEGER[])
           AND EXISTS (
             SELECT 1 
             FROM chapters c
             JOIN subjects s ON s.id = c.subject_id
             JOIN question_banks qb ON qb.id = s.question_bank_id
             JOIN user_grades ug ON ug.grade_id = qb.grade_id
             WHERE c.id = l.chapter_id AND ug.user_id = $2::INTEGER
           )`,
        [lessonIds, inviterId],
      );

      if (lessonsCheck.rowCount !== lessonIds.length) {
        throw new Error('بعض الدروس غير موجودة أو غير متاحة');
      }
    } catch (error: any) {
      // إذا فشل الاستعلام بسبب timeout، جرّب استعلام أبسط
      if (error.message?.includes('timeout') || error.message?.includes('Connection')) {
        console.error('Lessons check query timed out, trying simpler query...');
        const simpleCheck = await pool.query(
          `SELECT id FROM lessons WHERE id = ANY($1::INTEGER[])`,
          [lessonIds],
        );
        if (simpleCheck.rowCount !== lessonIds.length) {
          throw new Error('بعض الدروس غير موجودة');
        }
      } else {
        throw error;
      }
    }

    // التحقق من عدم وجود دعوة معلقة للمستقبل (invitee)
    // لا يمكن إرسال دعوة جديدة للمستقبل إذا كان لديه دعوة معلقة لم تُقبل أو تُرفض أو تنتهي
    const existingInvitationForInvitee = await pool.query(
      `SELECT id FROM game_invitations 
       WHERE invitee_id = $1::INTEGER
         AND status = 'pending'
         AND accepted_at IS NULL
         AND rejected_at IS NULL
         AND expires_at > NOW()`,
      [inviteeId],
    );

    if (existingInvitationForInvitee.rowCount && existingInvitationForInvitee.rowCount > 0) {
      throw new Error('الطالب لديه دعوة معلقة بالفعل. يجب عليه قبولها أو رفضها أولاً');
    }

    // التحقق من عدم وجود دعوة معلقة بين نفس الطالبين (من أي اتجاه)
    // لا يمكن إرسال دعوة جديدة إذا كانت هناك دعوة pending بين نفس الطالبين
    const existingInvitationBetween = await pool.query(
      `SELECT id, inviter_id, invitee_id, status, expires_at 
       FROM game_invitations 
       WHERE ((inviter_id = $1::INTEGER AND invitee_id = $2::INTEGER) OR (inviter_id = $2::INTEGER AND invitee_id = $1::INTEGER))
         AND status = 'pending' 
         AND expires_at > NOW()`,
      [inviterId, inviteeId],
    );

    if (existingInvitationBetween.rowCount && existingInvitationBetween.rowCount > 0) {
      const pendingInvitation = existingInvitationBetween.rows[0];
      const isOutgoing = pendingInvitation.inviter_id === inviterId;
      const errorMessage = isOutgoing
        ? 'لديك دعوة معلقة مع هذا الطالب. يجب انتظار الرد أولاً'
        : 'هذا الطالب لديه دعوة معلقة معك. يجب انتظار الرد أولاً';
      throw new Error(errorMessage);
    }

    // إنشاء الدعوة
    // Use selected_lessons if it exists, otherwise use lesson_ids
    // This supports both column names until migration renames selected_lessons to lesson_ids
    let result;
    try {
      // Try with lesson_ids first (preferred)
      const lessonIdsAsText = lessonIds.map((id) => id.toString());
      console.log(`[createInvitation] Attempting INSERT with lesson_ids:`, lessonIdsAsText);

      result = await pool.query(
        `INSERT INTO game_invitations (inviter_id, invitee_id, lesson_ids, questions_count, expires_at)
         VALUES ($1::INTEGER, $2::INTEGER, $3::TEXT[], $4::INTEGER, NOW() + INTERVAL '3 minutes')
         RETURNING *`,
        [inviterId, inviteeId, lessonIdsAsText, questionsCount],
      );

      const savedRow = result.rows[0];
      console.log(`[createInvitation] Successfully created invitation with id: ${savedRow.id}`);
      console.log(`[createInvitation] Saved lesson_ids (raw):`, savedRow.lesson_ids);
      console.log(
        `[createInvitation] Saved lesson_ids (type):`,
        typeof savedRow.lesson_ids,
        Array.isArray(savedRow.lesson_ids),
      );

      // Verify the data was actually saved by querying it back
      const verifyCheck = await pool.query(
        `SELECT lesson_ids, selected_lessons FROM game_invitations WHERE id = $1::INTEGER`,
        [savedRow.id],
      );
      console.log(`[createInvitation] Verification - Data in DB:`, {
        lesson_ids: verifyCheck.rows[0]?.lesson_ids,
        lesson_ids_array_length: Array.isArray(verifyCheck.rows[0]?.lesson_ids)
          ? verifyCheck.rows[0].lesson_ids.length
          : 'N/A',
        selected_lessons: verifyCheck.rows[0]?.selected_lessons,
      });

      return savedRow;
    } catch (error: any) {
      // If lesson_ids doesn't exist, use selected_lessons
      if (error.message?.includes('lesson_ids') || error.message?.includes('column')) {
        console.log(
          `[createInvitation] lesson_ids column not found, using selected_lessons with:`,
          lessonIds,
        );
        result = await pool.query(
          `INSERT INTO game_invitations (inviter_id, invitee_id, selected_lessons, questions_count, expires_at)
           VALUES ($1::INTEGER, $2::INTEGER, $3::INTEGER[], $4::INTEGER, NOW() + INTERVAL '3 minutes')
           RETURNING *`,
          [inviterId, inviteeId, lessonIds, questionsCount],
        );
        const savedRow = result.rows[0];
        console.log(
          `[createInvitation] Successfully created invitation using selected_lessons, id: ${savedRow.id}`,
        );
        console.log(`[createInvitation] Saved selected_lessons (raw):`, savedRow.selected_lessons);

        // Verify the data was actually saved by querying it back
        const verifyCheck = await pool.query(
          `SELECT lesson_ids, selected_lessons FROM game_invitations WHERE id = $1::INTEGER`,
          [savedRow.id],
        );
        console.log(`[createInvitation] Verification - Data in DB:`, {
          lesson_ids: verifyCheck.rows[0]?.lesson_ids,
          selected_lessons: verifyCheck.rows[0]?.selected_lessons,
          selected_lessons_array_length: Array.isArray(verifyCheck.rows[0]?.selected_lessons)
            ? verifyCheck.rows[0].selected_lessons.length
            : 'N/A',
        });

        // Map selected_lessons to lesson_ids for compatibility
        if (savedRow.selected_lessons && Array.isArray(savedRow.selected_lessons)) {
          savedRow.lesson_ids = savedRow.selected_lessons.map((id: number) => String(id));
          console.log(
            `[createInvitation] Mapped selected_lessons to lesson_ids:`,
            savedRow.lesson_ids,
          );
        }

        return savedRow;
      } else {
        throw error;
      }
    }

    return result.rows[0];
  }

  /**
   * إنشاء دعوات متعددة لعدة طلاب
   *
   * @param inviterId - معرف الطالب المرسل للدعوة
   * @param inviteeIds - مصفوفة معرفات الطلاب المدعوين (حد أقصى: 8)
   * @param lessonIds - مصفوفة معرفات الدروس المحددة من بنك الأسئلة
   * @param questionsCount - عدد الأسئلة المطلوب في اللعبة
   *
   * العملية:
   * 1️⃣ يتم إنشاء دعوة لكل طالب مدعو
   * 2️⃣ جميع الدعوات تستخدم نفس lessonIds و questionsCount
   * 3️⃣ عند قبول أي دعوة، يتم استخدام نفس الإعدادات
   */
  static async createBulkInvitations(
    inviterId: number,
    inviteeIds: number[],
    lessonIds: number[],
    questionsCount: number = GAME_CONFIG.DEFAULT_QUESTIONS_COUNT,
  ): Promise<Array<{ inviteeId: number; success: boolean; invitation?: any; error?: string }>> {
    console.log(
      `[createBulkInvitations] Creating bulk invitations for ${inviteeIds.length} students`,
    );

    const results: Array<{
      inviteeId: number;
      success: boolean;
      invitation?: any;
      error?: string;
    }> = [];

    // التحقق من أن جميع الطلاب المدعوين موجودون
    const inviteeCheck = await pool.query(
      'SELECT id, name FROM users WHERE id = ANY($1::INTEGER[]) AND role = $2',
      [inviteeIds, 'student'],
    );

    const validInviteeIds = inviteeCheck.rows.map((row) => row.id);
    const invalidInviteeIds = inviteeIds.filter((id) => !validInviteeIds.includes(id));

    // إضافة أخطاء للطلاب غير الموجودين
    invalidInviteeIds.forEach((inviteeId) => {
      results.push({
        inviteeId,
        success: false,
        error: 'الطالب غير موجود',
      });
    });

    // التحقق من أن الدروس موجودة في بنك الأسئلة
    try {
      const lessonsCheck = await pool.query(
        `SELECT l.id 
         FROM lessons l
         WHERE l.id = ANY($1::INTEGER[])
           AND EXISTS (
             SELECT 1 
             FROM chapters c
             JOIN subjects s ON s.id = c.subject_id
             JOIN question_banks qb ON qb.id = s.question_bank_id
             JOIN user_grades ug ON ug.grade_id = qb.grade_id
             WHERE c.id = l.chapter_id AND ug.user_id = $2::INTEGER
           )`,
        [lessonIds, inviterId],
      );

      if (lessonsCheck.rowCount !== lessonIds.length) {
        // إذا فشل التحقق من الدروس، أضف خطأ لجميع الطلاب
        validInviteeIds.forEach((inviteeId) => {
          results.push({
            inviteeId,
            success: false,
            error: 'بعض الدروس غير موجودة أو غير متاحة',
          });
        });
        return results;
      }
    } catch (error: any) {
      // إذا فشل الاستعلام بسبب timeout، جرّب استعلام أبسط
      if (error.message?.includes('timeout') || error.message?.includes('Connection')) {
        console.error('Lessons check query timed out, trying simpler query...');
        const simpleCheck = await pool.query(
          `SELECT id FROM lessons WHERE id = ANY($1::INTEGER[])`,
          [lessonIds],
        );
        if (simpleCheck.rowCount !== lessonIds.length) {
          validInviteeIds.forEach((inviteeId) => {
            results.push({
              inviteeId,
              success: false,
              error: 'بعض الدروس غير موجودة',
            });
          });
          return results;
        }
      } else {
        throw error;
      }
    }

    // إنشاء دعوة لكل طالب صالح
    for (const inviteeId of validInviteeIds) {
      try {
        // التحقق من عدم وجود دعوة معلقة للمستقبل (invitee)
        const existingInvitationForInvitee = await pool.query(
          `SELECT id FROM game_invitations 
           WHERE invitee_id = $1::INTEGER
             AND status = 'pending'
             AND accepted_at IS NULL
             AND rejected_at IS NULL
             AND expires_at > NOW()`,
          [inviteeId],
        );

        if (existingInvitationForInvitee.rowCount && existingInvitationForInvitee.rowCount > 0) {
          results.push({
            inviteeId,
            success: false,
            error: 'الطالب لديه دعوة معلقة بالفعل',
          });
          continue;
        }

        // التحقق من عدم وجود دعوة معلقة بين نفس الطالبين (من أي اتجاه)
        // لا يمكن إرسال دعوة جديدة إذا كانت هناك دعوة pending بين نفس الطالبين
        const existingInvitationBetween = await pool.query(
          `SELECT id, inviter_id, invitee_id, status, expires_at 
           FROM game_invitations 
           WHERE ((inviter_id = $1::INTEGER AND invitee_id = $2::INTEGER) OR (inviter_id = $2::INTEGER AND invitee_id = $1::INTEGER))
             AND status = 'pending' 
             AND expires_at > NOW()`,
          [inviterId, inviteeId],
        );

        if (existingInvitationBetween.rowCount && existingInvitationBetween.rowCount > 0) {
          const pendingInvitation = existingInvitationBetween.rows[0];
          const isOutgoing = pendingInvitation.inviter_id === inviterId;
          const errorMessage = isOutgoing
            ? 'لديك دعوة معلقة مع هذا الطالب. يجب انتظار الرد أولاً'
            : 'هذا الطالب لديه دعوة معلقة معك. يجب انتظار الرد أولاً';

          results.push({
            inviteeId,
            success: false,
            error: errorMessage,
          });
          continue;
        }

        // إنشاء الدعوة
        let result;
        try {
          // Try with lesson_ids first (preferred)
          const lessonIdsAsText = lessonIds.map((id) => id.toString());

          console.log(`[createBulkInvitations] Creating invitation for student ${inviteeId}:`, {
            inviterId,
            inviteeId,
            lessonIds: lessonIds,
            lessonIdsAsText: lessonIdsAsText,
            questionsCount,
          });

          result = await pool.query(
            `INSERT INTO game_invitations (inviter_id, invitee_id, lesson_ids, questions_count, expires_at)
             VALUES ($1::INTEGER, $2::INTEGER, $3::TEXT[], $4::INTEGER, NOW() + INTERVAL '3 minutes')
             RETURNING id, inviter_id, invitee_id, lesson_ids, questions_count`,
            [inviterId, inviteeId, lessonIdsAsText, questionsCount],
          );

          console.log(
            `[createBulkInvitations] Successfully created invitation for student ${inviteeId}, id: ${result.rows[0].id}`,
          );
          console.log(`[createBulkInvitations] Saved lesson_ids:`, result.rows[0].lesson_ids);
        } catch (error: any) {
          // If lesson_ids doesn't exist, use selected_lessons
          if (error.message?.includes('lesson_ids') || error.message?.includes('column')) {
            result = await pool.query(
              `INSERT INTO game_invitations (inviter_id, invitee_id, selected_lessons, questions_count, expires_at)
               VALUES ($1::INTEGER, $2::INTEGER, $3::INTEGER[], $4::INTEGER, NOW() + INTERVAL '3 minutes')
               RETURNING *`,
              [inviterId, inviteeId, lessonIds, questionsCount],
            );

            // Map selected_lessons to lesson_ids for compatibility
            if (result.rows[0] && result.rows[0].selected_lessons) {
              result.rows[0].lesson_ids = result.rows[0].selected_lessons.map((id: number) =>
                String(id),
              );
            }

            console.log(
              `[createBulkInvitations] Successfully created invitation using selected_lessons for student ${inviteeId}, id: ${result.rows[0].id}`,
            );
          } else {
            throw error;
          }
        }

        results.push({
          inviteeId,
          success: true,
          invitation: result.rows[0],
        });
      } catch (error: any) {
        console.error(
          `[createBulkInvitations] Error creating invitation for student ${inviteeId}:`,
          error,
        );
        results.push({
          inviteeId,
          success: false,
          error: error.message || 'خطأ في إنشاء الدعوة',
        });
      }
    }

    console.log(
      `[createBulkInvitations] Completed: ${results.filter((r) => r.success).length} successful, ${results.filter((r) => !r.success).length} failed`,
    );
    return results;
  }

  /**
   * قبول الدعوة وإنشاء غرفة اللعبة
   *
   * @param invitationId - معرف الدعوة
   * @param inviteeId - معرف الطالب الذي قبل الدعوة
   *
   * العملية:
   * 1️⃣ التحقق من صحة الدعوة وعدم انتهاء صلاحيتها
   * 2️⃣ استخراج lessonIds و questionsCount من الدعوة
   * 3️⃣ إنشاء غرفة اللعبة (game_rooms)
   * 4️⃣ جلب الأسئلة العشوائية من الدروس المحددة وبالعدد المحدد
   * 5️⃣ حفظ الأسئلة في game_questions
   *
   * الأسئلة المولدة:
   * - تكون من الدروس المحددة في lessonIds فقط ✅
   * - تكون عشوائية (ORDER BY RANDOM()) ✅
   * - بالعدد المحدد في questionsCount ✅
   */
  static async acceptInvitation(invitationId: number, inviteeId: number): Promise<GameRoom> {
    // التحقق من الدعوة
    // بعد 3 دقائق (انتهاء الدعوة)، يمكن القبول فقط إذا كان هناك طلاب آخرون قبلوا الدعوة
    // نستخدم SQL للتحقق من expires_at مباشرة لتجنب مشاكل timezone
    // نختار lesson_ids و selected_lessons بشكل صريح
    const invitationResult = await pool.query(
      `SELECT id, inviter_id, invitee_id, lesson_ids, selected_lessons, 
              questions_count, status, created_at, expires_at, 
              accepted_at, rejected_at,
              (expires_at > NOW()) as is_not_expired,
              (expires_at < NOW()) as is_expired
       FROM game_invitations 
       WHERE id = $1::INTEGER AND invitee_id = $2::INTEGER`,
      [invitationId, inviteeId],
    );

    if (!invitationResult.rowCount) {
      throw new Error('الدعوة غير موجودة');
    }

    const invitation = invitationResult.rows[0];

    // إذا كانت الدعوة قبلت أو رفضت مسبقاً
    if (invitation.status === 'accepted') {
      // جلب الغرفة إذا كانت موجودة
      const roomCheck = await pool.query(`SELECT * FROM game_rooms WHERE invitation_id = $1`, [
        invitationId,
      ]);
      if (roomCheck.rowCount && roomCheck.rowCount > 0) {
        return roomCheck.rows[0];
      }
    }

    if (invitation.status === 'rejected') {
      throw new Error('تم رفض هذه الدعوة مسبقاً');
    }

    // التحقق من صلاحية الدعوة باستخدام القيمة من SQL
    // SQL يتحقق من expires_at > NOW() مباشرة في قاعدة البيانات
    // PostgreSQL يُرجع boolean، لكن قد يأتي كـ string في بعض الحالات
    const isNotExpired =
      invitation.is_not_expired === true ||
      invitation.is_not_expired === 't' ||
      invitation.is_not_expired === 'true' ||
      String(invitation.is_not_expired) === 'true';
    const isExpired = !isNotExpired;

    console.log(`[acceptInvitation] Checking invitation ${invitationId}:`, {
      status: invitation.status,
      expires_at: invitation.expires_at,
      is_not_expired_raw: invitation.is_not_expired,
      is_not_expired_type: typeof invitation.is_not_expired,
      is_not_expired_boolean: isNotExpired,
      is_expired: isExpired,
    });

    // إذا كانت الدعوة pending ولم تنته - قبول عادي (يستمر في الكود)
    if (invitation.status === 'pending' && isNotExpired) {
      console.log(
        `[acceptInvitation] Invitation ${invitationId} is pending and not expired - proceeding with normal acceptance`,
      );
      // استمر في القبول - لا حاجة لتحقق إضافي
    }
    // إذا كانت الدعوة pending ولكن انتهت - نتحقق من وجود طلاب آخرين قبلوا
    else if (invitation.status === 'pending' && !isNotExpired) {
      console.log(
        `[acceptInvitation] Invitation ${invitationId} is expired - checking for other accepted invitations`,
      );

      // الدعوة انتهت ولكن لا تزال pending
      // نتحقق من وجود طلاب آخرين قبلوا من نفس المجموعة
      const referenceTimeStart = new Date(new Date(invitation.created_at).getTime() - 10000);
      const referenceTimeEnd = new Date(new Date(invitation.created_at).getTime() + 10000);

      const otherAcceptedInvitations = await pool.query(
        `SELECT id FROM game_invitations 
         WHERE inviter_id = $1::INTEGER
           AND created_at >= $2::TIMESTAMP
           AND created_at <= $3::TIMESTAMP
           AND questions_count = $4::INTEGER
           AND status = 'accepted'
           AND id != $5::INTEGER`,
        [
          invitation.inviter_id,
          referenceTimeStart,
          referenceTimeEnd,
          invitation.questions_count,
          invitationId,
        ],
      );

      console.log(
        `[acceptInvitation] Found ${otherAcceptedInvitations.rowCount} other accepted invitations in the same group`,
      );

      if (otherAcceptedInvitations.rowCount === 0) {
        throw new Error('انتهت صلاحية الدعوة ولم يقبلها أي طالب آخر');
      }
    }
    // إذا كانت الدعوة expired (تم تحديثها بواسطة cleanup job)
    else if (invitation.status === 'expired') {
      console.log(`[acceptInvitation] Invitation ${invitationId} status is already 'expired'`);
      // نتحقق من وجود طلاب آخرين قبلوا من نفس المجموعة
      const referenceTimeStart = new Date(new Date(invitation.created_at).getTime() - 10000);
      const referenceTimeEnd = new Date(new Date(invitation.created_at).getTime() + 10000);

      const otherAcceptedInvitations = await pool.query(
        `SELECT id FROM game_invitations 
         WHERE inviter_id = $1::INTEGER
           AND created_at >= $2::TIMESTAMP
           AND created_at <= $3::TIMESTAMP
           AND questions_count = $4::INTEGER
           AND status = 'accepted'
           AND id != $5::INTEGER`,
        [
          invitation.inviter_id,
          referenceTimeStart,
          referenceTimeEnd,
          invitation.questions_count,
          invitationId,
        ],
      );

      if (otherAcceptedInvitations.rowCount === 0) {
        throw new Error('انتهت صلاحية الدعوة ولم يقبلها أي طالب آخر');
      }
    }

    // Ensure lesson_ids field exists (map from selected_lessons if needed)
    console.log(`[acceptInvitation] Raw invitation data for lesson_ids:`, {
      invitation_id: invitation.id,
      lesson_ids_raw: invitation.lesson_ids,
      lesson_ids_type: typeof invitation.lesson_ids,
      lesson_ids_is_array: Array.isArray(invitation.lesson_ids),
      selected_lessons_raw: invitation.selected_lessons,
      selected_lessons_type: typeof invitation.selected_lessons,
      selected_lessons_is_array: Array.isArray(invitation.selected_lessons),
    });

    // جلب البيانات مباشرة من قاعدة البيانات للتحقق
    const lessonIdsCheck = await pool.query(
      `SELECT lesson_ids, selected_lessons,
              pg_typeof(lesson_ids) as lesson_ids_type,
              pg_typeof(selected_lessons) as selected_lessons_type,
              array_length(lesson_ids, 1) as lesson_ids_length,
              array_length(selected_lessons, 1) as selected_lessons_length
       FROM game_invitations 
       WHERE id = $1::INTEGER`,
      [invitationId],
    );

    const rawData = lessonIdsCheck.rows[0];
    console.log(`[acceptInvitation] Direct DB check for lesson_ids:`, {
      lesson_ids: rawData?.lesson_ids,
      lesson_ids_stringified: rawData?.lesson_ids ? JSON.stringify(rawData.lesson_ids) : 'NULL',
      lesson_ids_type: rawData?.lesson_ids_type,
      lesson_ids_length: rawData?.lesson_ids_length,
      selected_lessons: rawData?.selected_lessons,
      selected_lessons_stringified: rawData?.selected_lessons
        ? JSON.stringify(rawData.selected_lessons)
        : 'NULL',
      selected_lessons_type: rawData?.selected_lessons_type,
      selected_lessons_length: rawData?.selected_lessons_length,
    });

    let lessonIds: any[] = [];

    // Priority 1: Use lesson_ids from raw DB data
    if (rawData?.lesson_ids !== null && rawData?.lesson_ids !== undefined) {
      if (Array.isArray(rawData.lesson_ids)) {
        lessonIds = rawData.lesson_ids;
        console.log(`[acceptInvitation] Using lesson_ids from raw DB (array):`, lessonIds);
      } else if (typeof rawData.lesson_ids === 'string') {
        try {
          const parsed = JSON.parse(rawData.lesson_ids);
          if (Array.isArray(parsed)) {
            lessonIds = parsed;
            console.log(`[acceptInvitation] Parsed lesson_ids from string:`, lessonIds);
          }
        } catch {
          console.error(
            `[acceptInvitation] Failed to parse lesson_ids string:`,
            rawData.lesson_ids,
          );
        }
      }
    }

    // If lesson_ids is empty, try selected_lessons
    if (
      lessonIds.length === 0 &&
      rawData?.selected_lessons !== null &&
      rawData?.selected_lessons !== undefined
    ) {
      if (Array.isArray(rawData.selected_lessons)) {
        lessonIds = rawData.selected_lessons;
        console.log(`[acceptInvitation] Using selected_lessons from raw DB (array):`, lessonIds);
      }
    }

    // Fallback to invitation object data
    if (lessonIds.length === 0) {
      if (invitation.lesson_ids && Array.isArray(invitation.lesson_ids)) {
        lessonIds = invitation.lesson_ids;
        console.log(`[acceptInvitation] Using lesson_ids from invitation object:`, lessonIds);
      } else if (invitation.selected_lessons && Array.isArray(invitation.selected_lessons)) {
        lessonIds = invitation.selected_lessons;
        console.log(`[acceptInvitation] Using selected_lessons from invitation object:`, lessonIds);
      }
    }

    console.log(`[acceptInvitation] Final lessonIds before validation:`, lessonIds);

    if (!lessonIds || lessonIds.length === 0) {
      console.error(`[acceptInvitation] ERROR: No lesson IDs found for invitation ${invitationId}`);
      throw new Error('لا توجد دروس محددة في الدعوة');
    }

    // تحديث حالة الدعوة
    await pool.query(
      `UPDATE game_invitations 
       SET status = 'accepted', accepted_at = NOW() 
       WHERE id = $1`,
      [invitationId],
    );

    // حساب وقت اللعبة بناءً على الإعدادات
    // الوقت لكل سؤال + إجمالي الوقت = عدد الأسئلة × الوقت لكل سؤال
    const timePerQuestion = GAME_CONFIG.DEFAULT_TIME_PER_QUESTION;
    const totalTime = invitation.questions_count * timePerQuestion;

    console.log(`[acceptInvitation] ⏱️ Time calculation:`);
    console.log(`  - Time per question: ${timePerQuestion} seconds`);
    console.log(`  - Total questions: ${invitation.questions_count}`);
    console.log(`  - Total time: ${totalTime} seconds (${totalTime / 60} minutes)`);

    // إنشاء غرفة اللعبة
    // محاولة INSERT مع جميع الأعمدة المحتملة
    let roomResult;
    try {
      // محاولة أولى: مع questions_count و total_questions
      roomResult = await pool.query(
        `INSERT INTO game_rooms (invitation_id, player1_id, player2_id, questions_count, total_questions, time_per_question, total_time)
         VALUES ($1::INTEGER, $2::INTEGER, $3::INTEGER, $4::INTEGER, $5::INTEGER, $6::INTEGER, $7::INTEGER)
         RETURNING *`,
        [
          invitationId,
          invitation.inviter_id,
          invitation.invitee_id,
          invitation.questions_count,
          invitation.questions_count,
          timePerQuestion,
          totalTime,
        ],
      );
    } catch (error: any) {
      // إذا فشل بسبب total_questions، جرّب بدون total_questions
      if (error.message?.includes('total_questions')) {
        console.warn(`[acceptInvitation] total_questions column issue, trying without it`);
        try {
          roomResult = await pool.query(
            `INSERT INTO game_rooms (invitation_id, player1_id, player2_id, questions_count, time_per_question, total_time)
             VALUES ($1::INTEGER, $2::INTEGER, $3::INTEGER, $4::INTEGER, $5::INTEGER, $6::INTEGER)
             RETURNING *`,
            [
              invitationId,
              invitation.inviter_id,
              invitation.invitee_id,
              invitation.questions_count,
              timePerQuestion,
              totalTime,
            ],
          );
        } catch (error2: any) {
          // إذا فشل أيضاً بسبب questions_count، جرّب بدون questions_count
          if (error2.message?.includes('questions_count')) {
            console.warn(`[acceptInvitation] questions_count column not found, trying without it`);
            roomResult = await pool.query(
              `INSERT INTO game_rooms (invitation_id, player1_id, player2_id, total_questions, time_per_question, total_time)
               VALUES ($1::INTEGER, $2::INTEGER, $3::INTEGER, $4::INTEGER, $5::INTEGER, $6::INTEGER)
               RETURNING *`,
              [
                invitationId,
                invitation.inviter_id,
                invitation.invitee_id,
                invitation.questions_count,
                timePerQuestion,
                totalTime,
              ],
            );
            // إضافة questions_count كخاصية في JavaScript
            if (roomResult.rows[0]) {
              roomResult.rows[0].questions_count = invitation.questions_count;
            }
          } else {
            throw error2;
          }
        }
      } else if (error.message?.includes('questions_count')) {
        // إذا فشل بسبب questions_count فقط، جرّب مع total_questions فقط
        console.warn(
          `[acceptInvitation] questions_count column not found, trying with total_questions only`,
        );
        try {
          roomResult = await pool.query(
            `INSERT INTO game_rooms (invitation_id, player1_id, player2_id, total_questions, time_per_question, total_time)
             VALUES ($1::INTEGER, $2::INTEGER, $3::INTEGER, $4::INTEGER, $5::INTEGER, $6::INTEGER)
             RETURNING *`,
            [
              invitationId,
              invitation.inviter_id,
              invitation.invitee_id,
              invitation.questions_count,
              timePerQuestion,
              totalTime,
            ],
          );
          // إضافة questions_count كخاصية في JavaScript
          if (roomResult.rows[0]) {
            roomResult.rows[0].questions_count = invitation.questions_count;
          }
        } catch {
          // آخر محاولة: الأعمدة الأساسية فقط
          roomResult = await pool.query(
            `INSERT INTO game_rooms (invitation_id, player1_id, player2_id, time_per_question, total_time)
             VALUES ($1::INTEGER, $2::INTEGER, $3::INTEGER, $4::INTEGER, $5::INTEGER)
             RETURNING *`,
            [
              invitationId,
              invitation.inviter_id,
              invitation.invitee_id,
              timePerQuestion,
              totalTime,
            ],
          );
          // إضافة questions_count و total_questions كخاصيات في JavaScript
          if (roomResult.rows[0]) {
            roomResult.rows[0].questions_count = invitation.questions_count;
            roomResult.rows[0].total_questions = invitation.questions_count;
          }
        }
      } else {
        throw error;
      }
    }

    const room = roomResult.rows[0];

    // تحويل lessonIds إلى format صحيح للاستعلام (INTEGER[])
    const lessonIdsForQuery = lessonIds
      .map((id: any) => {
        if (typeof id === 'number') {
          return id;
        }
        if (typeof id === 'string') {
          const parsed = parseInt(id);
          return isNaN(parsed) ? null : parsed;
        }
        return null;
      })
      .filter((id: number | null): id is number => id !== null);

    console.log(`[acceptInvitation] Processed lessonIds for query:`, lessonIdsForQuery);

    if (lessonIdsForQuery.length === 0) {
      throw new Error('لا توجد دروس صحيحة في الدعوة');
    }

    // جلب الأسئلة العشوائية من الدروس المحددة
    // generateGameQuestions يتوقع TEXT[] أو INTEGER[] - نمرر كـ string array
    const lessonIdsAsStrings = lessonIdsForQuery.map((id) => id.toString());

    console.log(`[acceptInvitation] About to generate questions for room ${room.id}`);
    console.log(`[acceptInvitation] Parameters:`, {
      roomId: room.id,
      lessonIds: lessonIdsAsStrings,
      questionsCount: invitation.questions_count,
    });

    try {
      await this.generateGameQuestions(room.id, lessonIdsAsStrings, invitation.questions_count);
      console.log(`[acceptInvitation] Successfully generated questions for room ${room.id}`);
    } catch (error: any) {
      console.error(`[acceptInvitation] Error generating questions for room ${room.id}:`, error);
      console.error(`[acceptInvitation] Error stack:`, error.stack);
      // لا نرمي الخطأ هنا - نترك الغرفة تُنشأ ويمكن إنشاء الأسئلة لاحقاً
      // لكننا نسجل الخطأ للتحقق منه
      console.warn(
        `[acceptInvitation] Room ${room.id} created but questions generation failed. Questions can be generated later via API.`,
      );
    }

    return room;
  }

  // رفض الدعوة
  static async rejectInvitation(invitationId: number, inviteeId: number): Promise<void> {
    const result = await pool.query(
      `UPDATE game_invitations 
       SET status = 'rejected', rejected_at = NOW() 
       WHERE id = $1 AND invitee_id = $2 AND status = 'pending'`,
      [invitationId, inviteeId],
    );

    if (!result.rowCount) {
      throw new Error('الدعوة غير موجودة أو تم التعامل معها مسبقاً');
    }
  }

  /**
   * جلب الأسئلة العشوائية وإنشاؤها للعبة
   *
   * @param roomId - معرف الغرفة
   * @param lessonIds - مصفوفة معرفات الدروس المحددة عند إرسال الدعوة
   * @param questionsCount - عدد الأسئلة المطلوب (المحدد عند إرسال الدعوة)
   *
   * العملية:
   * 1️⃣ يتم جلب الأسئلة بشكل عشوائي من الدروس المحددة فقط
   * 2️⃣ يتم تحديد عدد الأسئلة بناءً على القيمة المرسلة في الدعوة
   * 3️⃣ يتم حفظ الأسئلة في جدول game_questions للغرفة
   *
   * ملاحظات:
   * - الأسئلة تكون مقتصرة فقط على الدروس المحددة في lessonIds
   * - يتم استخدام ORDER BY RANDOM() لضمان العشوائية
   * - يتم فلترة الأسئلة المقبولة فقط (approved)
   */
  static async generateGameQuestions(
    roomId: number,
    lessonIds: string[],
    questionsCount: number,
  ): Promise<void> {
    console.log(`[generateGameQuestions] 🎮 Generating questions for room ${roomId}`);
    console.log(`  📚 Lesson IDs:`, lessonIds);
    console.log(`  🔢 Questions Count:`, questionsCount);

    // 1️⃣ تحويل lessonIds إلى INTEGER[] للاستعلامات
    const lessonIdsInt = lessonIds.map((id) => {
      const parsed = typeof id === 'string' ? parseInt(id) : id;
      if (isNaN(parsed)) {
        throw new Error(`Invalid lesson ID: ${id}`);
      }
      return parsed;
    });

    if (lessonIdsInt.length === 0) {
      throw new Error('لم يتم تحديد أي دروس');
    }

    console.log(`  ✅ Processed Lesson IDs:`, lessonIdsInt);

    // 2️⃣ التحقق من وجود أسئلة في الدروس المحددة
    const questionsCheck = await pool.query(
      `SELECT COUNT(*) as total, 
              COUNT(CASE WHEN q.status IS NULL OR q.status = '' OR q.status = 'approved' THEN 1 END) as approved_count
       FROM questions q
       WHERE q.lesson_id = ANY($1::INTEGER[])`,
      [lessonIdsInt],
    );

    const totalQuestions = parseInt(questionsCheck.rows[0]?.total || '0');
    const approvedQuestions = parseInt(questionsCheck.rows[0]?.approved_count || '0');

    console.log(`[generateGameQuestions] 📊 Questions Statistics:`);
    console.log(`  - Total questions in lessons: ${totalQuestions}`);
    console.log(`  - Approved questions: ${approvedQuestions}`);
    console.log(`  - Requested questions: ${questionsCount}`);

    // 3️⃣ جلب الأسئلة العشوائية من الدروس المحددة وبالعدد المطلوب
    // استعلام SQL:
    // - WHERE q.lesson_id = ANY($1::INTEGER[]) ← الأسئلة من الدروس المحددة فقط
    // - AND (status IS NULL OR status = '' OR status = 'approved') ← الأسئلة المقبولة فقط
    // - ORDER BY RANDOM() ← ترتيب عشوائي
    // - LIMIT $2 ← عدد الأسئلة المحدد
    const questionsResult = await pool.query(
      `SELECT q.id, q.text, q.options::text as options_text, q.options as options_json, 
              q.image, q.correct_answer, q.points
       FROM questions q
       WHERE q.lesson_id = ANY($1::INTEGER[])
         AND (q.status IS NULL OR q.status = '' OR q.status = 'approved')
       ORDER BY RANDOM()
       LIMIT $2::INTEGER`,
      [lessonIdsInt, questionsCount],
    );

    console.log(
      `[generateGameQuestions] ✅ Found ${questionsResult.rowCount} questions from database`,
    );

    // 4️⃣ التحقق من وجود أسئلة كافية
    if (questionsResult.rowCount === 0) {
      if (totalQuestions === 0) {
        throw new Error(`لا توجد أسئلة في الدروس المحددة (${lessonIdsInt.join(', ')})`);
      } else {
        throw new Error(
          `لا توجد أسئلة مقبولة في الدروس المحددة. ` +
            `يوجد ${totalQuestions} سؤال ولكن لم يتم قبولها بعد`,
        );
      }
    }

    // إذا كان عدد الأسئلة الموجودة أقل من المطلوب، نستخدم ما هو متاح
    if (questionsResult.rowCount && questionsResult.rowCount < questionsCount) {
      console.warn(
        `[generateGameQuestions] ⚠️ Only ${questionsResult.rowCount} questions available ` +
          `(requested ${questionsCount})`,
      );
    }

    // إدراج الأسئلة في جدول game_questions
    console.log(
      `[generateGameQuestions] Inserting ${questionsResult.rows.length} questions into game_questions`,
    );
    for (let i = 0; i < questionsResult.rows.length; i++) {
      const question = questionsResult.rows[i];
      try {
        // تحويل options إلى JSON صحيح
        let optionsJson: any = null;

        // محاولة استخدام options_json أولاً (JSONB من قاعدة البيانات)
        if (question.options_json) {
          if (typeof question.options_json === 'object' && question.options_json !== null) {
            // إذا كان array، نحوله إلى object
            if (Array.isArray(question.options_json)) {
              // Convert array to object with A, B, C, D keys
              const optionsArray = question.options_json;
              optionsJson = {
                A: optionsArray[0] || '',
                B: optionsArray[1] || '',
                C: optionsArray[2] || '',
                D: optionsArray[3] || '',
              };
              console.log(
                `[generateGameQuestions] Converted options array to object:`,
                optionsJson,
              );
            } else {
              optionsJson = question.options_json;
            }
          } else if (typeof question.options_json === 'string') {
            try {
              const parsed = JSON.parse(question.options_json);
              if (Array.isArray(parsed)) {
                optionsJson = {
                  A: parsed[0] || '',
                  B: parsed[1] || '',
                  C: parsed[2] || '',
                  D: parsed[3] || '',
                };
              } else {
                optionsJson = parsed;
              }
            } catch (e) {
              console.warn(`[generateGameQuestions] Failed to parse options_json:`, e);
            }
          }
        }

        // إذا لم يكن options_json متاحاً، استخدم options_text
        if (!optionsJson && question.options_text) {
          try {
            const parsed = JSON.parse(question.options_text);
            if (Array.isArray(parsed)) {
              optionsJson = {
                A: parsed[0] || '',
                B: parsed[1] || '',
                C: parsed[2] || '',
                D: parsed[3] || '',
              };
            } else {
              optionsJson = parsed;
            }
          } catch (e) {
            console.warn(`[generateGameQuestions] Failed to parse options_text:`, e);
          }
        }

        // Fallback إلى question.options
        if (!optionsJson && question.options) {
          if (typeof question.options === 'object' && question.options !== null) {
            if (Array.isArray(question.options)) {
              optionsJson = {
                A: question.options[0] || '',
                B: question.options[1] || '',
                C: question.options[2] || '',
                D: question.options[3] || '',
              };
            } else {
              optionsJson = question.options;
            }
          } else if (typeof question.options === 'string') {
            try {
              const parsed = JSON.parse(question.options);
              if (Array.isArray(parsed)) {
                optionsJson = {
                  A: parsed[0] || '',
                  B: parsed[1] || '',
                  C: parsed[2] || '',
                  D: parsed[3] || '',
                };
              } else {
                optionsJson = parsed;
              }
            } catch (e) {
              console.warn(`[generateGameQuestions] Failed to parse question.options:`, e);
            }
          }
        }

        console.log(`[generateGameQuestions] Question ${i + 1} options processing:`, {
          has_options_json: !!question.options_json,
          has_options_text: !!question.options_text,
          has_options: !!question.options,
          final_options_json: optionsJson,
          options_type: typeof optionsJson,
          is_array: Array.isArray(optionsJson),
          is_object: typeof optionsJson === 'object' && !Array.isArray(optionsJson),
        });

        // محاولة INSERT مع points أولاً
        // تحويل optionsJson إلى JSON string صحيح
        let optionsValue: string | null = null;
        try {
          if (optionsJson) {
            try {
              // التأكد من أن optionsJson هو object صحيح
              if (typeof optionsJson === 'object' && !Array.isArray(optionsJson)) {
                optionsValue = JSON.stringify(optionsJson);
              } else {
                console.warn(
                  `[generateGameQuestions] optionsJson is not a valid object, skipping options`,
                );
                optionsValue = null;
              }
            } catch (e) {
              console.error(`[generateGameQuestions] Error stringifying optionsJson:`, e);
              optionsValue = null;
            }
          }

          // محاولة INSERT مع جميع الأعمدة المحتملة
          await pool.query(
            `INSERT INTO game_questions (room_id, question_id, question_order, question_text, question_image, options, correct_answer, points, time_limit)
             VALUES ($1::INTEGER, $2::INTEGER, $3::INTEGER, $4::TEXT, $5::TEXT, $6::jsonb, $7::TEXT, $8::INTEGER, $9::INTEGER)`,
            [
              roomId,
              question.id,
              i + 1,
              question.text || '',
              question.image || null,
              optionsValue,
              String(question.correct_answer ?? ''),
              question.points || 1,
              GAME_CONFIG.DEFAULT_QUESTION_TIME_LIMIT, // time_limit from config
            ],
          );
        } catch (insertError: any) {
          // إذا فشل بسبب عدم وجود time_limit، جرّب بدون time_limit
          if (insertError.message?.includes('time_limit')) {
            console.warn(`[generateGameQuestions] time_limit column not found, trying without it`);
            try {
              await pool.query(
                `INSERT INTO game_questions (room_id, question_id, question_order, question_text, question_image, options, correct_answer, points)
                 VALUES ($1::INTEGER, $2::INTEGER, $3::INTEGER, $4::TEXT, $5::TEXT, $6::jsonb, $7::TEXT, $8::INTEGER)`,
                [
                  roomId,
                  question.id,
                  i + 1,
                  question.text || '',
                  question.image || null,
                  optionsValue,
                  String(question.correct_answer ?? ''),
                  question.points || 1,
                ],
              );
            } catch (insertError2: any) {
              // إذا فشل أيضاً بسبب عدم وجود points، جرّب بدون points
              if (
                insertError2.message?.includes('points') ||
                insertError2.message?.includes('column')
              ) {
                console.warn(
                  `[generateGameQuestions] points column not found, inserting without it`,
                );
                await pool.query(
                  `INSERT INTO game_questions (room_id, question_id, question_order, question_text, question_image, options, correct_answer)
                   VALUES ($1::INTEGER, $2::INTEGER, $3::INTEGER, $4::TEXT, $5::TEXT, $6::jsonb, $7::TEXT)`,
                  [
                    roomId,
                    question.id,
                    i + 1,
                    question.text || '',
                    question.image || null,
                    optionsValue,
                    question.correct_answer || '',
                  ],
                );
              } else {
                throw insertError2;
              }
            }
          } else if (
            insertError.message?.includes('points') ||
            insertError.message?.includes('column')
          ) {
            console.warn(`[generateGameQuestions] points column not found, inserting without it`);
            try {
              await pool.query(
                `INSERT INTO game_questions (room_id, question_id, question_order, question_text, question_image, options, correct_answer, time_limit)
                 VALUES ($1::INTEGER, $2::INTEGER, $3::INTEGER, $4::TEXT, $5::TEXT, $6::jsonb, $7::TEXT, $8::INTEGER)`,
                [
                  roomId,
                  question.id,
                  i + 1,
                  question.text || '',
                  question.image || null,
                  optionsValue,
                  String(question.correct_answer ?? ''),
                  GAME_CONFIG.DEFAULT_QUESTION_TIME_LIMIT,
                ],
              );
            } catch (insertError3: any) {
              if (insertError3.message?.includes('time_limit')) {
                await pool.query(
                  `INSERT INTO game_questions (room_id, question_id, question_order, question_text, question_image, options, correct_answer)
                   VALUES ($1::INTEGER, $2::INTEGER, $3::INTEGER, $4::TEXT, $5::TEXT, $6::jsonb, $7::TEXT)`,
                  [
                    roomId,
                    question.id,
                    i + 1,
                    question.text || '',
                    question.image || null,
                    optionsValue,
                    question.correct_answer || '',
                  ],
                );
              } else {
                throw insertError3;
              }
            }
          } else if (
            insertError.message?.includes('json') ||
            insertError.message?.includes('JSON')
          ) {
            // إذا فشل بسبب JSON، جرّب بدون options
            console.warn(
              `[generateGameQuestions] JSON error with options, inserting without options:`,
              insertError.message,
            );
            try {
              await pool.query(
                `INSERT INTO game_questions (room_id, question_id, question_order, question_text, question_image, correct_answer, points, time_limit)
                 VALUES ($1::INTEGER, $2::INTEGER, $3::INTEGER, $4::TEXT, $5::TEXT, $6::TEXT, $7::INTEGER, $8::INTEGER)`,
                [
                  roomId,
                  question.id,
                  i + 1,
                  question.text || '',
                  question.image || null,
                  String(question.correct_answer ?? ''),
                  question.points || 1,
                  GAME_CONFIG.DEFAULT_QUESTION_TIME_LIMIT,
                ],
              );
            } catch (insertError2: any) {
              if (insertError2.message?.includes('points')) {
                try {
                  await pool.query(
                    `INSERT INTO game_questions (room_id, question_id, question_order, question_text, question_image, correct_answer, time_limit)
                     VALUES ($1::INTEGER, $2::INTEGER, $3::INTEGER, $4::TEXT, $5::TEXT, $6::TEXT, $7::INTEGER)`,
                    [
                      roomId,
                      question.id,
                      i + 1,
                      question.text || '',
                      question.image || null,
                      String(question.correct_answer ?? ''),
                      GAME_CONFIG.DEFAULT_QUESTION_TIME_LIMIT,
                    ],
                  );
                } catch (insertError3: any) {
                  if (insertError3.message?.includes('time_limit')) {
                    await pool.query(
                      `INSERT INTO game_questions (room_id, question_id, question_order, question_text, question_image, correct_answer)
                       VALUES ($1::INTEGER, $2::INTEGER, $3::INTEGER, $4::TEXT, $5::TEXT, $6::TEXT)`,
                      [
                        roomId,
                        question.id,
                        i + 1,
                        question.text || '',
                        question.image || null,
                        question.correct_answer || '',
                      ],
                    );
                  } else {
                    throw insertError3;
                  }
                }
              } else if (insertError2.message?.includes('time_limit')) {
                await pool.query(
                  `INSERT INTO game_questions (room_id, question_id, question_order, question_text, question_image, correct_answer, points)
                   VALUES ($1::INTEGER, $2::INTEGER, $3::INTEGER, $4::TEXT, $5::TEXT, $6::TEXT, $7::INTEGER)`,
                  [
                    roomId,
                    question.id,
                    i + 1,
                    question.text || '',
                    question.image || null,
                    String(question.correct_answer ?? ''),
                    question.points || 1,
                  ],
                );
              } else {
                throw insertError2;
              }
            }
          } else {
            throw insertError;
          }
        }
        console.log(
          `[generateGameQuestions] Inserted question ${i + 1}/${questionsResult.rows.length}: question_id=${question.id}`,
        );
      } catch (error: any) {
        console.error(`[generateGameQuestions] Error inserting question ${i + 1}:`, error);
        throw new Error(`فشل في إدراج السؤال ${i + 1}: ${error.message}`);
      }
    }

    console.log(
      `[generateGameQuestions] Successfully generated ${questionsResult.rows.length} questions for room ${roomId}`,
    );
  }

  // بدء اللعبة
  static async startGame(roomId: number): Promise<GameRoom> {
    const result = await pool.query(
      `UPDATE game_rooms 
       SET status = 'active', started_at = NOW(), current_question = 1
       WHERE id = $1 AND status = 'waiting'
       RETURNING *`,
      [roomId],
    );

    if (!result.rowCount) {
      throw new Error('الغرفة غير موجودة أو غير جاهزة للبدء');
    }

    return result.rows[0];
  }

  // تسجيل إجابة اللاعب
  static async submitAnswer(
    roomId: number,
    questionId: number,
    playerId: number,
    answer: string,
    timeTaken: number,
  ): Promise<GameAnswer> {
    // التحقق من أن اللاعب جزء من الغرفة
    const roomCheck = await pool.query(
      `SELECT id FROM game_rooms WHERE id = $1 AND (player1_id = $2 OR player2_id = $2)`,
      [roomId, playerId],
    );

    if (!roomCheck.rowCount) {
      throw new Error('اللاعب غير مسجل في هذه الغرفة');
    }

    // جلب السؤال للتحقق من الإجابة الصحيحة
    const questionResult = await pool.query(
      `SELECT correct_answer FROM game_questions WHERE id = $1 AND room_id = $2`,
      [questionId, roomId],
    );

    if (!questionResult.rowCount) {
      throw new Error('السؤال غير موجود');
    }

    const correctAnswer = questionResult.rows[0].correct_answer;
    const isCorrect = answer === correctAnswer;

    // تسجيل الإجابة
    const answerResult = await pool.query(
      `INSERT INTO game_answers (room_id, question_id, player_id, answer, is_correct, time_taken)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [roomId, questionId, playerId, answer, isCorrect, timeTaken],
    );

    return answerResult.rows[0];
  }

  // إنهاء اللعبة وحساب النتائج
  static async endGame(roomId: number): Promise<GameResult> {
    // التحقق من أن الغرفة نشطة
    const roomResult = await pool.query(
      `SELECT * FROM game_rooms WHERE id = $1 AND status = 'active'`,
      [roomId],
    );

    if (!roomResult.rowCount) {
      throw new Error('الغرفة غير نشطة');
    }

    const room = roomResult.rows[0];

    // جلب إجابات اللاعبين
    const answersResult = await pool.query(
      `SELECT player_id, answer, is_correct, time_taken
       FROM game_answers 
       WHERE room_id = $1`,
      [roomId],
    );

    // حساب النتائج لكل لاعب
    const player1Answers = answersResult.rows.filter((a) => a.player_id === room.player1_id);
    const player2Answers = answersResult.rows.filter((a) => a.player_id === room.player2_id);

    const player1Score = player1Answers.reduce((sum, a) => sum + (a.is_correct ? 1 : 0), 0);
    const player2Score = player2Answers.reduce((sum, a) => sum + (a.is_correct ? 1 : 0), 0);

    const player1CorrectAnswers = player1Answers.filter((a) => a.is_correct).length;
    const player2CorrectAnswers = player2Answers.filter((a) => a.is_correct).length;

    const player1TotalTime = player1Answers.reduce((sum, a) => sum + a.time_taken, 0);
    const player2TotalTime = player2Answers.reduce((sum, a) => sum + a.time_taken, 0);

    // تحديد الفائز
    let winnerId: number | null = null;
    let isTie = false;

    if (player1Score > player2Score) {
      winnerId = room.player1_id;
    } else if (player2Score > player1Score) {
      winnerId = room.player2_id;
    } else {
      // في حالة التعادل، الفائز هو الأسرع
      if (player1TotalTime < player2TotalTime) {
        winnerId = room.player1_id;
      } else if (player2TotalTime < player1TotalTime) {
        winnerId = room.player2_id;
      } else {
        isTie = true;
      }
    }

    // تحديث حالة الغرفة
    await pool.query(
      `UPDATE game_rooms 
       SET status = 'completed', completed_at = NOW()
       WHERE id = $1`,
      [roomId],
    );

    // إنشاء النتيجة
    const resultQuery = await pool.query(
      `INSERT INTO game_results (
        room_id, player1_id, player2_id, player1_score, player2_score,
        player1_correct_answers, player2_correct_answers,
        player1_total_time, player2_total_time, winner_id, is_tie
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *`,
      [
        roomId,
        room.player1_id,
        room.player2_id,
        player1Score,
        player2Score,
        player1CorrectAnswers,
        player2CorrectAnswers,
        player1TotalTime,
        player2TotalTime,
        winnerId,
        isTie,
      ],
    );

    // تحديث إحصائيات اللاعبين
    await this.updatePlayerStats(
      room.player1_id,
      player1Score,
      player2Score,
      winnerId === room.player1_id,
      isTie,
    );
    await this.updatePlayerStats(
      room.player2_id,
      player2Score,
      player1Score,
      winnerId === room.player2_id,
      isTie,
    );

    return resultQuery.rows[0];
  }

  // تحديث إحصائيات اللاعب
  static async updatePlayerStats(
    playerId: number,
    playerScore: number,
    opponentScore: number,
    isWinner: boolean,
    isTie: boolean,
  ): Promise<void> {
    await pool.query(
      `INSERT INTO player_game_stats (player_id, total_games, games_won, games_lost, games_tied, total_score, total_correct_answers, total_questions_answered, last_played_at)
       VALUES ($1, 1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (player_id) DO UPDATE SET
         total_games = player_game_stats.total_games + 1,
         games_won = player_game_stats.games_won + $2,
         games_lost = player_game_stats.games_lost + $3,
         games_tied = player_game_stats.games_tied + $4,
         total_score = player_game_stats.total_score + $5,
         total_correct_answers = player_game_stats.total_correct_answers + $6,
         total_questions_answered = player_game_stats.total_questions_answered + $7,
         win_rate = CASE 
           WHEN (player_game_stats.total_games + 1) > 0 
           THEN ((player_game_stats.games_won + $2)::DECIMAL / (player_game_stats.total_games + 1)) * 100
           ELSE 0 
         END,
         last_played_at = NOW()`,
      [
        playerId,
        isWinner ? 1 : 0,
        !isWinner && !isTie ? 1 : 0,
        isTie ? 1 : 0,
        playerScore,
        playerScore,
        playerScore + opponentScore, // إجمالي الأسئلة
      ],
    );
  }

  // جلب الدعوات الواردة للطالب
  static async getIncomingInvitations(playerId: number): Promise<any[]> {
    try {
      const result = await pool.query(
        `SELECT gi.*, u.name as inviter_name
       FROM game_invitations gi
       JOIN users u ON u.id = gi.inviter_id
       WHERE gi.invitee_id = $1 AND gi.status = 'pending' AND gi.expires_at > NOW()
       ORDER BY gi.created_at DESC`,
        [playerId],
      );

      // Ensure lesson_ids field exists and handle both column names
      // Also fetch lesson names
      const invitationsWithLessons = await Promise.all(
        result.rows.map(async (row) => {
          const lessonIds = row.lesson_ids || row.selected_lessons || [];
          const lessonIdsArray = Array.isArray(lessonIds)
            ? lessonIds.map((id) => parseInt(String(id))).filter((id) => !isNaN(id))
            : [];

          // Fetch lesson names if we have lesson IDs
          let lessonNames: { id: number; name: string }[] = [];
          if (lessonIdsArray.length > 0) {
            try {
              const lessonsResult = await pool.query(
                `SELECT id, name FROM lessons WHERE id = ANY($1::INTEGER[])`,
                [lessonIdsArray],
              );
              lessonNames = lessonsResult.rows.map((lesson: any) => ({
                id: parseInt(lesson.id),
                name: lesson.name,
              }));
            } catch (error) {
              console.error(`Error fetching lesson names for invitation ${row.id}:`, error);
            }
          }

          return {
            ...row,
            lesson_ids: lessonIdsArray,
            lesson_names: lessonNames,
          };
        }),
      );

      return invitationsWithLessons;
    } catch (error: any) {
      console.error('Error in getIncomingInvitations:', error);
      throw error;
    }
  }

  // جلب الدعوات الصادرة من الطالب
  static async getOutgoingInvitations(playerId: number): Promise<any[]> {
    try {
      console.log(
        `[getOutgoingInvitations] Getting outgoing invitations for playerId: ${playerId} (type: ${typeof playerId})`,
      );

      // SIMPLEST POSSIBLE QUERY - Get all invitations and filter in JavaScript
      // This ensures we don't miss anything due to SQL type issues
      const allInvitationsRaw = await pool.query(
        `SELECT * FROM game_invitations ORDER BY created_at DESC`,
      );

      console.log(
        `[getOutgoingInvitations] Total invitations in DB: ${allInvitationsRaw.rowCount}`,
      );

      // Filter in JavaScript to ensure we catch everything
      const matchingInvitations = allInvitationsRaw.rows.filter((row) => {
        const rowInviterId = row.inviter_id;
        const matches =
          rowInviterId === playerId ||
          rowInviterId == playerId ||
          Number(rowInviterId) === Number(playerId) ||
          String(rowInviterId) === String(playerId) ||
          parseInt(String(rowInviterId)) === parseInt(String(playerId));

        if (matches) {
          console.log(`[getOutgoingInvitations] FOUND MATCH:`, {
            id: row.id,
            inviter_id: rowInviterId,
            inviter_id_type: typeof rowInviterId,
            playerId: playerId,
            playerId_type: typeof playerId,
            match_type: rowInviterId === playerId ? 'strict' : 'loose',
          });
        }

        return matches;
      });

      console.log(
        `[getOutgoingInvitations] Found ${matchingInvitations.length} matching invitations after JavaScript filter`,
      );

      if (matchingInvitations.length === 0) {
        console.log(`[getOutgoingInvitations] No matches found. Sample inviter_ids in DB:`, [
          ...new Set(
            allInvitationsRaw.rows.slice(0, 10).map((r) => ({
              inviter_id: r.inviter_id,
              type: typeof r.inviter_id,
            })),
          ),
        ]);
        return [];
      }

      // Get user names for matched invitations
      const inviteeIds = [...new Set(matchingInvitations.map((r) => r.invitee_id))];
      const usersResult = await pool.query(
        `SELECT id, name FROM users WHERE id = ANY($1::INTEGER[])`,
        [inviteeIds],
      );
      const usersMap = new Map(usersResult.rows.map((u) => [u.id, u.name]));

      // Build result array with user names
      const invitationsWithNames = matchingInvitations.map((row) => ({
        ...row,
        invitee_name: usersMap.get(row.invitee_id) || null,
      }));

      console.log(
        `[getOutgoingInvitations] Built ${invitationsWithNames.length} invitations with names`,
      );

      if (invitationsWithNames.length > 0) {
        // Use the invitations we found and already matched with names
        const result = { rows: invitationsWithNames };

        console.log(`[getOutgoingInvitations] Processing ${result.rows.length} invitations`);

        // Ensure lesson_ids field exists and handle both column names
        // Also fetch lesson names
        try {
          const invitationsWithLessons = await Promise.all(
            result.rows.map(async (row) => {
              try {
                const lessonIds = row.lesson_ids || row.selected_lessons || [];
                const lessonIdsArray = Array.isArray(lessonIds)
                  ? lessonIds.map((id) => parseInt(String(id))).filter((id) => !isNaN(id))
                  : [];

                console.log(
                  `[getOutgoingInvitations] Processing invitation ${row.id}, lessonIds:`,
                  lessonIdsArray,
                );

                // Fetch lesson names if we have lesson IDs
                let lessonNames: { id: number; name: string }[] = [];
                if (lessonIdsArray.length > 0) {
                  try {
                    const lessonsResult = await pool.query(
                      `SELECT id, name FROM lessons WHERE id = ANY($1::INTEGER[])`,
                      [lessonIdsArray],
                    );
                    lessonNames = lessonsResult.rows.map((lesson: any) => ({
                      id: parseInt(lesson.id),
                      name: lesson.name,
                    }));
                    console.log(
                      `[getOutgoingInvitations] Fetched ${lessonNames.length} lesson names for invitation ${row.id}`,
                    );
                  } catch (error) {
                    console.error(`Error fetching lesson names for invitation ${row.id}:`, error);
                  }
                }

                const processedInvitation = {
                  ...row,
                  lesson_ids: lessonIdsArray,
                  lesson_names: lessonNames,
                };

                console.log(`[getOutgoingInvitations] Processed invitation ${row.id}:`, {
                  id: processedInvitation.id,
                  inviter_id: processedInvitation.inviter_id,
                  invitee_id: processedInvitation.invitee_id,
                  lesson_ids_count: processedInvitation.lesson_ids.length,
                  lesson_names_count: processedInvitation.lesson_names.length,
                });

                return processedInvitation;
              } catch (rowError) {
                console.error(`Error processing row ${row.id}:`, rowError);
                // Return row even if lesson processing failed
                return {
                  ...row,
                  lesson_ids: [],
                  lesson_names: [],
                };
              }
            }),
          );

          console.log(
            `[getOutgoingInvitations] Returning ${invitationsWithLessons.length} processed invitations`,
          );
          return invitationsWithLessons;
        } catch (processError) {
          console.error(`[getOutgoingInvitations] Error in Promise.all:`, processError);
          // Fallback: return rows without lesson names if processing fails
          return result.rows.map((row) => ({
            ...row,
            lesson_ids: Array.isArray(row.lesson_ids)
              ? row.lesson_ids
                  .map((id: any) => parseInt(String(id)))
                  .filter((id: any) => !isNaN(id))
              : Array.isArray(row.selected_lessons)
                ? row.selected_lessons
                    .map((id: any) => parseInt(String(id)))
                    .filter((id: any) => !isNaN(id))
                : [],
            lesson_names: [],
          }));
        }
      }

      // No invitations found
      return [];
    } catch (error: any) {
      console.error('Error in getOutgoingInvitations:', error);
      console.error('Error details:', error.message, error.stack);
      throw error;
    }
  }

  // جلب تفاصيل الغرفة
  static async getRoomDetails(roomId: number, playerId: number): Promise<GameRoom | null> {
    try {
      const result = await pool.query(
        `SELECT id, invitation_id, player1_id, player2_id, status, questions_count, 
                time_per_question, total_time, current_question, started_at, completed_at, created_at
         FROM game_rooms 
         WHERE id = $1::INTEGER AND (player1_id = $2::INTEGER OR player2_id = $2::INTEGER)`,
        [roomId, playerId],
      );

      if (result.rowCount === 0) {
        console.log(
          `[getRoomDetails] Room ${roomId} not found or player ${playerId} is not a participant`,
        );
        return null;
      }

      return result.rows[0] || null;
    } catch (error: any) {
      console.error(`[getRoomDetails] Database error for room ${roomId}:`, error);
      throw new Error(`فشل في جلب بيانات الغرفة: ${error.message}`);
    }
  }

  // جلب أسئلة الغرفة
  static async getRoomQuestions(roomId: number): Promise<GameQuestion[]> {
    console.log(`[getRoomQuestions] Fetching questions for room ${roomId}`);

    try {
      // محاولة جلب الأسئلة مع points أولاً
      // نستخدم options::jsonb للحصول على options كـ JSON object
      let result;
      try {
        result = await pool.query(
          `SELECT id, room_id, question_id, question_order, question_text, question_image, 
                  options::jsonb as options, points, created_at
           FROM game_questions 
           WHERE room_id = $1::INTEGER
           ORDER BY question_order ASC`,
          [roomId],
        );
      } catch (error: any) {
        // إذا فشل بسبب عدم وجود points، جرّب بدون points
        if (error.message?.includes('points') || error.message?.includes('column')) {
          console.warn(`[getRoomQuestions] points column not found, fetching without it`);
          try {
            result = await pool.query(
              `SELECT id, room_id, question_id, question_order, question_text, question_image, 
                      options::jsonb as options, created_at
               FROM game_questions 
               WHERE room_id = $1::INTEGER
               ORDER BY question_order ASC`,
              [roomId],
            );
          } catch (jsonError: any) {
            // إذا فشل بسبب jsonb casting، جرّب بدون casting
            if (jsonError.message?.includes('jsonb') || jsonError.message?.includes('json')) {
              console.warn(`[getRoomQuestions] jsonb casting failed, fetching without casting`);
              result = await pool.query(
                `SELECT id, room_id, question_id, question_order, question_text, question_image, 
                        options, created_at
                 FROM game_questions 
                 WHERE room_id = $1::INTEGER
                 ORDER BY question_order ASC`,
                [roomId],
              );
            } else {
              throw jsonError;
            }
          }
          // إضافة points كقيمة افتراضية
          result.rows.forEach((row: any) => {
            row.points = 1;
          });
        } else {
          throw error;
        }
      }

      console.log(`[getRoomQuestions] Found ${result.rowCount} questions for room ${roomId}`);

      if (result.rowCount === 0) {
        // التحقق من وجود الغرفة
        const roomCheck = await pool.query(
          `SELECT id, invitation_id FROM game_rooms WHERE id = $1::INTEGER`,
          [roomId],
        );

        if (roomCheck.rowCount && roomCheck.rowCount > 0) {
          console.warn(
            `[getRoomQuestions] Room ${roomId} exists but has no questions. This might indicate questions were not generated.`,
          );
        } else {
          console.warn(`[getRoomQuestions] Room ${roomId} does not exist in game_rooms table.`);
        }
      }

      return result.rows;
    } catch (error: any) {
      console.error(`[getRoomQuestions] Database error for room ${roomId}:`, error);
      throw new Error(`فشل في جلب أسئلة الغرفة من قاعدة البيانات: ${error.message}`);
    }
  }

  // جلب إجابات اللاعبين في الغرفة
  static async getRoomAnswers(roomId: number): Promise<GameAnswer[]> {
    const result = await pool.query(
      `SELECT * FROM game_answers 
       WHERE room_id = $1 
       ORDER BY answered_at`,
      [roomId],
    );

    return result.rows;
  }

  // جلب نتيجة اللعبة
  static async getGameResult(roomId: number): Promise<GameResult | null> {
    const result = await pool.query(`SELECT * FROM game_results WHERE room_id = $1`, [roomId]);

    return result.rows[0] || null;
  }

  // جلب إحصائيات اللاعب
  static async getPlayerStats(playerId: number): Promise<any> {
    const result = await pool.query(`SELECT * FROM player_game_stats WHERE player_id = $1`, [
      playerId,
    ]);

    return (
      result.rows[0] || {
        total_games: 0,
        games_won: 0,
        games_lost: 0,
        games_tied: 0,
        total_score: 0,
        total_correct_answers: 0,
        total_questions_answered: 0,
        average_time_per_question: 0,
        win_rate: 0,
      }
    );
  }

  // تنظيف الدعوات المنتهية الصلاحية
  static async cleanupExpiredInvitations(): Promise<void> {
    await pool.query(
      `UPDATE game_invitations 
       SET status = 'expired' 
       WHERE status = 'pending' AND expires_at <= NOW()`,
    );
  }
}
