import { ExamAssistantSessionStore } from './sessionStore';
import type { ExamAssistantSessionRow } from './types';
import {
  createDraftExamFromWorkflow,
  detectExamType,
  extractQuestionsFromSessionFiles,
  generateFromBank,
  listCourseLectures,
  listTeacherCourses,
  listTeacherGrades,
  searchLessons,
} from './workflowActions';
import {
  addBulkTextToExam,
  replyReviewExtracted,
  resolveEditableExam,
} from './examEditActions';

function formatChoices(items: Array<{ label: string }>): string {
  return items.map((it, i) => `${i + 1}) ${it.label}`).join('\n');
}

function pickByNumberOrName<T extends { id: number; name?: string; title?: string }>(
  text: string,
  items: T[],
): T | null {
  const n = Number(text.trim());
  if (Number.isFinite(n) && n >= 1 && n <= items.length) return items[n - 1]!;
  const q = text.trim().toLowerCase();
  if (!q) return null;
  return (
    items.find((it) => String(it.name || it.title || '').toLowerCase().includes(q)) || null
  );
}

export async function startGuidedExamIntake(
  session: ExamAssistantSessionRow,
  teacherId: number,
): Promise<{ reply: string; session: ExamAssistantSessionRow; choices?: string[] }> {
  const grades = await listTeacherGrades(teacherId);
  if (!grades.length) {
    const updated = await ExamAssistantSessionStore.update(session.id, teacherId, {
      state: 'ASK_SOURCE',
      context: { ...session.context, channel: session.context.channel || null },
    });
    return {
      session: updated,
      reply:
        'ماشي نبدأ امتحان.\nمفيش صفوف مربوطة ظاهرًا — تحب الامتحان من *بنك الأسئلة* ولا من *ملف/صور* عندك؟',
      choices: ['من بنك الأسئلة', 'من ملف أو صور'],
    };
  }

  const updated = await ExamAssistantSessionStore.update(session.id, teacherId, {
    state: 'ASK_GRADE',
    context: { ...session.context, grade_candidates: grades },
  });
  return {
    session: updated,
    reply: `تمام، نبدأ تجهيز الامتحان خطوة بخطوة.\n\nأولًا: الامتحان لـ *أنهي صف*؟\n${formatChoices(grades.map((g) => ({ label: g.name })))}`,
    choices: grades.map((g) => g.name),
  };
}

export async function handleAskGrade(
  session: ExamAssistantSessionRow,
  teacherId: number,
  text: string,
): Promise<{ reply: string; session: ExamAssistantSessionRow; choices?: string[] }> {
  const grades = session.context.grade_candidates?.length
    ? session.context.grade_candidates
    : await listTeacherGrades(teacherId);
  const chosen = pickByNumberOrName(text, grades.map((g) => ({ ...g, title: g.name })));
  if (!chosen) {
    return {
      session,
      reply: `اختار الصف من القائمة:\n${formatChoices(grades.map((g) => ({ label: g.name })))}`,
      choices: grades.map((g) => g.name),
    };
  }

  const courses = await listTeacherCourses(teacherId, chosen.id);
  const updated = await ExamAssistantSessionStore.update(session.id, teacherId, {
    state: 'ASK_COURSE',
    context: {
      ...session.context,
      grade_id: chosen.id,
      grade_name: chosen.name,
      grade_candidates: grades,
      course_candidates: courses,
    },
  });

  if (!courses.length) {
    return {
      session: updated,
      reply: `صف *${chosen.name}* مختار، لكن مفيش كورسات ظاهرة عليه.\nاربط كورس بالصف من المنصة، أو اختار صف تاني.`,
      choices: grades.map((g) => g.name),
    };
  }

  return {
    session: updated,
    reply: `تمام، صف *${chosen.name}*.\nالامتحان على *أنهي كورس*؟\n${formatChoices(courses.map((c) => ({ label: c.title })))}`,
    choices: courses.map((c) => c.title),
  };
}

