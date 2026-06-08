"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildMistralQuestionExtractionPrompt = buildMistralQuestionExtractionPrompt;
exports.buildImageAnnotationFormat = buildImageAnnotationFormat;
function buildMistralQuestionExtractionPrompt(input) {
    return `أنت نظام استخراج أسئلة عربي من ملفات تعليمية OCR.

الملف: ${input.filename}

المطلوب:
استخرج الأسئلة والاختيارات والقطع المشتركة من النص التالي وأعد JSON فقط.

القواعد:
1. أعد JSON فقط بدون Markdown.
2. لا تخترع أسئلة غير موجودة في الملف.
3. كل سؤال اختيار من متعدد يجب أن يحتوي إما 0 اختيارات أو 4 اختيارات بالضبط.
4. correct_answer_index يبدأ من 0: أ=0، ب=1، ج=2، د=3.
5. إذا لم تكن الإجابة واضحة اترك correct_answer و correct_answer_index بقيمة null.
6. ${input.inferCorrectAnswer
        ? 'إذا لم تظهر الإجابة صراحة لكن يمكن استنتاجها بثقة من السؤال، يمكنك وضع correct_answer_inferred=true.'
        : 'لا تستنتج الإجابة الصحيحة إذا لم تظهر صراحة؛ ضع correct_answer_inferred=false.'}
7. إذا وجدت قطعة/فقرة/نص قراءة/نص علمي واحد يتبعه أكثر من سؤال:
   - ضع نص القطعة كاملاً مرة واحدة في passages[].
   - أعطها passage_id ثابتاً مثل "passage_1".
   - في كل سؤال تابع لها ضع نفس passage_id.
   - لا تكرر نص القطعة داخل question_text؛ question_text يحتوي نص السؤال فقط.
   - إذا تغيّرت القطعة أو بدأ نص جديد، أنشئ passage_id جديداً.
8. إذا وجدت سؤالاً رئيسياً أو تمهيداً مرقماً ثم داخله أكثر من سؤال فرعي ولكل سؤال فرعي اختياراته:
   - لا تجعل التمهيد سؤالاً مستقلاً.
   - اجعل التمهيد passage في passages[].
   - اجعل كل سؤال فرعي سؤالاً مستقلاً في questions[] مربوطاً بنفس passage_id.
9. إذا كان السؤال يعتمد على صورة/رسم/جدول موجود في IMAGE_CONTEXT، ضع مرجع الصورة في question_images[] باستخدام image_id.
10. حافظ على اللغة العربية كما هي قدر الإمكان.

الشكل المطلوب:
{
  "passages": [
    {
      "passage_id": "passage_1",
      "title": "عنوان اختياري",
      "content": "نص القطعة الكامل"
    }
  ],
  "questions": [
    {
      "number": 1,
      "source_number": "1",
      "passage_id": "passage_1",
      "question_text": "نص السؤال فقط",
      "options": [
        { "label": "أ", "text": "الخيار الأول" },
        { "label": "ب", "text": "الخيار الثاني" },
        { "label": "ج", "text": "الخيار الثالث" },
        { "label": "د", "text": "الخيار الرابع" }
      ],
      "question_images": [
        {
          "image_id": "img-0.jpeg",
          "page_index": 0,
          "short_description": "رسم بياني"
        }
      ],
      "correct_answer": null,
      "correct_answer_index": null,
      "correct_answer_inferred": false
    }
  ],
  "notes": "ملاحظات اختيارية"
}

نص ونتيجة OCR:
${input.documentContext}`;
}
function buildImageAnnotationFormat() {
    return {
        type: 'json_schema',
        json_schema: {
            name: 'question_image_annotation',
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    image_type: { type: 'string' },
                    short_description: { type: 'string' },
                    summary: { type: 'string' },
                    educational_relevance: { type: 'string' },
                    contains_text: { type: 'boolean' },
                    extracted_text: { type: ['string', 'null'] },
                },
                required: [
                    'image_type',
                    'short_description',
                    'summary',
                    'educational_relevance',
                    'contains_text',
                    'extracted_text',
                ],
            },
            strict: true,
        },
    };
}
