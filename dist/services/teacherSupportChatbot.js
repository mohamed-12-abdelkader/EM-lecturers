"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TEACHER_QUICK_BUTTONS = exports.TEACHER_DAILY_GREETING = void 0;
exports.detectTeacherIntent = detectTeacherIntent;
exports.formatTeacherDailyReportForChat = formatTeacherDailyReportForChat;
exports.formatTeacherDailyReportsForChat = formatTeacherDailyReportsForChat;
exports.handleTeacherMessage = handleTeacherMessage;
const utils_1 = require("../utils");
const teacherDailyCourseReport_1 = require("./teacherDailyCourseReport");
const teacherReports_1 = require("./teacherReports");
const DEEPSEEK_API_URL = `${utils_1.config.DEEPSEEK_API_URL}/v1/chat/completions`;
/** رسالة التقرير اليومي التلقائية للمدرس */
exports.TEACHER_DAILY_GREETING = `صباح الخير 👋
هل تواجه أي مشاكل في المنصة أو مشاكل يواجهها طلابك تحب نوصلها للإدارة؟
وأيضاً أقدر أساعدك في:
1️⃣ تقرير مفصل عن مستوى طلابك
2️⃣ أفكار تساعدك في تحسين التفاعل أو التسويق`;
/** أزرار سريعة مقترحة (للعرض في الواجهة) */
exports.TEACHER_QUICK_BUTTONS = [
    { label: 'تقرير طلابي', payload: 'تقرير مستوى الطلاب' },
    { label: 'تقرير طالب بالاسم', payload: 'تقرير الطالب ' },
    { label: 'فكرة تسويقية', payload: 'أفكار تسويقية' },
    { label: 'الإبلاغ عن مشكلة', payload: 'أريد الإبلاغ عن مشكلة' },
];
/** كلمات تدل على طلب تقرير الطلاب */
const REPORT_KEYWORDS = [
    'تقرير',
    'مستوى الطلاب',
    'تقرير الطلاب',
    'تقرير طلابي',
    'تقرير مفصل',
    'أداء الطلاب',
    'إحصائيات',
    'تقريري',
    'تقرير الكورس',
];
/** كلمات تدل على طلب أفكار تسويقية */
const MARKETING_KEYWORDS = [
    'أفكار تسويقية',
    'فكرة تسويقية',
    'تسويق',
    'تسويق الكورس',
    'زيادة التفاعل',
    'منشور',
    'فيسبوك',
    'إعلان',
    'نصيحة تسويقية',
    'كيف أروج',
];
/** طلب تقرير طالب معين بالاسم أو الكود */
const STUDENT_REPORT_PREFIXES = [
    'تقرير الطالب',
    'تقرير طالب',
    'تقرير عن الطالب',
    'تقرير عن طالب',
];
/** كلمات تدل على شكوى أو مشكلة */
const PROBLEM_KEYWORDS = [
    'مشكلة',
    'شكوى',
    'لا يعمل',
    'خطأ',
    'bug',
    'مشكلة تقنية',
    'طلابي',
    'كود',
    'أكواد',
    'تفعيل',
    'الامتحان',
    'امتحانات',
    'لم يستطيع',
    'لا يستطيع',
    'بلاغ',
    'أبلغ',
    'الإبلاغ',
];
function normalizeText(t) {
    return t
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .replace(/[أةؤإئ]/g, 'ا');
}
function containsAny(text, keywords) {
    const n = normalizeText(text);
    return keywords.some((k) => n.includes(normalizeText(k)));
}
/**
 * تحليل رسالة المدرس بالـ LLM لمعرفة هل هي مشكلة (شكوى) أم طلب (تقرير / أفكار / غيره)
 */
