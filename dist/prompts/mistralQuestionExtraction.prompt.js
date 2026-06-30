"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildQuestionExtractionPrompt = buildQuestionExtractionPrompt;
exports.buildMistralQuestionExtractionPrompt = buildMistralQuestionExtractionPrompt;
/**
 * Prompt لتحويل نص OCR (من PDF/صورة) إلى أسئلة اختيار من متعدد JSON
 */
function buildQuestionExtractionPrompt(documentText, filename, opts) {
    const answerRules = opts.inferCorrectAnswer
        ? `4. correct_answer و correct_answer_index:
   - إن وُجدت إشارة صريحة في النص (مثل "الإجابة: ب" أو ✓): استخدمها وضَع correct_answer_inferred = false.
   - إن لم تُذكر في المستند: استنتج الإجابة الأصح بناءً على المعرفة التعليمية وضَع correct_answer_inferred = true.
   - يجب تعبئة correct_answer (label) و correct_answer_index (0-based) لكل سؤال له options غير فارغة.`
        : `4. correct_answer و correct_answer_index: فقط إن وُجدت إشارة صريحة في النص وإلا null.
5. correct_answer_inferred: false دائماً (أو احذف الحقل).`;
    const optionRules = opts.inferCorrectAnswer
        ? `3. الاختيارات: إذا كان السؤال له اختيارات، فيجب أن تكون options مكوّنة من 4 اختيارات بالضبط. إذا لم يكن للسؤال اختيارات، اجعل options = []. لا تُرجع 1 أو 2 أو 3 أو أكثر من 4 اختيارات.`
        : `3. الاختيارات: إذا كان السؤال له اختيارات، فيجب أن تكون options مكوّنة من 4 اختيارات بالضبط. إذا لم يكن للسؤال اختيارات، اجعل options = []. لا تُرجع 1 أو 2 أو 3 أو أكثر من 4 اختيارات.`;
    const numberingNote = opts.inferCorrectAnswer ? '5' : '6';
    const noInventNote = opts.inferCorrectAnswer ? '6' : '7';
    const emptyOptionsNote = opts.inferCorrectAnswer ? '7' : '8';
    return `أنت نظام متخصص لاستخراج أسئلة الاختيار من متعدد من محتوى تعليمي عربي (امتحانات، كتب، أوراق عمل).

مهمتك: تحليل النص أدناه المستخرج من الملف "${filename}" وإرجاع JSON فقط بدون أي نص خارج JSON.

قواعد صارمة:
1. اكتشف كل سؤال برقمه (١، 2، س1، Q1، …) ولا تدمج سؤالين في سؤال واحد.
2. لكل سؤال: استخرج نص السؤال كاملاً مع المعادلات (Unicode أو LaTeX بسيط).
${optionRules}
${answerRules}
${numberingNote}. correct_answer_index: فهرس 0-based يطابق ترتيب options[] (الأول = 0).
${noInventNote}. لا تخترع أسئلة غير موجودة في النص.
${emptyOptionsNote}. إن لم تجد اختيارات واضحة، options = [].
   - القاعدة الصارمة: options يجب أن تكون إما [] أو تحتوي 4 عناصر بالضبط.
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
11. إذا وجدت سؤالاً رئيسياً/تمهيداً مرقماً ثم داخله أكثر من سؤال فرعي ولكل سؤال فرعي اختياراته، مثل:
   "إذا كانت شدة التيار ... خلال دقيقة تمر ...:" ثم "(1) شحنة كهربية مقدارها ..." ثم اختيارات، و"(2) إلكترونات عددها ..." ثم اختيارات:
   - لا تجعل التمهيد سؤالاً مستقلاً.
   - أنشئ سؤالاً مستقلاً في questions[] لكل فرع له اختيارات.
   - question_text لكل فرع = التمهيد الكامل + نص الفرع معاً في سؤال واحد مكتمل، مثل:
     "إذا كانت شدة التيار الكهربي المار في موصل 2A، فإنه خلال دقيقة تمر عبر مقطع معين من هذا الموصل: شحنة كهربية مقدارها ............"
   - لا تضع التمهيد في passages[] ولا تستخدم passage_id لهذه الحالة؛ passage_id = null.
   - استخدم source_number لرقم المصدر المركب مثل "2-1" و"2-2".
   - number يجب أن يكون رقم ترتيب عالمي فريد ومتزايد داخل المخرجات.
   - إذا كان هناك أكثر من نقطتين (3) (4) … كرر نفس القاعدة: كل نقطة = سؤال مستقل بنفس التمهيد + نص النقطة.
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
      "passage_id": "passage_1",
      "question_text": "حدِّد هدف الكاتب كما فهمت من الفقرة الأولى.",
      "options": [
        { "label": "أ", "text": "..." },
        { "label": "ب", "text": "..." },
        { "label": "ج", "text": "..." },
        { "label": "د", "text": "..." }
      ],
      "question_images": [
        {
          "image_id": "img-0.jpeg",
          "page_index": 0,
          "short_description": "رسم بياني يوضح العلاقة بين السرعة والزمن"
        }
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
function buildMistralQuestionExtractionPrompt(input) {
    return buildQuestionExtractionPrompt(input.documentContext, input.filename, {
        inferCorrectAnswer: input.inferCorrectAnswer,
    });
}
