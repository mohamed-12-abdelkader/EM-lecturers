import fs from 'node:fs';
import path from 'node:path';
import type { Express } from 'express';
import pool from '../../../../db/pool';
import { config } from '../../../../utils';
import { ExamBuilderChatbotService } from '../../../../services/examBuilderChatbot';
import { ExamFlowService } from '../../../../services/examFlow';
import { CourseLevelExamsService } from '../../../../services/courseLevelExams';
import { TeacherScheduleService } from '../../../../services/teacherSchedule';
import { MistralQuestionExtractionService } from '../../../../services/mistralQuestionExtraction';
import { QuestionsManagementService } from '../../../../services/questionsManagement';
import { ExamAssistantSessionStore } from './sessionStore';
import type {
  ExamAssistantExamType,
  ExamAssistantSessionRow,
  ExamAssistantSourceType,
} from './types';

const UPLOAD_DIR = path.join(process.cwd(), 'uploads/wa-exam-assistant');

function frontendBase(): string {
  return String(config.FRONTEND_HOST || config.PRODUCTION_URL || 'https://em-online.online').replace(
    /\/$/,
    '',
  );
}

export function buildExamBuilderReviewUrl(sessionId: string): string {
  return `${frontendBase()}/exam-builder-chat/${sessionId}/approve`;
}

export function buildLectureExamReviewUrl(examId: number): string {
  // Teacher manages lecture exams from course content; builder approve page is safer fallback for bank.
  return `${frontendBase()}/exam-builder-chat?draftExamId=${examId}`;
}

export function buildCourseExamReviewUrl(examId: number): string {
  return `${frontendBase()}/public-exams/${examId}`;
}

