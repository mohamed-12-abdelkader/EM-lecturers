"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DeepSeekChatbotService = void 0;
exports.findStudentByPhone = findStudentByPhone;
exports.findStudentByPhoneAndName = findStudentByPhoneAndName;
exports.setStudentPassword = setStudentPassword;
const bcrypt_1 = __importDefault(require("bcrypt"));
const utils_1 = require("../utils");
const pool_1 = __importDefault(require("../db/pool"));
const activationCodeLookup_1 = require("./activationCodeLookup");
/** تطبيع رقم الهاتف للمقارنة (نفس منطق api/student/students-data) */
function normalizePhoneForLookup(phone) {
    const normalized = phone.replace(/\D/g, '').trim();
    if (!normalized || normalized.length < 9)
        return null;
    if (normalized.length >= 10)
        return normalized.slice(-10);
    if (normalized.length === 9 && normalized.startsWith('1'))
        return '0' + normalized;
    return normalized.padStart(10, '0').slice(-10);
}
/**
 * البحث عن طالب برقم الهاتف فقط — نفس مصدر البيانات مثل api/student/students-data (جدول users، role = student)
 */
async function findStudentByPhone(phone) {
    const phoneDigits = normalizePhoneForLookup(phone);
    if (!phoneDigits)
        return null;
    const res = await pool_1.default.query(`SELECT id, name, phone FROM users WHERE role = 'student'
     AND RIGHT(regexp_replace(phone, '[^0-9]', '', 'g'), 10) = $1
     LIMIT 1`, [phoneDigits]);
    if (res.rowCount !== 1)
        return null;
    const row = res.rows[0];
    return { id: row.id, name: row.name, phone: row.phone };
}
/** البحث عن طالب برقم الهاتف والاسم (للاستخدام الداخلي في الشات بوت فقط) — محتفظ به للتوافق إن لزم */
async function findStudentByPhoneAndName(phone, name) {
    const phoneDigits = normalizePhoneForLookup(phone);
    if (!phoneDigits)
        return null;
    const nameTrim = name.trim().replace(/\s+/g, ' ');
    if (nameTrim) {
        const res = await pool_1.default.query(`SELECT id, name, phone FROM users WHERE role = 'student'
       AND RIGHT(regexp_replace(phone, '[^0-9]', '', 'g'), 10) = $1
       AND (TRIM(LOWER(name)) = TRIM(LOWER($2)) OR TRIM(LOWER(name)) LIKE '%' || TRIM(LOWER($2)) || '%')
       ORDER BY CASE WHEN TRIM(LOWER(name)) = TRIM(LOWER($2)) THEN 0 ELSE 1 END, id DESC
       LIMIT 1`, [phoneDigits, nameTrim]);
        if (res.rowCount) {
            const row = res.rows[0];
            return { id: row.id, name: row.name, phone: row.phone };
        }
    }
    return findStudentByPhone(phone);
}
/** تغيير كلمة مرور الطالب (للاستخدام الداخلي في الشات بوت فقط) */
async function setStudentPassword(studentId, newPassword) {
    if (!newPassword || newPassword.length < 6)
        return false;
    const hashed = await bcrypt_1.default.hash(newPassword, 10);
    await pool_1.default.query('UPDATE users SET password = $1 WHERE id = $2 AND role = $3', [
        hashed,
        studentId,
        'student',
    ]);
    return true;
}
class DeepSeekChatbotService {
    static MAX_BOT_ATTEMPTS = 10;
    static API_URL = `${utils_1.config.DEEPSEEK_API_URL}/v1/chat/completions`;
    /**
     * Detect intent from student message using DeepSeek LLM
     */
    static async detectIntent(message, context) {
        const systemPrompt = `You are an intent detection system for a student support chatbot for Next Edu School.
Analyze the student's message and classify it into one of these categories:

1. LOGIN_PROBLEM - Cannot create account, cannot log in, error when signing up or signing in (مش قادر أنشئ حساب، مش قادر أسجل دخول، خطأ عند التسجيل)
2. PASSWORD_RESET - Forgot password, want to reset password (نسيت كلمة السر، تغيير الباسورد)
3. ACCOUNT_LOCKED - Account is locked or suspended
4. COURSE_ACCESS - Problems accessing courses or content
5. VIDEO_LOADING - Videos not loading or playing
6. PAYMENT - Payment, subscription, or billing issues
7. BUG_ERROR - Technical bugs or errors
8. ACTIVATION_CODE - Questions or problems about course activation code (كود التفعيل)
9. OTHER - Anything else (greetings, unclear problem)

Respond with ONLY a JSON object in this exact format:
{
  "intent": "INTENT_NAME",
  "confidence": 0.0-1.0,
  "requiresEscalation": true/false
}

Set requiresEscalation to true ONLY if:
- The message explicitly asks to talk to admin/human (أريد أدمن، تكلم مع مسؤول)
- The problem is clearly technical/server-related and cannot be solved by guidance
Do NOT escalate for: course activation, login help, finding teacher, using code - try to solve first.

Be concise and accurate.`;
        const userMessage = context
            ? `Previous conversation context: ${JSON.stringify(context.messages.slice(-3))}\n\nCurrent message: ${message}`
            : message;
        try {
            const response = await fetch(this.API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${utils_1.config.DEEPSEEK_API_KEY}`,
                },
                body: JSON.stringify({
                    model: 'deepseek-chat',
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userMessage },
                    ],
                    temperature: 0.3,
                    max_tokens: 200,
                }),
            });
            if (!response.ok) {
                const errorText = await response.text();
                console.error('DeepSeek API error:', errorText);
                throw new Error(`DeepSeek API error: ${response.status}`);
            }
            const data = (await response.json());
            const content = data.choices[0]?.message?.content?.trim();
            if (!content) {
                throw new Error('No response from DeepSeek API');
            }
            // Parse JSON response
            let result;
            try {
                // Extract JSON from markdown code blocks if present
                const jsonMatch = content.match(/\{[\s\S]*\}/);
                const jsonContent = jsonMatch ? jsonMatch[0] : content;
                result = JSON.parse(jsonContent);
            }
            catch (_parseError) {
                console.error('Failed to parse DeepSeek response:', content);
                // Fallback to OTHER intent
                result = {
                    intent: 'OTHER',
                    confidence: 0.5,
                    requiresEscalation: true,
                };
            }
            // Validate intent
            const validIntents = [
                'LOGIN_PROBLEM',
                'PASSWORD_RESET',
                'ACCOUNT_LOCKED',
                'COURSE_ACCESS',
                'VIDEO_LOADING',
                'PAYMENT',
                'BUG_ERROR',
                'ACTIVATION_CODE',
                'OTHER',
            ];
            if (!validIntents.includes(result.intent)) {
                result.intent = 'OTHER';
            }
            return result;
        }
        catch (error) {
            console.error('Error detecting intent:', error);
            // Fallback to OTHER intent
            return {
                intent: 'OTHER',
                confidence: 0.5,
                requiresEscalation: true,
            };
        }
    }
    /**
     * Generate automated response based on intent
     */
    static async generateResponse(intent, message, context) {
        const studentMessages = context.messages.filter((m) => m.role === 'student');
        const lastBotMessage = context.messages
            .slice()
            .reverse()
            .find((m) => m.role === 'bot')?.text;
        // 1) بداية المحادثة: رسالة ترحيب لمنصة Next Edu (إنشاء حساب / تسجيل دخول)
        if (studentMessages.length <= 1) {
            const welcome = 'أهلاً بيك 👋\nتحب أساعدك في إيه؟ هل بتواجه مشكلة في إنشاء الحساب أو تسجيل الدخول؟';
            return {
                message: welcome,
                intent: intent === 'LOGIN_PROBLEM' || intent === 'PASSWORD_RESET' ? intent : 'OTHER',
                solved: false,
                shouldEscalate: false,
            };
        }
        // لا نُصعّد بسبب عدد المحاولات؛ التصعيد فقط عند طلب الطالب أو عندما النية تتطلب ذلك
        // Check for explicit escalation requests
        const escalationKeywords = [
            'لم يعمل',
            'لم يحل',
            'ما زال',
            'لم يحل المشكلة',
            'أحتاج مساعدة',
            'أريد التحدث مع',
            'أريد أدمن',
            'أريد مسؤول',
            "this didn't work",
            'still not solved',
            'i need help',
            'talk to admin',
        ];
        const messageLower = message.toLowerCase();
        // طلب رقم التليفون فقط للتحقق من وجود الحساب (نفس بيانات api/student/students-data)
        const botAskedForPhone = lastBotMessage &&
            (lastBotMessage.includes('رقم الهاتف') ||
                lastBotMessage.includes('رقم التليفون') ||
                lastBotMessage.includes('ابعت رقم') ||
                lastBotMessage.includes('أرسل رقم') ||
                lastBotMessage.includes('أرسلي رقم'));
        if (escalationKeywords.some((keyword) => messageLower.includes(keyword.toLowerCase()))) {
            return {
                message: 'أفهم أن الحل المقترح لم يعمل. سأقوم بنقل المحادثة إلى فريق الدعم الفني. سيقوم أحد المسؤولين بالرد عليك قريباً.',
                intent,
                solved: false,
                shouldEscalate: true,
                escalationReason: 'Student requested escalation',
            };
        }
        // أي حديث عن كلمة السر أو نسيانها → نطلب رقم التليفون والاسم فوراً (بدون أي ذكر لـ "نسيت كلمة المرور" أو "إعادة تعيين" من الصفحة)
        const passwordRelatedKeywords = [
            'كلمة السر',
            'كلمة المرور',
            'الباسورد',
            'الپاسورد',
            'نسيت',
            'ناسي',
            'مش فاكر',
            'نسيان',
            'إعادة تعيين',
            'اعادة تعيين',
            'تغيير كلمة',
            'تغيير الباسورد',
            'reset',
            'forgot',
            'مشكلة في الدخول',
            'مش قادر ادخل',
            'مش قادر أسجل دخول',
        ];
        const looksLikePasswordProblem = intent === 'PASSWORD_RESET' ||
            (intent === 'LOGIN_PROBLEM' && passwordRelatedKeywords.some((k) => messageLower.includes(k.toLowerCase()))) ||
            (intent === 'OTHER' && passwordRelatedKeywords.some((k) => messageLower.includes(k.toLowerCase())));
        if (looksLikePasswordProblem && !botAskedForPhone) {
            return {
                message: 'عشان نتحقق من حسابك محتاج منك رقم التليفون المسجل بالحساب فقط.\nابعت رقم التليفون هنا.',
                intent: 'PASSWORD_RESET',
                solved: false,
                shouldEscalate: false,
            };
        }
        // 2) خطأ إنشاء حساب: إذا كان الخطأ يدل على أن الحساب مسجل بالفعل
        const accountExistsKeywords = [
            'مسجل بالفعل',
            'موجود بالفعل',
            'already registered',
            'already exists',
            'الرقم مستخدم',
            'الهاتف مستخدم',
            'البريد مستخدم',
            'الحساب موجود',
            'تم التسجيل مسبق',
        ];
        if ((intent === 'LOGIN_PROBLEM' || intent === 'PASSWORD_RESET' || intent === 'OTHER') &&
            accountExistsKeywords.some((k) => messageLower.includes(k.toLowerCase()))) {
            return {
                message: 'واضح إن عندك حساب متسجل قبل كده، جرب تسجيل الدخول برقم الهاتف وكلمة السر.',
                intent: 'LOGIN_PROBLEM',
                solved: false,
                shouldEscalate: false,
            };
        }
        // 3) بعد ما طلبنا رقم التليفون: التحقق من وجود الحساب (برقم الهاتف فقط — نفس بيانات api/student/students-data)
        if ((intent === 'PASSWORD_RESET' || intent === 'LOGIN_PROBLEM') &&
            botAskedForPhone &&
            message.trim().length >= 5) {
            const trimMsg = message.trim();
            const phoneMatch = trimMsg.match(/(01[0125]\d{8}|\+?20\s*1[0125]\d{8}|\d{9,11})/);
            const phoneStr = phoneMatch
                ? phoneMatch[1]
                : trimMsg.replace(/\D/g, '').length >= 9
                    ? trimMsg.replace(/\D/g, '')
                    : '';
            if (phoneStr) {
                const student = await findStudentByPhone(phoneStr);
                if (student) {
                    return {
                        message: 'انت بالفعل عندك حساب ✅\nعلشان تقدر تدخل لحسابك وتغيّر كلمة السر، ابعت للدعم الفني المختص على الرقم ده: 01111272393 وهما هيتواصلوا معاك ويغيّرولك الباسورد.',
                        intent: 'PASSWORD_RESET',
                        solved: true,
                        shouldEscalate: false,
                    };
                }
                return {
                    message: 'انت مش مسجّل قبل كده.\nحاول تنشئ حسابك من جديد وتأكد من إدخال البيانات بشكل صحيح.',
                    intent: 'PASSWORD_RESET',
                    solved: false,
                    shouldEscalate: false,
                };
            }
        }
        // إذا قال إنه لا يستطيع إنشاء حساب ويظهر له خطأ: نطلب نص الخطأ
        const cantCreateKeywords = [
            'مش قادر أنشئ',
            'مش قادر أسجل',
            'لا أستطيع إنشاء',
            'خطأ عند التسجيل',
            'يظهر خطأ',
            'بيظهرلي خطأ',
            'error',
            'رسالة خطأ',
        ];
        const botAskedForError = lastBotMessage &&
            (lastBotMessage.includes('نص الخطأ') || lastBotMessage.includes('رسالة الخطأ'));
        if ((intent === 'LOGIN_PROBLEM' || intent === 'OTHER') &&
            cantCreateKeywords.some((k) => messageLower.includes(k.toLowerCase())) &&
            !botAskedForError) {
            return {
                message: 'اكتب نص الخطأ اللي بيظهرلك أو انسخه هنا عشان أقدر أساعدك.',
                intent: 'LOGIN_PROBLEM',
                solved: false,
                shouldEscalate: false,
            };
        }
        // معالجة سؤال كود التفعيل: إن وُجد كود في الرسالة الحالية أو في رسالة سابقة من الطالب نبحث عنه ونرد بحالته (البوت يشوف كل الرسائل فلا يكرر طلب الكود)
        if (intent === 'ACTIVATION_CODE') {
            const lastBotMessage = context.messages
                .slice()
                .reverse()
                .find((m) => m.role === 'bot')?.text;
            // أولاً: لو البوت سأل "هل تحب أن أفعّل الكورس لك الآن؟" والطالب وافق (نعم / موافق / تمام...) ننفّذ التفعيل فوراً ولا نعيد عرض حالة الكود
            const askedToActivateNow = lastBotMessage &&
                (lastBotMessage.includes('أفعّل الكورس لك الآن') || lastBotMessage.includes('افعل الكورس لك الآن'));
            if (askedToActivateNow) {
                if (context.studentId === 0) {
                    return {
                        message: 'عشان نفعّل الكورس لازم تكون مسجّل دخول. سجّل حساب أولاً من التطبيق أو الموقع، ولو عندك مشكلة في التسجيل أو إنشاء الحساب اكتبها هنا وأساعدك.',
                        intent: 'ACTIVATION_CODE',
                        solved: false,
                        shouldEscalate: false,
                    };
                }
                const normalize = (s) => s
                    .trim()
                    .toLowerCase()
                    .replace(/\s+/g, ' ')
                    .replace(/[أإآ]/g, 'ا')
                    .replace(/ة/g, 'ه');
                const msg = normalize(message);
                const positiveWords = [
                    'نعم',
                    'ايوه',
                    'ايوة',
                    'موافق',
                    'صح',
                    'ايوا',
                    'تمام',
                    'ماشي',
                    'نفذ',
                    'اعمل',
                    'اعملها',
                    'اوكي',
                    'yes',
                    'yeah',
                ];
                const isAgreement = positiveWords.some((w) => msg === w || msg.startsWith(w + ' ') || msg.includes(' ' + w)) ||
                    /^(نعم|ايوه|ايوة|موافق|صح|تمام|ماشي|نفذ)\b/.test(msg);
                const isPositive = msg.length <= 60 && isAgreement;
                if (isPositive) {
                    const lastCodeFromContext = context.messages
                        .slice()
                        .reverse()
                        .find((m) => m.role === 'student' && /\d{8}/.test((m.text || '').replace(/\s/g, '')));
                    const codeMatch = lastCodeFromContext?.text?.replace(/\s/g, '').match(/\d{8}/);
                    const codeToUse = codeMatch ? codeMatch[0] : null;
                    if (codeToUse) {
                        const result = await (0, activationCodeLookup_1.activateCourseByCodeForStudent)(context.studentId, codeToUse);
                        if (result.success) {
                            return {
                                message: 'تم تفعيل الكورس بنجاح ويمكنك الآن الدخول إليه.',
                                intent: 'ACTIVATION_CODE',
                                solved: true,
                                shouldEscalate: false,
                            };
                        }
                        const errorMessages = {
                            'الكود غير موجود': 'الكود غير موجود. تأكد من كتابة الكود بشكل صحيح.',
                            'الكود منتهي الصلاحية': 'الكود منتهي الصلاحية. اطلب كود جديد من المدرس.',
                            'الكود مستنفذ بالكامل': 'الكود مستنفذ. اطلب كود جديد من المدرس.',
                            'الطالب غير موجود أو ليس حساب طالب': 'حدث خطأ في التحقق من الحساب.',
                            'هذا الطالب مفعّل له الكورس مسبقاً بهذا الكود': 'أنت مفعّل للكورس مسبقاً ويمكنك الدخول إليه.',
                        };
                        const friendlyMessage = errorMessages[result.message] || `لم نتمكن من التفعيل: ${result.message}`;
                        return {
                            message: friendlyMessage,
                            intent: 'ACTIVATION_CODE',
                            solved: false,
                            shouldEscalate: false,
                        };
                    }
                }
            }
            // لو البوت سأل "هل هذا حسابك؟" والطالب رد موافق أو لا، نرد بالتعليمات المناسبة قبل إعادة عرض حالة الكود (حتى لا نكرر الرسالة)
            const askedIfSameStudent = lastBotMessage &&
                (lastBotMessage.includes('هل أنت هذا الطالب') ||
                    lastBotMessage.includes('هل انت الطالب') ||
                    lastBotMessage.includes('هل هذا حسابك') ||
                    (lastBotMessage.includes('الطالب') && lastBotMessage.includes('هل')));
            if (askedIfSameStudent) {
                const normalize = (s) => s
                    .trim()
                    .toLowerCase()
                    .replace(/\s+/g, ' ')
                    .replace(/[أإآ]/g, 'ا')
                    .replace(/ة/g, 'ه');
                const msg = normalize(message);
                const msgLen = msg.length;
                const positiveWords = [
                    'نعم',
                    'ايوه',
                    'ايوة',
                    'ايه',
                    'اه',
                    'موافق',
                    'انا',
                    'اناه',
                    'انا هو',
                    'ده انا',
                    'هو انا',
                    'كدا',
                    'صح',
                    'صحيح',
                    'ايوا',
                    'تمام',
                    'تمامة',
                    'ماشي',
                    'نفذ',
                    'نفذها',
                    'اعمل',
                    'اعملها',
                    'اوكي',
                    'ok',
                    'yes',
                    'yeah',
                ];
                const isAgreement = positiveWords.some((w) => msg === w || msg.startsWith(w + ' ') || msg.includes(' ' + w)) ||
                    /^(نعم|ايوه|ايوة|انا|ايه|اه|موافق|صح|صحيح|تمام|ماشي|نفذ)\b/.test(msg) ||
                    /^(\s)*(نعم|ايوه|تمام|ماشي|نفذ|اوكي)/.test(msg);
                const isPositive = msgLen <= 60 && isAgreement;
                const negativeWords = [
                    'لا',
                    'لأ',
                    'لاء',
                    'مش انا',
                    'مش اناه',
                    'انا مش',
                    'ده مش انا',
                    'لا انا مش',
                    'لأ انا مش',
                    'no',
                    'not me',
                ];
                const isNegative = msgLen <= 60 &&
                    (negativeWords.some((w) => msg === w || msg.startsWith(w + ' ') || msg.includes(' ' + w)) ||
                        /^(لا|لأ|لاء)\b/.test(msg) ||
                        /مش انا|انا مش/.test(msg));
                if (isPositive) {
                    return {
                        message: 'يبدو أنك تحاول تفعيل الكود بحساب آخر. الكود صالح لحساب واحد فقط. قم بتسجيل الخروج والدخول بالحساب الأول. لو ناسي الباسورد في صفحة تسجيل الدخول اضغط "نسيت كلمة السر" واتبع الخطوات. لو معرفتش ابعت للرقم 01111272393 وقول إنك محتاج تغير كلمة السر.',
                        intent: 'ACTIVATION_CODE',
                        solved: false,
                        shouldEscalate: false,
                    };
                }
                if (isNegative) {
                    return {
                        message: 'يبدو أن الكود مستخدم من قبل. ارجع للمدرس بتاعك واطلب كود جديد وقول للمدرس إن الكود ده طالب تاني استخدمه.',
                        intent: 'ACTIVATION_CODE',
                        solved: false,
                        shouldEscalate: false,
                    };
                }
                if (msgLen <= 80) {
                    return {
                        message: 'هل هذا حسابك؟ اكتب "نعم" لو أنت هو، أو "لا" لو مش أنت.',
                        intent: 'ACTIVATION_CODE',
                        solved: false,
                        shouldEscalate: false,
                    };
                }
            }
            // لو البوت قال إن الكود مستخدم أو سأل "هل هذا حسابك؟" والطالب رد إنه عنده كود جديد أو بيواجه خطاء → نتعامل على أساس المشكلة الجديدة ولا نكرر شرح الكود القديم
            const lastBotWasCodeUsedOrIsThisYou = lastBotMessage &&
                (lastBotMessage.includes('الكود مستخدم') ||
                    lastBotMessage.includes('هل هذا حسابك') ||
                    lastBotMessage.includes('هل أنت هذا الطالب'));
            const newCodeOrErrorKeywords = [
                'كود جديد',
                'خدت كود',
                'اخدت كود',
                'كود تاني',
                'كود ثاني',
                'معايا كود',
                'خطاء',
                'خطأ',
                'بيظهرلي خطاء',
                'بيظهرلي خطأ',
                'بيظهرلي',
                'رسالة خطأ',
                'مشكلة',
                'مش شغال',
                'مش شغالة',
                'غلط',
                'غلطة',
                'مش تمام',
                'error',
                'مستلمت كود',
                'استلمت كود',
            ];
            const normMsg = message
                .trim()
                .toLowerCase()
                .replace(/\s+/g, ' ')
                .replace(/[أإآ]/g, 'ا')
                .replace(/ة/g, 'ه');
            const userSaysNewCodeOrError = lastBotWasCodeUsedOrIsThisYou &&
                newCodeOrErrorKeywords.some((k) => normMsg.includes(k.replace(/ة/g, 'ه').toLowerCase()));
            if (userSaysNewCodeOrError) {
                return {
                    message: 'تمام، نتعامل مع الكود الجديد أو المشكلة الجديدة. اكتب الكود الجديد (8 أرقام) أو اذكر لي رسالة الخطأ اللي بتظهرلك وسأساعدك.',
                    intent: 'ACTIVATION_CODE',
                    solved: false,
                    shouldEscalate: false,
                };
            }
            // طلب الاشتراك/التفعيل عند مستر معين (عايز أفعل كورس عند مستر فلان / عايز أشترك مع...) → نعطيه خطوات الاشتراك مع خيار إرسال الكود هنا
            const subscriptionKeywords = [
                'عايز افعل كورس',
                'عايز اشترك',
                'عايز أفعّل كورس',
                'عايز أشترك',
                'عند مستر',
                'مع مستر',
                'مستر ',
                'شراء كورس',
                'ابحث عن محاضر',
                'كورس عند',
            ];
            const normalizeForSub = (s) => s
                .trim()
                .toLowerCase()
                .replace(/\s+/g, ' ')
                .replace(/[أإآ]/g, 'ا')
                .replace(/ة/g, 'ه');
            const msgForSub = normalizeForSub(message);
            const isSubscriptionRequest = subscriptionKeywords.some((k) => msgForSub.includes(normalizeForSub(k))) &&
                message.length >= 10 &&
                !message.replace(/\s/g, '').match(/^\d{8}$/); // ليس مجرد كود فقط
            const notWaitingForReply = !lastBotMessage ||
                (!lastBotMessage.includes('هل هذا حسابك') &&
                    !lastBotMessage.includes('أفعّل الكورس لك الآن') &&
                    !lastBotMessage.includes('افعل الكورس لك الآن'));
            if (isSubscriptionRequest && notWaitingForReply) {
                const stepsMessage = `خطوات الاشتراك في كورس عند محاضر معين:

1️⃣ في الصفحة الرئيسية هتلاقي زر اسمه "مسح QR code" — اضغط عليه واعمل مسح للكود الموجود معاك في الكارت اللي استلمته من المدرس.
• لو ظهرلك "تم الاشتراك بنجاح" فأنت كدا تمام.
• لو ظهرت معاك مشكلة، جرب الطريقة التانية:

2️⃣ اضغط على "ابحث عن محاضر" واكتب اسم مدرسك، ادخل عنده واختر الكورس واضغط "شراء"، ثم اكتب الكود الموجود معاك.

3️⃣ أو أسهل: اكتب الكود هنا (8 أرقام) وأنا أفعّل الكورس لك مباشرة.`;
                return {
                    message: stepsMessage,
                    intent: 'ACTIVATION_CODE',
                    solved: false,
                    shouldEscalate: false,
                };
            }
            const codeFromMessage = message.replace(/\s/g, '').match(/\d{8}/)?.[0];
            const lastStudentCodeMsg = context.messages
                .slice()
                .reverse()
                .find((m) => m.role === 'student' && /\d{8}/.test((m.text || '').replace(/\s/g, '')));
            const codeFromContext = lastStudentCodeMsg?.text?.replace(/\s/g, '').match(/\d{8}/)?.[0];
            const code = codeFromMessage || codeFromContext || null;
            if (code) {
                const details = await (0, activationCodeLookup_1.getActivationCodeDetails)(code);
                if (details) {
                    const statusLines = [];
                    statusLines.push(`حالة الكود ${details.code}:`);
                    statusLines.push(`• الكورس: ${details.course.title}`);
                    statusLines.push(`• المدرس: ${details.teacher.name}`);
                    if (details.is_expired) {
                        statusLines.push('• الكود منتهي الصلاحية.');
                    }
                    else if (details.is_used) {
                        const usedByName = details.used_by.length > 0 ? details.used_by.map((u) => u.name).join(' أو ') : 'طالب';
                        statusLines.push(`• الكود مستخدم بالفعل بواسطة الطالب: ${usedByName}.`);
                        statusLines.push('• هل هذا حسابك؟');
                    }
                    else {
                        statusLines.push('• الكود صالح ولم يتم استخدامه.');
                        statusLines.push('• هل تحب أن أفعّل الكورس لك الآن؟');
                    }
                    return {
                        message: statusLines.join('\n'),
                        intent: 'ACTIVATION_CODE',
                        solved: false,
                        shouldEscalate: false,
                    };
                }
                return {
                    message: `لم أجد كوداً بهذا الرقم (${code}). تأكد من كتابة الكود بشكل صحيح (8 أرقام). إن استمرت المشكلة، تواصل مع الدعم الفني.`,
                    intent: 'ACTIVATION_CODE',
                    solved: false,
                    shouldEscalate: false,
                };
            }
        }
        // Get intent-specific response
        const responseTemplate = this.getResponseTemplate(intent, context);
        // Use DeepSeek to generate personalized response
        try {
            const systemPrompt = `You are a friendly technical support chatbot for an online learning platform. Your main task is to UNDERSTAND the student's problem and guide them step by step. Do NOT transfer to admin easily - try to solve first.

Rules:
1. You have the full conversation history. Do NOT ask again for information the student already sent (e.g. activation code, details). Use what they already wrote in the chat.
2. Analyze the message carefully. Do not assume the problem - ask short, clear questions only when the information is missing.
3. Give step-by-step solutions. Keep replies short and direct.
4. Use simple, friendly Arabic suitable for students.
5. Only suggest transferring to admin if: the problem is clearly technical/server, or the student explicitly asks for admin, or you have tried and cannot solve.

Current intent: ${intent}
Bot attempts so far: ${context.botAttempts}

${responseTemplate.instructions}

Generate a short, friendly response in Arabic that addresses the student and helps solve the problem.`;
            const historyMessages = context.messages.map((m) => ({
                role: m.role === 'student' ? 'user' : 'assistant',
                content: m.text || '',
            }));
            const apiMessages = [
                { role: 'system', content: systemPrompt },
                ...historyMessages,
                { role: 'user', content: message },
            ];
            const response = await fetch(this.API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${utils_1.config.DEEPSEEK_API_KEY}`,
                },
                body: JSON.stringify({
                    model: 'deepseek-chat',
                    messages: apiMessages,
                    temperature: 0.7,
                    max_tokens: 500,
                }),
            });
            if (!response.ok) {
                throw new Error(`DeepSeek API error: ${response.status}`);
            }
            const data = (await response.json());
            let botMessage = data.choices[0]?.message?.content?.trim() || responseTemplate.defaultMessage;
            // منع أي رد من الـ LLM يذكر "نسيت كلمة المرور" أو "اضغط على" — نستبدله فوراً بالرسالة القياسية
            const forbiddenPasswordPhrases = [
                'نسيت كلمة المرور',
                'نسيت كلمة السر',
                'اضغط على',
                'اضغطي على',
                'إعادة تعيين كلمة',
                'اعادة تعيين كلمة',
                'جربت إعادة',
                'جربي إعادة',
            ];
            if ((intent === 'PASSWORD_RESET' || intent === 'LOGIN_PROBLEM') &&
                forbiddenPasswordPhrases.some((p) => botMessage.includes(p))) {
                botMessage =
                    'عشان نتحقق من حسابك محتاج منك رقم التليفون المسجل بالحساب فقط.\nابعت رقم التليفون هنا.';
            }
            return {
                message: botMessage,
                intent,
                solved: false, // Will be updated based on student's next response
                shouldEscalate: responseTemplate.requiresEscalation,
                escalationReason: responseTemplate.requiresEscalation
                    ? responseTemplate.escalationReason
                    : undefined,
            };
        }
        catch (error) {
            console.error('Error generating response:', error);
            let fallbackMessage = responseTemplate.defaultMessage;
            const forbiddenPasswordPhrases = [
                'نسيت كلمة المرور',
                'نسيت كلمة السر',
                'اضغط على',
                'إعادة تعيين كلمة',
                'جربت إعادة',
            ];
            if ((intent === 'PASSWORD_RESET' || intent === 'LOGIN_PROBLEM') &&
                forbiddenPasswordPhrases.some((p) => fallbackMessage.includes(p))) {
                fallbackMessage =
                    'عشان نغيّر كلمة المرور محتاج منك:\n• رقم التليفون المسجل بالحساب\n• اسم الحساب (الاسم اللي كان مسجّل بيه قبل كده)\nابعتهم هنا في رسالة واحدة (رقم التليفون والاسم).';
            }
            return {
                message: fallbackMessage,
                intent,
                solved: false,
                shouldEscalate: responseTemplate.requiresEscalation,
                escalationReason: responseTemplate.requiresEscalation
                    ? responseTemplate.escalationReason
                    : undefined,
            };
        }
    }
    /**
     * Get response template for each intent
     */
    static getResponseTemplate(intent, _context) {
        const templates = {
            LOGIN_PROBLEM: {
                instructions: `منصة Next Edu: ساعد الطالب في مشاكل إنشاء الحساب أو تسجيل الدخول. اسأل عن نص الخطأ إن ذكر أن هناك خطأ. ممنوع منعاً باتاً أن تذكر "نسيت كلمة المرور" أو "اضغط على نسيت كلمة السر" أو "إعادة تعيين كلمة المرور" — لا يوجد هذا الخيار في المنصة؛ نتحقق من الحساب برقم التليفون فقط ثم نوجّه الطالب للدعم 01111272393 لتغيير الباسورد. لا تظهر روابط أو تفاصيل تقنية. أسلوب بسيط وودود.`,
                defaultMessage: `أهلاً بك! لو بتواجه مشكلة في تسجيل الدخول أو إنشاء الحساب، اكتب لي نص الخطأ اللي بيظهرلك (أو وصف المشكلة) وأساعدك.`,
                requiresEscalation: false,
            },
            PASSWORD_RESET: {
                instructions: `منصة Next Edu: عند أي طلب متعلق بكلمة المرور أو نسيانها، رد فقط بطلب: رقم التليفون المسجل بالحساب. ممنوع أن تقول "نسيت كلمة المرور" أو "اضغط على إعادة تعيين". نتحقق من الحساب بالرقم ثم نوجّه الطالب للدعم 01111272393.`,
                defaultMessage: `عشان نتحقق من حسابك محتاج منك رقم التليفون المسجل بالحساب فقط. ابعت رقم التليفون هنا.`,
                requiresEscalation: false,
            },
            ACCOUNT_LOCKED: {
                instructions: `Account locked issues require admin intervention. Escalate this immediately.`,
                defaultMessage: `أفهم أن حسابك مقفل. هذه المشكلة تتطلب تدخل من المسؤولين.

سأقوم بنقل المحادثة إلى فريق الدعم الفني. سيقوم أحد المسؤولين بالرد عليك قريباً لحل هذه المشكلة.`,
                requiresEscalation: true,
                escalationReason: 'Account locked - requires admin permissions',
            },
            COURSE_ACCESS: {
                instructions: `Help with course access issues. Ask about:
1. Which course they're trying to access
2. If they're enrolled in the course
3. If they see any error messages
4. Check their subscription status`,
                defaultMessage: `دعني أساعدك في مشكلة الوصول إلى الدورة.

يرجى إخباري بالتالي:
1. ما هي الدورة التي تحاول الوصول إليها؟
2. هل أنت مسجل في هذه الدورة؟
3. هل تظهر رسالة خطأ معينة؟
4. ما هي حالة اشتراكك الحالية؟

بعد معرفة هذه المعلومات، سأتمكن من مساعدتك بشكل أفضل.`,
                requiresEscalation: false,
            },
            VIDEO_LOADING: {
                instructions: `Help with video loading issues. Provide troubleshooting steps:
1. Check internet connection
2. Try refreshing the page
3. Clear browser cache
4. Try different browser or device`,
                defaultMessage: `دعني أساعدك في حل مشكلة تحميل الفيديو.

جرب الخطوات التالية بالترتيب:
1. تحقق من اتصالك بالإنترنت
2. قم بتحديث الصفحة (F5 أو Ctrl+R)
3. امسح ذاكرة التخزين المؤقت للمتصفح
4. جرب متصفحاً آخر أو جهازاً مختلفاً

هل جربت أي من هذه الخطوات؟ ما هي النتيجة؟`,
                requiresEscalation: false,
            },
            PAYMENT: {
                instructions: `Payment issues often require admin verification. Ask basic questions first, but be ready to escalate.`,
                defaultMessage: `أفهم أن لديك مشكلة متعلقة بالدفع أو الاشتراك.

للمساعدة في حل هذه المشكلة، أحتاج معرفة:
1. ما هي المشكلة بالضبط؟ (دفعة لم تتم، اشتراك منتهي، إلخ)
2. متى حدثت المشكلة؟
3. هل لديك رقم معاملة أو إيصال؟

إذا كانت المشكلة تتطلب التحقق من الدفع، قد أحتاج نقل المحادثة إلى المسؤولين.`,
                requiresEscalation: true,
                escalationReason: 'Payment verification required',
            },
            BUG_ERROR: {
                instructions: `Help identify and report bugs. Ask for:
1. What error they're seeing
2. When it happens
3. Steps to reproduce
4. Screenshots if possible`,
                defaultMessage: `شكراً لك على الإبلاغ عن المشكلة التقنية.

لمساعدتنا في حل المشكلة بسرعة، أحتاج معرفة:
1. ما هي رسالة الخطأ التي تظهر؟
2. متى تحدث المشكلة؟
3. ما هي الخطوات التي تؤدي إلى ظهور المشكلة؟
4. هل يمكنك إرسال لقطة شاشة للمشكلة؟

بعد جمع هذه المعلومات، سأقوم بإبلاغ فريق التطوير.`,
                requiresEscalation: false,
            },
            ACTIVATION_CODE: {
                instructions: `مشكلة تفعيل الكورس. لا تفترض المشكلة - اسأل أولاً لتحديد نوع المشكلة:
- هل المشكلة في البحث عن المدرس؟ إذا نعم: وجّهه: 1) ابحث عن اسم المدرس بالعربي 2) ادخل صفحة المدرس 3) اضغط "عرض الكورسات" 4) فعّل الكورس باستخدام الكود.
- أم في تفعيل الكورس (QR أو الكود)؟ إذا نعم: اطلب منه إرسال كود التفعيل (8 أرقام) لنتحقق من حالته.
- أم تظهر له رسالة خطأ؟ اسأله ما هي الرسالة.
اجعل الردود قصيرة وواضحة. لا تصعّد للأدمن إلا بعد محاولة الحل.`,
                defaultMessage: `دعني أساعدك في تفعيل الكورس.

ما المشكلة بالضبط؟
• هل صعوبة في الوصول لصفحة المدرس أو الكورسات؟
• أم عندك كود تفعيل ولا يعمل؟
• أم تظهر لك رسالة خطأ؟

اكتب وصف قصير للمشكلة أو أرسل كود التفعيل (8 أرقام) وسأساعدك.`,
                requiresEscalation: false,
            },
            OTHER: {
                instructions: `Handle general questions. Try to help, but escalate if unclear or complex.`,
                defaultMessage: `أهلاً بك! كيف يمكنني مساعدتك اليوم؟

يرجى وصف مشكلتك أو سؤالك بالتفصيل، وسأبذل قصارى جهدي لمساعدتك.`,
                requiresEscalation: false,
            },
        };
        return templates[intent];
    }
    /**
     * Check if student's response indicates problem is solved
     */
    static async checkIfSolved(studentResponse) {
        // لا نضع "تمام" أو "تماماً" هنا لأنها غالباً موافقة على سؤال (مثل "هل تحب أن أفعّل؟" → "تمام") وليست إنهاء المحادثة
        const solvedKeywords = [
            'تم الحل',
            'حل المشكلة',
            'المشكلة حُلت',
            'شكراً',
            'شكرا',
            'شكراً لك',
            'شكرا لك',
            'مشكور',
            'مشكورة',
            'جزاك الله خير',
            'solved',
            'fixed',
            'thanks',
            'thank you',
            'done',
            'worked',
            'problem solved',
            'issue resolved',
        ];
        const responseLower = studentResponse.toLowerCase();
        return solvedKeywords.some((keyword) => responseLower.includes(keyword.toLowerCase()));
    }
    /**
     * تحقق أن الرسالة موافقة قصيرة (نعم، ايوه، تمام، ماشي، ...) لتأكيد إنهاء المشكلة
     */
    static isPositiveConfirmationForClosing(message) {
        const normalize = (s) => s
            .trim()
            .toLowerCase()
            .replace(/\s+/g, ' ')
            .replace(/[أإآ]/g, 'ا')
            .replace(/ة/g, 'ه');
        const msg = normalize(message);
        if (msg.length > 50)
            return false;
        const positiveWords = [
            'نعم',
            'ايوه',
            'ايوة',
            'اه',
            'موافق',
            'تمام',
            'ماشي',
            'صح',
            'ايوا',
            'yes',
            'yeah',
        ];
        return (positiveWords.some((w) => msg === w || msg.startsWith(w + ' ') || msg.includes(' ' + w)) ||
            /^(نعم|ايوه|ايوة|موافق|تمام|ماشي|صح)\b/.test(msg));
    }
    /**
     * Generate a closing/thanks response when student indicates problem is solved
     */
    static async generateClosingResponse(studentMessage) {
        try {
            const systemPrompt = `You are a friendly technical support chatbot. The student has thanked you or indicated their problem is solved. 
Generate a warm, professional closing response in Arabic that:
1. Thanks them for using the service
2. Offers future help if needed
3. Is brief and friendly
4. Acts like a real person

Examples of good responses:
- "العفو، نحن في خدمتك دائماً. إذا واجهت أي مشكلة أخرى، لا تتردد في التواصل معنا. أتمنى لك التوفيق!"
- "شكراً لك على ثقتك بنا. نحن هنا لمساعدتك في أي وقت. بالتوفيق!"
- "لا شكر على واجب. سعدنا بمساعدتك. إذا احتجت أي مساعدة أخرى، نحن هنا دائماً."

Generate a similar response based on the student's message.`;
            const response = await fetch(this.API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${utils_1.config.DEEPSEEK_API_KEY}`,
                },
                body: JSON.stringify({
                    model: 'deepseek-chat',
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: `Student message: ${studentMessage}` },
                    ],
                    temperature: 0.7,
                    max_tokens: 150,
                }),
            });
            if (!response.ok) {
                throw new Error(`DeepSeek API error: ${response.status}`);
            }
            const data = (await response.json());
            const closingMessage = data.choices[0]?.message?.content?.trim();
            // Fallback response
            return (closingMessage ||
                'العفو، نحن في خدمتك دائماً. إذا واجهت أي مشكلة أخرى، لا تتردد في التواصل معنا. أتمنى لك التوفيق!');
        }
        catch (error) {
            console.error('Error generating closing response:', error);
            // Fallback response
            return 'العفو، نحن في خدمتك دائماً. إذا واجهت أي مشكلة أخرى، لا تتردد في التواصل معنا. أتمنى لك التوفيق!';
        }
    }
    /**
     * Get chat context from database
     */
    static async getChatContext(chatId, studentId) {
        // Get recent messages
        const messagesResult = await pool_1.default.query(`SELECT 
        sender_role,
        text,
        created_at,
        is_auto_reply
      FROM support_messages
      WHERE chat_id = $1
      ORDER BY created_at DESC
      LIMIT 50`, [chatId]);
        const messages = messagesResult.rows.reverse().map((row) => ({
            role: (row.is_auto_reply ? 'bot' : row.sender_role === 'student' ? 'student' : 'admin'),
            text: row.text || '',
            timestamp: row.created_at,
        }));
        // Get bot attempts count
        const attemptsResult = await pool_1.default.query(`SELECT COUNT(*) as count
      FROM support_messages
      WHERE chat_id = $1
        AND is_auto_reply = TRUE
        AND created_at > NOW() - INTERVAL '1 hour'`, [chatId]);
        const botAttempts = parseInt(attemptsResult.rows[0]?.count || '0');
        // Get current intent from chat metadata (if stored)
        const chatResult = await pool_1.default.query(`SELECT current_intent FROM support_chats WHERE id = $1`, [
            chatId,
        ]);
        return {
            chatId,
            studentId,
            messages,
            botAttempts,
            currentIntent: chatResult.rows[0]?.current_intent,
        };
    }
}
exports.DeepSeekChatbotService = DeepSeekChatbotService;
