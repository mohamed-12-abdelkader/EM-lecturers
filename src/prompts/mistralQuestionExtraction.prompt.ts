import { MAX_MCQ_OPTIONS, MIN_MCQ_OPTIONS } from '../types/mistralQuestionExtraction';

export type QuestionExtractionPromptOptions = {
  inferCorrectAnswer: boolean;
  hasPageImages?: boolean;
  /** اسم المادة — يحدد ARABIC_HIGH_ACCURACY_MODE مقابل STANDARD_EXTRACTION_MODE */
  subject?: string | null;
};

export type ExtractionMode = 'ARABIC_HIGH_ACCURACY_MODE' | 'STANDARD_EXTRACTION_MODE';

/** هل المادة لغة عربية؟ */
export function isArabicSubject(subject?: string | null): boolean {
  if (!subject?.trim()) return false;
  const s = subject.trim().toLowerCase().replace(/\s+/g, ' ');
  if (
    s === 'عربي' ||
    s === 'العربية' ||
    s === 'اللغة العربية' ||
    s === 'لغة عربية' ||
    s === 'لغة العربيه' ||
    s === 'اللغه العربيه' ||
    s === 'arabic' ||
    s === 'arabic language'
  ) {
    return true;
  }
  return (
    /^(اللغة|لغة)?\s*العربي[ةه]?$/.test(s) ||
    /\barabic\b/.test(s) ||
    /(^|\s)عربي($|\s)/.test(s)
  );
}

export function resolveExtractionMode(subject?: string | null): ExtractionMode {
  return isArabicSubject(subject) ? 'ARABIC_HIGH_ACCURACY_MODE' : 'STANDARD_EXTRACTION_MODE';
}

function arabicHighAccuracyBlock(): string {
  return `## الوضع النشط: ARABIC_HIGH_ACCURACY_MODE

المادة لغة عربية — الدقة النصية أولوية قصوى.

استخرج النص العربي كما هو ظاهر في الصورة، دون إعادة صياغة أو تلخيص أو تصحيح من عندك.

ركز بشكل خاص على:
- التشكيل (فتحة، ضمة، كسرة، سكون، شدة، تنوين، مد).
- الهمزات (قطع، وصل)، الألف المقصورة، الياء، التاء المربوطة/المفتوحة.
- علامات الترقيم، الأقواس، علامات التنصيص.
- الكلمات التي تحتها خط أو المظللة/المميزة.
- أي علامات أو رموز داخل السؤال.

لا تصحّح النص لغويًا. إذا كانت الكلمة مكتوبة بطريقة معيّنة في الصورة انقلها كما هي.
لا تستبدل كلمة بكلمة أخرى لأن البديل يبدو أصح لغويًا.

### بيوت الشعر (إلزامي)

عند وجود بيت شعر: حافظ على بنيته الشعرية. لا تحوّله إلى فقرة عادية.
إذا ظهر البيت شطرين، مثّله في verses + داخل stimulus_text بصدر وعجز.

مثال verses:
{
  "firstHemistich": "إذا المرء لا يرعاك إلا تكلفًا",
  "secondHemistich": "فدعه ولا تكثر عليه التأسفا"
}

في stimulus_text: صدر ثم مسافات واضحة ثم عجز، وبين البيتين \\n\\n.
إذا أكثر من بيت: حافظ على الترتيب. لا تدمج كل الأبيات في نص واحد.
البيت جزء من السؤال — ليس سؤالًا مستقلًا.
مثال: «قال الشاعر:» + أبيات + «ما إعراب كلمة …؟» = سؤال واحد.

### النحو والإعراب

انتبه للتشكيل، والكلمات المطلوب إعرابها، والأقواس، وما تحته خط، والجملة/البيت المعتمد عليه السؤال.
حافظ على التشكيل الظاهر في الصورة.

### المراجعة قبل الإخراج (عربي)

راجع داخليًا: التشكيل، الهمزات، الكلمات، الترقيم، الأبيات (شطر أول/ثاني)، حدود السؤال، الاختيارات، عدم سقوط/إضافة أي كلمة.`;
}

