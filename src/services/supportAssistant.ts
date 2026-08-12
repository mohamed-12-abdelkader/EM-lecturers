import { config, logger } from '../utils';
import { SUPPORT_ASSISTANT_SYSTEM_PROMPT } from './supportAssistant.prompts';
import {
  SupportChatService,
  type SupportChatRow,
  type SupportContext,
  type SupportMessageRow,
} from './supportChat';
import {
  ASK_TEACHER_NAME,
  TEACHER_NOT_FOUND,
  buildSubscribeTeacherReply,
  lookupTeachersByName,
  type TeacherPlatformMatch,
} from './teacherPlatformLookup';

export type SupportIntent =
  | 'SubscribeTeacher'
  | 'Greeting'
  | 'Question'
  | 'Complaint'
  | 'LoginProblem'
  | 'TechnicalIssue'
  | 'CodeHelp'
  | 'Other';

type LlmDecision = {
  intent: SupportIntent;
  extracted: {
    teacher_name: string | null;
    subject: string | null;
    grade: string | null;
    nickname: string | null;
    phone: string | null;
    code: string | null;
  };
  known_from_context: {
    teacher_name: string | null;
    subject: string | null;
    grade: string | null;
    nickname: string | null;
  };
  action: 'reply' | 'ask_teacher_name' | 'lookup_teacher' | 'disambiguate_teacher';
  reply: string;
  confidence: number;
};

export type SupportHandleResult = {
  chat: {
    id: number;
    guest_token: string | null;
    status: string;
    current_intent: string | null;
  };
  user_message: SupportMessageRow;
  bot_message: SupportMessageRow;
  intent: SupportIntent;
  teachers?: Array<Pick<TeacherPlatformMatch, 'teacher_id' | 'teacher_name' | 'subject' | 'platform_url'>>;
};

const VALID_INTENTS: SupportIntent[] = [
  'SubscribeTeacher',
  'Greeting',
  'Question',
  'Complaint',
  'LoginProblem',
  'TechnicalIssue',
  'CodeHelp',
  'Other',
];

function normalizeForIntent(text: string): string {
  return text
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي');
}

/** رفض المدرس المقترح / مش المدرس المطلوب */
function looksLikeTeacherRejection(text: string): boolean {
  const n = normalizeForIntent(text);
  return /(مش\s*(دا|ده|دي|اللي)|ليس\s*(هذا|هذه)|غلط|خطأ\s*المدرس|مش\s*عايز|مش\s*عايزة|مش\s*المدرس|مدرس\s*تاني|مدرس\s*ثاني|غير\s*صح|مش\s*صح)/i.test(
    n,
  );
}

/** مشكلة دخول / تسجيل / خطأ تقني */
function looksLikeLoginOrTechProblem(text: string): boolean {
  const n = normalizeForIntent(text);
  return /(مش\s*راض|مش\s*فاتح|مش\s*بتفتح|مش\s*تدخل|مش\s*يدخل|مش\s*قادرة?\s*(ادخل|ادخل|اسجل)|خطأ|خطاء|يرفض|مش\s*شغال|مش\s*شغاله|error|login|password|باسورد|كلمة\s*السر|نسيت|مش\s*عارف\s*(ادخل|اسجل)|بيظهر|مشكلة\s*(في\s*)?(الدخول|التسجيل|المنصة)|المنصة\s*مش|مش\s*قادر\s*(ادخل|اسجل|افتح))/i.test(
    n,
  );
}

/** طلب اشتراك / رابط منصة مدرس — بدون خلط مع مشاكل الدخول */
function looksLikeSubscribe(text: string): boolean {
  const n = normalizeForIntent(text);
  if (looksLikeLoginOrTechProblem(n) || looksLikeTeacherRejection(n)) return false;
  return /(ا[أ]?شترك|ا[أ]?شتراك|عايز\s*(منصة|منصه|لينك|رابط)|ابعت(لي)?\s*(ال)?(رابط|لينك|منصة|منصه)|لينك\s*(المنصة|المدرس|التسجيل)|رابط\s*(المنصة|المدرس|التسجيل)|منصة\s*(مستر|استاذ|المدرس)|مستر\s+\S+|platform\s*link|subscribe)/i.test(
    n,
  );
}