function todayCairo(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export async function getTodayExamTasks(teacherId: number) {
  const tasks = await TeacherScheduleService.listTasks({
    teacherId,
    date: todayCairo(),
  });
  return tasks.filter((t) => t.taskType === 'exam' || t.taskType === 'homework');
}

export async function searchLessons(teacherId: number, query: string) {
  const catalog = await ExamBuilderChatbotService.getTeacherCatalog(teacherId);
  const q = query.trim().toLowerCase();
  const lessons: Array<{ id: number; name: string; question_count: number; chapter_name: string }> =
    [];
  for (const ch of catalog) {
    for (const lesson of ch.lessons) {
      if (!q || lesson.name.toLowerCase().includes(q) || ch.name.toLowerCase().includes(q)) {
        lessons.push({
          id: lesson.id,
          name: lesson.name,
          question_count: lesson.question_count,
          chapter_name: ch.name,
        });
      }
    }
  }
  return lessons.slice(0, 12);
}

export async function listTeacherCourses(teacherId: number) {
  const res = await pool.query(
    `SELECT id, title FROM courses
     WHERE teacher_id = $1 AND COALESCE(is_visible, true) = true
     ORDER BY title ASC
     LIMIT 40`,
    [teacherId],
  );
  return res.rows.map((r) => ({ id: Number(r.id), title: String(r.title) }));
}

export async function listCourseLectures(teacherId: number, courseId: number) {
  const res = await pool.query(
    `SELECT l.id, l.title, l.course_id
     FROM lectures l
     JOIN courses c ON c.id = l.course_id
     WHERE c.teacher_id = $1 AND l.course_id = $2
     ORDER BY COALESCE(l.order_num, l.id) ASC
     LIMIT 80`,
    [teacherId, courseId],
  );
  return res.rows.map((r) => ({
    id: Number(r.id),
    title: String(r.title || `محاضرة ${r.id}`),
    course_id: Number(r.course_id),
  }));
}

export async function generateFromBank(
  session: ExamAssistantSessionRow,
  message: string,
): Promise<{ reply: string; session: ExamAssistantSessionRow }> {
  const result = await ExamBuilderChatbotService.handleChatMessage(
    session.teacher_id,
    message,
    session.exam_builder_session_id,
  );

  await ExamBuilderChatbotService.saveMessage(
    session.teacher_id,
    'teacher',
    message,
    result.session?.id ?? session.exam_builder_session_id,
    { channel: 'whatsapp', action: 'workflow_generate' },
  );
  await ExamBuilderChatbotService.saveMessage(
    session.teacher_id,
    'assistant',
    result.reply,
    result.session?.id ?? null,
    { channel: 'whatsapp', action: 'workflow_proposal' },
  );

  let updated = session;
  if (result.session?.id) {
    updated = await ExamAssistantSessionStore.update(session.id, session.teacher_id, {
      state: 'EXAM_REVIEW',
      source_type: 'question_bank',
      exam_builder_session_id: result.session.id,
      context: {
        ...session.context,
        review_url: buildExamBuilderReviewUrl(result.session.id),
        question_count: result.session.selected_questions?.length || session.context.question_count,
        lesson_name: session.context.lesson_name || null,
      },
    });
  } else {
    updated = await ExamAssistantSessionStore.update(session.id, session.teacher_id, {
      state: 'ASK_EXAM_SETTINGS',
      last_error: null,
    });
  }

  const reviewHint = updated.context.review_url
    ? `\n\nرابط المراجعة:\n${updated.context.review_url}\n\nلو الامتحان تمام ابعت «موافق» أو «كمل». لو عايز تعديل قول مثلاً «شيل السؤال 3» أو «زود 5 أسئلة».`
    : '';

  return {
    reply: `${result.reply}${reviewHint}`,
    session: updated,
  };
}

export async function saveInboundMediaFile(opts: {
  sessionId: number;
  teacherId: number;
  waMessageId?: string | null;
  media: { data: string; mimetype?: string | null; filename?: string | null };
}) {
  await fs.promises.mkdir(UPLOAD_DIR, { recursive: true });
  const mime = (opts.media.mimetype || 'application/octet-stream').toLowerCase();
  const ext = mime.includes('pdf')
    ? 'pdf'
    : mime.includes('png')
      ? 'png'
      : mime.includes('webp')
        ? 'webp'
        : 'jpg';
  const filename =
    opts.media.filename ||
    `wa-exam-${opts.teacherId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const filePath = path.join(UPLOAD_DIR, filename);
  const buffer = Buffer.from(opts.media.data, 'base64');
  await fs.promises.writeFile(filePath, buffer);
  await ExamAssistantSessionStore.addFile({
    sessionId: opts.sessionId,
    teacherId: opts.teacherId,
    waMessageId: opts.waMessageId,
    originalName: filename,
    mimeType: mime,
    filePath,
    fileSize: buffer.length,
  });
  return { filePath, mime, size: buffer.length };
}

function toMulterFile(filePath: string, mimeType: string | null, originalName: string | null): Express.Multer.File {
  const buffer = fs.readFileSync(filePath);
  return {
    fieldname: 'file',
    originalname: originalName || path.basename(filePath),
    encoding: '7bit',
    mimetype: mimeType || 'application/octet-stream',
    size: buffer.length,
    buffer,
    destination: path.dirname(filePath),
    filename: path.basename(filePath),
    path: filePath,
    stream: undefined as unknown as Express.Multer.File['stream'],
  };
}

function extractedToBulkText(questions: any[]): string {
  const blocks: string[] = [];
  questions.forEach((q, idx) => {
    const text = String(q.question_text || q.text || q.stem || '').trim();
    if (!text) return;
    const opts = q.options || q.choices || [];
    const letters = ['a', 'b', 'c', 'd', 'e'];
    const lines = [`${idx + 1}- ${text}`];
    if (Array.isArray(opts) && opts.length) {
      opts.slice(0, 5).forEach((opt: any, i: number) => {
        const optText = typeof opt === 'string' ? opt : opt?.text || opt?.label || '';
        if (optText) lines.push(`${letters[i]}. ${String(optText).trim()}`);
      });
    } else {
      // Ensure parseable MCQ shape if model returned question only
      lines.push('a. —', 'b. —', 'c. —', 'd. —');
    }
    blocks.push(lines.join('\n'));
  });
  return blocks.join('\n\n');
}

export async function extractQuestionsFromSessionFiles(
  session: ExamAssistantSessionRow,
): Promise<{ reply: string; session: ExamAssistantSessionRow; count: number }> {
  const files = await ExamAssistantSessionStore.listFiles(session.id, session.teacher_id);
  if (!files.length) {
    return {
      reply: 'لسه مفيش ملفات. ابعت PDF أو صور الأسئلة، ولما تخلّص ابعت «خلصت».',
      session,
      count: 0,
    };
  }

  await ExamAssistantSessionStore.update(session.id, session.teacher_id, {
    state: 'EXTRACTING_QUESTIONS',
  });

  const multerFiles = files.map((f) =>
    toMulterFile(f.file_path, f.mime_type, f.original_name),
  );

  const extraction = await MistralQuestionExtractionService.extractQuestionsFromFiles(multerFiles, {
    inferCorrectAnswer: true,
    includeQuestionImages: true,
    contentMode: 'auto',
  });

  const questions = Array.isArray((extraction as any).questions)
    ? (extraction as any).questions
    : Array.isArray((extraction as any).data?.questions)
      ? (extraction as any).data.questions
      : [];

  const bulkText = extractedToBulkText(questions);
  const count = questions.length;
  const updated = await ExamAssistantSessionStore.update(session.id, session.teacher_id, {
    state: count > 0 ? 'EXAM_REVIEW' : 'FAILED',
    source_type: 'files',
    last_error: count > 0 ? null : 'لم يتم استخراج أسئلة من الملفات',
    context: {
      ...session.context,
      extracted_question_count: count,
      extracted_bulk_text: bulkText || null,
      awaiting_more_files: false,
    },
  });

  if (!count) {
    return {
      reply:
        'مقدرتش أستخرج أسئلة واضحة من الملفات. تأكد إن الملف فيه أسئلة، أو ابعت صور أوضح، أو جرّب من بنك الأسئلة.',
      session: updated,
      count: 0,
    };
  }

  return {
    reply: [
      'تم تجهيز الامتحان من الملفات اللي بعتها ✅',
      `عدد الأسئلة المستخرجة: ${count}`,
      '',
      'الامتحان لسه مسودة ومش منشور للطلاب.',
      'قولّي نوع الامتحان عشان أكمّل الإنشاء:',
      '1) امتحان عام (على محاضرة)',
      '2) واجب',
      '3) امتحان شامل (على كورس)',
      '',
      'أو ابعت «إلغاء» لو مش عايز تكمّل.',
    ].join('\n'),
    session: await ExamAssistantSessionStore.update(updated.id, updated.teacher_id, {
      state: 'SELECT_EXAM_TYPE',
    }),
    count,
  };
}

export async function createDraftExamFromWorkflow(opts: {
  session: ExamAssistantSessionRow;
  examType: ExamAssistantExamType;
  courseId?: number | null;
  lectureId?: number | null;
  title?: string | null;
  durationMinutes?: number | null;
  totalGrade?: number | null;
}): Promise<{ reply: string; session: ExamAssistantSessionRow }> {
  const { session, examType } = opts;
  const title =
    opts.title?.trim() ||
    session.context.exam_title ||
    (session.context.lesson_name
      ? `امتحان ${session.context.lesson_name}`
      : 'امتحان من واتساب');

  // Question bank path: approve proposal then attach to draft exam
  if (session.source_type === 'question_bank' && session.exam_builder_session_id) {
    const approved = await ExamBuilderChatbotService.approveSession(
      session.teacher_id,
      session.exam_builder_session_id,
      { create_exam: false },
    );
    const questionIds = approved.question_ids || [];
    if (!questionIds.length) {
      throw new Error('لا توجد أسئلة معتمدة لإنشاء الامتحان');
    }

    if (examType === 'comprehensive') {
      if (!opts.courseId) throw new Error('course_id مطلوب للامتحان الشامل');
      const exam = await CourseLevelExamsService.createExam(
        { id: session.teacher_id, role: 'teacher' },
        {
          title,
          courseId: opts.courseId,
          durationMinutes: opts.durationMinutes ?? session.context.duration_minutes ?? 30,
          questionsCount: questionIds.length,
          isVisibleToStudents: false,
          visibilityEndDate: null,
          showAnswersImmediately: true,
          answersVisibleAt: null,
          isActive: true,
        },
      );
      const examId = Number(exam.id);
      await CourseLevelExamsService.addQuestionsFromBank(
        { id: session.teacher_id, role: 'teacher' },
        examId,
        questionIds,
      );
      const reviewUrl = buildCourseExamReviewUrl(examId);
      const updated = await ExamAssistantSessionStore.update(session.id, session.teacher_id, {
        state: 'READY_TO_PUBLISH',
        draft_exam_id: examId,
        draft_exam_kind: 'course-exam',
        context: {
          ...session.context,
          exam_type: examType,
          target_course_id: opts.courseId,
          review_url: reviewUrl,
        },
      });
      return {
        reply: [
          'تم إنشاء مسودة الامتحان الشامل ✅',
          `عدد الأسئلة: ${questionIds.length}`,
          `رابط المراجعة: ${reviewUrl}`,
          '',
          'راجع الامتحان على المنصة، ولو تمام ابعت «انشر» أو «موافق على النشر».',
        ].join('\n'),
        session: updated,
      };
    }

    if (!opts.lectureId) throw new Error('lecture_id مطلوب لامتحان المحاضرة/الواجب');
    const exam = await ExamFlowService.createExam(session.teacher_id, {
      lectureId: opts.lectureId,
      title,
      type: examType === 'assignment' ? 'assignment' : 'exam',
      duration: opts.durationMinutes ?? session.context.duration_minutes ?? 30,
      totalGrade: opts.totalGrade ?? session.context.total_grade ?? questionIds.length,
      questionsCount: questionIds.length,
      isVisible: false,
    });
    const examId = Number(exam.id);
    await ExamFlowService.addQuestionsFromBank(session.teacher_id, examId, questionIds);
    const reviewUrl = buildLectureExamReviewUrl(examId);
    const updated = await ExamAssistantSessionStore.update(session.id, session.teacher_id, {
      state: 'READY_TO_PUBLISH',
      draft_exam_id: examId,
      draft_exam_kind: 'lecture-exam',
      context: {
        ...session.context,
        exam_type: examType,
        target_lecture_id: opts.lectureId,
        review_url: reviewUrl,
      },
    });
    return {
      reply: [
        `تم إنشاء مسودة ${examType === 'assignment' ? 'الواجب' : 'الامتحان'} ✅`,
        `عدد الأسئلة: ${questionIds.length}`,
        `رابط المراجعة: ${reviewUrl}`,
        '',
        'راجع الامتحان، ولو تمام ابعت «انشر».',
      ].join('\n'),
      session: updated,
    };
  }

  // Files path: create draft then bulk-import extracted text
  const bulkText = session.context.extracted_bulk_text;
  if (!bulkText) throw new Error('لا يوجد نص أسئلة مستخرج');

  if (examType === 'comprehensive') {
    if (!opts.courseId) throw new Error('course_id مطلوب');
    const exam = await CourseLevelExamsService.createExam(
      { id: session.teacher_id, role: 'teacher' },
      {
        title,
        courseId: opts.courseId,
        durationMinutes: opts.durationMinutes ?? session.context.duration_minutes ?? 30,
        questionsCount: session.context.extracted_question_count || 1,
        isVisibleToStudents: false,
        visibilityEndDate: null,
        showAnswersImmediately: true,
        answersVisibleAt: null,
        isActive: true,
      },
    );
    const examId = Number(exam.id);
    // Prefer lecture bulk parser via course exam APIs when available
    const { CourseLevelExamQuestionsService } = await import(
      '../../../../services/courseLevelExamQuestions.js'
    );
    const parsed = CourseLevelExamQuestionsService.parseBulkQuestionText(bulkText);
    let imported = 0;
    if (parsed.length) {
      try {
        const created = await CourseLevelExamQuestionsService.createTextQuestionsBulk(
          { id: session.teacher_id, role: 'teacher' },
          examId,
          parsed.map((p: any) => ({
            questionText: p.questionText,
            optionA: p.optionA,
            optionB: p.optionB,
            optionC: p.optionC,
            optionD: p.optionD,
            correctAnswer: (p.correctAnswer || 'A') as 'A' | 'B' | 'C' | 'D',
          })),
        );
        imported = Array.isArray(created) ? created.length : parsed.length;
      } catch {
        imported = 0;
      }
    }
    const reviewUrl = buildCourseExamReviewUrl(examId);
    const updated = await ExamAssistantSessionStore.update(session.id, session.teacher_id, {
      state: 'READY_TO_PUBLISH',
      draft_exam_id: examId,
      draft_exam_kind: 'course-exam',
      context: { ...session.context, exam_type: examType, target_course_id: opts.courseId, review_url: reviewUrl },
    });
    return {
      reply: [
        'تم إنشاء مسودة الامتحان الشامل من الملفات ✅',
        `الأسئلة المستخرجة: ${session.context.extracted_question_count || parsed.length}`,
        imported > 0 ? `تم استيراد ${imported} سؤال تلقائياً.` : 'راجع الأسئلة على المنصة وأكمل الاستيراد إن لزم.',
        `رابط المراجعة: ${reviewUrl}`,
        '',
        'بعد المراجعة ابعت «انشر» عشان يظهر للطلاب.',
      ].join('\n'),
      session: updated,
    };
  }

  if (!opts.lectureId) throw new Error('lecture_id مطلوب');
  const exam = await ExamFlowService.createExam(session.teacher_id, {
    lectureId: opts.lectureId,
    title,
    type: examType === 'assignment' ? 'assignment' : 'exam',
    duration: opts.durationMinutes ?? session.context.duration_minutes ?? 30,
    totalGrade: opts.totalGrade ?? session.context.total_grade ?? undefined,
    isVisible: false,
  });
  const examId = Number(exam.id);
  const { CourseLevelExamQuestionsService } = await import(
    '../../../../services/courseLevelExamQuestions.js'
  );
  const parsed = CourseLevelExamQuestionsService.parseBulkQuestionText(bulkText);
  if (parsed.length) {
    await QuestionsManagementService.createBulkQuestionsForLectureExamFromParsed(
      examId,
      session.teacher_id,
      parsed,
    );
  }
  const reviewUrl = buildLectureExamReviewUrl(examId);
  const updated = await ExamAssistantSessionStore.update(session.id, session.teacher_id, {
    state: 'READY_TO_PUBLISH',
    draft_exam_id: examId,
    draft_exam_kind: 'lecture-exam',
    context: {
      ...session.context,
      exam_type: examType,
      target_lecture_id: opts.lectureId,
      review_url: reviewUrl,
    },
  });
  return {
    reply: [
      `تم إنشاء مسودة ${examType === 'assignment' ? 'الواجب' : 'الامتحان'} من الملفات ✅`,
      `عدد الأسئلة المضافة تقريباً: ${parsed.length || session.context.extracted_question_count || 0}`,
      `راجع من: ${reviewUrl}`,
      '',
      'لو كله تمام ابعت «انشر».',
    ].join('\n'),
    session: updated,
  };
}

export async function publishDraftExam(
  session: ExamAssistantSessionRow,
): Promise<{ reply: string; session: ExamAssistantSessionRow }> {
  if (!session.draft_exam_id || !session.draft_exam_kind) {
    throw new Error('مفيش مسودة امتحان جاهزة للنشر');
  }

  if (session.draft_exam_kind === 'course-exam') {
    await CourseLevelExamsService.updateExam(session.draft_exam_id, {
      id: session.teacher_id,
      role: 'teacher',
    }, { isVisibleToStudents: true });
  } else {
    await pool.query(
      `UPDATE exams SET is_visible = TRUE WHERE id = $1 AND created_by = $2`,
      [session.draft_exam_id, session.teacher_id],
    );
  }

  const updated = await ExamAssistantSessionStore.update(session.id, session.teacher_id, {
    state: 'PUBLISHED',
    status: 'completed',
    context: { ...session.context, publish_confirmed: true },
  });

  return {
    reply: [
      'تم نشر الامتحان للطلاب بنجاح ✅',
      session.context.review_url ? `الرابط: ${session.context.review_url}` : null,
      '',
      'لو عايز تبدأ امتحان جديد ابعت طلبك.',
    ]
      .filter(Boolean)
      .join('\n'),
    session: updated,
  };
}

export async function cancelWorkflow(
  session: ExamAssistantSessionRow,
): Promise<{ reply: string; session: ExamAssistantSessionRow }> {
  const updated = await ExamAssistantSessionStore.update(session.id, session.teacher_id, {
    state: 'CANCELLED',
    status: 'cancelled',
  });
  return {
    reply: 'تم إلغاء تجهيز الامتحان. المسودة السابقة (إن وُجدت) محفوظة ومش اتنشرت. ابعت طلب جديد وقت ما تحب.',
    session: updated,
  };
}

export function detectSourceType(text: string): ExamAssistantSourceType | null {
  const t = text.toLowerCase();
  if (/(بنك|البنك|من البنك)/.test(t)) return 'question_bank';
  if (/(ملف|ملفات|صور|صورة|pdf|من الملف)/.test(t)) return 'files';
  return null;
}

export function detectExamType(text: string): ExamAssistantExamType | null {
  const t = text.trim().toLowerCase();
  if (/(شامل|كورس|comprehensive)/.test(t) || t === '3') return 'comprehensive';
  if (/(واجب|homework|assignment)/.test(t) || t === '2') return 'assignment';
  if (/(عام|محاضرة|lecture|exam)/.test(t) || t === '1') return 'general';
  return null;
}

export function isAffirmative(text: string): boolean {
  const t = text.trim().toLowerCase();
  return /^(ماشي|تمام|أيوه|ايوه|اه|آه|نعم|موافق|اعمل|اعمله|كمل|يلا|انشر|موافق على النشر|كله صح|كويس|الامتحان كويس)(?:\s|$|!|\.|،)/.test(
    t,
  ) || ['ok', 'yes', 'y'].includes(t);
}

export function isCancel(text: string): boolean {
  const t = text.trim().toLowerCase();
  return /^(إلغاء|الغاء|الغي|ألغي|وقف|ابطال|cancel)/.test(t);
}

export function isDoneSendingFiles(text: string): boolean {
  const t = text.trim().toLowerCase();
  return /^(خلصت|خلّصت|انتهيت|كفاية|خلاص كده|done)/.test(t);
}

export function isNewExamRequest(text: string): boolean {
  return /(امتحان|واجب|أسئلة|اسئلة|اختبار)/.test(text) && /(اعمل|أنشئ|انشئ|عايز|محتاج|جهز|جهّز)/.test(text);
}
