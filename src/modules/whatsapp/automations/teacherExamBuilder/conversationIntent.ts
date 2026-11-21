import { config, logger } from '../../../../utils';
import type { ExamAssistantSessionContext, ExamAssistantState } from './types';
import {
  isAffirmative,
  isCancel,
  isDoneSendingFiles,
  isNewExamRequest,
  detectSourceType,
} from './workflowActions';

export type ExamAssistantIntent =
  | 'greeting'
  | 'thanks'
  | 'help'
  | 'chitchat'
  | 'unclear'
  | 'create_exam'
  | 'use_files'
  | 'use_bank'
  | 'modify_exam'
  | 'publish'
  | 'cancel'
  | 'done_files'
  | 'affirmative'
  | 'media_create'
  | 'media_review'
  | 'media_add'
  | 'media_edit'
  | 'media_ask';

export type IntentResult = {
  intent: ExamAssistantIntent;
  confidence: number;
  replyHint?: string | null;
  source?: 'rules' | 'llm';
};

const DEEPSEEK_URL = `${config.DEEPSEEK_API_URL}/v1/chat/completions`;

function ruleBasedIntent(text: string): IntentResult | null {
  const t = text.trim();
  if (!t) return null;
  if (isCancel(t)) return { intent: 'cancel', confidence: 1, source: 'rules' };
  if (isDoneSendingFiles(t)) return { intent: 'done_files', confidence: 1, source: 'rules' };
  if (/(انشر|موافق على النشر)/.test(t)) return { intent: 'publish', confidence: 0.95, source: 'rules' };

  if (
    /^(السلام عليكم|سلام عليكم|السلام|أهلا|اهلا|أهلاً|مرحبا|مرحباً|هاي|hello|hi|صباح الخير|مساء الخير|إزيك|ازيك|عامل إيه|اخبارك)[\s!.؟?]*$/i.test(
      t,
    ) ||
    /^(السلام عليكم|صباح الخير|مساء الخير).{0,20}$/i.test(t)
  ) {
    return { intent: 'greeting', confidence: 0.95, source: 'rules' };
  }

  if (/^(شكرا|شكرًا|شكراً|متشكر|تسلم|الله يخليك|thx|thanks)[\s!.]*$/i.test(t)) {
    return { intent: 'thanks', confidence: 0.95, source: 'rules' };
  }

  if (/(تقدر تعمل إيه|ايه اللي تقدر|إمكانيات|ساعدني|help|خدماتك|بتعمل إيه)/i.test(t)) {
    return { intent: 'help', confidence: 0.9, source: 'rules' };
  }

  if (
    /(احذف|امسح|شيل|غير|عدّل|عدل|استبدل|زود|قلل|أصعب|أسهل|رتب|درجة|الاختيارات|الإجابة الصحيحة|ضيف سؤال|أسئلة مكررة)/.test(
      t,
    ) &&
    /(سؤال|امتحان|واجب|اختيارات|درجة)/.test(t)
  ) {
    return { intent: 'modify_exam', confidence: 0.85, source: 'rules' };
  }

  if (isNewExamRequest(t)) {
    const source = detectSourceType(t);
    if (source === 'files') return { intent: 'use_files', confidence: 0.9, source: 'rules' };
    if (source === 'question_bank') return { intent: 'use_bank', confidence: 0.9, source: 'rules' };
    return { intent: 'create_exam', confidence: 0.9, source: 'rules' };
  }

  const source = detectSourceType(t);
  if (source === 'files' && /(اعمل|أنشئ|انشئ|من)/.test(t)) {
    return { intent: 'use_files', confidence: 0.8, source: 'rules' };
  }
  if (source === 'question_bank') {
    return { intent: 'use_bank', confidence: 0.75, source: 'rules' };
  }

  if (isAffirmative(t)) return { intent: 'affirmative', confidence: 0.8, source: 'rules' };

  return null;
}

export function classifyMediaCaptionIntent(
  caption: string | null | undefined,
  hasDraft: boolean,
): ExamAssistantIntent {
  const t = (caption || '').trim();
  if (!t) return 'media_ask';
  if (/(راجع|مراجعة|راجع الأسئلة|شوف الأسئلة)/.test(t) && !/(اعمل|أنشئ|انشئ|امتحان)/.test(t)) {
    return 'media_review';
  }
  if (/(ضيف|أضف|اضفهم|حطهم|على الامتحان|للامتحان)/.test(t)) {
    return hasDraft ? 'media_add' : 'media_ask';
  }
  if (/(غير|عدّل|عدل|استبدل|السؤال)/.test(t) && hasDraft) return 'media_edit';
  if (/(اعمل|أنشئ|انشئ|امتحان|واجب|اختبار|جهّز|جهز)/.test(t)) return 'media_create';
  return 'media_ask';
}