/** هل الرسالة تبدو اسم مدرس أو مادة قصيرة (إجابة على سؤال سابق)؟ */
function looksLikeShortAnswerName(text: string): boolean {
  const t = text.trim();
  if (t.length < 2 || t.length > 50) return false;
  if (/[؟?]/.test(t)) return false;
  if (looksLikeLoginOrTechProblem(t) || looksLikeTeacherRejection(t) || looksLikeSubscribe(t)) {
    return false;
  }
  // جملة طويلة بفعل → مش اسم
  if (/\s/.test(t) && /(عايز|محتاج|مش|فيه|بيظهر|بحاول|المنصة|ادخل|اسجل)/i.test(normalizeForIntent(t))) {
    return false;
  }
  // اسم عربي/لاتيني بسيط
  return /^[\u0600-\u06FFa-zA-Z0-9][\u0600-\u06FFa-zA-Z0-9\s.'-]{0,48}$/.test(t);
}

function cleanJson(content: string): string {
  let text = content.trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  }
  return text.trim();
}

function pickStr(...values: Array<string | null | undefined>): string | null {
  for (const v of values) {
    const t = typeof v === 'string' ? v.trim() : '';
    if (t) return t;
  }
  return null;
}

function mergeContext(
  prev: SupportContext,
  decision: LlmDecision,
  overrides: Partial<SupportContext> = {},
): SupportContext {
  const has = <K extends keyof SupportContext>(key: K) =>
    Object.prototype.hasOwnProperty.call(overrides, key);

  return {
    teacher_name: has('teacher_name')
      ? (overrides.teacher_name ?? null)
      : pickStr(
          decision.extracted.teacher_name,
          decision.known_from_context.teacher_name,
          prev.teacher_name,
        ),
    subject: has('subject')
      ? (overrides.subject ?? null)
      : pickStr(decision.extracted.subject, decision.known_from_context.subject, prev.subject),
    grade: has('grade')
      ? (overrides.grade ?? null)
      : pickStr(decision.extracted.grade, decision.known_from_context.grade, prev.grade),
    nickname: has('nickname')
      ? (overrides.nickname ?? null)
      : pickStr(
          decision.extracted.nickname,
          decision.known_from_context.nickname,
          prev.nickname,
        ),
    last_intent: has('last_intent')
      ? (overrides.last_intent ?? null)
      : (decision.intent ?? prev.last_intent ?? null),
    pending_action: has('pending_action')
      ? (overrides.pending_action ?? null)
      : null,
    candidate_teacher_ids: has('candidate_teacher_ids')
      ? overrides.candidate_teacher_ids
      : prev.candidate_teacher_ids,
  };
}

function extractTeacherNameHint(text: string): string | null {
  if (looksLikeLoginOrTechProblem(text) || looksLikeTeacherRejection(text)) return null;

  const cleaned = normalizeForIntent(text).replace(/[؟!.,،]/g, ' ').replace(/\s+/g, ' ').trim();

  const patterns = [
    /(?:مستر|مستاذ|استاذ|المدرس)\s+([ء-يa-z0-9][ء-يa-z0-9\s]{1,60})$/i,
    /(?:اشترك|اشتراك)\s*(?:مع)?\s*(?:مستر|مستاذ|استاذ)?\s*([ء-يa-z0-9][ء-يa-z0-9\s]{1,60})$/i,
    /(?:عايز|ابعت(?:لي)?)\s+(?:منصة|منصه|لينك|رابط)\s+(?:مستر|مستاذ|استاذ)?\s*([ء-يa-z0-9][ء-يa-z0-9\s]{1,60})$/i,
    /(?:منصة|منصه)\s+(?:مستر|مستاذ|استاذ)\s+([ء-يa-z0-9][ء-يa-z0-9\s]{1,60})$/i,
  ];

  for (const re of patterns) {
    const m = cleaned.match(re);
    if (!m?.[1]) continue;
    const name = m[1].replace(/^(مستر|مستاذ|استاذ)\s+/i, '').trim();
    if (name.length >= 2 && !looksLikeLoginOrTechProblem(name) && looksLikeShortAnswerName(name)) {
      return name;
    }
    // أسماء أطول من short-answer (اسم ثلاثي) مسموحة لو النمط واضح
    if (name.length >= 2 && name.length <= 60 && !/(مش|عايز|مشكلة|خطاء|خطأ|تدخل|ادخل)/i.test(name)) {
      return name;
    }
  }
  return null;
}