export async function handleAskCourse(
  session: ExamAssistantSessionRow,
  teacherId: number,
  text: string,
): Promise<{ reply: string; session: ExamAssistantSessionRow; choices?: string[] }> {
  const courses =
    session.context.course_candidates?.length
      ? session.context.course_candidates
      : await listTeacherCourses(teacherId, session.context.grade_id);
  const chosen = pickByNumberOrName(
    text,
    courses.map((c) => ({ id: c.id, name: c.title, title: c.title })),
  );
  if (!chosen) {
    return {
      session,
      reply: `اختار الكورس:\n${formatChoices(courses.map((c) => ({ label: c.title })))}`,
      choices: courses.map((c) => c.title),
    };
  }

  const updated = await ExamAssistantSessionStore.update(session.id, teacherId, {
    state: 'SELECT_EXAM_TYPE',
    context: {
      ...session.context,
      target_course_id: chosen.id,
      target_course_title: chosen.name || chosen.title,
      course_candidates: courses,
    },
  });

  return {
    session: updated,
    reply: [
      `كورس *${chosen.name || chosen.title}* ✅`,
      '',
      'نوع الامتحان؟',
      '1) امتحان عام (على محاضرة)',
      '2) واجب',
      '3) امتحان شامل (على الكورس كله)',
    ].join('\n'),
    choices: ['امتحان عام', 'واجب', 'امتحان شامل'],
  };
}

export async function handleSelectExamTypeEarly(
  session: ExamAssistantSessionRow,
  teacherId: number,
  text: string,
): Promise<{ reply: string; session: ExamAssistantSessionRow; choices?: string[] }> {
  const examType = detectExamType(text);
  if (!examType) {
    return {
      session,
      reply: 'اختار: امتحان عام، أو واجب، أو امتحان شامل.',
      choices: ['امتحان عام', 'واجب', 'امتحان شامل'],
    };
  }

  if (examType === 'comprehensive') {
    const updated = await ExamAssistantSessionStore.update(session.id, teacherId, {
      state: 'ASK_EXAM_TITLE',
      context: { ...session.context, exam_type: examType },
    });
    return {
      session: updated,
      reply: 'تمام، امتحان شامل.\nاكتب *اسم الامتحان* (العنوان اللي هيظهر للطلاب).',
    };
  }

  const courseId = session.context.target_course_id;
  if (!courseId) {
    return {
      session: await ExamAssistantSessionStore.update(session.id, teacherId, {
        state: 'ASK_COURSE',
        context: { ...session.context, exam_type: examType },
      }),
      reply: 'محتاجين نختار الكورس الأول.',
    };
  }

  const lectures = await listCourseLectures(teacherId, courseId);
  const updated = await ExamAssistantSessionStore.update(session.id, teacherId, {
    state: 'ASK_LECTURE',
    context: {
      ...session.context,
      exam_type: examType,
      lecture_candidates: lectures,
    },
  });

  if (!lectures.length) {
    return {
      session: updated,
      reply: 'مفيش محاضرات في الكورس ده. اختار كورس تاني أو اعمل امتحان شامل.',
      choices: ['امتحان شامل'],
    };
  }

  return {
    session: updated,
    reply: `${examType === 'assignment' ? 'الواجب' : 'الامتحان'} على *أنهي محاضرة*؟\n${formatChoices(
      lectures.map((l) => ({ label: l.title })),
    )}`,
    choices: lectures.map((l) => l.title),
  };
}

export async function handleAskLecture(
  session: ExamAssistantSessionRow,
  teacherId: number,
  text: string,
): Promise<{ reply: string; session: ExamAssistantSessionRow; choices?: string[] }> {
  const lectures = session.context.lecture_candidates || [];
  const chosen = pickByNumberOrName(
    text,
    lectures.map((l) => ({ id: l.id, name: l.title, title: l.title })),
  );
  if (!chosen) {
    return {
      session,
      reply: `اختار المحاضرة:\n${formatChoices(lectures.map((l) => ({ label: l.title })))}`,
      choices: lectures.map((l) => l.title),
    };
  }

  const updated = await ExamAssistantSessionStore.update(session.id, teacherId, {
    state: 'ASK_EXAM_TITLE',
    context: {
      ...session.context,
      target_lecture_id: chosen.id,
      target_lecture_title: chosen.name || chosen.title,
    },
  });

  return {
    session: updated,
    reply: `محاضرة *${chosen.name || chosen.title}* ✅\nاكتب *اسم الامتحان* (العنوان اللي هيظهر للطلاب).`,
  };
}

