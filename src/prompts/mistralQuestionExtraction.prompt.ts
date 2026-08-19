import { MAX_MCQ_OPTIONS, MIN_MCQ_OPTIONS } from '../types/mistralQuestionExtraction';

export type QuestionExtractionPromptOptions = {
  inferCorrectAnswer: boolean;
  hasPageImages?: boolean;
};

/**
 * Prompt عام (ليس قالباً لكتاب معيّن) لتحويل صفحة امتحان/كتاب إلى أسئلة JSON.
 * يعتمد على فهم التخطيط + السياق، ونص OCR مساعد فقط.
 */
export function buildQuestionExtractionPrompt(
  documentText: string,
  filename: string,
  opts: QuestionExtractionPromptOptions,
): string {
  const answerRules = opts.inferCorrectAnswer
    ? `4. correct_answer و correct_answer_index:
   - إن وُجدت إشارة صريحة في المصدر (مثل "الإجابة: ب" أو ✓): استخدمها و correct_answer_inferred = false.
   - إن لم تُذكر: استنتج الإجابة الأصح و correct_answer_inferred = true.
   - عبّئ الحقلين لكل سؤال له options غير فارغة.`
    : `4. correct_answer و correct_answer_index: فقط إن وُجدت إشارة صريحة وإلا null.
   correct_answer_inferred: false دائماً.`;

  const visionPriority = opts.hasPageImages
    ? `أولوية التحليل (إلزامي):
1) افهم تخطيط الصفحة من الصور المرفقة (كتل بصرية، أعمدة، مسافات، ألوان، خطوط فاصلة، كلمات تحتها خط).
2) حدّد أين يبدأ كل سؤال وأين ينتهي ككتلة مستقلة.
3) اربط النص بكل كتلة.
4) استخرج التنسيق المهم (underline وغيره).
5) نظّم JSON.
نص OCR أدناه **مساعد** وقد يخطئ في الحدود أو يسقط سطراً أو يعكس اختيارات 2×2 — الصورة هي المرجع عند التعارض.
`
    : `أولوية التحليل:
1) افهم تخطيط الصفحة من markdown (عناوين، أرقام، مسافات، قوائم، فواصل).
2) حدّد حدود كل سؤال من السياق لا من قالب ثابت.
3) استخرج النص والتنسيق قدر ما يظهر في OCR.
4) نظّم JSON.
`;

  return `أنت نظام عام لاستخراج الأسئلة من صفحات كتب وامتحانات وأوراق عمل (عربي أو إنجليزي).

الملف: "${filename}"

لا تفترض قالباً ثابتاً. كل كتاب قد يختلف في: بداية السؤال، نهايته، الترقيم أو غيابه، الأسئلة الفرعية، الاختيارات، النص التمهيدي، أكثر من سؤال في فقرة واحدة، المسافات بين العناصر.

${visionPriority}

## حدود الأسئلة (Segmentation)

اكتشف كل سؤال كوحدة معنوية كاملة. لا تعتمد على شرط واحد فقط.

مؤشرات مساعدة (ليست شروطاً إلزامية):
- خط أفقي مرسوم يدوياً أو مطبوع بين كتلتين = فاصل أسئلة. الخط **مرجع حدود فقط**: لا تستخرجه ولا تضعه في النص.
- رقم سؤال (١ / 1 / ٦ / Q1 / مربع فيه رقم) إن وُجد.
- جملة تمهيدية («قال الشاعر»، «قال ناجي»، اقتباس أحمر/ملون) ثم تعليمات ثم اختيارات = **سؤال واحد**.
- اختيارات أ/ب/ج/د (أو a/b/c/d) بأي تخطيط: رأسي، أفقي، شبكة 2×2 من اليمين لليسار.
- مسافة أو سطر فارغ أو تغيّر لون أو خط تحت التعليمات.

إن لم توجد خطوط فاصلة: استخدم التخطيط + السياق + الترقيم + شكل الاختيارات + المعنى اللغوي.

ممنوع:
- دمج سؤالين في سؤال واحد.
- تقسيم سؤال واحد إلى سؤالين بلا سبب واضح.
- اختراع سؤال غير موجود في الصفحة.
- تحويل عنوان عام («تخير البديل الصحيح…») إلى سؤال.

## الحفاظ على النص الأصلي

انسخ المحتوى كما في المصدر قدر الإمكان:
- لا تعِد الصياغة ولا تغيّر الكلمات.
- لا تحذف جزءاً من السؤال (اقتباس + تعليمات + فراغات ....).
- لا تغيّر ترتيب الاختيارات ولا نصوصها.
- رتّب الاختيارات أ→ب→ج→د حسب الحرف حتى لو OCR عكس الشبكة 2×2.
- الفراغات والمعادلات والرموز تبقى كما هي.

إن كانت كلمة غير واضحة: حاول من السياق إن كانت شبه مقروءة. وإلا ضعها داخل [غير واضح] وخفّض confidence. لا تخترع كلمات.

## التنسيق البصري المهم (Formatting)

1) **ما تحته خط — دقة الكلمة (إلزامي)**:
   - انظر للحبر/الخط الأفقي تحت الحروف في الصورة. غلّف **فقط** الكلمة أو الكلمات التي الخط تحتها مباشرة.
   - لا تنقل الخط للكلمة المجاورة (شائع في العربية RTL). لا تسطّر التعليمات («أعرب ما تحته خط»).
   - إذا الخط تحت كلمة واحدة: <u>تلك الكلمة فقط</u>. إذا تحت جملة متصلة: غلّف الجملة كلها وسم واحد.
   - املأ underlined_phrases بالنص الحرفي لتلك الكلمات كما في المصدر (بدون وسوم)، مثال: ["المدرسة"].
   - ضع <u> داخل stimulus_text عادةً (الجملة المرجعية)، وليس داخل prompt_text إلا إذا الخط فعلاً هناك.
   - الخط الفاصل بين الأسئلة ≠ underline.

2) **أبيات الشعر**:
   - كل بيت في سطر مستقل.
   - بين البيتين سطر فارغ (\\n\\n).
   - صدر وعجز نفس البيت: أبقِهما معاً مع مسافات واضحة في نفس السطر أو سطرين متتاليين ثم سطر فارغ قبل البيت التالي.
   - لا تدمج كل الأبيات في فقرة واحدة.

3) يُسمح فقط بالوسوم: <u> <b> <i> <sup> <sub>

## أجزاء العرض (مهم للفرونت — ألوان مختلفة)

قسّم كل سؤال إلى أجزاء منفصلة. لا تخلط الجملة المرجعية مع تعليمات السؤال في حقل واحد فقط.

- intro_text: تمهيد قصير إن وُجد («قال الشاعر عن مصر:»، «قال ناجي:»).
- stimulus_text: الجملة أو البيت/الأبيات التي يُسأل عنها (الاقتباس المرجعي). مع <u> إن وُجد خط تحت كلمة فيها. أبيات متتابعة بينها \\n\\n.
- prompt_text: السؤال/التعليمات فقط («بين المفضل في البيت السابق.»، «أعرب ما تحته خط:»، «ميز مما يلي…»).
- display_blocks: نفس الأجزاء بالترتيب الظاهر: role = intro | stimulus | prompt
- question_text: اجمع الأجزاء بالترتيب مع \\n\\n بينها (للتوافق مع الأنظمة القديمة).

إن لم يوجد تمهيد أو جملة مرجعية: intro_text و stimulus_text = null، و prompt_text = نص السؤال، و display_blocks = [{ "role": "prompt", "text": "..." }].

الألوان المقترحة للفرونت: intro أخضر، stimulus أحمر/عنابي، prompt أزرق. لا تكتب أسماء الألوان داخل النص.

## الأسئلة المركّبة والفرعية

- تمهيد + بيت/جملة + تعليمات + اختيارات = سؤال واحد بأجزاء العرض أعلاه.
- فقرة قراءة واحدة يتبعها **أكثر من سؤال مرقّم**: القطعة في passages[] مرة واحدة و passage_id مشترك. لا تكرر القطعة داخل question_text. اقتباس قصير يخص سؤالاً واحداً **ليس** قطعة: ضعه في stimulus_text و passage_id = null.
- سؤال رئيسي ثم فروع لكل منها اختيارات مستقلة: سؤال مستقل لكل فرع (التمهيد + نص الفرع) بدون passage_id — ليتوافق مع بنك الأسئلة.
- «اقرأ ثم أجب: أ) ب) ج)» إذا كانت أ/ب/ج **اختيارات إجابة** لنفس السؤال فليست أسئلة مستقلة.

## الاختيارات

- استخرج **كل** الاختيارات الظاهرة. في العربي غالباً 4: أ ب ج د — ممنوع إرجاع اثنين إن وُجدت أربعة.
- تخطيط 2×2 RTL شائع: السطر الأول أ … ب … / السطر الثاني ج … د …
- أفقي في سطر أو رأسي كل اختيار في سطر.
- الحرف قد يكون في دائرة أو أقواس: أ  (أ)  أ)  أ.
- نص الاختيار قد يحتوي «أ» (مثل «مرفوع بالألف») — لا تقطع عنده.
- إن لم توجد اختيارات نصية: options = [].
- صور الاختيارات: text فارغ أو وصف قصير، image_id من IMAGE_CONTEXT، ولا تضعها في question_images[].
- صورة الشكل المقابل في رأس السؤال فقط داخل question_images[].
- عدد options بين ${MIN_MCQ_OPTIONS} و ${MAX_MCQ_OPTIONS} أو [].

${answerRules}

correct_answer_index: 0-based حسب ترتيب options[].

## الحقول

لكل سؤال:
- number, source_number, options, passage_id, question_images, confidence
- intro_text, stimulus_text, prompt_text, display_blocks, underlined_phrases
- question_text: النص المجموع للتوافق

أخرج JSON فقط بلا markdown.

{
  "passages": [],
  "questions": [
    {
      "number": 1,
      "source_number": "1",
      "passage_id": null,
      "intro_text": null,
      "stimulus_text": null,
      "prompt_text": "ميز - مما يلي - الجملة التي بها اسم تفضيل.",
      "display_blocks": [
        { "role": "prompt", "text": "ميز - مما يلي - الجملة التي بها اسم تفضيل." }
      ],
      "underlined_phrases": [],
      "question_text": "ميز - مما يلي - الجملة التي بها اسم تفضيل.",
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
      "confidence": 0.97
    },
    {
      "number": 2,
      "source_number": "2",
      "passage_id": null,
      "intro_text": "قال الشاعر عن مصر:",
      "stimulus_text": "صدر البيت الأول    عجز البيت الأول\\n\\nصدر البيت الثاني    عجز البيت الثاني",
      "prompt_text": "بين المفضل في البيت السابق.",
      "display_blocks": [
        { "role": "intro", "text": "قال الشاعر عن مصر:" },
        { "role": "stimulus", "text": "صدر البيت الأول    عجز البيت الثاني\\n\\n..." },
        { "role": "prompt", "text": "بين المفضل في البيت السابق." }
      ],
      "underlined_phrases": [],
      "question_text": "قال الشاعر عن مصر:\\n\\nصدر البيت...\\n\\nبين المفضل في البيت السابق.",
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
    },
    {
      "number": 4,
      "source_number": "4",
      "passage_id": null,
      "intro_text": null,
      "stimulus_text": "ذهب الطالب إلى <u>المدرسة</u> مبكراً.",
      "prompt_text": "أعرب ما تحته خط:",
      "display_blocks": [
        { "role": "prompt", "text": "أعرب ما تحته خط:" },
        { "role": "stimulus", "text": "ذهب الطالب إلى <u>المدرسة</u> مبكراً." }
      ],
      "underlined_phrases": ["المدرسة"],
      "question_text": "أعرب ما تحته خط:\\n\\nذهب الطالب إلى <u>المدرسة</u> مبكراً.",
      "options": [],
      "question_images": [],
      "correct_answer": null,
      "correct_answer_index": null,
      "correct_answer_inferred": false,
      "confidence": 0.93
    }
  ],
  "notes": "ملاحظات اختيارية عن صفحات غير واضحة أو أسئلة بلا رقم"
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
}): string {
  return buildQuestionExtractionPrompt(input.documentContext, input.filename, {
    inferCorrectAnswer: input.inferCorrectAnswer,
  });
}
