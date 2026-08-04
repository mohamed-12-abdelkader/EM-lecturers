import pool from '../../../../db/pool';
import { buildTenantPublicUrl } from '../../../../config/appUrls';
import { getActivationCodeDetails } from '../../../../services/activationCodeLookup';
import { getPlatformHelp } from './faq';
import { maskPhone, phoneMatchVariants, phonesMatch } from './phoneMatch';
import { resetStudentPasswordSecure } from './passwordReset';

export type ToolExecutionContext = {
  fromPhone: string;
  conversationId: number | null;
};

export const SUPPORT_TOOL_DEFINITIONS = [
  {
    type: 'function' as const,
    function: {
      name: 'search_tenants',
      description:
        'Search teacher platforms by the name the student typed (handles Arabic spelling variants like أحمد/احمد and يحيى/يحي). Pass the student wording as-is — do not “correct” Arabic spelling before calling. Also checks whether the CURRENT WhatsApp caller already has an account on each match. Returns public_url and caller_has_account_on_this_tenant.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description:
              'Teacher name and/or specialty as the student wrote it (e.g. "دكتور احمد يحي" or "أحمد يحيى احياء")',
          },
          limit: { type: 'integer', description: 'Max results (default 8, max 15)' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'lookup_students_by_whatsapp',
      description:
        'Find student accounts whose stored phone matches ONLY the current WhatsApp caller number from context. Never search a phone the student typed in the message. Required before password reset.',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'lookup_student_by_code',
      description:
        'Look up a student by student_code for non-password help (e.g. find tenant URL). Do NOT use for password reset or identity proof when WhatsApp number differs from account phone. Never search phone numbers from message text.',
      parameters: {
        type: 'object',
        properties: {
          student_code: { type: 'string', description: 'Student code e.g. 10001' },
        },
        required: ['student_code'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_platform_help',
      description:
        'Get curated help text for login, signup, password, wrong URL, locked account, or course activation.',
      parameters: {
        type: 'object',
        properties: {
          topic: {
            type: 'string',
            enum: [
              'login',
              'signup',
              'forgot_password',
              'wrong_url',
              'account_locked',
              'activate_course',
              'general',
            ],
          },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'lookup_activation_code',
      description:
        'Look up a teacher course activation code (usually 8 digits) to see if it exists, is expired, or already used, and whether the redeeming account phone matches the current WhatsApp caller. Use when the student has activation problems and sends/shares their code. Do NOT redeem/activate with this tool — lookup only.',
      parameters: {
        type: 'object',
        properties: {
          code: {
            type: 'string',
            description: 'Activation code from the student (8 digits typical)',
          },
        },
        required: ['code'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'reset_student_password',
      description:
        'Reset password ONLY when current WhatsApp caller matches that student account phone (from lookup_students_by_whatsapp). Never use a different phone from the message. Requires student_user_id. Pass new_password if the student chose one; omit to auto-generate.',
      parameters: {
        type: 'object',
        properties: {
          student_user_id: { type: 'integer' },
          tenant_id: { type: 'integer', description: 'Optional tenant filter' },
          new_password: {
            type: 'string',
            description:
              'Optional password chosen by the student (min 6 chars, no spaces). Omit to generate a temporary password.',
          },
        },
        required: ['student_user_id'],
      },
    },
  },
];

function normalizeActivationCodeInput(raw: string): string {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';
  // Prefer an 8-digit sequence if present in messy paste text
  const eight = trimmed.match(/\b\d{8}\b/);
  if (eight) return eight[0];
  return trimmed.replace(/\s+/g, '');
}

async function lookupActivationCode(codeRaw: string, fromPhone: string) {
  const code = normalizeActivationCodeInput(codeRaw);
  if (!code || code.length < 4) {
    return { ok: false, error: 'code_too_short' };
  }

  const details = await getActivationCodeDetails(code);
  if (!details) {
    return {
      ok: false,
      error: 'not_found',
      code,
      guidance:
        'Code not found. Ask the student to double-check the digits. If still wrong, they should ask their teacher for a valid code.',
    };
  }

  const matchesCaller = details.used_by.some((u) => phonesMatch(fromPhone, u.phone));

  let status: 'available' | 'used' | 'expired' = 'available';
  if (details.is_expired) status = 'expired';
  else if (details.is_used) status = 'used';

  return {
    ok: true,
    code: details.code,
    status,
    is_used: details.is_used,
    is_expired: details.is_expired,
    uses: details.uses,
    max_uses: details.max_uses,
    course_title: details.course.title,
    teacher_name: details.teacher.name,
    used_by_matches_whatsapp_caller: matchesCaller,
    used_by_phone_masked: details.used_by.map((u) => maskPhone(u.phone)),
    guidance:
      status === 'available'
        ? 'Code is still available. Tell the student they can activate from the platform with QR scan or by typing this code manually.'
        : status === 'expired'
          ? 'Code is expired. Student should ask their teacher for a new code.'
          : matchesCaller
            ? 'Code already used on an account matching this WhatsApp number. Tell them to log in with that same account (mobile + password). Offer password help if needed.'
            : 'Code already used on another account. If this code is theirs, they must log in with the account it was activated on. If not theirs / they do not have that account, they should go back to the teacher and get a new personal code.',
  };
}

function normalizeArabicForSearch(input: string): string {
  return input
    .normalize('NFKC')
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[^\u0600-\u06FFa-zA-Z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const ARABIC_SEARCH_STOPWORDS = new Set([
  'دكتور',
  'د',
  'مستر',
  'استاذ',
  'استاذه',
  'مع',
  'عايز',
  'عايزه',
  'عايزة',
  'اشترك',
  'منصه',
  'منصة',
  'مدرس',
  'مدرسه',
  'في',
  'على',
  'علي',
  'او',
  'و',
  'يا',
  'بتاع',
  'بتاعة',
]);

const SQL_NORM_AR = (expr: string) =>
  `translate(lower(COALESCE(${expr}, '')), 'أإآٱةىؤئ', 'ااااهييوي')`;

function arabicTokenVariants(token: string): string[] {
  const base = normalizeArabicForSearch(token);
  if (!base) return [];
  const set = new Set<string>([base]);

  if (base.endsWith('يي') && base.length > 3) set.add(base.slice(0, -1));
  if (base.endsWith('ي') && !base.endsWith('يي') && base.length >= 3) set.add(`${base}ي`);

  if (base.startsWith('ال') && base.length > 3) set.add(base.slice(2));
  else set.add(`ال${base}`);

  return [...set].filter((t) => t.length >= 2);
}

function extractSearchTokens(query: string): string[] {
  const normalized = normalizeArabicForSearch(query);
  const tokens = normalized
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !ARABIC_SEARCH_STOPWORDS.has(t));
  if (tokens.length) return tokens;
  return normalized ? [normalized] : [];
}

async function searchTenants(query: string, fromPhone: string, limitRaw?: number) {
  const q = query.trim();
  if (!q || q.length < 2) {
    return { ok: false, error: 'query too short' };
  }
  const limit = Math.min(Math.max(Number(limitRaw) || 8, 1), 15);
  const tokens = extractSearchTokens(q);
  if (!tokens.length) {
    return { ok: false, error: 'query too short after normalization', tenants: [] };
  }

  const scoreParts: string[] = [];
  const whereParts: string[] = [];
  const params: Array<string | number> = [];

  tokens.forEach((token) => {
    const variants = arabicTokenVariants(token);
    const variantLikes: string[] = [];
    for (const v of variants) {
      params.push(`%${v}%`);
      variantLikes.push(`$${params.length}`);
    }
    const tokenMatch = `(
      ${variantLikes
        .map(
          (p) => `(
            ${SQL_NORM_AR('t.display_name')} LIKE ${p}
            OR ${SQL_NORM_AR('u.name')} LIKE ${p}
            OR ${SQL_NORM_AR('t.specialty')} LIKE ${p}
            OR lower(COALESCE(t.subdomain, '')) LIKE ${p}
          )`,
        )
        .join(' OR ')}
    )`;
    scoreParts.push(`(CASE WHEN ${tokenMatch} THEN 1 ELSE 0 END)`);
    whereParts.push(tokenMatch);
  });

  params.push(Math.max(limit * 5, 40));

  const result = await pool.query<{
    id: number;
    subdomain: string;
    display_name: string;
    specialty: string | null;
    owner_name: string | null;
    match_score: number;
  }>(
    `SELECT t.id, t.subdomain, t.display_name, t.specialty, u.name AS owner_name,
            (${scoreParts.join(' + ')})::int AS match_score
     FROM tenants t
     LEFT JOIN users u ON u.id = t.owner_user_id
     WHERE t.is_active = TRUE
       AND t.subdomain <> 'default'
       AND t.subdomain NOT LIKE 'deleted-%'
       AND (${whereParts.join(' OR ')})
     ORDER BY match_score DESC, t.display_name ASC
     LIMIT $${params.length}`,
    params,
  );

  const scored = result.rows;
  const maxScore = scored.reduce((m, r) => Math.max(m, Number(r.match_score) || 0), 0);
  const fullMatches = scored.filter((r) => Number(r.match_score) === tokens.length);
  const minKeep =
    tokens.length >= 2 ? Math.max(2, Math.min(tokens.length, maxScore)) : Math.max(1, maxScore);
  const picked = (fullMatches.length ? fullMatches : scored.filter((r) => Number(r.match_score) >= minKeep)).slice(
    0,
    limit,
  );

  const callerLookup = await lookupStudentsByWhatsapp(fromPhone);
  const callerStudents = Array.isArray(
    (callerLookup as { students?: unknown[] }).students,
  )
    ? (
        callerLookup as {
          students: Array<{
            student_user_id: number;
            name: string;
            account_status: string;
            tenant_id: number | null;
          }>;
        }
      ).students
    : [];

  const byTenantId = new Map(
    callerStudents
      .filter((s) => s.tenant_id != null)
      .map((s) => [s.tenant_id as number, s]),
  );

  return {
    ok: true,
    count: picked.length,
    query_original: q,
    query_tokens: tokens,
    query_token_variants: Object.fromEntries(tokens.map((t) => [t, arabicTokenVariants(t)])),
    checked_whatsapp_caller: true,
    account_check_note:
      'caller_has_account_on_this_tenant is based on the current WhatsApp caller phone vs student accounts on that tenant. Prefer public_url only (do not invent separate /login or /signup links).',
    tenants: picked.map((row) => {
      const publicUrl = buildTenantPublicUrl(row.subdomain);
      const callerStudent = byTenantId.get(row.id) || null;
      return {
        tenant_id: row.id,
        display_name: row.display_name,
        subdomain: row.subdomain,
        specialty: row.specialty,
        teacher_name: row.owner_name,
        public_url: publicUrl,
        match_score: Number(row.match_score) || 0,
        caller_has_account_on_this_tenant: Boolean(callerStudent),
        caller_student: callerStudent
          ? {
              student_user_id: callerStudent.student_user_id,
              name: callerStudent.name,
              account_status: callerStudent.account_status,
            }
          : null,
      };
    }),
  };
}

async function lookupStudentsByWhatsapp(fromPhone: string) {
  const variants = phoneMatchVariants(fromPhone);
  if (!variants.length) {
    return { ok: false, error: 'invalid phone', students: [] };
  }

  const result = await pool.query<{
    id: number;
    name: string;
    phone: string | null;
    student_code: string | null;
    tenant_id: number | null;
    account_status: string | null;
    subdomain: string | null;
    display_name: string | null;
  }>(
    `SELECT u.id, u.name, u.phone, u.student_code, u.tenant_id, u.account_status,
            t.subdomain, t.display_name
     FROM users u
     LEFT JOIN tenants t ON t.id = u.tenant_id
     WHERE u.role::text = 'student'
       AND u.phone IS NOT NULL
       AND regexp_replace(u.phone, '[^0-9]', '', 'g') = ANY($1::text[])
     ORDER BY u.id ASC
     LIMIT 20`,
    [variants],
  );

  // Extra filter with phonesMatch for edge formats
  const students = result.rows
    .filter((row) => phonesMatch(fromPhone, row.phone))
    .map((row) => ({
      student_user_id: row.id,
      name: row.name,
      student_code: row.student_code,
      phone_masked: maskPhone(row.phone),
      whatsapp_matches: true,
      account_status: row.account_status || 'active',
      tenant_id: row.tenant_id,
      tenant_display_name: row.display_name,
      tenant_subdomain: row.subdomain,
      public_url: row.subdomain ? buildTenantPublicUrl(row.subdomain) : null,
    }));

  return { ok: true, count: students.length, students };
}

async function lookupStudentByCode(studentCode: string, fromPhone: string) {
  const code = studentCode.trim();
  if (!code) return { ok: false, error: 'student_code required' };

  const result = await pool.query<{
    id: number;
    name: string;
    phone: string | null;
    student_code: string | null;
    tenant_id: number | null;
    account_status: string | null;
    subdomain: string | null;
    display_name: string | null;
  }>(
    `SELECT u.id, u.name, u.phone, u.student_code, u.tenant_id, u.account_status,
            t.subdomain, t.display_name
     FROM users u
     LEFT JOIN tenants t ON t.id = u.tenant_id
     WHERE u.role::text = 'student'
       AND u.student_code = $1
     LIMIT 5`,
    [code],
  );

  if (!result.rowCount) {
    return { ok: false, error: 'not_found', students: [] };
  }

  return {
    ok: true,
    students: result.rows.map((row) => {
      const match = phonesMatch(fromPhone, row.phone);
      return {
        student_user_id: row.id,
        name: row.name,
        student_code: row.student_code,
        phone_masked: maskPhone(row.phone),
        whatsapp_matches: match,
        can_reset_password: match,
        account_status: row.account_status || 'active',
        tenant_id: row.tenant_id,
        tenant_display_name: row.display_name,
        tenant_subdomain: row.subdomain,
        public_url: row.subdomain ? buildTenantPublicUrl(row.subdomain) : null,
      };
    }),
  };
}

export async function executeSupportTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolExecutionContext,
): Promise<unknown> {
  switch (name) {
    case 'search_tenants':
      return searchTenants(String(args.query || ''), ctx.fromPhone, Number(args.limit));
    case 'lookup_students_by_whatsapp':
      return lookupStudentsByWhatsapp(ctx.fromPhone);
    case 'lookup_student_by_code':
      return lookupStudentByCode(String(args.student_code || ''), ctx.fromPhone);
    case 'get_platform_help':
      return getPlatformHelp(args.topic != null ? String(args.topic) : null);
    case 'lookup_activation_code':
      return lookupActivationCode(String(args.code || ''), ctx.fromPhone);
    case 'reset_student_password': {
      const studentUserId = Number(args.student_user_id);
      if (!Number.isFinite(studentUserId) || studentUserId <= 0) {
        return { ok: false, error: 'invalid student_user_id' };
      }
      const tenantId =
        args.tenant_id != null && Number.isFinite(Number(args.tenant_id))
          ? Number(args.tenant_id)
          : null;
      const newPassword =
        args.new_password != null && String(args.new_password).trim()
          ? String(args.new_password).trim()
          : null;
      return resetStudentPasswordSecure({
        fromPhone: ctx.fromPhone,
        studentUserId,
        tenantId,
        conversationId: ctx.conversationId,
        newPassword,
      });
    }
    default:
      return { ok: false, error: `unknown tool: ${name}` };
  }
}