export async function handleAskExamTitle(
  session: ExamAssistantSessionRow,
  teacherId: number,
  text: string,
): Promise<{ reply: string; session: ExamAssistantSessionRow; choices?: string[] }> {
  const title = text.trim().replace(/^["«]|["»]$/g, '').slice(0, 200);
  if (title.length < 2) {
    return {
      session,
      reply: 'اكتب اسم أوضح للامتحان، مثال: امتحان أولى ثانوي — الباب الأول',
    };
  }
  const updated = await ExamAssistantSessionStore.update(session.id, teacherId, {
    state: 'ASK_EXAM_SETTINGS',
    context: { ...session.context, exam_title: title },
  });
  return {
    session: updated,
    reply: `اسم الامتحان: *${title}* ✅\nقولّي الإعدادات: كام سؤال؟ ومدة الامتحان كام دقيقة؟\nمثال: 15 سؤال، 30 دقيقة`,
  };
}

export async function handleAskExamSettings(
  session: ExamAssistantSessionRow,
  teacherId: number,
  text: string,
): Promise<{ reply: string; session: ExamAssistantSessionRow; choices?: string[] }> {
  const countMatch = text.match(/(\d+)\s*سؤال/);
  const durationMatch = text.match(/(\d+)\s*(دقيقة|دقايق|د)/);
  const questionCount = countMatch
    ? Number(countMatch[1])
    : Number(text.match(/\b(\d+)\b/)?.[1]);
  const duration = durationMatch
    ? Number(durationMatch[1])
    : session.context.duration_minutes || 30;
  const qCount = Number.isFinite(questionCount) && questionCount > 0 ? questionCount : 10;

  const updated = await ExamAssistantSessionStore.update(session.id, teacherId, {
    state: 'ASK_SOURCE',
    context: {
      ...session.context,
      question_count: qCount,
      duration_minutes: duration,
      exam_title:
        session.context.exam_title ||
        (session.context.target_lecture_title
          ? `امتحان ${session.context.target_lecture_title}`
          : session.context.target_course_title
            ? `امتحان ${session.context.target_course_title}`
            : 'امتحان من المساعد'),
    },
  });

  return {
    session: updated,
    reply: [
      `تم: ${qCount} سؤال · ${duration} دقيقة ✅`,
      '',
      'الأسئلة منين؟',
      '1) من *بنك الأسئلة* (أختار درس وأجهّز)',
      '2) من *ملف أو صور* عندك (PDF / صور) — هستخرجها بـ AI',
    ].join('\n'),
    choices: ['من بنك الأسئلة', 'من ملف أو صور'],
  };
}

export async function handleAskSource(
  session: ExamAssistantSessionRow,
  teacherId: number,
  text: string,
): Promise<{ reply: string; session: ExamAssistantSessionRow; choices?: string[] }> {
  const t = text.trim();
  if (/(ملف|صور|صورة|pdf|عندي|موجود)/i.test(t) || t === '2') {
    const updated = await ExamAssistantSessionStore.update(session.id, teacherId, {
      state: 'WAITING_FOR_FILES',
      source_type: 'files',
      context: {
        ...session.context,
        awaiting_more_files: true,
        pending_media_intent: 'create',
      },
    });
    return {
      session: updated,
      reply:
        'ابعت PDF أو صور الأسئلة دلوقتي.\nتقدر تبعت أكتر من ملف، ولما تخلّص ابعت «خلصت».',
    };
  }

  if (/(بنك|درس|أسئلة البنك|1)/i.test(t) || t === '1') {
    const updated = await ExamAssistantSessionStore.update(session.id, teacherId, {
      state: 'SELECT_LESSON',
      source_type: 'question_bank',
    });
    return {
      session: updated,
      reply: 'امتحان على *أنهي درس* من البنك؟ اكتب اسم الدرس.',
    };
  }

  return {
    session,
    reply: 'قولّي: من بنك الأسئلة، ولا من ملف/صور؟',
    choices: ['من بنك الأسئلة', 'من ملف أو صور'],
  };
}

