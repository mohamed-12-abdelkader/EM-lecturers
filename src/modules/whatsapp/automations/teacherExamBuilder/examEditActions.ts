import pool from '../../../../db/pool';
import { ExamFlowService } from '../../../../services/examFlow';
import { CourseLevelExamQuestionsService } from '../../../../services/courseLevelExamQuestions';
import { QuestionsManagementService } from '../../../../services/questionsManagement';
import { ExamAssistantSessionStore } from './sessionStore';
import type { ExamAssistantSessionContext, ExamAssistantSessionRow } from './types';
import { generateFromBank } from './workflowActions';

type ExamKind = 'lecture-exam' | 'course-exam';

type OrderedQuestion = {
  id: number;
  index: number;
  text: string;
  grade: number;
};

function trackExamInContext(
  context: ExamAssistantSessionContext,
  examId: number,
  kind: ExamKind,
): ExamAssistantSessionContext {
  const recent = Array.isArray(context.recent_exam_ids) ? [...context.recent_exam_ids] : [];
  const filtered = recent.filter((e) => !(e.id === examId && e.kind === kind));
  filtered.unshift({ id: examId, kind, at: new Date().toISOString() });
  return {
    ...context,
    active_exam_id: examId,
    active_exam_kind: kind,
    recent_exam_ids: filtered.slice(0, 5),
  };
}

export function withTrackedExam(
  context: ExamAssistantSessionContext,
  examId: number,
  kind: ExamKind,
): ExamAssistantSessionContext {
  return trackExamInContext(context, examId, kind);
}

export function resolveEditableExam(session: ExamAssistantSessionRow): {
  examId: number;
  kind: ExamKind;
} | null {
  if (session.draft_exam_id && session.draft_exam_kind) {
    return { examId: session.draft_exam_id, kind: session.draft_exam_kind };
  }
  if (session.context.active_exam_id && session.context.active_exam_kind) {
    return {
      examId: Number(session.context.active_exam_id),
      kind: session.context.active_exam_kind,
    };
  }
  const recent = session.context.recent_exam_ids?.[0];
  if (recent?.id && recent.kind) {
    return { examId: Number(recent.id), kind: recent.kind };
  }
  return null;
}

async function assertTeacherOwnsExam(
  teacherId: number,
  examId: number,
  kind: ExamKind,
): Promise<void> {
  if (kind === 'course-exam') {
    const res = await pool.query(
      `SELECT e.id
       FROM course_level_exams e
       LEFT JOIN courses c ON c.id = e.course_id
       WHERE e.id = $1 AND COALESCE(e.teacher_id, c.teacher_id) = $2`,
      [examId, teacherId],
    );
    if (!res.rowCount) throw new Error('الامتحان غير موجود أو مش تبع حسابك');
    return;
  }
  const res = await pool.query(
    `SELECT e.id
     FROM exams e
     LEFT JOIN lectures l ON l.id = e.lecture_id
     LEFT JOIN courses c ON c.id = l.course_id
     WHERE e.id = $1 AND (e.created_by = $2 OR c.teacher_id = $2)`,
    [examId, teacherId],
  );
  if (!res.rowCount) throw new Error('الامتحان غير موجود أو مش تبع حسابك');
}

async function listOrderedQuestions(
  teacherId: number,
  examId: number,
  kind: ExamKind,
): Promise<OrderedQuestion[]> {
  await assertTeacherOwnsExam(teacherId, examId, kind);
  if (kind === 'course-exam') {
    const res = await pool.query(
      `SELECT id, question_text, points
       FROM course_level_exam_questions
       WHERE exam_id = $1
       ORDER BY id ASC`,
      [examId],
    );
    return res.rows.map((r, i) => ({
      id: Number(r.id),
      index: i + 1,
      text: String(r.question_text || '').slice(0, 120),
      grade: Number(r.points || 1),
    }));
  }
  const res = await pool.query(
    `SELECT
       eq.id,
       COALESCE(NULLIF(eq.question_text, ''), q.text, q2.question_text, '') AS question_text,
       COALESCE(eq.grade, 1) AS grade
     FROM exam_questions eq
     LEFT JOIN questions q ON eq.question_id = q.id
     LEFT JOIN questions_v2 q2 ON eq.question_id_v2 = q2.id
     WHERE eq.exam_id = $1
     ORDER BY eq.id ASC`,
    [examId],
  );
  return res.rows.map((r, i) => ({
    id: Number(r.id),
    index: i + 1,
    text: String(r.question_text || '').slice(0, 120),
    grade: Number(r.grade || 1),
  }));
}

