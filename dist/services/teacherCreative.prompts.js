"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TEACHER_CREATIVE_ASPECT_RATIOS = exports.TEACHER_CREATIVE_TONES = exports.TEACHER_CREATIVE_PLATFORMS = void 0;
exports.normalizeTeacherCreativePlatform = normalizeTeacherCreativePlatform;
exports.normalizeTeacherCreativeTone = normalizeTeacherCreativeTone;
exports.normalizeTeacherCreativeAspectRatio = normalizeTeacherCreativeAspectRatio;
exports.buildTeacherPostSystemPrompt = buildTeacherPostSystemPrompt;
exports.buildTeacherPostUserPrompt = buildTeacherPostUserPrompt;
exports.buildTeacherImageCopySystemPrompt = buildTeacherImageCopySystemPrompt;
exports.buildTeacherImageCopyUserPrompt = buildTeacherImageCopyUserPrompt;
exports.buildTeacherImagePrompt = buildTeacherImagePrompt;
exports.TEACHER_CREATIVE_PLATFORMS = [
    {
        value: 'facebook',
        label_ar: 'فيسبوك',
        description_ar: 'منشور واضح مناسب للنسخ والنشر على صفحة المدرس أو جروب الطلاب.',
    },
    {
        value: 'instagram',
        label_ar: 'إنستجرام',
        description_ar: 'نص قصير وجذاب مناسب للكابشن مع هاشتاجات قليلة.',
    },
    {
        value: 'whatsapp',
        label_ar: 'واتساب',
        description_ar: 'رسالة مختصرة ومباشرة تصلح للإرسال في الجروبات.',
    },
    {
        value: 'tiktok',
        label_ar: 'تيك توك',
        description_ar: 'نص سريع وحماسي يصلح كفكرة فيديو أو وصف قصير.',
    },
    { value: 'general', label_ar: 'عام', description_ar: 'صياغة عامة يمكن تعديلها لأي منصة.' },
];
exports.TEACHER_CREATIVE_TONES = [
    { value: 'friendly', label_ar: 'ودود وبسيط' },
    { value: 'professional', label_ar: 'احترافي' },
    { value: 'motivational', label_ar: 'تحفيزي' },
    { value: 'promotional', label_ar: 'تسويقي' },
];
exports.TEACHER_CREATIVE_ASPECT_RATIOS = [
    { value: '1:1', label_ar: 'مربع', description_ar: 'مناسب لفيسبوك وإنستجرام.' },
    { value: '4:5', label_ar: 'بوست رأسي', description_ar: 'مناسب لمنشورات إنستجرام وفيسبوك.' },
    { value: '9:16', label_ar: 'ستوري/ريلز', description_ar: 'مناسب للقصص والفيديوهات القصيرة.' },
    { value: '16:9', label_ar: 'أفقي', description_ar: 'مناسب للغلاف أو العرض.' },
];
const PLATFORM_GUIDANCE = {
    facebook: 'اكتب منشور فيسبوك متوسط الطول، بفقرات قصيرة، ودعوة واضحة للتفاعل أو الحجز.',
    instagram: 'اكتب كابشن إنستجرام قصير وجذاب، مع 3 إلى 6 هاشتاجات عربية مناسبة فقط.',
    whatsapp: 'اكتب رسالة واتساب مباشرة ومختصرة بدون هاشتاجات، مناسبة للإرسال في جروب.',
    tiktok: 'اكتب نصاً حماسياً يصلح كوصف فيديو قصير أو فكرة فيديو، بجمل سريعة.',
    general: 'اكتب نصاً عاماً سهل النسخ ويمكن نشره على أي منصة اجتماعية.',
};
const TONE_GUIDANCE = {
    friendly: 'لهجة ودودة، بسيطة، قريبة من الطالب وولي الأمر.',
    professional: 'لهجة احترافية ومنظمة، بدون مبالغة أو وعود غير واقعية.',
    motivational: 'لهجة مشجعة ترفع حماس الطلاب وتدعوهم للالتزام.',
    promotional: 'لهجة تسويقية مقنعة، مع إبراز القيمة بدون ضغط أو ادعاءات زائدة.',
};
function normalizeTeacherCreativePlatform(platform) {
    const value = String(platform || '')
        .trim()
        .toLowerCase();
    return ['facebook', 'instagram', 'whatsapp', 'tiktok', 'general'].includes(value)
        ? value
        : 'general';
}
function normalizeTeacherCreativeTone(tone) {
    const value = String(tone || '')
        .trim()
        .toLowerCase();
    return ['friendly', 'professional', 'motivational', 'promotional'].includes(value)
        ? value
        : 'friendly';
}
function normalizeTeacherCreativeAspectRatio(aspectRatio) {
    const value = String(aspectRatio || '').trim();
    return ['1:1', '4:5', '9:16', '16:9'].includes(value)
        ? value
        : '1:1';
}
function buildTeacherPostSystemPrompt() {
    return `أنت مساعد تسويق عربي للمدرسين على منصة تعليمية.

القواعد الثابتة:
- اكتب بالعربية فقط، وبأسلوب مفهوم للطلاب وأولياء الأمور.
- لا تخترع أسعاراً أو مواعيد أو أرقام تواصل إذا لم يذكرها المدرس.
- لا تذكر أنك ذكاء اصطناعي.
- اجعل النص جاهزاً للنسخ والنشر مباشرة.
- تجنب الوعود المبالغ فيها مثل "اضمن الدرجة النهائية".
- لو احتاج النص بيانات ناقصة، ضع مكانها صياغة عامة بدلاً من سؤال المدرس.
- لا تستخدم Markdown عناوين ثقيلة؛ استخدم فقرات بسيطة فقط.`;
}
function buildTeacherPostUserPrompt(input) {
    const platform = normalizeTeacherCreativePlatform(input.platform);
    const tone = normalizeTeacherCreativeTone(input.tone);
    return `طلب المدرس:
${input.prompt.trim()}

المنصة: ${platform}
تعليمات المنصة: ${PLATFORM_GUIDANCE[platform]}
النبرة المطلوبة: ${TONE_GUIDANCE[tone]}

أمثلة للأسلوب:
- "ابدأ رحلتك في مذاكرة منظمة من النهارده، وخلي كل حصة خطوة أقرب لهدفك."
- "لو ابنك محتاج شرح بسيط وتدريب مستمر، المحتوى الجاي معمول مخصوص عشان يساعده يثبت المعلومة."

اكتب منشوراً واحداً فقط.`;
}
function buildTeacherImageCopySystemPrompt() {
    return `أنت كاتب إعلانات عربي للتصميمات التعليمية.

المطلوب استخراج نص قصير جداً سيتم إرساله لموديل الصور ليكتبه داخل التصميم نفسه.

القواعد:
- اكتب بالعربية فقط.
- لا تخترع أسعاراً أو مواعيد أو أرقام تواصل إن لم يذكرها المدرس.
- لا تستخدم وعوداً مبالغاً فيها مثل "اضمن الدرجة النهائية".
- اجعل النص مناسباً للظهور على تصميم موبايل.
- أجب JSON فقط بدون Markdown.
- الحقول المطلوبة:
  - headline: عنوان قوي جداً، بحد أقصى 42 حرفاً.
  - subheadline: سطر مساعد، بحد أقصى 70 حرفاً، يمكن أن يكون فارغاً.
  - cta: دعوة قصيرة لاتخاذ إجراء، بحد أقصى 28 حرفاً، يمكن أن تكون فارغة.

الشكل:
{"headline":"...","subheadline":"...","cta":"..."}`;
}
function buildTeacherImageCopyUserPrompt(input) {
    const platform = normalizeTeacherCreativePlatform(input.platform);
    const aspectRatio = normalizeTeacherCreativeAspectRatio(input.aspectRatio);
    return `طلب المدرس:
${input.prompt.trim()}

المنصة: ${platform}
المقاس: ${aspectRatio}

استخرج النص العربي المختصر المناسب للتركيب على الصورة.`;
}
function buildTeacherImagePrompt(input) {
    const platform = normalizeTeacherCreativePlatform(input.platform);
    const aspectRatio = normalizeTeacherCreativeAspectRatio(input.aspectRatio);
    const referenceCount = Math.max(0, Number(input.referenceCount || 0));
    const copyLines = [
        input.imageCopy?.headline,
        input.imageCopy?.subheadline,
        input.imageCopy?.cta,
    ].filter(Boolean);
    return `صمم صورة تسويقية عربية كاملة لمدرس، وتشمل النص العربي واللوجو داخل التصميم نفسه.

طلب المدرس:
${input.prompt.trim()}

قواعد التصميم:
- المقاس المطلوب: ${aspectRatio}.
- المنصة المستهدفة: ${platform}.
- اجعل التصميم واضحاً، عصرياً، مناسباً للتعليم.
- اكتب النص العربي داخل الصورة نفسها بخط واضح وكبير وقابل للقراءة.
- لا تستخدم حروفاً عربية مكسورة أو رموزاً تشبه العربية. يجب أن تكون الكلمات العربية صحيحة ومقروءة.
- استخدم نصاً قليلاً فقط حتى لا يزدحم التصميم.
- ضع لوجو المنصة داخل التصميم نفسه كعلامة/شعار واضح.
- لا تضف شعاراً وهمياً أو علامة تجارية غير معروفة غير اللوجو المرفق.
- استخدم ألواناً مريحة وتعليمية وتبايناً جيداً للقراءة.
- إن كان الطلب عن إعلان حصة أو كورس، اجعل الرسالة مختصرة وقابلة للقراءة من الموبايل.

${copyLines.length
        ? `النص العربي المطلوب كتابته داخل الصورة كما هو:
${copyLines.map((line, index) => `${index + 1}. ${line}`).join('\n')}`
        : 'استخرج من طلب المدرس نصاً عربياً قصيراً ومقروءاً وضعه داخل التصميم.'}

قواعد العلامة التجارية:
- ${input.logoAttached
        ? 'يوجد لوجو رسمي مرفق كصورة input. يجب استخدامه داخل التصميم نفسه بدون تشويه.'
        : 'استخدم هوية بصرية تعليمية نظيفة.'}
- استلهم ألوان التصميم والثيم العام من اللوجو الرسمي المرفق.
- ضع اللوجو في زاوية مناسبة أو ضمن مساحة العلامة التجارية بشكل واضح واحترافي.

${referenceCount > 0
        ? `يوجد ${referenceCount} صور مرجعية إضافية مرفقة يريد المدرس الاقتباس من أسلوبها أو ألوانها.
استلهم الأسلوب العام فقط ولا تنسخ التصميم حرفياً.`
        : 'لا توجد صور مرجعية مرفقة.'}`;
}