function emptyExtracted() {
  return {
    teacher_name: null as string | null,
    subject: null as string | null,
    grade: null as string | null,
    nickname: null as string | null,
    phone: null as string | null,
    code: null as string | null,
  };
}

function contextKnown(context: SupportContext) {
  return {
    teacher_name: context.teacher_name ?? null,
    subject: context.subject ?? null,
    grade: context.grade ?? null,
    nickname: context.nickname ?? null,
  };
}

function loginProblemReply(): string {
  return `فاهم، في مشكلة في الدخول أو التسجيل.

جرّب الآتي بسرعة:
1- تأكد إن الرابط صح وإنك على منصة المدرس الصح.
2- امسح الكاش أو جرّب متصفح/موبايل تاني.
3- لو بتسجّل حساب جديد: استخدم رقم موبايل صحيح وكلمة سر واضحة (6 حروف على الأقل).
4- لو بيظهر خطأ معيّن، ابعتلي نص الخطأ أو سكرين شوت عشان أساعدك أدق.`;
}

function teacherRejectionReply(): string {
  return 'ماشي، قولي اسم المدرس الصح بالظبط (واللقب أو المادة لو تعرفهم) وأبعتلك رابط منصته.';
}

function fallbackDecision(message: string, context: SupportContext): LlmDecision {
  const text = message.trim();

  if (looksLikeTeacherRejection(text)) {
    return {
      intent: 'SubscribeTeacher',
      extracted: emptyExtracted(),
      known_from_context: contextKnown(context),
      action: 'ask_teacher_name',
      reply: teacherRejectionReply(),
      confidence: 0.75,
    };
  }

  if (looksLikeLoginOrTechProblem(text)) {
    return {
      intent: 'LoginProblem',
      extracted: emptyExtracted(),
      known_from_context: contextKnown(context),
      action: 'reply',
      reply: loginProblemReply(),
      confidence: 0.75,
    };
  }

  const extractedName = extractTeacherNameHint(text);
  const answeringNamePrompt =
    context.pending_action === 'ask_teacher_name' && looksLikeShortAnswerName(text);
  const answeringDisambiguate =
    context.pending_action === 'disambiguate_teacher' && looksLikeShortAnswerName(text);

  if (looksLikeSubscribe(text) || answeringNamePrompt || answeringDisambiguate) {
    const teacherName = pickStr(
      extractedName,
      answeringNamePrompt ? text : null,
      answeringDisambiguate ? context.teacher_name : null,
      looksLikeSubscribe(text) ? null : null,
    );
    const subject = answeringDisambiguate && !extractedName ? text : context.subject ?? null;

    if (!teacherName && !answeringDisambiguate) {
      return {
        intent: 'SubscribeTeacher',
        extracted: emptyExtracted(),
        known_from_context: contextKnown(context),
        action: 'ask_teacher_name',
        reply: ASK_TEACHER_NAME,
        confidence: 0.6,
      };
    }

    return {
      intent: 'SubscribeTeacher',
      extracted: {
        ...emptyExtracted(),
        teacher_name: teacherName,
        subject,
      },
      known_from_context: {
        ...contextKnown(context),
        teacher_name: teacherName,
        subject,
      },
      action: answeringDisambiguate && !extractedName ? 'lookup_teacher' : 'lookup_teacher',
      reply: '',
      confidence: 0.55,
    };
  }

  return {
    intent: 'Other',
    extracted: emptyExtracted(),
    known_from_context: contextKnown(context),
    action: 'reply',
    reply: 'تمام، قولي محتاج مساعدة في إيه بالظبط؟',
    confidence: 0.3,
  };
}

