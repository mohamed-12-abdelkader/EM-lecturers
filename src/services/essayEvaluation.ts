export type EssayGradeStatus = 'correct' | 'incorrect' | 'needs_review';

export interface EssayAiPayload {
  status?: string;
  awarded_score?: number;
  max_score?: number;
  reason?: string;
  matched_points?: unknown;
  missing_points?: unknown;
  errors?: unknown;
  review_required?: boolean;
}

export interface EssayDecision {
  status: EssayGradeStatus;
  awardedScore: number | null;
  finalScore: number | null;
  reason: string;
  reviewRequired: boolean;
  matchedPoints: string[];
  missingPoints: string[];
  errors: string[];
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 20);
}

function clampScore(value: number, maxScore: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(Math.min(maxScore, Math.max(0, value)) * 100) / 100;
}

/**
 * Accept a full mark only when the answer is complete and the model is not asking
 * for a human. Partial, unreadable, or contradictory results stay for the teacher.
 */
export function decideEssayOutcome(
  raw: EssayAiPayload | null | undefined,
  maxScore: number,
  input: { hasContent: boolean; readable: boolean },
): EssayDecision {
  const max = clampScore(maxScore, 100000);
  if (!input.hasContent) {
    return {
      status: 'incorrect',
      awardedScore: 0,
      finalScore: 0,
      reason: 'لم يقدّم الطالب إجابة على السؤال',
      reviewRequired: false,
      matchedPoints: [],
      missingPoints: [],
      errors: [],
    };
  }
  if (!input.readable) {
    return {
      status: 'needs_review',
      awardedScore: null,
      finalScore: null,
      reason: 'تعذر قراءة الإجابة من الصورة. لن تُحسب إجابة خاطئة قبل مراجعة المدرس.',
      reviewRequired: true,
      matchedPoints: [],
      missingPoints: [],
      errors: [],
    };
  }

  const status = String(raw?.status || '').trim().toLowerCase();
  const validStatus = status === 'correct' || status === 'incorrect' || status === 'needs_review';
  const rawScore = Number(raw?.awarded_score);
  const score = Number.isFinite(rawScore) ? clampScore(rawScore, max) : null;
  const matchedPoints = asStringList(raw?.matched_points);
  const missingPoints = asStringList(raw?.missing_points);
  const errors = asStringList(raw?.errors);
  const reason = String(raw?.reason || '').trim().slice(0, 2000) || 'تعذر اعتماد تقييم واضح';

  if (!validStatus || score == null || raw?.review_required === true || status === 'needs_review') {
    return {
      status: 'needs_review',
      awardedScore: score,
      finalScore: null,
      reason,
      reviewRequired: true,
      matchedPoints,
      missingPoints,
      errors,
    };
  }

  const partial = score > 0 && score < max;
  if (partial || (status === 'correct' && score < max) || (status === 'incorrect' && score > 0)) {
    return {
      status: 'needs_review',
      awardedScore: score,
      finalScore: null,
      reason: reason || 'الإجابة صحيحة جزئيًا وتحتاج مراجعة المدرس',
      reviewRequired: true,
      matchedPoints,
      missingPoints,
      errors,
    };
  }

  if (status === 'correct' && score === max && errors.length === 0 && matchedPoints.length > 0) {
    return {
      status: 'correct',
      awardedScore: score,
      finalScore: score,
      reason,
      reviewRequired: false,
      matchedPoints,
      missingPoints,
      errors,
    };
  }

  if (status === 'incorrect' && score === 0 && (errors.length > 0 || missingPoints.length > 0)) {
    return {
      status: 'incorrect',
      awardedScore: 0,
      finalScore: 0,
      reason,
      reviewRequired: false,
      matchedPoints,
      missingPoints,
      errors,
    };
  }

  return {
    status: 'needs_review',
    awardedScore: score,
    finalScore: null,
    reason,
    reviewRequired: true,
    matchedPoints,
    missingPoints,
    errors,
  };
}

export function extractJsonObject(text: string): EssayAiPayload | null {
  const trimmed = String(text || '').trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() || trimmed;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as EssayAiPayload;
  } catch {
    return null;
  }
}

export async function evaluateEssayWithDeepSeek(input: {
  questionText: string;
  questionImageNote?: string | null;
  modelAnswer: string;
  rubric?: string | null;
  studentAnswer: string;
  maxScore: number;
}): Promise<EssayDecision> {
  const { config } = await import('../utils.js');
  if (!config.DEEPSEEK_API_KEY) {
    return {
      status: 'needs_review',
      awardedScore: null,
      finalScore: null,
      reason: 'تعذر الاتصال بخدمة التقييم. الإجابة محفوظة لمراجعة المدرس.',
      reviewRequired: true,
      matchedPoints: [],
      missingPoints: [],
      errors: [],
    };
  }

  const maxScore = clampScore(input.maxScore, 100000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  try {
    const response = await fetch(`${config.DEEPSEEK_API_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.DEEPSEEK_API_KEY}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: config.DEEPSEEK_MODEL || 'deepseek-chat',
        temperature: 0.1,
        max_tokens: 900,
        messages: [
          {
            role: 'system',
            content:
              'أنت مصحح علمي. قارن إجابة الطالب بالإجابة النموذجية حسب المعنى العلمي لا تطابق الألفاظ. ' +
              'أجب بـ JSON فقط بالمفاتيح: status (correct|incorrect|needs_review), awarded_score, max_score, reason, matched_points, missing_points, errors, review_required. ' +
              'اجعل status=correct فقط عند استحقاق الدرجة الكاملة بثقة. ' +
              'اجعل status=incorrect فقط عند خطأ جوهري أو عدم الإجابة مع awarded_score=0. ' +
              'أي إجابة جزئية أو غير واضحة: status=needs_review و review_required=true مع awarded_score المقترحة.',
          },
          {
            role: 'user',
            content: JSON.stringify({
              question: input.questionText,
              question_image_note: input.questionImageNote || null,
              model_answer: input.modelAnswer,
              rubric: input.rubric || null,
              student_answer: input.studentAnswer,
              max_score: maxScore,
            }),
          },
        ],
      }),
    });
    if (!response.ok) {
      return {
        status: 'needs_review',
        awardedScore: null,
        finalScore: null,
        reason: 'تعذر تقييم الإجابة آليًا',
        reviewRequired: true,
        matchedPoints: [],
        missingPoints: [],
        errors: [],
      };
    }
    const body = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = body.choices?.[0]?.message?.content || '';
    const parsed = extractJsonObject(content);
    return decideEssayOutcome(parsed, maxScore, { hasContent: true, readable: true });
  } catch {
    return {
      status: 'needs_review',
      awardedScore: null,
      finalScore: null,
      reason: 'تعذر إكمال التقييم الآلي. الإجابة محفوظة ولم تُحسب خاطئة.',
      reviewRequired: true,
      matchedPoints: [],
      missingPoints: [],
      errors: [],
    };
  } finally {
    clearTimeout(timer);
  }
}