function standardExtractionBlock(subjectLabel: string): string {
  return `## الوضع النشط: STANDARD_EXTRACTION_MODE

المادة: "${subjectLabel}" — ليست لغة عربية.
لا تطبّق قواعد استخراج اللغة العربية (لا تفرض تركيزًا خاصًا على التشكيل/الهمزات كما في وضع العربي).

استخدم استخراجًا عاديًا عالي الدقة مع فهم بنية السؤال.

ممنوع تقسيم السؤال بسبب وجود عدة أسطر.
مثال طويل (سؤال واحد فقط مع اختياراته):
«في الشكل الموضح جسيم يحمل شحنة كهربائية (q) ويدور بمعدل منتظم في مسار دائري نصف قطره (r)، … أي هذه التغييرات يسبب زيادة شدة التيار…؟»

حافظ على:
- الأرقام، المعادلات، الرموز الرياضية والكيميائية، الوحدات، العلامات العلمية.
- ترتيب السؤال والاختيارات.
- poetry = false و verses = [] عادةً (إلا إذا ظهر شعر حرفيًا نادرًا).`;
}

/**
 * Prompt Vision/OCR لاستخراج الأسئلة — يتفرع حسب المادة (عربي عالي الدقة / عادي).
 * يحافظ على مخطط JSON الحالي للباكند (intro/stimulus/prompt + poetry/verses).
 */