function parseDecision(raw: string, message: string, context: SupportContext): LlmDecision {
  try {
    const parsed = JSON.parse(cleanJson(raw)) as Partial<LlmDecision>;
    const intent = VALID_INTENTS.includes(parsed.intent as SupportIntent)
      ? (parsed.intent as SupportIntent)
      : 'Other';
    const action =
      parsed.action === 'ask_teacher_name' ||
      parsed.action === 'lookup_teacher' ||
      parsed.action === 'disambiguate_teacher' ||
      parsed.action === 'reply'
        ? parsed.action
        : 'reply';

    return {
      intent,
      extracted: {
        teacher_name: pickStr(parsed.extracted?.teacher_name),
        subject: pickStr(parsed.extracted?.subject),
        grade: pickStr(parsed.extracted?.grade),
        nickname: pickStr(parsed.extracted?.nickname),
        phone: pickStr(parsed.extracted?.phone),
        code: pickStr(parsed.extracted?.code),
      },
      known_from_context: {
        teacher_name: pickStr(parsed.known_from_context?.teacher_name, context.teacher_name),
        subject: pickStr(parsed.known_from_context?.subject, context.subject),
        grade: pickStr(parsed.known_from_context?.grade, context.grade),
        nickname: pickStr(parsed.known_from_context?.nickname, context.nickname),
      },
      action,
      reply: typeof parsed.reply === 'string' ? parsed.reply.trim() : '',
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
    };
  } catch {
    return fallbackDecision(message, context);
  }
}

