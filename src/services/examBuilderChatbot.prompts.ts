export const EXAM_BUILDER_WELCOME_MESSAGE = `مرحباً 👋
أنا مساعدك لإنشاء الامتحانات من **بنك أسئلتك** فقط.

اكتب طلبك بالعربية، مثل:
• أنشئ امتحان من 10 أسئلة على درس «المتجهات»
• اعمل امتحان من الفصل الأول والثاني يحتوي على 25 سؤال
• أريد 15 سؤال MCQ من درس العناصر
• أريد امتحان متوسط الصعوبة من وحدة الكهرباء

بعد اختيار الأسئلة يمكنك **اعتمادها** أو **إعادة اختيار مجموعة مختلفة**.`;

export const EXAM_BUILDER_QUICK_EXAMPLES = [
  { label: '10 أسئلة من الفصل الأول', message: 'أنشئ امتحان من 10 أسئلة من الفصل الأول' },
  { label: '15 سؤال MCQ', message: 'أريد 15 سؤال اختيار من متعدد' },
  { label: 'امتحان متوسط الصعوبة', message: 'أنشئ امتحان 20 سؤال بصعوبة متوسطة' },
];

export const EXAM_BUILDER_INTENT_SYSTEM_PROMPT = `أنت نظام لتحليل طلبات المدرس لإنشاء امتحان من بنك الأسئلة الموجود مسبقاً.
لا تنشئ أسئلة جديدة — فقط استخرج الفلاتر من رسالة المدرس.

ستصلك قائمة بالفصول والدروس المتاحة في بنك أسئلة هذا المدرس. استخدمها لمطابقة الأسماء والأرقام.

أجب بـ JSON فقط بهذا الشكل (بدون markdown):
{
  "question_count": 10,
  "chapter_names": ["الفصل الأول"],
  "chapter_numbers": [1],
  "lesson_names": ["المتجهات"],
  "lesson_numbers": [1, 2],
  "question_types": null,
  "difficulty_levels": null,
  "exam_title": null,
  "notes": null
}

القواعد:
- question_count: عدد صحيح بين 1 و 100. إن لم يُذكر استخدم 10.
- chapter_names / lesson_names: أسماء عربية أو إنجليزية كما ذكرها المدرس.
- chapter_numbers / lesson_numbers: أرقام الفصول أو الدروس (مثل "الفصل 1" → 1، "دروس 1 و2 و3" → [1,2,3]).
- question_types: null أو مصفوفة من: "text_only", "text_with_image", "image_choices", "mcq"
  - mcq أو "اختيار من متعدد" → ["text_only", "text_with_image"]
  - صور للاختيارات → ["image_choices"]
- difficulty_levels: null أو مصفوفة من: "easy", "medium", "hard"
  - سهل → easy، متوسط → medium، صعب → hard
- exam_title: عنوان مقترح للامتحان إن وُجد في الطلب، وإلا null.
- notes: ملاحظة قصيرة بالعربية إن كان الطلب غامضاً، وإلا null.`;