async function detectTeacherIntent(message) {
    const systemPrompt = `أنت نظام لتحليل رسائل مدرس في شات دعم فني.
حدد نية الرسالة بدقة. الصنف واحد فقط من التالي:

1. problem - شكوى أو مشكلة تحتاج تحويل للإدارة (مثلاً: شيء لا يعمل، خطأ تقني، طلاب يواجهون مشكلة، أكواد لا تعمل، امتحان فيه غلط، بلاغ، استفسار عن مشكلة، أي شيء يبدو شكوى أو إبلاغ عن خلل).
2. report - طلب تقرير أو إحصائيات عن الطلاب أو الكورس (تقرير، مستوى الطلاب، إحصائيات، أداء الطلاب).
3. marketing - طلب أفكار تسويقية أو تحسين التفاعل أو منشورات أو تسويق.
4. other - تحية، سؤال عام، أو أي شيء لا ينتمي للأصناف أعلاه.

أجب بـ JSON فقط بهذا الشكل ولا شيء غيره:
{"intent":"problem"}
أو {"intent":"report"}
أو {"intent":"marketing"}
أو {"intent":"other"}`;
    try {
        const response = await fetch(DEEPSEEK_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${utils_1.config.DEEPSEEK_API_KEY}`,
            },
            body: JSON.stringify({
                model: 'deepseek-chat',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: message.trim() },
                ],
                temperature: 0.2,
                max_tokens: 50,
            }),
        });
        if (!response.ok) {
            return 'other';
        }
        const data = (await response.json());
        const content = data.choices?.[0]?.message?.content?.trim();
        if (!content)
            return 'other';
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
        const intent = parsed?.intent;
        if (['problem', 'report', 'marketing', 'other'].includes(intent)) {
            return intent;
        }
    }
    catch (_e) {
        // fallback to keywords
    }
    return 'other';
}
/** خيارات تنسيق التقرير (مثلاً إخفاء السطر الختامي عند دمج تقارير متعددة) */
const DEFAULT_FORMAT_OPTS = { skipClosing: false };
/**
 * تحويل تقرير الكورس اليومي إلى رسالة منسقة للشات
 */
function formatTeacherDailyReportForChat(report, opts = DEFAULT_FORMAT_OPTS) {
    const { skipClosing } = { ...DEFAULT_FORMAT_OPTS, ...opts };
    const lines = [];
    if (!report.course) {
        return 'لا يوجد كورس لديك حالياً. عند إنشاء كورس والعمل عليه ستظهر هنا تقارير مفصلة.';
    }
    const title = report.course.grade_name?.trim()
        ? `📊 **تقرير ${report.course.grade_name}: ${report.course.course_title}**`
        : `📊 **تقرير الكورس: ${report.course.course_title}**`;
    lines.push(title);
    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push('**إحصائيات الطلاب:**');
    lines.push(`• إجمالي الطلاب: ${report.students_stats.total_enrolled}`);
    lines.push(`• طلاب جدد اليوم: ${report.students_stats.enrolled_today}`);
    lines.push(`• طلاب نشطون: ${report.students_stats.active_count}`);
    lines.push(`• طلاب غير نشطين: ${report.students_stats.inactive_count}`);
    lines.push('');
    lines.push('**تفاعل المحاضرات:**');
    lines.push(`• عدد من شاهدوا آخر محاضرة: ${report.lecture_stats.last_lecture_watchers_count}`);
    lines.push(`• متوسط المشاهدة: ${report.lecture_stats.average_watch_percentage}%`);
    lines.push('');
    if (report.last_exam) {
        lines.push('**آخر امتحان:**');
        lines.push(`• عدد من أدوا الامتحان: ${report.last_exam.students_attempted}`);
        lines.push(`• نسبة النجاح: ${report.last_exam.success_rate}%`);
        lines.push(`• نسبة التفوق (أكثر من 85%): ${report.last_exam.excellence_rate}%`);
        lines.push('');
    }
    if (report.weak_questions && report.weak_questions.length > 0) {
        lines.push('**نقاط تحتاج تركيز (أسئلة نسبة الخطأ فيها مرتفعة):**');
        report.weak_questions.slice(0, 10).forEach((q, i) => {
            const display = q.question_text
                ? q.question_text.slice(0, 120) + (q.question_text.length > 120 ? '...' : '')
                : q.question_image
                    ? '[صورة السؤال]'
                    : 'سؤال';
            lines.push(`${i + 1}. ${display}`);
            lines.push(`   نسبة الخطأ: ${q.wrong_rate}% | عدد من أخطأ: ${q.students_wrong_count}`);
        });
        if (report.weak_questions.length > 10) {
            lines.push(`... و${report.weak_questions.length - 10} سؤال آخر.`);
        }
    }
    else {
        lines.push('**نقاط تحتاج تركيز:** لا توجد أسئلة نسبة الخطأ فيها مرتفعة حالياً.');
    }
    lines.push('');
    lines.push('---');
    if (!skipClosing) {
        lines.push('');
        lines.push('أي سؤال آخر؟ اكتب هنا وسأساعدك. 😊');
    }
    return lines.join('\n');
}
/**
 * تحويل عدة تقارير (تقرير لكل صف) إلى رسالة واحدة للشات
 */
function formatTeacherDailyReportsForChat(reports) {
    if (!reports.length) {
        return 'لا يوجد كورس لديك حالياً. عند إنشاء كورس والعمل عليه ستظهر هنا تقارير مفصلة.';
    }
    const header = '📊 **تقرير الكورسات (مستوى الطلاب لكل صف):**';
    const parts = reports.map((r) => formatTeacherDailyReportForChat(r, { skipClosing: true }));
    return header + '\n\n' + parts.join('\n\n') + '\n\nأي سؤال آخر؟ اكتب هنا وسأساعدك. 😊';
}
/**
 * هل الرسالة طلب تقرير طالب معين؟ نستخرج الاسم أو كود الطالب.
 * يدعم أن تظهر العبارة في أي مكان في النص (مثلاً: عايز تقرير الطالب أحمد).
 */
function parseStudentReportRequest(text) {
    const t = text.trim().replace(/\s+/g, ' ');
    for (const prefix of STUDENT_REPORT_PREFIXES) {
        const p = prefix.replace(/\s+/g, ' ').trim();
        const regex = new RegExp(p.replace(/\s+/g, '\\s+'), 'i');
        const match = t.match(regex);
        if (!match)
            continue;
        const rest = t.slice(match.index + match[0].length).trim();
        if (!rest)
            continue;
        const num = /^\d+$/.test(rest) ? parseInt(rest, 10) : NaN;
        if (!Number.isNaN(num))
            return { type: 'id', value: num };
        return { type: 'name', value: rest };
    }
    return null;
}
/** هل الرسالة تعبّر عن نية "تقرير طالب" لكن بدون اسم أو كود؟ (مثلاً: عايز تقرير طالب) */
function hasStudentReportIntentWithoutName(text) {
    if (parseStudentReportRequest(text))
        return false;
    const t = text.trim().replace(/\s+/g, ' ');
    for (const prefix of STUDENT_REPORT_PREFIXES) {
        const p = prefix.replace(/\s+/g, ' ').trim();
        const regex = new RegExp(p.replace(/\s+/g, '\\s+'), 'i');
        const match = t.match(regex);
        if (!match)
            continue;
        const rest = t.slice(match.index + match[0].length).trim();
        if (!rest || /^[،,.؟!\-]+$/.test(rest))
            return true;
    }
    return false;
}
/** هل الرسالة تطلب تقريراً عاماً عن الكورسات (وليس طالب معين)؟ */
function isGeneralReportRequest(text) {
    if (parseStudentReportRequest(text))
        return false;
    if (hasStudentReportIntentWithoutName(text))
        return false;
    return containsAny(text, REPORT_KEYWORDS);
}
/** هل آخر رسالة من البوت تطلب كود الطالب (بعد وجود أكثر من طالب بنفس الاسم)؟ */
function isLastBotMessageAskingForStudentCode(messages) {
    if (!messages.length)
        return false;
    const last = messages[messages.length - 1];
    if (last.role !== 'admin' || !last.text)
        return false;
    const t = normalizeText(last.text);
    return t.includes('اكثر من طالب') || t.includes('أكثر من طالب') || (t.includes('كود الطالب') && t.includes('لتحديد'));
}
/** من رسالة متابعة (رقم فقط أو "تقرير الطالب 123") نستخرج كود الطالب إن وُجد */
function extractStudentIdFromFollowUp(text) {
    const t = text.trim().replace(/\s+/g, ' ');
    if (/^\d+$/.test(t))
        return parseInt(t, 10);
    const studentReportReq = parseStudentReportRequest(t);
    if (studentReportReq && studentReportReq.type === 'id')
        return studentReportReq.value;
    return null;
}
/** تنسيق تقرير الطالب المفصل للشات */
function formatStudentReportForChat(report) {
    const lines = [];
    const s = report.student;
    lines.push(`👤 **الطالب:** ${s.name}`);
    lines.push(`📧 ${s.email}${s.phone ? ` | 📱 ${s.phone}` : ''}`);
    lines.push(`🆔 كود الطالب: ${s.id}`);
    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push('**ملخص إجمالي:**');
    lines.push(`• مشترك معك في **${report.overallStatistics.totalCourses}** كورس/كورسات`);
    lines.push(`• إجمالي المحاضرات: ${report.overallStatistics.totalLectures} | شاهد: ${report.overallStatistics.watchedLectures}`);
    lines.push(`• إجمالي الامتحانات: ${report.overallStatistics.totalExams} | حل: ${report.overallStatistics.submittedExams}`);
    const avgGrade = report.overallStatistics.overallAverageGrade ?? 0;
    lines.push(`• الدرجة المتوسطة: ${avgGrade}%`);
    const watchPct = report.overallStatistics.watch_percentage ?? 0;
    lines.push(`• نسبة المشاهدة الإجمالية: ${watchPct}%`);
    lines.push('');
    report.courses.forEach((c, i) => {
        lines.push(`**📚 ${i + 1}. ${c.courseTitle}**`);
        lines.push(`   محاضرات: ${c.watchedLecturesCount}/${c.totalLectures} | امتحانات محلولة: ${c.statistics.submittedExams}/${c.statistics.totalExams}`);
        lines.push(`   درجة متوسطة: ${c.statistics.averageGrade}% | نسبة مشاهدة: ${c.statistics.watch_percentage ?? c.watch_percentage ?? 0}%`);
        lines.push('');
    });
    lines.push('---');
    lines.push('');
    lines.push('أي سؤال آخر؟ اكتب هنا وسأساعدك. 😊');
    return lines.join('\n');
}
/** أفكار تسويقية/تفاعل (دوران عشوائي) */
const MARKETING_TIPS = [
    '**أفضل وقت لإرسال رسالة لطلابك:** الصباح الباكر (7–9) أو بعد المغرب (8–10) حيث يكون التفاعل أعلى.',
    '**فكرة منشور لصفحتك:** "طلابي اللي حلوا الامتحان الأخير – مين جاهز للمراجعة؟ 💪" مع صورة أو فيديو قصير للمراجعة.',
    '**زيادة التفاعل في أول محاضرة:** ابدأ بسؤال سريع (استطلاع أو سؤال مفتوح) قبل الشرح ليشعر الطالب بالمشاركة.',
    '**نصيحة تسويقية:** انشر قصص نجاح طلاب (بإذنهم) أو مقتبسات من تعليقاتهم على الكورس – الثقة الاجتماعية تزيد التسجيل.',
    '**منشور فيسبوك مقترح:** "من غير ما تروح المحاضرة – كل المحتوى عندك أونلاين مع تمارين وامتحانات. الرابط في البايو 🔗"',
    '**تحسين التفاعل:** أضف امتحان قصير بعد كل محاضرتين؛ الطلاب يتابعون أكثر عندما يشعرون بتقدم واضح.',
    '**تسويق الكورس:** وضح في الوصف "ماذا سيتعلم الطالب بالضبط" و"كم محاضرة + امتحانات" – الوضوح يزيد الثقة.',
];
function getRandomMarketingTip() {
    const tip = MARKETING_TIPS[Math.floor(Math.random() * MARKETING_TIPS.length)];
    return `💡 **فكرة لك:**\n\n${tip}\n\nلو حابب أفكار أكثر، اكتب "أفكار تسويقية" أو "فكرة أخرى".`;
}
/**
 * معالجة رسالة المدرس: تحليل بالكلمات المفتاحية أولاً، ثم بالـ LLM إن لزم، وتحديد الرد والإجراء.
 * إن وُجدت recentMessages يُستخدم سياق الشات لفهم المتابعة (مثلاً إرسال كود الطالب بعد طلب البوت).
 */
async function handleTeacherMessage(text, teacherId, recentMessages) {
    const trimmed = text.trim();
    if (!trimmed) {
        return {
            intent: 'other',
            reply: 'اكتب لي ما تحتاجه: تقرير عن طلابك، تقرير طالب معين بالاسم، أفكار تسويقية، أو أي مشكلة تواجهها.',
        };
    }
    // 0.1) متابعة: البوت طلب كود الطالب والآن المدرس أرسل الرقم (أو "تقرير الطالب 123")
    if (recentMessages?.length && isLastBotMessageAskingForStudentCode(recentMessages)) {
        const studentId = extractStudentIdFromFollowUp(trimmed);
        if (studentId != null) {
            try {
                const report = await teacherReports_1.TeacherReportsService.getStudentDetailedReport(teacherId, studentId);
                return {
                    intent: 'report',
                    reply: '📋 **تقرير الطالب المطلوب:**\n\n' + formatStudentReportForChat(report),
                };
            }
            catch (e) {
                const msg = e?.message || 'حدث خطأ';
                return {
                    intent: 'report',
                    reply: `تعذر جلب تقرير الطالب بالكود ${studentId}. (${msg}) تأكد أن الطالب مشترك في أحد كورساتك.`,
                };
            }
        }
    }
    // 0) تقرير طالب معين بالاسم أو الكود (تقرير الطالب أحمد / تقرير الطالب 10)
    const studentReportReq = parseStudentReportRequest(trimmed);
    if (studentReportReq) {
        try {
            if (studentReportReq.type === 'id') {
                const report = await teacherReports_1.TeacherReportsService.getStudentDetailedReport(teacherId, studentReportReq.value);
                return {
                    intent: 'report',
                    reply: '📋 **تقرير الطالب المطلوب:**\n\n' + formatStudentReportForChat(report),
                };
            }
            const result = await teacherReports_1.TeacherReportsService.getStudentReportByName(teacherId, studentReportReq.value);
            if ('report' in result) {
                return {
                    intent: 'report',
                    reply: '📋 **تقرير الطالب المطلوب:**\n\n' + formatStudentReportForChat(result.report),
                };
            }
            const matchLines = result.matches
                .map((m) => `• **${m.name}** — كود الطالب: \`${m.id}\``)
                .join('\n');
            return {
                intent: 'report',
                reply: `⚠️ **وجد أكثر من طالب بنفس الاسم.**\n\n${matchLines}\n\nلتحديد الطالب بدقة أرسل كود الطالب (الرقم) بهذا الشكل:\n**تقرير الطالب** ثم رقم الكود، مثل: **تقرير الطالب ${result.matches[0].id}**`,
            };
        }
        catch (e) {
            const msg = e?.message || 'حدث خطأ';
            return {
                intent: 'report',
                reply: `تعذر جلب تقرير الطالب. (${msg}) تأكد أن الطالب مشترك في أحد كورساتك، أو جرّب بالاسم أو بكود الطالب.`,
            };
        }
    }
    // طلب تقرير طالب لكن بدون اسم أو كود — نطلب منه الاسم/الكود ولا نرجع تقرير الكورسات
    if (hasStudentReportIntentWithoutName(trimmed)) {
        return {
            intent: 'report',
            reply: 'لتقرير **طالب معين** اكتب: **تقرير الطالب** ثم اسم الطالب أو كود الطالب (الرقم).\n\nمثال: تقرير الطالب أحمد — أو: تقرير الطالب 12345',
        };
    }
    // 1) طلب تقرير عام (كورسات/صفوف) — تقرير مستوى الطلاب لكل صف
    if (isGeneralReportRequest(trimmed)) {
        try {
            const reports = await teacherDailyCourseReport_1.TeacherDailyCourseReportService.getReports(teacherId);
            const formatted = formatTeacherDailyReportsForChat(reports);
            return { intent: 'report', reply: formatted };
        }
        catch (e) {
            const msg = e?.message || 'حدث خطأ';
            return {
                intent: 'report',
                reply: `تعذر جلب التقرير حالياً. (${msg}) جرّب لاحقاً أو تواصل مع الإدارة.`,
            };
        }
    }
    // 2) أفكار تسويقية (كلمات واضحة أولاً)
    if (containsAny(trimmed, MARKETING_KEYWORDS)) {
        return { intent: 'marketing', reply: getRandomMarketingTip() };
    }
    // 3) تحليل بالـ LLM: هل الرسالة مشكلة أم طلب (تقرير/تسويق) أم غيره
    let intent = 'other';
    try {
        intent = await detectTeacherIntent(trimmed);
    }
    catch (_e) {
        // fallback: كلمات مشكلة
        intent = containsAny(trimmed, PROBLEM_KEYWORDS) ? 'problem' : 'other';
    }
    if (intent === 'problem') {
        return {
            intent: 'problem',
            reply: 'تم تحويل مشكلتك للإدارة للعمل على حلها. عند حلها سأقوم بمراسلتك.',
            createTicket: true,
            escalate: true,
        };
    }
    if (intent === 'report') {
        try {
            const reports = await teacherDailyCourseReport_1.TeacherDailyCourseReportService.getReports(teacherId);
            return { intent: 'report', reply: formatTeacherDailyReportsForChat(reports) };
        }
        catch (e) {
            return {
                intent: 'report',
                reply: `تعذر جلب التقرير حالياً. (${e?.message || 'حدث خطأ'}) جرّب لاحقاً.`,
            };
        }
    }
    if (intent === 'marketing') {
        return { intent: 'marketing', reply: getRandomMarketingTip() };
    }
    // other: رد ودي مع توضيح الخدمات
    return {
        intent: 'other',
        reply: 'يمكنني مساعدتك في: تقرير مفصل عن مستوى طلابك، أفكار تسويقية أو تحسين التفاعل، أو تسجيل أي مشكلة للإدارة. اكتب ما تحتاجه بشكل مختصر.',
    };
}