export function buildQuestionExtractionPrompt(
  documentText: string,
  filename: string,
  opts: QuestionExtractionPromptOptions,
): string {
  const subject = opts.subject?.trim() || 'غير محددة';
  const mode = resolveExtractionMode(opts.subject);
  const modeBlock =
    mode === 'ARABIC_HIGH_ACCURACY_MODE'
      ? arabicHighAccuracyBlock()
      : standardExtractionBlock(subject);

  const answerRules = opts.inferCorrectAnswer
    ? `## الإجابة الصحيحة
- إن وُجدت إشارة صريحة في المصدر (مثل «الإجابة: ب» أو ✓): استخدمها و correct_answer_inferred = false.
- إن لم تُذكر: استنتج الأصح و correct_answer_inferred = true.
- عبّئ correct_answer و correct_answer_index لكل سؤال له options غير فارغة.`
    : `## الإجابة الصحيحة
- correct_answer و correct_answer_index: فقط إن وُجدت إشارة صريحة وإلا null.
- correct_answer_inferred: false دائمًا.`;

  const visionPriority = opts.hasPageImages
    ? `## أولوية التحليل (صور مرفقة — إلزامي)
1) افهم تخطيط الصفحة من الصور (كتل بصرية، أعمدة، مسافات، ألوان، خطوط فاصلة، كلمات تحتها خط).
2) حدّد أين يبدأ كل سؤال وأين ينتهي ككتلة مستقلة.
3) اربط النص بكل كتلة.
4) استخرج التنسيق المهم (underline وغيره).
5) نظّم JSON.
نص OCR أدناه مساعد وقد يخطئ — الصورة هي المرجع عند التعارض.`
    : `## أولوية التحليل
1) افهم تخطيط الصفحة من markdown (عناوين، أرقام، مسافات، قوائم، فواصل).
2) حدّد حدود كل سؤال من السياق لا من قالب ثابت.
3) استخرج النص والتنسيق قدر ما يظهر في OCR.
4) نظّم JSON.`;

  return `أنت AI متخصص في استخراج الأسئلة التعليمية من الصور باستخدام Vision AI.

الملف: "${filename}"
المادة (subject): "${subject}"
وضع الاستخراج: ${mode}

سيتم إرسال صور (إن وُجدت) + نص OCR مساعد. مهمتك استخراج الأسئلة بدقة عالية جدًا مع الحفاظ على بنية السؤال الأصلية.

${modeBlock}

${visionPriority}

## اكتشاف حدود السؤال

لا تتعامل مع الصفحة ككتلة نصية واحدة.
حدّد: بداية السؤال، نهايته، نص السؤال، النصوص التابعة، الأبيات، الاختيارات، أي فقرة مرتبطة.

- إذا امتد السؤال على عدة أسطر = سؤال واحد.
- إذا احتوى عدة جمل = لا تقسّمه.
- إذا كان طويلًا جدًا = لا تختصره.
- رقم سؤال جديد أو بداية واضحة = سؤال جديد.
- تمهيد + بيت/جملة + تعليمات + اختيارات = سؤال واحد.
- اقتباس قصير لسؤال واحد ليس قطعة: ضعه في stimulus_text و passage_id = null.

## قطعة القراءة (Reading Passage) — إلزامي عند الاكتشاف

تمشيط المستند أولًا: هل يحتوي على قطعة قراءة / مقال / نص قراءة متحررة / Reading Passage؟

مؤشرات قطعة قراءة:
- عنوان مثل «اقرأ ثم أجب» / «قطعة» / «نص» / «Reading» / «Comprehension».
- فقرة أو عدة فقرات طويلة متصلة ثم أسئلة مرقّمة تعتمد عليها.
- تعليمات: «من القطعة السابقة» / «according to the passage» / «من النص».

إذا وجدت قطعة قراءة:
1) ضع نص القطعة كاملًا مرة واحدة في passages[] — لا تكرره داخل كل سؤال.
2) passage_title = العنوان إن وُجد وإلا null.
3) passage_id ثابت (مثل "p1") لكل الأسئلة التابعة.
4) لا تضع نص القطعة في stimulus_text لكل سؤال — فقط في passages[].content.
5) استخرج كل الأسئلة المرتبطة بالقطعة في questions[] مع passage_id = "p1".
6) لكل سؤال فرعي: number / source_number، question_text (أو prompt_text)، options، score إن وُجدت الدرجة في المصدر (مثل درجتان / 2 marks).
7) content_type = "reading_passage".

إذا لم توجد قطعة قراءة: content_type = "general" و passages = [].

ممنوع:
- اعتبار عنوان القطعة سؤالًا.
- تقطيع القطعة إلى أسئلة.
- تكرار نص القطعة داخل كل سؤال.
- ربط سؤال غير تابع للقطعة بـ passage_id.

مؤشرات مساعدة أخرى: خط فاصل بين كتلتين، رقم سؤال، «قال الشاعر»، اختيارات أ/ب/ج/د بأي تخطيط (رأسي/أفقي/2×2 RTL).
الخط الفاصل بين الأسئلة مرجع حدود فقط — لا تضعه في النص.

ممنوع: دمج سؤالين، تقسيم سؤال بلا سبب، اختراع سؤال، تحويل عنوان عام إلى سؤال.

## ممنوع إعادة صياغة الأسئلة (كل المواد)

لا تلخّص، لا تعِد الصياغة، لا تحسّن الأسلوب، لا تصحّح المحتوى، لا تحذف أجزاء، لا تضف معلومات غير موجودة، لا تدمج سؤالين، لا تقسّم سؤالًا واحدًا.
المطلوب استخراج الموجود في الصورة وليس إنشاء سؤال جديد.

## الاختيارات

إن وُجدت أ) ب) ج) د) فلا تعتبرها أسئلة مستقلة — ضعها داخل options لنفس السؤال.
استخرج كل الاختيارات الظاهرة (غالبًا 4 في العربي). رتّبها أ→ب→ج→د حتى لو OCR عكس شبكة 2×2.
نص الاختيار قد يحتوي حرف «أ» (مثل «مرفوع بالألف») — لا تقطع عنده.
إن لم توجد اختيارات: options = [].
عدد options بين ${MIN_MCQ_OPTIONS} و ${MAX_MCQ_OPTIONS} أو [].

## التنسيق البصري

1) ما تحته خط: غلّف فقط الكلمة التي الخط تحتها مباشرة بـ <u>…</u>. لا تنقل الخط للكلمة المجاورة. املأ underlined_phrases بالنص الحرفي بدون وسوم.
2) يُسمح فقط بالوسوم: <u> <b> <i> <sup> <sub>

## أجزاء العرض (للفرونت)

- intro_text: تمهيد قصير («قال الشاعر:»).
- stimulus_text: الجملة/الأبيات المرجعية (مع <u> و poetry spacing).
- prompt_text: تعليمات السؤال فقط.
- display_blocks: نفس الأجزاء بالترتيب role = intro | stimulus | prompt
- question_text: اجمع الأجزاء بالترتيب مع \\n\\n (للتوافق).
- poetry: true إن وُجدت أبيات؛ verses: مصفوفة { firstHemistich, secondHemistich }.

إن لم يوجد تمهيد/مرجع: intro_text و stimulus_text = null، prompt_text = نص السؤال.

## الصور المتعددة

تعامل مع كل الصفحات/الصور كمستند واحد. حافظ على الترتيب.
سؤال يبدأ في صورة ويكمل في التالية = سؤال واحد. لا تكرر سؤالًا.

${answerRules}

correct_answer_index: 0-based حسب ترتيب options[].

## صيغة الإخراج

أرجع JSON فقط بلا markdown ولا شرح قبل/بعد.

{
  "subject": "${subject.replace(/"/g, '\\"')}",
  "extraction_mode": "${mode}",
  "content_type": "reading_passage",
  "passages": [
    {
      "passage_id": "p1",
      "title": "عنوان القطعة إن وجد",
      "content": "النص الكامل للقطعة هنا..."
    }
  ],
  "questions": [
    {
      "number": 1,
      "source_number": "1",
      "passage_id": "p1",
      "intro_text": null,
      "stimulus_text": null,
      "prompt_text": "نص السؤال الأول...",
      "display_blocks": [
        { "role": "prompt", "text": "نص السؤال الأول..." }
      ],
      "underlined_phrases": [],
      "question_text": "نص السؤال الأول...",
      "poetry": false,
      "verses": [],
      "score": 1,
      "options": [
        { "label": "أ", "text": "الاختيار الأول" },
        { "label": "ب", "text": "الاختيار الثاني" },
        { "label": "ج", "text": "الاختيار الثالث" },
        { "label": "د", "text": "الاختيار الرابع" }
      ],
      "question_images": [],
      "correct_answer": null,
      "correct_answer_index": null,
      "correct_answer_inferred": false,
      "confidence": 0.97
    },
    {
      "number": 2,
      "source_number": "2",
      "passage_id": null,
      "intro_text": "قال الشاعر:",
      "stimulus_text": "صدر البيت الأول    عجز البيت الأول\\n\\nصدر البيت الثاني    عجز البيت الثاني",
      "prompt_text": "ما إعراب كلمة ...؟",
      "display_blocks": [
        { "role": "intro", "text": "قال الشاعر:" },
        { "role": "stimulus", "text": "صدر البيت الأول    عجز البيت الأول\\n\\nصدر البيت الثاني    عجز البيت الثاني" },
        { "role": "prompt", "text": "ما إعراب كلمة ...؟" }
      ],
      "underlined_phrases": [],
      "question_text": "قال الشاعر:\\n\\nصدر...\\n\\nما إعراب كلمة ...؟",
      "poetry": true,
      "verses": [
        {
          "firstHemistich": "صدر البيت الأول",
          "secondHemistich": "عجز البيت الأول"
        },
        {
          "firstHemistich": "صدر البيت الثاني",
          "secondHemistich": "عجز البيت الثاني"
        }
      ],
      "score": null,
      "options": [
        { "label": "أ", "text": "..." },
        { "label": "ب", "text": "..." },
        { "label": "ج", "text": "..." },
        { "label": "د", "text": "..." }
      ],
      "question_images": [],
      "correct_answer": null,
      "correct_answer_index": null,
      "correct_answer_inferred": false,
      "confidence": 0.95
    }
  ],
  "notes": "ملاحظات اختيارية"
}

--- بداية نص OCR المساعد ---
${documentText.slice(0, 100_000)}
--- نهاية نص OCR المساعد ---`;
}

/** @deprecated استخدم buildQuestionExtractionPrompt */
export function buildMistralQuestionExtractionPrompt(input: {
  filename: string;
  documentContext: string;
  inferCorrectAnswer: boolean;
  subject?: string | null;
}): string {
  return buildQuestionExtractionPrompt(input.documentContext, input.filename, {
    inferCorrectAnswer: input.inferCorrectAnswer,
    subject: input.subject,
  });
}
