import { MAX_MCQ_OPTIONS, MIN_MCQ_OPTIONS } from '../types/mistralQuestionExtraction';

export type QuestionExtractionPromptOptions = {
  inferCorrectAnswer: boolean;
};

/**
 * Prompt لتحويل نص OCR (من PDF/صورة) إلى أسئلة اختيار من متعدد JSON
 */
export function buildQuestionExtractionPrompt(
  documentText: string,
  filename: string,
  opts: QuestionExtractionPromptOptions,
): string {
  const answerRules = opts.inferCorrectAnswer
    ? `4. correct_answer و correct_answer_index:
   - إن وُجدت إشارة صريحة في النص (مثل "الإجابة: ب" أو ✓ أو a): استخدمها وضَع correct_answer_inferred = false.
   - إن لم تُذكر في المستند: استنتج الإجابة الأصح بناءً على المعرفة التعليمية وضَع correct_answer_inferred = true.
   - يجب تعبئة correct_answer (label) و correct_answer_index (0-based) لكل سؤال له options غير فارغة.`
    : `4. correct_answer و correct_answer_index: فقط إن وُجدت إشارة صريحة في النص وإلا null.
5. correct_answer_inferred: false دائماً (أو احذف الحقل).`;

  const optionRules = `3. الاختيارات (مهم جداً — لا تختصر):
   - استخرج **كل** الاختيارات الظاهرة في الملف دون حذف.
   - في الامتحانات العربية غالباً 4 اختيارات: أ، ب، ج، د — حتى لو كانت في شبكة 2×2 أفقياً/عمودياً. **ممنوع** إرجاع اختيارين فقط إذا وُجدت أربعة.
   - بعض الأسئلة الإنجليزية 3 أو 5 اختيارات — التزم بعدد الملف فقط (${MIN_MCQ_OPTIONS}–${MAX_MCQ_OPTIONS}).
   - إذا لم يكن للسؤال اختيارات نصية، اجعل options = [] (حالة اختيارات بالصور فقط بدون labels نصية واضحة).
   - احتفظ بـ label كما في المصدر: أ/ب/ج/د أو a/b/c/d.
   - تخطيط مثل "أ) 10 A    ب) 250 A" تحتها "ج) ...    د) ..." = أربعة خيارات منفصلة.
   - إذا كانت الاختيارات **صوراً/رسوماً بيانية** (وليس نصاً):
     * options[].text = "" أو وصف قصير جداً إن وُجد حرف أ/ب/ج/د بجانب الصورة.
     * options[].image_id = معرف صورة الاختيار من IMAGE_CONTEXT (إلزامي لكل اختيار صورة).
     * **لا تضع صور الاختيارات داخل question_images[]**.
     * ضع صورة/رسم السؤال الأساسي فقط (الشكل المقابل في نص السؤال) داخل question_images[].`;

  const numberingNote = opts.inferCorrectAnswer ? '5' : '6';
  const noInventNote = opts.inferCorrectAnswer ? '6' : '7';
  const emptyOptionsNote = opts.inferCorrectAnswer ? '7' : '8';

  return `أنت نظام متخصص لاستخراج أسئلة الاختيار من متعدد من محتوى تعليمي (عربي أو إنجليزي): امتحانات، كتب، أوراق عمل.

مهمتك: تحليل النص أدناه المستخرج من الملف "${filename}" وإرجاع JSON فقط بدون أي نص خارج JSON.

قواعد صارمة:
1. اكتشف كل سؤال برقمه (٦، 6، س1، Q1، …) ولا تدمج سؤالين في سؤال واحد.
2. لكل سؤال: استخرج نص السؤال كاملاً مع الفراغات (....) والمعادلات (Unicode أو LaTeX بسيط مثل $$\\frac{I_x}{I_y}$$).
${optionRules}
${answerRules}
${numberingNote}. correct_answer_index: فهرس 0-based يطابق ترتيب options[] (الأول = 0).
${noInventNote}. لا تخترع أسئلة غير موجودة في النص.
${emptyOptionsNote}. إن لم تجد اختيارات واضحة، options = [].
   - القاعدة: options إما [] أو تحتوي من ${MIN_MCQ_OPTIONS} إلى ${MAX_MCQ_OPTIONS} عناصر حسب الملف.
   - إذا وجدت سؤالاً مرقماً بلا اختيارات مثل: "ميّز – ممّا يلي – ما يؤيد..." فاحتفظ به كسؤال حقيقي، ولا تحوله إلى passage.
   - إذا كان هذا السؤال ضمن أسئلة قطعة/فقرة، يجب أن يأخذ نفس passage_id الخاص ببقية أسئلة القطعة حتى لو لم تكن له اختيارات.
   - في هذه الحالة: options = [] و correct_answer = null و correct_answer_index = null.
9. الصور المرتبطة بالسؤال (الشكل المقابل / الرسم البياني في رأس السؤال):
   - استخدم مراجع الصور مثل ![img-0.jpeg](img-0.jpeg) و IMAGE_CONTEXT.
   - أضف صورة السؤال الأساسية فقط إلى question_images[] (diagram/chart/graph/figure/question_figure).
   - image_id يجب أن يطابق معرف الصورة في IMAGE_CONTEXT.
   - **لا** تضف شعارات أو زخارف أو صور اختيارات أ/ب/ج/د إلى question_images[].
   - إذا كان نوع الصورة في IMAGE_CONTEXT = choice_option فهي اختيار وليست صورة سؤال.
10. سؤال باختيارات صور (image choices):
   - question_images[] = صورة/رسم السؤال فقط إن وُجدت (مثل منحنى N–t في رأس السؤال).
   - options = أربعة عناصر (أو حسب الملف) كل منها label أ/ب/ج/د و image_id لصورة الاختيار.
   - عدد options يجب أن يساوي عدد صور الاختيارات، وليس عدد كل الصور في الصفحة.
11. إذا وجدت قطعة/فقرة/نص قراءة واحد يتبعه أكثر من سؤال:
   - ضع نص القطعة كاملاً مرة واحدة في passages[].
   - أعطها passage_id ثابتاً مثل "passage_1".
   - في كل سؤال تابع لها ضع نفس passage_id.
   - لا تكرر نص القطعة داخل question_text.
12. إذا وجدت سؤالاً رئيسياً ثم فروعاً لكل منها اختيارات: أنشئ سؤالاً مستقلاً لكل فرع (تمهيد + نص الفرع) بدون passage_id.
13. إذا كان السؤال مستقلاً، passage_id = null.

صيغة الإخراج الإلزامية:
{
  "passages": [],
  "questions": [
    {
      "number": 6,
      "source_number": "6",
      "passage_id": null,
      "question_text": "الشكل البياني المقابل يمثل العلاقة بين ... فتكون شدة التيار ...",
      "options": [
        { "label": "أ", "text": "2 A" },
        { "label": "ب", "text": "10 A" },
        { "label": "ج", "text": "50 A" },
        { "label": "د", "text": "250 A" }
      ],
      "question_images": [
        { "image_id": "img-0.jpeg", "page_index": 0, "image_type": "chart" }
      ],
      "correct_answer": null,
      "correct_answer_index": null,
      "correct_answer_inferred": false
    },
    {
      "number": 8,
      "source_number": "8",
      "passage_id": null,
      "question_text": "الشكل البياني المقابل يعبر عن العلاقة بين عدد الإلكترونات (N) ... فيكون الشكل الذي يمثل I مقابل t هو ...",
      "options": [
        { "label": "أ", "text": "", "image_id": "img-2.jpeg" },
        { "label": "ب", "text": "", "image_id": "img-3.jpeg" },
        { "label": "ج", "text": "", "image_id": "img-4.jpeg" },
        { "label": "د", "text": "", "image_id": "img-5.jpeg" }
      ],
      "question_images": [
        { "image_id": "img-1.jpeg", "page_index": 0, "image_type": "chart" }
      ],
      "correct_answer": null,
      "correct_answer_index": null,
      "correct_answer_inferred": false
    }
  ],
  "notes": "ملاحظات اختيارية"
}

--- بداية النص ---
${documentText.slice(0, 100_000)}
--- نهاية النص ---`;
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
