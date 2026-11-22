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

export async function listTeacherGrades(teacherId: number) {
  const res = await pool.query(
    `SELECT g.id, g.name
     FROM teacher_grades tg
     JOIN grades g ON g.id = tg.grade_id
     WHERE tg.teacher_id = $1
     ORDER BY g.name ASC
     LIMIT 40`,
    [teacherId],
  );
  return res.rows.map((r) => ({ id: Number(r.id), name: String(r.name || `صف ${r.id}`) }));
}

export async function listTeacherCourses(teacherId: number, gradeId?: number | null) {
  const params: unknown[] = [teacherId];
  let gradeSql = '';
  if (gradeId != null && Number.isFinite(Number(gradeId))) {
    params.push(Number(gradeId));
    gradeSql = ` AND (
      c.grade_id = $2
      OR EXISTS (
        SELECT 1 FROM course_grades cg
        WHERE cg.course_id = c.id AND cg.grade_id = $2
      )
    )`;
  }
  const res = await pool.query(
    `SELECT c.id, c.title, c.grade_id
     FROM courses c
     WHERE c.teacher_id = $1 AND COALESCE(c.is_visible, true) = true
     ${gradeSql}
     ORDER BY c.title ASC
     LIMIT 40`,
    params,
  );
  return res.rows.map((r) => ({
    id: Number(r.id),
    title: String(r.title),
    grade_id: r.grade_id != null ? Number(r.grade_id) : null,
  }));
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
}): Promise<
  | { ok: true; filePath: string; mime: string; size: number }
  | { ok: false; reply: string; kind: string }
