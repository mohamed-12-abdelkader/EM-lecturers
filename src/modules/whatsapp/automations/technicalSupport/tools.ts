import pool from '../../../../db/pool';
import { buildTenantPublicUrl } from '../../../../config/appUrls';
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
        'Reset password ONLY when WhatsApp number matches the student account phone. Requires student_user_id from lookup. Pass new_password if the student chose one; omit it to auto-generate. Returns the password to send to the student.',
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
