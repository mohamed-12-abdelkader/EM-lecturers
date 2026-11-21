import { logger } from '../../../../utils';
import type { InboundContext } from '../types';
import { ExamAssistantSessionStore } from './sessionStore';
import type { ExamAssistantMediaIntent, ExamAssistantSessionRow } from './types';
import {
  cancelWorkflow,
  createDraftExamFromWorkflow,
  detectExamType,
  detectSourceType,
  extractQuestionsFromSessionFiles,
  generateFromBank,
  getTodayExamTasks,
  isAffirmative,
  isCancel,
  isDoneSendingFiles,
  isNewExamRequest,
  listCourseLectures,
  listTeacherCourses,
  publishDraftExam,
  saveInboundMediaFile,
  searchLessons,
} from './workflowActions';
import { replyForMediaFailure, isSupportedExamAssistantMime } from './mediaErrors';
import {
  appendRecentTurn,
  classifyExamAssistantIntent,
  classifyMediaCaptionIntent,
} from './conversationIntent';
import {
  replyChitchat,
  replyGreeting,
  replyHelp,
  replyMediaAskIntent,
  replyThanks,
  replyUnclear,
} from './conversationReplies';
import {
  addBulkTextToExam,
  applyDraftExamEdit,
  replyReviewExtracted,
  resolveEditableExam,
} from './examEditActions';

export type WorkflowResult = {
  reply: string;
  session: ExamAssistantSessionRow | null;
  metadata?: Record<string, unknown>;
};

async function ensureSession(
  ctx: InboundContext,
  teacherId: number,
): Promise<ExamAssistantSessionRow> {
  const existing = await ExamAssistantSessionStore.getActiveForTeacher(teacherId);
  if (existing) {
    if (ctx.conversation?.id && existing.conversation_id !== ctx.conversation.id) {
      return ExamAssistantSessionStore.update(existing.id, teacherId, {
        conversation_id: ctx.conversation.id,
      });
    }
    return existing;
  }
  return ExamAssistantSessionStore.create({
    teacherId,
    tenantId: ctx.conversation?.tenant_id ?? null,
    conversationId: ctx.conversation?.id ?? null,
    contactPhone: ctx.fromPhone,
    state: 'IDLE',
  });
}

function formatLessonChoices(
  lessons: Array<{ id: number; name: string; question_count: number }>,
): string {
  return lessons
    .slice(0, 8)
    .map((l, i) => `${i + 1}) ${l.name} (${l.question_count} سؤال)`)
    .join('\n');
}

async function rememberTurns(
  session: ExamAssistantSessionRow,
  teacherText: string,
  assistantReply: string,
): Promise<ExamAssistantSessionRow> {
  const withTeacher = appendRecentTurn(session.context, 'teacher', teacherText);
  const withBoth = appendRecentTurn(
    { ...session.context, recent_turns: withTeacher },
    'assistant',
    assistantReply,
  );
  return ExamAssistantSessionStore.mergeContext(session.id, session.teacher_id, {
    recent_turns: withBoth,
    last_user_intent: session.context.last_user_intent ?? null,
  });
}

function mediaIntentToContext(
  intent: ReturnType<typeof classifyMediaCaptionIntent>,
): ExamAssistantMediaIntent {
  switch (intent) {
    case 'media_create':
      return 'create';
    case 'media_review':
      return 'review';
    case 'media_add':
      return 'add';
    case 'media_edit':
      return 'edit';
    default:
      return 'ask';
  }
}

async function finish(
  session: ExamAssistantSessionRow,
  teacherText: string,
  reply: string,
  metadata?: Record<string, unknown>,
): Promise<WorkflowResult> {
  const updated = await rememberTurns(session, teacherText, reply);
  return { reply, session: updated, metadata };
}