async function callDeepSeek(messages: Array<{ role: string; content: string }>): Promise<string> {
  if (!config.DEEPSEEK_API_KEY?.trim()) {
    throw new Error('DEEPSEEK_API_KEY is missing');
  }

  const response = await fetch(`${config.DEEPSEEK_API_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: config.DEEPSEEK_MODEL || 'deepseek-v4-flash',
      messages,
      temperature: 0.35,
      max_tokens: 700,
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`DeepSeek error ${response.status}: ${errText.slice(0, 500)}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content?.trim() || '';
  if (!content) throw new Error('DeepSeek returned empty content');
  return content;
}

function formatHistory(messages: SupportMessageRow[]): string {
  return messages
    .slice(-20)
    .map((m) => {
      const role = m.sender_role === 'bot' ? 'المساعد' : 'المستخدم';
      return `${role}: ${m.text}`;
    })
    .join('\n');
}

function disambiguateReply(matches: TeacherPlatformMatch[]): string {
  const lines = matches.slice(0, 5).map((m, idx) => {
    const subject = m.subject ? ` — ${m.subject}` : '';
    return `${idx + 1}) ${m.teacher_name}${subject}`;
  });
  return `لقيت أكتر من مدرس بنفس الاسم تقريباً. قولي المادة أو المرحلة أو اللقب عشان أحدد الصح:\n${lines.join('\n')}`;
}

async function resolveSubscribeReply(
  decision: LlmDecision,
  context: SupportContext,
): Promise<{ reply: string; contextPatch: SupportContext; teachers?: TeacherPlatformMatch[] }> {
  const teacherName = pickStr(
    decision.extracted.teacher_name,
    decision.known_from_context.teacher_name,
    context.teacher_name,
  );
  const subject = pickStr(decision.extracted.subject, decision.known_from_context.subject, context.subject);
  const grade = pickStr(decision.extracted.grade, decision.known_from_context.grade, context.grade);
  const nickname = pickStr(
    decision.extracted.nickname,
    decision.known_from_context.nickname,
    context.nickname,
  );

  if (decision.action === 'ask_teacher_name' || !teacherName) {
    const reply =
      decision.reply && decision.reply !== ASK_TEACHER_NAME
        ? decision.reply
        : ASK_TEACHER_NAME;
    return {
      reply,
      contextPatch: mergeContext(context, decision, {
        teacher_name: null,
        pending_action: 'ask_teacher_name',
        last_intent: 'SubscribeTeacher',
        candidate_teacher_ids: [],
      }),
    };
  }

  const matches = await lookupTeachersByName(teacherName, { subject, grade, nickname });

  if (!matches.length) {
    return {
      reply: TEACHER_NOT_FOUND,
      contextPatch: mergeContext(context, decision, {
        teacher_name: teacherName,
        subject,
        grade,
        nickname,
        pending_action: 'ask_teacher_name',
        last_intent: 'SubscribeTeacher',
        candidate_teacher_ids: [],
      }),
    };
  }

  if (matches.length > 1 && !subject && !nickname && !grade) {
    return {
      reply: disambiguateReply(matches),
      contextPatch: mergeContext(context, decision, {
        teacher_name: teacherName,
        subject,
        grade,
        nickname,
        pending_action: 'disambiguate_teacher',
        last_intent: 'SubscribeTeacher',
        candidate_teacher_ids: matches.map((m) => m.teacher_id),
      }),
      teachers: matches,
    };
  }

  // مع فلاتر إضافية: لو لسه أكتر من واحد اسأل، وإلا خذ الأول بعد الفلترة
  if (matches.length > 1) {
    return {
      reply: disambiguateReply(matches),
      contextPatch: mergeContext(context, decision, {
        teacher_name: teacherName,
        subject,
        grade,
        nickname,
        pending_action: 'disambiguate_teacher',
        last_intent: 'SubscribeTeacher',
        candidate_teacher_ids: matches.map((m) => m.teacher_id),
      }),
      teachers: matches,
    };
  }

  const chosen = matches[0];
  return {
    reply: buildSubscribeTeacherReply(chosen.platform_url),
    contextPatch: mergeContext(context, decision, {
      teacher_name: chosen.teacher_name,
      subject: chosen.subject ?? subject,
      grade,
      nickname: chosen.display_name ?? nickname,
      pending_action: null,
      last_intent: 'SubscribeTeacher',
      candidate_teacher_ids: [chosen.teacher_id],
    }),
    teachers: [chosen],
  };
}

export class SupportAssistantService {
  static async analyzeAndReply(input: {
    chat: SupportChatRow;
    message: string;
    senderId?: number | null;
    senderRole: 'student' | 'guest';
  }): Promise<SupportHandleResult> {
    const history = await SupportChatService.getChatMessages(input.chat.id, 40);
    const context = SupportChatService.getContext(input.chat);

    const userMessage = await SupportChatService.addMessage({
      chatId: input.chat.id,
      senderId: input.senderId ?? null,
      senderRole: input.senderRole,
      text: input.message.trim(),
    });

    let decision: LlmDecision;
    try {
      const content = await callDeepSeek([
        { role: 'system', content: SUPPORT_ASSISTANT_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `سياق محفوظ سابقاً:
${JSON.stringify(context)}

سجل المحادثة:
${formatHistory(history)}

رسالة المستخدم الحالية:
${input.message.trim()}`,
        },
      ]);
      decision = parseDecision(content, input.message, context);
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? { message: err.message, stack: err.stack } : err },
        'SupportAssistant DeepSeek failed',
      );
      decision = fallbackDecision(input.message, context);
    }

    // لا تُجبر مسار الاشتراك إلا إذا الرسالة فعلاً إجابة اسم/مادة أو طلب اشتراك صريح
    const msg = input.message.trim();
    const hardSwitchAway =
      looksLikeLoginOrTechProblem(msg) ||
      (decision.intent !== 'SubscribeTeacher' &&
        decision.action === 'reply' &&
        !looksLikeSubscribe(msg) &&
        !looksLikeShortAnswerName(msg));

    if (looksLikeTeacherRejection(msg)) {
      decision = {
        ...decision,
        intent: 'SubscribeTeacher',
        action: 'ask_teacher_name',
        reply: teacherRejectionReply(),
        extracted: { ...decision.extracted, teacher_name: null },
      };
    } else if (looksLikeLoginOrTechProblem(msg)) {
      decision = {
        ...decision,
        intent: 'LoginProblem',
        action: 'reply',
        reply: decision.reply?.trim() || loginProblemReply(),
        extracted: emptyExtracted(),
      };
    } else if (
      !hardSwitchAway &&
      (context.pending_action === 'ask_teacher_name' ||
        context.pending_action === 'disambiguate_teacher') &&
      looksLikeShortAnswerName(msg)
    ) {
      decision = {
        ...decision,
        intent: 'SubscribeTeacher',
        action: 'lookup_teacher',
        extracted: {
          ...decision.extracted,
          teacher_name:
            decision.extracted.teacher_name ||
            (context.pending_action === 'ask_teacher_name' ? msg : context.teacher_name) ||
            null,
          subject:
            decision.extracted.subject ||
            (context.pending_action === 'disambiguate_teacher' ? msg : context.subject) ||
            null,
          nickname: decision.extracted.nickname || context.nickname || null,
          grade: decision.extracted.grade || context.grade || null,
        },
      };
    }

    let reply = decision.reply;
    let intent: SupportIntent = decision.intent;
    let teachers: TeacherPlatformMatch[] | undefined;

    const preOverrides: Partial<SupportContext> = {
      pending_action:
        decision.intent === 'SubscribeTeacher'
          ? decision.action === 'ask_teacher_name'
            ? 'ask_teacher_name'
            : decision.action === 'lookup_teacher' || decision.action === 'disambiguate_teacher'
              ? context.pending_action
              : null
          : null,
      last_intent: decision.intent,
    };
    if (looksLikeTeacherRejection(msg) || decision.intent === 'LoginProblem') {
      preOverrides.teacher_name = null;
      preOverrides.candidate_teacher_ids = [];
    }

    let contextPatch = mergeContext(context, decision, preOverrides);

    const shouldLookup =
      decision.intent === 'SubscribeTeacher' &&
      (decision.action === 'ask_teacher_name' ||
        decision.action === 'lookup_teacher' ||
        decision.action === 'disambiguate_teacher' ||
        looksLikeSubscribe(msg));

    if (shouldLookup) {
      intent = 'SubscribeTeacher';
      const resolved = await resolveSubscribeReply(decision, {
        ...context,
        teacher_name: looksLikeTeacherRejection(msg) ? null : context.teacher_name,
      });
      reply = resolved.reply;
      contextPatch = resolved.contextPatch;
      teachers = resolved.teachers;
    } else if (!reply) {
      reply = 'تمام، قولي محتاج مساعدة في إيه بالظبط؟';
    }

    // لو غيّر الموضوع بعيداً عن الاشتراك امسح انتظار اسم المدرس
    if (intent !== 'SubscribeTeacher') {
      contextPatch = {
        ...contextPatch,
        pending_action: null,
        last_intent: intent,
      };
    }

    await SupportChatService.updateContext(input.chat.id, contextPatch);

    const botMessage = await SupportChatService.addMessage({
      chatId: input.chat.id,
      senderRole: 'bot',
      text: reply,
      intent,
      meta: {
        action: decision.action,
        confidence: decision.confidence,
        teachers: teachers?.map((t) => ({
          teacher_id: t.teacher_id,
          teacher_name: t.teacher_name,
          subject: t.subject,
          platform_url: t.platform_url,
        })),
      },
    });

    const chat = (await SupportChatService.getChatById(input.chat.id)) || input.chat;

    return {
      chat: {
        id: chat.id,
        guest_token: chat.guest_token,
        status: chat.status,
        current_intent: intent,
      },
      user_message: userMessage,
      bot_message: botMessage,
      intent,
      teachers: teachers?.map((t) => ({
        teacher_id: t.teacher_id,
        teacher_name: t.teacher_name,
        subject: t.subject,
        platform_url: t.platform_url,
      })),
    };
  }
}