export async function handleSelectLessonGuided(
  session: ExamAssistantSessionRow,
  teacherId: number,
  text: string,
): Promise<{ reply: string; session: ExamAssistantSessionRow; choices?: string[] }> {
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
      const updated = await ExamAssistantSessionStore.mergeContext(session.id, teacherId, {
        lesson_candidates: found,
      });
      return {
        session: updated,
        reply: `لقيت دروس مشابهة:\n${found
          .slice(0, 8)
          .map((l, i) => `${i + 1}) ${l.name} (${l.question_count} سؤال)`)
          .join('\n')}\n\nاختار رقم أو اسم أوضح.`,
        choices: found.slice(0, 8).map((l) => l.name),
      };
    }
  }
  if (!chosen) {
    return { session, reply: 'مش لاقي الدرس. اكتب الاسم بشكل أوضح.' };
  }

  let updated = await ExamAssistantSessionStore.update(session.id, teacherId, {
    state: 'GENERATING_EXAM',
    context: {
      ...session.context,
      lesson_id: chosen.id,
      lesson_name: chosen.name,
    },
  });

  const qCount = session.context.question_count || 10;
  const msg = `اعمل امتحان ${qCount} سؤال على درس ${chosen.name}`;
  const generated = await generateFromBank(updated, msg);
  return { session: generated.session, reply: generated.reply };
}

/** After review approval: create draft using already-collected grade/course/lecture/type. */
export async function createDraftFromCollectedContext(
  session: ExamAssistantSessionRow,
): Promise<{ reply: string; session: ExamAssistantSessionRow }> {
  const examType = session.context.exam_type || 'general';
  return createDraftExamFromWorkflow({
    session,
    examType,
    courseId: session.context.target_course_id,
    lectureId: session.context.target_lecture_id,
    title: session.context.exam_title,
    durationMinutes: session.context.duration_minutes,
    totalGrade: session.context.total_grade,
  });
}

export async function finishFilesWithGuidedContext(
  session: ExamAssistantSessionRow,
): Promise<{ reply: string; session: ExamAssistantSessionRow; count: number }> {
  const mediaIntent = session.context.pending_media_intent || 'create';
  const extracted = await extractQuestionsFromSessionFiles(session);
  if (!extracted.count) {
    return { ...extracted, count: 0 };
  }

  if (mediaIntent === 'review') {
    const reviewed = await replyReviewExtracted(extracted.session);
    return { reply: reviewed.reply, session: reviewed.session, count: extracted.count };
  }

  if ((mediaIntent === 'add' || mediaIntent === 'edit') && resolveEditableExam(extracted.session)) {
    const target = resolveEditableExam(extracted.session)!;
    const added = await addBulkTextToExam({
      session: extracted.session,
      examId: target.examId,
      kind: target.kind,
      bulkText: extracted.session.context.extracted_bulk_text || '',
    });
    return { reply: added.reply, session: added.session, count: extracted.count };
  }

  // Guided create: we already know type/course/lecture → create draft now
  if (
    extracted.session.context.exam_type &&
    (extracted.session.context.target_course_id || extracted.session.context.target_lecture_id)
  ) {
    const created = await createDraftFromCollectedContext(extracted.session);
    return { reply: created.reply, session: created.session, count: extracted.count };
  }

  // Fallback to type selection if intake incomplete
  const moved = await ExamAssistantSessionStore.update(
    extracted.session.id,
    extracted.session.teacher_id,
    { state: 'SELECT_EXAM_TYPE' },
  );
  return {
    count: extracted.count,
    session: moved,
    reply: extracted.reply,
  };
}