> {
  const { validateDecodedMediaBuffer } = await import('./mediaErrors.js');
  await fs.promises.mkdir(UPLOAD_DIR, { recursive: true });
  const mime = (opts.media.mimetype || 'application/octet-stream').toLowerCase();
  let buffer: Buffer;
  try {
    buffer = Buffer.from(opts.media.data || '', 'base64');
  } catch {
    return {
      ok: false,
      kind: 'corrupt',
      reply: 'الملف تالف أو غير قابل للقراءة.\nابعت نسخة تانية.',
    };
  }
  const validated = validateDecodedMediaBuffer({ buffer, mimetype: mime });
  if (!validated.ok) {
    return { ok: false, kind: validated.kind, reply: validated.reply };
  }

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
  return { ok: true, filePath, mime, size: buffer.length };
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

/** Same composition rules as the OCR tool frontend (composeOcrQuestionText). */
export function composeExtractedQuestionText(q: any): string {
  const blocks = Array.isArray(q?.display_blocks)
    ? q.display_blocks.filter((b: any) => String(b?.text ?? '').trim())
    : [];
  if (blocks.length) {
    return blocks.map((b: any) => String(b.text).trim()).join('\n\n');
  }
  const structured = [q?.intro_text, q?.stimulus_text, q?.prompt_text]
    .map((t) => String(t ?? '').trim())
    .filter(Boolean);
  if (structured.length) return structured.join('\n\n');

  let text = String(q?.question_text ?? q?.text ?? q?.stem ?? '').trim();
  const verses = Array.isArray(q?.verses) ? q.verses : [];
  if (!text && verses.length) {
    text = verses
      .map((v: any) => {
        const a = String(v?.firstHemistich ?? '').trim();
        const b = String(v?.secondHemistich ?? '').trim();
        if (!a && !b) return '';
        if (a && b) return `${a} . : ${b}`;
        return a || b;
      })
      .filter(Boolean)
      .join('\n');
  }
  return text;
}

function resolveExtractedCorrectLetter(q: any, optionTexts: string[]): 'A' | 'B' | 'C' | 'D' {
  const letters: Array<'A' | 'B' | 'C' | 'D'> = ['A', 'B', 'C', 'D'];
  if (
    Number.isInteger(q?.correct_answer_index) &&
    q.correct_answer_index >= 0 &&
    q.correct_answer_index < optionTexts.length
  ) {
    return letters[Math.min(q.correct_answer_index, 3)]!;
  }
  const raw = String(q?.correct_answer ?? '').trim();
  if (!raw) return 'A';
  const upper = raw.toUpperCase();
  if (['A', 'B', 'C', 'D'].includes(upper)) return upper as 'A' | 'B' | 'C' | 'D';
  const arMap: Record<string, 'A' | 'B' | 'C' | 'D'> = {
    أ: 'A',
    ا: 'A',
    ب: 'B',
    ج: 'C',
    د: 'D',
  };
  if (arMap[raw]) return arMap[raw]!;
  const opts = Array.isArray(q?.options) ? q.options : [];
  const byLabel = opts.findIndex(
    (o: any) => String(o?.label ?? '').trim().toLowerCase() === raw.toLowerCase(),
  );
  if (byLabel >= 0 && byLabel < 4) return letters[byLabel]!;
  const byText = optionTexts.findIndex((t) => t === raw);
  if (byText >= 0 && byText < 4) return letters[byText]!;
  return 'A';
}

function firstQuestionImageUrl(q: any): string | null {
  const imgs = Array.isArray(q?.question_images) ? q.question_images : [];
  for (const img of imgs) {
    const url = typeof img?.image_url === 'string' ? img.image_url.trim() : '';
    if (url && url !== 'null') return url;
  }
  if (typeof q?.image_url === 'string' && q.image_url.trim()) return q.image_url.trim();
  return null;
}

/**
 * Map Mistral extraction questions to exam bulk payload — keep parity with the OCR tool.
 */
export function mapExtractedQuestionsToExamPayload(questions: any[]): Array<{
  questionText: string;
  optionA: string;
  optionB: string;
  optionC: string;
  optionD: string;
  correctAnswer: 'A' | 'B' | 'C' | 'D';
  questionImage: string | null;
  passageText: string | null;
  passageTitle: string | null;
}> {
  const out: Array<{
    questionText: string;
    optionA: string;
    optionB: string;
    optionC: string;
    optionD: string;
    correctAnswer: 'A' | 'B' | 'C' | 'D';
    questionImage: string | null;
    passageText: string | null;
    passageTitle: string | null;
  }> = [];

  for (const q of questions || []) {
    const questionText = composeExtractedQuestionText(q);
    const opts = Array.isArray(q?.options) ? q.options : [];
    const optionTexts = opts
      .map((o: any) => (typeof o === 'string' ? o : String(o?.text ?? '').trim()))
      .filter((t: string) => t.length > 0);

    // Image-only / essay-like: keep image even if options missing
    const questionImage = firstQuestionImageUrl(q);
    if (!questionText && !questionImage) continue;

    // Pad to 4 options for exam schemas that require A–D
    const padded = [...optionTexts];
    while (padded.length < 4) padded.push(padded.length === 0 ? '—' : `خيار ${padded.length + 1}`);
    const optionA = padded[0]!;
    const optionB = padded[1]!;
    const optionC = padded[2]!;
    const optionD = padded[3]!;

    out.push({
      questionText: questionText || (questionImage ? 'انظر الصورة' : 'سؤال'),
      optionA,
      optionB,
      optionC,
      optionD,
      correctAnswer: resolveExtractedCorrectLetter(q, optionTexts),
      questionImage,
      passageText:
        typeof q?.passage_text === 'string' && q.passage_text.trim()
          ? q.passage_text.trim()
          : null,
      passageTitle:
        typeof q?.passage_title === 'string' && q.passage_title.trim()
          ? q.passage_title.trim()
          : null,
    });
  }
  return out;
}

function extractedToBulkText(questions: any[]): string {
  const mapped = mapExtractedQuestionsToExamPayload(questions);
  return mapped
    .map((q, idx) => {
      const lines = [
        `${idx + 1}- ${q.questionText}`,
        `a. ${q.optionA}`,
        `b. ${q.optionB}`,
        `c. ${q.optionC}`,
        `d. ${q.optionD}`,
      ];
      return lines.join('\n');
    })
    .join('\n\n');
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

  // Same options as the OCR extract-questions tool for parity.
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

  const mapped = mapExtractedQuestionsToExamPayload(questions);
  const bulkText = extractedToBulkText(questions);
  const count = mapped.length;
  // Persist structured questions (URLs only — no huge base64) for faithful import.
  const slimQuestions = questions.map((q: any) => ({
    number: q?.number,
    question_text: q?.question_text,
    intro_text: q?.intro_text,
    stimulus_text: q?.stimulus_text,
    prompt_text: q?.prompt_text,
    display_blocks: q?.display_blocks,
    verses: q?.verses,
    poetry: q?.poetry,
    options: q?.options,
    correct_answer: q?.correct_answer,
    correct_answer_index: q?.correct_answer_index,
    passage_id: q?.passage_id,
    passage_text: q?.passage_text,
    passage_title: q?.passage_title,
    question_images: Array.isArray(q?.question_images)
      ? q.question_images.map((img: any) => ({
          image_id: img?.image_id,
          image_url: img?.image_url,
          short_description: img?.short_description,
        }))
      : [],
  }));

  const updated = await ExamAssistantSessionStore.update(session.id, session.teacher_id, {
    state: count > 0 ? 'EXAM_REVIEW' : 'FAILED',
    source_type: 'files',
    last_error: count > 0 ? null : 'لم يتم استخراج أسئلة من الملفات',
    context: {
      ...session.context,
      extracted_question_count: count,
      extracted_bulk_text: bulkText || null,
      extracted_questions: slimQuestions,
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
      const { withTrackedExam } = await import('./examEditActions.js');
      const updated = await ExamAssistantSessionStore.update(session.id, session.teacher_id, {
        state: 'READY_TO_PUBLISH',
        draft_exam_id: examId,
        draft_exam_kind: 'course-exam',
        context: {
          ...withTrackedExam(session.context, examId, 'course-exam'),
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
          'لو عايز تعديل قول مثلاً: «احذف السؤال 3».',
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
    const { withTrackedExam: trackLecture } = await import('./examEditActions.js');
    const updated = await ExamAssistantSessionStore.update(session.id, session.teacher_id, {
      state: 'READY_TO_PUBLISH',
      draft_exam_id: examId,
      draft_exam_kind: 'lecture-exam',
      context: {
        ...trackLecture(session.context, examId, 'lecture-exam'),
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
        'للتعديل: «احذف السؤال 3» أو «درجة السؤال 1 تبقى 2».',
      ].join('\n'),
      session: updated,
    };
  }

  // Files path: create draft then import structured extraction (same as OCR tool quality)
  const structured = mapExtractedQuestionsToExamPayload(
    Array.isArray(session.context.extracted_questions)
      ? (session.context.extracted_questions as any[])
      : [],
  );
  const bulkText = session.context.extracted_bulk_text;
  if (!structured.length && !bulkText) throw new Error('لا يوجد نص أسئلة مستخرج');

  if (examType === 'comprehensive') {
    if (!opts.courseId) throw new Error('course_id مطلوب');
    const exam = await CourseLevelExamsService.createExam(
      { id: session.teacher_id, role: 'teacher' },
      {
        title,
        courseId: opts.courseId,
        durationMinutes: opts.durationMinutes ?? session.context.duration_minutes ?? 30,
        questionsCount: structured.length || session.context.extracted_question_count || 1,
        isVisibleToStudents: false,
        visibilityEndDate: null,
        showAnswersImmediately: true,
        answersVisibleAt: null,
        isActive: true,
      },
    );
    const examId = Number(exam.id);
    const { CourseLevelExamQuestionsService } = await import(
      '../../../../services/courseLevelExamQuestions.js'
    );
    let imported = 0;
    const payload =
      structured.length > 0
        ? structured
        : CourseLevelExamQuestionsService.parseBulkQuestionText(String(bulkText || '')).map(
            (p: any) => ({
              questionText: p.questionText,
              optionA: p.optionA,
              optionB: p.optionB,
              optionC: p.optionC,
              optionD: p.optionD,
              correctAnswer: (p.correctAnswer || 'A') as 'A' | 'B' | 'C' | 'D',
              questionImage: null,
              passageText: null,
              passageTitle: null,
            }),
          );
    if (payload.length) {
      try {
        const created = await CourseLevelExamQuestionsService.createTextQuestionsBulk(
          { id: session.teacher_id, role: 'teacher' },
          examId,
          payload,
        );
        imported = Array.isArray(created) ? created.length : payload.length;
      } catch (err: any) {
        console.error('course exam import from extraction failed:', err?.message || err);
        imported = 0;
      }
    }
    const reviewUrl = buildCourseExamReviewUrl(examId);
    const { withTrackedExam: trackCourseFiles } = await import('./examEditActions.js');
    const updated = await ExamAssistantSessionStore.update(session.id, session.teacher_id, {
      state: 'READY_TO_PUBLISH',
      draft_exam_id: examId,
      draft_exam_kind: 'course-exam',
      context: {
        ...trackCourseFiles(session.context, examId, 'course-exam'),
        exam_type: examType,
        target_course_id: opts.courseId,
        review_url: reviewUrl,
      },
    });
    return {
      reply: [
        'تم إنشاء مسودة الامتحان الشامل من الملفات ✅',
        `الأسئلة المستخرجة: ${session.context.extracted_question_count || payload.length}`,
        imported > 0 ? `تم استيراد ${imported} سؤال تلقائياً (مع الصور إن وُجدت).` : 'راجع الأسئلة على المنصة وأكمل الاستيراد إن لزم.',
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
  const lecturePayload =
    structured.length > 0
      ? structured
      : CourseLevelExamQuestionsService.parseBulkQuestionText(String(bulkText || ''));
  if (lecturePayload.length) {
    await QuestionsManagementService.createBulkQuestionsForLectureExamFromParsed(
      examId,
      session.teacher_id,
      lecturePayload.map((p: any) => ({
        questionText: p.questionText,
        optionA: p.optionA,
        optionB: p.optionB,
        optionC: p.optionC,
        optionD: p.optionD,
        correctAnswer: (p.correctAnswer || 'A') as 'A' | 'B' | 'C' | 'D',
        questionImage: p.questionImage ?? null,
      })),
    );
  }
  const reviewUrl = buildLectureExamReviewUrl(examId);
  const { withTrackedExam: trackLectureFiles } = await import('./examEditActions.js');
  const updated = await ExamAssistantSessionStore.update(session.id, session.teacher_id, {
    state: 'READY_TO_PUBLISH',
    draft_exam_id: examId,
    draft_exam_kind: 'lecture-exam',
    context: {
      ...trackLectureFiles(session.context, examId, 'lecture-exam'),
      exam_type: examType,
      target_lecture_id: opts.lectureId,
      review_url: reviewUrl,
    },
  });
  return {
    reply: [
      `تم إنشاء مسودة ${examType === 'assignment' ? 'الواجب' : 'الامتحان'} من الملفات ✅`,
      `عدد الأسئلة المضافة تقريباً: ${lecturePayload.length || session.context.extracted_question_count || 0}`,
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

  const kind = session.draft_exam_kind;
  const examId = session.draft_exam_id;
  const { withTrackedExam } = await import('./examEditActions.js');
  const ctx =
    examId && kind
      ? withTrackedExam({ ...session.context, publish_confirmed: true }, examId, kind)
      : { ...session.context, publish_confirmed: true };
  const updated = await ExamAssistantSessionStore.update(session.id, session.teacher_id, {
    state: 'PUBLISHED',
    status: 'completed',
    context: ctx,
  });

  return {
    reply: [
      'تم نشر الامتحان للطلاب بنجاح ✅',
      session.context.review_url ? `الرابط: ${session.context.review_url}` : null,
      '',
      'لو عايز تعدّل عليه قولّي، أو ابدأ امتحان جديد.',
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