function parseQuestionIndex(text: string): number | null {
  const m =
    text.match(/(?:السؤال|سؤال)\s*(?:رقم\s*)?(\d+)/i) ||
    text.match(/(?:احذف|امسح|شيل|غير|عدّل|عدل)\s*(?:السؤال\s*)?(\d+)/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function looksDestructiveBulk(text: string): boolean {
  return /(احذف كل|امسح كل|صفّر|صفر الأسئلة|امسح الامتحان|احذف كل الأسئلة)/.test(text);
}

/**
 * Apply a natural-language edit to a real draft/published exam owned by the teacher.
 */
export async function applyDraftExamEdit(opts: {
  session: ExamAssistantSessionRow;
  message: string;
}): Promise<{ reply: string; session: ExamAssistantSessionRow; handled: boolean }> {
  const { session, message } = opts;
  const text = message.trim();
  const target = resolveEditableExam(session);

  // Before draft exists: bank proposal adjust only
  if (!target && session.exam_builder_session_id) {
    const adjusted = await generateFromBank(session, text);
    return { reply: adjusted.reply, session: adjusted.session, handled: true };
  }

  if (!target) {
    return {
      handled: true,
      session,
      reply:
        'مفيش امتحان محدد للتعديل دلوقتي.\nأنشئ امتحان الأول، أو حدّد رقم الامتحان لو عندك أكتر من واحد.',
    };
  }

  // Destructive confirmation gate
  if (looksDestructiveBulk(text) && session.context.pending_destructive_edit !== text) {
    const updated = await ExamAssistantSessionStore.mergeContext(session.id, session.teacher_id, {
      pending_destructive_edit: text,
      awaiting_clarification: true,
      last_assistant_question: 'تأكيد حذف جماعي',
    });
    return {
      handled: true,
      session: updated,
      reply:
        'الطلب ده هيأثر على أسئلة كتير.\nلو متأكد ابعت نفس الطلب تاني أو اكتب «أكد الحذف».',
    };
  }

  const confirmedDestructive =
    session.context.pending_destructive_edit &&
    (text === session.context.pending_destructive_edit || /أكد الحذف|تأكيد/.test(text));

  await assertTeacherOwnsExam(session.teacher_id, target.examId, target.kind);
  const questions = await listOrderedQuestions(session.teacher_id, target.examId, target.kind);

  // Delete question N
  if (/(احذف|امسح|شيل)/.test(text) && /(سؤال)/.test(text)) {
    const idx = parseQuestionIndex(text);
    if (!idx) {
      return {
        handled: true,
        session,
        reply: 'قولّي رقم السؤال، مثال: «احذف السؤال 3».',
      };
    }
    const q = questions.find((x) => x.index === idx);
    if (!q) {
      return {
        handled: true,
        session,
        reply: `مفيش سؤال رقم ${idx}. الامتحان فيه ${questions.length} سؤال.`,
      };
    }
    if (target.kind === 'course-exam') {
      await CourseLevelExamQuestionsService.deleteQuestionOnExam(target.examId, q.id);
    } else {
      await ExamFlowService.removeQuestionFromExam(session.teacher_id, target.examId, q.id);
    }
    const left = questions.length - 1;
    const updated = await ExamAssistantSessionStore.update(session.id, session.teacher_id, {
      state: session.state === 'PUBLISHED' ? session.state : 'READY_TO_PUBLISH',
      context: {
        ...withTrackedExam(session.context, target.examId, target.kind),
        pending_destructive_edit: null,
        awaiting_clarification: false,
      },
    });
    return {
      handled: true,
      session: updated,
      reply: `تم حذف السؤال ${idx} ✅\nالمتبقي تقريبًا: ${left} سؤال.${session.context.review_url ? `\n${session.context.review_url}` : ''}`,
    };
  }

  // Change grade of question N
  const gradeMatch = text.match(/(?:درجة|درجات)\s*(?:السؤال\s*)?(\d+)\s*(?:تبقى|تبقى|تبقى|=|تبقى)?\s*(\d+)/i)
    || text.match(/(?:خلي|اجعل)\s*(?:درجة\s*)?(?:السؤال\s*)?(\d+)\s*(?:بـ|ب|=)?\s*(\d+)/i);
  if (gradeMatch) {
    const idx = Number(gradeMatch[1]);
    const grade = Number(gradeMatch[2]);
    const q = questions.find((x) => x.index === idx);
    if (!q || !Number.isFinite(grade) || grade <= 0) {
      return { handled: true, session, reply: 'صيغة الدرجة مش واضحة. مثال: «درجة السؤال 2 تبقى 5».' };
    }
    if (target.kind === 'course-exam') {
      await pool.query(
        `UPDATE course_level_exam_questions SET points = $1 WHERE id = $2 AND exam_id = $3`,
        [grade, q.id, target.examId],
      );
    } else {
      await pool.query(`UPDATE exam_questions SET grade = $1 WHERE id = $2 AND exam_id = $3`, [
        grade,
        q.id,
        target.examId,
      ]);
    }
    return {
      handled: true,
      session,
      reply: `تم تعديل درجة السؤال ${idx} إلى ${grade} ✅`,
    };
  }

  // Change correct answer for question N (A/B/C/D)
  const ansMatch = text.match(
    /(?:الإجابة الصحيحة|الاجابة الصحيحة|الإجابة|الاجابة)\s*(?:للسؤال\s*|السؤال\s*)?(\d+)\s*(?:تبقى|تبقى|=|هي)?\s*([ABCDأبجد])/i,
  );
  if (ansMatch && target.kind === 'course-exam') {
    const idx = Number(ansMatch[1]);
    const letterRaw = ansMatch[2];
    const map: Record<string, 'A' | 'B' | 'C' | 'D'> = {
      A: 'A',
      B: 'B',
      C: 'C',
      D: 'D',
      أ: 'A',
      ب: 'B',
      ج: 'C',
      د: 'D',
    };
    const letter = map[letterRaw.toUpperCase()] || map[letterRaw];
    const q = questions.find((x) => x.index === idx);
    if (!q || !letter) {
      return { handled: true, session, reply: 'مثال: «الإجابة الصحيحة للسؤال 4 تبقى B».' };
    }
    await CourseLevelExamQuestionsService.setCorrectAnswersOnExam(target.examId, q.id, [letter]);
    return {
      handled: true,
      session,
      reply: `تم تعديل الإجابة الصحيحة للسؤال ${idx} إلى ${letter} ✅`,
    };
  }

  // Add extracted bulk text already on session
  if (/(ضيف|أضف|زود أسئلة|زود الاسئلة)/.test(text) && session.context.extracted_bulk_text) {
    const added = await addBulkTextToExam({
      session,
      examId: target.examId,
      kind: target.kind,
      bulkText: session.context.extracted_bulk_text,
    });
    return { handled: true, ...added };
  }

  // Soft regenerate via bank adjust when no draft ops matched but bank session exists
  if (session.exam_builder_session_id && /(أصعب|أسهل|زود|قلل|نوّع|نوع|استبدل|غير صياغة)/.test(text)) {
    const adjusted = await generateFromBank(
      {
        ...session,
        state: 'MODIFYING_EXAM',
      },
      text,
    );
    return {
      handled: true,
      reply:
        adjusted.reply +
        '\n\nملاحظة: التعديل على اقتراح البنك. لو عايز يطبّق على المسودة المنشورة/المسودة الحالية قولّي بعد الموافقة.',
      session: adjusted.session,
    };
  }

  if (confirmedDestructive || looksDestructiveBulk(text)) {
    return {
      handled: true,
      session: await ExamAssistantSessionStore.mergeContext(session.id, session.teacher_id, {
        pending_destructive_edit: null,
      }),
      reply:
        'عشان الأمان مش بمسح كل الأسئلة دفعة واحدة من واتساب.\nاحذف سؤال برقم محدد، أو عدّل من رابط المراجعة على المنصة.',
    };
  }

  // Fallback: try bank adjust if available
  if (session.exam_builder_session_id) {
    const adjusted = await generateFromBank(session, text);
    return { reply: adjusted.reply, session: adjusted.session, handled: true };
  }

  const preview = questions
    .slice(0, 5)
    .map((q) => `${q.index}) ${q.text || '(بدون نص)'}`)
    .join('\n');

  return {
    handled: true,
    session: await ExamAssistantSessionStore.update(session.id, session.teacher_id, {
      state: 'MODIFYING_EXAM',
      context: withTrackedExam(session.context, target.examId, target.kind),
    }),
    reply: [
      `الامتحان الحالي (#${target.examId}) فيه ${questions.length} سؤال.`,
      preview ? `أول أسئلة:\n${preview}` : '',
      '',
      'أمثلة تعديلات:',
      '• احذف السؤال 3',
      '• درجة السؤال 2 تبقى 5',
      '• الإجابة الصحيحة للسؤال 1 تبقى B',
      '• ضيف الأسئلة المستخرجة من الملف',
      session.context.review_url ? `\nالمراجعة: ${session.context.review_url}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
  };
}

export async function addBulkTextToExam(opts: {
  session: ExamAssistantSessionRow;
  examId: number;
  kind: ExamKind;
  bulkText: string;
}): Promise<{ reply: string; session: ExamAssistantSessionRow }> {
  const { session, examId, kind, bulkText } = opts;
  await assertTeacherOwnsExam(session.teacher_id, examId, kind);
  const { mapExtractedQuestionsToExamPayload } = await import('./workflowActions.js');
  const structured = mapExtractedQuestionsToExamPayload(
    Array.isArray(session.context.extracted_questions)
      ? (session.context.extracted_questions as any[])
      : [],
  );
  const parsed =
    structured.length > 0
      ? structured
      : CourseLevelExamQuestionsService.parseBulkQuestionText(bulkText);
  if (!parsed.length) {
    return {
      reply: 'مقدرتش أحوّل النص المستخرج لأسئلة قابلة للإضافة.',
      session,
    };
  }

  let imported = 0;
  if (kind === 'course-exam') {
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
        questionImage: p.questionImage ?? null,
        passageText: p.passageText ?? null,
        passageTitle: p.passageTitle ?? null,
      })),
    );
    imported = Array.isArray(created) ? created.length : parsed.length;
  } else {
    await QuestionsManagementService.createBulkQuestionsForLectureExamFromParsed(
      examId,
      session.teacher_id,
      parsed.map((p: any) => ({
        questionText: p.questionText,
        optionA: p.optionA,
        optionB: p.optionB,
        optionC: p.optionC,
        optionD: p.optionD,
        correctAnswer: (p.correctAnswer || 'A') as 'A' | 'B' | 'C' | 'D',
        questionImage: p.questionImage ?? null,
      })),
    );
    imported = parsed.length;
  }

  const updated = await ExamAssistantSessionStore.update(session.id, session.teacher_id, {
    state: session.status === 'completed' ? session.state : 'READY_TO_PUBLISH',
    draft_exam_id: examId,
    draft_exam_kind: kind,
    context: {
      ...withTrackedExam(session.context, examId, kind),
      extracted_bulk_text: null,
      pending_media_intent: null,
    },
  });

  return {
    session: updated,
    reply: `تمت إضافة حوالي ${imported} سؤال للامتحان #${examId} ✅${session.context.review_url ? `\n${session.context.review_url}` : ''}`,
  };
}

/** Review-only extraction summary without creating an exam. */
export async function replyReviewExtracted(session: ExamAssistantSessionRow): Promise<{
  reply: string;
  session: ExamAssistantSessionRow;
}> {
  const count = session.context.extracted_question_count || 0;
  const sample = String(session.context.extracted_bulk_text || '')
    .split(/\n\n+/)
    .slice(0, 3)
    .join('\n\n')
    .slice(0, 900);
  const updated = await ExamAssistantSessionStore.mergeContext(session.id, session.teacher_id, {
    pending_media_intent: null,
  });
  return {
    session: updated,
    reply: [
      `راجعت الملف: لقيت حوالي ${count} سؤال.`,
      sample ? `\nعيّنة:\n${sample}` : '',
      '',
      'تحب أعمل منهم امتحان، ولا أضيفهم على امتحان حالي؟',
    ]
      .filter(Boolean)
      .join('\n'),
  };
}
