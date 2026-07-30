import pool from '../../../../db/pool';
import { buildTenantPublicUrl } from '../../../../config/appUrls';
import { TeacherManagedStudentsService } from '../../../../services/teacherManagedStudents';
import {
  activateCourseByCodeForStudent,
  getActivationCodeDetails,
} from '../../../../services/activationCodeLookup';
import { HttpError, logger } from '../../../../utils';
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
        'Search active teacher platforms/tenants by teacher name, display name, or subdomain. Returns public URLs.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Teacher name, specialty keyword, or subdomain fragment',
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
        'Find student accounts whose stored phone matches the current WhatsApp caller. Use for password reset and account info.',
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
        'Look up a student by student_code. Returns tenant URL, masked phone, and whether WhatsApp matches.',
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
      description: 'Get curated help text for login, signup, password, wrong URL, locked account.',
      parameters: {
        type: 'object',
        properties: {
          topic: {
            type: 'string',
            enum: ['login', 'signup', 'forgot_password', 'wrong_url', 'account_locked', 'general'],
          },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'reset_student_password',
      description:
        'Set a new password chosen by the student. ONLY when WhatsApp matches the student account phone. Ask the student for new_password first, then call with student_user_id + new_password. Does not return the password.',
      parameters: {
        type: 'object',
        properties: {
          student_user_id: { type: 'integer' },
          new_password: {
            type: 'string',
            description: 'Password the student chose (min 6, max 72 chars)',
          },
          tenant_id: { type: 'integer', description: 'Optional tenant filter' },
        },
        required: ['student_user_id', 'new_password'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'list_tenant_grades',
      description:
        'List grades available for a teacher platform (tenant). Required before create_student_account.',
      parameters: {
        type: 'object',
        properties: {
          tenant_id: { type: 'integer', description: 'Tenant id from search_tenants' },
        },
        required: ['tenant_id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'create_student_account',
      description:
        'Create a student account on a teacher platform for the current WhatsApp caller. Collect tenant_id, name, grade_id first. Optional password (defaults to WhatsApp phone digits). Returns student_code and public_url — does not echo password.',
      parameters: {
        type: 'object',
        properties: {
          tenant_id: { type: 'integer' },
          name: { type: 'string', description: 'Student full name' },
          grade_id: { type: 'integer', description: 'Grade id from list_tenant_grades' },
          password: {
            type: 'string',
            description: 'Optional password chosen by student (min 6). If omitted, WhatsApp digits are used.',
          },
        },
        required: ['tenant_id', 'name', 'grade_id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'lookup_activation_code',
      description:
        'Look up a course activation/invite code: course title, teacher, used/expired status, and account names that used it (phones masked).',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'Activation / invite code' },
        },
        required: ['code'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'activate_course_code',
      description:
        'Activate a free/valid course code for a student whose phone matches the current WhatsApp caller.',
      parameters: {
        type: 'object',
        properties: {
          student_user_id: { type: 'integer' },
          code: { type: 'string' },
        },
        required: ['student_user_id', 'code'],
      },
    },
  },
];

async function searchTenants(query: string, limitRaw?: number) {
  const q = query.trim();
  if (!q || q.length < 2) {
    return { ok: false, error: 'query too short' };
  }
  const limit = Math.min(Math.max(Number(limitRaw) || 8, 1), 15);
  const like = `%${q}%`;

  const result = await pool.query<{
    id: number;
    subdomain: string;
    display_name: string;
    specialty: string | null;
    owner_name: string | null;
  }>(
    `SELECT t.id, t.subdomain, t.display_name, t.specialty, u.name AS owner_name
     FROM tenants t
     LEFT JOIN users u ON u.id = t.owner_user_id
     WHERE t.is_active = TRUE
       AND t.subdomain <> 'default'
       AND t.subdomain NOT LIKE 'deleted-%'
       AND (
         t.display_name ILIKE $1
         OR t.subdomain ILIKE $1
         OR COALESCE(t.specialty, '') ILIKE $1
         OR COALESCE(u.name, '') ILIKE $1
       )
     ORDER BY t.display_name ASC
     LIMIT $2`,
    [like, limit],
  );

  return {
    ok: true,
    count: result.rowCount,
    tenants: result.rows.map((row) => ({
      tenant_id: row.id,
      display_name: row.display_name,
      subdomain: row.subdomain,
      specialty: row.specialty,
      teacher_name: row.owner_name,
      public_url: buildTenantPublicUrl(row.subdomain),
    })),
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

async function listTenantGrades(tenantId: number) {
  if (!Number.isFinite(tenantId) || tenantId <= 0) {
    return { ok: false, error: 'invalid tenant_id' };
  }

  const tenantRes = await pool.query<{
    id: number;
    owner_user_id: number | null;
    display_name: string;
    subdomain: string;
    is_active: boolean;
  }>(
    `SELECT id, owner_user_id, display_name, subdomain, is_active
     FROM tenants
     WHERE id = $1`,
    [tenantId],
  );
  const tenant = tenantRes.rows[0];
  if (!tenant || !tenant.is_active) {
    return { ok: false, error: 'tenant_not_found' };
  }
  if (!tenant.owner_user_id) {
    return { ok: false, error: 'tenant_has_no_owner' };
  }

  const gradesRes = await pool.query<{
    id: number;
    name: string;
    slug: string | null;
  }>(
    `SELECT g.id, g.name, g.slug
     FROM teacher_grades tg
     JOIN grades g ON g.id = tg.grade_id
     WHERE tg.teacher_id = $1
     ORDER BY g.name ASC`,
    [tenant.owner_user_id],
  );

  return {
    ok: true,
    tenant_id: tenant.id,
    tenant_display_name: tenant.display_name,
    public_url: buildTenantPublicUrl(tenant.subdomain),
    grades: gradesRes.rows.map((g) => ({
      grade_id: g.id,
      name: g.name,
      slug: g.slug,
    })),
  };
}

function storagePhoneFromWhatsapp(fromPhone: string): string {
  const digits = fromPhone.replace(/[^0-9]/g, '');
  // Prefer common Egyptian local form 01xxxxxxxxx when WA is 201xxxxxxxxx
  if (digits.startsWith('20') && digits.length >= 12) {
    return `0${digits.slice(2)}`;
  }
  if (digits.startsWith('0')) return digits;
  return digits || fromPhone.trim();
}

async function createStudentAccount(
  args: {
    tenantId: number;
    name: string;
    gradeId: number;
    password?: string | null;
  },
  ctx: ToolExecutionContext,
) {
  const name = args.name.trim();
  if (!name || name.length < 2) {
    return { ok: false, error: 'invalid_name', message: 'الاسم مطلوب.' };
  }
  if (!Number.isFinite(args.tenantId) || args.tenantId <= 0) {
    return { ok: false, error: 'invalid_tenant_id' };
  }
  if (!Number.isFinite(args.gradeId) || args.gradeId <= 0) {
    return { ok: false, error: 'invalid_grade_id' };
  }

  let password: string | undefined;
  if (args.password != null && String(args.password).trim()) {
    const p = String(args.password).trim();
    if (p.length < 6) {
      return { ok: false, error: 'invalid_password', message: 'الباسورد لازم تكون 6 حروف على الأقل.' };
    }
    if (p.length > 72) {
      return { ok: false, error: 'invalid_password', message: 'الباسورد طويلة أوي.' };
    }
    password = p;
  }

  const tenantRes = await pool.query<{
    id: number;
    owner_user_id: number | null;
    subdomain: string;
    display_name: string;
    is_active: boolean;
  }>(
    `SELECT id, owner_user_id, subdomain, display_name, is_active
     FROM tenants WHERE id = $1`,
    [args.tenantId],
  );
  const tenant = tenantRes.rows[0];
  if (!tenant?.is_active || !tenant.owner_user_id) {
    return { ok: false, error: 'tenant_not_found' };
  }

  const phone = storagePhoneFromWhatsapp(ctx.fromPhone);
  const phoneDigits = phone.replace(/[^0-9]/g, '') || ctx.fromPhone.replace(/[^0-9]/g, '');
  const finalPassword = password || phoneDigits;

  try {
    const created = await TeacherManagedStudentsService.createStudent(
      tenant.owner_user_id,
      tenant.id,
      {
        name,
        grade_id: args.gradeId,
        phone,
        password: finalPassword,
        use_phone_as_password: !password,
      },
    );

    const student = created.student as {
      id?: number;
      student_code?: string | null;
      name?: string;
    };

    try {
      await pool.query(
        `INSERT INTO wa_support_audit
           (action, contact_phone, student_user_id, tenant_id, conversation_id, metadata)
         VALUES ('create_student', $1, $2, $3, $4, $5::jsonb)`,
        [
          ctx.fromPhone,
          student.id ?? null,
          tenant.id,
          ctx.conversationId,
          JSON.stringify({
            student_code: student.student_code,
            grade_id: args.gradeId,
            password_from_phone: !password,
          }),
        ],
      );
    } catch (err) {
      logger.warn({ err }, 'wa_support_audit create_student insert failed');
    }

    if (ctx.conversationId && student.id) {
      await pool.query(
        `UPDATE wa_conversations
         SET student_user_id = $2,
             tenant_id = $3,
             metadata = COALESCE(metadata, '{}'::jsonb) || $4::jsonb,
             updated_at = NOW()
         WHERE id = $1`,
        [
          ctx.conversationId,
          student.id,
          tenant.id,
          JSON.stringify({
            last_create_student_at: new Date().toISOString(),
            last_create_student_id: student.id,
          }),
        ],
      );
    }

    return {
      ok: true,
      student_user_id: student.id,
      student_code: student.student_code,
      student_name: student.name || name,
      tenant_id: tenant.id,
      tenant_display_name: tenant.display_name,
      public_url: buildTenantPublicUrl(tenant.subdomain),
      password_set: true,
      password_is_whatsapp_digits: !password,
      // Do not echo plaintext password
    };
  } catch (err) {
    if (err instanceof HttpError) {
      return { ok: false, error: 'create_failed', message: err.message };
    }
    logger.error({ err }, 'create_student_account failed');
    return { ok: false, error: 'create_failed', message: 'مقدرناش نعمل الحساب دلوقتي.' };
  }
}

async function lookupActivationCode(codeRaw: string) {
  const code = codeRaw.trim();
  if (!code) return { ok: false, error: 'code_required' };

  const details = await getActivationCodeDetails(code);
  if (!details) {
    return { ok: false, error: 'not_found', message: 'الكود مش موجود.' };
  }

  return {
    ok: true,
    code: details.code,
    course: details.course,
    teacher: {
      id: details.teacher.id,
      name: details.teacher.name,
      phone_masked: maskPhone(details.teacher.phone),
    },
    max_uses: details.max_uses,
    uses: details.uses,
    is_used: details.is_used,
    is_expired: details.is_expired,
    expires_at: details.expires_at,
    used_by: details.used_by.map((u) => ({
      user_id: u.user_id,
      name: u.name,
      phone_masked: maskPhone(u.phone),
      used_at: u.used_at,
    })),
  };
}

async function activateCourseCode(
  studentUserId: number,
  codeRaw: string,
  ctx: ToolExecutionContext,
) {
  if (!Number.isFinite(studentUserId) || studentUserId <= 0) {
    return { ok: false, error: 'invalid_student_user_id' };
  }
  const code = codeRaw.trim();
  if (!code) return { ok: false, error: 'code_required' };

  const userRes = await pool.query<{
    id: number;
    name: string;
    phone: string | null;
    student_code: string | null;
    tenant_id: number | null;
    role: string;
  }>(
    `SELECT id, name, phone, student_code, tenant_id, role::text AS role
     FROM users WHERE id = $1 AND role::text = 'student'`,
    [studentUserId],
  );
  const user = userRes.rows[0];
  if (!user) {
    return { ok: false, error: 'not_found', message: 'مش لاقي حساب الطالب.' };
  }
  if (!phonesMatch(ctx.fromPhone, user.phone)) {
    return {
      ok: false,
      error: 'phone_mismatch',
      message:
        'التفعيل بس للحساب اللي رقم الواتساب بتاعه مطابق. ابعت من الرقم المسجّل أو كلّم المدرس.',
    };
  }

  const result = await activateCourseByCodeForStudent(studentUserId, code);
  if (!result.success) {
    return { ok: false, error: 'activate_failed', message: result.message };
  }

  try {
    await pool.query(
      `INSERT INTO wa_support_audit
         (action, contact_phone, student_user_id, tenant_id, conversation_id, metadata)
       VALUES ('activate_course', $1, $2, $3, $4, $5::jsonb)`,
      [
        ctx.fromPhone,
        user.id,
        user.tenant_id,
        ctx.conversationId,
        JSON.stringify({
          code,
          course_id: result.course?.id,
          course_title: result.course?.title,
        }),
      ],
    );
  } catch (err) {
    logger.warn({ err }, 'wa_support_audit activate_course insert failed');
  }

  return {
    ok: true,
    message: result.message,
    course: result.course,
    student_user_id: user.id,
    student_name: user.name,
    student_code: user.student_code,
  };
}

export async function executeSupportTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolExecutionContext,
): Promise<unknown> {
  switch (name) {
    case 'search_tenants':
      return searchTenants(String(args.query || ''), Number(args.limit));
    case 'lookup_students_by_whatsapp':
      return lookupStudentsByWhatsapp(ctx.fromPhone);
    case 'lookup_student_by_code':
      return lookupStudentByCode(String(args.student_code || ''), ctx.fromPhone);
    case 'get_platform_help':
      return getPlatformHelp(args.topic != null ? String(args.topic) : null);
    case 'reset_student_password': {
      const studentUserId = Number(args.student_user_id);
      if (!Number.isFinite(studentUserId) || studentUserId <= 0) {
        return { ok: false, error: 'invalid student_user_id' };
      }
      const tenantId =
        args.tenant_id != null && Number.isFinite(Number(args.tenant_id))
          ? Number(args.tenant_id)
          : null;
      return resetStudentPasswordSecure({
        fromPhone: ctx.fromPhone,
        studentUserId,
        newPassword: String(args.new_password ?? ''),
        tenantId,
        conversationId: ctx.conversationId,
      });
    }
    case 'list_tenant_grades':
      return listTenantGrades(Number(args.tenant_id));
    case 'create_student_account':
      return createStudentAccount(
        {
          tenantId: Number(args.tenant_id),
          name: String(args.name || ''),
          gradeId: Number(args.grade_id),
          password: args.password != null ? String(args.password) : null,
        },
        ctx,
      );
    case 'lookup_activation_code':
      return lookupActivationCode(String(args.code || ''));
    case 'activate_course_code':
      return activateCourseCode(Number(args.student_user_id), String(args.code || ''), ctx);
    default:
      return { ok: false, error: `unknown tool: ${name}` };
  }
}