async function classifyWithLlm(opts: {
  text: string;
  state: ExamAssistantState;
  recentTurns?: ExamAssistantSessionContext['recent_turns'];
  hasDraft: boolean;
}): Promise<IntentResult | null> {
  if (!config.DEEPSEEK_API_KEY) return null;

  const recent = (opts.recentTurns || [])
    .slice(-6)
    .map((t) => `${t.role}: ${t.text}`)
    .join('\n');

  const system = `أنت مصنّف نوايا لمساعد امتحانات واتساب لمدرّسين مصريين.
أرجع JSON فقط بالشكل:
{"intent":"...","confidence":0.0,"reply_hint":"اختياري رد قصير بالعامية لو chitchat"}
الـ intent واحد من:
greeting, thanks, help, chitchat, unclear, create_exam, use_files, use_bank, modify_exam, publish, cancel, done_files, affirmative, media_create, media_review, media_add, media_edit, media_ask
قواعد:
- السلام/صباح/مساء/أهلا = greeting وليس create_exam
- الشكر = thanks
- سؤال عن الإمكانيات = help
- طلب إنشاء امتحان = create_exam أو use_files أو use_bank
- تعديل أسئلة امتحان موجود = modify_exam
- لو مش واضح = unclear
- ردود قصيرة عامة بدون طلب امتحان = chitchat
الحالة الحالية: ${opts.state}
يوجد مسودة امتحان: ${opts.hasDraft ? 'نعم' : 'لا'}`;

  try {
    const response = await fetch(DEEPSEEK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        temperature: 0.1,
        max_tokens: 200,
        messages: [
          { role: 'system', content: system },
          {
            role: 'user',
            content: `السياق:\n${recent || '(فارغ)'}\n\nرسالة المدرس:\n${opts.text}`,
          },
        ],
      }),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = data.choices?.[0]?.message?.content || '';
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]) as {
      intent?: string;
      confidence?: number;
      reply_hint?: string;
    };
    const intent = String(parsed.intent || '') as ExamAssistantIntent;
    const allowed: ExamAssistantIntent[] = [
      'greeting',
      'thanks',
      'help',
      'chitchat',
      'unclear',
      'create_exam',
      'use_files',
      'use_bank',
      'modify_exam',
      'publish',
      'cancel',
      'done_files',
      'affirmative',
      'media_create',
      'media_review',
      'media_add',
      'media_edit',
      'media_ask',
    ];
    if (!allowed.includes(intent)) return null;
    return {
      intent,
      confidence: Math.min(1, Math.max(0, Number(parsed.confidence) || 0.6)),
      replyHint: parsed.reply_hint || null,
      source: 'llm',
    };
  } catch (err) {
    logger.warn({ err }, 'exam assistant intent LLM failed');
    return null;
  }
}

/**
 * Classify teacher message. Prefer fast rules; use LLM when ambiguous in open states.
 */
export async function classifyExamAssistantIntent(opts: {
  text: string;
  state: ExamAssistantState;
  context?: ExamAssistantSessionContext;
  hasDraft?: boolean;
}): Promise<IntentResult> {
  const text = (opts.text || '').trim();
  if (!text) return { intent: 'unclear', confidence: 0.5, source: 'rules' };

  const rules = ruleBasedIntent(text);
  const openStates: ExamAssistantState[] = [
    'IDLE',
    'CANCELLED',
    'PUBLISHED',
    'FAILED',
    'ASK_SOURCE',
    'EXAM_REVIEW',
    'MODIFYING_EXAM',
    'READY_TO_PUBLISH',
  ];

  if (rules && rules.confidence >= 0.85) return rules;

  if (openStates.includes(opts.state)) {
    const llm = await classifyWithLlm({
      text,
      state: opts.state,
      recentTurns: opts.context?.recent_turns,
      hasDraft: Boolean(opts.hasDraft),
    });
    if (llm && llm.confidence >= 0.55) return llm;
  }

  if (rules) return rules;
  // In structural states, treat as unclear so caller keeps state machine prompts
  if (!openStates.includes(opts.state)) {
    return { intent: 'unclear', confidence: 0.4, source: 'rules' };
  }
  return { intent: 'unclear', confidence: 0.5, source: 'rules' };
}

export function appendRecentTurn(
  context: ExamAssistantSessionContext,
  role: 'teacher' | 'assistant',
  text: string,
): ExamAssistantSessionContext['recent_turns'] {
  const prev = Array.isArray(context.recent_turns) ? context.recent_turns : [];
  const next = [
    ...prev,
    { role, text: String(text || '').slice(0, 500), at: new Date().toISOString() },
  ].slice(-8);
  return next;
}
