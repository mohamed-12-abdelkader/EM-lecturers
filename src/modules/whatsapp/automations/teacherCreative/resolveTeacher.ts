import pool from '../../../../db/pool';
import { phoneMatchVariants } from '../phoneMatch';

export type ResolvedTeacher = {
  id: number;
  name: string | null;
  tenant_id: number | null;
  phone: string | null;
  whatsapp_number: string | null;
};

/**
 * Identify a teacher by WhatsApp from-phone against users.phone or users.whatsapp_number.
 */
export async function resolveTeacherByPhone(
  fromPhone: string,
): Promise<ResolvedTeacher | null> {
  const variants = phoneMatchVariants(fromPhone);
  if (variants.length === 0) return null;

  const result = await pool.query<ResolvedTeacher>(
    `SELECT id, name, tenant_id, phone, whatsapp_number
     FROM users
     WHERE role = 'teacher'
       AND (
         (phone IS NOT NULL AND regexp_replace(phone, '[^0-9]', '', 'g') = ANY($1::text[]))
         OR (
           whatsapp_number IS NOT NULL
           AND regexp_replace(whatsapp_number, '[^0-9]', '', 'g') = ANY($1::text[])
         )
       )
     ORDER BY id ASC
     LIMIT 1`,
    [variants],
  );

  return result.rows[0] ?? null;
}