export async function runExamAssistantWorkflow(
  ctx: InboundContext,
  teacherId: number,
): Promise<WorkflowResult> {
  let session = await ensureSession(ctx, teacherId);
  const text = (ctx.body || ctx.media?.caption || '').trim();
  const hasDraft = Boolean(resolveEditableExam(session));

  try {
    if (text && isCancel(text)) {
      const cancelled = await cancelWorkflow(session);
      return finish(cancelled.session, text, cancelled.reply, { action: 'cancel' });
    }

    // ── Media receive ──────────────────────────────────────────────────────
    if (ctx.media) {
      const mime = (ctx.media.mimetype || '').toLowerCase();
      if (!isSupportedExamAssistantMime(mime)) {
        return finish(session, text || '[media]', 'نوع الملف مش مدعوم. ابعت PDF أو صور JPG/PNG/WEBP.', {
          action: 'unsupported_media',
        });
      }

      const captionIntent = classifyMediaCaptionIntent(ctx.media.caption || text, hasDraft);
      const pendingIntent = mediaIntentToContext(captionIntent);

      if (
        session.state === 'IDLE' ||
        session.state === 'ASK_SOURCE' ||
        session.state === 'PUBLISHED' ||
        session.state === 'CANCELLED' ||
        session.state === 'FAILED'
      ) {
        if (session.state !== 'IDLE') {
          session = await ExamAssistantSessionStore.create({
            teacherId,
            tenantId: ctx.conversation?.tenant_id ?? null,
            conversationId: ctx.conversation?.id ?? null,
            contactPhone: ctx.fromPhone,
            state: 'WAITING_FOR_FILES',
            context: {
              ...session.context,
              pending_media_intent: pendingIntent,
              awaiting_more_files: true,
            },
          });
        } else {
          session = await ExamAssistantSessionStore.update(session.id, teacherId, {
            state: 'WAITING_FOR_FILES',
            source_type: 'files',
            context: {
              ...session.context,
              pending_media_intent: pendingIntent,
              awaiting_more_files: true,
            },
          });
        }
      }

      if (
        session.state === 'WAITING_FOR_FILES' ||
        session.state === 'PROCESSING_FILES' ||
        session.state === 'READY_TO_PUBLISH' ||
        session.state === 'MODIFYING_EXAM' ||
        session.state === 'EXAM_REVIEW' ||
        session.source_type === 'files'
      ) {
        // Ensure waiting state when adding to existing draft
        if (
          session.state === 'READY_TO_PUBLISH' ||
          session.state === 'MODIFYING_EXAM' ||
          session.state === 'EXAM_REVIEW'
        ) {
          session = await ExamAssistantSessionStore.update(session.id, teacherId, {
            state: 'WAITING_FOR_FILES',
            source_type: 'files',
            context: {
              ...session.context,
              pending_media_intent: pendingIntent === 'ask' && hasDraft ? 'add' : pendingIntent,
              awaiting_more_files: true,
            },
          });
        }

        const saved = await saveInboundMediaFile({
          sessionId: session.id,
          teacherId,
          waMessageId: ctx.waMessageId,
          media: ctx.media,
        });
        if (!saved.ok) {
          logger.warn(
            { kind: saved.kind, teacherId, sessionId: session.id },
            'exam assistant media save rejected',
          );
          return finish(session, text || '[media]', saved.reply, {
            action: 'media_save_failed',
            kind: saved.kind,
          });
        }

        const files = await ExamAssistantSessionStore.listFiles(session.id, teacherId);
        session = await ExamAssistantSessionStore.update(session.id, teacherId, {
          state: 'WAITING_FOR_FILES',
          source_type: 'files',
          context: {
            ...session.context,
            pending_media_intent: session.context.pending_media_intent || pendingIntent,
            awaiting_more_files: true,
          },
        });

        const intent = session.context.pending_media_intent || pendingIntent;
        let reply: string;
        if (intent === 'ask') {
          reply = replyMediaAskIntent(hasDraft);
          reply = `استلمت الملف ✅ (الإجمالي: ${files.length}).\n` + reply.replace(/^استلمت الملف ✅\n?/, '');
        } else if (intent === 'review') {
          reply = `استلمت الملف ✅ (الإجمالي: ${files.length}).\nلما تخلّص ابعت «خلصت» عشان أراجع الأسئلة من غير ما أنشئ امتحان.`;
        } else if (intent === 'add' || intent === 'edit') {
          reply = `استلمت الملف ✅ (الإجمالي: ${files.length}).\nلما تخلّص ابعت «خلصت» عشان أضيف/أعدّل على الامتحان الحالي.`;
        } else {
          reply = `استلمت الملف ✅ (الإجمالي: ${files.length}).\nلو فيه صور/ملفات تانية ابعتها، ولما تخلّص ابعت «خلصت».`;
        }

        return finish(session, text || '[media]', reply, {
          action: 'file_received',
          files: files.length,
          media_intent: intent,
        });
      }
    }

    if (ctx.mediaError) {
      const approxRaw = ctx.metadata?.media_approx_bytes;
      const approx =
        typeof approxRaw === 'number'
          ? approxRaw
          : typeof approxRaw === 'string' && Number.isFinite(Number(approxRaw))
            ? Number(approxRaw)
            : null;
      const mapped = replyForMediaFailure(ctx.mediaError, { approxBytes: approx });
      logger.warn(
        {
          teacherId,
          sessionId: session.id,
          mediaError: ctx.mediaError,
          kind: mapped.kind,
        },
        'exam assistant media_error',
      );
      return finish(session, text || '[media_error]', mapped.reply, {
        action: 'media_error',
        kind: mapped.kind,
        media_error: ctx.mediaError,
      });
    }

    if (!text) {
      return finish(
        session,
        '',
        'اكتب طلبك، مثلاً: اعمل امتحان على درس الهرمونات — أو ابعت ملف/صور الأسئلة.',
      );
    }

    // Intent for open / review states
    const openForIntent = [
      'IDLE',
      'CANCELLED',
      'PUBLISHED',
      'FAILED',
      'ASK_SOURCE',
      'EXAM_REVIEW',
      'MODIFYING_EXAM',
      'READY_TO_PUBLISH',
    ].includes(session.state);

    let intentResult = openForIntent
      ? await classifyExamAssistantIntent({
          text,
          state: session.state,
          context: session.context,
          hasDraft,
        })
      : null;

    if (intentResult) {
      session = await ExamAssistantSessionStore.mergeContext(session.id, teacherId, {
        last_user_intent: intentResult.intent,
      });
    }

    // Natural conversation in IDLE-like states
    if (
      intentResult &&
      ['IDLE', 'CANCELLED', 'PUBLISHED', 'FAILED'].includes(session.state)
    ) {
      if (session.state !== 'IDLE') {
        session = await ExamAssistantSessionStore.create({
          teacherId,
          tenantId: ctx.conversation?.tenant_id ?? null,
          conversationId: ctx.conversation?.id ?? null,
          contactPhone: ctx.fromPhone,
          state: 'IDLE',
          context: {
            recent_turns: session.context.recent_turns,
            recent_exam_ids: session.context.recent_exam_ids,
            active_exam_id: session.context.active_exam_id,
            active_exam_kind: session.context.active_exam_kind,
          },
        });
      }

      switch (intentResult.intent) {
        case 'greeting':
          return finish(session, text, replyGreeting(text), { action: 'greeting' });
        case 'thanks':
          return finish(session, text, replyThanks(), { action: 'thanks' });
        case 'help':
          return finish(session, text, replyHelp(), { action: 'help' });
        case 'chitchat':
          return finish(session, text, replyChitchat(intentResult.replyHint), {
            action: 'chitchat',
          });
        case 'unclear':
          return finish(session, text, replyUnclear(), { action: 'unclear' });
        case 'modify_exam': {
          const edited = await applyDraftExamEdit({ session, message: text });
          return finish(edited.session, text, edited.reply, { action: 'modify' });
        }
        case 'use_files': {
          session = await ExamAssistantSessionStore.update(session.id, teacherId, {
            state: 'WAITING_FOR_FILES',
            source_type: 'files',
            context: {
              ...session.context,
              awaiting_more_files: true,
              pending_media_intent: 'create',
              exam_title: text,
            },
          });
          return finish(
            session,
            text,
            'تمام، ابعت الملف أو الصور دلوقتي. لما تخلّص ابعت «خلصت».',
            { action: 'wait_files' },
          );
        }
        case 'use_bank':
        case 'create_exam':
          // fall through to existing IDLE generation below
          break;
        default:
          break;
      }
    }

    // Modify while reviewing / ready to publish
    if (
      intentResult?.intent === 'modify_exam' &&
      ['EXAM_REVIEW', 'MODIFYING_EXAM', 'READY_TO_PUBLISH'].includes(session.state)
    ) {
      const edited = await applyDraftExamEdit({ session, message: text });
      return finish(edited.session, text, edited.reply, { action: 'modify' });
    }

    // Media intent replies while waiting (text-only follow-ups)
    if (session.state === 'WAITING_FOR_FILES' && !isDoneSendingFiles(text) && !isAffirmative(text)) {
      if (/(راجع|مراجعة)/.test(text)) {
        session = await ExamAssistantSessionStore.mergeContext(session.id, teacherId, {
          pending_media_intent: 'review',
        });
        return finish(session, text, 'ماشي، هراجع الأسئلة بس. ابعت «خلصت» لما تخلّص إرسال الملفات.');
      }
      if (/(ضيف|أضف|على الامتحان)/.test(text)) {
        session = await ExamAssistantSessionStore.mergeContext(session.id, teacherId, {
          pending_media_intent: hasDraft ? 'add' : 'create',
        });
        return finish(
          session,
          text,
          hasDraft
            ? 'تمام، هضيفهم على الامتحان الحالي بعد «خلصت».'
            : 'لسه مفيش امتحان حالي. هعمل امتحان جديد من الملفات بعد «خلصت»، أو أنشئ امتحان الأول.',
        );
      }
      if (/(اعمل امتحان|أنشئ|انشئ)/.test(text)) {
        session = await ExamAssistantSessionStore.mergeContext(session.id, teacherId, {
          pending_media_intent: 'create',
        });
        return finish(session, text, 'حاضر، هعمل امتحان من الملفات. ابعت «خلصت» لما تخلّص.');
      }
    }

    // Restart request while active
    if (
      session.status === 'active' &&
      session.state !== 'IDLE' &&
      isNewExamRequest(text) &&
      !['EXAM_REVIEW', 'MODIFYING_EXAM', 'SELECT_EXAM_TYPE', 'SELECT_TARGET', 'READY_TO_PUBLISH'].includes(
        session.state,
      )
    ) {
      await cancelWorkflow(session);
      session = await ExamAssistantSessionStore.create({
        teacherId,
        tenantId: ctx.conversation?.tenant_id ?? null,
        conversationId: ctx.conversation?.id ?? null,
        contactPhone: ctx.fromPhone,
        state: 'IDLE',
        context: {
          recent_exam_ids: session.context.recent_exam_ids,
        },
      });
    }

    switch (session.state) {
      case 'IDLE':
      case 'CANCELLED':
      case 'PUBLISHED':
      case 'FAILED': {
        if (session.state !== 'IDLE') {
          session = await ExamAssistantSessionStore.create({
            teacherId,
            tenantId: ctx.conversation?.tenant_id ?? null,
            conversationId: ctx.conversation?.id ?? null,
            contactPhone: ctx.fromPhone,
            state: 'IDLE',
            context: {
              recent_turns: session.context.recent_turns,
              recent_exam_ids: session.context.recent_exam_ids,
              active_exam_id: session.context.active_exam_id,
              active_exam_kind: session.context.active_exam_kind,
            },
          });
        }

        // If intent was unclear/chitchat already handled; avoid auto-exam for weak signals
        if (
          intentResult &&
          ['greeting', 'thanks', 'help', 'chitchat', 'unclear'].includes(intentResult.intent)
        ) {
          return finish(session, text, replyUnclear(), { action: 'guard_idle' });
        }

        const tasks = await getTodayExamTasks(teacherId);
        if (tasks.length && !/(ملف|صور|بنك)/.test(text) && isNewExamRequest(text)) {
          const task = tasks[0];
          session = await ExamAssistantSessionStore.update(session.id, teacherId, {
            state: 'CHECK_TEACHER_TASK',
            context: {
              ...session.context,
              scheduled_task_id: task.id,
              scheduled_task_title: task.title,
              lesson_name: task.title,
            },
          });
          return finish(
            session,
            text,
            `عندك ${task.taskType === 'homework' ? 'واجب' : 'امتحان'} مجدول النهارده: *${task.title}*.\nتحب أجهّزلك الامتحان من بنك الأسئلة؟`,
            { action: 'check_task' },
          );
        }

        const source = detectSourceType(text);
        if (source === 'files' || intentResult?.intent === 'use_files') {
          session = await ExamAssistantSessionStore.update(session.id, teacherId, {
            state: 'WAITING_FOR_FILES',
            source_type: 'files',
            context: {
              ...session.context,
              awaiting_more_files: true,
              exam_title: text,
              pending_media_intent: 'create',
            },
          });
          return finish(
            session,
            text,
            'تمام، ابعت الملف أو الصور دلوقتي. لما تخلّص ابعت «خلصت».',
          );
        }

        // Only auto-generate when clearly an exam request
        if (
          !isNewExamRequest(text) &&
          intentResult?.intent !== 'create_exam' &&
          intentResult?.intent !== 'use_bank'
        ) {
          return finish(session, text, replyUnclear(), { action: 'idle_unclear' });
        }

        session = await ExamAssistantSessionStore.update(session.id, teacherId, {
          state: 'GENERATING_EXAM',
          source_type: 'question_bank',
        });
        try {
          const generated = await generateFromBank(session, text);
          if (generated.session.state === 'EXAM_REVIEW') {
            return finish(generated.session, text, generated.reply, { action: 'proposal' });
          }
          session = await ExamAssistantSessionStore.update(session.id, teacherId, {
            state: 'ASK_SOURCE',
          });
          return finish(
            generated.session,
            text,
            generated.reply +
              '\n\nتحب الامتحان من *بنك الأسئلة* ولا عندك *ملف/صور* أعمل منه الامتحان؟',
          );
        } catch (err: any) {
          session = await ExamAssistantSessionStore.update(session.id, teacherId, {
            state: 'ASK_SOURCE',
            last_error: err?.message || 'generate_failed',
          });
          return finish(
            session,
            text,
            'تحب الامتحان من *بنك الأسئلة* ولا من ملف أو صور؟\nولو من البنك، امتحان على أنهي درس؟',
          );
        }
      }

      case 'CHECK_TEACHER_TASK': {
        if (isAffirmative(text)) {
          const lessonHint = session.context.scheduled_task_title || session.context.lesson_name || '';
          session = await ExamAssistantSessionStore.update(session.id, teacherId, {
            state: 'GENERATING_EXAM',
            source_type: 'question_bank',
          });
          const msg = lessonHint
            ? `اعمل امتحان على درس ${lessonHint}`
            : 'اعمل امتحان من بنك الأسئلة';
          const generated = await generateFromBank(session, msg);
          return finish(generated.session, text, generated.reply, {
            action: 'proposal_from_task',
          });
        }
        if (/لا|لأ|مش عايز|من غير|ملف|صور/.test(text)) {
          const source = detectSourceType(text);
          if (source === 'files') {
            session = await ExamAssistantSessionStore.update(session.id, teacherId, {
              state: 'WAITING_FOR_FILES',
              source_type: 'files',
            });
            return finish(session, text, 'ماشي، ابعت الملفات/الصور، وبعدين «خلصت».');
          }
          session = await ExamAssistantSessionStore.update(session.id, teacherId, {
            state: 'ASK_SOURCE',
            context: { ...session.context, scheduled_task_id: null },
          });
          return finish(
            session,
            text,
            'تمام. تحب من بنك الأسئلة ولا من ملف/صور؟ ولو من البنك: امتحان على أنهي درس؟',
          );
        }
        return finish(
          session,
          text,
          'رد بـ «ماشي» لو تحب أجهّز الامتحان المجدول، أو قولّي عايز من ملف/بنك بشكل تاني.',
        );
      }

      case 'ASK_SOURCE': {
        if (intentResult?.intent === 'greeting') {
          return finish(session, text, replyGreeting(text));
        }
        const source = detectSourceType(text) || (isAffirmative(text) ? 'question_bank' : null);
        if (source === 'files' || intentResult?.intent === 'use_files') {
          session = await ExamAssistantSessionStore.update(session.id, teacherId, {
            state: 'WAITING_FOR_FILES',
            source_type: 'files',
          });
          return finish(session, text, 'ابعت PDF أو الصور، ولما تخلّص ابعت «خلصت».');
        }
        if (
          source === 'question_bank' ||
          intentResult?.intent === 'use_bank' ||
          /(درس|أسئلة|اسئلة)/.test(text)
        ) {
          const lessons = await searchLessons(teacherId, text);
          if (lessons.length === 1) {
            session = await ExamAssistantSessionStore.update(session.id, teacherId, {
              state: 'ASK_EXAM_SETTINGS',
              source_type: 'question_bank',
              context: {
                ...session.context,
                lesson_id: lessons[0].id,
                lesson_name: lessons[0].name,
              },
            });
            return finish(
              session,
              text,
              `تمام، هجهّز امتحان على درس *${lessons[0].name}*.\nتحب كام سؤال؟ ومدة الامتحان كام دقيقة؟`,
            );
          }
          if (lessons.length > 1) {
            session = await ExamAssistantSessionStore.update(session.id, teacherId, {
              state: 'SELECT_LESSON',
              source_type: 'question_bank',
              context: { ...session.context, lesson_candidates: lessons },
            });
            return finish(
              session,
              text,
              `لقيت دروس مشابهة:\n${formatLessonChoices(lessons)}\n\nاختار رقم أو اسم الدرس.`,
            );
          }
          session = await ExamAssistantSessionStore.update(session.id, teacherId, {
            state: 'SELECT_LESSON',
            source_type: 'question_bank',
          });
          return finish(session, text, 'امتحان على أنهي درس؟ اكتب اسم الدرس.');
        }
        return finish(session, text, 'قولّي: من البنك ولا من ملف/صور؟');
      }

      case 'SELECT_LESSON': {
        const candidates = session.context.lesson_candidates || [];
        const asNum = Number(text);
        let chosen =
          Number.isFinite(asNum) && asNum >= 1 && asNum <= candidates.length
            ? candidates[asNum - 1]
            : null;
        if (!chosen) {
          const found = await searchLessons(teacherId, text);
          if (found.length === 1) chosen = found[0];
          else if (found.length > 1) {
            session = await ExamAssistantSessionStore.mergeContext(session.id, teacherId, {
              lesson_candidates: found,
            });
            return finish(session, text, `اختار درس:\n${formatLessonChoices(found)}`);
          }
        }
        if (!chosen) {
          return finish(session, text, 'مش لاقي الدرس. اكتب الاسم بشكل أوضح أو رقم من القائمة.');
        }
        session = await ExamAssistantSessionStore.update(session.id, teacherId, {
          state: 'ASK_EXAM_SETTINGS',
          context: {
            ...session.context,
            lesson_id: chosen.id,
            lesson_name: chosen.name,
          },
        });
        return finish(
          session,
          text,
          `تمام، درس *${chosen.name}*.\nتحب كام سؤال؟ ومدة الامتحان كام دقيقة؟ (مثال: 20 سؤال، 30 دقيقة)`,
        );
      }

      case 'ASK_EXAM_SETTINGS': {
        const countMatch = text.match(/(\d+)\s*سؤال/);
        const durationMatch = text.match(/(\d+)\s*(دقيقة|دقايق|د)/);
        const questionCount = countMatch
          ? Number(countMatch[1])
          : Number(text.match(/\b(\d+)\b/)?.[1]);
        const duration = durationMatch
          ? Number(durationMatch[1])
          : session.context.duration_minutes || 30;
        const qCount = Number.isFinite(questionCount) && questionCount > 0 ? questionCount : 10;
        session = await ExamAssistantSessionStore.mergeContext(session.id, teacherId, {
          question_count: qCount,
          duration_minutes: duration,
        });
        session = await ExamAssistantSessionStore.update(session.id, teacherId, {
          state: 'GENERATING_EXAM',
        });
        const lessonName = session.context.lesson_name || 'الدرس';
        const msg = `اعمل امتحان ${qCount} سؤال على درس ${lessonName}`;
        const generated = await generateFromBank(session, msg);
        return finish(generated.session, text, generated.reply, { action: 'proposal' });
      }

      case 'WAITING_FOR_FILES': {
        if (isDoneSendingFiles(text) || isAffirmative(text)) {
          const mediaIntent = session.context.pending_media_intent || 'create';
          const extracted = await extractQuestionsFromSessionFiles(session);
          if (!extracted.count) {
            return finish(extracted.session, text, extracted.reply, {
              action: 'extract_failed',
            });
          }

          if (mediaIntent === 'review') {
            const reviewed = await replyReviewExtracted(extracted.session);
            return finish(reviewed.session, text, reviewed.reply, { action: 'review_only' });
          }

          if ((mediaIntent === 'add' || mediaIntent === 'edit') && resolveEditableExam(extracted.session)) {
            const target = resolveEditableExam(extracted.session)!;
            const added = await addBulkTextToExam({
              session: extracted.session,
              examId: target.examId,
              kind: target.kind,
              bulkText: extracted.session.context.extracted_bulk_text || '',
            });
            return finish(added.session, text, added.reply, { action: 'added_to_exam' });
          }

          // Default: create flow (SELECT_EXAM_TYPE)
          return finish(extracted.session, text, extracted.reply, {
            action: 'extracted',
            count: extracted.count,
          });
        }
        return finish(
          session,
          text,
          'ابعت الملفات/الصور، أو ابعت «خلصت» لو انتهيت من الإرسال.',
        );
      }

      case 'EXAM_REVIEW':
      case 'MODIFYING_EXAM': {
        if (isAffirmative(text) || /(كمل|انشر|موافق)/.test(text)) {
          // Files path may already be at SELECT_EXAM_TYPE after extract
          if (session.source_type === 'files' && !session.draft_exam_id) {
            session = await ExamAssistantSessionStore.update(session.id, teacherId, {
              state: 'SELECT_EXAM_TYPE',
            });
            return finish(
              session,
              text,
              'تحب الامتحان يكون:\n1) امتحان عام\n2) واجب\n3) امتحان شامل\n\nاكتب النوع بالعربي عادي.',
            );
          }
          session = await ExamAssistantSessionStore.update(session.id, teacherId, {
            state: 'SELECT_EXAM_TYPE',
          });
          return finish(
            session,
            text,
            'تحب الامتحان يكون:\n1) امتحان عام\n2) واجب\n3) امتحان شامل\n\nاكتب النوع بالعربي عادي.',
          );
        }
        if (intentResult?.intent === 'greeting') {
          return finish(session, text, replyGreeting(text));
        }
        if (intentResult?.intent === 'thanks') {
          return finish(session, text, replyThanks());
        }
        const edited = await applyDraftExamEdit({ session, message: text });
        return finish(edited.session, text, edited.reply, { action: 'modify' });
      }

      case 'SELECT_EXAM_TYPE': {
        const examType = detectExamType(text);
        if (!examType) {
          return finish(session, text, 'اختار: امتحان عام، أو واجب، أو امتحان شامل.');
        }
        session = await ExamAssistantSessionStore.mergeContext(session.id, teacherId, {
          exam_type: examType,
        });

        if (examType === 'comprehensive') {
          const courses = await listTeacherCourses(teacherId);
          session = await ExamAssistantSessionStore.update(session.id, teacherId, {
            state: 'SELECT_TARGET',
            context: { ...session.context, exam_type: examType, course_candidates: courses },
          });
          const list = courses
            .slice(0, 12)
            .map((c, i) => `${i + 1}) ${c.title}`)
            .join('\n');
          return finish(
            session,
            text,
            `الامتحان الشامل على أنهي كورس؟\n${list || 'لا توجد كورسات ظاهرة.'}`,
          );
        }

        const courses = await listTeacherCourses(teacherId);
        session = await ExamAssistantSessionStore.update(session.id, teacherId, {
          state: 'SELECT_TARGET',
          context: { ...session.context, exam_type: examType, course_candidates: courses },
        });
        const list = courses
          .slice(0, 12)
          .map((c, i) => `${i + 1}) ${c.title}`)
          .join('\n');
        return finish(session, text, `اختار الكورس أولاً عشان نحدد المحاضرة:\n${list}`);
      }

      case 'SELECT_TARGET': {
        const examType = session.context.exam_type || 'general';
        const courses = session.context.course_candidates || (await listTeacherCourses(teacherId));
        const lectures = session.context.lecture_candidates || [];

        if (lectures.length && session.context.target_course_id) {
          const n = Number(text);
          let lecture =
            Number.isFinite(n) && n >= 1 && n <= lectures.length ? lectures[n - 1] : null;
          if (!lecture) {
            lecture =
              lectures.find((l) => l.title.toLowerCase().includes(text.toLowerCase())) || null;
          }
          if (!lecture) {
            return finish(
              session,
              text,
              `اختار محاضرة:\n${lectures
                .slice(0, 15)
                .map((l, i) => `${i + 1}) ${l.title}`)
                .join('\n')}`,
            );
          }
          const created = await createDraftExamFromWorkflow({
            session,
            examType,
            lectureId: lecture.id,
            courseId: session.context.target_course_id,
          });
          return finish(created.session, text, created.reply, { action: 'draft_created' });
        }

        const n = Number(text);
        let course =
          Number.isFinite(n) && n >= 1 && n <= courses.length ? courses[n - 1] : null;
        if (!course) {
          course = courses.find((c) => c.title.toLowerCase().includes(text.toLowerCase())) || null;
        }
        if (!course) {
          return finish(
            session,
            text,
            `اختار كورس:\n${courses
              .slice(0, 12)
              .map((c, i) => `${i + 1}) ${c.title}`)
              .join('\n')}`,
          );
        }

        if (examType === 'comprehensive') {
          const created = await createDraftExamFromWorkflow({
            session,
            examType,
            courseId: course.id,
          });
          return finish(created.session, text, created.reply, { action: 'draft_created' });
        }

        const courseLectures = await listCourseLectures(teacherId, course.id);
        session = await ExamAssistantSessionStore.update(session.id, teacherId, {
          context: {
            ...session.context,
            target_course_id: course.id,
            lecture_candidates: courseLectures,
          },
        });
        return finish(
          session,
          text,
          `كورس *${course.title}*. اختار المحاضرة:\n${
            courseLectures
              .slice(0, 15)
              .map((l, i) => `${i + 1}) ${l.title}`)
              .join('\n') || 'لا توجد محاضرات.'
          }`,
        );
      }

      case 'READY_TO_PUBLISH': {
        if (isAffirmative(text) || /(انشر|نشر|موافق على النشر)/.test(text)) {
          const published = await publishDraftExam(session);
          return finish(published.session, text, published.reply, { action: 'published' });
        }
        if (intentResult?.intent === 'modify_exam' || /(احذف|عدل|عدّل|غير|ضيف|درجة)/.test(text)) {
          const edited = await applyDraftExamEdit({ session, message: text });
          return finish(edited.session, text, edited.reply, { action: 'modify' });
        }
        if (intentResult?.intent === 'greeting') {
          return finish(session, text, replyGreeting(text));
        }
        return finish(
          session,
          text,
          `المسودة جاهزة${session.context.review_url ? `\n${session.context.review_url}` : ''}\n\nللنشر ابعت «انشر» أو «موافق على النشر».\nللتعديل: «احذف السؤال 3».\nللإلغاء: «إلغاء».`,
        );
      }

      case 'GENERATING_EXAM':
      case 'EXTRACTING_QUESTIONS':
      case 'PROCESSING_FILES': {
        return finish(session, text, 'لسه بجهّز… استنى لحظة وابعت رسالتك تاني لو مفيش رد.');
      }

      default:
        return finish(session, text, 'اكتب طلب امتحان جديد، أو «إلغاء» لو فيه عملية مفتوحة.');
    }
  } catch (err: any) {
    logger.error({ err, teacherId, sessionId: session.id }, 'exam assistant workflow failed');
    const failed = await ExamAssistantSessionStore.update(session.id, teacherId, {
      state: 'FAILED',
      status: 'failed',
      last_error: err?.message || 'workflow_error',
    }).catch(() => session);
    return finish(
      failed,
      text,
      `حصلت مشكلة أثناء تجهيز الامتحان: ${String(err?.message || 'خطأ غير متوقع').slice(0, 180)}\n\nالمسودة/الملفات محفوظة قدر الإمكان. ابعت «إلغاء» ثم ابدأ من جديد، أو كمل لو تقدر.`,
      { action: 'failed' },
    );
  }
}
