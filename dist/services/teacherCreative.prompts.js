"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_TEACHER_CREATIVE_LANGUAGE = exports.TEACHER_CREATIVE_LANGUAGES = exports.TEACHER_CREATIVE_ASPECT_RATIOS = exports.TEACHER_CREATIVE_TONES = exports.TEACHER_CREATIVE_PLATFORMS = void 0;
exports.normalizeTeacherCreativePlatform = normalizeTeacherCreativePlatform;
exports.normalizeTeacherCreativeTone = normalizeTeacherCreativeTone;
exports.normalizeTeacherCreativeAspectRatio = normalizeTeacherCreativeAspectRatio;
exports.normalizeTeacherCreativeLanguageMode = normalizeTeacherCreativeLanguageMode;
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
exports.TEACHER_CREATIVE_LANGUAGES = [
    { value: 'arabic', label_ar: 'عربي', description_ar: 'اكتب النصوص داخل التصميم بالعربية.' },
    { value: 'english', label_ar: 'إنجليزي', description_ar: 'اكتب النصوص داخل التصميم بالإنجليزية.' },
    { value: 'mixed', label_ar: 'مختلط', description_ar: 'استخدم العربية والإنجليزية عند الحاجة.' },
];
exports.DEFAULT_TEACHER_CREATIVE_LANGUAGE = 'arabic';
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
function normalizeTeacherCreativeLanguageMode(language) {
    const value = String(language || '')
        .trim()
        .toLowerCase();
    return ['arabic', 'english', 'mixed'].includes(value)
        ? value
        : exports.DEFAULT_TEACHER_CREATIVE_LANGUAGE;
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
    const languageMode = normalizeTeacherCreativeLanguageMode(input.languageMode);
    const referenceCount = Math.max(0, Number(input.referenceCount || 0));
    const copyLines = [
        input.imageCopy?.headline,
        input.imageCopy?.subheadline,
        input.imageCopy?.cta,
    ].filter(Boolean);
    const teacherName = input.teacherContext?.teacherName?.trim();
    const profileSubject = input.teacherContext?.profileSubject?.trim();
    const assignedSubjects = (input.teacherContext?.assignedSubjects || [])
        .map((subject) => subject.trim())
        .filter(Boolean);
    const subjectNames = Array.from(new Set([profileSubject, ...assignedSubjects].filter(Boolean)));
    const primarySubject = subjectNames[0] || 'المادة التعليمية';
    const languageGuidance = {
        arabic: 'اكتب كل النصوص الظاهرة داخل التصميم بالعربية فقط.',
        english: 'Write all visible text inside the design in clear English only.',
        mixed: 'استخدم العربية كلغة أساسية، ويمكن إضافة كلمات إنجليزية قصيرة فقط إذا كانت مناسبة للتصميم.',
    };
    return `صمم صورة تسويقية تعليمية كاملة لمدرس، وتشمل النص واللوجو داخل التصميم نفسه.

طلب المدرس:
${input.prompt.trim()}

بيانات المدرس من قاعدة البيانات:
- اسم المدرس: ${teacherName || 'غير متوفر'}.
- مادة البروفايل: ${profileSubject || 'غير متوفرة'}.
- المواد المخصصة: ${assignedSubjects.length ? assignedSubjects.join('، ') : 'غير متوفرة'}.

قواعد التصميم:
- المقاس المطلوب: ${aspectRatio}.
- المنصة المستهدفة: ${platform}.
- وضع اللغة: ${languageMode}.
- ${languageGuidance[languageMode]}
- أضف اسم المدرس داخل التصميم بوضوح${teacherName ? ` كما هو: ${teacherName}` : ''}.
- استخدم خلفية مرتبطة بالمادة الأساسية (${primarySubject})، مثل رموز أو ألوان أو عناصر تعليمية مناسبة للمادة بدون ازدحام.
- اجعل التصميم واضحاً، عصرياً، مناسباً للتعليم.
- اكتب النص داخل الصورة نفسها بخط واضح وكبير وقابل للقراءة.
- لا تستخدم حروفاً عربية مكسورة أو رموزاً تشبه العربية عند استخدام العربية. يجب أن تكون الكلمات صحيحة ومقروءة.
- استخدم نصاً قليلاً فقط حتى لا يزدحم التصميم.
- ضع لوجو المنصة داخل التصميم نفسه كعلامة/شعار واضح.
- لا تضف شعاراً وهمياً أو علامة تجارية غير معروفة غير اللوجو المرفق.
- استخدم ألواناً مريحة وتعليمية وتبايناً جيداً للقراءة.
- إن كان الطلب عن إعلان حصة أو كورس، اجعل الرسالة مختصرة وقابلة للقراءة من الموبايل.

${copyLines.length
        ? `النص المطلوب كتابته داخل الصورة كما هو:
${copyLines.map((line, index) => `${index + 1}. ${line}`).join('\n')}`
        : 'استخرج من طلب المدرس نصاً قصيراً ومقروءاً وضعه داخل التصميم مع الالتزام بوضع اللغة المطلوب.'}

قواعد العلامة التجارية:
- ${input.logoAttached
        ? 'يوجد لوجو رسمي مرفق كصورة input. يجب استخدامه داخل التصميم نفسه بدون تشويه.'
        : 'استخدم هوية بصرية تعليمية نظيفة.'}
- استلهم ألوان التصميم والثيم العام من اللوجو الرسمي المرفق.
- ${input.logoAttached
        ? 'ضع اللوجو في زاوية (أعلى اليسار، أعلى اليمين، أو الأسفل) بحجم صغير، مع خلفية دائرية أو مدورة خفيفة خلفه ليظهر بوضوح عن خلفية الصورة الأصلية.'
        : 'ضع اللوجو في زاوية مناسبة أو ضمن مساحة العلامة التجارية بشكل واضح واحترافي.'}
- ${input.teacherContext?.avatarAttached
        ? 'يوجد أفتار/صورة المدرس مرفقة كمرجع بصري. استخدمها كمرجع لهوية المدرس أو أدرجها داخل التصميم إذا كان ذلك مناسباً بدون تشويه.'
        : 'لا توجد صورة مدرس مرفقة.'}
- ${input.editBaseAttached
        ? 'يوجد التصميم السابق مرفق كصورة أساسية. عدّل هذا التصميم نفسه حسب طلب المدرس وحافظ على روحه وتنسيقه العام ما لم يطلب المدرس تغييرهما.'
        : 'ابدأ تصميماً جديداً من الصفر حسب الطلب.'}

${referenceCount > 0
        ? `يوجد ${referenceCount} صور مرجعية إضافية مرفقة يريد المدرس الاقتباس من أسلوبها أو ألوانها.
استلهم الأسلوب العام فقط ولا تنسخ التصميم حرفياً.`
        : 'لا توجد صور مرجعية مرفقة.'}`;
}
