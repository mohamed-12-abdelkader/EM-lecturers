/**
 * Helpers for passage-based questions: partial-update safety and response shaping.
 */

export type PassagePayload = {
  id: number | null;
  text: string;
  passageText: string;
  content: string;
  title: string | null;
};

/** True when the request body explicitly includes any of the given keys (even if null). */
export function bodyHasOwnField(body: unknown, keys: string[]): boolean {
  if (!body || typeof body !== 'object') return false;
  const record = body as Record<string, unknown>;
  return keys.some((key) => Object.prototype.hasOwnProperty.call(record, key));
}

/**
 * Resolve passage text for updates:
 * - omitted / undefined → keep existing (return undefined sentinel meaning "no change")
 * - explicit null / '' → reject for content fields (caller decides), return null for id unlink
 */
export function resolveOptionalPassageIdUpdate(
  body: unknown,
  keys: string[] = ['passage_id', 'passageId'],
): { present: false } | { present: true; value: number | null } {
  if (!bodyHasOwnField(body, keys)) return { present: false };
  const record = body as Record<string, unknown>;
  const raw = keys.map((k) => record[k]).find((v) => v !== undefined);
  if (raw === null || raw === '') return { present: true, value: null };
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error('invalid_passage_id');
  }
  return { present: true, value: n };
}

export function buildPassagePayload(
  id: number | null,
  text: string,
  title: string | null = null,
): PassagePayload {
  const trimmed = String(text ?? '');
  return {
    id,
    text: trimmed,
    passageText: trimmed,
    content: trimmed,
    title: title ?? null,
  };
}

/** Prefer non-empty snapshot, then linked passage text. */
export function coalescePassageText(
  snapshotText: string | null | undefined,
  linkedText: string | null | undefined,
): string | null {
  const snap = snapshotText != null ? String(snapshotText).trim() : '';
  if (snap) return String(snapshotText);
  const linked = linkedText != null ? String(linkedText).trim() : '';
  if (linked) return String(linkedText);
  return null;
}

export function attachPassageFields<T extends Record<string, unknown>>(
  row: T,
  passage: PassagePayload | null,
): T & {
  passage: PassagePayload | null;
  passageText: string | null;
  passageId: number | null;
} {
  return {
    ...row,
    passage,
    passageText: passage?.passageText ?? null,
    passageId: passage?.id ?? null,
  };
}
