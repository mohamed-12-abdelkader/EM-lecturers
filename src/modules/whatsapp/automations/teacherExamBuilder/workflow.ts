import { logger } from '../../../../utils';
import type { InboundContext } from '../types';
import { ExamAssistantSessionStore } from './sessionStore';
import type { ExamAssistantSessionRow } from './types';
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

export async function runExamAssistantWorkflow(
  ctx: InboundContext,
  teacherId: number,
): Promise<WorkflowResult> {
  let session = await ensureSession(ctx, teacherId);
  const text = (ctx.body || ctx.media?.caption || '').trim();

  try {
    if (text && isCancel(text)) {
      const cancelled = await cancelWorkflow(session);
      return { reply: cancelled.reply, session: cancelled.session, metadata: { action: 'cancel' } };
    }

    // Collect media into current/file-wait session
    if (ctx.media) {
      const mime = (ctx.media.mimetype || '').toLowerCase();
      const ok =
        mime.startsWith('image/') ||
        mime.includes('pdf') ||
        mime === 'application/pdf';
      if (!ok) {
        return {
          reply: 'نوع الملف مش مدعوم. ابعت PDF أو صور JPG/PNG.',
          session,
          metadata: { action: 'unsupported_media' },
        };
      }

      if (session.state === 'IDLE' || session.state === 'ASK_SOURCE') {
        session = await ExamAssistantSessionStore.update(session.id, teacherId, {
          state: 'WAITING_FOR_FILES',
          source_type: 'files',
          context: { ...session.context, awaiting_more_files: true },
        });
      }

      if (
        session.state === 'WAITING_FOR_FILES' ||
        session.state === 'PROCESSING_FILES' ||
        session.source_type === 'files'
      ) {
        await saveInboundMediaFile({
          sessionId: session.id,
          teacherId,
          waMessageId: ctx.waMessageId,
          media: ctx.media,
        });
        const files = await ExamAssistantSessionStore.listFiles(session.id, teacherId);
        session = await ExamAssistantSessionStore.update(session.id, teacherId, {
          state: 'WAITING_FOR_FILES',
          source_type: 'files',
          context: { ...session.context, awaiting_more_files: true },
        });
        return {
          reply: `استلمت الملف ✅ (الإجمالي: ${files.length}).\nلو فيه صور/ملفات تانية ابعتها، ولما تخلّص ابعت «خلصت».`,
          session,
          metadata: { action: 'file_received', files: files.length },
        };
      }
    }

    if (ctx.mediaError) {
      return {
        reply: 'تعذر استلام المرفق. جرّب تبعت الملف تاني بحجم أصغر.',
        session,
        metadata: { action: 'media_error' },
      };
    }

    if (!text) {
      return {
        reply: 'اكتب طلبك، مثلاً: اعمل امتحان على درس الهرمونات — أو ابعت ملف/صور الأسئلة.',
        session,
      };
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
      });
    }

    switch (session.state) {
      case 'IDLE':
      case 'CANCELLED':
      case 'PUBLISHED':
      case 'FAILED': {
        // fresh start
        if (session.state !== 'IDLE') {
          session = await ExamAssistantSessionStore.create({
            teacherId,
            tenantId: ctx.conversation?.tenant_id ?? null,
            conversationId: ctx.conversation?.id ?? null,
            contactPhone: ctx.fromPhone,
            state: 'IDLE',
          });
        }

        const tasks = await getTodayExamTasks(teacherId);
        if (tasks.length && !/(ملف|صور|بنك)/.test(text)) {
          const task = tasks[0];
          session = await ExamAssistantSessionStore.update(session.id, teacherId, {
            state: 'CHECK_TEACHER_TASK',
            context: {
              scheduled_task_id: task.id,
              scheduled_task_title: task.title,
              lesson_name: task.title,
            },
          });
          return {
            reply: `عندك ${task.taskType === 'homework' ? 'واجب' : 'امتحان'} مجدول النهارده: *${task.title}*.\nتحب أجهّزلك الامتحان من بنك الأسئلة؟`,
            session,
            metadata: { action: 'check_task' },
          };
        }

        const source = detectSourceType(text);
        if (source === 'files') {
          session = await ExamAssistantSessionStore.update(session.id, teacherId, {
            state: 'WAITING_FOR_FILES',
            source_type: 'files',
            context: { ...session.context, awaiting_more_files: true, exam_title: text },
          });
          return {
            reply: 'تمام، ابعت الملف أو الصور دلوقتي. لما تخلّص ابعت «خلصت».',
            session,
          };
        }

        // Try generate directly from natural language (bank)
        session = await ExamAssistantSessionStore.update(session.id, teacherId, {
          state: 'GENERATING_EXAM',
          source_type: 'question_bank',
        });
        try {
          const generated = await generateFromBank(session, text);
          if (generated.session.state === 'EXAM_REVIEW') {
            return {
              reply: generated.reply,
              session: generated.session,
              metadata: { action: 'proposal' },
            };
          }
          // Could not generate — ask source/lesson
          session = await ExamAssistantSessionStore.update(session.id, teacherId, {
            state: 'ASK_SOURCE',
          });
          return {
            reply:
              generated.reply +
              '\n\nتحب الامتحان من *بنك الأسئلة* ولا عندك *ملف/صور* أعمل منه الامتحان؟',
            session: generated.session,
          };
        } catch (err: any) {
          session = await ExamAssistantSessionStore.update(session.id, teacherId, {
            state: 'ASK_SOURCE',
            last_error: err?.message || 'generate_failed',
          });
          return {
            reply:
              'تحب الامتحان من *بنك الأسئلة* ولا عندك *ملف أو صور*؟\nولو من البنك، امتحان على أنهي درس؟',
            session,
          };
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
          return { reply: generated.reply, session: generated.session, metadata: { action: 'proposal_from_task' } };
        }
        if (/لا|لأ|مش عايز|من غير|ملف|صور/.test(text)) {
          const source = detectSourceType(text);
          if (source === 'files') {
            session = await ExamAssistantSessionStore.update(session.id, teacherId, {
              state: 'WAITING_FOR_FILES',
              source_type: 'files',
            });
            return { reply: 'ماشي، ابعت الملفات/الصور، وبعدين «خلصت».', session };
          }
          session = await ExamAssistantSessionStore.update(session.id, teacherId, {
            state: 'ASK_SOURCE',
            context: { ...session.context, scheduled_task_id: null },
          });
          return {
            reply: 'تمام. تحب من بنك الأسئلة ولا من ملف/صور؟ ولو من البنك: امتحان على أنهي درس؟',
            session,
          };
        }
        return {
          reply: 'رد بـ «ماشي» لو تحب أجهّز الامتحان المجدول، أو قولّي عايز من ملف/بنك بشكل تاني.',
          session,
        };
      }

      case 'ASK_SOURCE': {
        const source = detectSourceType(text) || (isAffirmative(text) ? 'question_bank' : null);
        if (source === 'files') {
          session = await ExamAssistantSessionStore.update(session.id, teacherId, {
            state: 'WAITING_FOR_FILES',
            source_type: 'files',
          });
          return { reply: 'ابعت PDF أو الصور، ولما تخلّص ابعت «خلصت».', session };
        }
        if (source === 'question_bank' || /(درس|أسئلة|اسئلة)/.test(text)) {
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
            return {
              reply: `تمام، هجهّز امتحان على درس *${lessons[0].name}*.\nتحب كام سؤال؟ ومدة الامتحان كام دقيقة؟`,
              session,
            };
          }
          if (lessons.length > 1) {
            session = await ExamAssistantSessionStore.update(session.id, teacherId, {
              state: 'SELECT_LESSON',
              source_type: 'question_bank',
              context: { ...session.context, lesson_candidates: lessons },
            });
            return {
              reply: `لقيت دروس مشابهة:\n${formatLessonChoices(lessons)}\n\nاختار رقم أو اسم الدرس.`,
              session,
            };
          }
          session = await ExamAssistantSessionStore.update(session.id, teacherId, {
            state: 'SELECT_LESSON',
            source_type: 'question_bank',
          });
          return { reply: 'امتحان على أنهي درس؟ اكتب اسم الدرس.', session };
        }
        return { reply: 'قولّي: من البنك ولا من ملف/صور؟', session };
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
            return {
              reply: `اختار درس:\n${formatLessonChoices(found)}`,
              session,
            };
          }
        }
        if (!chosen) {
          return { reply: 'مش لاقي الدرس. اكتب الاسم بشكل أوضح أو رقم من القائمة.', session };
        }
        session = await ExamAssistantSessionStore.update(session.id, teacherId, {
          state: 'ASK_EXAM_SETTINGS',
          context: {
            ...session.context,
            lesson_id: chosen.id,
            lesson_name: chosen.name,
          },
        });
        return {
          reply: `تمام، درس *${chosen.name}*.\nتحب كام سؤال؟ ومدة الامتحان كام دقيقة؟ (مثال: 20 سؤال، 30 دقيقة)`,
          session,
        };
      }

      case 'ASK_EXAM_SETTINGS': {
        const countMatch = text.match(/(\d+)\s*سؤال/);
        const durationMatch = text.match(/(\d+)\s*(دقيقة|دقايق|د)/);
        const questionCount = countMatch ? Number(countMatch[1]) : Number(text.match(/\b(\d+)\b/)?.[1]);
        const duration = durationMatch ? Number(durationMatch[1]) : session.context.duration_minutes || 30;
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
        return { reply: generated.reply, session: generated.session, metadata: { action: 'proposal' } };
      }

      case 'WAITING_FOR_FILES': {
        if (isDoneSendingFiles(text) || isAffirmative(text)) {
          const extracted = await extractQuestionsFromSessionFiles(session);
          return {
            reply: extracted.reply,
            session: extracted.session,
            metadata: { action: 'extracted', count: extracted.count },
          };
        }
        return {
          reply: 'ابعت الملفات/الصور، أو ابعت «خلصت» لو انتهيت من الإرسال.',
          session,
        };
      }

      case 'EXAM_REVIEW':
      case 'MODIFYING_EXAM': {
        if (isAffirmative(text) || /(كمل|انشر|موافق)/.test(text)) {
          session = await ExamAssistantSessionStore.update(session.id, teacherId, {
            state: 'SELECT_EXAM_TYPE',
          });
          return {
            reply:
              'تحب الامتحان يكون:\n1) امتحان عام\n2) واجب\n3) امتحان شامل\n\nاكتب النوع بالعربي عادي.',
            session,
          };
        }
        // Adjust / regenerate via existing exam builder chat
        session = await ExamAssistantSessionStore.update(session.id, teacherId, {
          state: 'MODIFYING_EXAM',
        });
        const adjusted = await generateFromBank(session, text);
        return { reply: adjusted.reply, session: adjusted.session, metadata: { action: 'modify' } };
      }

      case 'SELECT_EXAM_TYPE': {
        const examType = detectExamType(text);
        if (!examType) {
          return {
            reply: 'اختار: امتحان عام، أو واجب، أو امتحان شامل.',
            session,
          };
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
          return {
            reply: `الامتحان الشامل على أنهي كورس؟\n${list || 'لا توجد كورسات ظاهرة.'}`,
            session,
          };
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
        return {
          reply: `اختار الكورس أولاً عشان نحدد المحاضرة:\n${list}`,
          session,
        };
      }

      case 'SELECT_TARGET': {
        const examType = session.context.exam_type || 'general';
        const courses = session.context.course_candidates || (await listTeacherCourses(teacherId));
        const lectures = session.context.lecture_candidates || [];

        // Selecting lecture
        if (lectures.length && session.context.target_course_id) {
          const n = Number(text);
          let lecture =
            Number.isFinite(n) && n >= 1 && n <= lectures.length ? lectures[n - 1] : null;
          if (!lecture) {
            lecture =
              lectures.find((l) => l.title.toLowerCase().includes(text.toLowerCase())) || null;
          }
          if (!lecture) {
            return {
              reply: `اختار محاضرة:\n${lectures
                .slice(0, 15)
                .map((l, i) => `${i + 1}) ${l.title}`)
                .join('\n')}`,
              session,
            };
          }
          const created = await createDraftExamFromWorkflow({
            session,
            examType,
            lectureId: lecture.id,
            courseId: session.context.target_course_id,
          });
          return { reply: created.reply, session: created.session, metadata: { action: 'draft_created' } };
        }

        // Selecting course
        const n = Number(text);
        let course =
          Number.isFinite(n) && n >= 1 && n <= courses.length ? courses[n - 1] : null;
        if (!course) {
          course = courses.find((c) => c.title.toLowerCase().includes(text.toLowerCase())) || null;
        }
        if (!course) {
          return {
            reply: `اختار كورس:\n${courses
              .slice(0, 12)
              .map((c, i) => `${i + 1}) ${c.title}`)
              .join('\n')}`,
            session,
          };
        }

        if (examType === 'comprehensive') {
          const created = await createDraftExamFromWorkflow({
            session,
            examType,
            courseId: course.id,
          });
          return { reply: created.reply, session: created.session, metadata: { action: 'draft_created' } };
        }

        const courseLectures = await listCourseLectures(teacherId, course.id);
        session = await ExamAssistantSessionStore.update(session.id, teacherId, {
          context: {
            ...session.context,
            target_course_id: course.id,
            lecture_candidates: courseLectures,
          },
        });
        return {
          reply: `كورس *${course.title}*. اختار المحاضرة:\n${courseLectures
            .slice(0, 15)
            .map((l, i) => `${i + 1}) ${l.title}`)
            .join('\n') || 'لا توجد محاضرات.'}`,
          session,
        };
      }

      case 'READY_TO_PUBLISH': {
        if (isAffirmative(text) || /(انشر|نشر|موافق على النشر)/.test(text)) {
          const published = await publishDraftExam(session);
          return {
            reply: published.reply,
            session: published.session,
            metadata: { action: 'published' },
          };
        }
        return {
          reply: `المسودة جاهزة${session.context.review_url ? `\n${session.context.review_url}` : ''}\n\nللنشر ابعت «انشر» أو «موافق على النشر». للإلغاء: «إلغاء».`,
          session,
        };
      }

      case 'GENERATING_EXAM':
      case 'EXTRACTING_QUESTIONS':
      case 'PROCESSING_FILES': {
        return {
          reply: 'لسه بجهّز… استنى لحظة وابعت رسالتك تاني لو مفيش رد.',
          session,
        };
      }

      default:
        return {
          reply: 'اكتب طلب امتحان جديد، أو «إلغاء» لو فيه عملية مفتوحة.',
          session,
        };
    }
  } catch (err: any) {
    logger.error({ err, teacherId, sessionId: session.id }, 'exam assistant workflow failed');
    const failed = await ExamAssistantSessionStore.update(session.id, teacherId, {
      state: 'FAILED',
      status: 'failed',
      last_error: err?.message || 'workflow_error',
    }).catch(() => session);
    return {
      reply: `حصلت مشكلة أثناء تجهيز الامتحان: ${String(err?.message || 'خطأ غير متوقع').slice(0, 180)}\n\nالمسودة/الملفات محفوظة قدر الإمكان. ابعت «إلغاء» ثم ابدأ من جديد، أو كمل لو تقدر.`,
      session: failed,
      metadata: { action: 'failed' },
    };
  }
}
