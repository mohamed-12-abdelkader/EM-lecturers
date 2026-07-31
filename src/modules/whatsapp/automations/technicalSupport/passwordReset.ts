import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import pool from '../../../../db/pool';
import { phonesMatch } from './phoneMatch';
import { logger } from '../../../../utils';

const MAX_RESETS_PER_PHONE_24H = 3;

function generateTempPassword(): string {
  // Readable alphanumeric, no ambiguous chars
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(10);
  let out = '';
  for (let i = 0; i < 10; i++) {
    out += alphabet[bytes[i]! % alphabet.length];
  }
  return out;
}

export type PasswordResetResult =
  | {
      ok: true;
      temporary_password: string;
      student_user_id: number;
      student_code: string | null;
      student_name: string;
      tenant_id: number | null;
      must_change_password: true;
    }
  | { ok: false; error: string; code: string };

export async function resetStudentPasswordSecure(input: {
  fromPhone: string;
  studentUserId: number;
  tenantId?: number | null;
  conversationId?: number | null;
}): Promise<PasswordResetResult> {
  const { fromPhone, studentUserId, tenantId, conversationId } = input;

  // Rate limit by WhatsApp contact phone
  const rate = await pool.query<{ c: string }>(
    `SELECT COUNT(*)::text AS c
     FROM wa_support_audit
     WHERE action = 'password_reset'
       AND contact_phone = $1
       AND created_at > NOW() - INTERVAL '24 hours'`,
    [fromPhone],
  );
  if (Number(rate.rows[0]?.c || 0) >= MAX_RESETS_PER_PHONE_24H) {
    return {
      ok: false,
      code: 'rate_limited',
      error: 'عدّيت الحد المسموح لريست الباسورد خلال 24 ساعة. جرّب بعدين أو كلّم المدرس.',
    };
  }

  const userRes = await pool.query<{
    id: number;
    name: string;
    phone: string | null;
    student_code: string | null;
    tenant_id: number | null;
    role: string;
    account_status: string | null;
  }>(
    `SELECT id, name, phone, student_code, tenant_id, role::text AS role, account_status
     FROM users
     WHERE id = $1
       AND role::text = 'student'
       ${tenantId != null ? 'AND tenant_id = $2' : ''}`,
    tenantId != null ? [studentUserId, tenantId] : [studentUserId],
  );

  const user = userRes.rows[0];
  if (!user) {
    return { ok: false, code: 'not_found', error: 'مش لاقي حساب الطالب اللي اتحدد.' };
  }

  if (!phonesMatch(fromPhone, user.phone)) {
    return {
      ok: false,
      code: 'phone_mismatch',
      error:
        'مش هقدر أعمل ريست للباسورد غير من رقم الواتساب المسجّل على الحساب. ابعتلنا من الرقم المسجّل أو كلّم المدرس.',
    };
  }

  if (user.account_status && user.account_status !== 'active') {
    return {
      ok: false,
      code: 'account_inactive',
      error: `حالة الحساب دلوقتي: ${user.account_status}. مش هقدر أعمل ريست أوتوماتيك — كلّم المدرس.`,
    };
  }

  const temporary = generateTempPassword();
  const hashed = await bcrypt.hash(temporary, 10);

  await pool.query(
    `UPDATE users SET password = $1, must_change_password = TRUE WHERE id = $2`,
    [hashed, user.id],
  );

  try {
    await pool.query(
      `INSERT INTO wa_support_audit
         (action, contact_phone, student_user_id, tenant_id, conversation_id, metadata)
       VALUES ('password_reset', $1, $2, $3, $4, $5::jsonb)`,
      [
        fromPhone,
        user.id,
        user.tenant_id,
        conversationId ?? null,
        JSON.stringify({ student_code: user.student_code }),
      ],
    );
  } catch (err) {
    // Audit table may not exist yet during hot-reload before migrate — still succeed reset
    logger.warn({ err }, 'wa_support_audit insert failed');
  }

  if (conversationId) {
    await pool.query(
      `UPDATE wa_conversations
       SET student_user_id = $2,
           tenant_id = COALESCE($3, tenant_id),
           metadata = COALESCE(metadata, '{}'::jsonb) || $4::jsonb,
           updated_at = NOW()
       WHERE id = $1`,
      [
        conversationId,
        user.id,
        user.tenant_id,
        JSON.stringify({
          last_password_reset_at: new Date().toISOString(),
          last_password_reset_student_id: user.id,
        }),
      ],
    );
  }

  return {
    ok: true,
    temporary_password: temporary,
    student_user_id: user.id,
    student_code: user.student_code,
    student_name: user.name,
    tenant_id: user.tenant_id,
    must_change_password: true,
  };
}
