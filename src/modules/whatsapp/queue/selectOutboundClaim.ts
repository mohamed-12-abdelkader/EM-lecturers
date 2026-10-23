export interface ClaimCandidate {
  id: number;
  sessionSlug: string;
  serviceKey: string | null;
  scheduledAt: number;
}

/**
 * Other services keep a normal batch. parents_exam_notify sends at most one
 * due job per WhatsApp session so a closed exam cannot blast the number.
 */
export function selectOutboundClaim<T extends ClaimCandidate>(
  due: T[],
  opts: { batchSize: number; pacedServiceKey: string },
): T[] {
  const others: T[] = [];
  const paced: T[] = [];
  for (const job of due) {
    if (job.serviceKey === opts.pacedServiceKey) paced.push(job);
    else others.push(job);
  }
  others.sort((a, b) => a.scheduledAt - b.scheduledAt || a.id - b.id);
  paced.sort((a, b) => a.scheduledAt - b.scheduledAt || a.id - b.id);
  const claimedOthers = others.slice(0, Math.max(0, opts.batchSize));
  const seen = new Set<string>();
  const claimedPaced: T[] = [];
  for (const job of paced) {
    if (seen.has(job.sessionSlug)) continue;
    seen.add(job.sessionSlug);
    claimedPaced.push(job);
  }
  return [...claimedOthers, ...claimedPaced];
}
