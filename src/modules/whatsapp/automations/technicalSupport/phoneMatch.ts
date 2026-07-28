import { normalizePhone } from '../../gateway/whatsappGatewayClient';

/** Generate common storage variants for matching DB phones to WhatsApp E.164 digits. */
export function phoneMatchVariants(phone: string): string[] {
  const n = normalizePhone(phone);
  const set = new Set<string>([n, phone.replace(/[^0-9]/g, '')].filter(Boolean));

  // Egypt: 20XXXXXXXXXX ↔ 0XXXXXXXXXX ↔ XXXXXXXXXX
  if (n.startsWith('20') && n.length >= 12) {
    const local = n.slice(2);
    set.add(`0${local}`);
    set.add(local);
  }
  // Saudi: 9665XXXXXXX ↔ 05XXXXXXX ↔ 5XXXXXXX
  if (n.startsWith('966') && n.length >= 12) {
    const local = n.slice(3);
    set.add(`0${local}`);
    set.add(local);
  }
  // UAE etc. 971…
  if (n.startsWith('971') && n.length >= 12) {
    const local = n.slice(3);
    set.add(`0${local}`);
    set.add(local);
  }

  if (n.startsWith('0') && n.length >= 10) {
    set.add(normalizePhone(n));
  }

  return [...set];
}

export function phonesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const na = normalizePhone(a);
  const nb = normalizePhone(b);
  if (na === nb) return true;
  const va = new Set(phoneMatchVariants(a));
  return phoneMatchVariants(b).some((v) => va.has(v));
}

export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return '—';
  const digits = phone.replace(/[^0-9]/g, '');
  if (digits.length < 6) return '***';
  return `${digits.slice(0, 3)}***${digits.slice(-3)}`;
}
