/** Egyptian and generic parent numbers. Returns digits or null when unusable. */
export function canonicalParentPhone(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  let digits = String(raw).replace(/[^0-9]/g, '');
  if (!digits) return null;
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('01') && digits.length === 11) digits = `20${digits.slice(1)}`;
  else if (/^1[0125]\d{8}$/.test(digits)) digits = `20${digits}`;
  if (!/^\d{10,15}$/.test(digits)) return null;
  if (digits.startsWith('20') && !/^20(10|11|12|15)\d{8}$/.test(digits)) return null;
  return digits;
}
