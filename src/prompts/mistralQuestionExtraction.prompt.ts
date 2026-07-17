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

  const optionRules = `3. الاختيارات:
   - إذا كان السؤال له اختيارات، استخرج **كل** الاختيارات كما في الملف (${MIN_MCQ_OPTIONS} إلى ${MAX_MCQ_OPTIONS} اختيارات).
   - بعض الأسئلة 3 اختيارات فقط (a,b,c) وبعضها 5 (a,b,c,d,e) — لا تضف اختيارات ولا تحذف منها.
   - إذا لم يكن للسؤال اختيارات، اجعل options = [].
   - احتفظ بـ label كما في المصدر: عربي (أ، ب، ج، د، هـ) أو إنجليزي (a, b, c, d, e) أو أرقام.
   - تخطيط أفقي مثل "a. seller b. driver c. customer" = 3 خيارات منفصلة في options[].`;

  const numberingNote = opts.inferCorrectAnswer ? '5' : '6';
  const noInventNote = opts.inferCorrectAnswer ? '6' : '7';
  const emptyOptionsNote = opts.inferCorrectAnswer ? '7' : '8';

  return `أنت نظام متخصص لاستخراج أسئلة الاختيار من متعدد من محتوى تعليمي (عربي أو إنجليزي): امتحانات، كتب، أوراق عمل.

مهمتك: تحليل النص أدناه المستخرج من الملف "${filename}" وإرجاع JSON فقط بدون أي نص خارج JSON.

قواعد صارمة:
1. اكتشف كل سؤال برقمه (١، 2، س1، Q1، …) ولا تدمج سؤالين في سؤال واحد.
2. لكل سؤال: استخرج نص السؤال كاملاً مع الفراغات (....) والمعادلات (Unicode أو LaTeX بسيط).
${optionRules}
${answerRules}
${numberingNote}. correct_answer_index: فهرس 0-based يطابق ترتيب options[] (الأول = 0).
${noInventNote}. لا تخترع أسئلة غير موجودة في النص.
${emptyOptionsNote}. إن لم تجد اختيارات واضحة، options = [].
   - القاعدة: options إما [] أو تحتوي من ${MIN_MCQ_OPTIONS} إلى ${MAX_MCQ_OPTIONS} عناصر حسب الملف.
   - إذا وجدت سؤالاً مرقماً بلا اختيارات مثل: "ميّز – ممّا يلي – ما يؤيد..." فاحتفظ به كسؤال حقيقي، ولا تحوله إلى passage.
   - إذا كان هذا السؤال ضمن أسئلة قطعة/فقرة، يجب أن يأخذ نفس passage_id الخاص ببقية أسئلة القطعة حتى لو لم تكن له اختيارات.
   - في هذه الحالة: options = [] و correct_answer = null و correct_answer_index = null.
9. إذا كان نص السؤال يعتمد على صورة/رسم/شكل/جدول:
   - استخدم مراجع الصور الموجودة في النص مثل ![img-0.jpeg](img-0.jpeg) أو وصف IMAGE_CONTEXT.
   - أضف الصورة إلى question_images[] ولا تضعها إذا كانت مجرد شعار أو صورة غير مرتبطة بالسؤال.
   - image_id يجب أن يطابق معرف الصورة في IMAGE_CONTEXT.
10. إذا وجدت قطعة/فقرة/نص قراءة/نص علمي واحد يتبعه أكثر من سؤال:
   - ضع نص القطعة كاملاً مرة واحدة في passages[].
   - أعطها passage_id ثابتاً مثل "passage_1".
   - في كل سؤال تابع لها ضع نفس passage_id.
   - لا تكرر نص القطعة داخل question_text؛ question_text يحتوي نص السؤال فقط.
   - إذا تغيّرت القطعة أو بدأ نص جديد، أنشئ passage_id جديداً.
11. إذا وجدت سؤالاً رئيسياً/تمهيداً مرقماً ثم داخله أكثر من سؤال فرعي ولكل سؤال فرعي اختياراته:
   - لا تجعل التمهيد سؤالاً مستقلاً.
   - أنشئ سؤالاً مستقلاً في questions[] لكل فرع له اختيارات.
   - question_text لكل فرع = التمهيد الكامل + نص الفرع معاً في سؤال واحد مكتمل.
   - لا تضع التمهيد في passages[] ولا تستخدم passage_id لهذه الحالة؛ passage_id = null.
   - استخدم source_number لرقم المصدر المركب مثل "2-1" و"2-2".
   - number يجب أن يكون رقم ترتيب عالمي فريد ومتزايد داخل المخرجات.
12. إذا كان السؤال مستقلاً ولا يعتمد على قطعة مشتركة، اجعل passage_id = null أو احذف الحقل.

صيغة الإخراج الإلزامية:
{
  "passages": [
    {
      "passage_id": "passage_1",
      "title": "نصائح للذكاء الاجتماعي",
      "content": "نص القطعة الكامل الذي تعتمد عليه عدة أسئلة..."
    }
  ],
  "questions": [
    {
      "number": 1,
      "source_number": "1",
      "passage_id": null,
      "question_text": "The .......... paid for the goods and left the shop happily.",
      "options": [
        { "label": "a", "text": "seller" },
        { "label": "b", "text": "driver" },
        { "label": "c", "text": "customer" },
        { "label": "d", "text": "buyer" },
        { "label": "e", "text": "teacher" }
      ],
      "question_images": [],
      "correct_answer": null,
      "correct_answer_index": null,
      "correct_answer_inferred": false
    },
    {
      "number": 2,
      "source_number": "2",
      "passage_id": "passage_1",
      "question_text": "حدِّد هدف الكاتب كما فهمت من الفقرة الأولى.",
      "options": [
        { "label": "أ", "text": "..." },
        { "label": "ب", "text": "..." },
        { "label": "ج", "text": "..." },
        { "label": "د", "text": "..." }
      ],
      "question_images": [],
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
